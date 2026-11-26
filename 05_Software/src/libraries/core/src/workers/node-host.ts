import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import type { GrepFileResult, GrepMatch, WorkerPool, WorkerResult, WorkerTask } from "../ports.js";

export interface WorkerHostOptions {
  capacity?: number;
  /** A fixed deadline, or the host's current Worker deadline read as each task starts (REQ-FUNC-5eacaf9f). */
  deadlineMs?: number | (() => number);
}
const validDeadline = (value: number) => Number.isFinite(value) && value > 0;
interface Pending {
  task: WorkerTask;
  signal: AbortSignal;
  deadline: number;
  matches: GrepMatch[];
  files?: GrepFileResult[];
  value?: WorkerResult["value"];
  worker?: Worker;
  terminal: boolean;
  timer?: ReturnType<typeof setTimeout>;
  abort: () => void;
  resolve: (result: WorkerResult) => void;
  onPartial?: (value: unknown) => void;
}

/**
 * Absolute deadlines belong to this host and start when a task gets its worker: a task waiting behind
 * others is never reported as timed out without having run. One task per worker.
 */
export class NodeWorkerPool implements WorkerPool {
  private readonly deadline: () => number;
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
    const deadline = options.deadlineMs ?? 10000;
    this.deadline = typeof deadline === "function" ? deadline : () => deadline;
    this.capacity = options.capacity ?? 2;
    // A getter is read only when a task starts: the host may build the pool before its settings exist.
    if (
      (typeof deadline === "number" && !validDeadline(deadline)) ||
      !Number.isInteger(this.capacity) ||
      this.capacity < 1
    )
      throw Error("Invalid worker host limits.");
  }
  /** The deadline the next task starts with; an invalid host value falls back to 10 s. */
  get deadlineMs(): number {
    let value: number;
    try {
      value = this.deadline();
    } catch {
      return 10000;
    }
    return validDeadline(value) ? value : 10000;
  }
  run(task: WorkerTask, signal: AbortSignal, onPartial?: (value: unknown) => void): Promise<WorkerResult> {
    if (signal.aborted || this.closed)
      return Promise.resolve({ matches: [], truncated: true, reason: "aborted" });
    return new Promise((resolve) => {
      const job: Pending = {
        task: structuredClone(task),
        signal,
        deadline: Number.POSITIVE_INFINITY,
        matches: [],
        terminal: false,
        resolve,
        ...(onPartial ? { onPartial } : {}),
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
      this.active.add(job);
      // Read once as the task starts: a running task keeps the deadline it started with.
      const deadlineMs = this.deadlineMs;
      job.deadline = performance.now() + deadlineMs;
      job.timer = setTimeout(() => {
        this.finish(job, { truncated: true, reason: "timeout" });
      }, deadlineMs);
      try {
        const worker = new Worker(this.entry);
        job.worker = worker;
        worker.on(
          "message",
          (message: {
            type: string;
            match?: GrepMatch;
            file?: GrepFileResult;
            truncated?: boolean;
            skipped?: number;
            error?: string;
            value?: WorkerResult["value"];
            failure?: WorkerResult["failure"];
          }) => {
            if (job.terminal) return;
            if (performance.now() >= job.deadline) {
              this.finish(job, { truncated: true, reason: "timeout" });
              return;
            }
            let partial: unknown;
            if (message.type === "partial" && message.match) {
              job.matches.push(message.match);
              partial = message.match;
            } else if (message.type === "file" && message.file) {
              job.files ??= [];
              job.files.push(message.file);
              partial = message.file;
            } else if (message.type === "checkpoint" && message.value) {
              job.value = message.value;
              partial = message.value;
            } else if (message.type === "done")
              this.finish(job, {
                truncated: message.truncated ?? false,
                ...(message.skipped ? { skipped: message.skipped } : {}),
                ...(message.value ? { value: message.value } : {}),
              });
            else if (message.type === "error")
              this.finish(job, {
                truncated: false,
                error: message.error ?? "Worker task failed.",
                ...(message.failure ? { failure: message.failure } : {}),
              });
            if (partial !== undefined)
              try {
                job.onPartial?.(structuredClone(partial));
              } catch {
                /* observers cannot strand tasks */
              }
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
  private finish(job: Pending, result: Omit<WorkerResult, "matches" | "files">): void {
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
        job.resolve({
          matches: job.matches,
          ...(job.files ? { files: job.files } : {}),
          ...(job.value ? { value: job.value } : {}),
          ...result,
        });
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
