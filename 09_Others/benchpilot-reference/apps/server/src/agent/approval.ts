// Approval gate (04 §4): a pending propose_test_plan waits here until POST /plans/:id/decision resolves it.
// The decision itself (validation, DB transition, plan.decided) is done by the runtime before `resolve`.
import type { ApprovalWaiter, PlanDecisionResult } from "../tools/registry.ts";

export class AbortedError extends Error {
  override name = "AbortError";
  constructor(message = "aborted") {
    super(message);
  }
}

export class ApprovalGate implements ApprovalWaiter {
  private readonly waiters = new Map<string, { sessionId: string; resolve: (d: PlanDecisionResult) => void }>();

  wait(planId: string, sessionId: string, signal: AbortSignal): Promise<PlanDecisionResult> {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(new AbortedError());
      const onAbort = () => {
        this.waiters.delete(planId);
        reject(new AbortedError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.waiters.set(planId, {
        sessionId,
        resolve: (d) => {
          signal.removeEventListener("abort", onAbort);
          this.waiters.delete(planId);
          resolve(d);
        },
      });
    });
  }

  /** True when a running turn is waiting on this plan. */
  isWaiting(planId: string): boolean {
    return this.waiters.has(planId);
  }

  resolve(planId: string, d: PlanDecisionResult): boolean {
    const w = this.waiters.get(planId);
    if (!w) return false;
    w.resolve(d);
    return true;
  }
}
