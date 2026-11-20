import { createHash } from "node:crypto";
import type { CuratedDiscovery, CuratedModel, ProviderBinding } from "@vera/shared";
import { discoverPresetModels } from "./preset-connection.js";

type CatalogSnapshot = { result: CuratedDiscovery; profiles: Map<string, CuratedModel>; expires: number };
const credentialFingerprint = (key: string) => createHash("sha256").update(key).digest("hex");

type Entry = { fingerprint: string; started: number; published: number; snapshot?: CatalogSnapshot };

/** Cache the authenticated catalog per scoped connection and key inside one gateway. */
export class OpenCodeCatalogCache {
  private readonly entries = new Map<string, Entry>();

  constructor(private readonly host: { fetch?: typeof fetch; scrub(text: string): string; now(): number }) {}

  profiles(slot: string): Map<string, CuratedModel> | undefined {
    return this.entries.get(slot)?.snapshot?.profiles;
  }

  invalidate(slot: string, key: string | undefined) {
    if (key && this.entries.get(slot)?.fingerprint === credentialFingerprint(key)) this.entries.delete(slot);
  }

  async load(
    { slot, binding }: { slot: string; binding: ProviderBinding },
    key: string | undefined,
    signal?: AbortSignal,
    refresh = false,
  ): Promise<CatalogSnapshot | undefined> {
    signal?.throwIfAborted();
    if (!key) {
      this.entries.delete(slot);
      return;
    }
    const now = this.host.now();
    const fingerprint = credentialFingerprint(key);
    const current = this.entries.get(slot);
    const entry = current?.fingerprint === fingerprint ? current : { fingerprint, started: 0, published: 0 };
    this.entries.set(slot, entry);
    if (!refresh && entry.snapshot && entry.snapshot.expires > now) return entry.snapshot;
    for (const [other, candidate] of this.entries) {
      if (other !== slot && candidate.snapshot && candidate.snapshot.expires <= now)
        this.entries.delete(other);
    }
    const request = ++entry.started;
    const result = await discoverPresetModels(binding, key, this.host, signal);
    signal?.throwIfAborted();
    const snapshot = {
      result,
      profiles: new Map(
        result.status === "discovered" ? result.profiles?.map((profile) => [profile.id, profile]) : [],
      ),
      expires: this.host.now() + (result.status === "failed" ? 10000 : 300000),
    };
    if (this.entries.get(slot) === entry && request >= entry.published) {
      entry.published = request;
      entry.snapshot = snapshot;
    }
    return snapshot;
  }
}
