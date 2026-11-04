import type { PluginStore, Provisioner } from "@vera/core";
import { veraError } from "@vera/shared";

/** Request-bound stores share application shutdown ownership; no host can outlive quit. */
export class ProvisionerHosts {
  private readonly active = new Set<Provisioner>();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  constructor(private readonly create: (store: PluginStore) => Provisioner) {}
  async run<T>(store: PluginStore, operation: (host: Provisioner) => Promise<T>): Promise<T> {
    if (this.closed) throw veraError("BUSY");
    const host = this.create(store);
    this.active.add(host);
    const done = Promise.resolve().then(() => operation(host));
    this.pending.add(done);
    try {
      return await done;
    } finally {
      await host.drain();
      this.active.delete(host);
      this.pending.delete(done);
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...[...this.active].map((host) => host.drain()), ...this.pending]);
  }
}
