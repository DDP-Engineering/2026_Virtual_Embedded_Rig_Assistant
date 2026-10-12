import { z } from "zod";

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
