// REQ-FUNC-da6632e8 REQ-SEC-aacbd514 REQ-REL-c097dfac
import {
  GIT_DIFF_LINE_LIMIT,
  GIT_DIFF_PATCH_LIMIT,
  type GitComparison,
  type GitDiffResult,
} from "@vera/shared";
import { checkedPath, exactFilePathspec, scoped } from "./index-scope.js";
import type { GitCommand } from "./read.js";
import { boundedFile, GitReadError, type GitRepository } from "./repository.js";

const sourceLimit = 512 * 1024;
const rawLimit = 4 * 1024 * 1024;
const zeroOid = "0".repeat(40);
const decode = (bytes: Buffer) => new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
type Index = { gitlinks: ReadonlySet<string>; unmerged: ReadonlySet<string> };
type Change = {
  raw: string;
  oldMode: string;
  newMode: string;
  oldOid: string;
  newOid: string;
  from: string;
  to: string;
};

function records(output: string[]) {
  const changes: Change[] = [];
  let i = 0;
  for (; i < output.length && output[i]?.startsWith(":"); ) {
    const raw = output[i++];
    const match = /^:(\d{6}) (\d{6}) ([a-f0-9]{40}) ([a-f0-9]{40}) ([ADMTU]|R\d{1,3}|M\d{1,3})$/.exec(
      raw ?? "",
    );
    const from = output[i++];
    const to = match?.[5]?.startsWith("R") ? output[i++] : from;
    if (!match || !from || !to || !raw || changes.length === 20_000) throw new GitReadError("failed");
    const [, oldMode = "", newMode = "", oldOid = "", newOid = ""] = match;
    changes.push({ raw, oldMode, newMode, oldOid, newOid, from, to });
  }
  return { changes, next: i };
}

const isText = (bytes: Buffer) => {
  if (bytes.includes(0)) return false;
  try {
    decode(bytes);
    return true;
  } catch {
    return false;
  }
};

function patchResult(
  output: Buffer,
  expected: Change,
  context: Pick<GitDiffResult, "base" | "rename">,
): GitDiffResult {
  const separator = output.indexOf("\0\0");
  if (separator < 0) return { ...context, state: "unavailable" };
  const fields = decode(output.subarray(0, separator)).split("\0");
  const { changes, next } = records(fields);
  const [change] = changes;
  const renamed = expected.from !== expected.to;
  if (
    changes.length !== 1 ||
    !change ||
    expected.raw !== change.raw ||
    expected.from !== change.from ||
    expected.to !== change.to
  )
    return { ...context, state: "unavailable" };

  const statistics = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(fields[next] ?? "");
  if (
    !statistics ||
    (renamed
      ? statistics[3] !== "" ||
        fields[next + 1] !== change.from ||
        fields[next + 2] !== change.to ||
        fields.length !== next + 3
      : statistics[3] !== change.from || fields.length !== next + 1)
  )
    return { ...context, state: "unavailable" };
  if (statistics[1] === "-" || statistics[2] === "-") return { ...context, state: "binary" };
  const patchBytes = output.subarray(separator + 2);
  if (!isText(patchBytes)) return { ...context, state: "binary" };
  const lines = decode(patchBytes).split("\n");
  const firstHunk = lines.findIndex((line) => line.startsWith("@@ "));
  // Git's path headers may quote or escape original names. Only the typed Display labels carry paths.
  const modes = lines
    .slice(1, firstHunk < 0 ? undefined : firstHunk)
    .filter((line) => /^(?:old mode|new mode|new file mode|deleted file mode) [0-7]{6}$/.test(line));
  const patch = [...modes, ...(firstHunk < 0 ? [] : lines.slice(firstHunk))].join("\n");
  if (patch.length > GIT_DIFF_PATCH_LIMIT || lines.length > GIT_DIFF_LINE_LIMIT)
    return { ...context, state: "too-large" };
  return patch ? { ...context, state: "patch", patch } : { ...context, state: "empty" };
}

