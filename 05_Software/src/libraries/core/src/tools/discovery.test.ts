import { mkdir, mkdtemp, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as api from "../index.js";

let root: string;
let outside: string;
const signal = () => new AbortController().signal;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "vera-discovery-"));
  outside = await mkdtemp(join(tmpdir(), "vera-outside-"));
  for (const folder of ["docs/nested/deep", ".vera", ".git", "node_modules", "hidden"]) {
    await mkdir(join(root, folder), { recursive: true });
    await writeFile(join(root, folder, "test.txt"), "data");
  }
  await writeFile(join(root, "docs/old.md"), "old");
  await writeFile(join(root, "docs/new.md"), "new");
  await utimes(join(root, "docs/old.md"), 100, 100);
  await utimes(join(root, "docs/new.md"), 200, 200);
  await writeFile(join(root, ".vera/.veraignore"), "hidden/\n*.txt\n!docs/nested/deep/test.txt\n");
  await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});
it("lists default depth and depths1 to3 with ignores and confined ordinary entries", async () => {
  expect(api.listTool).toBeDefined();
  const ctx = api.createToolContext(root);
  const top = await api.listTool.execute(ctx, {}, signal());
  expect(top.entries).toEqual([{ name: "docs", type: "directory", bytes: 0 }]);
  const deep = await api.listTool.execute(ctx, { path: "docs", depth: 3 }, signal());
  expect(deep.entries).toContainEqual({ name: "docs/nested/deep/test.txt", type: "file", bytes: 4 });
  expect((await api.listTool.execute(ctx, { path: "docs", depth: 1 }, signal())).entries).not.toContainEqual(
    expect.objectContaining({ name: "docs/nested/deep/test.txt" }),
  );
});
it("globs newest first with relative base and caps at500", async () => {
  expect(api.globTool).toBeDefined();
  const ctx = api.createToolContext(root);
  expect(await api.globTool.execute(ctx, { pattern: "*.md", path: "docs" }, signal())).toMatchObject({
    paths: ["docs/new.md", "docs/old.md"],
    truncated: false,
  });
  await mkdir(join(root, "many"));
  for (let i = 0; i < 501; i++) await writeFile(join(root, "many", `${i}.md`), "data");
  const many = await api.globTool.execute(ctx, { pattern: "many/*.md" }, signal());
  expect(many.paths).toHaveLength(500);
  expect(many.truncated).toBe(true);
  const all = await api.globTool.execute(ctx, { pattern: "**/*" }, signal());
  expect(JSON.stringify(all)).not.toMatch(/node_modules|\.vera\/|\.git\/|hidden\/|escape\//);
  await expect(api.globTool.execute(ctx, { pattern: "../**/*" }, signal())).rejects.toThrow();
});
