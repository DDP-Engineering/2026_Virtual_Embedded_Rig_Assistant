import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsService } from "../settings/service.js";
import { WorkbenchService } from "./service.js";

// The real bound is 50,000 entries; a small one keeps the test's folder small.
vi.mock("./tree.js", async (original) => ({
  ...(await original<typeof import("./tree.js")>()),
  FIND_WALK_LIMIT: 6,
}));

let root: string | undefined;
afterEach(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

it("completion stops walking at the entry bound and keeps the matches found so far", async () => {
  root = await mkdtemp(join(tmpdir(), "vera-wb-cap-"));
  const folder = join(root, "bench");
  await mkdir(join(folder, ".vera"), { recursive: true });
  const files = {
    read: async (path: string) => readFile(path, "utf8").catch(() => undefined),
    writeAtomic: async (path: string, text: string) => writeFile(path, text),
    backup: async () => true,
  };
  const paths = { userData: root, settings: join(root, "settings.json"), logs: join(root, "logs") };
  const settings = new SettingsService({ files, paths, uuid: randomUUID, changed: () => {} });
  await settings.load();
  const service = new WorkbenchService({
    userData: root,
    files,
    settings,
    appVersion: "0.0.0",
    now: () => new Date("2026-10-11T00:00:00Z"),
    pid: process.pid,
    isProcessAlive: (pid: number) => pid === process.pid,
    token: randomUUID,
    changed: () => {},
  });
  try {
    await service.create(folder, "Board");
    await mkdir(join(folder, "a"));
    for (const name of ["a/1.txt", "a/2.txt", "a/3.txt", "a/4.txt", "a/5.txt", "a/6.txt", "z-late.txt"])
      await writeFile(join(folder, name), "data");
    // ".vera" and "a" are the first two entries, so the walk ends inside "a".
    expect(await service.files("txt")).toEqual(["a/1.txt", "a/2.txt", "a/3.txt", "a/4.txt"]);
    expect(await service.files("late")).toEqual([]);
  } finally {
    await service.close();
  }
});
