import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
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
