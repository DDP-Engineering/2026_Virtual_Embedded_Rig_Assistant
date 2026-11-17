import { createHash, randomUUID, verify } from "node:crypto";
import { lstat, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  CATALOG_LIMITS,
  type CatalogChannel,
  type CatalogEntry,
  type CatalogIndex,
  catalogChannelIndex,
  catalogIndexSchema,
  catalogUrl,
  compareVersions,
  type PluginCatalogReview,
  type PluginCatalogView,
  type PluginInstalled,
  type PluginManifest,
  type PluginReview,
  type VeraError,
  veraError,
} from "@vera/shared";
import { type PluginStore, previewPluginZip } from "./store.js";

export interface PluginCatalogOptions {
  store: PluginStore;
  /** Verified zips wait here between review and install: `<userData>/plugins/catalog`. */
  root: string;
  /** The configured catalog folder URL (settings, else the build default); anything invalid counts as none. */
  location(): string | undefined;
  /** The remote catalog's release channel (settings `plugins.channel`); `stable` when absent. */
  channel?(): CatalogChannel | undefined;
  /**
   * The Ed25519 public key (SPKI PEM) pinned in the build. A remote index is used only when its
   * signature verifies with it, so without a key every remote index is `untrusted`.
   */
  publicKey?: string;
  /** The bundled release folder of the official plugins, when the build has one. */
  bundled?: string;
  fetch(url: string, init: { signal?: AbortSignal | undefined }): Promise<Response>;
  now?: () => Date;
  uuid?: () => string;
}
type Origin = { kind: "remote"; url: string; channel: CatalogChannel } | { kind: "bundled"; folder: string };
type Problem = NonNullable<PluginCatalogView["problem"]>;
interface Snapshot {
  /** The remote URL and channel the snapshot was read for; a change of either reads again. */
  location: string | undefined;
  origin?: Origin;
  index?: CatalogIndex;
  problem?: Problem;
  checkedAt: string;
}
/** An index signature file is 88 base64 characters; anything longer is not one. */
const SIGNATURE_BYTES = 1024;
/** How long one remote file, headers and body, may take: the index or its signature, and a package zip. */
const INDEX_TIMEOUT_MS = 30_000;
const ZIP_TIMEOUT_MS = 15 * 60_000;
/**
 * A read that failed in transfer: network, HTTP status, a redirect off HTTPS, or a missing file. `missing`
 * when the server answered 404 Not Found.
 */
class Unreachable extends Error {
  constructor(readonly missing = false) {
    super();
  }
}

const failure = (code: VeraError["code"], key: string, params?: VeraError["params"]): VeraError => ({
  ...veraError(code),
  messageKey: `plugins.catalogError.${key}`,
  ...(params ? { params } : {}),
});
const sha256 = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
/** JSON with object keys sorted at every level, so equal data compares equal whatever its key order. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : item,
  );
}
/** Where a response finally came from must still be https, or http on this computer. */
function securelyServed(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" ||
      (parsed.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(parsed.hostname))
    );
  } catch {
    return false;
  }
}

/**
 * The plugin catalog client (spec REQ-DATA-b40d3f9b §5): reads the configured catalog, else the bundled
 * one; downloads and verifies a plugin zip for review; installs it bound to the reviewed hash with its
 * tier. It never installs on its own.
 */
