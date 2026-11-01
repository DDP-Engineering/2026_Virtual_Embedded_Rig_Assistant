import { lstat } from "node:fs/promises";
import {
  formatRef,
  isDocumentKindIn,
  pagedDocumentKinds,
  parseRef,
  sectionDocumentKinds,
  type WorkbenchRetrieval,
} from "@vera/shared";
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

// Field descriptions steer models that otherwise fill every optional argument with a guess.
export const searchDocsSchema = z
  .object({
    query: z.string().trim().min(1).max(1000).describe("What to look for, in the documents' language."),
    // Omitted k or mode follow the workbench retrieval settings (8 results, hybrid by default).
    k: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Number of results, 1-20. Omit to use the workbench setting."),
    mode: z
      .enum(["hybrid", "keyword", "semantic"])
      .optional()
      .describe("Ranking mode. Omit to use the workbench setting."),
    pathGlob: z
      .string()
      .min(1)
      .max(500)
      .optional()
      .describe(
        'Only to restrict the search to some files: a glob relative to the workbench root, such as "docs/**/*.pdf". Omit to search every indexed document.',
      ),
  })
  .strict();
export const readDocSchema = z
  .object({
    path: z
      .string()
      .min(1)
      .max(1000)
      .describe("Indexed document path relative to the workbench, as search_docs returns it."),
    page: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(
        "First PDF page or presentation slide, from 1. Only for PDF and presentation files; omit otherwise.",
      ),
    pageEnd: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Last page or slide of a range. Only with page; omit otherwise."),
    heading: z
      .string()
      .max(500)
      .optional()
      .describe(
        'Section slug from a search_docs ref (path#h=slug); "" is the text before the first heading. Only for Markdown, HTML, Word/OpenDocument text and spreadsheets; omit otherwise.',
      ),
    lineStart: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("First line, from 1. Only for plain-text files; omit otherwise."),
    lineEnd: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Last line. Only with lineStart; omit otherwise."),
    part: z
      .number()
      .int()
      .optional()
      .describe(
        "Part of a long heading section, from 1, as a previous read's parts reports. Omit for the first part.",
      ),
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
  // Only Markdown sections carry line ranges, so its untitled preamble stays a line citation;
  // other section kinds cite their untitled leading section with an empty slug.
  return !locator.slug && locator.start && locator.end
    ? formatRef({ kind: "lines", path, start: locator.start, end: locator.end })
    : formatRef({ kind: "heading", path, slug: locator.slug });
}
const READ_CHARS = 12000;
const READ_JSON = 28000;
const fits = (text: string) => text.length <= READ_CHARS && JSON.stringify({ text }).length <= READ_JSON;
/** Whether the line starting at `from`, with its newline, fits a part by itself. */
function lineFits(text: string, from: number): boolean {
  const window = text.slice(from, from + READ_CHARS + 1);
  const newline = window.indexOf("\n");
  if (newline === -1) return from + window.length === text.length && fits(window);
  return fits(window.slice(0, newline + 1));
}
/**
 * Consecutive substrings of a section, each within the read budget, that concatenate to the
 * section. A part ends after its last fitting newline unless the next line cannot fit a part by
 * itself; only such an over-budget line is cut, at the largest fitting length and never inside a
 * surrogate pair, so a heading line stays with the start of its long paragraph.
 */
export function sectionParts(text: string): string[] {
  if (!text) return [""];
  const parts: string[] = [];
  for (let start = 0; start < text.length; ) {
    let low = start + 1,
      high = Math.min(text.length, start + READ_CHARS);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(text.slice(start, middle))) low = middle;
      else high = middle - 1;
    }
    let end = low;
    if (end < text.length) {
      // Search only this window, so a long section without newlines stays linear.
      const newline = text.slice(start, end).lastIndexOf("\n");
      if (newline >= 0 && lineFits(text, start + newline + 1)) end = start + newline + 1;
      else if (/[\uD800-\uDBFF]/.test(text[end - 1] ?? "") && end - 1 > start) end--;
    }
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts;
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
    private readonly defaults: () => WorkbenchRetrieval | undefined = () => undefined,
  ) {}
  private epoch(): string {
    const epoch = this.db.prepare("SELECT value FROM meta WHERE key='embedding_epoch'").pluck().get();
    if (typeof epoch !== "string") throw Error("Missing current embedding epoch.");
    return epoch;
  }
  async search(raw: SearchArgs, signal: AbortSignal): Promise<{ results: SearchResult[]; message?: string }> {
    const parsed = searchDocsSchema.parse(raw);
    const configured = this.defaults();
    const args = {
      ...parsed,
      k: parsed.k ?? configured?.results ?? 8,
      mode: parsed.mode ?? configured?.mode ?? "hybrid",
    };
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
    // Chunks exist but none passed the glob: say so, since models often pass "*" meaning "everything".
    if (!rows.length)
      return args.pathGlob
        ? {
            results: [],
            message: `No indexed document matched pathGlob "${args.pathGlob}". Globs are relative to the workbench root, so "*" matches only top-level files; use a pattern such as "docs/**", or omit pathGlob to search every document.`,
          }
        : { results: [] };
    const epoch = this.epoch();
    const lexical =
      args.mode === "semantic"
        ? []
        : new KeywordSearch(this.db).search(args.query, args.pathGlob ? accept : undefined);
    let semantic: { id: number; score: number }[] = [];
    let fallback = false;
    if (args.mode !== "keyword") {
      if (!this.embeddings) throw Error("Semantic index unavailable. Index documents or use keyword/grep.");
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
      try {
        semantic = await this.embeddings.rank(this.root, key, loadVectors, args.query, signal);
      } catch (error) {
        // The desktop indexer may be stopped or restarting: keyword results stay available.
        if ((error as { retry?: unknown } | null)?.retry !== true) throw error;
        fallback = true;
      }
    }
    const keyword =
      fallback && args.mode === "semantic"
        ? new KeywordSearch(this.db).search(args.query, args.pathGlob ? accept : undefined)
        : lexical;
    signal.throwIfAborted();
    if (this.epoch() !== epoch) throw Error("Document index changed during search. Retry.");
    const ranked = fallback
      ? keyword.map((r) => ({ id: r.id, score: -r.bm25 }))
      : args.mode === "semantic"
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
    return fallback
      ? {
          results,
          message:
            "Semantic ranking is unavailable while document indexing is stopped or restarting; these are keyword results.",
        }
      : { results };
  }
  async read(raw: ReadDocArgs, signal: AbortSignal): Promise<Record<string, unknown>> {
    const args = readDocSchema.parse(raw);
    const guard = await PathGuard.create(this.root),
      target = await guard.resolve(args.path);
    const doc = new DocumentsRepository(this.db).get(target.relative);
    if (doc?.status !== "indexed" || !doc.sha256 || doc.kind === "other")
      throw Error("Document not indexed. Use grep/read or index documents.");
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
    if (Number(pages) + Number(lines) + Number(heading) > 1) {
      // Each kind has exactly one locator family, so name it and the arguments to drop.
      const [label, family, keep] =
        extraction.kind === "pdf"
          ? ["a PDF", "page", ["page", "pageEnd"]]
          : extraction.kind === "presentation"
            ? ["a presentation", "slide page", ["page", "pageEnd"]]
            : extraction.kind === "text"
              ? ["a text file", "lineStart and lineEnd", ["lineStart", "lineEnd"]]
              : [
                  `a ${extraction.kind === "html" ? "HTML" : extraction.kind}`,
                  'heading ("" for text before the first heading)',
                  ["heading", "part"],
                ];
      const extra = (["page", "pageEnd", "heading", "lineStart", "lineEnd", "part"] as const).filter(
        (name) => args[name] !== undefined && !keep.includes(name),
      );
      throw Error(
        `Use one locator family. ${target.relative} is ${label} read by ${family}; remove ${extra.join(", ")}.`,
      );
    }
    const sectioned = "sections" in extraction;
    if (args.part !== undefined && (pages || lines || !sectioned))
      throw Error(
        'part applies only to heading reads of Markdown, HTML, document and spreadsheet sources; pass heading ("" for the start) without page or line arguments.',
      );
    const bounded = (units: string[], separator: string) => {
      let text = "",
        count = 0;
      for (const unit of units) {
        const candidate = text + (count ? separator : "") + unit;
        if (!fits(candidate)) break;
        text += (count ? separator : "") + unit;
        count++;
      }
      if (!count) throw Error("A locator unit exceeds12000 characters. Use a narrower source section.");
      return { text, count, truncated: count < units.length };
    };
    const path = target.relative;
    if (extraction.kind === "pdf" || extraction.kind === "presentation") {
      // Presentation slides use the page locator family, numbered from 1 in deck order.
      const units = extraction.kind === "pdf" ? extraction.pages : extraction.slides;
      if (lines || heading || (args.pageEnd !== undefined && args.page === undefined))
        throw Error("PDF and presentation reads require page and optional pageEnd.");
      const start = args.page ?? 1,
        end = args.pageEnd ?? start;
      if (end < start || end > units.length) throw Error("Page or slide range is outside the document.");
      const result = bounded(units.slice(start - 1, end), "\n\n");
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
    if (pages || lines) throw Error("Markdown, HTML, document and spreadsheet reads require a heading slug.");
    const section =
      args.heading === undefined
        ? extraction.sections[0]
        : extraction.sections.find((s) => s.slug === args.heading);
    if (!section) throw Error("Heading not found. Use a heading slug from search_docs.");
    // Long sections are read in parts; every part cites the whole section.
    const parts = sectionParts(section.text);
    const part = args.part ?? 1;
    if (part < 1 || part > parts.length)
      throw Error(`Part ${part} is outside this section's parts 1-${parts.length}.`);
    return {
      path,
      text: parts[part - 1],
      truncated: part < parts.length,
      part,
      parts: parts.length,
      ref:
        !section.slug && extraction.kind === "markdown"
          ? formatRef({ kind: "lines", path, start: section.start, end: section.end })
          : formatRef({ kind: "heading", path, slug: section.slug }),
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
      if (!isDocumentKindIn(doc.kind, parsed.kind === "heading" ? sectionDocumentKinds : pagedDocumentKinds))
        return false;
      // Markdown preambles are cited by line range, never as the untitled `#h=` section.
      if (parsed.kind === "heading" && !parsed.slug && doc.kind === "markdown") return false;
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
        return "sections" in extraction && extraction.sections.some((s) => s.slug === parsed.slug);
      const end = parsed.kind === "page" ? parsed.page : parsed.end;
      const units =
        extraction.kind === "pdf"
          ? extraction.pages
          : extraction.kind === "presentation"
            ? extraction.slides
            : undefined;
      return !!units && current.pages === units.length && end <= units.length;
    } catch {
      return false;
    }
  }
}
