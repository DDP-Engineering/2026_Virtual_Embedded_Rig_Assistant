// REQ-FUNC-52bd38ff REQ-SEC-788f3385 REQ-REL-6b7f009b
import {
  GIT_HISTORY_PAGE_SIZE,
  type GitHistoryCommit,
  type GitHistoryEligibility,
  type GitHistoryResult,
} from "@vera/shared";
import { z } from "zod";
import { checkedPath, exactFilePathspec, exactWorktreeFile, parentOf, scoped } from "./index-scope.js";
import type { GitCommand } from "./read.js";
import { GitReadError, type GitRepository } from "./repository.js";

class MalformedHistory extends Error {}

const fileMode = /^100(?:644|755)$/;
const oid = /^[a-f0-9]{40}$/;
const authorDate = z.iso.datetime({ offset: true });

function decode(bytes: Buffer): string {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new MalformedHistory();
  }
}

function fields(bytes: Buffer): string[] {
  if (!bytes.length) return [];
  const items = decode(bytes).split("\0");
  if (items.pop() !== "") throw new MalformedHistory();
  return items;
}

async function headCommit(run: GitCommand, head: string) {
  const value = (await run(["rev-parse", "--verify", "--quiet", "HEAD"], 64, "allow-unborn-head"))
    .toString()
    .trim();
  if (!value && head.startsWith("ref: ")) return undefined;
  if (!oid.test(value)) throw new MalformedHistory();
  return value;
}

async function selectPath(repo: GitRepository, path: string, run: GitCommand, signal: AbortSignal) {
  if (!path || scoped(path, "") !== path) throw new GitReadError("unsupported");
  const literal = repo.prefix ? repo.prefix + "/" + path : path;
  const names = [literal];
  for (let parent = parentOf(path); parent; parent = parentOf(parent))
    names.push(repo.prefix ? repo.prefix + "/" + parent : parent);
  const output = await run(
    ["ls-files", "--cached", "--stage", "-z", "--", ...names.map(exactFilePathspec)],
    256 * 1024,
    "exact-file-paths",
  );
  const gitlinks = new Set<string>();
  let indexed = false;
  let nonFile = false;
  const operands = new Set(names);
  for (const record of fields(output)) {
    const match = /^(\d{6}) [a-f0-9]{40} [0-3]\t([\s\S]+)$/.exec(record);
    if (!match?.[1] || !match[2] || !operands.has(match[2])) throw new MalformedHistory();
    if (match[1] === "160000") {
      const relative = scoped(match[2], repo.prefix);
      if (relative) gitlinks.add(relative);
    }
    if (match[2] === literal) {
      if (fileMode.test(match[1])) indexed = true;
      else nonFile = true;
    }
  }
  const { location, stat } = await checkedPath(repo, path, { gitlinks }, signal);
  const canInspect = !nonFile && (!stat || stat.isFile() || stat.isDirectory());
  const onDisk = await exactWorktreeFile(repo, path, location, stat);
  return { literal, indexed, canInspect, onDisk, gitlinks };
}

async function tracking(
  repo: GitRepository,
  path: string,
  run: GitCommand,
  head: string,
  signal: AbortSignal,
) {
  const selected = await selectPath(repo, path, run, signal);
  if (!selected.canInspect || selected.onDisk || selected.indexed)
    return { ...selected, tracked: selected.canInspect && selected.indexed, revision: undefined };
  const revision = await headCommit(run, head);
  if (!revision) return { ...selected, tracked: false, revision };
  const rows = fields(await run(["ls-tree", "--full-tree", "-z", revision, "--", selected.literal], 8192));
  if (rows.length > 1) throw new MalformedHistory();
  const entry = rows[0];
  if (entry === undefined) return { ...selected, tracked: false, revision };
  const match = /^(\d{6}) (?:blob|tree|commit) [a-f0-9]{40}\t([\s\S]+)$/.exec(entry);
  if (!match?.[1] || match[2] !== selected.literal) throw new MalformedHistory();
  return { ...selected, tracked: fileMode.test(match[1]), revision };
}

/** Checks current index membership or an exact deleted file in HEAD without loading the workbench index inventory. */
export async function historyEligibility(
  repo: GitRepository,
  path: string,
  run: GitCommand,
  head: string,
  signal: AbortSignal,
): Promise<GitHistoryEligibility> {
  return (await tracking(repo, path, run, head, signal)).tracked ? "tracked" : "untracked";
}

