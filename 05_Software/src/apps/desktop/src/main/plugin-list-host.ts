import { Worker } from "node:worker_threads";
import { type PluginInstalled, pluginInstalledSchema, veraError } from "@vera/shared";

/** Full integrity listing off main; shares only identical pending reads, never stale completed results. */
export class PluginListingHost {
  private readonly pending = new Map<
    string,
    { worker: Worker; result: Promise<PluginInstalled[]>; reject: (error: unknown) => void }
  >();
  private closed = false;
  constructor(
    private readonly root: string,
    private readonly entry = new URL("./plugin-list-worker.js", import.meta.url),
  ) {}
  list(workbench?: string): Promise<PluginInstalled[]> {
    if (this.closed) return Promise.reject(veraError("BUSY"));
    const key = JSON.stringify([this.root, workbench ?? ""]);
    const existing = this.pending.get(key);
    if (existing) return existing.result;
    const worker = new Worker(this.entry, { workerData: { root: this.root, workbench } });
    let rejectResult: (error: unknown) => void = () => {};
    const result = new Promise<PluginInstalled[]>((resolve, reject) => {
      rejectResult = reject;
      worker.once("message", (message) => {
        if (message?.error) {
          reject(message.error);
          return;
        }
        const parsed = pluginInstalledSchema.array().max(1024).safeParse(message?.plugins);
        if (parsed.success) resolve(parsed.data);
        else reject(veraError("INTERNAL"));
      });
      worker.once("error", () => reject(veraError("INTERNAL")));
      worker.once("exit", () => reject(veraError("INTERNAL")));
    });
    this.pending.set(key, { worker, result, reject: rejectResult });
    const timeout = setTimeout(() => rejectResult(veraError("BUSY")), 60_000);
    void result
      .finally(() => {
        clearTimeout(timeout);
        if (this.pending.get(key)?.result === result) this.pending.delete(key);
        return worker.terminate();
      })
      .catch(() => {});
    return result;
  }
  async close(): Promise<void> {
    this.closed = true;
    const pending = [...this.pending.values()];
    for (const item of pending) item.reject(veraError("BUSY"));
    await Promise.allSettled(pending.map((item) => item.worker.terminate()));
    this.pending.clear();
  }
}
