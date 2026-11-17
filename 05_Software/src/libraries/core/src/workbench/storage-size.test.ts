import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { veraError } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import { workbenchStorageBytes } from "./storage-size.js";

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "vera-storage-size-"));
  roots.push(root);
  const folder = join(root, "bench");
  await mkdir(folder);
  return { root, folder, metadata: join(folder, ".vera") };
}

it("counts nested database, cache and download bytes, skipping linked directories and source files", async () => {
  const { root, folder, metadata } = await fixture();
  await mkdir(join(metadata, "downloads"), { recursive: true });
  await mkdir(join(metadata, "cache/empty"), { recursive: true });
  await writeFile(join(metadata, "vera.db"), Buffer.alloc(101));
  await writeFile(join(metadata, "vera.db-wal"), Buffer.alloc(21));
  await writeFile(join(metadata, "downloads/image.png"), Buffer.alloc(2048));
  await writeFile(join(folder, "source.txt"), Buffer.alloc(512));
  const outside = join(root, "external");
  await mkdir(outside);
  await writeFile(join(outside, "large.bin"), Buffer.alloc(4096));
  await symlink(outside, join(metadata, "linked"), process.platform === "win32" ? "junction" : "dir");
  expect(await workbenchStorageBytes(folder, () => {})).toBe(2170);
  await writeFile(join(metadata, "cache/new.bin"), Buffer.alloc(3000));
  expect(await workbenchStorageBytes(folder, () => {})).toBe(5170);
});

it("rejects a missing metadata directory and a redirected metadata root", async () => {
  const { root, folder, metadata } = await fixture();
  await expect(workbenchStorageBytes(folder, () => {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  const outside = join(root, "external");
  await mkdir(outside);
  await symlink(outside, metadata, process.platform === "win32" ? "junction" : "dir");
  await expect(workbenchStorageBytes(folder, () => {})).rejects.toMatchObject({ code: "DENIED" });
});

it("stops a measurement when its workbench scope changes", async () => {
  const { folder, metadata } = await fixture();
  await mkdir(join(metadata, "nested"), { recursive: true });
  await writeFile(join(metadata, "nested/file"), "bytes");
  let checks = 0;
  await expect(
    workbenchStorageBytes(folder, () => {
      if (++checks >= 3) throw veraError("CONFLICT");
    }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
});
