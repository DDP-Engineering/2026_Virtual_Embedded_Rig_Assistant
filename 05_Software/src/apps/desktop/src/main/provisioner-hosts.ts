import type { PluginStore, Provisioner } from "@vera/core";
import { veraError } from "@vera/shared";

/** Request-bound stores share application shutdown ownership; no host can outlive quit. */
export class ProvisionerHosts {
  private readonly active = new Set<Provisioner>();
  private readonly shared = new Map<string, { host: Provisioner; users: number }>();
  private readonly pending = new Set<Promise<unknown>>();
  private closed = false;
  constructor(private readonly create: (store: PluginStore) => Provisioner) {}
  async run<T>(store: PluginStore, operation: (host: Provisioner) => Promise<T>): Promise<T> {
    if (this.closed) throw veraError("BUSY");
    const entry = this.shared.get(store.scopeKey) ?? { host: this.create(store), users: 0 };
    const host = entry.host;
    entry.users++;
    this.shared.set(store.scopeKey, entry);
    this.active.add(host);
    const done = Promise.resolve().then(() => operation(host));
    this.pending.add(done);
    try {
      return await done;
    } finally {
      this.pending.delete(done);
      entry.users--;
      if (entry.users === 0) {
        if (this.shared.get(store.scopeKey) === entry) this.shared.delete(store.scopeKey);
        await host.drain();
        this.active.delete(host);
      }
    }
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...[...this.active].map((host) => host.drain()), ...this.pending]);
    this.shared.clear();
  }
}
