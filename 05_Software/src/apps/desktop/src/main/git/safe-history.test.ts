import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { historyReadFailure, readPathHistory } from "./history.js";
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

async function selected(path: string) {
  const repo = await containingRepository(join(root, "bench"), signal());
  if (!repo) throw Error("Fixture has no repository");
  expect(typeof reader.historyEligibility, "GitReader should expose tracked history eligibility").toBe(
    "function",
  );
  expect(typeof reader.history, "GitReader should expose path history").toBe("function");
  return {
    eligibility: () => reader.historyEligibility(repo, path, signal()),
    history: () => reader.history(repo, path, signal()),
  };
}

function commit(subject: string) {
  git("add", "-A");
  git("commit", "-m", subject);
}

beforeEach(async () => {
  temporary = await mkdtemp(join(tmpdir(), "vera-git-history-"));
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

it("admits exact clean, missing and replaced tracked files without treating descendants or untracked files as tracked", async () => {
  await file("bench/[file].txt", "one");
  await file("bench/gone", "gone");
  await file("bench/replaced", "file");
  commit("Tracked");
  await file("bench/f.txt", "untracked");
  git("rm", "bench/gone", "bench/replaced");
  await mkdir(join(root, "bench/replaced"));
  await file("bench/replaced/child", "replacing child");
  git("add", "bench/replaced/child");
  for (const path of ["[file].txt", "gone", "replaced", "replaced/child"])
    expect(await (await selected(path)).eligibility()).toBe("tracked");
  expect(await (await selected("f.txt")).eligibility()).toBe("untracked");
  expect(await (await selected("gone")).history()).toMatchObject({
    state: "ready",
    commits: [{ subject: "Tracked" }],
  });
  expect(await (await selected("replaced")).history()).toMatchObject({
    state: "ready",
    commits: [{ subject: "Tracked" }],
  });
  await file("bench/gone", "untracked recreation");
  expect(await (await selected("gone")).eligibility()).toBe("untracked");
});

it("treats both spellings of a staged case-only rename as exact tracked paths", async () => {
  await file("bench/Example.txt", "tracked");
  commit("Original spelling");
  git("mv", "--", "bench/Example.txt", "bench/intermediate.txt");
  git("mv", "--", "bench/intermediate.txt", "bench/example.txt");
  const oldName = await selected("Example.txt");
  expect(await oldName.eligibility()).toBe("tracked");
  expect(await oldName.history()).toMatchObject({
    state: "ready",
    commits: [{ subject: "Original spelling" }],
  });
  const newName = await selected("example.txt");
  expect(await newName.eligibility()).toBe("tracked");
  expect(await newName.history()).toEqual({ state: "empty", scopeBoundary: false });
});

it("displays a valid subject in the encoding declared by Git beside UTF-8 commits", async () => {
  await file("bench/file", "original");
  git("add", "bench/file");
  const message = join(temporary, "message.txt");
  await writeFile(message, Buffer.from("Révision ancienne\n", "latin1"));
  git("-c", "i18n.commitEncoding=ISO-8859-1", "commit", "-F", message);
  await file("bench/file", "new");
  commit("Newer subject");
  expect(await (await selected("file")).history()).toMatchObject({
    state: "ready",
    commits: [{ subject: "Newer subject" }, { subject: "Révision ancienne" }],
  });
});

it("reads ordered metadata from local HEAD only, with no changes to the index or refs", async () => {
  const name = process.platform === "win32" ? "[file].txt" : ":(glob)[file]*.txt";
  await file(`bench/${name}`, "old");
  git("add", "-A");
  git("commit", "--date=2026-01-01T10:00:00+02:00", "--author=First <one@example.invalid>", "-m", "First");
  await file(`bench/${name}`, "new");
  git("add", "-A");
  git("commit", "--date=2026-01-02T10:00:00+02:00", "-m", "<script>literal</script>");
  const tip = git("rev-parse", "HEAD").toString().trim();
  git("switch", "-c", "unmerged-branch");
  await file(`bench/${name}`, "on another branch");
  commit("Other branch");
  git("switch", "main");
  const before = await readFile(join(root, ".git", "index"));
  expect(await (await selected(name)).history()).toMatchObject({
    state: "ready",
    commits: [
      {
        hash: tip.slice(0, 12),
        author: "VERA",
        date: "2026-01-02T08:00:00.000Z",
        subject: "<script>literal</script>",
      },
      {
        hash: expect.stringMatching(/^[a-f0-9]{12}$/),
        author: "First",
        date: "2026-01-01T08:00:00.000Z",
        subject: "First",
      },
    ],
    capped: false,
    scopeBoundary: false,
  });
  expect(await readFile(join(root, ".git", "index"))).toEqual(before);
  expect(git("rev-parse", "HEAD").toString().trim()).toBe(tip);
});

it("follows an in-scope rename and excludes both boundary commits and older outside metadata", async () => {
  await file("outside", "same content");
  commit("Private origin");
  git("mv", "outside", "bench/old");
  commit("Private inbound outside");
  await file("bench/old", "same content\nchanged");
  commit("Visible edit");
  git("mv", "bench/old", "bench/new");
  commit("Visible rename");
  git("mv", "bench/new", "outbound");
  commit("Private outbound destination");
  await file("bench/local", "local patch");
  commit("Other path");
  const result = await (await selected("local")).history();
  expect(result).toMatchObject({
    state: "ready",
    scopeBoundary: false,
    commits: [{ subject: "Other path" }],
  });
  // A staged addition with the same spelling is eligible, and still reads that path in HEAD history.
  await file("bench/new", "a newly staged file");
  git("add", "bench/new");
  expect(await (await selected("new")).history()).toMatchObject({
    state: "ready",
    scopeBoundary: true,
    commits: [{ subject: "Visible rename" }, { subject: "Visible edit" }],
  });
});

it.each([false, true])("resolves a rename into a former folder with in-scope source %s", async (inScope) => {
  const source = inScope ? "bench/original" : "outside";
  await mkdir(join(root, "bench/slot"));
  await file("bench/slot/child", "a distinct file");
  await file(source, "one file with its own history");
  commit("Original history");
  await rm(join(root, "bench/slot/child"));
  await rm(join(root, "bench/slot"), { recursive: true });
  git("mv", source, "bench/slot");
  commit("Rename replacing a folder");
  const actual = await (await selected("slot")).history();
  if (inScope) {
    expect(actual).toMatchObject({
      state: "ready",
      scopeBoundary: false,
      commits: [{ subject: "Rename replacing a folder" }, { subject: "Original history" }],
    });
  } else {
    expect(actual).toEqual({ state: "empty", scopeBoundary: true });
  }
});

it("distinguishes unborn HEAD, empty reachable history, and an unavailable read", async () => {
  await file("bench/new", "new");
  git("add", "bench/new");
  const entry = await selected("new");
  expect(await entry.eligibility()).toBe("tracked");
  expect(await entry.history()).toEqual({ state: "unborn" });
  git("reset");
  await file("bench/other", "base");
  git("add", "bench/other");
  git("commit", "-m", "Other history");
  git("add", "bench/new");
  expect(await entry.history()).toEqual({ state: "empty", scopeBoundary: false });
  git("config", "filter.danger.clean", "something-external");
  expect(await entry.history()).toEqual({ state: "unavailable" });
});

it("caps the first page without exposing additional commits", async () => {
  const entry = await selected("large");
  for (let index = 0; index < 52; index++) {
    await file("bench/large", String(index));
    commit(`Revision ${index}`);
  }
  const page = await entry.history();
  expect(page).toMatchObject({ state: "ready", capped: true });
  if (page.state !== "ready") return;
  expect(page.commits).toHaveLength(50);
  expect(page.commits[0]?.subject).toBe("Revision 51");
  expect(page.commits.at(-1)?.subject).toBe("Revision 2");
}, 60_000);

it("reports malformed framing without exposing any metadata", async () => {
  await file("bench/file", "file");
  commit("Fixture");
  const requestSignal = signal();
  const repo = await containingRepository(join(root, "bench"), requestSignal);
  if (!repo) throw new Error("Fixture has no repository");
  const hash = git("rev-parse", "HEAD").toString().trim();
  const fileId = git("rev-parse", "HEAD:bench/file").toString().trim();
  const outputs = [
    Buffer.from("100644 " + fileId + " 0\tbench/file\0"),
    Buffer.from(hash + "\n"),
    Buffer.from(hash + "\0\n:000000 100644 " + "0".repeat(40) + " " + fileId + " A\0bench/file\0"),
    Buffer.from(hash + "\0partial metadata\0"),
  ];
  await expect(
    readPathHistory(repo, "file", async () => outputs.shift() ?? Buffer.alloc(0), hash, requestSignal).catch(
      historyReadFailure,
    ),
  ).resolves.toEqual({ state: "malformed" });
});

it("does not publish a partial result when commit metadata exceeds the subprocess byte limit", async () => {
  await file("bench/file", "file");
  git("add", "bench/file");
  const message = join(temporary, "message.txt");
  await writeFile(message, "Subject " + "a".repeat(2 * 1024 * 1024) + "\n");
  git("commit", "-q", "-F", message);
  expect(await (await selected("file")).history()).toEqual({ state: "read-limit" });
});
