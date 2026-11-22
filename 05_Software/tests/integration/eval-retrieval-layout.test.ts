import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterAll, expect, inject, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const load = (path: string) => import(pathToFileURL(join(root, path)).href);
const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true, maxRetries: 5 });
});

it("indexes and searches the hard-layout corpus through the CLI and reports OCR detection", async () => {
  const { runLayout } = await load("evaluators/retrieval/layout.mjs");
  const out = await mkdtemp(join(tmpdir(), "vera-eval-layout-"));
  dirs.push(out);
  const output = join(out, "run", "run.json");
  const exit = await runLayout({
    output,
    cli: join(inject("cliBundle"), "index.js"),
    scratch: join(out, "scratch"),
  });
  const result = JSON.parse(await readFile(output, "utf8"));
  expect(result.documents.find((d: { path: string }) => d.path === "docs/scanned.pdf")?.status).toBe(
    "needs_ocr",
  );
  expect(result.metrics.ocrCorrect).toBe(1);
  expect(result.questions).toHaveLength(12);
  expect(exit).toBe(result.pass ? 0 : 1);
  expect(await readFile(join(out, "run", "report.html"), "utf8")).toContain("hard-layout corpus");
}, 240_000);
