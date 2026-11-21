import { lstat } from "node:fs/promises";
import { type DocumentSearchMetadata, formatRef, type WorkbenchRetrieval } from "@vera/shared";
import type Database from "better-sqlite3";
import { keywordEpoch } from "../storage/repos/documents.js";
import { rebuildingEmbeddings } from "../storage/repos/embedding-rebuild.js";
import { PathGuard } from "../workbench/path-guard.js";
import { type Chunk, locatorSchema } from "./chunk.js";
import { type EmbeddingPort, embeddingDeadlineCode, type VectorRow } from "./embedding.js";
import type { DocumentIndexPhase } from "./ingest.js";
import { KeywordSearch } from "./keyword.js";

export interface SearchResult {
  ref: string;
  path: string;
  locator: Chunk["locator"];
  snippet: string;
  score: number;
}

export type DocumentSearchResponse = DocumentSearchMetadata & {
  results: SearchResult[];
  message?: string;
};

export type SearchHitValidator = (hit: SearchResult, signal: AbortSignal) => Promise<boolean>;

interface SearchOptions {
  root: string;
  db: Database.Database;
  query: string;
  k: number;
  mode: WorkbenchRetrieval["mode"];
  pathGlob: string | undefined;
  acceptPath: ((path: string) => boolean) | undefined;
  signal: AbortSignal;
  excludedRoots: readonly string[];
  embeddings: (() => EmbeddingPort | undefined) | undefined;
  phase: (() => DocumentIndexPhase) | undefined;
  createHitValidator: (() => SearchHitValidator) | undefined;
}

interface Row {
  id: number;
  path: string;
  text: string;
  locatorJson: string;
}
type FallbackReason = NonNullable<
  Extract<DocumentSearchMetadata["usage"], { mode: "keyword" }>["fallbackReason"]
>;
const fallbackMessages: Record<FallbackReason, string> = {
  "embedding-rebuild": "Embedding vectors are being rebuilt; these are keyword results.",
  "semantic-unavailable": "Semantic ranking is unavailable; these are keyword results.",
  "revision-conflict": "The index changed during semantic ranking; these are keyword results.",
};
const SEMANTIC_RETRY_BUDGET_MS = 150;

class SearchRevisionChanged extends Error {
  constructor(readonly preferKeyword: boolean) {
    super();
  }
}
function publishing(phase: DocumentIndexPhase | undefined): boolean {
  return phase === "scanning" || phase === "indexing";
}
class SemanticUnavailable extends Error {}

export function documentRef(path: string, locator: Chunk["locator"]): string {
  if (locator.type === "page") return formatRef({ kind: "page", path, page: locator.page });
  if (locator.type === "lines")
    return formatRef({ kind: "lines", path, start: locator.start, end: locator.end });
  // Only Markdown has line ranges for the untitled preamble.
  return !locator.slug && locator.start && locator.end
    ? formatRef({ kind: "lines", path, start: locator.start, end: locator.end })
    : formatRef({ kind: "heading", path, slug: locator.slug });
}

export function fuseRanks(lists: readonly (readonly number[])[]): { id: number; score: number }[] {
  const scores = new Map<number, number>();
  for (const list of lists) {
    const seen = new Set<number>();
    list.forEach((id, at) => {
      if (!seen.has(id)) {
        seen.add(id);
        scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + at + 1));
      }
    });
  }
  return [...scores]
    .map(([id, score]) => ({ id, score }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, 50);
}

function snippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const offsets = (query.match(/[\p{L}\p{N}_]+/gu) ?? [])
    .map((term) => lower.indexOf(term.toLowerCase()))
    .filter((at) => at >= 0);
  const at = Math.max(0, (offsets.length ? Math.min(...offsets) : 0) - 80);
  let value = text.slice(at, at + 300);
  if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
  return value;
}

function embeddingEpoch(db: Database.Database): string {
  const epoch = db.prepare("SELECT value FROM meta WHERE key='embedding_epoch'").pluck().get();
  if (typeof epoch !== "string") throw Error("Missing current embedding epoch.");
  return epoch;
}

function coverage(phase?: DocumentIndexPhase): DocumentSearchMetadata["coverage"] {
  switch (phase) {
    case "settled":
      return "complete";
    case "scanning":
    case "indexing":
    case "settled-with-exceptions":
    case "blocked":
      return "partial";
    default:
      return "unknown";
  }
}

function emptyIndex(
  published: boolean,
  scope: DocumentSearchMetadata["coverage"],
  pathGlob: string | undefined,
): DocumentSearchResponse {
  if (published || scope === "complete") {
    return {
      coverage: scope,
      usage: { mode: null, reason: "no-candidates" },
      results: [],
      ...(pathGlob && {
        message: `No indexed document matched pathGlob "${pathGlob}". Globs are relative to the workbench root, so "*" matches only top-level files; use a pattern such as "docs/**", or omit pathGlob to search every document.`,
      }),
    };
  }
  return {
    results: [],
    coverage: scope,
    usage: { mode: null, reason: "index-not-ready" },
    message: "No documents indexed yet. Use grep to search text files.",
  };
}

