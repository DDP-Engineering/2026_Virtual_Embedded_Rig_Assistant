import { execFileSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GitReader, installedGit } from "./read.js";
import { readStatus } from "./status.js";
import { GitWatch } from "./watch.js";

const realChild = await vi.importActual<typeof import("node:child_process")>("node:child_process");
vi.mock("node:child_process", async (getOriginal) => {
  const actual = await getOriginal<typeof import("node:child_process")>();
  return { ...actual, spawn: vi.fn(actual.spawn) };
});

let fixture: string;
let root: string;
let scratch: string;
let executable: string;
let reader: GitReader;
const git = (...args: string[]) =>
  execFileSync(executable, ["-c", "user.name=VERA Test", "-c", "user.email=test@example.invalid", ...args], {
    cwd: root,
    env: {
      ...process.env,
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: process.platform === "win32" ? "NUL" : "/dev/null",
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
    .toString()
    .trim();
const status = (scope = root, signal = new AbortController().signal) => readStatus(reader, scope, signal);
const file = (path: string, content: string) => writeFile(join(root, path), content);
const snapshot = () => readFile(join(root, ".git", "index"));
beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), "vera-git-fixture-"));
  root = join(fixture, "repo");
  scratch = join(fixture, "app");
  await Promise.all([mkdir(root), mkdir(scratch)]);
  executable = (await installedGit(scratch, new AbortController().signal)) ?? "";
  expect(executable, "Git installed in the platform's trusted location").toBeTruthy();
  reader = new GitReader(scratch);
  git("init", "-b", "main");
});
afterEach(async () => {
  vi.unstubAllEnvs();
  vi.mocked(spawn).mockReset().mockImplementation(realChild.spawn);
  await rm(fixture, { recursive: true, force: true });
});
async function commitFiles(paths: string[]) {
  for (const path of paths) await file(path, `base ${path}\n`);
  git("add", "--", ...paths);
  git("commit", "-m", "Fixture");
}

// REQ-FUNC-1883b36f REQ-SEC-b24a8722
it("reports combined comparisons, scoped renames, absent paths, untracked paths and ignore rules", async () => {
  await mkdir(join(root, "bench"));
  await commitFiles([
    "bench/mixed.txt",
    "bench/source.txt",
    "bench/deleted.txt",
    "bench/cross.txt",
    "outside.txt",
  ]);
  await file("bench/mixed.txt", "staged\n");
  git("add", "bench/mixed.txt");
  await file("bench/mixed.txt", "working tree\n");
  git("mv", "bench/source.txt", "bench/target.txt");
  git("mv", "bench/cross.txt", "outside-target.txt");
  await rm(join(root, "bench/deleted.txt"));
  await file("bench/new [literal].txt", "new");
  await file("bench/.gitignore", "hidden.txt\n");
  await file("bench/hidden.txt", "ignored");
  await file("outside.txt", "outside only");
  const before = await snapshot();
  const result = (await status(join(root, "bench"))).status;
  expect(result).toMatchObject({ state: "ready", branch: { kind: "named", name: "main" }, conflicts: 0 });
  if (result.state !== "ready") throw Error(result.state);
  const entries = Object.fromEntries(result.entries.map((entry) => [entry.path, entry]));
  expect(Object.keys(entries).sort()).toEqual([
    ".gitignore",
    "cross.txt",
    "deleted.txt",
    "mixed.txt",
    "new [literal].txt",
    "source.txt",
    "target.txt",
  ]);
  expect(result.changed).toBe(7);
  expect(entries["mixed.txt"]).toMatchObject({ staged: "M", unstaged: "M", virtual: false });
  expect(entries["new [literal].txt"]).toMatchObject({ staged: null, unstaged: "?", virtual: false });
  expect(entries["deleted.txt"]).toMatchObject({ staged: null, unstaged: "D", virtual: true });
  expect(entries["cross.txt"]).toMatchObject({ staged: "D", virtual: true });
  expect(entries["cross.txt"]?.rename).toBeUndefined();
  expect(entries["source.txt"]).toMatchObject({
    staged: "R",
    virtual: true,
    rename: { role: "source", path: "target.txt" },
  });
  expect(entries["target.txt"]).toMatchObject({
    staged: "R",
    virtual: false,
    rename: { role: "destination", path: "source.txt" },
  });
  expect(await snapshot()).toEqual(before);
  expect(await readFile(join(root, "bench/mixed.txt"), "utf8")).toBe("working tree\n");
});

