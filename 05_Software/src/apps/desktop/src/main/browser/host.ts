import type { Page } from "playwright-core";
import { BrowserError } from "./failure.js";
import { type BrowserProcess, launchBrowser } from "./launcher.js";
import {
  type BrowserNetworkLease,
  type BrowserNetworkPolicy,
  type BrowserOwner,
  denyBrowserNetwork,
} from "./policy.js";
import type { BrowserRuntime } from "./runtime.js";

export const browserLimits = {
  sessions: 3,
  tabs: 4,
  startupMs: 30_000,
  lifetimeMs: 30 * 60_000,
} as const;

/** Main-process operations for an owned session; page handles stay in the main process. */
export interface BrowserSession {
  readonly closed: AbortSignal;
  newTab(): Promise<Page>;
  tabs(): readonly Page[];
  close(): Promise<void>;
}

interface Entry {
  owner: BrowserOwner;
  controller: AbortController;
  ready: Promise<BrowserSession>;
  lease?: BrowserNetworkLease;
  child?: BrowserProcess;
  expires?: ReturnType<typeof setTimeout>;
  disposal?: Promise<void>;
}

interface HostOptions {
  policy?: BrowserNetworkPolicy;
  launch?: typeof launchBrowser;
}

/** Owns Chromium sessions from authorization to release, including in-flight startups. */
export class BrowserHost {
  private readonly policy: BrowserNetworkPolicy;
  private readonly launch: typeof launchBrowser;
  private readonly entries = new Map<string, Entry>();
  private suspended = false;
  private shutdownPromise?: Promise<void>;

  constructor(
    private readonly runtime: Pick<BrowserRuntime, "executable">,
    options: HostOptions = {},
  ) {
    this.policy = options.policy ?? denyBrowserNetwork;
    this.launch = options.launch ?? launchBrowser;
  }

  /** A caller signal cancels startup. Close the session or its workbench to cancel after startup. */
  open(owner: BrowserOwner, startupSignal?: AbortSignal): Promise<BrowserSession> {
    if (this.suspended || this.shutdownPromise || startupSignal?.aborted)
      return Promise.reject(new BrowserError("cancelled"));
    const key = keyFor(owner);
    const existing = this.entries.get(key);
    if (existing) {
      if (existing.controller.signal.aborted) return Promise.reject(new BrowserError("cancelled"));
      return existing.ready;
    }
    if (this.entries.size >= browserLimits.sessions) return Promise.reject(new BrowserError("session-limit"));

    const entry: Entry = {
      owner: { ...owner },
      controller: new AbortController(),
      ready: Promise.resolve().then(() => this.start(entry, startupSignal)),
    };
    this.entries.set(key, entry);
    return entry.ready;
  }

  suspend(): void {
    this.suspended = true;
  }

  resume(): void {
    this.suspended = false;
  }

  async closeSession(owner: BrowserOwner): Promise<void> {
    const entry = this.entries.get(keyFor(owner));
    this.policy.release?.(owner);
    if (entry) await this.closeEntry(entry);
  }

  async closeWorkbench(workbenchId: string): Promise<void> {
    this.policy.releaseWorkbench?.(workbenchId);
    await this.closeEntries(
      Array.from(this.entries.values()).filter((entry) => entry.owner.workbenchId === workbenchId),
    );
  }

  shutdown(): Promise<void> {
    this.policy.releaseAll?.();
    this.shutdownPromise ??= this.closeEntries(Array.from(this.entries.values()));
    return this.shutdownPromise;
  }

