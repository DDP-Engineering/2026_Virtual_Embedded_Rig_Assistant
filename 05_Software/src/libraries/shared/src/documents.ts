import { z } from "zod";
import { type AdvancedSources, advancedSettings, resolveAdvanced } from "./advanced-settings.js";
import { parseRef } from "./refs.js";
import { sessionIdSchema } from "./session.js";
import { indexLeaseSchema, workbenchIdSchema } from "./workbench.js";

export const documentStatusSchema = z.enum(["pending", "indexed", "failed", "unsupported", "needs_ocr"]);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;
export const documentKindSchema = z.enum([
  "pdf",
  "markdown",
  "html",
  "text",
  "document",
  "presentation",
  "spreadsheet",
  "other",
]);
/** Kinds whose sources are binary containers rather than readable text. */
export const binaryDocumentKinds = ["pdf", "document", "presentation", "spreadsheet"] as const;
/** Kinds cited by heading slug. */
export const sectionDocumentKinds = ["markdown", "html", "document", "spreadsheet"] as const;
/** Kinds cited by page; a presentation's pages are its slides. */
export const pagedDocumentKinds = ["pdf", "presentation"] as const;
export const isDocumentKindIn = <K extends string>(kind: string, kinds: readonly K[]): kind is K =>
  (kinds as readonly string[]).includes(kind);
/**
 * Documents VERA may hand to the operating system's default application. The OS runs scripts,
 * programs and web pages it opens, so only these document types are ever opened.
 */
export const externalDocumentExtensions = [
  ".pdf",
  ".txt",
  ".md",
  ".markdown",
  ".csv",
  ".tsv",
  ".log",
  ".docx",
  ".xlsx",
  ".pptx",
  ".doc",
  ".xls",
  ".ppt",
  ".odt",
  ".ods",
  ".odp",
  ".rtf",
] as const;
export function opensExternally(path: string): boolean {
  const name = path.split(/[\\/]/).at(-1) ?? "";
  const dot = name.lastIndexOf(".");
  return dot > 0 && (externalDocumentExtensions as readonly string[]).includes(name.slice(dot).toLowerCase());
}
const renderedExtensions = new Set([
  ".pdf",
  ".md",
  ".markdown",
  ".html",
  ".htm",
  ".docx",
  ".odt",
  ".xlsx",
  ".ods",
  ".pptx",
  ".odp",
]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);
const textExtensions = new Set([
  ".txt",
  ".csv",
  ".tsv",
  ".log",
  ".json",
  ".jsonl",
  ".yaml",
  ".yml",
  ".toml",
  ".xml",
  ".ini",
  ".cfg",
  ".conf",
  ".c",
  ".h",
  ".cpp",
  ".hpp",
  ".cc",
  ".rs",
  ".py",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".css",
  ".sh",
  ".ps1",
  ".bat",
  ".cmd",
  ".sql",
  ".v",
  ".sv",
  ".vhd",
  ".vhdl",
  ".s",
  ".asm",
]);
/** Recognized extensions are a public vocabulary; unknown suffixes need no plaintext renderer metadata. */
export function viewerExtensionKind(extension: string): "rendered" | "image" | "text" | "unknown" {
  return imageExtensions.has(extension)
    ? "image"
    : renderedExtensions.has(extension)
      ? "rendered"
      : textExtensions.has(extension)
        ? "text"
        : "unknown";
}
export const documentReasonSchema = z.enum([
  "SIZE_LIMIT",
  "TYPE_UNSUPPORTED",
  "NAME_UNSUPPORTED",
  "BINARY",
  "IO",
  "PROCESSING",
  "NEEDS_OCR",
]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const documentSchema = z.strictObject({
  id: count.positive(),
  path: z.string().min(1),
  displayPath: z.string().optional(),
  kind: documentKindSchema,
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/)
    .nullable(),
  bytes: count,
  mtime: z.iso.datetime(),
  pages: count.nullable(),
  status: documentStatusSchema,
  error: documentReasonSchema.nullable(),
  indexedAt: z.iso.datetime().nullable(),
});
export type DocumentRecord = z.infer<typeof documentSchema>;
export type DocumentKind = z.infer<typeof documentKindSchema>;
export type DocumentReason = z.infer<typeof documentReasonSchema>;

