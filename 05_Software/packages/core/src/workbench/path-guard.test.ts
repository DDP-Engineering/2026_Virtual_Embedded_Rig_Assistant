import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as api from "../index.js";

let root: string;
let outside: string;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-guard-"));
  outside = await mkdtemp(join(tmpdir(), "vera-outside-"));
  await mkdir(join(root, "Docs"));
  await writeFile(join(root, "Docs/Notes.md"), "hello");
  await mkdir(join(root, ".vera"));
  await writeFile(join(root, ".veraignore"), "hidden/\n*.secret\n");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});
async function guard() {
  expect(api.PathGuard).toBeTypeOf("function");
  return api.PathGuard.create(root);
}
describe("file tool confinement", () => {
  it("accepts nested relative paths and deepest existing ancestors", async () => {
    const g = await guard();
    expect(await g.resolve("Docs/Notes.md")).toMatchObject({ relative: "Docs/Notes.md" });
    expect((await g.resolve("Docs/new/deep.txt")).absolute).toBe(join(root, "Docs/new/deep.txt"));
    expect((await g.resolve(".")).absolute).toBe(root);
  });
  it.each([
    "/etc/passwd",
    "C:\\Windows\\win.ini",
    "C:relative",
    "\\\\server\\share",
    "\\\\?\\C:\\x",
    "\\\\.\\pipe\\x",
    "CON",
    "nul.txt",
    "Docs/aux.md",
    "LPT1.log",
    "COM9",
    "../outside",
    "Docs/../../outside",
    "a\0b",
    ".vera/cache",
    "x/.GIT/config",
    "node_modules/x",
    "hidden/new.txt",
    "secret.secret",
    "Docs/file:stream",
    "Docs/NUL .txt",
    "Docs/trailing.",
    "Docs/trailing ",
  ])("rejects %s", async (path) => {
    await expect((await guard()).resolve(path)).rejects.toThrow();
  });
  it("rejects external directory links including nonexistent descendants", async () => {
    await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
    await expect((await guard()).resolve("escape/new.txt")).rejects.toThrow();
  });
  it("rejects aliases into ignored folders and redirected ignore metadata", async () => {
    await symlink(
      join(root, ".vera"),
      join(root, "alias"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect((await guard()).resolve("alias/new.txt")).rejects.toThrow();
    await rm(join(root, ".veraignore"));
    await writeFile(join(outside, "rules"), "");
    await symlink(
      process.platform === "win32" ? outside : join(outside, "rules"),
      join(root, ".veraignore"),
      process.platform === "win32" ? "junction" : "file",
    );
    await expect(guard()).rejects.toThrow();
  });
  it.skipIf(process.platform !== "win32")(
    "Windows ordinary mixed-case ignore metadata remains valid (native Windows only)",
    async () => {
      await rm(join(root, ".veraignore"));
      await writeFile(join(root, ".VeRaIgNoRe"), "hidden/\n");
      const g = await guard();
      expect(await g.resolve("Docs/Notes.md")).toMatchObject({ relative: "Docs/Notes.md" });
      await expect(g.resolve("hidden/new.txt")).rejects.toThrow(/ignored/);
    },
  );
  it.skipIf(process.platform !== "win32")(
    "Windows case aliases resolve identically (native Windows only)",
    async () => {
      const g = await guard();
      expect(await g.resolve("Docs/Notes.md")).toEqual(await g.resolve("docs/notes.md"));
    },
  );
  it.skipIf(process.platform === "win32")(
    "POSIX sibling prefix is outside root (native POSIX only)",
    async () => {
      const sibling = `${root}-sibling`;
      await mkdir(sibling);
      try {
        await symlink(sibling, join(root, "prefix"));
        await expect((await guard()).resolve("prefix/new")).rejects.toThrow();
      } finally {
        await rm(sibling, { recursive: true, force: true });
      }
    },
  );
});