async function semanticRank(
  options: SearchOptions,
  eligible: ReadonlySet<number>,
  epoch: string,
  assertCurrent: () => void,
) {
  const { db, embeddings, root, pathGlob, query, signal } = options;
  const port = embeddings?.();
  if (!port) throw new SemanticUnavailable();
  const key = `${epoch}:${port.modelId}:${pathGlob ?? ""}`;
  const loadVectors = (): VectorRow[] => {
    assertCurrent();
    const vectors = (
      db
        .prepare("SELECT chunk_id AS id,vector FROM embeddings WHERE model_id=? ORDER BY chunk_id")
        .all(port.modelId) as { id: number; vector: Buffer }[]
    )
      .filter((row) => eligible.has(row.id))
      .map((row) => ({ id: row.id, vector: new Float32Array(new Uint8Array(row.vector).buffer) }));
    if (!vectors.length) throw new SemanticUnavailable();
    return vectors;
  };
  try {
    return await port.rank(root, key, loadVectors, query, signal);
  } catch (error) {
    signal.throwIfAborted();
    // Deadlines cross the desktop indexer boundary as a code; host interruptions carry retry.
    const failure = error as { retry?: unknown; code?: unknown } | null;
    if (failure?.retry === true || failure?.code === embeddingDeadlineCode) throw new SemanticUnavailable();
    throw error;
  }
}

async function attemptSearch(
  options: SearchOptions,
  forcedFallback: FallbackReason | undefined,
): Promise<DocumentSearchResponse> {
  const { db, query, pathGlob, acceptPath, signal, phase } = options;
  const initialPhase = phase?.();
  const initialCoverage = coverage(initialPhase);
  const rows = db
    .prepare(`SELECT c.id,d.path FROM chunks c
      JOIN documents d ON d.id=c.doc_id WHERE d.status='indexed' ORDER BY c.id`)
    .all() as Pick<Row, "id" | "path">[];
  const eligible = new Set(rows.filter((row) => !acceptPath || acceptPath(row.path)).map((row) => row.id));
  if (!eligible.size) return emptyIndex(rows.length > 0, initialCoverage, pathGlob);

  const fallback =
    options.mode !== "keyword" && rebuildingEmbeddings(db) ? "embedding-rebuild" : forcedFallback;
  const mode = fallback ? "keyword" : options.mode;
  const semanticEpoch = mode === "keyword" ? undefined : embeddingEpoch(db);
  const revision = semanticEpoch === undefined ? () => keywordEpoch(db) : () => embeddingEpoch(db);
  const epoch = semanticEpoch ?? keywordEpoch(db);
  const started = semanticEpoch === undefined ? undefined : performance.now();
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (revision() === epoch) return;
    // A semantic retry at a new revision may reload the entire vector cache.
    const preferKeyword =
      started !== undefined &&
      performance.now() - started >= SEMANTIC_RETRY_BUDGET_MS &&
      (publishing(initialPhase) || publishing(phase?.()));
    throw new SearchRevisionChanged(preferKeyword);
  };
  const lexical = mode === "semantic" ? [] : new KeywordSearch(db).search(query, acceptPath);
  const semantic =
    semanticEpoch === undefined ? [] : await semanticRank(options, eligible, semanticEpoch, assertCurrent);
  assertCurrent();
  const ranked =
    mode === "hybrid"
      ? fuseRanks([lexical.map((row) => row.id), semantic.map((row) => row.id)])
      : mode === "semantic"
        ? semantic
        : lexical.map((row) => ({ id: row.id, score: -row.bm25 }));
  const passage = db.prepare(`SELECT c.id,d.path,c.text,c.locator_json AS locatorJson FROM chunks c
      JOIN documents d ON d.id=c.doc_id WHERE c.id=?`);
  // A model-only rechunk does not invalidate an already captured lexical candidate.
  const candidates = ranked
    .filter(({ id }) => eligible.has(id))
    .map(({ id, score }) => ({ score, row: passage.get(id) as Row | undefined }));
  const results = await validateCandidates(options, candidates);
  assertCurrent();
  const finalCoverage = coverage(phase?.());
  return {
    results,
    coverage:
      initialCoverage === "unknown" || finalCoverage === "unknown"
        ? "unknown"
        : initialCoverage === "partial" || finalCoverage === "partial"
          ? "partial"
          : "complete",
    usage: mode === "keyword" ? { mode, ...(fallback && { fallbackReason: fallback }) } : { mode },
    ...(fallback && { message: fallbackMessages[fallback] }),
  };
}

async function validateCandidates(
  { root, query, signal, excludedRoots, k, createHitValidator }: SearchOptions,
  candidates: { score: number; row: Row | undefined }[],
): Promise<SearchResult[]> {
  if (!candidates.length) return [];
  const guard = await PathGuard.create(root, root, "workbench", undefined, excludedRoots);
  const validateHit = createHitValidator?.();
  const results: SearchResult[] = [];
  for (const { score, row } of candidates) {
    signal.throwIfAborted();
    if (!row) continue;
    try {
      if (!(await lstat((await guard.resolve(row.path)).absolute)).isFile()) continue;
    } catch {
      continue;
    }
    signal.throwIfAborted();
    const locator = locatorSchema.parse(JSON.parse(row.locatorJson));
    const hit = {
      ref: documentRef(row.path, locator),
      path: row.path,
      locator,
      snippet: snippet(row.text, query),
      score,
    };
    if (validateHit && !(await validateHit(hit, signal))) continue;
    results.push(hit);
    if (results.length === k) break;
  }
  return results;
}

/** Search bounded coherent revisions without taking a lock across ranking and source checks. */
export async function searchPublishedDocuments(options: SearchOptions): Promise<DocumentSearchResponse> {
  let fallback: FallbackReason | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    options.signal.throwIfAborted();
    try {
      return await attemptSearch(options, fallback);
    } catch (error) {
      options.signal.throwIfAborted();
      if (error instanceof SemanticUnavailable) fallback = "semantic-unavailable";
      else if (!(error instanceof SearchRevisionChanged)) throw error;
      else if (error.preferKeyword || (attempt === 2 && options.mode !== "keyword"))
        fallback ??= "revision-conflict";
    }
  }
  return {
    results: [],
    coverage: "unknown",
    usage: { mode: null, reason: "revision-conflict" },
    message: "The document index is changing. Retry the search or use grep.",
  };
}