// REQ-FUNC-28ad0001: no client-provided content/snippet, portable confined syntax.
const path = z
  .string()
  .min(1)
  .max(262144)
  .refine((v) => !!parseRef(`${v}#L1-L1`));
const ref = z
  .string()
  .min(1)
  .max(262144)
  .refine((v) => !!parseRef(v));
const documentRef = ref.refine((v) => parseRef(v)?.kind !== "artifact");
export const docsScopeSchema = z.strictObject({ workbenchId: workbenchIdSchema });
export const DOCS_BYTE_WINDOW_LIMIT = 1024 * 1024;
/** Host-only matching context on each side of a byte window. */
export const DOCS_BYTE_CONTEXT_LIMIT = 65536;
export const docsByteWindowSchema = z
  .strictObject({
    path: z.string().min(1).max(262144),
    offset: count,
    length: count.positive().max(DOCS_BYTE_WINDOW_LIMIT),
    revision: z.string().min(1).max(4096).optional(),
  })
  .refine((v) => Number.isSafeInteger(v.offset + v.length));
/** Base64 bytes preserve physical offsets and size, including masked 0x2A bytes. */
export const docsByteReadSchema = z
  .strictObject({
    path: z.string().min(1).max(262144),
    displayPath: z.string().optional(),
    offset: count,
    size: count,
    revision: z.string().min(1).max(4096).optional(),
    lineEnds: z.array(count.positive().max(DOCS_BYTE_WINDOW_LIMIT)).max(DOCS_BYTE_WINDOW_LIMIT).optional(),
    data: z
      .string()
      .max(4 * Math.ceil(DOCS_BYTE_WINDOW_LIMIT / 3))
      .regex(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/),
  })
  .refine((v) => {
    const bytes = (v.data.length * 3) / 4 - (v.data.endsWith("==") ? 2 : v.data.endsWith("=") ? 1 : 0);
    return (
      bytes <= DOCS_BYTE_WINDOW_LIMIT &&
      bytes <= Math.max(0, v.size - v.offset) &&
      (v.lineEnds === undefined ||
        (v.revision !== undefined &&
          v.lineEnds.every((end, i) => end <= bytes && end > (v.lineEnds?.[i - 1] ?? 0))))
    );
  });
export type DocsByteRead = z.infer<typeof docsByteReadSchema>;
/**
 * One entry of a workbench folder in the Docs tree (TASK-66b7d4aa); `ignored` marks what the
 * agent and the index do not see (TASK-b34f2cc7).
 */
export const docsTreeEntrySchema = z.strictObject({
  name: z.string().min(1),
  path: z.string().min(1),
  displayPath: z.string().optional(),
  type: z.enum(["folder", "file"]),
  ignored: z.boolean(),
});
export type DocsTreeEntry = z.infer<typeof docsTreeEntrySchema>;
/** Physical entry properties plus host viewer metadata; unknown extension keys stay opaque. */
export const docsEntryPropertiesSchema = z.strictObject({
  path: z.string().min(1),
  extension: z.string().max(4096).optional(),
  rendered: z.boolean().optional(),
  displayPath: z.string().optional(),
  type: z.enum(["folder", "file"]),
  size: count.nullable(),
  modified: z.iso.datetime(),
});
export type DocsEntryProperties = z.infer<typeof docsEntryPropertiesSchema>;
/** Programs the Docs tree can open an entry with, when detected (TASK-eae3a69e). */
export const docsOpenerSchema = z.enum(["vscode", "cursor", "notepadpp", "terminal", "other"]);
/** An application Linux registers for a file's type (TASK-c49f03d5). */
export const docsSystemAppSchema = z.strictObject({
  id: z
    .string()
    .max(255)
    .regex(/^[\w.-]+\.desktop$/),
  name: z.string().min(1).max(200),
});
export type DocsOpener = z.infer<typeof docsOpenerSchema>;
/** The desktop indexer process: running, or stopped after repeated crashes (TASK-f09609fd). */
export const indexerStateSchema = z.enum(["running", "stopped"]);
export type IndexerState = z.infer<typeof indexerStateSchema>;
/** Number and source bytes of the documents the last selection admitted (TASK-e5310cdb). */
export const documentVolumeSchema = z.strictObject({ files: count, bytes: count });
export type DocumentVolume = z.infer<typeof documentVolumeSchema>;
/**
 * Indexing stopped before it started: more selected documents than the workbench file limit (the
 * larger of docs.maxFiles and 120 % of the approved count), with the folders holding most of them.
 */
