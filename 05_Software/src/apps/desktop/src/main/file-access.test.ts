import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

let createFileAccess: typeof import("./file-access.js").createFileAccess;
beforeAll(async () => {
  expect(existsSync(new URL("./file-access.ts", import.meta.url)), "atomic file port exists").toBe(true);
  ({ createFileAccess } = await import("./file-access.js"));
});
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((p) => rm(p, { recursive: true, force: true })));
});
async function temp() {
  const p = await mkdtemp(join(tmpdir(), "vera-settings-"));
  dirs.push(p);
  return p;
}
const clock = { now: () => new Date(), sleep: vi.fn(async () => {}) };

it("interruption between write and rename preserves the previous valid file and cleans temp", async () => {
  const dir = await temp();
  const path = join(dir, "settings.json");
  await writeFile(path, '{"theme":"system"}');
  const failRename = vi.fn(async (source: string) => {
    expect(JSON.parse(await readFile(source, "utf8"))).toEqual({ theme: "dark" });
    throw Object.assign(new Error("interrupted"), { code: "EIO" });
  });
  const files = createFileAccess(clock, { rename: failRename });
  await expect(files.writeAtomic(path, '{"theme":"dark"}')).rejects.toThrow("interrupted");
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ theme: "system" });
  expect(await readdir(dir)).toEqual(["settings.json"]);
  await createFileAccess(clock).writeAtomic(path, '{"theme":"light"}');
  expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ theme: "light" });
});
it.each(["EPERM", "EBUSY", "EACCES"])("retries transient Windows rename %s asynchronously", async (code) => {
  const dir = await temp();
  const path = join(dir, "settings.json");
  const attempt = vi
    .fn()
    .mockRejectedValueOnce(Object.assign(new Error("busy"), { code }))
    .mockImplementation(rename);
  const sleep = vi.fn(async () => {});
  await createFileAccess({ ...clock, sleep }, { rename: attempt }).writeAtomic(path, "{}");
  expect(attempt).toHaveBeenCalledTimes(2);
  expect(sleep).toHaveBeenCalledWith(10);
  expect(await readFile(path, "utf8")).toBe("{}");
});
it("bounded retry exhaustion retains old bytes and cleans temporary files", async () => {
  const dir = await temp();
  const path = join(dir, "settings.json");
  await writeFile(path, "old");
  const attempt = vi.fn().mockRejectedValue(Object.assign(new Error("busy"), { code: "EBUSY" }));
  const sleep = vi.fn(async () => {});
  await expect(
    createFileAccess({ ...clock, sleep }, { rename: attempt }).writeAtomic(path, "new"),
  ).rejects.toThrow("busy");
  expect(attempt).toHaveBeenCalledTimes(21);
  expect(sleep).toHaveBeenCalledTimes(20);
  expect(await readFile(path, "utf8")).toBe("old");
  expect(await readdir(dir)).toEqual(["settings.json"]);
});
it("exclusive backups preserve old data, absence is distinct from I/O failure", async () => {
  const dir = await temp();
  const files = createFileAccess(clock);
  const path = join(dir, "backup");
  expect(await files.read(path)).toBeUndefined();
  expect(await files.backup(path, "original")).toBe(true);
  expect(await files.backup(path, "replacement")).toBe(false);
  expect(await files.read(path)).toBe("original");
  await expect(files.read(dir)).rejects.toThrow();
});
