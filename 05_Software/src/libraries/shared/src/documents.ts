import { z } from "zod";
import { parseRef } from "./refs.js";
import { sessionIdSchema } from "./session.js";
import { workbenchIdSchema } from "./workbench.js";

export const documentStatusSchema = z.enum(["pending", "indexed", "failed", "unsupported", "needs_ocr"]);
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
export const documentReasonSchema = z.enum([
  "SIZE_LIMIT",
  "TYPE_UNSUPPORTED",
  "BINARY",
  "IO",
  "PROCESSING",
  "NEEDS_OCR",
]);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const documentSchema = z.strictObject({
  id: count.positive(),
  path: z.string().min(1),
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
  .max(4096)
  .refine((v) => !!parseRef(`${v}#L1-L1`));
const ref = z
  .string()
  .min(1)
  .max(8192)
  .refine((v) => !!parseRef(v));
const documentRef = ref.refine((v) => parseRef(v)?.kind !== "artifact");
export const docsScopeSchema = z.strictObject({ workbenchId: workbenchIdSchema });
/**
 * One entry of a workbench folder in the Docs tree (TASK-66b7d4aa); `ignored` marks what the
 * agent and the index do not see (TASK-b34f2cc7).
 */
export const docsTreeEntrySchema = z.strictObject({
  name: z.string().min(1),
  path: z.string().min(1),
  type: z.enum(["folder", "file"]),
  ignored: z.boolean(),
});
export type DocsTreeEntry = z.infer<typeof docsTreeEntrySchema>;
/** Properties of a Docs tree entry: bytes of a file (null for a folder) and the modified time. */
export const docsEntryPropertiesSchema = z.strictObject({
  path: z.string().min(1),
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
/** Above either value the Docs panel and the Documents section warn; indexing continues. */
export const documentVolumeLimit = { files: 2000, bytes: 2 * 1024 ** 3 } as const;
export const exceedsDocumentVolume = (volume: DocumentVolume): boolean =>
  volume.files > documentVolumeLimit.files || volume.bytes > documentVolumeLimit.bytes;
export const documentOpenSchema = z.union([
  docsScopeSchema.extend({ path }),
  docsScopeSchema.extend({ ref: documentRef }),
  docsScopeSchema.extend({ sessionId: sessionIdSchema, messageId: z.string().min(1).max(256), ref }),
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
    ref: documentRef.nullable(),
    snippet: z.string().max(12000),
    sections: z.array(section),
    anchor: z.string().nullable(),
  }),
  z
    .strictObject({
      kind: z.literal("presentation"),
      path,
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
      ref: documentRef.nullable(),
      snippet: z.string().max(12000),
      lines: z.array(z.string()),
      start: count.positive(),
      end: count,
    })
    .refine((v) => v.end <= v.lines.length && (v.end >= v.start || v.lines.length === 0)),
  z.strictObject({
    kind: z.literal("artifact"),
    path: z.string(),
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
  snippet: z.string().max(300),
  score: z.number().finite(),
});
