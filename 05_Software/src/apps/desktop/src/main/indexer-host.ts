import type {
  DocumentInput,
  DocumentProcessor,
  DocumentResult,
  EmbeddingPort,
  InspectInput,
  SelectInput,
  Selection,
  SemanticHit,
  SourceInspection,
} from "@vera/core";

/** The parts of an Electron UtilityProcess the host uses; tests script it. */
export interface IndexerEndpoint {
  readonly pid?: number | undefined;
  postMessage(message: unknown): void;
  on(event: "message", listener: (message: unknown) => void): unknown;
  on(event: "exit", listener: (code: number) => void): unknown;
  kill(): unknown;
}
export type IndexerState = "running" | "stopped";
export interface IndexerHostOptions {
  spawn: () => IndexerEndpoint;
  modelId: string;
  now?: () => number;
  /** Reports "stopped" after repeated crashes and "running" after every (re)start. */
  status?: (state: IndexerState) => void;
}
const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 60_000;
/** Calls lost with the process are retried by the next reconciliation (REQ-REL-6a962d80). */
const interrupted = (message: string) => Object.assign(Error(message), { retry: true });
type Reply = {
  id?: unknown;
  ok?: unknown;
  value?: unknown;
  error?: { message?: string; aborted?: boolean; code?: string };
};

/**
 * Runs document selection, hashing, processing and embeddings in the VERA Indexer utility process
 * (TASK-f09609fd). Main keeps every SQLite write. A crash fails the calls in flight with a retry
 * error and restarts the process; three crashes within a minute stop it until restart().
 */
export class IndexerHost {
  readonly processor: DocumentProcessor;
  readonly embeddings: EmbeddingPort;
  private endpoint: IndexerEndpoint | undefined;
  private next = 1;
  private readonly pending = new Map<
    number,
    { resolve(value: unknown): void; reject(error: unknown): void }
  >();
  private crashes: number[] = [];
  private stopped = false;
  private closed = false;

