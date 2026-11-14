import { createHash, randomUUID } from "node:crypto";
import { chmod, link, lstat, mkdir, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { veraError } from "@vera/shared";

/**
 * The one lease registry of bench resources (spec REQ-DATA-f2cbfc23 §5): a per-user folder of lease files, one per
 * identity key, that every VERA process of the user on this machine checks before a run touches a resource, plus
 * markers of resources whose physical state is unknown. Later identity kinds reuse it; they never add a second one.
 */
export interface LeaseClaim {
  /** Identity kind, as data (`visa` today). */
  readonly kind: string;
  /** The registry alias the run named. */
  readonly alias: string;
  /** The declared resource name, for messages. */
  readonly resource: string;
  /** Normalized identity keys; two claims conflict when their keys intersect. */
  readonly keys: readonly string[];
  /** Whether the run may change the resource's physical state (risk device-write or irreversible). */
  readonly actuates: boolean;
}
export interface LeaseOwner {
  readonly sessionId: string;
  readonly runId: string;
}
export interface ResourceState {
  readonly key: string;
  readonly state: "unknown";
  readonly since: string;
  readonly runId: string;
  readonly reason: string;
}
/** The leases one run holds. */
export interface HeldLeases {
  /** Recorded unknown states of the claimed resources, by alias. */
  readonly states: Readonly<Record<string, ResourceState>>;
  /** Records the physical state of every claimed key as unknown. */
  markUnknown(reason: string): Promise<void>;
  /** Removes recorded unknown states of every claimed key. */
  clear(): Promise<void>;
  /** Removes the lease files; best effort, never throws. */
  release(): Promise<void>;
}
export interface ResourceLeasesOptions {
  root: string;
  /** The app that holds a lease, for messages (`desktop`, `cli`). */
  app: string;
  pid?: number;
  /** Whether a process still runs; a signal-0 probe by default. */
  alive?: (pid: number) => boolean;
  now?: () => Date;
  platform?: NodeJS.Platform;
}
interface LeaseFile {
  format: 1;
  key: string;
  kind: string;
  alias: string;
  pid: number;
  app: string;
  sessionId: string;
  runId: string;
  actuates: boolean;
  acquiredAt: string;
}

/** The per-user lease folder: LOCALAPPDATA on Windows, XDG_RUNTIME_DIR or a private temporary folder on Linux. */
export function leaseRoot(input: {
  platform: NodeJS.Platform;
  env: Readonly<Record<string, string | undefined>>;
  tmpdir: string;
  uid?: number | undefined;
}): string {
  if (input.platform === "win32") {
    const local = input.env.LOCALAPPDATA;
    return local && isAbsolute(local) ? join(local, "VERA", "leases") : join(input.tmpdir, "vera-leases");
  }
  const runtime = input.env.XDG_RUNTIME_DIR;
  if (runtime?.startsWith("/")) return join(runtime, "vera-leases");
  return join(input.tmpdir, `vera-leases-${input.uid ?? "user"}`);
}

/** The lease file of a key; its state marker replaces `.lease` with `.state`. */
export function leaseFileName(key: string): string {
  return `${createHash("sha256").update(key).digest("hex").slice(0, 32)}.lease`;
}
const stateFileName = (key: string) => leaseFileName(key).replace(/\.lease$/, ".state");
const RUN_ID = /^[0-9A-Za-z_-]{1,64}$/;

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
const busy = (resource: string, holder: string) => ({ ...veraError("BUSY"), params: { resource, holder } });
const denied = () => ({ ...veraError("DENIED"), params: { reason: "leases" } });

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8"));
}
function validLease(value: unknown, key: string): value is LeaseFile {
  const lease = value as Partial<LeaseFile> | null;
  return (
    !!lease &&
    lease.format === 1 &&
    lease.key === key &&
    Number.isInteger(lease.pid) &&
    typeof lease.runId === "string" &&
    typeof lease.actuates === "boolean"
  );
}

export class ResourceLeases {
  private readonly pid: number;
  private readonly alive: (pid: number) => boolean;
  private readonly now: () => Date;
  private readonly platform: NodeJS.Platform;
  private ready: Promise<void> | undefined;

  constructor(private readonly options: ResourceLeasesOptions) {
    this.pid = options.pid ?? process.pid;
    this.alive = options.alive ?? processAlive;
    this.now = options.now ?? (() => new Date());
    this.platform = options.platform ?? process.platform;
  }

  get root(): string {
    return this.options.root;
  }

  /** Creates the folder (0700) once; DENIED when it is a link, not a folder, or open to others on Linux. */
  private folder(): Promise<void> {
    this.ready ??= (async () => {
      await mkdir(this.root, { recursive: true, mode: 0o700 });
      const info = await lstat(this.root);
      if (!info.isDirectory() || info.isSymbolicLink()) throw denied();
      if (this.platform !== "win32") {
        const uid = process.getuid?.();
        if ((uid !== undefined && info.uid !== uid) || (info.mode & 0o077) !== 0) throw denied();
      }
    })().catch((error) => {
      this.ready = undefined;
      throw error?.code === "DENIED" ? error : denied();
    });
    return this.ready;
  }

