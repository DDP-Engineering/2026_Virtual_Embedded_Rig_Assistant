import type { WorkerResult } from "@vera/core";
import { createDesktopWorkerPool } from "./worker-pool.js";
/** Instrumented acceptance uses production host capacity with an injected test deadline. */
export function createFileToolProbe() {
  let pool = createDesktopWorkerPool();
  let controller: AbortController | undefined;
  let outcome: Promise<WorkerResult> | undefined;
  let partials = 0;
  return {
    async start(root: string, args: unknown, deadlineMs?: number, kind: "grep" | "parse_log" = "grep") {
      if (outcome) await outcome;
      if (deadlineMs !== undefined) {
        await pool.dispose();
        pool = createDesktopWorkerPool({ deadlineMs, capacity: 1 });
      }
      controller = new AbortController();
      partials = 0;
      outcome = pool.run({ kind, root, args }, controller.signal, () => {
        partials++;
      });
    },
    partials: () => partials,
    result: () => outcome,
    abort: () => controller?.abort(),
    dispose: () => pool.dispose(),
  };
}
