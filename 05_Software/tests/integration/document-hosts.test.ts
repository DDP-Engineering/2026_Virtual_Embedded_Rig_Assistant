import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DocumentProcessor, EmbeddingHost } from "@vera/core";
import { buildSync } from "esbuild";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
it.each([
  ["cli", "source"],
  ["desktop", "source"],
  ["cli", "packaged"],
  ["desktop", "packaged"],
])(
  "%s composes a compiled PDF worker with %s models and persisted extraction cache",
  async (host, layout) => {
    const temporary = await mkdtemp(join(tmpdir(), "vera-doc-host-"));
    let services: { processDocument: DocumentProcessor; embeddings: EmbeddingHost } | undefined;
    try {
      await symlink(
        join(root, "node_modules"),
        join(temporary, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const source = host === "cli" ? "src/apps/cli/src" : "src/apps/desktop/src/main";
      buildSync({
        entryPoints: {
          "document-processor": join(root, source, "document-processor.ts"),
          "pdf-worker": join(root, source, "pdf-worker.ts"),
          [host === "cli" ? "embedding-worker" : "document-embedding-worker"]: join(
            root,
            source,
            host === "cli" ? "embedding-worker.ts" : "document-embedding-worker.ts",
          ),
        },
        outdir: temporary,
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
      // Production host uses .js beside index.js; the temporary package has ESM type.
      await writeFile(join(temporary, "package.json"), '{"type":"module"}');
      await writeFile(join(temporary, "pdf-worker.js"), await readFile(join(temporary, "pdf-worker.mjs")));
      const worker = host === "cli" ? "embedding-worker" : "document-embedding-worker";
      await writeFile(join(temporary, `${worker}.js`), await readFile(join(temporary, `${worker}.mjs`)));
      let models = join(root, "src/models");
      let manifestPath: string | undefined;
      if (layout === "packaged") {
        models = join(temporary, "resources/models");
        await mkdir(models, { recursive: true });
        const manifest = JSON.parse(await readFile(join(root, "src/models/model-manifest.json"), "utf8"));
        const vendor = manifest.modelId.split("/")[0];
        await symlink(
          join(root, "src/models", vendor),
          join(models, vendor),
          process.platform === "win32" ? "junction" : "dir",
        );
        manifestPath = join(temporary, "resources/model-manifest.json");
        await writeFile(manifestPath, await readFile(join(root, "src/models/model-manifest.json")));
      }
      const { createDocumentServices } = await import(
        pathToFileURL(join(temporary, "document-processor.mjs")).href
      );
      // CLI also discovers the installed manifest beside the models directory.
      services = createDocumentServices(models, host === "cli" ? undefined : manifestPath);
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
        signal: new AbortController().signal,
        assertWritable: () => {},
      });
      expect(result).toMatchObject({ status: "indexed", pages: 2 });
      expect(result.derived?.modelId).toContain("ea104dacec62c0de699686887e3f920caeb4f3e3");
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
      await services?.embeddings.dispose();
      await rm(temporary, { recursive: true, force: true });
    }
  },
);
