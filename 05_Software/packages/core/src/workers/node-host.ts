import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import type { GrepMatch, WorkerPool, WorkerResult } from "../ports.js";

export interface WorkerHostOptions {
  capacity?: number;
  deadlineMs?: number;
}
interface Pending {
  task: { root: string; args: unknown };
  signal: AbortSignal;
  deadline: number;
  matches: GrepMatch[];
  worker?: Worker;
  terminal: boolean;
  timer: ReturnType<typeof setTimeout>;
  abort: () => void;
  resolve: (result: WorkerResult) => void;
  onPartial?: (match: GrepMatch) => void;
}

/** Absolute deadlines belong to this host, including queue time. One task per worker. */
export class NodeWorkerPool implements WorkerPool {
  readonly deadlineMs: number;
  private readonly capacity: number;
  private readonly queue: Pending[] = [];
  private readonly active = new Set<Pending>();
  private readonly settling = new Set<Promise<void>>();
  private closed = false;
  get activeCount() {
    return this.active.size;
  }
  constructor(
    private readonly entry: URL,
    options: WorkerHostOptions = {},
  ) {
    this.deadlineMs = options.deadlineMs ?? 10000;
    this.capacity = options.capacity ?? 2;
    if (
      !Number.isFinite(this.deadlineMs) ||
      this.deadlineMs <= 0 ||
      !Number.isInteger(this.capacity) ||
      this.capacity < 1
    )
      throw Error("Invalid worker host limits.");
  }
  run(
    task: { root: string; args: unknown },
    signal: AbortSignal,
    onPartial?: (match: GrepMatch) => void,
  ): Promise<WorkerResult> {
    if (signal.aborted || this.closed)
      return Promise.resolve({ matches: [], truncated: true, reason: "aborted" });
    return new Promise((resolve) => {
      const job: Pending = {
        task: structuredClone(task),
        signal,
        deadline: performance.now() + this.deadlineMs,
        matches: [],
        terminal: false,
        resolve,
        ...(onPartial ? { onPartial } : {}),
        timer: setTimeout(() => {
          this.finish(job, { truncated: true, reason: "timeout" });
        }, this.deadlineMs),
        abort: () => {
          this.finish(job, { truncated: true, reason: "aborted" });
        },
      };
      signal.addEventListener("abort", job.abort, { once: true });
      this.queue.push(job);
      this.pump();
    });
  }
  private pump(): void {
    while (!this.closed && this.active.size < this.capacity && this.queue.length) {
      const job = this.queue.shift();
      if (!job || job.terminal) continue;
      if (performance.now() >= job.deadline) {
        this.finish(job, { truncated: true, reason: "timeout" });
        continue;
      }
      this.active.add(job);
      try {
        const worker = new Worker(this.entry);
        job.worker = worker;
        worker.on(
          "message",
          (message: { type: string; match?: GrepMatch; truncated?: boolean; error?: string }) => {
            if (job.terminal) return;
            if (performance.now() >= job.deadline) {
              this.finish(job, { truncated: true, reason: "timeout" });
              return;
            }
            if (message.type === "partial" && message.match) {
              job.matches.push(message.match);
              try {
                job.onPartial?.(structuredClone(message.match));
              } catch {
                /* observers cannot strand tasks */
              }
            } else if (message.type === "done") this.finish(job, { truncated: message.truncated ?? false });
            else if (message.type === "error")
              this.finish(job, { truncated: false, error: message.error ?? "Grep task failed." });
          },
        );
        worker.on("error", () => {
          this.finish(job, { truncated: true, error: "Grep worker failed. Retry the call." });
        });
        worker.on("exit", () => {
          if (!job.terminal)
            this.finish(job, {
              truncated: true,
              error: "Grep worker exited before completion. Retry the call.",
            });
        });
        worker.postMessage(job.task);
      } catch {
        this.finish(job, { truncated: true, error: "Grep worker could not start. Retry the call." });
      }
    }
  }
  private finish(job: Pending, result: Omit<WorkerResult, "matches">): void {
    if (job.terminal) return;
    job.terminal = true;
    clearTimeout(job.timer);
    job.signal.removeEventListener("abort", job.abort);
    const index = this.queue.indexOf(job);
    if (index >= 0) this.queue.splice(index, 1);
    const settle = async () => {
      try {
        await job.worker?.terminate();
      } finally {
        this.active.delete(job);
        job.resolve({ matches: job.matches, ...result });
        this.pump();
      }
    };
    const pending = settle();
    this.settling.add(pending);
    void pending.then(
      () => {
        this.settling.delete(pending);
      },
      () => {
        this.settling.delete(pending);
      },
    );
  }
  async dispose(): Promise<void> {
    this.closed = true;
    for (const job of [...this.queue, ...this.active])
      this.finish(job, { truncated: true, reason: "aborted" });
    await Promise.allSettled([...this.settling]);
  }
}
