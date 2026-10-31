// REQ-FUNC-b975a8b5, REQ-DATA-fd1933a1
import { z } from "zod";
import { validArtifactName } from "./refs.js";
import { sessionIdSchema } from "./session.js";

export const DOWNLOAD_MAX_BYTES = 100 * 1024 * 1024;
export const downloadIdSchema = z
  .string()
  .uuid()
  .regex(/^[a-f0-9-]+$/);
export const downloadFilenameSchema = z
  .string()
  .max(120)
  .refine((name) => validArtifactName(name) && name.toLowerCase() !== ".vera-download.json");
const downloadUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(4096)
  .regex(/^https?:\/\/[^\\/?#@]+(?:[/?#]|$)/i);
export const downloadApprovalSchema = z.strictObject({
  url: downloadUrlSchema,
  maxBytes: z.literal(DOWNLOAD_MAX_BYTES),
});
export const webDownloadSchema = z
  .strictObject({
    downloadId: downloadIdSchema,
    name: downloadFilenameSchema,
    path: z.string().max(300),
    sessionId: sessionIdSchema,
    callId: z.string().min(1).max(256),
    sourceUrl: downloadUrlSchema,
    finalUrl: downloadUrlSchema,
    mime: z
      .string()
      .max(160)
      .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/),
    bytes: z.number().int().nonnegative().max(DOWNLOAD_MAX_BYTES),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime(),
    pages: z.number().int().positive().optional(),
  })
  .refine((record) => (record.mime === "application/pdf") === (record.pages !== undefined))
  .refine((record) => record.path === `.vera/downloads/${record.downloadId}/${record.name}`);
export const webDownloadResultSchema = z.strictObject({ download: webDownloadSchema });
export type WebDownload = z.infer<typeof webDownloadSchema>;
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
