// REQ-FUNC-28ad0001
import { createHash } from "node:crypto";
import { binaryDocumentKinds, isDocumentKindIn, parseRef, type ViewerContent, veraError } from "@vera/shared";
import type Database from "better-sqlite3";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { readGuardedFile, textLines } from "../tools/files.js";
import { readWindow } from "../tools/read-window.js";
import { PathGuard, runLogLocation } from "../workbench/path-guard.js";
import { extractionSchema } from "./extraction.js";
import { verifyDocumentSource } from "./processor.js";
import { decodeDocumentText, isBinaryDocumentText } from "./text-source.js";

/** The largest PDF rendered without an index row; its base64 form stays inside the viewer content limit. */
export const UNINDEXED_PDF_BYTES = 100 * 1024 * 1024;

/** Read-only viewer over current guarded source and the full persisted extraction. */
export class DocumentViewer {
  constructor(
    private readonly root: string,
    private readonly db: Database.Database,
  ) {}
  async open(
    target: string,
    snippet = "",
    byPath = false,
    utf8Log = false,
    logSha256?: string,
  ): Promise<ViewerContent> {
    try {
      const parsed = byPath ? undefined : parseRef(target);
      if (!byPath && (!parsed || parsed.kind === "artifact")) throw Error("Invalid document ref.");
      const path = byPath ? target : parsed && "path" in parsed ? parsed.path : "";
      const managedLog = parsed?.kind === "lines" && runLogLocation(path);
      const guard = await PathGuard.create(this.root, this.root, "workbench", undefined, [], [], {
        allowRunLogs: managedLog,
      });
      const current = await guard.resolve(path);
      if (current.relative !== path && !utf8Log) throw Error("Noncanonical source.");
      const rows = new DocumentsRepository(this.db),
        doc = rows.get(path);
      const signal = new AbortController().signal;
      const base = { path, ref: byPath ? null : target, snippet: snippet.slice(0, 12000) };
      if (parsed?.kind === "lines") {
        // File-tool refs also cover ordinary unindexed source files.
        const window = await readWindow(guard, path, parsed.start, 1, signal, { utf8Log });
        if (parsed.end > window.totalLines) throw Error("Line bounds.");
        if (logSha256 && window.sha256 !== logSha256) throw Error("Log changed since it was parsed.");
        if (!utf8Log && doc && (doc.status !== "indexed" || doc.sha256 !== window.sha256))
          throw Error("Stale index.");
        const bytes =
          utf8Log || managedLog
            ? (await readGuardedFile(guard, path, 50 * 1024 * 1024, signal)).bytes
            : await verifyDocumentSource({
                root: this.root,
                path,
                kind: "text",
                sha256: window.sha256,
                signal,
                assertWritable: () => {},
              });
        if ((utf8Log || managedLog) && createHash("sha256").update(bytes).digest("hex") !== window.sha256)
          throw Error("Source changed.");
        const after = rows.get(path);
        if (
          !utf8Log &&
          (doc
            ? after?.id !== doc.id || after.sha256 !== doc.sha256 || after.status !== doc.status
            : after !== undefined)
        )
          throw Error("Index changed.");
        const encoding = window.encoding === "latin1" && doc ? "windows-1252" : window.encoding;
        const large = bytes.length > 5 * 1024 * 1024;
        const lines = large
          ? []
          : textLines(
              encoding === "latin1"
                ? Buffer.from(bytes).toString("latin1")
                : new TextDecoder(encoding, { fatal: true }).decode(bytes),
            );
        return {
          ...base,
          kind: "text",
          lines,
          start: parsed.start,
          end: parsed.end,
          ...(large
            ? {
                byteSource: {
                  size: window.size,
                  modified: window.modified,
                  revision: window.revision,
                  lines: window.totalLines,
                  utf8Log,
                  encoding,
                },
              }
            : {}),
        };
      }
      let checked: Awaited<ReturnType<DocumentViewer["indexedSource"]>>;
      try {
        checked = await this.indexedSource(path, signal);
      } catch (error) {
        // A PDF opened from Files that is not indexed (yet, any more, or at all) still renders from its
        // bytes. The single empty page tells the viewer to take the page count from the file itself.
        if (!byPath || !/\.pdf$/i.test(path)) throw error;
        const { bytes } = await readGuardedFile(guard, path, UNINDEXED_PDF_BYTES, signal);
        return {
          ...base,
          kind: "pdf",
          data: Buffer.from(bytes).toString("base64"),
          pages: [""],
          page: 1,
          pageEnd: 1,
        };
      }
      const { bytes, extraction } = checked;
      if (extraction.kind === "pdf") {
        if (parsed && parsed.kind !== "page" && parsed.kind !== "page-range")
          throw Error("PDF locator required.");
        const page = parsed?.kind === "page" ? parsed.page : parsed?.kind === "page-range" ? parsed.start : 1;
        const pageEnd = parsed?.kind === "page-range" ? parsed.end : page;
        if (pageEnd > extraction.pages.length || checked.doc.pages !== extraction.pages.length)
          throw Error("Page bounds.");
        return {
          ...base,
          kind: "pdf",
          data: Buffer.from(bytes).toString("base64"),
          pages: extraction.pages,
          page,
          pageEnd,
        };
      }
      if (extraction.kind === "presentation") {
        if (parsed && parsed.kind !== "page" && parsed.kind !== "page-range")
          throw Error("Slide locator required.");
        const page = parsed?.kind === "page" ? parsed.page : parsed?.kind === "page-range" ? parsed.start : 1;
        const pageEnd = parsed?.kind === "page-range" ? parsed.end : page;
        if (pageEnd > extraction.slides.length || checked.doc.pages !== extraction.slides.length)
          throw Error("Slide bounds.");
        return { ...base, kind: "presentation", slides: extraction.slides, page, pageEnd };
      }
      if (extraction.kind === "text") {
        if (parsed) throw Error("Text locator required.");
        if (bytes.length > 5 * 1024 * 1024) {
          const window = await readWindow(guard, path, 1, 1, signal);
          const after = rows.get(path);
          if (
            window.sha256 !== checked.doc.sha256 ||
            after?.id !== checked.doc.id ||
            after.sha256 !== checked.doc.sha256 ||
            after.status !== checked.doc.status
          )
            throw Error("Source or index changed.");
          return {
            ...base,
            kind: "text",
            lines: [],
            start: 1,
            end: window.totalLines,
            byteSource: {
              size: window.size,
              modified: window.modified,
              revision: window.revision,
              lines: window.totalLines,
              utf8Log: false,
              encoding: window.encoding === "latin1" ? "windows-1252" : window.encoding,
            },
          };
        }
        return { ...base, kind: "text", lines: extraction.lines, start: 1, end: extraction.lines.length };
      }
      if (parsed && parsed.kind !== "heading") throw Error("Heading locator required.");
      const anchor = parsed?.kind === "heading" ? parsed.slug : null;
      // An empty anchor is the untitled leading section, which must exist like any heading.
      if (anchor !== null && !extraction.sections.some((s) => s.slug === anchor))
        throw Error("Heading bounds.");
      return { ...base, kind: extraction.kind, sections: extraction.sections, anchor };
    } catch {
      throw veraError("NOT_FOUND");
    }
  }
  private async indexedSource(path: string, signal: AbortSignal) {
    const target = await (await PathGuard.create(this.root)).resolve(path);
    if (target.relative !== path) throw Error("Noncanonical source.");
    const rows = new DocumentsRepository(this.db),
      doc = rows.get(path);
    if (!doc?.sha256 || (doc.status !== "indexed" && doc.status !== "needs_ocr") || doc.kind === "other")
      throw Error("Unavailable document.");
    const bytes = await verifyDocumentSource({
      root: this.root,
      path,
      kind: doc.kind,
      sha256: doc.sha256,
      signal,
      assertWritable: () => {},
    });
    const after = rows.get(path);
    if (
      after?.id !== doc.id ||
      after.sha256 !== doc.sha256 ||
      after.status !== doc.status ||
      after.kind !== doc.kind ||
      after.pages !== doc.pages
    )
      throw Error("Index changed.");
    const stored = this.db
      .prepare("SELECT extraction_json FROM document_extractions WHERE doc_id=?")
      .pluck()
      .get(doc.id);
    const extraction =
      typeof stored === "string"
        ? extractionSchema.parse(JSON.parse(stored))
        : doc.kind === "pdf" && doc.status === "needs_ocr" && doc.pages
          ? { kind: "pdf" as const, pages: Array<string>(doc.pages).fill("") }
          : undefined;
    if (!extraction || extraction.kind !== doc.kind) throw Error("Full extraction unavailable.");
    if (!isDocumentKindIn(extraction.kind, binaryDocumentKinds) && isBinaryDocumentText(bytes))
      throw Error("Binary source.");
    return { doc, bytes, extraction };
  }
  /** Verify each source once; only compact locator bounds survive between search candidates. */
  async currentBounds(path: string, signal: AbortSignal = new AbortController().signal) {
    try {
      const { doc, bytes, extraction } = await this.indexedSource(path, signal);
      if (doc.status !== "indexed") return undefined;
      if (extraction.kind === "pdf" || extraction.kind === "presentation") {
        const pages = extraction.kind === "pdf" ? extraction.pages.length : extraction.slides.length;
        return doc.pages === pages
          ? { kind: extraction.kind, pages, lines: 0, slugs: new Set<string>() }
          : undefined;
      }
      return {
        kind: extraction.kind,
        pages: 0,
        // Office sources are archives: they have sections but no line locators.
        lines: isDocumentKindIn(extraction.kind, binaryDocumentKinds)
          ? 0
          : textLines(decodeDocumentText(bytes)).length,
        slugs: new Set("sections" in extraction ? extraction.sections.map((s) => s.slug) : []),
      };
    } catch {
      signal.throwIfAborted();
      return undefined;
    }
  }
  async openPath(path: string): Promise<ViewerContent> {
    return this.open(path, "", true);
  }
}