  constructor(private readonly options: IndexerHostOptions) {
    const processor = ((input: DocumentInput) =>
      this.call<DocumentResult>(
        {
          type: "process",
          input: {
            root: input.root,
            path: input.path,
            kind: input.kind,
            sha256: input.sha256,
            ...(input.embeddings ? { embeddings: input.embeddings } : {}),
          },
        },
        input.signal,
      )) as DocumentProcessor;
    processor.modelId = options.modelId;
    processor.release = async (root) => this.release(root);
    processor.select = (input: SelectInput) =>
      this.call<Selection>({ type: "select", input: { root: input.root, docs: input.docs } }, input.signal);
    processor.inspect = (input: InspectInput) =>
      this.call<SourceInspection>(
        {
          type: "inspect",
          input: { root: input.root, path: input.path, kind: input.kind, identity: input.identity },
        },
        input.signal,
      );
    this.processor = processor;
    this.embeddings = {
      modelId: options.modelId,
      embed: (root, texts, signal) => this.call<Float32Array[]>({ type: "embed", root, texts }, signal),
      rank: async (root, epoch, rows, query, signal) => {
        type Ranked = { needRows?: boolean; hits?: SemanticHit[] };
        const first = await this.call<Ranked>({ type: "rank", root, epoch, query }, signal);
        if (!first.needRows) return first.hits ?? [];
        const vectors = typeof rows === "function" ? rows() : rows;
        return (
          (await this.call<Ranked>({ type: "rank", root, epoch, query, rows: vectors }, signal)).hits ?? []
        );
      },
      release: async (root) => this.release(root),
    };
  }
  state(): IndexerState {
    return this.stopped ? "stopped" : "running";
  }
  /** The indexer process id while it runs (tests kill it). */
  pid(): number | undefined {
    return this.endpoint?.pid;
  }
  /**
   * Asks the indexer to free a workbench's embedding worker without waiting: after its calls are
   * cancelled nothing of a closed workbench is shared, so closing never waits on the indexer.
   */
  private release(root: string): void {
    if (!this.endpoint || this.stopped || this.closed) return;
    this.call({ type: "release", root }).catch(() => {});
  }
  /** Starts the indexer again after it stopped; Docs offers it as Restart. */
  restart(): void {
    if (this.closed) return;
    this.stopped = false;
    this.crashes = [];
    if (this.endpoint || this.start()) this.options.status?.("running");
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const endpoint = this.endpoint;
    this.endpoint = undefined;
    this.fail(Error("Indexer closed."));
    endpoint?.kill();
  }
  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
  /** Starts the indexer; a failed start counts as a crash (RULING-007). */
  private start(): IndexerEndpoint | undefined {
    let endpoint: IndexerEndpoint;
    try {
      endpoint = this.options.spawn();
    } catch {
      this.crashed();
      return this.endpoint;
    }
    this.endpoint = endpoint;
    endpoint.on("message", (message) => this.receive(endpoint, message));
    endpoint.on("exit", () => this.exited(endpoint));
    return endpoint;
  }
  private fail(error: Error): void {
    const calls = [...this.pending.values()];
    this.pending.clear();
    for (const call of calls) call.reject(error);
  }
  private receive(endpoint: IndexerEndpoint, message: unknown): void {
    if (endpoint !== this.endpoint) return;
    const reply = (message ?? {}) as Reply;
    if (typeof reply.id !== "number") return;
    const call = this.pending.get(reply.id);
    // A late answer to a cancelled call has no taker.
    if (!call) return;
    this.pending.delete(reply.id);
    if (reply.ok === true) call.resolve(reply.value);
    else
      call.reject(
        Object.assign(Error(reply.error?.message ?? "Indexer request failed."), {
          ...(reply.error?.aborted ? { name: "AbortError" } : {}),
          ...(typeof reply.error?.code === "string" ? { code: reply.error.code } : {}),
        }),
      );
  }
  private exited(endpoint: IndexerEndpoint): void {
    if (endpoint !== this.endpoint) return;
    this.endpoint = undefined;
    // Marked as crashed: ingest counts these per document (RULING-006).
    this.fail(Object.assign(interrupted("The indexer process stopped."), { crashed: true }));
    if (this.closed) return;
    this.crashed();
  }
  /** Counts a crash; restarts, or stops after three within a minute. */
  private crashed(): void {
    const now = this.now();
    this.crashes = [...this.crashes.filter((at) => now - at <= CRASH_WINDOW_MS), now];
    if (this.crashes.length >= CRASH_LIMIT) {
      this.stopped = true;
      this.options.status?.("stopped");
      return;
    }
    if (this.start()) this.options.status?.("running");
  }
  private call<T>(message: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    if (this.closed) return Promise.reject(Error("Indexer closed."));
    if (this.stopped) return Promise.reject(interrupted("Indexing stopped."));
    if (signal?.aborted) return Promise.reject(signal.reason ?? Error("Aborted."));
    const endpoint = this.endpoint ?? this.start();
    if (!endpoint)
      return Promise.reject(
        interrupted(this.stopped ? "Indexing stopped." : "The indexer process is unavailable."),
      );
    const id = this.next++;
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        if (!this.pending.delete(id)) return;
        this.endpoint?.postMessage({ type: "cancel", id });
        reject(signal?.reason ?? Error("Aborted."));
      };
      this.pending.set(id, {
        resolve: (value) => {
          signal?.removeEventListener("abort", abort);
          resolve(value as T);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", abort);
          reject(error);
        },
      });
      signal?.addEventListener("abort", abort, { once: true });
      try {
        endpoint.postMessage({ id, ...message });
      } catch {
        this.pending.get(id)?.reject(interrupted("The indexer process is unavailable."));
        this.pending.delete(id);
      }
    });
  }
}
