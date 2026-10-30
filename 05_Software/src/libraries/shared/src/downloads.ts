// REQ-FUNC-b975a8b5, REQ-DATA-fd1933a1
import { z } from "zod";
import { validArtifactName } from "./refs.js";
import { sessionIdSchema } from "./session.js";

export const PDF_DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const downloadIdSchema = z
  .string()
  .uuid()
  .regex(/^[a-f0-9-]+$/);
export const pdfFilenameSchema = z
  .string()
  .max(120)
  .refine((name) => validArtifactName(name) && /\.pdf$/i.test(name));
const downloadUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(4096)
  .regex(/^https?:\/\/[^\\/?#@]+(?:[/?#]|$)/i);
export const downloadApprovalSchema = z.strictObject({
  url: downloadUrlSchema,
  maxBytes: z.literal(PDF_DOWNLOAD_MAX_BYTES),
});
export const pdfDownloadSchema = z
  .strictObject({
    downloadId: downloadIdSchema,
    name: pdfFilenameSchema,
    path: z.string().max(300),
    sessionId: sessionIdSchema,
    callId: z.string().min(1).max(256),
    sourceUrl: downloadUrlSchema,
    finalUrl: downloadUrlSchema,
    mime: z.literal("application/pdf"),
    bytes: z.number().int().positive().max(PDF_DOWNLOAD_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime(),
    pages: z.number().int().positive(),
  })
  .refine((record) => record.path === `.vera/downloads/${record.downloadId}/${record.name}`);
export const pdfDownloadResultSchema = z.strictObject({ download: pdfDownloadSchema });
export type PdfDownload = z.infer<typeof pdfDownloadSchema>;
export function validDownloadApproval(value: {
  tool: string;
  bytes: number;
  diff: string;
  download?: unknown;
}): boolean {
  return value.tool === "web_download"
    ? !!value.download && value.bytes === 0 && value.diff === ""
    : value.download === undefined;
}
