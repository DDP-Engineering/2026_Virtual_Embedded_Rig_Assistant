// REQ-FUNC-889beffd REQ-FUNC-2e3fad2d REQ-FUNC-70dc2e8f REQ-FUNC-98e9d760 REQ-FUNC-aad416b5
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, expect, it } from "vitest";

let tree: typeof import("./tree.js");
beforeAll(async () => {
  expect(existsSync(new URL("./tree.ts", import.meta.url)), "workbench tree module exists").toBe(true);
  tree = await import("./tree.js");
});
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function bench(extra: Record<string, string | Buffer> = {}) {
  const root = await mkdtemp(join(tmpdir(), "vera-tree-"));
  roots.push(root);
  const files: Record<string, string | Buffer> = {
    "readme.txt": "hello",
    "docs/a.pdf": "%PDF-1.4",
    "docs/b.md": "# B",
    "docs/doc2.md": "two",
    "docs/doc10.md": "ten",
    "docs/sub/c.txt": "c",
    "firmware/main.c": "int main(void) {\n  return 0;\n}\n",
    "firmware/bin.dat": Buffer.from([0, 1, 2, 3]),
    ".git/config": "[core]",
    "node_modules/x/y.js": "x",
    "ignored/z.md": "# hidden",
    ".vera/.veraignore": "ignored/\n",
    ...extra,
  };
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(root, path, ".."), { recursive: true });
    await writeFile(join(root, path), content);
  }
  let linked = false;
  try {
    await symlink(
      join(root, "firmware"),
      join(root, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );
    linked = true;
  } catch {
    // Links may be unavailable; the other cases still run.
  }
  return { root, linked };
}

