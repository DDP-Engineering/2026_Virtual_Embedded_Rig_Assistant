import { NodeWorkerPool, type WorkerHostOptions } from "@vera/core";
/** Worker entry is an independent production bundle beside main/index.js. */
export function createDesktopWorkerPool(options: WorkerHostOptions = {}) {
  return new NodeWorkerPool(new URL("./grep-worker.js", import.meta.url), options);
}
