import type { BrowserContext } from "playwright-core";
import { BrowserError } from "./failure.js";

export interface BrowserOwner {
  readonly workbenchId: string;
  readonly sessionId: string;
}

/** A policy binds before tabs open. Acquisition and attachment must observe the startup signal. */
export interface BrowserNetworkLease {
  readonly proxyServer: string;
  attach(context: BrowserContext, signal: AbortSignal): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface BrowserNetworkPolicy {
  acquire(owner: BrowserOwner, signal: AbortSignal): Promise<BrowserNetworkLease>;
}

export const denyBrowserNetwork: BrowserNetworkPolicy = {
  async acquire() {
    throw new BrowserError("policy-denied");
  },
};