export class PluginCatalog {
  private current: Snapshot | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: PluginCatalogOptions) {}
  /** Reviews and installs share the kept-zip folder, so they run one at a time. */
  private serial<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  /**
   * Bytes of one catalog file, at most `limit` of them; `over` when there were more. Transfer failures,
   * HTTP errors and redirects off HTTPS are Unreachable.
   */
  private async read(
    origin: Origin,
    name: string,
    limit: number,
    timeoutMs: number,
    signal?: AbortSignal,
  ): Promise<{ bytes: Uint8Array; over: boolean }> {
    if (origin.kind === "bundled") {
      const path = join(origin.folder, name);
      try {
        const info = await lstat(path);
        if (!info.isFile()) throw new Unreachable();
        if (info.size > limit) return { bytes: new Uint8Array(), over: true };
        return { bytes: await readFile(path), over: false };
      } catch (error) {
        if (error instanceof Unreachable) throw error;
        throw new Unreachable();
      }
    }
    let response: Response;
    // A server that stops answering ends the read like any other failed transfer.
    const bounded = AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(timeoutMs)]);
    try {
      response = await this.options.fetch(`${origin.url}${name}`, { signal: bounded });
    } catch (error) {
      signal?.throwIfAborted();
      throw new Unreachable();
    }
    const body = response.body;
    if (!response.ok || !body || (response.url && !securelyServed(response.url))) {
      await body?.cancel().catch(() => {});
      throw new Unreachable(response.status === 404);
    }
    if (Number(response.headers.get("content-length") ?? 0) > limit) {
      await body.cancel().catch(() => {});
      return { bytes: new Uint8Array(), over: true };
    }
    const parts: Uint8Array[] = [];
    let total = 0;
    const reader = body.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > limit) {
          await reader.cancel().catch(() => {});
          return { bytes: new Uint8Array(), over: true };
        }
        parts.push(value);
      }
    } catch {
      signal?.throwIfAborted();
      throw new Unreachable();
    }
    return { bytes: Buffer.concat(parts), over: false };
  }

  /**
   * The bundled release's `index.json` (trusted through the installer), or a remote channel index whose
   * detached signature verifies with the pinned key; the signature is checked before the index is parsed.
   */
  private async readIndex(origin: Origin, signal?: AbortSignal): Promise<CatalogIndex | Problem> {
    const name = origin.kind === "remote" ? catalogChannelIndex(origin.channel) : "index.json";
    let read: { bytes: Uint8Array; over: boolean };
    try {
      read = await this.read(origin, name, CATALOG_LIMITS.indexBytes, INDEX_TIMEOUT_MS, signal);
    } catch (error) {
      if (error instanceof Unreachable) return "unreachable";
      throw error;
    }
    if (read.over) return "invalid";
    if (origin.kind === "remote") {
      let signature: { bytes: Uint8Array; over: boolean };
      try {
        signature = await this.read(origin, `${name}.sig`, SIGNATURE_BYTES, INDEX_TIMEOUT_MS, signal);
      } catch (error) {
        // Only a signature the server does not have is "unsigned"; any other failed read is a transfer problem.
        if (error instanceof Unreachable) return error.missing ? "unsigned" : "unreachable";
        throw error;
      }
      if (signature.over || !this.signed(read.bytes, signature.bytes)) return "untrusted";
    }
    try {
      const parsed = catalogIndexSchema.safeParse(
        JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(read.bytes)),
      );
      if (!parsed.success) return "invalid";
      // The channel is inside the signed bytes: another channel's signed index served under this name is refused.
      if (origin.kind === "remote" && parsed.data.channel !== origin.channel) return "untrusted";
      return parsed.data;
    } catch {
      return "invalid";
    }
  }

  /** The base64 Ed25519 signature (text, final newline allowed) verifies `bytes` with the pinned key. */
  private signed(bytes: Uint8Array, signature: Uint8Array): boolean {
    if (!this.options.publicKey) return false;
    const text = new TextDecoder().decode(signature).trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return false;
    try {
      return verify(null, bytes, this.options.publicKey, Buffer.from(text, "base64"));
    } catch {
      return false;
    }
  }

  /**
   * The last catalog read for the current location and channel, or a new read (`refresh`, or either
   * changed).
   */
  private async snapshot(refresh: boolean, signal?: AbortSignal): Promise<Snapshot> {
    const url = catalogUrl(this.options.location() ?? "");
    const channel = this.options.channel?.() ?? "stable";
    const location = url && `${url} ${channel}`;
    if (refresh || this.current?.location !== location || !this.current)
      this.current = await this.readSnapshot(url, channel, signal);
    return this.current;
  }
  private async readSnapshot(
    url: string | undefined,
    channel: CatalogChannel,
    signal?: AbortSignal,
  ): Promise<Snapshot> {
    const checkedAt = (this.options.now?.() ?? new Date()).toISOString();
    const location = url && `${url} ${channel}`;
    let problem: Snapshot["problem"];
    if (url) {
      const origin: Origin = { kind: "remote", url, channel };
      const index = await this.readIndex(origin, signal);
      if (typeof index !== "string") return { location, origin, index, checkedAt };
      problem = index;
    }
    // The bundled catalog stands in silently: its own read failures leave the view empty.
    if (this.options.bundled) {
      const origin: Origin = { kind: "bundled", folder: this.options.bundled };
      const index = await this.readIndex(origin, signal);
      if (typeof index !== "string")
        return { location, origin, index, checkedAt, ...(problem ? { problem } : {}) };
    }
    return { location, checkedAt, ...(problem ? { problem } : {}) };
  }

  /** The catalog as the Plugins page shows it, with the installed state and updates of this machine. */
  async view(options: { refresh?: boolean; signal?: AbortSignal } = {}): Promise<PluginCatalogView> {
    const snapshot = await this.snapshot(options.refresh ?? false, options.signal);
    const installed = new Map((await this.options.store.list()).map((plugin) => [plugin.id, plugin]));
    return {
      source: snapshot.origin?.kind ?? "none",
      ...(snapshot.origin?.kind === "remote" ? { url: snapshot.origin.url } : {}),
      ...(snapshot.problem ? { problem: snapshot.problem } : {}),
      checkedAt: snapshot.checkedAt,
      plugins: (snapshot.index?.plugins ?? []).map((entry) => {
        const local = installed.get(entry.id);
        return {
          ...entry,
          ...(local
            ? {
                installed: {
                  ...(local.version !== undefined ? { version: local.version } : {}),
                  ...(local.tier !== undefined ? { tier: local.tier } : {}),
                },
              }
            : {}),
          update: local?.version !== undefined && compareVersions(entry.version, local.version) > 0,
        };
      }),
      packs: snapshot.index?.packs ?? [],
    };
  }

  private entry(snapshot: Snapshot, id: string): { entry: CatalogEntry; origin: Origin } {
    const entry = snapshot.index?.plugins.find((plugin) => plugin.id === id);
    if (!entry || !snapshot.origin) throw veraError("NOT_FOUND");
    return { entry, origin: snapshot.origin };
  }
  /** A catalog version lower than the installed one never replaces it. */
  private async refuseDowngrade(entry: CatalogEntry): Promise<void> {
    const installed = (await this.options.store.list()).find((plugin) => plugin.id === entry.id);
    if (installed?.version !== undefined && compareVersions(entry.version, installed.version) < 0)
      throw failure("CONFLICT", "downgrade");
  }
  private kept(entry: CatalogEntry): string {
    return join(this.options.root, `${entry.sha256}.zip`);
  }
  /** The first install, a broken installed plugin, or changed programs or rules (install sources included). */
  private async required(id: string, manifest: PluginManifest): Promise<boolean> {
    let previous: PluginManifest;
    try {
      previous = (await this.options.store.load(id)).manifest;
    } catch {
      return true;
    }
    return (
      canonical(previous.programs) !== canonical(manifest.programs) ||
      canonical(previous.rules) !== canonical(manifest.rules)
    );
  }

  /**
   * Downloads the entry's zip, verifies its size and SHA-256 against the index, keeps it for install and
   * returns the store's review of it with whether the user must see that review. Only the zip of the
   * latest review is kept: the zip of a review the user cancelled goes when the next review starts.
   */
  review(id: string, signal?: AbortSignal): Promise<PluginCatalogReview> {
    return this.serial(() => this.download(id, signal));
  }

  /**
   * The entry's package read in memory for its details before install, verified against the index like a
   * review. Nothing is written, so a review in progress keeps its zip.
   */
  async preview(id: string, signal?: AbortSignal): Promise<PluginReview> {
    const { entry, origin } = this.entry(await this.snapshot(false, signal), id);
    let read: { bytes: Uint8Array; over: boolean };
    try {
      read = await this.read(origin, entry.url, entry.bytes, ZIP_TIMEOUT_MS, signal);
    } catch (error) {
      if (error instanceof Unreachable) throw failure("OFFLINE", "download");
      throw error;
    }
    if (read.over || read.bytes.length !== entry.bytes || sha256(read.bytes) !== entry.sha256)
      throw failure("INVALID", "sha256");
    return previewPluginZip(read.bytes, entry.url);
  }
  private async download(id: string, signal?: AbortSignal): Promise<PluginCatalogReview> {
    const { entry, origin } = this.entry(await this.snapshot(false, signal), id);
    await this.refuseDowngrade(entry);
    await rm(this.options.root, { recursive: true, force: true });
    let read: { bytes: Uint8Array; over: boolean };
    try {
      read = await this.read(origin, entry.url, entry.bytes, ZIP_TIMEOUT_MS, signal);
    } catch (error) {
      if (error instanceof Unreachable) throw failure("OFFLINE", "download");
      throw error;
    }
    if (read.over || read.bytes.length !== entry.bytes || sha256(read.bytes) !== entry.sha256)
      throw failure("INVALID", "sha256");
    await mkdir(this.options.root, { recursive: true });
    const zip = this.kept(entry);
    const part = join(this.options.root, `${(this.options.uuid ?? randomUUID)()}.part`);
    try {
      await writeFile(part, read.bytes, { flag: "wx" });
      await rename(part, zip);
    } finally {
      await rm(part, { force: true });
    }
    let review: PluginReview;
    try {
      review = await this.options.store.review(zip);
      const manifest = review.manifest;
      if (review.issues.length || manifest?.id !== entry.id || manifest.version !== entry.version)
        throw failure("INVALID", "mismatch", review.issues[0] ? { issue: review.issues[0].code } : undefined);
      return {
        review,
        id: entry.id,
        version: entry.version,
        tier: entry.tier,
        required: await this.required(entry.id, manifest),
      };
    } catch (error) {
      await rm(zip, { force: true });
      throw error;
    }
  }

  /**
   * Installs the kept zip of a reviewed entry with the integrity hash its review showed, recording the
   * entry's tier and the zip URL. A missing or changed kept zip is CONFLICT; the zip is removed either way.
   */
  install(id: string, sha: string): Promise<PluginInstalled> {
    return this.serial(() => this.installKept(id, sha));
  }
  private async installKept(id: string, sha: string): Promise<PluginInstalled> {
    const { entry, origin } = this.entry(await this.snapshot(false), id);
    await this.refuseDowngrade(entry);
    const zip = this.kept(entry);
    try {
      let bytes: Uint8Array;
      try {
        bytes = await readFile(zip);
      } catch {
        throw veraError("CONFLICT");
      }
      if (bytes.length !== entry.bytes || sha256(bytes) !== entry.sha256) throw veraError("CONFLICT");
      const url = origin.kind === "remote" ? `${origin.url}${entry.url}` : join(origin.folder, entry.url);
      return await this.options.store.install(zip, sha, { tier: entry.tier, url });
    } finally {
      await rm(zip, { force: true });
    }
  }
}
