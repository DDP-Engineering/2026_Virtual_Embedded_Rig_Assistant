import { lstat } from "node:fs/promises";
import { type DocumentSearchMetadata, formatRef, type WorkbenchRetrieval } from "@vera/shared";
import type Database from "better-sqlite3";
import { keywordEpoch } from "../storage/repos/documents.js";
import { rebuildingEmbeddings } from "../storage/repos/embedding-rebuild.js";
import { entryDisappeared } from "../tools/discovery.js";
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
  bytes: number | null;
  mtime: string | null;
}
type FallbackReason = NonNullable<
  Extract<DocumentSearchMetadata["usage"], { mode: "keyword" }>["fallbackReason"]
>;
const fallbackMessages: Record<FallbackReason, string> = {
  "embedding-rebuild": "Embedding vectors are being rebuilt; these are keyword results.",
  "semantic-unavailable": "Semantic ranking is unavailable; these are keyword results.",
  "semantic-budget": "Semantic ranking took too long. The search returned keyword results.",
  "revision-conflict": "The index changed during semantic ranking; these are keyword results.",
};
const SEMANTIC_RETRY_BUDGET_MS = 150;
const HYBRID_SEMANTIC_BUDGET_MS = 2000;

class SearchRevisionChanged extends Error {
  constructor(readonly fallback?: FallbackReason) {
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

const SNIPPET_CHARS = 300;
const SNIPPET_LEAD = 80;

/**
 * The 300 characters of a fragment that hold the most of the query: every place a query term occurs is a
 * candidate window, scored by the distinct terms inside it. A term counts by its length, and twice when it
 * is an identifier (digits, an underscore or all capitals), so `I2C1_CR1` or `SPI` outweighs the common
 * words around it in any language. The first occurrence of any term used to decide, and that was nearly
 * always "the" or "of" in the first line.
 */
function snippet(text: string, query: string): string {
  const lower = text.toLowerCase();
  const weights = new Map<string, number>();
  for (const term of query.match(/[\p{L}\p{N}_]+/gu) ?? []) {
    const identifier = /[\d_]/.test(term) || (term.length > 1 && term === term.toUpperCase());
    weights.set(term.toLowerCase(), term.length * (identifier ? 2 : 1));
  }
  const found: { term: string; at: number }[] = [];
  for (const term of weights.keys())
    for (let at = lower.indexOf(term), n = 0; at >= 0 && n < 50; at = lower.indexOf(term, at + 1), n++)
      found.push({ term, at });
  let at = 0;
  let best = 0;
  for (const candidate of found) {
    const start = Math.max(0, candidate.at - SNIPPET_LEAD);
    const inside = new Set<string>();
    for (const other of found)
      if (other.at >= start && other.at + other.term.length <= start + SNIPPET_CHARS) inside.add(other.term);
    let score = 0;
    for (const term of inside) score += weights.get(term) ?? 0;
    if (score > best || (score === best && start < at)) {
      best = score;
      at = start;
    }
  }
  let value = text.slice(at, at + SNIPPET_CHARS);
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
  documentIds: readonly number[] | undefined,
  epoch: string,
  assertCurrent: () => void,
) {
  const { db, embeddings, root, pathGlob, query, signal } = options;
  const port = embeddings?.();
  if (!port) throw new SemanticUnavailable();
  const key = `${epoch}:${port.modelId}:${pathGlob ?? ""}`;
  const loadVectors = (): VectorRow[] => {
    assertCurrent();
    const rows = db
      .prepare(`SELECT e.chunk_id AS id,e.vector FROM embeddings e JOIN chunks c ON c.id=e.chunk_id
        JOIN documents d ON d.id=c.doc_id WHERE e.model_id=? AND d.status='indexed'
        ${documentIds ? "AND c.doc_id IN (SELECT value FROM json_each(?))" : ""} ORDER BY e.chunk_id`)
      .all(port.modelId, ...(documentIds ? [JSON.stringify(documentIds)] : [])) as {
      id: number;
      vector: Buffer;
    }[];
    if (!rows.length) throw new SemanticUnavailable();
    return rows.map((row) => ({ id: row.id, vector: new Float32Array(new Uint8Array(row.vector).buffer) }));
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

async function rankWithinBudget(
  options: SearchOptions,
  documentIds: readonly number[] | undefined,
  epoch: string,
  assertCurrent: () => void,
  deadline: number,
) {
  const remaining = deadline - performance.now();
  if (remaining <= 0) return null;
  const budget = new AbortController();
  const signal = AbortSignal.any([options.signal, budget.signal]);
  const timer = setTimeout(() => budget.abort(), remaining);
  try {
    const hits = await semanticRank({ ...options, signal }, documentIds, epoch, assertCurrent);
    return performance.now() < deadline ? hits : null;
  } catch (error) {
    options.signal.throwIfAborted();
    if (budget.signal.aborted) return null;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function attemptSearch(
  options: SearchOptions,
  forcedFallback: FallbackReason | undefined,
  deadline: number | undefined,
): Promise<DocumentSearchResponse> {
  const { db, query, pathGlob, acceptPath, signal, phase } = options;
  const initialPhase = phase?.();
  const initialCoverage = coverage(initialPhase);
  const indexed = `FROM documents d WHERE d.status='indexed'
    AND EXISTS (SELECT 1 FROM chunks c WHERE c.doc_id=d.id)`;
  let documentIds: number[] | undefined;
  if (acceptPath) {
    const documents = db.prepare(`SELECT d.id,d.path ${indexed}`).all() as Pick<Row, "id" | "path">[];
    documentIds = documents.filter((doc) => acceptPath(doc.path)).map((doc) => doc.id);
    if (!documentIds.length) return emptyIndex(documents.length > 0, initialCoverage, pathGlob);
  } else if (!db.prepare(`SELECT 1 ${indexed} LIMIT 1`).get())
    return emptyIndex(false, initialCoverage, pathGlob);

  let fallback =
    options.mode !== "keyword" && rebuildingEmbeddings(db) ? "embedding-rebuild" : forcedFallback;
  let mode = fallback ? "keyword" : options.mode;
  const semanticEpoch = mode === "keyword" ? undefined : embeddingEpoch(db);
  const keywordRevision = mode === "semantic" ? undefined : keywordEpoch(db);
  const started = semanticEpoch === undefined ? undefined : performance.now();
  const assertCurrent = () => {
    signal.throwIfAborted();
    if (mode === "keyword") {
      if (keywordEpoch(db) === keywordRevision) return;
      throw new SearchRevisionChanged(fallback);
    }
    if (embeddingEpoch(db) === semanticEpoch) return;
    // A semantic retry at a new revision may reload the entire vector cache.
    const preferKeyword =
      started !== undefined &&
      performance.now() - started >= SEMANTIC_RETRY_BUDGET_MS &&
      (publishing(initialPhase) || publishing(phase?.()));
    throw new SearchRevisionChanged(preferKeyword ? "revision-conflict" : undefined);
  };
  const lexical = mode === "semantic" ? [] : new KeywordSearch(db).search(query, documentIds);
  let semantic =
    semanticEpoch === undefined
      ? []
      : deadline === undefined
        ? await semanticRank(options, documentIds, semanticEpoch, assertCurrent)
        : await rankWithinBudget(options, documentIds, semanticEpoch, assertCurrent, deadline);
  if (semantic === null) {
    fallback = "semantic-budget";
    mode = "keyword";
    semantic = [];
  }
  assertCurrent();
  const ranked =
    mode === "hybrid"
      ? fuseRanks([lexical.map((row) => row.id), semantic.map((row) => row.id)])
      : mode === "semantic"
        ? semantic
        : lexical.map((row) => ({ id: row.id, score: -row.bm25 }));
  const passage =
    db.prepare(`SELECT c.id,d.path,c.text,c.locator_json AS locatorJson,d.bytes,d.mtime FROM chunks c
      JOIN documents d ON d.id=c.doc_id WHERE c.id=? AND d.status='indexed'`);
  // A model-only rechunk does not invalidate an already captured lexical candidate.
  const candidates = ranked.map(({ id, score }) => {
    const row = passage.get(id) as Row | undefined;
    return { score, row: row && (!acceptPath || acceptPath(row.path)) ? row : undefined };
  });
  const { results, sourceChanged } = await validateCandidates(options, candidates);
  assertCurrent();
  const finalCoverage = coverage(phase?.());
  const message = [
    fallback && fallbackMessages[fallback],
    sourceChanged &&
      "Some sources changed or disappeared since indexing. Results omit their indexed fragments.",
  ]
    .filter(Boolean)
    .join(" ");
  return {
    results,
    coverage: sourceChanged
      ? "partial"
      : initialCoverage === "unknown" || finalCoverage === "unknown"
        ? "unknown"
        : initialCoverage === "partial" || finalCoverage === "partial"
          ? "partial"
          : "complete",
    usage: mode === "keyword" ? { mode, ...(fallback && { fallbackReason: fallback }) } : { mode },
    ...(message && { message }),
  };
}

async function validateCandidates(
  { root, query, signal, excludedRoots, k, createHitValidator }: SearchOptions,
  candidates: { score: number; row: Row | undefined }[],
): Promise<{ results: SearchResult[]; sourceChanged: boolean }> {
  if (!candidates.length) return { results: [], sourceChanged: false };
  const guard = await PathGuard.create(root, root, "workbench", undefined, excludedRoots);
  const validateHit = createHitValidator?.();
  const results: SearchResult[] = [];
  const current = new Map<string, boolean>();
  let sourceChanged = false;
  for (const { score, row } of candidates) {
    signal.throwIfAborted();
    if (!row) continue;
    if (!current.has(row.path)) {
      let matches = false;
      try {
        const info = await lstat((await guard.resolve(row.path)).absolute);
        matches =
          info.isFile() &&
          (row.bytes === null || info.size === row.bytes) &&
          (row.mtime === null || info.mtime.toISOString() === row.mtime);
        if (!matches) sourceChanged = true;
      } catch (error) {
        if (entryDisappeared(error)) sourceChanged = true;
      }
      current.set(row.path, matches);
    }
    signal.throwIfAborted();
    if (!current.get(row.path)) continue;
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
  return { results, sourceChanged };
}

/** Search bounded coherent revisions without taking a lock across ranking and source checks. */
export async function searchPublishedDocuments(options: SearchOptions): Promise<DocumentSearchResponse> {
  const deadline = options.mode === "hybrid" ? performance.now() + HYBRID_SEMANTIC_BUDGET_MS : undefined;
  let fallback: FallbackReason | undefined;
  for (let attempt = 1; attempt <= 3; attempt++) {
    options.signal.throwIfAborted();
    try {
      return await attemptSearch(options, fallback, deadline);
    } catch (error) {
      options.signal.throwIfAborted();
      if (error instanceof SemanticUnavailable) fallback = "semantic-unavailable";
      else if (!(error instanceof SearchRevisionChanged)) throw error;
      else if (error.fallback) fallback ??= error.fallback;
      else if (attempt === 2 && options.mode !== "keyword") fallback ??= "revision-conflict";
    }
  }
  return {
    results: [],
    coverage: "unknown",
    usage: { mode: null, reason: "revision-conflict" },
    message: "The document index is changing. Retry the search or use grep.",
  };
}
