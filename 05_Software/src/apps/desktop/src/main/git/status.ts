// REQ-SEC-b24a8722 REQ-FUNC-1883b36f
import { join } from "node:path";
import type { GitStatus, GitStatusEntry } from "@vera/shared";
import { exactWorktreeFile, parentOf, scoped } from "./index-scope.js";
import type { GitReader } from "./read.js";
import { containingRepository, GitReadError, type GitRepository, gitEntry } from "./repository.js";

type ReadResult = {
  status: GitStatus;
  repository?: GitRepository;
  ignored?: ReadonlySet<string>;
  trackedIgnored?: ReadonlySet<string>;
};
type Entry = Omit<GitStatusEntry, "virtual">;
const invalid = () => new GitReadError("failed");

function change(code: string): GitStatusEntry["staged"] {
  if (code === ".") return null;
  if (code === "T") return "M";
  if (code === "M" || code === "A" || code === "R" || code === "D") return code;
  throw invalid();
}

function fields(line: string, count: number) {
  const head: string[] = [];
  let start = 0;
  for (let i = 0; i < count; i++) {
    const end = line.indexOf(" ", start);
    if (end <= start) throw invalid();
    head.push(line.slice(start, end));
    start = end + 1;
  }
  return { head, path: line.slice(start) };
}

function parse(output: Buffer, repo: GitRepository, head: string) {
  const records = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(output).split("\0");
  if (records.pop() !== "" || records.length > 20_000) throw invalid();
  const ignored = new Set<string>();
  const entries = new Map<string, Entry>();
  const put = (path: string | undefined, change: Omit<Entry, "path">) => {
    if (!path) return;
    const prior = entries.get(path);
    entries.set(path, {
      ...prior,
      ...change,
      path,
      staged: change.staged ?? prior?.staged ?? null,
      unstaged: change.unstaged ?? prior?.unstaged ?? null,
    });
    if (entries.size > 5000) throw invalid();
  };
  let oid: string | undefined;
  let reportedBranch: string | undefined;
  for (let i = 0; i < records.length; i++) {
    const line = records[i] as string;
    if (line.startsWith("# branch.oid ")) {
      oid = line.slice(13);
      continue;
    }
    if (line.startsWith("# branch.head ")) {
      reportedBranch = line.slice(14);
      continue;
    }
    const kind = line[0];
    if (kind === "?" || kind === "!") {
      if (line[1] !== " ") throw invalid();
      const directory = line.endsWith("/");
      const rawPath = line.slice(2, directory ? -1 : undefined);
      const path = scoped(rawPath, repo.prefix);
      if (directory && kind === "!" && rawPath === repo.prefix) ignored.add("");
      if (path && (kind === "!" || directory)) ignored.add(path);
      // Under --untracked-files=all only embedded repositories are emitted as directories.
      if (kind === "?" && !directory) put(path, { staged: null, unstaged: "?", conflict: false });
      continue;
    }
    if (kind !== "1" && kind !== "2" && kind !== "u") throw invalid();
    const { head, path: rawPath } = fields(line, kind === "1" ? 8 : kind === "2" ? 9 : 10);
    const xy = head[1] ?? "";
    const sub = head[2] ?? "";
    if (xy.length !== 2 || !/^(N\.\.\.|S[.C][.M][.U])$/.test(sub)) throw invalid();
    const from = kind === "2" ? records[++i] : undefined;
    if (kind === "2" && (from === undefined || !/^R\d{1,3}$/.test(head[8] ?? ""))) throw invalid();
    if (sub.startsWith("S") || head.slice(3, kind === "u" ? 7 : 6).includes("160000")) continue;
    const path = scoped(rawPath, repo.prefix);
    if (kind === "u") {
      put(path, { staged: null, unstaged: null, conflict: true });
      continue;
    }
    const staged = change(xy[0] as string);
    const unstaged = change(xy[1] as string);
    const original = from === undefined ? undefined : scoped(from, repo.prefix);
    put(path, {
      staged,
      unstaged,
      conflict: false,
      ...(original ? { rename: { role: "destination", path: original } } : {}),
    });
    if (from !== undefined)
      put(original, {
        staged: staged === "R" ? "R" : null,
        unstaged: unstaged === "R" ? "R" : null,
        conflict: false,
        ...(path ? { rename: { role: "source", path } } : {}),
      });
  }
  const symbolicPrefix = "ref: refs/heads/";
  const branch = head.startsWith(symbolicPrefix) ? head.slice(symbolicPrefix.length) : undefined;
  if (!oid || reportedBranch !== (branch ?? "(detached)")) throw invalid();
  if (oid === "(initial)" ? !branch : !/^[a-f0-9]{40}$/.test(oid)) throw invalid();
  return {
    branch: branch
      ? { kind: oid === "(initial)" ? ("unborn" as const) : ("named" as const), name: branch }
      : { kind: "detached" as const, name: oid.slice(0, 7) },
    entries,
    ignored,
  };
}

