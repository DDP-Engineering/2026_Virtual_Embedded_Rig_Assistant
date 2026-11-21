import { type ResourceLimits, Worker } from "node:worker_threads";
import { type Extraction, extractionSchema } from "./extraction.js";
import { type OfficeFormat, OfficeLimitError } from "./office-format.js";

/** `baseMs` replaces the extractor's base deadline for one call (a download's session value). */
export type PdfExtractor = (
  bytes: Uint8Array,
  signal: AbortSignal,
  options?: { baseMs?: number },
) => Promise<Extraction & { kind: "pdf" }>;
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
const validDeadline = (deadlineMs: number) => Number.isFinite(deadlineMs) && deadlineMs > 0;
/**
 * A fixed base deadline, or the host's Document extraction time limit read as each extraction starts
 * (REQ-FUNC-aa35b135); an invalid value from a getter falls back to 120 s.
 */
export type ExtractionDeadline = number | (() => number);
const checkDeadline = (deadlineMs: ExtractionDeadline, label: string) => {
  if (typeof deadlineMs === "number" && !validDeadline(deadlineMs))
    throw Error(`Invalid ${label} worker deadline.`);
};
const currentDeadline = (deadlineMs: ExtractionDeadline, override?: number) => {
  if (override !== undefined && validDeadline(override)) return override;
  let value: number;
  try {
    value = typeof deadlineMs === "function" ? deadlineMs() : deadlineMs;
  } catch {
    return 120000;
  }
  return validDeadline(value) ? value : 120000;
};

/** A large manual needs more than the base deadline: 30 s per MiB, at most 15 minutes. */
export const pdfDeadline = (baseMs: number, bytes: number) =>
  Math.max(baseMs, Math.min(15 * 60_000, Math.round((bytes / (1024 * 1024)) * 30_000)));

/** A heap ceiling makes a pathological file fail as a processing error, not exhaust the host. */
export const DOCUMENT_WORKER_LIMITS: ResourceLimits = { maxOldGenerationSizeMb: 2048 };

export function createPdfExtractor(
  entry: URL,
  deadlineMs: ExtractionDeadline = 120000,
  resourceLimits: ResourceLimits = DOCUMENT_WORKER_LIMITS,
): PdfExtractor {
  checkDeadline(deadlineMs, "PDF");
  return (bytes, signal, options) =>
    runWorker(
      entry,
      "PDF",
      bytes,
      signal,
      pdfDeadline(currentDeadline(deadlineMs, options?.baseMs), bytes.byteLength),
      (value) => {
        const parsed = extractionSchema.safeParse(value);
        if (parsed.success && parsed.data.kind === "pdf") return parsed.data;
        throw Error("PDF processing failed.");
      },
      resourceLimits,
    );
}

/** Office files are parsed in the same document worker entry as PDFs, so no build input is added. */
export function createOfficeExtractor(
  entry: URL,
  deadlineMs: ExtractionDeadline = 120000,
  resourceLimits: ResourceLimits = DOCUMENT_WORKER_LIMITS,
): OfficeExtractor {
  checkDeadline(deadlineMs, "Office");
  return (format, bytes, signal) =>
    runWorker(
      entry,
      "Office",
      { format, bytes },
      signal,
      currentDeadline(deadlineMs),
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