type Change = { status: string; oldMode: string; newMode: string; from: string; to: string };
type ChangeGroup = { hash: string; changes: Change[] };

function parseChanges(bytes: Buffer, limit: number): ChangeGroup[] {
  const items = fields(bytes);
  const commits: ChangeGroup[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < items.length; ) {
    const hash = items[index++];
    if (!hash || !oid.test(hash) || seen.has(hash) || commits.length >= limit) throw new MalformedHistory();
    seen.add(hash);
    const changes: Change[] = [];
    while (items[index]?.startsWith(":") || items[index]?.startsWith("\n:")) {
      const match = /^\n?:(\d{6}) (\d{6}) [a-f0-9]{40} [a-f0-9]{40} ([ADMT]|[MR]\d{1,3})$/.exec(
        items[index++] ?? "",
      );
      const from = items[index++];
      const to = match?.[3]?.startsWith("R") ? items[index++] : from;
      if (!match?.[1] || !match[2] || !match[3] || !from || !to) throw new MalformedHistory();
      changes.push({ oldMode: match[1], newMode: match[2], status: match[3][0] as string, from, to });
    }
    commits.push({ hash, changes });
  }
  return commits;
}

const rawOptions = [
  "--no-notes",
  "--no-show-signature",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-relative",
  "--ignore-submodules=all",
  "--find-renames",
  "--raw",
  "--no-abbrev",
  "-z",
  "--format=tformat:%H",
];

type Candidate = { hash: string; change: Change; checkRename: boolean };

function selectCandidates(groups: ChangeGroup[], literal: string, prefix: string) {
  const candidates: Candidate[] = [];
  let current = literal;
  let stopped = false;
  for (const { hash, changes } of groups) {
    const matches = changes.filter(({ to }) => to === current);
    if (matches.length > 1) throw new MalformedHistory();
    const change = matches[0];
    if (!change) continue;
    if (![change.oldMode, change.newMode].every((mode) => mode === "000000" || fileMode.test(mode))) {
      stopped = true;
      break;
    }
    // Git's path-specific follow may skip rename detection when a file replaces a directory.
    const checkRename = change.status === "D" || (change.status === "A" && changes.length > 1);
    candidates.push({ hash, change, checkRename });
    if (change.status === "R") {
      if (!scoped(change.from, prefix)) {
        stopped = true;
        break;
      }
      current = change.from;
    }
  }
  return { candidates, stopped };
}

async function fullRenames(candidates: Candidate[], run: GitCommand): Promise<Map<string, Change>> {
  const possible = candidates.filter(({ checkRename }) => checkRename);
  if (!possible.length) return new Map();
  const input = Buffer.from(possible.map(({ hash }) => hash + "\n").join(""));
  const output = await run(
    ["diff-tree", "-r", "--root", "--stdin", ...rawOptions, "--diff-filter=ADR"],
    1024 * 1024,
    undefined,
    input,
  );
  const changes = new Map(parseChanges(output, possible.length).map(({ hash, changes }) => [hash, changes]));
  const renames = new Map<string, Change>();
  for (const { hash, change: selected } of possible) {
    const matching = changes
      .get(hash)
      ?.filter(
        (change) =>
          (change.status === selected.status || change.status === "R") &&
          (selected.status === "D" ? change.from === selected.from : change.to === selected.to),
      );
    const change = matching?.[0];
    if (matching?.length !== 1 || !change) throw new MalformedHistory();
    if (change.status === "R") renames.set(hash, change);
  }
  return renames;
}

async function admitCandidates(
  repo: GitRepository,
  candidates: Candidate[],
  worktree: { gitlinks: ReadonlySet<string> },
  run: GitCommand,
  signal: AbortSignal,
): Promise<{
  hashes: string[];
  scopeBoundary: boolean;
  resume?: { hash: string; path: string };
  stopped: boolean;
}> {
  const renames = await fullRenames(candidates, run);
  const hashes: string[] = [];
  let scopeBoundary = false;

  for (const { hash, change } of candidates) {
    const rename = renames.get(hash);
    if (change.status === "D" && rename && !scoped(rename.to, repo.prefix)) {
      scopeBoundary = true;
      continue;
    }
    const predecessor =
      change.status === "R" ? change.from : change.status === "A" ? rename?.from : undefined;
    if (predecessor) {
      const path = scoped(predecessor, repo.prefix);
      if (!path) return { hashes, scopeBoundary: true, stopped: true };
      await checkedPath(repo, path, worktree, signal);
    }
    hashes.push(hash);
    if (predecessor && rename) {
      return { hashes, scopeBoundary, resume: { hash, path: predecessor }, stopped: false };
    }
  }
  return { hashes, scopeBoundary, stopped: false };
}

