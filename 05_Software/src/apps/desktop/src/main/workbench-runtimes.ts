import type { WorkbenchOpenGuard, WorkbenchService } from "@vera/core";
import { veraError, type WorkbenchCreate, type WorkbenchSnapshot } from "@vera/shared";
import type { SessionsHost } from "./sessions.js";

/**
 * One open workbench: its own lifecycle service (lock, database, write queue, indexing, folder grants)
 * and its own session host, whose session service, turns and program host belong to that workbench.
 */
export interface WorkbenchRuntime {
  readonly workbench: Pick<
    WorkbenchService,
    "locate" | "open" | "create" | "close" | "getSnapshot" | "getDatabase"
  >;
  readonly sessions: Pick<SessionsHost, "lifecycle" | "close" | "idle" | "busy" | "beginShutdown">;
}

/** The canonical folder of the runtime's open workbench; undefined while none is open. */
function folderOf(runtime: WorkbenchRuntime): string | undefined {
  try {
    return runtime.workbench.getSnapshot().folder;
  } catch {
    return undefined;
  }
}

/** Runs `step` for every runtime, waits for all of them and rethrows the first failure. */
async function each<R>(runtimes: readonly R[], step: (runtime: R) => Promise<unknown>): Promise<void> {
  const results = await Promise.allSettled(runtimes.map(step));
  const failed = results.find((result) => result.status === "rejected");
  if (failed) throw failed.reason;
}

/**
 * The workbench runtimes of the Desktop app. The foreground runtime holds the workbench the window shows.
 * When another workbench comes to the foreground, the previous one stays open in the background while it
 * has owned work (queued session operations, turns, approvals, compaction) and is released when that work
 * settles; an idle one is released at once. Lifecycle changes run one at a time.
 */