it("distinguishes a symbolic branch named (detached) from detached HEAD", async () => {
  git("symbolic-ref", "HEAD", "refs/heads/(detached)");
  expect((await status()).status).toMatchObject({
    state: "ready",
    branch: { kind: "unborn", name: "(detached)" },
  });
  await commitFiles(["file.txt"]);
  expect((await status()).status).toMatchObject({
    state: "ready",
    branch: { kind: "named", name: "(detached)" },
  });
});

it("keeps the old spelling of a case-only rename virtual unless independently recreated", async () => {
  await mkdir(join(root, "bench"));
  await commitFiles(["bench/Example.txt"]);
  git("mv", "--", "bench/Example.txt", "bench/intermediate.txt");
  git("mv", "--", "bench/intermediate.txt", "bench/example.txt");
  const scope = join(root, "bench");
  const result = (await status(scope)).status;
  expect(result).toMatchObject({
    state: "ready",
    entries: expect.arrayContaining([
      expect.objectContaining({ path: "Example.txt", virtual: true, staged: "R" }),
      expect.objectContaining({ path: "example.txt", virtual: false, staged: "R" }),
    ]),
  });
  if (process.platform !== "win32") {
    await file("bench/Example.txt", "recreated independent file");
    expect((await status(scope)).status).toMatchObject({
      state: "ready",
      entries: expect.arrayContaining([
        expect.objectContaining({ path: "Example.txt", virtual: false, staged: "R", unstaged: "?" }),
      ]),
    });
  }
});

it("updates a shared refs directory watch when switching to a sibling branch", async () => {
  await commitFiles(["file.txt"]);
  const earlier = git("rev-parse", "HEAD");
  await file("file.txt", "changed");
  git("commit", "-am", "Updated");
  git("branch", "next");
  const changed = vi.fn();
  const observer = new GitWatch(root, changed, vi.fn());
  try {
    const signal = new AbortController().signal;
    await observer.sync(await status(), signal);
    git("symbolic-ref", "HEAD", "refs/heads/next");
    await observer.sync(await status(), signal);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    changed.mockClear();
    await file(".git/refs/heads/next", `${earlier}\n`);
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
  } finally {
    observer.close();
  }
});

it("reports unborn, detached and conflicting states", async () => {
  expect((await status()).status).toEqual({
    state: "ready",
    branch: { kind: "unborn", name: "main" },
    entries: [],
    changed: 0,
    conflicts: 0,
  });
  await commitFiles(["conflict.txt"]);
  const base = git("rev-parse", "HEAD");
  git("switch", "-c", "side");
  await file("conflict.txt", "side\n");
  git("commit", "-am", "Side");
  git("switch", "main");
  await file("conflict.txt", "main\n");
  git("commit", "-am", "Main");
  expect(() => git("merge", "side")).toThrow();
  expect((await status()).status).toMatchObject({
    state: "ready",
    changed: 1,
    conflicts: 1,
    entries: [{ path: "conflict.txt", conflict: true }],
  });
  git("merge", "--abort");
  git("switch", "--detach", base);
  expect((await status()).status).toMatchObject({
    state: "ready",
    branch: { kind: "detached", name: base.slice(0, 7) },
  });
});

