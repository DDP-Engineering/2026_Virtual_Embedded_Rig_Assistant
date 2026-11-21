import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { GitReader, installedGit } from "./read.js";
import { containingRepository } from "./repository.js";

let temporary: string;
let root: string;
let executable: string;
let reader: GitReader;
const signal = () => new AbortController().signal;
const git = (...args: string[]) =>
  execFileSync(
    executable,
    ["--literal-pathspecs", "-c", "user.name=VERA", "-c", "user.email=test@example.invalid", ...args],
    {
      cwd: root,
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
const file = (path: string, value: string | Buffer) => writeFile(join(root, path), value);
async function diff(
  path: string,
  comparison: "staged" | "unstaged",
  scope = "bench",
  requestSignal = signal(),
) {
  const repo = await containingRepository(join(root, scope), requestSignal);
  if (!repo) throw Error("Fixture has no repository");
  return reader.diff(repo, path, comparison, requestSignal);
}

beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), "vera-git-diff-"));
  root = join(temporary, "repo");
  const app = join(temporary, "app");
  await Promise.all([mkdir(join(root, "bench"), { recursive: true }), mkdir(app)]);
  executable = (await installedGit(app, signal())) ?? "";
  expect(executable).not.toBe("");
  reader = new GitReader(app);
  git("init", "-b", "main");
});
afterEach(async () => {
  await rm(temporary, { recursive: true, force: true });
});

it("reads combined comparisons independently, treats pathspec syntax literally, and preserves the index", async () => {
  const name = process.platform === "win32" ? "[mix].txt" : ":(glob)[mix]*.txt";
  await file(`bench/${name}`, "base\n");
  await file("bench/m.txt", "unrelated base\n");
  git("add", ".");
  git("commit", "-m", "Fixture");
  await file(`bench/${name}`, "staged\n");
  git("add", "--", `bench/${name}`);
  await file(`bench/${name}`, "working tree\n");
  await file("bench/m.txt", "unrelated change\n");
  const before = await readFile(join(root, ".git", "index"));
  expect(await diff(name, "staged")).toMatchObject({
    state: "patch",
    base: "head",
    patch: expect.stringContaining("-base\n+staged"),
  });
  const unstaged = await diff(name, "unstaged");
  expect(unstaged).toMatchObject({
    state: "patch",
    base: "index",
    patch: expect.stringContaining("-staged\n+working tree"),
  });
  expect(JSON.stringify(unstaged)).not.toContain("unrelated");
  expect(await readFile(join(root, ".git", "index"))).toEqual(before);
});

it("supports unborn additions and excludes untracked files", async () => {
  await file("bench/added", "new line\n");
  git("add", "bench/added");
  await file("bench/untracked", "untracked content\n");
  expect(await diff("added", "staged")).toMatchObject({
    state: "patch",
    base: "empty-tree",
    patch: expect.stringContaining("+new line"),
  });
  expect(await diff("untracked", "unstaged")).toMatchObject({ state: "empty" });
  expect(await diff("added", "unstaged")).toMatchObject({ state: "empty" });
});

it("reads staged and worktree deletions and both sides of a confined rename", async () => {
  await file("bench/old name", "one\ntwo\nthree\nfour\n");
  await file("bench/staged-deletion", "staged deletion\n");
  await file("bench/unstaged-deletion", "unstaged deletion\n");
  git("add", ".");
  git("commit", "-m", "Fixture");
  git("mv", "bench/old name", "bench/new name");
  await file("bench/new name", "one\ntwo\nthree\nfive\n");
  git("add", "bench/new name");
  git("rm", "bench/staged-deletion");
  await rm(join(root, "bench", "unstaged-deletion"));
  for (const endpoint of ["old name", "new name"])
    expect(await diff(endpoint, "staged")).toMatchObject({
      state: "patch",
      rename: { from: "old name", to: "new name" },
      patch: expect.stringContaining("-four\n+five"),
    });
  expect(await diff("staged-deletion", "staged")).toMatchObject({
    state: "patch",
    patch: expect.stringContaining("-staged deletion"),
  });
  expect(await diff("unstaged-deletion", "unstaged")).toMatchObject({
    state: "patch",
    patch: expect.stringContaining("-unstaged deletion"),
  });
});

it("keeps cross-scope rename endpoints, traversal, nested repositories and gitlinks unavailable", async () => {
  await file("bench/outgoing", "outgoing private\n");
  await file("incoming", "outside private\n");
  await mkdir(join(root, "bench", "nested"));
  await file("bench/nested/file", "tracked\n");
  git("add", ".");
  git("commit", "-m", "Fixture");
  git("mv", "incoming", "bench/incoming");
  git("mv", "bench/outgoing", "outside-name");
  expect(await diff("outgoing", "staged")).toMatchObject({ state: "unavailable" });
  expect(await diff("incoming", "staged")).toMatchObject({ state: "unavailable" });
  await expect(diff("../outside-name", "staged")).rejects.toThrow();
  const oid = git("rev-parse", "HEAD").toString().trim();
  git("update-index", "--add", "--cacheinfo", `160000,${oid},bench/submodule`);
  await expect(diff("submodule", "staged")).rejects.toThrow();
  await mkdir(join(root, "bench", "nested", ".git"));
  await expect(diff("nested/file", "unstaged")).rejects.toThrow();
});