  private async start(entry: Entry, callerSignal?: AbortSignal): Promise<BrowserSession> {
    const deadline = performance.now() + browserLimits.startupMs;
    const timer = new AbortController();
    const startupTimer = setTimeout(() => timer.abort(), browserLimits.startupMs);
    startupTimer.unref();
    const timeout = timer.signal;
    const signal = AbortSignal.any([
      entry.controller.signal,
      timeout,
      ...(callerSignal ? [callerSignal] : []),
    ]);
    try {
      signal.throwIfAborted();
      const acquiring = this.policy.acquire(entry.owner, signal).then(async (lease) => {
        if (signal.aborted) {
          await lease.close();
          signal.throwIfAborted();
        }
        entry.lease = lease;
        return lease;
      });
      const lease = await duringStartup(acquiring, signal);
      if (!lease.proxyServer) throw new BrowserError("policy-denied");
      const revoke = () => {
        if (!entry.disposal) void this.closeEntry(entry).catch(() => {});
      };
      lease.revoked?.addEventListener("abort", revoke, { once: true });
      if (lease.revoked?.aborted) revoke();
      signal.throwIfAborted();
      const executable = await duringStartup(this.runtime.executable(signal), signal);
      signal.throwIfAborted();
      const remaining = Math.ceil(deadline - performance.now());
      if (remaining <= 0) timer.abort();
      signal.throwIfAborted();
      entry.child = await this.launch(executable, signal, lease.proxyServer, remaining, lease.certificatePin);
      entry.child.onExit(() => {
        void this.closeEntry(entry).catch(() => {});
      });
      signal.throwIfAborted();
      const { context } = entry.child;
      await duringStartup(Promise.resolve(lease.attach(context, signal)), signal);
      signal.throwIfAborted();

      // Keep rejected popups off the agent surface while Chromium closes them.
      const rejected = new WeakSet<Page>();
      context.on("page", (page) => {
        if (context.pages().indexOf(page) >= browserLimits.tabs) {
          rejected.add(page);
          void page.close().catch(() => {});
        }
      });
      let queued: Promise<unknown> = Promise.resolve();
      entry.expires = setTimeout(() => void this.closeEntry(entry).catch(() => {}), browserLimits.lifetimeMs);
      entry.expires.unref();
      return {
        closed: entry.controller.signal,
        newTab: () => {
          const open = queued.then(async () => {
            if (entry.controller.signal.aborted) throw new BrowserError("cancelled");
            if (context.pages().length >= browserLimits.tabs) throw new BrowserError("tab-limit");
            const page = await context.newPage();
            if (entry.controller.signal.aborted) throw new BrowserError("cancelled");
            if (rejected.has(page)) throw new BrowserError("tab-limit");
            return page;
          });
          queued = open.catch(() => {});
          return open;
        },
        tabs: () =>
          entry.controller.signal.aborted
            ? []
            : context
                .pages()
                .filter((page) => !rejected.has(page))
                .slice(0, browserLimits.tabs),
        close: () => this.closeEntry(entry),
      };
    } catch (error) {
      await this.dispose(entry);
      if (signal.aborted)
        throw new BrowserError(timeout.aborted ? "startup-timeout" : "cancelled", { cause: error });
      throw error;
    } finally {
      clearTimeout(startupTimer);
    }
  }

  private async closeEntry(entry: Entry): Promise<void> {
    entry.controller.abort();
    await entry.ready.catch(() => {});
    await this.dispose(entry);
  }

  private async closeEntries(entries: Entry[]): Promise<void> {
    // Wait for all owned sessions even if one of their cleanup steps fails.
    const results = await Promise.allSettled(entries.map((entry) => this.closeEntry(entry)));
    const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
    if (failures.length) throw new AggregateError(failures, "Browser session cleanup failed");
  }

  private dispose(entry: Entry): Promise<void> {
    entry.disposal ??= Promise.resolve().then(async () => {
      clearTimeout(entry.expires);
      try {
        const results = await Promise.allSettled([
          Promise.resolve().then(() => entry.lease?.close()),
          Promise.resolve().then(() => entry.child?.close()),
        ]);
        const failures = results
          .filter((result) => result.status === "rejected")
          .map((result) => result.reason);
        if (failures.length) throw new AggregateError(failures, "Browser resource cleanup failed");
      } finally {
        this.entries.delete(keyFor(entry.owner));
      }
    });
    return entry.disposal;
  }
}

/** Stop waiting on hooks at the startup deadline, even if a hook omits cancellation handling. */
async function duringStartup<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort: () => void = () => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([operation, cancelled]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

function keyFor(owner: BrowserOwner): string {
  return JSON.stringify([owner.workbenchId, owner.sessionId]);
}
