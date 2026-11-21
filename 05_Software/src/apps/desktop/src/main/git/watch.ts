// REQ-REL-92f883f5
import { type FSWatcher, watch } from "node:fs";
import { opendir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { gitEntry } from "./repository.js";
import type { readStatus } from "./status.js";

type Snapshot = Awaited<ReturnType<typeof readStatus>>;
type Selection = (name: string, event: "rename" | "change") => boolean;
type Subscription = { watcher: FSWatcher; select: Selection };

const maxDirectories = 512;
const maxDirectoryEntries = 24_000;

function metadataWatchPlan(result: Snapshot) {
  const plan = new Map<string, Set<string>>();
  const repo = result.repository;
  if (!repo) return plan;
  plan.set(repo.metadata, new Set(["HEAD", "index", "packed-refs", "config", "info", "refs"]));
  plan.set(join(repo.metadata, "info"), new Set(["exclude", "attributes", "sparse-checkout"]));
  for (
    let parent = dirname(repo.scope);
    repo.scope !== repo.root && parent !== dirname(repo.root);
    parent = dirname(parent)
  ) {
    plan.set(parent, new Set([".gitignore", ".gitattributes"]));
  }
  let parent = repo.metadata;
  const head = result.status.state === "ready" ? result.status.branch : undefined;
  if (head && head.kind !== "detached") {
    for (const part of ["refs", "heads", ...head.name.split("/")]) {
      const names = plan.get(parent) ?? new Set();
      names.add(part);
      plan.set(parent, names);
      parent = join(parent, part);
    }
  }
  return plan;
}

/** Owns nonrecursive directory watches and prunes ignored paths and repository boundaries. */
export class GitWatch {
  private watches = new Map<string, Subscription>();
  private closed = false;
  private initialFault = false;
  private structureChanged = true;
  private priorPlan = "";
  private untracked = new Set<string>();

  constructor(
    private readonly folder: string,
    private readonly changed: () => void,
    private readonly fault: () => void,
  ) {
    this.initialFault = !this.add(folder, () => true, true);
  }

  close(): void {
    this.closed = true;
    for (const { watcher } of this.watches.values()) watcher.close();
    this.watches.clear();
  }

  /** Recomputes watches only for topology and ignore/branch changes. */
  async sync(result: Snapshot, signal: AbortSignal) {
    this.untracked = new Set(
      result.status.state === "ready"
        ? result.status.entries
            .filter(({ staged, unstaged }) => staged === null && unstaged === "?")
            .map(({ path }) => path)
        : [],
    );
    const metadata = metadataWatchPlan(result);
    const ignored = result.ignored ?? new Set<string>();
    const tracked = result.trackedIgnored ?? new Set<string>();
    const skip = (path: string) => (ignored.has("") || ignored.has(path)) && !tracked.has(path);
    const metadataNames = [...metadata].map(([path, names]) => [path, [...names].sort()]);
    const planKey = JSON.stringify([result.repository?.metadata, metadataNames, [...ignored], [...tracked]]);
    if (!this.structureChanged && planKey === this.priorPlan)
      return { limited: this.initialFault, added: false };
    this.structureChanged = false;
    this.priorPlan = planKey;
    const wanted = new Set<string>();
    let limited = false;
    let added = false;
    const add = (path: string, select: Selection, worktree = false) => {
      wanted.add(path);
      const known = this.watches.has(path);
      if (!this.add(path, select, worktree)) limited = true;
      else if (!known) added = true;
    };
    for (const [path, names] of metadata) {
      signal.throwIfAborted();
      if ((await gitEntry(path))?.isDirectory()) add(path, (name) => names.has(name));
    }

    const pending: [string, string][] = [[this.folder, ""]];
    let directories = 0;
    let entries = 0;
    while (pending.length) {
      signal.throwIfAborted();
      const [absolute, path] = pending.pop() as [string, string];
      if (++directories > maxDirectories || entries > maxDirectoryEntries) {
        limited = true;
        break;
      }
      const child = (name: string) => (path ? `${path}/${name}` : name);
      add(
        absolute,
        (name, event) => {
          if (name.toLowerCase() === ".git" || name === ".gitignore" || name === ".gitattributes")
            return true;
          const entry = child(name);
          return !skip(entry) && (event === "rename" || !this.untracked.has(entry));
        },
        true,
      );
      if (!result.ignored) continue;
      try {
        const dir = await opendir(absolute);
        for await (const entry of dir) {
          signal.throwIfAborted();
          if (++entries > maxDirectoryEntries || pending.length + directories >= maxDirectories) {
            limited = true;
            break;
          }
          if (!entry.isDirectory() || entry.name.toLowerCase() === ".git" || skip(child(entry.name)))
            continue;
          const nested = join(absolute, entry.name);
          if (!(await gitEntry(join(nested, ".git")))) pending.push([nested, child(entry.name)]);
        }
      } catch {
        signal.throwIfAborted();
        limited = true;
      }
    }
    for (const [path, subscription] of this.watches) {
      if (wanted.has(path)) continue;
      subscription.watcher.close();
      this.watches.delete(path);
    }
    this.initialFault = limited;
    return { limited, added };
  }

  private add(path: string, select: Selection, worktree: boolean): boolean {
    if (this.closed) return false;
    const current = this.watches.get(path);
    if (current) {
      current.select = select;
      return true;
    }
    try {
      const watcher = watch(path, { persistent: false }, (event, name) => {
        const subscription = this.watches.get(path);
        if (!subscription || (name && !subscription.select(name, event))) return;
        if (worktree && (event === "rename" || !name)) this.structureChanged = true;
        this.changed();
      });
      this.watches.set(path, { watcher, select });
      watcher.once("error", () => {
        this.watches.delete(path);
        watcher.close();
        this.structureChanged = true;
        this.fault();
      });
      return true;
    } catch {
      return false;
    }
  }
}