it("reports binary and oversized changes without patch text and ignores unsafe diff drivers", async () => {
  await file("bench/binary", Buffer.from([0, 1, 2]));
  await file("bench/large", "x".repeat(600_000));
  await file("bench/text", "base\n");
  git("add", ".");
  git("commit", "-m", "Fixture");
  await file("bench/binary", Buffer.from([0, 2, 3]));
  await file("bench/large", "y".repeat(600_000));
  await file("bench/text", "working tree\n");
  await file("bench/.gitattributes", "text diff=evil\nbinary diff\n");
  git("config", "diff.evil.command", "must-not-run");
  git("config", "diff.evil.textconv", "must-not-run");
  git("config", "diff.external", "must-not-run");
  expect(await diff("binary", "unstaged")).toEqual({ state: "binary", base: "index" });
  expect(await diff("large", "unstaged")).toEqual({ state: "too-large", base: "index" });
  expect(await diff("text", "unstaged")).toMatchObject({
    state: "patch",
    patch: expect.stringContaining("+working tree"),
  });
});

it("shows conflicts explicitly for either comparison", async () => {
  await file("bench/conflict", "base\n");
  git("add", ".");
  git("commit", "-m", "Fixture");
  git("checkout", "-b", "other");
  await file("bench/conflict", "other\n");
  git("commit", "-am", "Other");
  git("checkout", "main");
  await file("bench/conflict", "main\n");
  git("commit", "-am", "Main");
  expect(() => git("merge", "other")).toThrow();
  expect(await diff("conflict", "staged")).toMatchObject({ state: "conflict" });
  expect(await diff("conflict", "unstaged")).toMatchObject({ state: "conflict" });
});

it("isolates a staged file replaced by a tracked directory and the inverse replacement", async () => {
  await file("bench/former-file", "former file line\n");
  await mkdir(join(root, "bench", "former-dir"));
  await file("bench/former-dir/child", "former child line\n");
  git("add", ".");
  git("commit", "-m", "Fixture");
  await rm(join(root, "bench", "former-file"));
  await mkdir(join(root, "bench", "former-file"));
  await file("bench/former-file/child", "replacement child line\n");
  await rm(join(root, "bench", "former-dir/child"));
  await rm(join(root, "bench", "former-dir"), { recursive: true });
  await file("bench/former-dir", "replacement file line\n");
  git("add", "-A");
  expect(await diff("former-file", "staged")).toMatchObject({
    state: "patch",
    patch: expect.stringContaining("-former file line"),
  });
  expect(await diff("former-dir", "staged")).toMatchObject({
    state: "patch",
    patch: expect.stringContaining("+replacement file line"),
  });
});

it("keeps the empty-base comparison when an unborn index blob is unavailable", async () => {
  git(
    "update-index",
    "--add",
    "--cacheinfo",
    "100644,1111111111111111111111111111111111111111,bench/missing",
  );
  expect(await diff("missing", "staged")).toEqual({ state: "unavailable", base: "empty-tree" });
});

it("keeps a deletion admitted before another old file is paired with its replacement child", async () => {
  const common = Array.from({ length: 16 }, () => "shared line").join("\n");
  const removed = `${common}\nformer description\n`;
  const source = `${common}\nmatching source\n`;
  await file("bench/retired", removed);
  await file("bench/rename-source", source);
  git("add", ".");
  git("commit", "-m", "Fixture");
  await rm(join(root, "bench", "retired"));
  await mkdir(join(root, "bench", "retired"));
  await file("bench/retired/child", source);
  await rm(join(root, "bench", "rename-source"));
  git("add", "-A");
  const result = await diff("retired", "staged");
  expect(result).toMatchObject({ state: "patch", patch: expect.stringContaining("-former description") });
  expect(JSON.stringify(result)).not.toContain("matching source");
});

it("shows each confined rename when the two selected paths also contain another rename", async () => {
  await file("bench/[left]", "left one\nleft two\nleft three\nleft four\n");
  await mkdir(join(root, "bench", "right"));
  await file("bench/right/child", "right one\nright two\nright three\n");
  git("add", ".");
  git("commit", "-m", "Fixture");
  await rm(join(root, "bench", "[left]"));
  await rm(join(root, "bench", "right"), { recursive: true });
  await mkdir(join(root, "bench", "[left]"));
  await file("bench/right", "left one\nleft two\nleft three\nleft five\n");
  await file("bench/[left]/child", "right one\nright two\nright three\n");
  git("add", "-A");
  for (const endpoint of ["[left]", "right"]) {
    const result = await diff(endpoint, "staged");
    expect(result).toMatchObject({
      state: "patch",
      rename: { from: "[left]", to: "right" },
      patch: expect.stringContaining("-left four\n+left five"),
    });
    expect(JSON.stringify(result)).not.toContain("right three");
  }
});
