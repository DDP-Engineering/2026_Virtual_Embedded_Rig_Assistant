import { existsSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

it("renders the three fictional Markdown demo documents reproducibly", async () => {
  const script = fileURLToPath(new URL("../../scripts/make-demo-pdfs.mjs", import.meta.url));
  expect(existsSync(script), "demo PDF generator is implemented").toBe(true);
  const { makeDemoPdfs } = await import(pathToFileURL(script).href);
  const root = await mkdtemp(join(tmpdir(), "vera-demo-docs-"));
  try {
    const paths = await makeDemoPdfs(root);
    expect(paths.map((p: string) => p.split(/[\\/]/).at(-1))).toEqual([
      "vera-demo-01-datasheet.pdf",
      "vera-demo-01-reference-manual.pdf",
      "vera-demo-01-application-note.pdf",
    ]);
    const originals = await Promise.all(paths.map((p: string) => readFile(p)));
    await makeDemoPdfs(root);
    expect(await Promise.all(paths.map((p: string) => readFile(p)))).toEqual(originals);
    expect(originals.every((bytes: Buffer) => bytes.subarray(0, 5).toString() === "%PDF-")).toBe(true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps a complete fictional workbench inventory in verification fixtures", async () => {
  const fixture = fileURLToPath(new URL("../fixtures/workbenches/demo-board/", import.meta.url));
  const inventory = JSON.parse(
    await readFile(new URL("../fixtures/workbenches/demo-board.json", import.meta.url), "utf8"),
  );
  expect(inventory.name).toBe("VERA-DEMO-01");
  expect(new Set(inventory.files).size).toBe(inventory.files.length);
  const files: string[] = [];
  for (const path of await readdir(fixture, { recursive: true }))
    if ((await stat(join(fixture, path))).isFile()) files.push(path.replaceAll("\\", "/"));
  expect([...inventory.files].sort()).toEqual(files.sort());
  for (const path of inventory.files) {
    expect(path).not.toMatch(/(^|\/)(?:vera\.db(?:-wal|-shm)?|lock|backups)(\/|$)/);
    expect((await readFile(join(fixture, path))).byteLength).toBeGreaterThan(0);
  }
});