it("lists every entry but links, folders first, in natural name order, marking ignored ones", async () => {
  const b = await bench();
  const top = await tree.listFolder(b.root, "");
  expect(top).toEqual({
    entries: [
      { name: ".git", path: ".git", type: "folder", ignored: true },
      { name: ".vera", path: ".vera", type: "folder", ignored: true },
      { name: "docs", path: "docs", type: "folder", ignored: false },
      { name: "firmware", path: "firmware", type: "folder", ignored: false },
      { name: "ignored", path: "ignored", type: "folder", ignored: true },
      { name: "node_modules", path: "node_modules", type: "folder", ignored: true },
      { name: "readme.txt", path: "readme.txt", type: "file", ignored: false },
    ],
    truncated: false,
  });
  // Everything inside an ignored folder is ignored too.
  expect((await tree.listFolder(b.root, ".git")).entries).toEqual([
    { name: "config", path: ".git/config", type: "file", ignored: true },
  ]);
  expect((await tree.listFolder(b.root, "node_modules/x")).entries).toEqual([
    { name: "y.js", path: "node_modules/x/y.js", type: "file", ignored: true },
  ]);
  expect((await tree.listFolder(b.root, "ignored")).entries).toEqual([
    { name: "z.md", path: "ignored/z.md", type: "file", ignored: true },
  ]);
  expect((await tree.listFolder(b.root, "docs")).entries.map((e) => e.name)).toEqual([
    "sub",
    "a.pdf",
    "b.md",
    "doc2.md",
    "doc10.md",
  ]);
  for (const path of ["../x", "/abs"])
    await expect(tree.listFolder(b.root, path), path).rejects.toMatchObject({ code: "DENIED" });
  if (b.linked) await expect(tree.listFolder(b.root, "link")).rejects.toMatchObject({ code: "DENIED" });
  await expect(tree.listFolder(b.root, "missing")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("caps a folder at 5,000 entries and says so", async () => {
  const b = await bench();
  await mkdir(join(b.root, "many"));
  await Promise.all(Array.from({ length: 5001 }, (_, n) => writeFile(join(b.root, "many", `f${n}.txt`), "")));
  const many = await tree.listFolder(b.root, "many");
  expect(many.entries).toHaveLength(5000);
  expect(many.truncated).toBe(true);
}, 30000);

it("finds visible files by a case-insensitive name fragment, at most 200 with a flag", async () => {
  const b = await bench();
  expect(await tree.findFiles(b.root, "MAIN")).toEqual({ paths: ["firmware/main.c"], truncated: false });
  expect((await tree.findFiles(b.root, "z.md")).paths).toEqual([]);
  expect((await tree.findFiles(b.root, "y.js")).paths).toEqual([]);
  expect((await tree.findFiles(b.root, "config")).paths).toEqual([]);
  await expect(tree.findFiles(b.root, "  ")).rejects.toMatchObject({ code: "INVALID" });
  await mkdir(join(b.root, "hits"));
  await Promise.all(
    Array.from({ length: 250 }, (_, n) => writeFile(join(b.root, "hits", `hit${n}.txt`), "")),
  );
  const hits = await tree.findFiles(b.root, "hit");
  expect(hits.paths).toHaveLength(200);
  expect(hits.truncated).toBe(true);
  expect(hits.paths[0]).toBe("hits/hit0.txt");
});

it("reads a text file, ignored or not, and refuses binary, large, linked and outside paths", async () => {
  const b = await bench({ "big.txt": Buffer.alloc(5 * 1024 * 1024 + 1, 65) });
  expect(await tree.readText(b.root, "firmware/main.c")).toEqual({
    kind: "text",
    path: "firmware/main.c",
    ref: null,
    snippet: "",
    lines: ["int main(void) {", "  return 0;", "}", ""],
    start: 1,
    end: 4,
  });
  await expect(tree.readText(b.root, "firmware/bin.dat")).rejects.toMatchObject({
    code: "INVALID",
    messageKey: "documents.textBinary",
  });
  await expect(tree.readText(b.root, "big.txt")).rejects.toMatchObject({
    code: "INVALID",
    messageKey: "documents.textTooLarge",
  });
  expect((await tree.readText(b.root, "ignored/z.md")).lines).toEqual(["# hidden"]);
  expect((await tree.readText(b.root, ".git/config")).lines).toEqual(["[core]"]);
  await expect(tree.readText(b.root, "../outside.txt")).rejects.toMatchObject({ code: "DENIED" });
  if (b.linked) await expect(tree.readText(b.root, "link/main.c")).rejects.toMatchObject({ code: "DENIED" });
});

it("refuses Windows aliases that would reach hidden or ignored entries", async () => {
  const b = await bench();
  for (const path of [".git.", ".git ", "ignored.", "docs::$INDEX_ALLOCATION", "CON", "docs/nul"])
    await expect(tree.listFolder(b.root, path), path).rejects.toMatchObject({ code: "DENIED" });
  for (const path of [
    ".git./config",
    "ignored./z.md",
    "docs/b.md::$DATA",
    "docs/b.md ",
    "docs/b.md.",
    "docs/CON.txt",
  ]) {
    await expect(tree.readText(b.root, path), path).rejects.toMatchObject({ code: "DENIED" });
    await expect(tree.statEntry(b.root, path), path).rejects.toMatchObject({ code: "DENIED" });
  }
});

it("reports the type, size and modified time of an entry, ignored or not, and refuses the rest", async () => {
  const b = await bench();
  const file = await tree.statEntry(b.root, "firmware/main.c");
  expect(file).toMatchObject({
    path: "firmware/main.c",
    type: "file",
    size: Buffer.byteLength("int main(void) {\n  return 0;\n}\n"),
  });
  expect(new Date(file.modified).toISOString()).toBe(file.modified);
  const folder = await tree.statEntry(b.root, "docs/sub");
  expect(folder).toMatchObject({ path: "docs/sub", type: "folder", size: null });
  expect(new Date(folder.modified).toISOString()).toBe(folder.modified);
  expect(await tree.statEntry(b.root, ".git/config")).toMatchObject({ type: "file", size: 6 });
  expect(await tree.statEntry(b.root, "ignored")).toMatchObject({ type: "folder", size: null });
  expect(await tree.statEntry(b.root, ".vera/.veraignore")).toMatchObject({ type: "file" });
  for (const path of ["", "../x", "/abs"])
    await expect(tree.statEntry(b.root, path), path).rejects.toMatchObject({ code: "DENIED" });
  if (b.linked)
    for (const path of ["link", "link/main.c"])
      await expect(tree.statEntry(b.root, path), path).rejects.toMatchObject({ code: "DENIED" });
  await expect(tree.statEntry(b.root, "docs/missing.md")).rejects.toMatchObject({ code: "NOT_FOUND" });
});

it("locates an entry, ignored or not, by its absolute path and refuses links and outside paths", async () => {
  const b = await bench();
  expect(await tree.locateEntry(b.root, "firmware/main.c")).toEqual({
    absolute: join(b.root, "firmware", "main.c"),
    type: "file",
  });
  expect(await tree.locateEntry(b.root, ".git/config")).toEqual({
    absolute: join(b.root, ".git", "config"),
    type: "file",
  });
  expect(await tree.locateEntry(b.root, "docs")).toEqual({ absolute: join(b.root, "docs"), type: "folder" });
  for (const path of ["", "../x", "/abs", "docs/b.md "])
    await expect(tree.locateEntry(b.root, path), path).rejects.toMatchObject({ code: "DENIED" });
  if (b.linked)
    for (const path of ["link", "link/main.c"])
      await expect(tree.locateEntry(b.root, path), path).rejects.toMatchObject({ code: "DENIED" });
  await expect(tree.locateEntry(b.root, "docs/missing.md")).rejects.toMatchObject({ code: "NOT_FOUND" });
});