it("leaves nested repository contents and staged gitlinks out of the snapshot", async () => {
  await commitFiles(["outer.txt"]);
  await mkdir(join(root, "nested"));
  git("-C", "nested", "init", "-b", "inner");
  await file("nested/child.txt", "inner");
  git("-C", "nested", "add", "child.txt");
  git("-C", "nested", "commit", "-m", "Inner fixture");
  expect((await status()).status).toMatchObject({ state: "ready", entries: [] });
  git("add", "--", "nested");
  await file("nested/child.txt", "inner changed");
  expect((await status()).status).toMatchObject({ state: "ready", entries: [] });
});

it("fails closed before status when a nested repo contains an ordinary outer index path", async () => {
  await mkdir(join(root, "overlap"));
  await commitFiles(["overlap/outer.txt"]);
  git("-C", "overlap", "init", "-b", "inner");
  const start = vi.mocked(spawn).mock.calls.length;
  expect((await status()).status).toEqual({ state: "unsupported" });
  expect(
    vi
      .mocked(spawn)
      .mock.calls.slice(start)
      .some(([, argv]) => Array.isArray(argv) && argv.includes("status")),
  ).toBe(false);
});

// REQ-SEC-1b68aa62 REQ-REL-3cbc93f2
it("ignores inherited Git and repository execution settings and rejects includes and filters", async () => {
  await commitFiles(["visible.txt"]);
  git("config", "core.fsmonitor", "vera-benign-missing-fixture-program");
  git("config", "core.hooksPath", "vera-benign-fixture-hooks");
  git("config", "diff.fixture.command", "vera-benign-missing-fixture-program");
  git("config", "diff.fixture.textconv", "vera-benign-missing-fixture-program");
  await file(".gitattributes", "*.txt diff=fixture\n");
  await file("visible.txt", "edited");
  vi.stubEnv("GIT_CONFIG_COUNT", "1");
  vi.stubEnv("GIT_CONFIG_KEY_0", "include.path");
  vi.stubEnv("GIT_CONFIG_VALUE_0", "nonexistent-fixture");
  vi.stubEnv("GIT_DIR", join(fixture, "invalid"));
  vi.stubEnv("GIT_EXTERNAL_DIFF", "vera-benign-missing-fixture-program");
  expect((await status()).status).toMatchObject({
    state: "ready",
    entries: expect.arrayContaining([expect.objectContaining({ path: "visible.txt", unstaged: "M" })]),
  });
  vi.unstubAllEnvs();
  const config = await readFile(join(root, ".git", "config"), "utf8");
  await file(".git/config", `${config}[include]\npath = irrelevant\n`);
  expect((await status()).status).toEqual({ state: "unsupported" });
  await file(".git/config", `${config}[filter "inert"]\nclean = vera-benign-missing-fixture-program\n`);
  expect((await status()).status).toEqual({ state: "unsupported" });
});

it("keeps the subprocess isolated if the real repository config changes immediately before Git runs", async () => {
  await commitFiles(["visible.txt"]);
  await file("visible.txt", "new");
  await file(".gitattributes", "*.txt filter=fixture\n");
  expect((await status()).status.state).toBe("ready");
  const original = await readFile(join(root, ".git", "config"), "utf8");
  const configured = vi.fn();
  vi.mocked(spawn).mockImplementation((...args: Parameters<typeof spawn>) => {
    const [, argv, options] = args;
    if (Array.isArray(argv) && argv.includes("status")) {
      configured();
      writeFileSync(
        join(root, ".git", "config"),
        `${original}[filter "fixture"]\nclean = vera-benign-missing-fixture-program\nrequired = true\n`,
      );
      expect(options).toMatchObject({
        shell: false,
        windowsHide: true,
        env: {
          PATH: expect.stringContaining(scratch),
          GIT_OPTIONAL_LOCKS: "0",
          GIT_ALLOW_PROTOCOL: "",
          GIT_TERMINAL_PROMPT: "0",
        },
      });
      expect(options?.cwd).toEqual(expect.stringContaining(scratch));
      expect(argv.some((arg) => arg.startsWith("--git-dir=") && arg.includes(scratch))).toBe(true);
      expect(argv).not.toContain(`--git-dir=${join(root, ".git")}`);
    }
    return Reflect.apply(realChild.spawn, undefined, args);
  });
  expect((await status()).status).toMatchObject({
    state: "ready",
    entries: expect.arrayContaining([expect.objectContaining({ path: "visible.txt" })]),
  });
  expect(configured).toHaveBeenCalledTimes(1);
  expect((await status()).status).toEqual({ state: "unsupported" });
});