function commitMetadata(bytes: Buffer, hashes: string[]): GitHistoryCommit[] {
  const items = fields(bytes);
  if (items.length !== hashes.length * 4) throw new MalformedHistory();
  return hashes.map((hash, index) => {
    const [actual, author, timestamp, subject] = items.slice(index * 4, index * 4 + 4);
    if (actual !== hash || author === undefined || subject === undefined) throw new MalformedHistory();
    const parsedDate = authorDate.safeParse(timestamp);
    if (!parsedDate.success) throw new MalformedHistory();
    const date = new Date(parsedDate.data);
    if (!Number.isFinite(date.valueOf()) || date.getUTCFullYear() < 0 || date.getUTCFullYear() > 9999)
      throw new MalformedHistory();
    return { hash: hash.slice(0, 12), date: date.toISOString(), author, subject };
  });
}

/** Admits path events before reading the corresponding commit authors and subjects. */
export async function readPathHistory(
  repo: GitRepository,
  path: string,
  run: GitCommand,
  head: string,
  signal: AbortSignal,
): Promise<GitHistoryResult> {
  const selected = await tracking(repo, path, run, head, signal);
  if (!selected.tracked) return { state: "unavailable" };
  let revision = selected.revision ?? (await headCommit(run, head));
  if (!revision) return { state: "unborn" };
  let pathspec = selected.literal;
  const candidateLimit = GIT_HISTORY_PAGE_SIZE + 1;
  const hashes = new Set<string>();
  let scopeBoundary = false;
  let capped = false;

  for (let segment = 0; segment < 4; segment++) {
    const remaining = candidateLimit - hashes.size;
    const groups = parseChanges(
      await run(
        [
          "log",
          "--follow",
          "--date-order",
          "--no-decorate",
          "--no-use-mailmap",
          ...rawOptions,
          "--max-count=" + remaining,
          revision,
          "--",
          pathspec,
        ],
        512 * 1024,
      ),
      remaining,
    );
    const { candidates, stopped } = selectCandidates(groups, pathspec, repo.prefix);
    const admitted = await admitCandidates(repo, candidates, selected, run, signal);
    for (const hash of admitted.hashes) hashes.add(hash);
    scopeBoundary ||= admitted.scopeBoundary;
    capped = hashes.size >= candidateLimit || (!stopped && !admitted.stopped && groups.length === remaining);
    if (!admitted.resume || hashes.size >= candidateLimit) break;
    if (segment === 3) {
      capped = true;
      break;
    }
    // Resume from the actual parent of the verified in-scope rename.
    const parent = (await run(["rev-parse", "--verify", admitted.resume.hash + "^1"], 64)).toString().trim();
    if (!oid.test(parent)) throw new MalformedHistory();
    revision = parent;
    pathspec = admitted.resume.path;
  }
  if (!hashes.size) return capped ? { state: "read-limit" } : { state: "empty", scopeBoundary };
  const page = [...hashes].slice(0, GIT_HISTORY_PAGE_SIZE);
  const input = Buffer.from(page.join("\n") + "\n");
  const output = await run(
    [
      "log",
      "--no-walk=unsorted",
      "--stdin",
      "-z",
      "--encoding=UTF-8",
      "--no-decorate",
      "--no-use-mailmap",
      "--no-notes",
      "--no-show-signature",
      "--format=tformat:%H%x00%an%x00%aI%x00%s",
    ],
    2 * 1024 * 1024,
    undefined,
    input,
  );
  const commits = commitMetadata(output, page);
  return {
    state: "ready",
    commits,
    scopeBoundary,
    capped,
  };
}

export function historyReadFailure(error: unknown): GitHistoryResult {
  if (error instanceof MalformedHistory) return { state: "malformed" };
  if (error instanceof GitReadError && error.reason === "output-limit") return { state: "read-limit" };
  return { state: "unavailable" };
}
