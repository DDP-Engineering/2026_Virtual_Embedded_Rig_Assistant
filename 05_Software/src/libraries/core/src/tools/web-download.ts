// REQ-SEC-1a37ade3, REQ-FUNC-b975a8b5
import { downloadFilenameSchema } from "@vera/shared";
import { z } from "zod";
import { PUBLIC_URL_REQUIRED, publicWebUrl } from "../web/provider.js";
import type { PreparedChange } from "./changes.js";
import { type ToolContext, type ToolDefinition, toolLimit, toolSignal } from "./context.js";

const params = z.strictObject({
  url: z
    .string()
    .min(1)
    .max(4096)
    .refine((url) => {
      try {
        publicWebUrl(url);
        return true;
      } catch {
        return false;
      }
    }, PUBLIC_URL_REQUIRED),
  filename: downloadFilenameSchema.optional(),
});
async function prepare(ctx: ToolContext, raw: unknown, signal: AbortSignal): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = params.parse(raw),
    host = ctx.change,
    store = ctx.downloads;
  if (!host || !store) throw Error("Download host is unavailable.");
  host.assertWritable?.();
  const target = store.allocate(args.url, args.filename);
  const approvalSignal = signal;
  const request = Object.freeze({
    workbench: ctx.root,
    sessionId: host.sessionId,
    turnId: host.turnId,
    callId: host.callId,
    tool: "web_download" as const,
    path: target.path,
    args: Object.freeze({ ...args }),
    existed: false,
    beforeSha256: null,
    afterSha256: null,
    diff: "",
    bytes: 0,
    protected: true,
    // The session's Download size is bound into the approval and hashed with it (REQ-FUNC-8a1eea8b).
    download: Object.freeze({ url: target.sourceUrl, maxBytes: toolLimit(ctx, "downloadMB") * 1024 * 1024 }),
  });
  return {
    request,
    apply: async (signal) => ({
      download: await store.save(
        target,
        {
          sessionId: host.sessionId,
          callId: host.callId,
          now: () => host.now(),
          queue: host.queue,
          assertWritable: () => host.assertWritable?.(),
        },
        AbortSignal.any([approvalSignal, toolSignal(ctx, signal)]),
        // The approved size stays bound; the time limit is the session's current value (REQ-FUNC-dfe84577).
        {
          maxBytes: request.download.maxBytes,
          deadlineMs: toolLimit(ctx, "downloadTimeout") * 1000,
          extractionMs: toolLimit(ctx, "extractionTimeout") * 1000,
        },
      ),
    }),
  };
}
export const webDownloadTool: ToolDefinition = {
  name: "web_download",
  class: "write",
  description:
    "Download a public HTTP/HTTPS file (PDF, ZIP, CSV, text, images or other binary formats) into managed .vera/downloads storage, subject to session write permissions. Optional filename may use any file extension. Returns the saved path, byte count, MIME type and SHA-256, not file contents. PDFs can be previewed in VERA; other files can be shown in Explorer. Files are not executed or automatically indexed. Requires global Web access; no search-provider API key is needed.",
  params,
  prepare,
  execute: async (ctx, args, signal) => (await prepare(ctx, args, signal)).apply(signal),
};
