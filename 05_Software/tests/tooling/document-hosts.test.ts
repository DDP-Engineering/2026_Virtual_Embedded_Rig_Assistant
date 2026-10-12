import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import type { DocumentProcessor, EmbeddingHost } from "@vera/core";
import { buildSync } from "esbuild";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
it.each(["cli", "desktop"])(
  "%s composes a compiled PDF worker and persisted extraction cache",
  async (host) => {
    const temporary = await mkdtemp(join(tmpdir(), "vera-doc-host-"));
    let services: { processDocument: DocumentProcessor; embeddings: EmbeddingHost } | undefined;
    try {
      await symlink(
        join(root, "node_modules"),
        join(temporary, "node_modules"),
        process.platform === "win32" ? "junction" : "dir",
      );
      const source = host === "cli" ? "apps/cli/src" : "apps/desktop/src/main";
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
          "@vera/core": join(root, "packages/core/src/index.ts"),
          "@vera/core/pdf-worker": join(root, "packages/core/src/knowledge/pdf-worker.ts"),
          "@vera/core/embedding-worker": join(root, "packages/core/src/knowledge/embedding-worker.ts"),
          "@vera/shared": join(root, "packages/shared/src/index.ts"),
        },
        target: "node24",
      });
      // Production host uses .js beside index.js; the temporary package has ESM type.
      await writeFile(join(temporary, "package.json"), '{"type":"module"}');
      await writeFile(join(temporary, "pdf-worker.js"), await readFile(join(temporary, "pdf-worker.mjs")));
      const worker = host === "cli" ? "embedding-worker" : "document-embedding-worker";
      await writeFile(join(temporary, `${worker}.js`), await readFile(join(temporary, `${worker}.mjs`)));
      services = (
        await import(pathToFileURL(join(temporary, "document-processor.mjs")).href)
      ).createDocumentServices(join(root, "resources"));
      if (!services) throw Error("Document services missing");
      const processor = services.processDocument;
      const bench = join(temporary, "bench");
      await mkdir(join(bench, "docs"), { recursive: true });
      await mkdir(join(bench, ".vera"));
      const bytes = await readFile(join(root, "fixtures/documents/pages.pdf")),
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
