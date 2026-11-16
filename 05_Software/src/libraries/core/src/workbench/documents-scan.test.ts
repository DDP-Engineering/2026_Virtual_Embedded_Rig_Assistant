import { chmod, mkdir, mkdtemp, open, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { TEXT_LIMIT } from "../knowledge/ingest.js";
import { previewDocuments, relativeFolder, scanDocuments } from "./documents-scan.js";
import { createIgnoreRules } from "./ignore.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function bench() {
  const root = await mkdtemp(join(tmpdir(), "vera-scan-"));
  roots.push(root);
  const files: Record<string, string> = {
    "datasheets/stm32g474.pdf": "%PDF-1.7 ds",
    "datasheets/drv8305.pdf": "%PDF-1.7 driver",
    "notes/bringup.md": "# Bring-up",
    "notes/review.docx": "PK docx",
    "notes/deep/old/schedule.xls": "PK xlsx",
    "src/main.c": "int main(void) { return 0; }",
    "src/main.h": "#pragma once",
    ".git/config": "[core]",
    "build/out.txt": "ignored build log",
    "readme.txt": "root level",
    // The preview reads the ignore rules from the folder, like indexing.
    ".vera/.veraignore": "build/\n",
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}
const ignored = createIgnoreRules("build/\n");
/** Documentation settings with the defaults the tests do not vary. */
const docs = (
  include: string[],
  exclude: string[] = [],
  more: { maxFileMB?: number; maxFiles?: number } = {},
) => ({
  include,
  exclude,
  gitignore: false,
  maxFiles: 10000,
  ...more,
});

// REQ-FUNC-4ee03ca8
it("scans first-level documentation folders by kind and size, skipping code, ignored and VCS folders", async () => {
  const root = await bench();
  const before = await readdir(root, { recursive: true });
  const scan = await scanDocuments(root, ignored);
  expect(scan).toEqual({
    folders: [
      { path: "datasheets", bytes: 26, kinds: { pdf: 2 } },
      { path: "notes", bytes: 24, kinds: { markdown: 1, office: 2 } },
    ],
    truncated: false,
  });
  expect(await readdir(root, { recursive: true })).toEqual(before);
});

// REQ-FUNC-4ee03ca8
it("bounds the scan by entries and reports truncation", async () => {
  const root = await bench();
  const scan = await scanDocuments(root, ignored, { maxEntries: 3 });
  expect(scan.truncated).toBe(true);
  const shallow = await scanDocuments(root, ignored, { maxDepth: 1 });
  expect(shallow.folders.find((f) => f.path === "notes")?.kinds).toEqual({ markdown: 1, office: 1 });
  expect(shallow.truncated).toBe(true);
});

// REQ-FUNC-4ee03ca8
it("does not follow symbolic links while scanning", async () => {
  const root = await bench();
  const outside = await mkdtemp(join(tmpdir(), "vera-scan-outside-"));
  roots.push(outside);
  await writeFile(join(outside, "secret.pdf"), "%PDF secret");
  try {
    await symlink(outside, join(root, "linked"), "junction");
  } catch {
    return; // Links unavailable to this account; the walk still never follows them.
  }
  expect((await scanDocuments(root, ignored)).folders.map((f) => f.path)).not.toContain("linked");
});

// REQ-FUNC-ad5868a2
it("previews what the ingest selection admits, with modern office files indexed and legacy ones pending", async () => {
  const root = await bench();
  expect(await previewDocuments(root, docs(["datasheets/**"]))).toEqual({
    files: 2,
    bytes: 26,
    officePending: 0,
    truncated: false,
    guard: null,
  });
  expect(await previewDocuments(root, docs(["datasheets/**", "notes"]))).toEqual({
    files: 4,
    bytes: 43,
    officePending: 1,
    truncated: false,
    guard: null,
  });
  expect(await previewDocuments(root, docs(["datasheets/**", "notes/**"], ["notes/deep"]))).toEqual({
    files: 4,
    bytes: 43,
    officePending: 0,
    truncated: false,
    guard: null,
  });
  // Source code is not a document type and is not indexed (TASK-e5310cdb); build/ is ignored.
  expect((await previewDocuments(root, docs(["src/**"]))).files).toBe(0);
  expect((await previewDocuments(root, docs(["build/**"]))).files).toBe(0);
  await expect(previewDocuments(root, docs(["../**"]))).rejects.toMatchObject({ code: "INVALID" });
});

// REQ-FUNC-ad5868a2
it("previews documents at any depth, bounded only by its time limit", async () => {
  const root = await bench();
  const deep = "notes/1/2/3/4/5/6/7/8/9/10";
  await mkdir(join(root, deep), { recursive: true });
  await writeFile(join(root, deep, "deep.md"), "# Deep");
  expect(await previewDocuments(root, docs(["notes/**"]))).toMatchObject({ files: 3, truncated: false });
  // A count stopped by its time limit is reported as truncated, never as complete.
  const stopped = await previewDocuments(root, docs(["**"]), { signal: AbortSignal.abort() });
  expect(stopped.truncated).toBe(true);
  expect(stopped.files).toBeLessThan(6);
});

// REQ-FUNC-817bbf83
it("returns the indexer's count guard when the preview selects more than the file limit", async () => {
  const root = await bench();
  // datasheets/ 2, notes/ 2 and readme.txt; the legacy .xls, code and ignored files are not counted.
  expect((await previewDocuments(root, docs(["**"], [], { maxFiles: 5 }))).guard).toBeNull();
  expect((await previewDocuments(root, docs(["**"], [], { maxFiles: 4 }))).guard).toEqual({
    files: 5,
    limit: 4,
    folders: [
      { path: "datasheets", files: 2 },
      { path: "notes", files: 2 },
    ],
  });
  // An approval raises the limit to 120 % of the approved count, as in indexing.
  expect((await previewDocuments(root, docs(["**"], [], { maxFiles: 3 }), { approved: 5 })).guard).toBeNull();
  expect(
    (await previewDocuments(root, docs(["**"], [], { maxFiles: 3 }), { approved: 3 })).guard,
  ).toMatchObject({
    files: 5,
    limit: 3,
  });
});

// REQ-FUNC-03b73d56
it("relates picked folders inside the workbench and denies the root, outside and linked folders", async () => {
  const root = await bench();
  await mkdir(join(root, "manuals/st"), { recursive: true });
  expect(await relativeFolder(root, join(root, "manuals/st"))).toBe("manuals/st");
  expect(await relativeFolder(root, join(root, "datasheets"))).toBe("datasheets");
  await expect(relativeFolder(root, root)).rejects.toMatchObject({ code: "DENIED" });
  const outside = await mkdtemp(join(tmpdir(), "vera-scan-outside-"));
  roots.push(outside);
  await expect(relativeFolder(root, outside)).rejects.toMatchObject({ code: "DENIED" });
  try {
    await symlink(outside, join(root, "linked"), "junction");
  } catch {
    return;
  }
  await expect(relativeFolder(root, join(root, "linked"))).rejects.toMatchObject({ code: "DENIED" });
});

// REQ-FUNC-03b73d56
it("relates folders when the workbench root is reached through an alias above it", async () => {
  const root = await bench();
  await mkdir(join(root, "manuals"), { recursive: true });
  const parent = await mkdtemp(join(tmpdir(), "vera-scan-alias-"));
  roots.push(parent);
  const alias = join(parent, "alias");
  try {
    await symlink(root, alias, "junction");
  } catch {
    return;
  }
  expect(await relativeFolder(root, join(alias, "manuals"))).toBe("manuals");
  await expect(relativeFolder(root, join(alias, "..x"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  await mkdir(join(root, "..x"));
  expect(await relativeFolder(root, join(root, "..x"))).toBe("..x");
});

// REQ-FUNC-4ee03ca8 REQ-FUNC-ad5868a2
it("skips unreadable folders as a partial scan instead of failing", async () => {
  if (process.platform === "win32" || process.getuid?.() === 0) return; // POSIX permissions only.
  const root = await bench();
  await mkdir(join(root, "locked"));
  await writeFile(join(root, "locked/hidden.pdf"), "%PDF");
  await chmod(join(root, "locked"), 0o000);
  try {
    const scan = await scanDocuments(root, ignored);
    expect(scan.truncated).toBe(true);
    expect(scan.folders.map((f) => f.path)).toEqual(["datasheets", "notes"]);
    // Indexing skips an unreadable folder too, so the preview counts the rest and is complete.
    expect(await previewDocuments(root, docs(["**"]))).toMatchObject({ files: 5, truncated: false });
  } finally {
    await chmod(join(root, "locked"), 0o700);
  }
});

// REQ-FUNC-ad5868a2
it("previews nothing for an empty selection and skips files over the ingest size limits", async () => {
  const root = await bench();
  expect(await previewDocuments(root, docs([]))).toEqual({
    files: 0,
    bytes: 0,
    officePending: 0,
    truncated: false,
    guard: null,
  });
  const large = await open(join(root, "datasheets/huge.txt"), "w");
  await large.truncate(TEXT_LIMIT + 1);
  await large.close();
  expect((await previewDocuments(root, docs(["datasheets/**"]))).files).toBe(2);
  // docs.maxFileMB lowers the limit: 1 byte above 1 MiB is skipped, as indexing skips it.
  const mib = await open(join(root, "datasheets/mib.pdf"), "w");
  await mib.truncate(1024 * 1024 + 1);
  await mib.close();
  expect((await previewDocuments(root, docs(["datasheets/**"]))).files).toBe(3);
  expect((await previewDocuments(root, docs(["datasheets/**"], [], { maxFileMB: 1 }))).files).toBe(2);
});

// REQ-FUNC-03b73d56
it("denies a folder reached through a link inside the workbench even when names match", async () => {
  const root = await bench();
  await mkdir(join(root, "a"));
  try {
    await symlink(join(root, "datasheets"), join(root, "a", "datasheets"), "junction");
  } catch {
    return;
  }
  await expect(relativeFolder(root, join(root, "a", "datasheets"))).rejects.toMatchObject({ code: "DENIED" });
});

// REQ-FUNC-03b73d56
it("denies a folder reached through a link inside the workbench that points back at the root", async () => {
  const root = await bench();
  await mkdir(join(root, "manuals"));
  await mkdir(join(root, "a"));
  try {
    await symlink(root, join(root, "a", "loop"), "junction");
  } catch {
    return;
  }
  await expect(relativeFolder(root, join(root, "a", "loop", "manuals"))).rejects.toMatchObject({
    code: "DENIED",
  });
});
