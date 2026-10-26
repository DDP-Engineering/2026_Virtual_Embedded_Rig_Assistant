import { NodeWorkerPool, type WorkerHostOptions } from "@vera/core";
/** The headless CLI composes the same host-owned deadline/termination port. */
export function createCliWorkerPool(options: WorkerHostOptions = {}) {
  return new NodeWorkerPool(new URL("./grep-worker.js", import.meta.url), options);
}
