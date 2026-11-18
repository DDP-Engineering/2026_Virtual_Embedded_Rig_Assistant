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
  await writeFile(join(root, ".vera/.veraignore"), "hidden/\n*.secret\n");
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
  const notRelative = "Use a workbench-relative path.";
  const device = "Device names and ambiguous Windows paths are unavailable.";
  const leaves = "Path leaves the workbench and additional folders.";
  const ignored = "Path is ignored by the workbench.";
  it.each([
    ["/etc/passwd", notRelative],
    ["C:\\Windows\\win.ini", notRelative],
    ["C:relative", notRelative],
    ["\\\\server\\share", notRelative],
    ["\\\\?\\C:\\x", notRelative],
    ["\\\\.\\pipe\\x", notRelative],
    ["CON", device],
    ["nul.txt", device],
    ["Docs/aux.md", device],
    ["LPT1.log", device],
    ["COM9", device],
    ["../outside", leaves],
    ["Docs/../../outside", leaves],
    ["a\0b", notRelative],
    [".vera/cache", ignored],
    ["x/.GIT/config", ignored],
    ["node_modules/x", ignored],
    ["hidden/new.txt", ignored],
    ["secret.secret", ignored],
    ["Docs/file:stream", notRelative],
    ["Docs/NUL .txt", device],
    ["Docs/trailing.", device],
    ["Docs/trailing ", device],
  ])("rejects %s", async (path, message) => {
    // The exact refusal: a path refused for another reason than its own would hide a lost check.
    await expect((await guard()).resolve(path)).rejects.toThrow(new Error(message));
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
    await rm(join(root, ".vera/.veraignore"));
    await writeFile(join(outside, "rules"), "");
    await symlink(
      process.platform === "win32" ? outside : join(outside, "rules"),
      join(root, ".vera/.veraignore"),
      process.platform === "win32" ? "junction" : "file",
    );
    await expect(guard()).rejects.toThrow();
  });
  it.skipIf(process.platform !== "win32")(
    "Windows ordinary mixed-case ignore metadata remains valid (native Windows only)",
    async () => {
      await rm(join(root, ".vera/.veraignore"));
      await writeFile(join(root, ".vera/.VeRaIgNoRe"), "hidden/\n");
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

// REQ-SEC-3856567c
it.each(["workbench", "filesystem"] as const)(
  "refuses application data and canonical aliases in %s scope",
  async (scope) => {
    const data = join(root, "app-data");
    await mkdir(data);
    await writeFile(join(data, "settings.json"), "private");
    await mkdir(join(root, "app-data-sibling"));
    await symlink(data, join(root, "data-alias"), process.platform === "win32" ? "junction" : "dir");
    const g = await api.PathGuard.create(root, root, scope, undefined, [data]);
    for (const path of [
      "app-data",
      "app-data/settings.json",
      "Docs/../app-data/new/deep.txt",
      "data-alias/settings.json",
      "data-alias/new/deep.txt",
    ]) {
      await expect(g.resolve(path)).rejects.toThrow(/VERA application data/);
    }
    if (process.platform === "win32")
      await expect(g.resolve("APP-DATA/SETTINGS.JSON")).rejects.toThrow(/VERA application data/);
    expect(await g.resolve("app-data-sibling/new.txt")).toMatchObject({
      relative: "app-data-sibling/new.txt",
    });
    const aliasedExclusion = await api.PathGuard.create(root, root, scope, undefined, [
      join(root, "data-alias"),
    ]);
    await expect(aliasedExclusion.resolve("app-data/new.txt")).rejects.toThrow(/VERA application data/);
    // Internal host storage deliberately does not carry agent exclusions.
    expect(await (await guard()).resolve("app-data/settings.json")).toMatchObject({
      relative: "app-data/settings.json",
    });
  },
);

it("refuses missing application-data descendants through existing parent aliases", async () => {
  await symlink(outside, join(root, "host-alias"), process.platform === "win32" ? "junction" : "dir");
  const g = await api.PathGuard.create(root, root, "filesystem", undefined, [
    join(root, "host-alias/future-data"),
  ]);
  await expect(g.resolve(join(outside, "future-data/new.txt"))).rejects.toThrow(/VERA application data/);
});

// REQ-SEC-f0170302, REQ-SEC-f0170303, REQ-SEC-f0170304
it("confines additional roots, retains absolute identities and revokes old guards", async () => {
  let folders = [outside];
  const ctx = Object.assign(api.createToolContext(root), { additionalFolders: () => folders });
  const { toolPathGuard } = await import("../tools/context.js");
  const g = await toolPathGuard(ctx, true);
  await writeFile(join(outside, "notes.txt"), "sibling");
  expect((await g.resolve(join(outside, "notes.txt"))).relative).toBe(
    join(outside, "notes.txt").replaceAll("\\", "/"),
  );
  expect((await g.resolve("Docs/Notes.md")).relative).toBe("Docs/Notes.md");
  await expect(g.resolve(join(outside, "../unlisted/file.txt"))).rejects.toThrow();
  await symlink(root, join(outside, "escape"), process.platform === "win32" ? "junction" : "dir");
  await expect(g.resolve(join(outside, "escape/Docs/Notes.md"))).rejects.toThrow();
  folders = [];
  await expect(g.resolve(join(outside, "notes.txt"))).rejects.toThrow(/revoked/);
  await expect((await toolPathGuard(ctx, true)).resolve(join(outside, "notes.txt"))).rejects.toThrow();
});

it("keeps primary ignores under nested grants and canonical alias identities under external grants", async () => {
  const { toolPathGuard } = await import("../tools/context.js");
  const ctx = Object.assign(api.createToolContext(root), {
    additionalFolders: () => [join(root, "hidden"), outside],
  });
  await mkdir(join(root, "hidden"));
  await expect((await toolPathGuard(ctx, true)).resolve(join(root, "hidden/file.txt"))).rejects.toThrow(
    /ignored/,
  );
  const alias = join(root, "sibling-alias");
  await symlink(outside, alias, process.platform === "win32" ? "junction" : "dir");
  ctx.additionalFolders = () => [alias];
  const g = await toolPathGuard(ctx, true);
  expect((await g.resolve(join(alias, "new.txt"))).key).toBe((await g.resolve(join(outside, "new.txt"))).key);
  await expect(g.resolve("../outside/new.txt")).rejects.toThrow();
});