export class WorkbenchRuntimes<R extends WorkbenchRuntime> {
  private current: R;
  /** Background runtimes by canonical folder, in the order they were retained. */
  private readonly retained = new Map<string, R>();
  private queue: Promise<void> = Promise.resolve();
  private pending = 0;
  private shutdown = false;
  constructor(
    private readonly options: {
      /** A runtime with no open workbench; it calls `settled` when its owned work may have settled. */
      create: (settled: () => void) => R;
      /** Stops the plugin program runs of a workbench folder whose runtime is being released. */
      stopPrograms: (folder: string) => Promise<void>;
      log?: (event: string) => void;
      /** The set of open runtimes or the foreground may have changed: after each lifecycle change and release. */
      changed?: () => void;
    },
  ) {
    this.current = this.make();
  }
  /** The runtime of the workbench the window shows; it may have no workbench open. */
  get foreground(): R {
    return this.current;
  }
  /** The foreground runtime, then the background runtimes. */
  all(): R[] {
    return [this.current, ...this.retained.values()];
  }
  /**
   * Brings the workbench at `input` to the foreground: the current one is reopened in place and a
   * background one is reused, both keeping their session service and turns. If opening fails, every
   * runtime stays as it was.
   */
  open(input: string, guard?: WorkbenchOpenGuard): Promise<WorkbenchSnapshot> {
    return this.lifecycle(async () => {
      const folder = await this.current.workbench.locate(input);
      if (guard && folder !== input) throw veraError("NOT_FOUND");
      const target = this.target(folder);
      if (guard && folderOf(target) === folder) {
        const snapshot = target.workbench.getSnapshot();
        guard(snapshot, target.workbench.getDatabase());
        await this.promote(target);
        return snapshot;
      }
      const snapshot = await target.sessions.lifecycle(() => target.workbench.open(input, guard), false);
      await this.promote(target);
      return snapshot;
    });
  }
  /** Creates a workbench in a new runtime and brings it to the foreground. */
  create(
    input: string,
    name: string,
    initial: Pick<WorkbenchCreate, "config" | "instructions"> = {},
  ): Promise<WorkbenchSnapshot> {
    return this.lifecycle(async () => {
      const target = folderOf(this.current) === undefined ? this.current : this.make();
      const snapshot = await target.sessions.lifecycle(
        () => target.workbench.create(input, name, initial),
        false,
      );
      await this.promote(target);
      return snapshot;
    });
  }
  /** Closes the foreground workbench, ending its turns; background workbenches keep running. */
  close(): Promise<void> {
    return this.lifecycle(() => this.release(this.current, folderOf(this.current)));
  }
  /** Synchronous check-and-lock for a safe update: refuses while any runtime or lifecycle change has work. */
  beginShutdown(): boolean {
    if (this.pending || this.all().some((runtime) => runtime.sessions.busy())) return false;
    this.shutdown = true;
    for (const runtime of this.all()) runtime.sessions.beginShutdown();
    return true;
  }
  /** App exit: ends the sessions of every runtime. Later lifecycle changes return BUSY. */
  closeSessions(): Promise<void> {
    this.shutdown = true;
    return this.serial(() => each(this.all(), (runtime) => runtime.sessions.close()));
  }
  /** App exit, after closeSessions: closes every workbench, releasing its lock, database and indexing. */
  closeWorkbenches(): Promise<void> {
    this.shutdown = true;
    return this.serial(() => each(this.all(), (runtime) => runtime.workbench.close()));
  }
  private make(): R {
    const runtime: R = this.options.create(() => this.settled(runtime));
    return runtime;
  }
  /** The runtime that opens `folder`: the foreground, a background one, the empty foreground or a new one. */
  private target(folder: string): R {
    const current = folderOf(this.current);
    if (current === folder) return this.current;
    return this.retained.get(folder) ?? (current === undefined ? this.current : this.make());
  }
  private async promote(target: R): Promise<void> {
    const previous = this.current;
    if (target === previous) return;
    for (const [folder, runtime] of this.retained) if (runtime === target) this.retained.delete(folder);
    this.current = target;
    // The previous workbench keeps its work and its session subscriptions, which belong to their sessions.
    const folder = folderOf(previous);
    if (folder === undefined) return;
    if (!previous.sessions.idle()) this.retained.set(folder, previous);
    else await this.retire(previous, folder);
  }
  /** A background runtime whose owned work settled is released, unless it has work again or came back. */
  private settled(runtime: R): void {
    if (this.shutdown || ![...this.retained.values()].includes(runtime) || !runtime.sessions.idle()) return;
    void this.serial(async () => {
      const folder = folderOf(runtime);
      if (this.shutdown || folder === undefined || this.retained.get(folder) !== runtime) return;
      if (!runtime.sessions.idle()) return;
      this.retained.delete(folder);
      await this.retire(runtime, folder);
      this.announce();
    });
  }
  /** Releases a runtime that left the foreground; a failure keeps it for the exit drain. */
  private async retire(runtime: R, folder: string): Promise<void> {
    try {
      await this.release(runtime, folder);
    } catch {
      this.retained.set(folder, runtime);
      this.options.log?.("workbench.release.failed");
    }
  }
  /** Ends the runtime's sessions and program runs, then closes its workbench, in one host slot. */
  private release(runtime: R, folder: string | undefined): Promise<void> {
    return runtime.sessions.lifecycle(async () => {
      if (folder !== undefined) await this.options.stopPrograms(folder);
      await runtime.workbench.close();
    });
  }
  private lifecycle<T>(operation: () => Promise<T>): Promise<T> {
    if (this.shutdown) return Promise.reject(veraError("BUSY"));
    this.pending++;
    return this.serial(async () => {
      if (this.shutdown) throw veraError("BUSY");
      return operation();
    }).finally(() => {
      this.pending--;
      this.announce();
    });
  }
  private announce(): void {
    try {
      this.options.changed?.();
    } catch {
      /* an observer never fails a lifecycle change */
    }
  }
  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation);
    this.queue = next.then(
      () => {},
      () => {},
    );
    return next;
  }
}