/** Revalidate workbench-relative paths without following links or stepping into an embedded repository. */
async function visibleEntries(repo: GitRepository, entries: Map<string, Entry>, signal: AbortSignal) {
  const parents = new Map<string, Promise<"present" | "absent" | "excluded">>();
  function parentState(path: string): Promise<"present" | "absent" | "excluded"> {
    if (!path) return Promise.resolve("present");
    const previous = parents.get(path);
    if (previous) return previous;
    const value = (async () => {
      const parent = await parentState(parentOf(path));
      if (parent !== "present") return parent;
      signal.throwIfAborted();
      const absolute = join(repo.scope, path);
      const stat = await gitEntry(absolute);
      if (!stat) return "absent";
      if (!stat.isDirectory()) return stat.isSymbolicLink() ? "excluded" : "absent";
      return (await gitEntry(join(absolute, ".git"))) ? "excluded" : "present";
    })();
    parents.set(path, value);
    return value;
  }
  const result = new Map<string, GitStatusEntry>();
  const paths = [...entries];
  for (let index = 0; index < paths.length; index += 32) {
    signal.throwIfAborted();
    await Promise.all(
      paths.slice(index, index + 32).map(async ([path, entry]) => {
        const parent = await parentState(parentOf(path));
        if (parent === "excluded") return;
        const absolute = join(repo.scope, path);
        const stat = parent === "present" ? await gitEntry(absolute) : undefined;
        if (stat?.isSymbolicLink() || (stat?.isDirectory() && (await gitEntry(join(absolute, ".git")))))
          return;
        const exact = await exactWorktreeFile(repo, path, absolute, stat);
        result.set(path, { ...entry, virtual: !exact });
      }),
    );
  }
  return paths.flatMap(([path]) => {
    const entry = result.get(path);
    if (!entry) return [];
    if (entry.rename && !result.has(entry.rename.path)) {
      const { rename: _, ...visible } = entry;
      return [visible];
    }
    return [entry];
  });
}

/** Reads one bounded porcelain snapshot and retains watch-only Git ignore paths in main. */
export async function readStatus(reader: GitReader, scope: string, signal: AbortSignal): Promise<ReadResult> {
  let repository: GitRepository | undefined;
  try {
    repository = await containingRepository(scope, signal);
    if (!repository) return { status: { state: "no-repository" } };
    const output = await reader.status(repository, signal);
    const { branch, entries, ignored } = parse(output.status, repository, output.head);
    const trackedIgnored = ignored.has("")
      ? output.tracked
      : new Set([...ignored].filter((path) => output.tracked.has(path)));
    for (const submodule of output.gitlinks) ignored.add(submodule);
    const visible = await visibleEntries(repository, entries, signal);
    return {
      status: {
        state: "ready",
        branch,
        entries: visible,
        changed: visible.length,
        conflicts: visible.filter(({ conflict }) => conflict).length,
      },
      repository,
      ignored,
      trackedIgnored,
    };
  } catch (error) {
    signal.throwIfAborted();
    return {
      status: {
        state: error instanceof GitReadError && error.reason !== "output-limit" ? error.reason : "failed",
      },
      ...(repository ? { repository } : {}),
    };
  }
}