it("kills and drains an in-flight status before tearing down the private Git directory", async () => {
  const controller = new AbortController();
  expect((await status()).status.state).toBe("ready");
  const started = vi.fn();
  let captured: ReturnType<typeof spawn> | undefined;
  vi.mocked(spawn).mockImplementation((...args: Parameters<typeof spawn>) => {
    const argv = args[1];
    if (!Array.isArray(argv) || !argv.includes("status"))
      return Reflect.apply(realChild.spawn, undefined, args);
    captured = realChild.spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"]);
    started();
    return captured;
  });
  const running = status(root, controller.signal);
  await vi.waitFor(() => expect(started).toHaveBeenCalledOnce());
  controller.abort();
  await expect(running).rejects.toMatchObject({ name: "AbortError" });
  expect(captured?.killed).toBe(true);
});

it("watches tracked ignored paths and prunes unrelated ignored and nested directories", async () => {
  await mkdir(join(root, "selected"));
  await mkdir(join(root, "selected", "tracked"));
  await mkdir(join(root, "selected", "ignored"));
  await mkdir(join(root, "selected", "nested"));
  await file(".gitignore", "selected/tracked/\nselected/ignored/\n");
  await file("selected/tracked/kept.txt", "tracked");
  await file("selected/tracked/ignored.txt", "untracked ignored");
  await file("selected/ignored/deep.txt", "untracked ignored");
  git("add", "-f", ".gitignore", "selected/tracked/kept.txt");
  git("commit", "-m", "Tracked despite ignore");
  git("-C", "selected/nested", "init", "-b", "inner");
  await file("selected/nested/inner.txt", "not observed");
  git("-C", "selected/nested", "add", "--", "inner.txt");
  git("-C", "selected/nested", "commit", "-m", "Inner");
  const scope = join(root, "selected");
  const changed = vi.fn();
  const fault = vi.fn();
  const observer = new GitWatch(scope, changed, fault);
  try {
    const result = await status(scope);
    expect(result.status.state).toBe("ready");
    const controller = new AbortController();
    expect(await observer.sync(result, controller.signal)).toMatchObject({ limited: false });
    await file("selected/ignored/deep.txt", "still ignored");
    await file("selected/nested/inner.txt", "still nested");
    await new Promise((resolve) => setTimeout(resolve, 85));
    expect(changed).not.toHaveBeenCalled();
    await file("selected/tracked/kept.txt", "observable");
    await vi.waitFor(() => expect(changed).toHaveBeenCalled());
    expect(fault).not.toHaveBeenCalled();
  } finally {
    observer.close();
  }
});

it("distinguishes no repository, missing Git, unsupported gitfiles and canceled reads", async () => {
  expect((await status(fixture)).status).toEqual({ state: "no-repository" });
  expect(
    (await readStatus(new GitReader(scratch, async () => undefined), root, new AbortController().signal))
      .status,
  ).toEqual({
    state: "missing-git",
  });
  await mkdir(join(root, "linked"));
  await file("linked/.git", "gitdir: ../.git\n");
  expect((await status(join(root, "linked"))).status).toEqual({ state: "unsupported" });
  const controller = new AbortController();
  controller.abort();
  await expect(status(root, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
});
