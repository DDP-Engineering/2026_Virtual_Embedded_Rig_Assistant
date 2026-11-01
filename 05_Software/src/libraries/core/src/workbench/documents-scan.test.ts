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
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  return root;
}
const ignored = createIgnoreRules("build/\n");

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
  expect(await previewDocuments(root, { include: ["datasheets/**"], exclude: [] }, ignored)).toEqual({
    files: 2,
    bytes: 26,
    officePending: 0,
    truncated: false,
  });
  expect(await previewDocuments(root, { include: ["datasheets/**", "notes"], exclude: [] }, ignored)).toEqual(
    { files: 4, bytes: 43, officePending: 1, truncated: false },
  );
  expect(
    await previewDocuments(
      root,
      { include: ["datasheets/**", "notes/**"], exclude: ["notes/deep"] },
      ignored,
    ),
  ).toEqual({ files: 4, bytes: 43, officePending: 0, truncated: false });
  // Source code is not a document type and is not indexed (TASK-e5310cdb).
  expect((await previewDocuments(root, { include: ["src/**"], exclude: [] }, ignored)).files).toBe(0);
  await expect(previewDocuments(root, { include: ["../**"], exclude: [] }, ignored)).rejects.toMatchObject({
    code: "INVALID",
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
    expect((await previewDocuments(root, { include: ["**"], exclude: [] }, ignored)).truncated).toBe(true);
  } finally {
    await chmod(join(root, "locked"), 0o700);
  }
});

// REQ-FUNC-ad5868a2
it("previews nothing for an empty selection and skips files over the ingest size limits", async () => {
  const root = await bench();
  expect(await previewDocuments(root, { include: [], exclude: [] }, ignored)).toEqual({
    files: 0,
    bytes: 0,
    officePending: 0,
    truncated: false,
  });
  const large = await open(join(root, "datasheets/huge.txt"), "w");
  await large.truncate(TEXT_LIMIT + 1);
  await large.close();
  expect((await previewDocuments(root, { include: ["datasheets/**"], exclude: [] }, ignored)).files).toBe(2);
  expect(
    (await previewDocuments(root, { include: ["datasheets/**"], exclude: [] }, ignored, { maxEntries: 2 }))
      .truncated,
  ).toBe(true);
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
