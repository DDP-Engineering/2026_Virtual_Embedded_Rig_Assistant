import { it } from "vitest";

/** Names a gated suite that does not run on this host, so the report shows the skip and what enables it. */
export function reportSkip(missing: unknown, suite: string, reason: string): void {
  if (missing) it.skip(`skips ${suite}: ${reason}`, () => {});
}
