import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import {
  defaultEmbeddingModelId,
  type EmbeddingModelId,
  embeddingModelDescriptorSchema,
  embeddingModelManifestSchema,
} from "@vera/shared";
import { z } from "zod";

export { defaultEmbeddingModelId, type EmbeddingModelId, embeddingModelIds } from "@vera/shared";

export const modelSchema = embeddingModelDescriptorSchema;
export type EmbeddingModel = z.infer<typeof modelSchema>;

/** The manifest sits beside its assets within either a development or an installed model root. */
export function embeddingModelManifestPath(
  models: string,
  modelId: EmbeddingModelId = defaultEmbeddingModelId,
) {
  return join(models, modelId, "model-manifest.json");
}

/** Read the registered descriptor and bind its identity to the model directory. */
export function readEmbeddingModel(
  models: string,
  modelId: EmbeddingModelId = defaultEmbeddingModelId,
): EmbeddingModel {
  const path = embeddingModelManifestPath(models, modelId);
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (cause) {
    // Only source file errors should trigger the ingest rescan.
    throw Error(`Local embedding model manifest unavailable for ${modelId}.`, { cause });
  }
  const manifest = embeddingModelManifestSchema.parse(JSON.parse(contents));
  if (manifest.modelId !== modelId) throw Error(`Model manifest identity mismatch: ${path}`);
  return modelSchema.parse(manifest);
}

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
interface WorkbenchLease {
  id: number;
  tail?: Promise<void>;
}
interface Slot {
  worker?: Worker | undefined;
  tail: Promise<void>;
  idle?: ReturnType<typeof setTimeout> | undefined;
  epoch?: { owner: number; key: string } | undefined;
  /** Workers detached from this slot that are still finishing a native call. */
  retiring: Set<Promise<void>>;
}

