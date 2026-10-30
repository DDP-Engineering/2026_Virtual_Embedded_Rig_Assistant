import { type ResourceLimits, Worker } from "node:worker_threads";
import { type Extraction, extractionSchema } from "./extraction.js";

export type PdfExtractor = (bytes: Uint8Array, signal: AbortSignal) => Promise<Extraction & { kind: "pdf" }>;
/** One disposable thread per serial ingest request, with bounded abort/exit cleanup. */
export function createPdfExtractor(
  entry: URL,
  deadlineMs = 120000,
  resourceLimits?: ResourceLimits,
): PdfExtractor {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw Error("Invalid PDF worker deadline.");
  return (bytes, signal) => {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const worker = new Worker(entry, resourceLimits ? { resourceLimits } : {});
      let terminal = false;
      const finish = (value?: unknown, error?: Error) => {
        if (terminal) return;
        terminal = true;
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        void worker.terminate().then(() => {
          if (error) {
            reject(error);
            return;
          }
          const parsed = extractionSchema.safeParse(value);
          if (parsed.success && parsed.data.kind === "pdf") resolve(parsed.data);
          else reject(Error("PDF processing failed."));
        }, reject);
      };
      const abort = () => finish(undefined, Error("PDF processing aborted."));
      const timer = setTimeout(
        () => finish(undefined, Error("PDF processing deadline exceeded.")),
        deadlineMs,
      );
      signal.addEventListener("abort", abort, { once: true });
      worker.once("message", (value: unknown) => finish(value));
      worker.once("error", () => finish(undefined, Error("PDF worker failed.")));
      worker.once("exit", () => finish(undefined, Error("PDF worker exited before completion.")));
      try {
        worker.postMessage(bytes);
      } catch {
        finish(undefined, Error("PDF worker could not receive input."));
      }
      if (signal.aborted) abort();
    });
  };
}
