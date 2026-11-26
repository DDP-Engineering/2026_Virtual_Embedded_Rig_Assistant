import {
  advancedSettings,
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
type CitationBounds = { pages: number } | { markdown: boolean; slugs: ReadonlySet<string> };
/** Verified locator bounds shared by the citations in one finished message. */
export type DocumentCitationCache = Map<string, Promise<CitationBounds | undefined>>;
const READ_CHARS = 12000;
const READ_JSON = 28000;
const fits = (text: string, jsonChars: number) =>
  text.length <= READ_CHARS && JSON.stringify({ text }).length <= jsonChars;
/** Whether the line starting at `from`, with its newline, fits a part by itself. */
function lineFits(text: string, from: number, jsonChars: number): boolean {
  const window = text.slice(from, from + READ_CHARS + 1);
  const newline = window.indexOf("\n");
  if (newline === -1) return from + window.length === text.length && fits(window, jsonChars);
  return fits(window.slice(0, newline + 1), jsonChars);
}
/**
 * Consecutive substrings of a section, each within the read budget, that concatenate to the
 * section. A part ends after its last fitting newline unless the next line cannot fit a part by
 * itself; only such an over-budget line is cut, at the largest fitting length and never inside a
 * surrogate pair, so a heading line stays with the start of its long paragraph.
 */
export function sectionParts(text: string, jsonChars = READ_JSON): string[] {
  if (!text) return [""];
  const parts: string[] = [];
  for (let start = 0; start < text.length; ) {
    let low = start + 1,
      high = Math.min(text.length, start + READ_CHARS);
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (fits(text.slice(start, middle), jsonChars)) low = middle;
      else high = middle - 1;
    }
    let end = low;
    if (end < text.length) {
      // Search only this window, so a long section without newlines stays linear.
      const newline = text.slice(start, end).lastIndexOf("\n");
      if (newline >= 0 && lineFits(text, start + newline + 1, jsonChars)) end = start + newline + 1;
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
    panelK?: number,
  ): Promise<DocumentSearchResponse> {
    signal.throwIfAborted();
    const parsed = searchDocsSchema.parse(raw);
    const configured = this.defaults();
    if (parsed.pathGlob) validateGlob(parsed.pathGlob);
    return searchPublishedDocuments({
      root: this.root,
      db: this.db,
      query: parsed.query,
      k: panelK ?? parsed.k ?? configured?.results ?? 8,
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
    output: { limit?: number; maskText?: ((text: string) => string) | undefined } = {},
  ): Promise<Record<string, unknown>> {
    signal.throwIfAborted();
    const args = readDocSchema.parse(raw);
    const guard = await PathGuard.create(this.root, this.root, "workbench", undefined, excludedRoots),
      target = await guard.resolve(args.path);
    const doc = new DocumentsRepository(this.db).get(target.relative);
    if (doc?.status !== "indexed" || !doc.sha256 || doc.kind === "other")
      throw Error(
        "Document not indexed. For a text file use read or grep. A PDF or Office file must be indexed first: tell the user to add its folder under Edit workbench > Documents, or wait for indexing to finish.",
      );
    const stored = this.db
      .prepare("SELECT extraction_json FROM document_extractions WHERE doc_id=?")
      .pluck()
      .get(doc.id);
    if (typeof stored !== "string") throw Error("Full extraction unavailable. Reindex documents.");
    await verifyDocumentSource(
      {
        root: this.root,
        path: target.relative,
        kind: doc.kind,
        sha256: doc.sha256,
        signal,
        assertWritable: () => {},
      },
      "hash-only",
    );
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
    const path = target.relative;
    const project = output.maskText ?? ((text: string) => text);
    // Reserve the response envelope before cutting text, with the same room for every part.
    const textBudget = (ref: string) => {
      const envelope = JSON.stringify({
        path,
        ref,
        text: "",
        truncated: false,
        part: Number.MAX_SAFE_INTEGER,
        parts: Number.MAX_SAFE_INTEGER,
      });
      const limit = output.limit ?? advancedSettings.toolResultChars.default;
      const jsonChars = Math.min(
        READ_JSON,
        limit - Math.max(envelope.length, project(envelope).length) + JSON.stringify({ text: "" }).length,
      );
      if (jsonChars < JSON.stringify({ text: "\u0000\u0000" }).length)
        throw Error("The tool result limit leaves no room for text with this document reference.");
      return jsonChars;
    };
    const bounded = (units: string[], separator: string, first: string, jsonChars: number) => {
      let text = "",
        count = 0;
      for (const source of units) {
        const unit = count ? project(source) : first;
        const candidate = text + (count ? separator : "") + unit;
        if (!fits(candidate, jsonChars)) break;
        text = candidate;
        count++;
      }
      return { text, count, truncated: count < units.length };
    };
    // A long section, or one page, slide or line over the read budget, is read in parts.
    const inParts = (text: string, unit: string, jsonChars: number) => {
      const parts = sectionParts(text, jsonChars);
      const part = args.part ?? 1;
      if (part < 1 || part > parts.length)
        throw Error(`Part ${part} is outside this ${unit}'s parts 1-${parts.length}.`);
      return { text: parts[part - 1], truncated: part < parts.length, part, parts: parts.length };
    };
    if (extraction.kind === "pdf" || extraction.kind === "presentation") {
      // Presentation slides use the page locator family, numbered from 1 in deck order.
      const units = extraction.kind === "pdf" ? extraction.pages : extraction.slides;
      if (lines || heading || (args.pageEnd !== undefined && args.page === undefined))
        throw Error("PDF and presentation reads require page and optional pageEnd.");
      const start = args.page ?? 1,
        end = args.pageEnd ?? start;
      if (end < start || end > units.length) throw Error("Page or slide range is outside the document.");
      const jsonChars = textBudget(`${path}#p=${units.length}-${units.length}`);
      const first = project(units[start - 1] ?? "");
      if (args.part !== undefined || !fits(first, jsonChars)) {
        // Parts cover the first page of the range only; the ref names that page.
        const result = inParts(first, extraction.kind === "pdf" ? "page" : "slide", jsonChars);
        return {
          path,
          ...result,
          truncated: result.truncated || end > start,
          ref: formatRef({ kind: "page", path, page: start }),
        };
      }
      const result = bounded(units.slice(start - 1, end), "\n\n", first, jsonChars);
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
      const jsonChars = textBudget(`${path}#L${extraction.lines.length}-L${extraction.lines.length}`);
      const first = project(extraction.lines[start - 1] ?? "");
      if (args.part !== undefined || !fits(first, jsonChars)) {
        const result = inParts(first, "line", jsonChars);
        return {
          path,
          ...result,
          truncated: result.truncated || end > start,
          ref: formatRef({ kind: "lines", path, start, end: start }),
        };
      }
      const result = bounded(extraction.lines.slice(start - 1, end), "\n", first, jsonChars);
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
    const ref =
      !section.slug && extraction.kind === "markdown"
        ? formatRef({ kind: "lines", path, start: section.start, end: section.end })
        : formatRef({ kind: "heading", path, slug: section.slug });
    return {
      path,
      ...inParts(project(section.text), "section", textBudget(ref)),
      ref,
    };
  }
  async validPdfRef(ref: string): Promise<boolean> {
    const parsed = parseRef(ref);
    return !!parsed && (parsed.kind === "page" || parsed.kind === "page-range") && this.validDocumentRef(ref);
  }
  /** Issuance is checked by citations; validate the source and locator bounds independently of output caps. */
  async validDocumentRef(ref: string, verified?: DocumentCitationCache): Promise<boolean> {
    const parsed = parseRef(ref);
    if (
      !parsed ||
      parsed.kind === "artifact" ||
      parsed.kind === "lines" ||
      parsed.kind === "help" ||
      parsed.kind === "capture"
    )
      return false;
    try {
      let pending = verified?.get(parsed.path);
      if (!pending) {
        pending = this.citationBounds(parsed.path);
        verified?.set(parsed.path, pending);
      }
      const bounds = await pending;
      if (!bounds) return false;
      if (parsed.kind === "heading")
        return "slugs" in bounds && (!bounds.markdown || !!parsed.slug) && bounds.slugs.has(parsed.slug);
      const end = parsed.kind === "page" ? parsed.page : parsed.end;
      return "pages" in bounds && end <= bounds.pages;
    } catch {
      return false;
    }
  }

  private async citationBounds(path: string): Promise<CitationBounds | undefined> {
    const target = await (await PathGuard.create(this.root)).resolve(path);
    const rows = new DocumentsRepository(this.db);
    const doc = rows.get(target.relative);
    if (doc?.status !== "indexed" || !doc.sha256 || doc.kind === "other") return;
    if (!isDocumentKindIn(doc.kind, pagedDocumentKinds) && !isDocumentKindIn(doc.kind, sectionDocumentKinds))
      return;
    await verifyDocumentSource(
      {
        root: this.root,
        path,
        kind: doc.kind,
        sha256: doc.sha256,
        signal: new AbortController().signal,
        assertWritable: () => {},
      },
      "hash-only",
    );
    const current = rows.get(target.relative);
    if (
      current?.id !== doc.id ||
      current.sha256 !== doc.sha256 ||
      current.kind !== doc.kind ||
      current.status !== "indexed"
    )
      return;
    const extraction = rows.extraction(doc.id);
    if (extraction?.kind !== current.kind) return;
    if ("sections" in extraction)
      return {
        markdown: extraction.kind === "markdown",
        slugs: new Set(extraction.sections.map((s) => s.slug)),
      };
    const pages =
      extraction.kind === "pdf"
        ? extraction.pages.length
        : extraction.kind === "presentation"
          ? extraction.slides.length
          : undefined;
    return pages === current.pages && pages !== undefined ? { pages } : undefined;
  }
}