export const documentGuardSchema = z.strictObject({
  files: count,
  limit: count,
  folders: z.array(z.strictObject({ path: z.string().min(1).max(262144), files: count })).max(10),
});
export type DocumentGuard = z.infer<typeof documentGuardSchema>;

export const documentIndexScopeSchema = z.strictObject({
  workbenchId: workbenchIdSchema,
  indexLease: indexLeaseSchema,
});
const documentIndexProgressSchema = z
  .strictObject({
    total: count,
    processed: count,
    exceptions: count,
  })
  .refine(({ total, processed, exceptions }) => exceptions <= processed && processed <= total);

export const documentIndexStatusSchema = documentIndexScopeSchema
  .extend({
    revision: count,
    state: z.enum([
      "scanning",
      "indexing",
      "rebuilding",
      "ready",
      "exceptions",
      "count-guard",
      "blocked",
      "stopped",
      "empty",
      "read-only",
    ]),
    progress: documentIndexProgressSchema.nullable(),
    searchable: count.nullable(),
    volume: documentVolumeSchema.nullable(),
    guard: documentGuardSchema.nullable(),
  })
  .refine(({ state, progress, guard }) => {
    if (state === "count-guard" && !guard) return false;
    if (state === "indexing" || state === "ready" || state === "exceptions" || state === "empty")
      return progress !== null;
    return state === "rebuilding" || progress === null;
  });
export type DocumentIndexStatus = z.infer<typeof documentIndexStatusSchema>;
/**
 * What the indexer's document selection admits for a folder and its documentation settings, counted
 * before anything is indexed: `truncated` when the preview's time limit stopped the count, so the
 * numbers are a lower bound; `guard` when the selection is above the file limit (TASK-ef5fef5b).
 */
export const documentPreviewSchema = z.strictObject({
  files: count,
  bytes: count,
  officePending: count,
  truncated: z.boolean(),
  guard: documentGuardSchema.nullable(),
});
export type DocumentPreview = z.infer<typeof documentPreviewSchema>;
/** The default Document volume warning: above either value the Documents section warns; indexing continues. */
export const documentVolumeLimit: DocumentVolume = {
  files: advancedSettings.docVolumeFiles.default,
  bytes: advancedSettings.docVolumeMB.default * 1024 ** 2,
};
/** The resolved Document volume warning (REQ-UX-d64e808a): workbench over application over the default. */
export function documentVolumeLimitFor(sources: Pick<AdvancedSources, "workbench" | "app">): DocumentVolume {
  return {
    files: resolveAdvanced("docVolumeFiles", sources).value,
    bytes: resolveAdvanced("docVolumeMB", sources).value * 1024 ** 2,
  };
}
export const exceedsDocumentVolume = (volume: DocumentVolume, limit: DocumentVolume = documentVolumeLimit) =>
  volume.files > limit.files || volume.bytes > limit.bytes;
