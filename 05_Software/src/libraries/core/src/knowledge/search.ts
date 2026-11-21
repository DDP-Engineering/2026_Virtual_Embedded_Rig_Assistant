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
import type { EmbeddingPort } from "./embedding.js";
import { extractionSchema } from "./extraction.js";
import type { DocumentIndexPhase } from "./ingest.js";
import { verifyDocumentSource } from "./processor.js";
import {
  type DocumentSearchResponse,
  type SearchHitValidator,
  searchPublishedDocuments,
} from "./search-ranking.js";

export {
  type DocumentSearchResponse,
  documentRef,
  fuseRanks,
  type SearchResult,
} from "./search-ranking.js";

// Field descriptions steer models that otherwise fill every optional argument with a guess.
export const searchDocsSchema = z
  .object({
    query: z
      .string()
      .trim()
      .min(1)
      .max(1000)
      .describe("What to look for. A multilingual model can also match passages in other languages."),
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
        "Part of a long section, page or line, from 1, as a previous read's parts reports. Omit for part 1.",
      ),
  })
  .strict();
export type SearchArgs = z.input<typeof searchDocsSchema>;
export type ReadDocArgs = z.input<typeof readDocSchema>;
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
/** Read-only persisted search and full-extraction reads over one owned workbench connection. */
export class DocumentKnowledge {
  constructor(
    private readonly root: string,
    private readonly db: Database.Database,
    private readonly embeddings?: () => EmbeddingPort | undefined,
    private readonly defaults: () => WorkbenchRetrieval | undefined = () => undefined,
    private readonly phase?: () => DocumentIndexPhase,
  ) {}

  async search(
    raw: SearchArgs,
    signal: AbortSignal,
    excludedRoots: readonly string[] = [],
    createHitValidator?: () => SearchHitValidator,
  ): Promise<DocumentSearchResponse> {
    signal.throwIfAborted();
    const parsed = searchDocsSchema.parse(raw);
    const configured = this.defaults();
    if (parsed.pathGlob) validateGlob(parsed.pathGlob);
    return searchPublishedDocuments({
      root: this.root,
      db: this.db,
      query: parsed.query,
      k: parsed.k ?? configured?.results ?? 8,
      mode: parsed.mode ?? configured?.mode ?? "hybrid",
      pathGlob: parsed.pathGlob,
      acceptPath: parsed.pathGlob ? picomatch(parsed.pathGlob, { dot: true, posix: true }) : undefined,
      signal,
      excludedRoots,
      embeddings: this.embeddings,
      phase: this.phase,
      createHitValidator,
    });
  }

  async read(
    raw: ReadDocArgs,
    signal: AbortSignal,
    excludedRoots: readonly string[] = [],
  ): Promise<Record<string, unknown>> {
    const args = readDocSchema.parse(raw);
    const guard = await PathGuard.create(this.root, this.root, "workbench", undefined, excludedRoots),
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
    await guard.resolve(args.path);
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
                  ["heading"],
                ];
      const extra = (["page", "pageEnd", "heading", "lineStart", "lineEnd"] as const).filter(
        (name) => args[name] !== undefined && !keep.includes(name),
      );
      throw Error(
        `Use one locator family. ${target.relative} is ${label} read by ${family}; remove ${extra.join(", ")}.`,
      );
    }
    const bounded = (units: string[], separator: string) => {
      let text = "",
        count = 0;
      for (const unit of units) {
        const candidate = text + (count ? separator : "") + unit;
        if (!fits(candidate)) break;
        text += (count ? separator : "") + unit;
        count++;
      }
      return { text, count, truncated: count < units.length };
    };
    // A long section, or one page, slide or line over the read budget, is read in parts.
    const inParts = (text: string, unit: string) => {
      const parts = sectionParts(text);
      const part = args.part ?? 1;
      if (part < 1 || part > parts.length)
        throw Error(`Part ${part} is outside this ${unit}'s parts 1-${parts.length}.`);
      return { text: parts[part - 1], truncated: part < parts.length, part, parts: parts.length };
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
      const first = units[start - 1] ?? "";
      if (args.part !== undefined || !fits(first)) {
        // Parts cover the first page of the range only; the ref names that page.
        const result = inParts(first, extraction.kind === "pdf" ? "page" : "slide");
        return {
          path,
          ...result,
          truncated: result.truncated || end > start,
          ref: formatRef({ kind: "page", path, page: start }),
        };
      }
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
      const first = extraction.lines[start - 1] ?? "";
      if (args.part !== undefined || !fits(first)) {
        const result = inParts(first, "line");
        return {
          path,
          ...result,
          truncated: result.truncated || end > start,
          ref: formatRef({ kind: "lines", path, start, end: start }),
        };
      }
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
    // Every part cites the whole section.
    return {
      path,
      ...inParts(section.text, "section"),
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
  /**
   * Issuance is checked by citations; validate current source and extraction bounds without output caps.
   * `verified` holds the source checks of one finished message, so the citations into one file read
   * and hash it once instead of once each.
   */
  async validDocumentRef(ref: string, verified?: Map<string, Promise<void>>): Promise<boolean> {
    const parsed = parseRef(ref);
    if (!parsed || parsed.kind === "artifact" || parsed.kind === "lines" || parsed.kind === "help")
      return false;
    try {
      const target = await (await PathGuard.create(this.root)).resolve(parsed.path);
      const doc = new DocumentsRepository(this.db).get(target.relative);
      if (doc?.status !== "indexed" || !doc.sha256 || doc.kind === "other") return false;
      if (!isDocumentKindIn(doc.kind, parsed.kind === "heading" ? sectionDocumentKinds : pagedDocumentKinds))
        return false;
      // Markdown preambles are cited by line range, never as the untitled `#h=` section.
      if (parsed.kind === "heading" && !parsed.slug && doc.kind === "markdown") return false;
      const key = `${doc.kind}\n${doc.sha256}\n${parsed.path}`;
      let source = verified?.get(key);
      if (!source) {
        // Only the outcome is kept, not the file's bytes.
        source = verifyDocumentSource({
          root: this.root,
          path: parsed.path,
          kind: doc.kind,
          sha256: doc.sha256,
          signal: new AbortController().signal,
          assertWritable: () => {},
        }).then(() => {});
        verified?.set(key, source);
      }
      await source;
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
