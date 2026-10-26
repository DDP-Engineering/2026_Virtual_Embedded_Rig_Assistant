import { lstat } from "node:fs/promises";
import { formatRef, parseRef } from "@vera/shared";
import type Database from "better-sqlite3";
import picomatch from "picomatch";
import { z } from "zod";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { validateGlob } from "../tools/discovery.js";
import { PathGuard } from "../workbench/path-guard.js";
import { type Chunk, locatorSchema } from "./chunk.js";
import type { EmbeddingPort, VectorRow } from "./embedding.js";
import { extractionSchema } from "./extraction.js";
import { KeywordSearch } from "./keyword.js";
import { verifyDocumentSource } from "./processor.js";

export const searchDocsSchema = z
  .object({
    query: z.string().trim().min(1).max(1000),
    k: z.number().int().min(1).max(20).default(8),
    mode: z.enum(["hybrid", "keyword", "semantic"]).default("hybrid"),
    pathGlob: z.string().min(1).max(500).optional(),
  })
  .strict();
export const readDocSchema = z
  .object({
    path: z.string().min(1).max(1000),
    page: z.number().int().positive().optional(),
    pageEnd: z.number().int().positive().optional(),
    heading: z.string().max(500).optional(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
  })
  .strict();
export type SearchArgs = z.input<typeof searchDocsSchema>;
export type ReadDocArgs = z.input<typeof readDocSchema>;
export interface SearchResult {
  ref: string;
  path: string;
  locator: Chunk["locator"];
  snippet: string;
  score: number;
}
interface Row {
  id: number;
  path: string;
  text: string;
  locatorJson: string;
}
export function documentRef(path: string, locator: Chunk["locator"]): string {
  if (locator.type === "page") return formatRef({ kind: "page", path, page: locator.page });
  if (locator.type === "lines")
    return formatRef({ kind: "lines", path, start: locator.start, end: locator.end });
  return locator.slug
    ? formatRef({ kind: "heading", path, slug: locator.slug })
    : locator.start && locator.end
      ? formatRef({ kind: "lines", path, start: locator.start, end: locator.end })
      : path;
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
    .map((t) => lower.indexOf(t.toLowerCase()))
    .filter((at) => at >= 0);
  const at = Math.max(0, (offsets.length ? Math.min(...offsets) : 0) - 80);
  let value = text.slice(at, at + 300);
  if (/[\uD800-\uDBFF]$/.test(value)) value = value.slice(0, -1);
  return value;
}

/** Read-only persisted search and full-extraction reads over one owned workbench connection. */
export class DocumentKnowledge {
  constructor(
    private readonly root: string,
    private readonly db: Database.Database,
    private readonly embeddings?: EmbeddingPort,
  ) {}
  private epoch(): string {
    return String(
      this.db.prepare("SELECT value FROM meta WHERE key='embedding_epoch'").pluck().get() ?? "legacy",
    );
  }
  async search(raw: SearchArgs, signal: AbortSignal): Promise<{ results: SearchResult[]; message?: string }> {
    const args = searchDocsSchema.parse(raw);
    signal.throwIfAborted();
    if (args.pathGlob) validateGlob(args.pathGlob);
    const accept = args.pathGlob ? picomatch(args.pathGlob, { dot: true, posix: true }) : () => true;
    const rows = (
      this.db
        .prepare(`SELECT c.id,d.path FROM chunks c
      JOIN documents d ON d.id=c.doc_id WHERE d.status='indexed' ORDER BY c.id`)
        .all() as Pick<Row, "id" | "path">[]
    ).filter((r) => accept(r.path));
    if (!this.db.prepare("SELECT 1 FROM chunks LIMIT 1").get())
      return { results: [], message: "No documents indexed yet. Use grep to search text files." };
    if (!rows.length) return { results: [] };
    const epoch = this.epoch();
    const lexical =
      args.mode === "semantic"
        ? []
        : new KeywordSearch(this.db).search(args.query, args.pathGlob ? accept : undefined);
    let semantic: { id: number; score: number }[] = [];
    if (args.mode !== "keyword") {
      if (!this.embeddings || epoch === "legacy")
        throw Error("Semantic index unavailable. Index documents or use keyword/grep.");
      const key = `${epoch}:${this.embeddings.modelId}:${args.pathGlob ?? ""}`;
      const modelId = this.embeddings.modelId;
      const loadVectors = (): VectorRow[] => {
        if (this.epoch() !== epoch) throw Error("Document index changed while search was queued. Retry.");
        const eligible = new Set(rows.map((r) => r.id));
        const vectors = (
          this.db
            .prepare("SELECT chunk_id AS id,vector FROM embeddings WHERE model_id=? ORDER BY chunk_id")
            .all(modelId) as { id: number; vector: Buffer }[]
        )
          .filter((r) => eligible.has(r.id))
          .map((r) => {
            const buffer = new Uint8Array(r.vector).buffer;
            return { id: r.id, vector: new Float32Array(buffer) };
          });
        if (!vectors.length)
          throw Error("Current model vectors unavailable. Reindex documents or use keyword/grep.");
        return vectors;
      };
      semantic = await this.embeddings.rank(this.root, key, loadVectors, args.query, signal);
    }
    signal.throwIfAborted();
    if (this.epoch() !== epoch) throw Error("Document index changed during search. Retry.");
    const ranked =
      args.mode === "semantic"
        ? semantic
        : args.mode === "keyword"
          ? lexical.map((r) => ({ id: r.id, score: -r.bm25 }))
          : fuseRanks([lexical.map((r) => r.id), semantic.map((r) => r.id)]);
    const byId = new Map(rows.map((r) => [r.id, r]));
    const guard = await PathGuard.create(this.root);
    const results: SearchResult[] = [];
    for (const hit of ranked) {
      signal.throwIfAborted();
      if (!byId.has(hit.id)) continue;
      const row = this.db
        .prepare(`SELECT c.id,d.path,c.text,c.locator_json AS locatorJson FROM chunks c
        JOIN documents d ON d.id=c.doc_id WHERE c.id=?`)
        .get(hit.id) as Row | undefined;
      if (!row) continue;
      try {
        if (!(await lstat((await guard.resolve(row.path)).absolute)).isFile()) continue;
      } catch {
        continue;
      }
      const locator = locatorSchema.parse(JSON.parse(row.locatorJson));
      results.push({
        ref: documentRef(row.path, locator),
        path: row.path,
        locator,
        snippet: snippet(row.text, args.query),
        score: hit.score,
      });
      if (results.length === args.k) break;
    }
    if (this.epoch() !== epoch) throw Error("Document index changed during search. Retry.");
    return { results };
  }
  async read(raw: ReadDocArgs, signal: AbortSignal): Promise<Record<string, unknown>> {
    const args = readDocSchema.parse(raw);
    const guard = await PathGuard.create(this.root),
      target = await guard.resolve(args.path);
    const doc = new DocumentsRepository(this.db).get(target.relative);
    if (doc?.status !== "indexed" || !doc.sha256 || doc.kind === "other")
      throw Error("Document not indexed. Use grep/read or index documents.");
    if (!this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='document_extractions'").get())
      throw Error("Full extraction unavailable. Reindex documents.");
    const stored = this.db
      .prepare("SELECT extraction_json FROM document_extractions WHERE doc_id=?")
      .pluck()
      .get(doc.id);
    if (typeof stored !== "string") throw Error("Full extraction unavailable. Reindex documents.");
    await verifyDocumentSource({
      root: this.root,
      path: target.relative,
      kind: doc.kind,
      sha256: doc.sha256,
      signal,
      assertWritable: () => {},
    });
    const extraction = extractionSchema.parse(JSON.parse(stored));
    const pages = args.page !== undefined || args.pageEnd !== undefined;
    const lines = args.lineStart !== undefined || args.lineEnd !== undefined;
    const heading = args.heading !== undefined;
    if (Number(pages) + Number(lines) + Number(heading) > 1)
      throw Error("Use one locator family: pages, heading, or lines.");
    const bounded = (units: string[], separator: string) => {
      let text = "",
        count = 0;
      for (const unit of units) {
        const candidate = text + (count ? separator : "") + unit;
        if (candidate.length > 12000 || JSON.stringify({ text: candidate }).length > 28000) break;
        text += (count ? separator : "") + unit;
        count++;
      }
      if (!count) throw Error("A locator unit exceeds12000 characters. Use a narrower source section.");
      return { text, count, truncated: count < units.length };
    };
    const path = target.relative;
    if (extraction.kind === "pdf") {
      if (lines || heading || (args.pageEnd !== undefined && args.page === undefined))
        throw Error("PDF reads require page and optional pageEnd.");
      const start = args.page ?? 1,
        end = args.pageEnd ?? start;
      if (end < start || end > extraction.pages.length)
        throw Error("PDF page range is outside the document.");
      const result = bounded(extraction.pages.slice(start - 1, end), "\n\n");
      const actualEnd = start + result.count - 1;
      return {
        path,
        text: result.text,
        truncated: result.truncated,
        ref: formatRef(
          actualEnd === start
            ? { kind: "page", path, page: start }
            : { kind: "page-range", path, start, end: actualEnd },
        ),
      };
    }
    if (extraction.kind === "text") {
      if (pages || heading || (args.lineEnd !== undefined && args.lineStart === undefined))
        throw Error("Text reads require lineStart and optional lineEnd.");
      const start = args.lineStart ?? 1,
        end = args.lineEnd ?? extraction.lines.length;
      if (end < start || end > extraction.lines.length) throw Error("Line range is outside the document.");
      const result = bounded(extraction.lines.slice(start - 1, end), "\n");
      return {
        path,
        text: result.text,
        truncated: result.truncated,
        ref: formatRef({ kind: "lines", path, start, end: start + result.count - 1 }),
      };
    }
    if (pages || lines) throw Error("Markdown/HTML reads require a heading slug.");
    const section =
      args.heading === undefined
        ? extraction.sections[0]
        : extraction.sections.find((s) => s.slug === args.heading);
    if (!section) throw Error("Heading not found. Use a heading slug from search_docs.");
    if (section.text.length > 12000 || JSON.stringify({ text: section.text }).length > 28000)
      throw Error("Heading exceeds output budget. Choose a smaller source section.");
    return {
      path,
      text: section.text,
      truncated: false,
      ref: section.slug
        ? formatRef({ kind: "heading", path, slug: section.slug })
        : extraction.kind === "markdown"
          ? formatRef({ kind: "lines", path, start: section.start, end: section.end })
          : path,
    };
  }
  async validPdfRef(ref: string): Promise<boolean> {
    const parsed = parseRef(ref);
    return !!parsed && (parsed.kind === "page" || parsed.kind === "page-range") && this.validDocumentRef(ref);
  }
  /** Issuance is checked by citations; validate current source and extraction bounds without output caps. */
  async validDocumentRef(ref: string): Promise<boolean> {
    const parsed = parseRef(ref);
    if (!parsed || parsed.kind === "artifact" || parsed.kind === "lines") return false;
    try {
      const target = await (await PathGuard.create(this.root)).resolve(parsed.path);
      const doc = new DocumentsRepository(this.db).get(target.relative);
      if (doc?.status !== "indexed" || !doc.sha256 || doc.kind === "other") return false;
      if (parsed.kind === "heading" ? doc.kind !== "markdown" && doc.kind !== "html" : doc.kind !== "pdf")
        return false;
      await verifyDocumentSource({
        root: this.root,
        path: parsed.path,
        kind: doc.kind,
        sha256: doc.sha256,
        signal: new AbortController().signal,
        assertWritable: () => {},
      });
      const current = new DocumentsRepository(this.db).get(target.relative);
      if (
        current?.id !== doc.id ||
        current.sha256 !== doc.sha256 ||
        current.kind !== doc.kind ||
        current.status !== "indexed"
      )
        return false;
      const stored = this.db
        .prepare("SELECT extraction_json FROM document_extractions WHERE doc_id=?")
        .pluck()
        .get(doc.id);
      if (typeof stored !== "string") return false;
      const extraction = extractionSchema.parse(JSON.parse(stored));
      if (extraction.kind !== current.kind) return false;
      if (parsed.kind === "heading")
        return (
          (extraction.kind === "markdown" || extraction.kind === "html") &&
          extraction.sections.some((s) => s.slug === parsed.slug)
        );
      const end = parsed.kind === "page" ? parsed.page : parsed.end;
      return (
        extraction.kind === "pdf" &&
        current.pages === extraction.pages.length &&
        end <= extraction.pages.length
      );
    } catch {
      return false;
    }
  }
}
