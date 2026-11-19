import { copyFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workbenchSchema } from "@vera/shared";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { schemaSql } from "../storage/schema.js";
import { createModelDocumentServices } from "./document-services.js";
import type { EmbeddingPort } from "./embedding.js";
import { type DocumentProcessor, Ingester } from "./ingest.js";
import { createDocumentProcessor } from "./processor.js";
import { DocumentKnowledge } from "./search.js";

it("re-embeds unchanged source on descriptor change and atomically invalidates change/delete/reindex", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-embedding-ingest-")),
    db = new Database(":memory:");
  let ingest: Ingester | undefined,
    calls = 0;
  try {
    db.pragma("foreign_keys=ON");
    db.exec(schemaSql);
    await mkdir(join(root, "docs"));
    await mkdir(join(root, ".vera"));
    await writeFile(join(root, "docs/a.txt"), "I2C control register.");
    const config = workbenchSchema.parse({
      format: 1,
      id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      name: "Board",
      docs: { include: ["docs/**"], exclude: [] },
    });
    const port = (modelId: string): EmbeddingPort => ({
      modelId,
      embed: async (_r, texts) => {
        calls++;
        return texts.map(() => {
          const v = new Float32Array(384);
          v[0] = 1;
          return v;
        });
      },
      rank: async () => [],
      release: async () => {},
    });
    const start = (modelId: string) =>
      new Ingester({
        root,
        db,
        config: () => config,
        assertWritable: () => {},
        now: () => new Date(),
        emit: () => {},
        process: createDocumentProcessor(async () => {
          throw Error("unused PDF");
        }, port(modelId)),
      });
    ingest = start("old");
    await ingest.waitIdle();
    expect(calls).toBe(1);
    ingest.request();
    await ingest.waitIdle();
    expect(calls).toBe(1);
    await ingest.close();
    ingest = start("new");
    await ingest.waitIdle();
    expect(calls).toBe(2);
    expect(db.prepare("SELECT model_id FROM embeddings").pluck().get()).toBe("new");
    await writeFile(join(root, "docs/a.txt"), "Changed watchdog register.");
    ingest.request();
    await ingest.waitIdle();
    expect(calls).toBe(3);
    await ingest.reindex();
    expect(calls).toBe(4);
    await rm(join(root, "docs/a.txt"));
    ingest.request();
    await ingest.waitIdle();
    expect(db.prepare("SELECT count(*) FROM embeddings").pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM document_extractions").pluck().get()).toBe(0);
  } finally {
    await ingest?.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
it("aborts embedding before publication and keeps no indexed/vector/extraction candidate", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-embedding-abort-")),
    db = new Database(":memory:");
  let ingest: Ingester | undefined;
  try {
    db.pragma("foreign_keys=ON");
    db.exec(schemaSql);
    await mkdir(join(root, "docs"));
    await mkdir(join(root, ".vera"));
    await writeFile(join(root, "docs/a.txt"), "Content pending embedding.");
    let started = false;
    const config = workbenchSchema.parse({
      format: 1,
      id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      name: "Board",
      docs: { include: ["docs/**"], exclude: [] },
    });
    const port: EmbeddingPort = {
      modelId: "test",
      embed: async (_r, _texts, signal) => {
        started = true;
        return new Promise((_res, reject) =>
          signal.addEventListener("abort", () => reject(Error("aborted")), { once: true }),
        );
      },
      rank: async () => [],
      release: async () => {},
    };
    ingest = new Ingester({
      root,
      db,
      config: () => config,
      assertWritable: () => {},
      now: () => new Date(),
      emit: () => {},
      process: createDocumentProcessor(async () => {
        throw Error("unused");
      }, port),
    });
    const pending = ingest.waitIdle();
    await expect.poll(() => started).toBe(true);
    await ingest.close();
    await pending;
    expect(db.prepare("SELECT count(*) FROM embeddings").pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM chunks").pluck().get()).toBe(0);
    expect(db.prepare("SELECT status FROM documents").pluck().get()).toBe("pending");
  } finally {
    await ingest?.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each(["manifest", "tokenizer"])("reports a missing model %s as a processing failure", async (asset) => {
  const root = await mkdtemp(join(tmpdir(), "vera-embedding-assets-"));
  const db = new Database(":memory:");
  let ingest: Ingester | undefined;
  try {
    db.pragma("foreign_keys=ON");
    db.exec(schemaSql);
    await mkdir(join(root, "docs"));
    await mkdir(join(root, ".vera"));
    const source = join(root, "docs/a.txt");
    await writeFile(source, "Existing workbench document.");
    const models = join(root, "models");
    const model = "Xenova/multilingual-e5-small";
    if (asset === "tokenizer") {
      await mkdir(join(models, model), { recursive: true });
      await copyFile(
        new URL(
          "../../../../../src/models/Xenova/multilingual-e5-small/model-manifest.json",
          import.meta.url,
        ),
        join(models, model, "model-manifest.json"),
      );
    }
    const services = createModelDocumentServices(
      models,
      new URL("./embedding-worker.js", import.meta.url),
      new URL("./pdf-worker.js", import.meta.url),
    );
    const config = workbenchSchema.parse({
      format: 1,
      id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      name: "Board",
      embeddings: { model },
    });
    const status = db.prepare("SELECT status,error FROM documents WHERE path='docs/a.txt'");
    ingest = new Ingester({
      root,
      db,
      config: () => config,
      assertWritable: () => {},
      now: () => new Date(),
      emit: () => {},
      process: services.processDocument,
    });
    await ingest.reindex();
    expect(status.get()).toEqual({ status: "failed", error: "PROCESSING" });
    await ingest.waitIdle();
  } finally {
    await ingest?.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});

it("preserves unchanged indexed keyword results when the model manifest is unavailable", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-embedding-manifest-reopen-"));
  const db = new Database(":memory:");
  let ingest: Ingester | undefined;
  try {
    db.pragma("foreign_keys=ON");
    db.exec(schemaSql);
    await mkdir(join(root, ".vera"));
    await mkdir(join(root, "docs"));
    const indexedAt = new Date("2026-01-01T00:00:00Z");
    const aged = new Date("2025-12-31T23:59:55Z");
    for (const [name, mtime] of [
      ["aged", aged],
      ["recent", indexedAt],
    ] as const) {
      const source = join(root, "docs", `${name}.txt`);
      await writeFile(source, "The coolant gauge trips the relay.");
      await utimes(source, mtime, mtime);
    }
    const config = workbenchSchema.parse({
      format: 1,
      id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      name: "Board",
      embeddings: { model: "Xenova/multilingual-e5-small" },
    });
    const start = (process: DocumentProcessor) =>
      new Ingester({
        root,
        db,
        config: () => config,
        assertWritable: () => {},
        now: () => indexedAt,
        emit: () => {},
        process,
      });
    ingest = start(
      createDocumentProcessor(async () => {
        throw Error("This fixture contains only text.");
      }),
    );
    await ingest.reindex();
    const rows = db.prepare("SELECT path,status,sha256 FROM documents ORDER BY path");
    const original = rows.all();
    expect(original).toMatchObject([{ status: "indexed" }, { status: "indexed" }]);
    await ingest.close();

    const unavailable = createModelDocumentServices(
      join(root, "missing-models"),
      new URL("./embedding-worker.js", import.meta.url),
      new URL("./pdf-worker.js", import.meta.url),
    );
    ingest = start(unavailable.processDocument);
    await ingest.waitIdle();
    expect(rows.all()).toEqual(original);
    const { results } = await new DocumentKnowledge(root, db).search(
      { query: "coolant", mode: "keyword" },
      new AbortController().signal,
    );
    expect(results.map(({ path }) => path)).toEqual(["docs/aged.txt", "docs/recent.txt"]);
  } finally {
    await ingest?.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
});