  /**
   * Takes every key of the claims, in key order, or none: BUSY `{resource, holder}` when another live process or
   * run holds one (an unreadable lease counts as held). A lease of a process that no longer runs is removed first,
   * and when that run could actuate, the key's state becomes unknown (`holder-lost`).
   */
  async acquire(claims: readonly LeaseClaim[], owner: LeaseOwner): Promise<HeldLeases> {
    await this.folder();
    const byKey = new Map<string, LeaseClaim>();
    for (const claim of claims) for (const key of claim.keys) if (!byKey.has(key)) byKey.set(key, claim);
    const keys = [...byKey.keys()].sort();
    const taken: string[] = [];
    try {
      for (const key of keys) {
        await this.take(key, byKey.get(key) as LeaseClaim, owner);
        taken.push(key);
      }
    } catch (error) {
      await Promise.all(taken.map((key) => this.drop(key, owner.runId)));
      throw error;
    }
    const states: Record<string, ResourceState> = {};
    for (const key of keys) {
      const state = await this.state(key);
      const alias = (byKey.get(key) as LeaseClaim).alias;
      if (state && !states[alias]) states[alias] = state;
    }
    const write = async (key: string, reason: string) => {
      const marker: ResourceState & { format: 1 } = {
        format: 1,
        key,
        state: "unknown",
        since: this.now().toISOString(),
        runId: owner.runId,
        reason,
      };
      await this.writeAtomic(join(this.root, stateFileName(key)), JSON.stringify(marker));
    };
    return {
      states,
      markUnknown: async (reason) => {
        for (const key of keys) await write(key, reason);
      },
      clear: async () => {
        for (const key of keys) await rm(join(this.root, stateFileName(key)), { force: true });
      },
      release: async () => {
        await Promise.all(keys.map((key) => this.drop(key, owner.runId)));
      },
    };
  }

  /** Creates `<root>/runs/<run id>/` empty for a supervised run and returns it. */
  async controlFolder(runId: string): Promise<string> {
    if (!RUN_ID.test(runId)) throw denied();
    await this.folder();
    const folder = join(this.root, "runs", runId);
    await rm(folder, { recursive: true, force: true });
    await mkdir(folder, { recursive: true, mode: 0o700 });
    return folder;
  }

  async removeControl(runId: string): Promise<void> {
    if (!RUN_ID.test(runId)) return;
    await rm(join(this.root, "runs", runId), { recursive: true, force: true }).catch(() => {});
  }

  private async take(key: string, claim: LeaseClaim, owner: LeaseOwner): Promise<void> {
    const path = join(this.root, leaseFileName(key));
    const lease: LeaseFile = {
      format: 1,
      key,
      kind: claim.kind,
      alias: claim.alias,
      pid: this.pid,
      app: this.options.app,
      sessionId: owner.sessionId,
      runId: owner.runId,
      actuates: claim.actuates,
      acquiredAt: this.now().toISOString(),
    };
    for (let attempt = 0; attempt < 3; attempt++) {
      // Complete before it is visible: written aside, then published by an exclusive hard link.
      const temporary = `${path}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(lease), { mode: 0o600 });
      try {
        await link(temporary, path);
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      } finally {
        await unlink(temporary).catch(() => {});
      }
      let existing: unknown;
      let text = "";
      try {
        text = await readFile(path, "utf8");
        existing = JSON.parse(text);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw busy(claim.alias, "an unreadable lease");
      }
      if (!validLease(existing, key)) throw busy(claim.alias, "an unreadable lease");
      if (this.alive(existing.pid)) throw busy(claim.alias, `process ${existing.pid}`);
      // Stale: moved aside atomically, and restored if what moved is no longer the stale lease.
      const tomb = `${path}.${randomUUID()}.stale`;
      try {
        await rename(path, tomb);
      } catch {
        continue;
      }
      const moved = await readFile(tomb, "utf8").catch(() => "");
      if (moved !== text) {
        await link(tomb, path).catch(() => {});
        await unlink(tomb).catch(() => {});
        throw busy(claim.alias, "another VERA process");
      }
      await unlink(tomb).catch(() => {});
      if (existing.actuates) {
        const marker = {
          format: 1,
          key,
          state: "unknown",
          since: this.now().toISOString(),
          runId: existing.runId,
          reason: "holder-lost",
        };
        await this.writeAtomic(join(this.root, stateFileName(key)), JSON.stringify(marker));
      }
    }
    throw busy(claim.alias, "another VERA process");
  }

  /** Removes a lease only while it is still this run's. */
  private async drop(key: string, runId: string): Promise<void> {
    const path = join(this.root, leaseFileName(key));
    try {
      const lease = await readJson(path);
      if (validLease(lease, key) && lease.runId === runId && lease.pid === this.pid) await unlink(path);
    } catch {
      // A lease that cannot be read or removed stays; once this process ends it is stale.
    }
  }

  private async state(key: string): Promise<ResourceState | undefined> {
    try {
      const value = (await readJson(join(this.root, stateFileName(key)))) as Partial<ResourceState> & {
        format?: number;
      };
      if (value.format !== 1 || value.key !== key || value.state !== "unknown") return undefined;
      return {
        key,
        state: "unknown",
        since: String(value.since ?? ""),
        runId: String(value.runId ?? ""),
        reason: String(value.reason ?? ""),
      };
    } catch {
      return undefined;
    }
  }

  private async writeAtomic(path: string, text: string): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    await writeFile(temporary, text, { mode: 0o600 });
    try {
      await rename(temporary, path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    if (this.platform !== "win32") await chmod(path, 0o600).catch(() => {});
  }
}
