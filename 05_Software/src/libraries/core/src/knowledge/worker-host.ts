import { type ResourceLimits, Worker } from "node:worker_threads";
import { type Extraction, extractionSchema } from "./extraction.js";
import { type OfficeFormat, OfficeLimitError } from "./office-format.js";

export type PdfExtractor = (bytes: Uint8Array, signal: AbortSignal) => Promise<Extraction & { kind: "pdf" }>;
export type OfficeExtractor = (
  format: OfficeFormat,
  bytes: Uint8Array,
  signal: AbortSignal,
) => Promise<Extraction>;

/** One disposable thread per request, with bounded abort/exit cleanup and an absolute deadline. */
function runWorker<T>(
  entry: URL,
  label: string,
  message: unknown,
  signal: AbortSignal,
  deadlineMs: number,
  accept: (value: unknown) => T,
  resourceLimits?: ResourceLimits,
): Promise<T> {
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
        try {
          resolve(accept(value));
        } catch (failure) {
          reject(failure);
        }
      }, reject);
    };
    const abort = () => finish(undefined, Error(`${label} processing aborted.`));
    const timer = setTimeout(
      () => finish(undefined, Error(`${label} processing deadline exceeded.`)),
      deadlineMs,
    );
    signal.addEventListener("abort", abort, { once: true });
    worker.once("message", (value: unknown) => finish(value));
    worker.once("error", () => finish(undefined, Error(`${label} worker failed.`)));
    worker.once("exit", () => finish(undefined, Error(`${label} worker exited before completion.`)));
    try {
      worker.postMessage(message);
    } catch {
      finish(undefined, Error(`${label} worker could not receive input.`));
    }
    if (signal.aborted) abort();
  });
}
const checkDeadline = (deadlineMs: number, label: string) => {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw Error(`Invalid ${label} worker deadline.`);
};

export function createPdfExtractor(
  entry: URL,
  deadlineMs = 120000,
  resourceLimits?: ResourceLimits,
): PdfExtractor {
  checkDeadline(deadlineMs, "PDF");
  return (bytes, signal) =>
    runWorker(
      entry,
      "PDF",
      bytes,
      signal,
      deadlineMs,
      (value) => {
        const parsed = extractionSchema.safeParse(value);
        if (parsed.success && parsed.data.kind === "pdf") return parsed.data;
        throw Error("PDF processing failed.");
      },
      resourceLimits,
    );
}

/** A heap ceiling makes a pathological workbook fail as a processing error, not exhaust the host. */
export const OFFICE_WORKER_LIMITS: ResourceLimits = { maxOldGenerationSizeMb: 2048 };
/** Office files are parsed in the same document worker entry as PDFs, so no build input is added. */
export function createOfficeExtractor(
  entry: URL,
  deadlineMs = 120000,
  resourceLimits: ResourceLimits = OFFICE_WORKER_LIMITS,
): OfficeExtractor {
  checkDeadline(deadlineMs, "Office");
  return (format, bytes, signal) =>
    runWorker(
      entry,
      "Office",
      { format, bytes },
      signal,
      deadlineMs,
      (value) => {
        if (value && typeof value === "object" && "error" in value && value.error === "SIZE_LIMIT")
          throw new OfficeLimitError();
        const parsed = extractionSchema.safeParse(value);
        if (parsed.success && parsed.data.kind !== "pdf" && parsed.data.kind !== "text") return parsed.data;
        throw Error("Office processing failed.");
      },
      resourceLimits,
    );
}
