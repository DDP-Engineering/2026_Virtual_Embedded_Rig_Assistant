import type { BrowserContext } from "playwright-core";
import { BrowserError } from "./failure.js";
import { type BrowserNetworkPorts, browserNetwork, browserUrl } from "./network.js";
import { createBrowserProxy } from "./proxy.js";

export interface BrowserOwner {
  readonly workbenchId: string;
  readonly sessionId: string;
}

/** A policy binds before tabs open. Acquisition and attachment observe the startup signal. */
export interface BrowserNetworkLease {
  readonly proxyServer: string;
  readonly certificatePin?: string;
  readonly revoked?: AbortSignal;
  attach(context: BrowserContext, signal: AbortSignal): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface BrowserNetworkPolicy {
  acquire(owner: BrowserOwner, signal: AbortSignal): Promise<BrowserNetworkLease>;
  release?(owner: BrowserOwner): void;
  releaseWorkbench?(workbenchId: string): void;
  releaseAll?(): void;
}

export const denyBrowserNetwork: BrowserNetworkPolicy = {
  async acquire() {
    throw new BrowserError("policy-denied");
  },
};

interface Grant {
  owner: BrowserOwner;
  origins: Set<string>;
  revoked: AbortController;
  leased: boolean;
}

const maxOwners = 32;
const maxOrigins = 32;

/** Desktop main owns the only grant path. Browser and agent callers can only consume grants. */
export class BrowserAccessPolicy implements BrowserNetworkPolicy {
  private readonly grants = new Map<string, Grant>();

  constructor(
    private readonly enabled: (workbenchId: string) => boolean,
    private readonly ports: BrowserNetworkPorts = browserNetwork,
  ) {}

  isEnabled(workbenchId: string): boolean {
    try {
      return this.enabled(workbenchId) === true;
    } catch {
      return false;
    }
  }

  grant(owner: BrowserOwner, value: string): string {
    if (!this.isEnabled(owner.workbenchId)) throw new BrowserError("policy-denied");
    const url = browserUrl(value);
    if (url.pathname !== "/" || url.search || url.hash) throw new BrowserError("destination-denied");
    const key = keyFor(owner);
    let grant = this.grants.get(key);
    if (!grant) {
      if (this.grants.size >= maxOwners) throw new BrowserError("session-limit");
      grant = { owner: { ...owner }, origins: new Set(), revoked: new AbortController(), leased: false };
      this.grants.set(key, grant);
    }
    if (!grant.origins.has(url.origin) && grant.origins.size >= maxOrigins)
      throw new BrowserError("resource-limit");
    grant.origins.add(url.origin);
    return url.origin;
  }

  authorization(owner: BrowserOwner): AbortSignal | undefined {
    if (!this.isEnabled(owner.workbenchId)) return undefined;
    return this.grants.get(keyFor(owner))?.revoked.signal;
  }

  origins(owner: BrowserOwner): readonly string[] {
    if (!this.isEnabled(owner.workbenchId)) return [];
    return Array.from(this.grants.get(keyFor(owner))?.origins ?? []);
  }

  reconcile(): void {
    for (const grant of this.grants.values()) {
      if (!this.isEnabled(grant.owner.workbenchId)) this.remove(grant);
    }
  }

  release(owner: BrowserOwner): void {
    const grant = this.grants.get(keyFor(owner));
    if (grant) this.remove(grant);
  }

  releaseWorkbench(workbenchId: string): void {
    for (const grant of this.grants.values()) {
      if (grant.owner.workbenchId === workbenchId) this.remove(grant);
    }
  }

  releaseAll(): void {
    for (const grant of this.grants.values()) this.remove(grant);
  }

  async acquire(owner: BrowserOwner, signal: AbortSignal): Promise<BrowserNetworkLease> {
    signal.throwIfAborted();
    const grant = this.grants.get(keyFor(owner));
    if (!grant || grant.leased || !this.isEnabled(owner.workbenchId)) throw new BrowserError("policy-denied");
    grant.leased = true;
    const revoked = grant.revoked.signal;
    const authorize = (url: URL) => {
      revoked.throwIfAborted();
      if (!this.isEnabled(owner.workbenchId) || !grant.origins.has(url.origin))
        throw new BrowserError("destination-denied");
    };
    try {
      const proxy = await createBrowserProxy(authorize, this.ports, revoked);
      if (signal.aborted) {
        await proxy.close();
        signal.throwIfAborted();
      }
      return {
        ...proxy,
        revoked,
        async attach(context, startupSignal) {
          startupSignal.throwIfAborted();
          await context.routeWebSocket("**/*", (route) => route.close());
        },
        close: () => {
          this.remove(grant);
          return proxy.close();
        },
      };
    } catch (error) {
      this.remove(grant);
      throw error;
    }
  }

  private remove(grant: Grant): void {
    const key = keyFor(grant.owner);
    if (this.grants.get(key) === grant) this.grants.delete(key);
    grant.revoked.abort(new BrowserError("cancelled"));
  }
}

function keyFor(owner: BrowserOwner): string {
  return JSON.stringify([owner.workbenchId, owner.sessionId]);
}