/** Reads a single path comparison inside the isolated Git metadata snapshot. */
export async function readPathDiff(
  repo: GitRepository,
  path: string,
  comparison: GitComparison,
  index: Index,
  run: GitCommand,
  signal: AbortSignal,
): Promise<GitDiffResult> {
  const selected = await checkedPath(repo, path, index, signal);
  const base =
    comparison === "unstaged"
      ? "index"
      : (await run(["rev-parse", "--verify", "--quiet", "HEAD"], 64, "allow-unborn-head")).length
        ? "head"
        : "empty-tree";
  if (selected.stat && !selected.stat.isFile() && !selected.stat.isDirectory())
    return { state: "unavailable", base };
  if (index.unmerged.has(path)) return { state: "conflict", base };
  const literal = repo.prefix ? `${repo.prefix}/${path}` : path;
  const options = [
    "diff",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-relative",
    "--ignore-submodules=all",
    "--no-abbrev",
    ...(comparison === "staged" ? ["--cached"] : []),
  ];
  const scope = comparison === "unstaged" && repo.prefix ? [repo.prefix] : [];
  try {
    const output = decode(
      await run([...options, "--find-renames", "--raw", "-z", "--", ...scope], rawLimit),
    ).split("\0");
    if (output.pop() !== "") throw new GitReadError("failed");
    const { changes, next } = records(output);
    if (next !== output.length) throw new GitReadError("failed");
    const matching = changes.filter((change) => change.from === literal || change.to === literal);
    if (!matching.length) return { state: "empty", base };
    if (matching.length !== 1) return { state: "unavailable", base };
    const change = matching[0] as Change;
    const from = scoped(change.from, repo.prefix);
    const to = scoped(change.to, repo.prefix);
    if (
      !from ||
      !to ||
      ![change.oldMode, change.newMode].every((mode) => /^(000000|100644|100755)$/.test(mode))
    )
      return { state: "unavailable", base };
    if (index.unmerged.has(from) || index.unmerged.has(to)) return { state: "conflict", base };
    if (from !== path) await checkedPath(repo, from, index, signal);
    const worktree = to === path ? selected : await checkedPath(repo, to, index, signal);
    const context: Pick<GitDiffResult, "base" | "rename"> = {
      base,
      ...(from !== to ? { rename: { from, to } } : {}),
    };
    for (const oid of new Set([change.oldOid, change.newOid])) {
      if (oid !== zeroOid && !isText(await run(["cat-file", "blob", oid], sourceLimit)))
        return { ...context, state: "binary" };
    }
    if (comparison === "unstaged" && change.newMode !== "000000") {
      if (!worktree.stat?.isFile()) return { ...context, state: "unavailable" };
      if (worktree.stat.size > sourceLimit) return { ...context, state: "too-large" };
      const bytes = await boundedFile(worktree.location, sourceLimit);
      if (!bytes) return { ...context, state: "unavailable" };
      if (!isText(bytes)) return { ...context, state: "binary" };
    }
    const renamed = change.from !== change.to;
    const patch = await run(
      [
        ...options,
        renamed ? "--find-renames" : "--no-renames",
        "--patch-with-raw",
        "--numstat",
        "-z",
        "--",
        exactFilePathspec(change.from),
        ...(renamed ? [exactFilePathspec(change.to)] : []),
      ],
      GIT_DIFF_PATCH_LIMIT,
      "exact-file-paths",
    );
    if (from !== to) await checkedPath(repo, from, index, signal);
    const latest = await checkedPath(repo, to, index, signal);
    if (comparison === "unstaged" && !worktree.stat && latest.stat)
      return { ...context, state: "unavailable" };
    if (comparison === "unstaged" && worktree.stat) {
      const { ino, dev, mtimeMs, ctimeMs, size } = worktree.stat;
      if (
        latest.stat?.ino !== ino ||
        latest.stat.dev !== dev ||
        latest.stat.mtimeMs !== mtimeMs ||
        latest.stat.ctimeMs !== ctimeMs ||
        latest.stat.size !== size
      )
        return { ...context, state: "unavailable" };
    }
    return patchResult(patch, change, context);
  } catch (error) {
    signal.throwIfAborted();
    return {
      state: error instanceof GitReadError && error.reason === "output-limit" ? "too-large" : "unavailable",
      base,
    };
  }
}
