import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import { z } from "zod";

export const modelSchema = z.object({
  modelId: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  revision: z.string().regex(/^[a-f0-9]{40}$/),
  dtype: z.literal("q8"),
  files: z.array(
    z.object({
      path: z.string().regex(/^[\w.-]+(?:\/[\w.-]+)*$/),
      sha256: z.string().regex(/^[a-f0-9]{64}$/),
      bytes: z.number().int().positive(),
    }),
  ),
  embedding: z.object({
    dimensions: z.literal(384),
    maxTokens: z.literal(512),
    pooling: z.enum(["cls", "mean"]),
    normalize: z.literal(true),
    queryPrefix: z.string(),
    passagePrefix: z.string(),
  }),
});
export type EmbeddingModel = z.infer<typeof modelSchema>;
export interface VectorRow {
  id: number;
  vector: Float32Array;
}
export type VectorInput = VectorRow[] | (() => VectorRow[]);
export interface SemanticHit {
  id: number;
  score: number;
}
export interface EmbeddingPort {
  readonly modelId: string;
  embed(root: string, texts: string[], signal: AbortSignal): Promise<Float32Array[]>;
  rank(
    root: string,
    epoch: string,
    rows: VectorInput | undefined,
    query: string,
    signal: AbortSignal,
  ): Promise<SemanticHit[]>;
  release(root: string): Promise<void>;
  cached?(root: string, epoch: string): boolean;
}
interface Slot {
  worker?: Worker | undefined;
  tail: Promise<unknown>;
  closed: boolean;
  epoch?: string | undefined;
}

/** Host-selected local resources; serial persistent worker/cache per workbench, including queue deadlines. */
export class EmbeddingHost implements EmbeddingPort {
  readonly modelId: string;
  readonly model: EmbeddingModel;
  private readonly slots = new Map<string, Slot>();
  constructor(
    private readonly entry: URL,
    private readonly models: string,
    model: unknown,
    private readonly deadlineMs = 120000,
  ) {
    this.model = modelSchema.parse(model);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw Error("Invalid embedding deadline.");
    if (
      [this.model.modelId, ...this.model.files.map((f) => f.path)].some((p) =>
        p.split("/").some((s) => s === "." || s === ".."),
      )
    )
      throw Error("Invalid local model path.");
    this.modelId = `${this.model.modelId}@${this.model.revision}:${createHash("sha256")
      .update(
        JSON.stringify({ dtype: this.model.dtype, embedding: this.model.embedding, files: this.model.files }),
      )
      .digest("hex")}`;
  }
  private call(root: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    let slot = this.slots.get(root);
    if (!slot) {
      slot = { tail: Promise.resolve(), closed: false };
      this.slots.set(root, slot);
    }
    const owned = slot;
    const deadline = performance.now() + this.deadlineMs;
    let started = false,
      cancelled = false;
    let queuedCleanup = () => {};
    const task = owned.tail
      .catch(() => {})
      .then(async () => {
        started = true;
        queuedCleanup();
        if (cancelled) throw Error("Embedding queued request cancelled.");
        signal.throwIfAborted();
        if (owned.closed || performance.now() >= deadline) throw Error("Embedding request expired. Retry.");
        const payload =
          args.type === "rank"
            ? {
                ...args,
                rows:
                  owned.epoch === args.epoch
                    ? undefined
                    : typeof args.rows === "function"
                      ? args.rows()
                      : args.rows,
              }
            : args;
        const worker =
          owned.worker ?? new Worker(this.entry, { workerData: { models: this.models, model: this.model } });
        if (!owned.worker) {
          worker.on("error", () => {});
          worker.on("exit", () => {
            if (owned.worker === worker) {
              owned.worker = undefined;
              owned.epoch = undefined;
            }
          });
        }
        owned.worker = worker;
        return new Promise((resolve, reject) => {
          let ended = false;
          const finish = (value?: unknown, error?: Error) => {
            if (ended) return;
            ended = true;
            clearTimeout(timer);
            signal.removeEventListener("abort", abort);
            worker.removeListener("message", message);
            worker.removeListener("error", crash);
            worker.removeListener("exit", exited);
            if (error) {
              owned.worker = undefined;
              owned.epoch = undefined;
              void worker.terminate().then(() => reject(error), reject);
            } else {
              if (args.type === "rank") owned.epoch = String(args.epoch);
              resolve(value);
            }
          };
          const abort = () => finish(undefined, Error("Embedding aborted."));
          const message = (value: { ok?: boolean; result?: unknown }) =>
            value?.ok
              ? finish(value.result)
              : finish(
                  undefined,
                  Error("Local embedding failed. Check model assets and input token budget."),
                );
          const crash = () => finish(undefined, Error("Embedding worker failed. Retry."));
          const exited = () => finish(undefined, Error("Embedding worker exited. Retry."));
          const timer = setTimeout(
            () => finish(undefined, Error("Embedding deadline exceeded. Retry.")),
            Math.max(1, deadline - performance.now()),
          );
          signal.addEventListener("abort", abort, { once: true });
          worker.once("message", message);
          worker.once("error", crash);
          worker.once("exit", exited);
          try {
            worker.postMessage(payload);
          } catch {
            crash();
          }
          if (signal.aborted) abort();
        });
      });
    owned.tail = task;
    // Queued requests settle at their own deadline; active requests settle after worker termination.
    return new Promise((resolve, reject) => {
      const cancel = (error: Error) => {
        if (started) return;
        cancelled = true;
        queuedCleanup();
        reject(error);
      };
      const abort = () => cancel(Error("Embedding aborted."));
      const timer = setTimeout(() => cancel(Error("Embedding queue deadline exceeded.")), this.deadlineMs);
      queuedCleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
      };
      signal.addEventListener("abort", abort, { once: true });
      task.then(resolve, reject).finally(queuedCleanup);
      if (signal.aborted) abort();
    });
  }
  async embed(root: string, texts: string[], signal: AbortSignal): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const result = z
      .array(z.array(z.number().finite()).length(384))
      .length(texts.length)
      .parse(await this.call(root, { type: "embed", texts }, signal));
    return result.map((v) => {
      const values = new Float32Array(v);
      if (Math.abs(Math.hypot(...values) - 1) > 0.0001) throw Error("Invalid normalized embedding.");
      return values;
    });
  }
  async rank(
    root: string,
    epoch: string,
    rows: VectorInput | undefined,
    query: string,
    signal: AbortSignal,
  ): Promise<SemanticHit[]> {
    const result = z
      .array(z.object({ id: z.number().int().positive(), score: z.number().finite() }))
      .max(50)
      .parse(await this.call(root, { type: "rank", epoch, rows, query }, signal));
    return result;
  }
  async release(root: string): Promise<void> {
    const slot = this.slots.get(root);
    if (!slot) return;
    slot.closed = true;
    this.slots.delete(root);
    await slot.worker?.terminate();
    await slot.tail.catch(() => {});
  }
  cached(root: string, epoch: string): boolean {
    return this.slots.get(root)?.epoch === epoch;
  }
  async dispose(): Promise<void> {
    await Promise.all([...this.slots.keys()].map((root) => this.release(root)));
  }
}
