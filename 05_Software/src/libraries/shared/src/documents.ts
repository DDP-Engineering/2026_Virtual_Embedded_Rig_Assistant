import { z } from "zod";
import { parseRef } from "./refs.js";
import { sessionIdSchema } from "./session.js";
import { workbenchIdSchema } from "./workbench.js";

export const documentStatusSchema = z.enum(["pending", "indexed", "failed", "unsupported", "needs_ocr"]);
export const documentKindSchema = z.enum(["pdf", "markdown", "html", "text", "other"]);
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
    kind: z.enum(["markdown", "html"]),
    path,
    ref: documentRef.nullable(),
    snippet: z.string().max(12000),
    sections: z.array(section),
    anchor: z.string().nullable(),
  }),
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