export const documentOpenSchema = z.union([
  docsScopeSchema.extend({ path, requestId: z.string().min(1).max(256).optional() }),
  docsScopeSchema.extend({ ref: documentRef, requestId: z.string().min(1).max(256).optional() }),
  docsScopeSchema.extend({
    sessionId: sessionIdSchema,
    messageId: z.string().min(1).max(256),
    ref,
    requestId: z.string().min(1).max(256).optional(),
  }),
]);
const section = z.strictObject({
  slug: z.string(),
  path: z.array(z.string()),
  text: z.string(),
  start: count.positive(),
  end: count.positive(),
});
export const viewerContentSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("pdf"),
      path,
      displayPath: z.string().optional(),
      ref: documentRef.nullable(),
      snippet: z.string().max(12000),
      data: z.string().max(140000000),
      pages: z.array(z.string()).min(1),
      page: count.positive(),
      pageEnd: count.positive(),
    })
    .refine((v) => v.page <= v.pageEnd && v.pageEnd <= v.pages.length),
  z.strictObject({
    kind: z.enum(["markdown", "html", "document", "spreadsheet"]),
    path,
    displayPath: z.string().optional(),
    ref: documentRef.nullable(),
    snippet: z.string().max(12000),
    sections: z.array(section),
    anchor: z.string().nullable(),
  }),
  z
    .strictObject({
      kind: z.literal("presentation"),
      path,
      displayPath: z.string().optional(),
      ref: documentRef.nullable(),
      snippet: z.string().max(12000),
      slides: z.array(z.string()).min(1),
      page: count.positive(),
      pageEnd: count.positive(),
    })
    .refine((v) => v.page <= v.pageEnd && v.pageEnd <= v.slides.length),
  z
    .strictObject({
      kind: z.literal("text"),
      path,
      displayPath: z.string().optional(),
      ref: documentRef.nullable(),
      snippet: z.string().max(12000),
      lines: z.array(z.string()),
      start: count.positive(),
      end: count,
      byteSource: z
        .strictObject({
          size: count.positive(),
          modified: z.iso.datetime(),
          revision: z.string().min(1).max(4096),
          lines: count,
          utf8Log: z.boolean(),
          encoding: z.enum(["utf-8", "utf-16le", "utf-16be", "windows-1252", "latin1"]).optional(),
        })
        .optional(),
    })
    .refine((v) =>
      v.byteSource
        ? v.lines.length === 0 && v.end <= v.byteSource.lines && v.end >= v.start
        : v.end <= v.lines.length && (v.end >= v.start || v.lines.length === 0),
    ),
  z.strictObject({
    kind: z.literal("artifact"),
    path: z.string(),
    displayPath: z.string().optional(),
    ref,
    snippet: z.string().max(12000),
    content: z.string(),
    mime: z.enum(["text/markdown", "text/plain"]),
  }),
]);
export type ViewerContent = z.infer<typeof viewerContentSchema>;
export const documentSearchHitSchema = z.strictObject({
  ref: documentRef,
  path,
  displayPath: z.string().optional(),
  displayRef: z.string().optional(),
  snippet: z.string().max(300),
  score: z.number().finite(),
});

export const documentSearchUsageSchema = z.discriminatedUnion("mode", [
  z.strictObject({
    mode: z.literal("keyword"),
    fallbackReason: z.enum(["embedding-rebuild", "semantic-unavailable", "revision-conflict"]).optional(),
  }),
  z.strictObject({ mode: z.enum(["semantic", "hybrid"]) }),
  z.strictObject({
    mode: z.null(),
    reason: z.enum(["no-candidates", "index-not-ready", "revision-conflict"]),
  }),
]);

/** Search-time metadata shared by Files, CLI and each search_docs tool result. */
export const documentSearchMetadataSchema = z.strictObject({
  coverage: z.enum(["complete", "partial", "unknown"]),
  usage: documentSearchUsageSchema,
});
export type DocumentSearchMetadata = z.infer<typeof documentSearchMetadataSchema>;
