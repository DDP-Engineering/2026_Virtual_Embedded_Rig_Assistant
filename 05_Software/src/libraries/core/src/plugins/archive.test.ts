import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { strToU8, zipSync } from "fflate";
import { afterEach, expect, it } from "vitest";
import { ArchiveError, checkTree, extractZip } from "./archive.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function temp() {
  const root = await mkdtemp(join(tmpdir(), "vera-archive-"));
  roots.push(root);
  return root;
}
async function zipFile(root: string, entries: Record<string, Uint8Array>, level: 0 | 6 = 6) {
  const file = join(root, "a.zip");
  await writeFile(file, zipSync(entries, { level }));
  return file;
}

// REQ-FUNC-aa09d82e
it("extracts the files and folders of a zip as a stream", async () => {
  const root = await temp();
  const big = new Uint8Array(3 * 1024 * 1024).map((_, index) => index % 251);
  const file = await zipFile(root, {
    "tool/bin/tool.exe": strToU8("binary"),
    "tool/share/": new Uint8Array(),
    "tool/data.bin": big,
    "README.txt": strToU8("hello"),
  });
  const target = join(root, "out");
  await mkdir(target);
  await extractZip(file, target);
  expect(await readFile(join(target, "tool/bin/tool.exe"), "utf8")).toBe("binary");
  expect(await readFile(join(target, "README.txt"), "utf8")).toBe("hello");
  expect(Buffer.compare(await readFile(join(target, "tool/data.bin")), Buffer.from(big))).toBe(0);
  expect(existsSync(join(target, "tool/share"))).toBe(true);
  const stored = join(root, "stored");
  await mkdir(stored);
  await extractZip(await zipFile(await temp(), { "x.txt": strToU8("plain") }, 0), stored);
  expect(await readFile(join(stored, "x.txt"), "utf8")).toBe("plain");
});

// REQ-SEC-e51bc0d8
it("refuses zip entries that leave the extraction folder", async () => {
  for (const name of [
    "../evil.txt",
    "/abs.txt",
    "C:/abs.txt",
    "..\\evil.txt",
    "a/../../evil.txt",
    "a//b.txt",
  ]) {
    const root = await temp();
    const target = join(root, "out");
    await mkdir(target);
    const file = await zipFile(root, { "ok.txt": strToU8("ok"), [name]: strToU8("evil") });
    await expect(extractZip(file, target), name).rejects.toBeInstanceOf(ArchiveError);
    expect(existsSync(join(root, "evil.txt")), name).toBe(false);
  }
  const root = await temp();
  await writeFile(join(root, "broken.zip"), "not a zip at all");
  await mkdir(join(root, "out"));
  await expect(extractZip(join(root, "broken.zip"), join(root, "out"))).rejects.toBeInstanceOf(ArchiveError);
});

// REQ-SEC-e51bc0d8
it("refuses a tree with a link that resolves outside it and accepts links inside", async () => {
  const root = await temp();
  const tree = join(root, "tree");
  await mkdir(join(tree, "lib"), { recursive: true });
  await writeFile(join(tree, "lib/real.txt"), "x");
  // Junctions need no privilege on Windows; elsewhere the type is ignored and a symlink is made.
  await symlink(join(tree, "lib"), join(tree, "inside"), "junction");
  await expect(checkTree(tree)).resolves.toBeUndefined();
  await mkdir(join(root, "outside"));
  await symlink(join(root, "outside"), join(tree, "lib", "escape"), "junction");
  await expect(checkTree(tree)).rejects.toBeInstanceOf(ArchiveError);
});