/** The stored model identity of a local embedding model: id, revision and a hash of its files. */
export function embeddingModelId(model: EmbeddingModel): string {
  return `${model.modelId}@${model.revision}:${createHash("sha256")
    .update(JSON.stringify({ dtype: model.dtype, embedding: model.embedding, files: model.files }))
    .digest("hex")}`;
}
/** Host-selected local resources; serial worker per model with a workbench-scoped cache, including queue deadlines. */
export class EmbeddingHost implements EmbeddingPort {
  readonly modelId: string;
  readonly model: EmbeddingModel;
  private readonly slot: Slot = { tail: Promise.resolve(), retiring: new Set() };
  private readonly roots = new Map<string, WorkbenchLease>();
  private nextRoot = 0;
  /** Workers inside a request, from postMessage until their reply or exit. */
  private readonly busy = new Set<Worker>();
  constructor(
    private readonly entry: URL,
    private readonly models: string,
    model: unknown,
    private readonly deadlineMs = 120000,
    /** How long release waits for a busy worker before returning to its caller. */
    private readonly releaseWaitMs = 5000,
    /** A fixed idle time, or the host's Embedding worker idle time read as each idle period starts. */
    private readonly idleTimeoutMs: number | (() => number) = 60000,
  ) {
    this.model = modelSchema.parse(model);
    if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) throw Error("Invalid embedding deadline.");
    if (
      [this.model.modelId, ...this.model.files.map((f) => f.path)].some((p) =>
        p.split("/").some((s) => s === "." || s === ".."),
      )
    )
      throw Error("Invalid local model path.");
    // ORT 1.30's native uploader starts at initialization, before its API can opt out.
    // Set the real parent process environment before any inference worker is created.
    process.env.ORT_DISABLE_TELEMETRY = "1";
    this.modelId = embeddingModelId(this.model);
  }
  /** The idle time of the period starting now (REQ-FUNC-bfbd70b6); an invalid host value keeps 60 s. */
  private idleMs(): number {
    let value: number;
    try {
      value = typeof this.idleTimeoutMs === "function" ? this.idleTimeoutMs() : this.idleTimeoutMs;
    } catch {
      return 60000;
    }
    return Number.isFinite(value) && value > 0 ? value : 60000;
  }
  private call(root: string, args: Record<string, unknown>, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    const owned = this.slot;
    clearTimeout(owned.idle);
    const owner: WorkbenchLease = this.roots.get(root) ?? { id: ++this.nextRoot };
    this.roots.set(root, owner);
    const epoch =
      args.type === "rank" ? { owner: owner.id, key: JSON.stringify([owner.id, args.epoch]) } : undefined;
    const deadline = performance.now() + this.deadlineMs;
    let started = false,
      cancelled = false;
    let queuedCleanup = () => {};
    const task = owned.tail.then(async () => {
      while (owned.retiring.size) await Promise.all(owned.retiring);
      started = true;
      queuedCleanup();
      if (cancelled) throw Error("Embedding queued request cancelled.");
      signal.throwIfAborted();
      if (this.roots.get(root) !== owner || performance.now() >= deadline)
        throw Error("Embedding request expired. Retry.");
      const payload = epoch
        ? {
            ...args,
            epoch: epoch.key,
            rows:
              owned.epoch?.key === epoch.key
                ? undefined
                : typeof args.rows === "function"
                  ? args.rows()
                  : args.rows,
          }
        : args;
      // A released workbench's in-flight rank can replace the worker cache before replying.
      if (epoch && owned.epoch?.key !== epoch.key) owned.epoch = undefined;
      const worker =
        owned.worker ?? new Worker(this.entry, { workerData: { models: this.models, model: this.model } });
      if (!owned.worker) {
        worker.on("error", () => {});
        worker.on("message", () => this.busy.delete(worker));
        worker.on("exit", () => {
          this.busy.delete(worker);
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
            // The caller is released now; a worker still inside its native call stops after it.
            if (owned.worker === worker) this.retireWorker();
            reject(error);
          } else {
            if (epoch && owned.worker === worker && this.roots.get(root) === owner) owned.epoch = epoch;
            resolve(value);
          }
        };
        const abort = () => finish(undefined, Error("Embedding aborted."));
        const message = (value: { ok?: boolean; result?: unknown }) =>
          value?.ok
            ? finish(value.result)
            : finish(undefined, Error("Local embedding failed. Check model assets and input token budget."));
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
          this.busy.add(worker);
        } catch {
          crash();
        }
        if (signal.aborted) abort();
      });
    });
    const tail = task.then(
      () => {},
      () => {},
    );
    owned.tail = tail;
    owner.tail = tail;
    void tail.then(() => {
      if (owned.tail !== tail || !owned.worker) return;
      owned.idle = setTimeout(() => {
        this.roots.clear();
        this.retireWorker();
      }, this.idleMs()).unref();
    });
    // Queued requests settle at their own deadline; active requests settle when aborted or answered.
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
  /**
   * Terminates an idle worker now and a busy one once its current call replies (or after the
   * deadline; release stops waiting for it sooner): ONNX Runtime brings the whole process down (0xE06D7363) when its worker thread is
   * terminated inside a native call, for example while switching workbenches during indexing.
   */
  private retireWorker(): void {
    const slot = this.slot;
    const worker = slot.worker;
    if (!worker) return;
    clearTimeout(slot.idle);
    slot.worker = undefined;
    slot.epoch = undefined;
    const retired = new Promise<void>((resolve) => {
      let stopping = false;
      const stop = () => {
        if (stopping) return;
        stopping = true;
        clearTimeout(timer);
        worker.off("message", stop);
        worker.off("exit", stop);
        void worker.terminate().then(
          () => resolve(),
          () => resolve(),
        );
      };
      const timer = setTimeout(stop, this.busy.has(worker) ? this.deadlineMs : 0);
      if (this.busy.has(worker)) {
        worker.once("message", stop);
        worker.once("exit", stop);
      }
    });
    slot.retiring.add(retired);
    void retired.then(() => slot.retiring.delete(retired));
  }
  async release(root: string): Promise<void> {
    const owner = this.roots.get(root);
    if (!owner) return;
    this.roots.delete(root);
    const slot = this.slot;
    if (slot.epoch?.owner === owner.id) slot.epoch = undefined;
    const last = this.roots.size === 0;
    if (last) this.retireWorker();
    const draining = last ? Promise.all([...slot.retiring, owner.tail]) : owner.tail;
    // A workbench switch or close does not wait out a long native call. The worker is not
    // terminated early (see retire): it still stops after its reply, without a caller waiting.
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      draining,
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, this.releaseWaitMs);
      }),
    ]);
    clearTimeout(timer);
  }
  cached(root: string, epoch: string): boolean {
    const owner = this.roots.get(root);
    return owner !== undefined && this.slot.epoch?.key === JSON.stringify([owner.id, epoch]);
  }
  async dispose(): Promise<void> {
    await Promise.all([...this.roots.keys()].map((root) => this.release(root)));
  }
}
