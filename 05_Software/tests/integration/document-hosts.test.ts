import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DocumentProcessor } from "@vera/core";
import { buildSync } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const e5 = "Xenova/multilingual-e5-small";
const cases = [
  ["cli", "source", undefined],
  ["desktop", "source", undefined],
  ["cli", "packaged", undefined],
  ["desktop", "packaged", undefined],
  ["cli", "packaged", e5],
] as const;
type Services = { processDocument: DocumentProcessor; dispose(): Promise<void> };
type CreateServices = (models?: string) => Services;
const fixtures = new Map<string, { createDocumentServices: CreateServices; models: string }>();
let compiledRoot: string | undefined;

beforeAll(async () => {
  const temporary = await mkdtemp(join(tmpdir(), "vera-doc-host-bundles-"));
  compiledRoot = temporary;
  await symlink(
    join(root, "node_modules"),
    join(temporary, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  const vendor = "Xenova";
  for (const host of ["cli", "desktop"] as const) {
    const source = host === "cli" ? "src/apps/cli/src" : "src/apps/desktop/src/main";
    const outdir = join(temporary, host);
    const worker = host === "cli" ? "embedding-worker" : "document-embedding-worker";
    buildSync({
      entryPoints: {
        "document-processor": join(root, source, "document-processor.ts"),
        "pdf-worker": join(root, source, "pdf-worker.ts"),
        [worker]: join(root, source, `${worker}.ts`),
      },
      outdir,
      platform: "node",
      format: "esm",
      outExtension: { ".js": ".mjs" },
      bundle: true,
      packages: "external",
      alias: {
        "@vera/core": join(root, "src/libraries/core/src/index.ts"),
        "@vera/core/pdf-worker": join(root, "src/libraries/core/src/knowledge/pdf-worker.ts"),
        "@vera/core/embedding-worker": join(root, "src/libraries/core/src/knowledge/embedding-worker.ts"),
        "@vera/shared": join(root, "src/libraries/shared/src/index.ts"),
      },
      target: "node24",
    });
    // Compile and import each host once; every case still starts its own real worker services.
    await writeFile(join(outdir, "package.json"), '{"type":"module"}');
    await writeFile(join(outdir, "pdf-worker.js"), await readFile(join(outdir, "pdf-worker.mjs")));
    await writeFile(join(outdir, `${worker}.js`), await readFile(join(outdir, `${worker}.mjs`)));
    const { createDocumentServices } = (await import(
      pathToFileURL(join(outdir, "document-processor.mjs")).href
    )) as { createDocumentServices: CreateServices };
    fixtures.set(`${host}:source`, { createDocumentServices, models: join(root, "src/models") });
    const resources = join(outdir, "resources");
    const models = join(resources, "models");
    await mkdir(models, { recursive: true });
    await symlink(
      join(root, "src/models", vendor),
      join(models, vendor),
      process.platform === "win32" ? "junction" : "dir",
    );
    fixtures.set(`${host}:packaged`, { createDocumentServices, models });
  }
});

afterAll(async () => {
  if (compiledRoot) await rm(compiledRoot, { recursive: true, force: true });
});

it.each(cases)(
  "%s composes a compiled PDF worker with %s model assets (%s) and a persisted extraction cache",
  async (host, layout, model) => {
    const temporary = await mkdtemp(join(tmpdir(), "vera-doc-host-"));
    let services: Services | undefined;
    try {
      const fixture = fixtures.get(`${host}:${layout}`);
      if (!fixture) throw Error(`Document host fixture missing: ${host}:${layout}`);
      // Let the bundled CLI discover the installed model directory beside its own resources.
      services = fixture.createDocumentServices(
        host === "cli" && layout === "packaged" ? undefined : fixture.models,
      );
      if (!services) throw Error("Document services missing");
      const processor = services.processDocument;
      const bench = join(temporary, "bench");
      await mkdir(join(bench, "docs"), { recursive: true });
      await mkdir(join(bench, ".vera"));
      const bytes = await readFile(join(root, "tests/fixtures/documents/pages.pdf")),
        sha256 = createHash("sha256").update(bytes).digest("hex");
      await writeFile(join(bench, "docs/board.pdf"), bytes);
      const result = await processor({
        root: bench,
        path: "docs/board.pdf",
        kind: "pdf",
        sha256,
        ...(model ? { embeddings: { model, chunkSize: 1400, overlap: 200 } } : {}),
        signal: new AbortController().signal,
        assertWritable: () => {},
      });
      expect(result).toMatchObject({ status: "indexed", pages: 2 });
      expect(result.derived?.modelId).toContain(
        model
          ? `${model}@761b726dd34fb83930e26aab4e9ac3899aa1fa78`
          : "ea104dacec62c0de699686887e3f920caeb4f3e3",
      );
      expect(result.derived?.vectors).toHaveLength(result.chunks?.length ?? 0);
      expect(
        result.chunks?.some(
          (c) => c.locator.type === "page" && c.locator.page === 2 && c.text.includes("WDG_KR"),
        ),
      ).toBe(true);
      expect(
        JSON.parse(await readFile(join(bench, `.vera/cache/extract/${sha256}.json`), "utf8")),
      ).toMatchObject({ version: 1, sha256 });
    } finally {
      await services?.dispose();
      await rm(temporary, { recursive: true, force: true });
    }
  },
  30000,
);
