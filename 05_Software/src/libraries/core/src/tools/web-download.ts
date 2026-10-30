// REQ-SEC-1a37ade3, REQ-FUNC-b975a8b5
import { PDF_DOWNLOAD_MAX_BYTES, pdfFilenameSchema } from "@vera/shared";
import { z } from "zod";
import { publicWebUrl } from "../web/provider.js";
import type { PreparedChange } from "./changes.js";
import { type ToolContext, type ToolDefinition, toolSignal } from "./context.js";

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
    }),
  filename: pdfFilenameSchema.optional(),
});
async function prepare(ctx: ToolContext, raw: unknown, signal: AbortSignal): Promise<PreparedChange> {
  signal.throwIfAborted();
  const args = params.parse(raw),
    host = ctx.change,
    store = ctx.downloads;
  if (!host || !store) throw Error("PDF download host is unavailable.");
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
    download: Object.freeze({ url: target.sourceUrl, maxBytes: PDF_DOWNLOAD_MAX_BYTES }),
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
      ),
    }),
  };
}
export const webDownloadTool: ToolDefinition = {
  name: "web_download",
  class: "write",
  description:
    "Download a public PDF URL into managed .vera/downloads storage after write approval. Returns metadata, not PDF bytes or text. The user can open the saved PDF in VERA; downloads are not automatically indexed. Requires global Web access; no search-provider API key is needed.",
  params,
  prepare,
  execute: async (ctx, args, signal) => (await prepare(ctx, args, signal)).apply(signal),
};
