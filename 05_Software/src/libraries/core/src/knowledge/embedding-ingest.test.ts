import { copyFile, mkdir, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workbenchSchema } from "@vera/shared";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { rebuildingEmbeddings } from "../storage/repos/embedding-rebuild.js";
import { schemaSql } from "../storage/schema.js";
import { createModelDocumentServices } from "./document-services.js";
import type { EmbeddingPort } from "./embedding.js";
import { type DocumentProcessor, Ingester } from "./ingest.js";
import { inspectSource } from "./inspect.js";
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

it("keeps extraction and keyword results during a model switch, including a failed rebuild", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-switch-"));
  const db = new Database(":memory:");
  let ingest: Ingester | undefined;
  const progress: { pending: number; failed: number }[] = [];
  const previous = "Xenova/bge-small-en-v1.5";
  const next = "Xenova/multilingual-e5-small";
  let config = workbenchSchema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Board" });
  let mode: "wait" | "fail" | "crash" | "ready" = "wait";
  let inspectionFails = false;
  let crashes = 0;
  const initialConfig = config;
  let entered = false;
  let release = () => {};
  const paused = new Promise<void>((resolve) => {
    release = resolve;
  });
  const processorFor = (model: string) =>
    createDocumentProcessor(
      async () => {
        throw Error("This fixture contains only text.");
      },
      {
        modelId: model,
        embed: async (_root, texts) => {
          if (model === next) {
            entered = true;
            await paused;
            if (mode === "fail") throw Error("Embedding failed.");
            if (mode === "crash") {
              crashes++;
              throw Object.assign(Error("Indexer crashed."), { retry: true, crashed: true });
            }
          }
          return texts.map(() => Float32Array.from({ length: 384 }, (_value, index) => Number(index === 0)));
        },
        rank: async () => {
          throw Error("Keyword fallback must not invoke ranking.");
        },
        release: async () => {},
      },
    );
  const bgeProcessor = processorFor(previous);
  const e5Processor = processorFor(next);
  const process: DocumentProcessor = async (input) =>
    input.path === "docs/broken.txt"
      ? { status: "failed" }
      : (input.embeddings?.model === next ? e5Processor : bgeProcessor)(input);
  process.modelId = (model) => model;
  process.inspect = async (input) => {
    if (inspectionFails) throw Object.assign(Error("Inspection denied."), { code: "EACCES" });
    return inspectSource(input);
  };
  const start = () =>
    new Ingester({
      root,
      db,
      config: () => config,
      process,
      assertWritable: () => {},
      now: () => new Date(),
      emit: (event) => {
        if (event.type === "index.progress") progress.push(event);
      },
    });
  try {
    db.pragma("foreign_keys=ON");
    db.exec(schemaSql);
    await mkdir(join(root, "docs"));
    await mkdir(join(root, ".vera"));
    await writeFile(join(root, "docs/a.txt"), "The coolant gauge trips the relay. ".repeat(45));
    ingest = start();
    await ingest.waitIdle();
    const extracts = db.prepare("SELECT * FROM document_extractions");
    const chunks = db.prepare("SELECT * FROM chunks");
    const vectorIds = db.prepare("SELECT DISTINCT model_id FROM embeddings").pluck();
    const originalText = extracts.all();
    const originalChunks = chunks.all();
    expect(originalText).toHaveLength(1);
    expect(vectorIds.all()).toEqual([previous]);
    const search = new DocumentKnowledge(root, db, () => ({
      modelId: next,
      embed: async () => [],
      release: async () => {},
      rank: async () => {
        throw Error("Keyword fallback must not invoke ranking.");
      },
    }));

    await ingest.close();
    const nextSettings = { ...config.embeddings, model: next, chunkSize: 400, overlap: 50 } as const;
    config = { ...config, docs: { ...config.docs, maxFiles: 1 }, embeddings: nextSettings };
    const broken = join(root, "docs/broken.txt");
    await writeFile(broken, "Unrelated source processing failure.");
    ingest = start();
    expect(ingest.indexStatus()).toMatchObject({ state: "rebuilding", progress: null });
    await ingest.waitIdle();
    expect(ingest.guard()).toMatchObject({ files: 2, limit: 1 });
    expect(ingest.indexStatus()).toMatchObject({ state: "count-guard", progress: null, searchable: 1 });
    expect(ingest.phase()).toBe("blocked");
    expect(vectorIds.all()).toEqual([]);
    expect(
      (await search.search({ query: "coolant", mode: "semantic" }, new AbortController().signal)).usage,
    ).toEqual({ mode: "keyword", fallbackReason: "embedding-rebuild" });

    await rm(broken);
    config = { ...config, docs: initialConfig.docs };
    inspectionFails = true;
    ingest.request();
    await ingest.waitIdle();
    expect(progress.at(-1)).toMatchObject({ pending: 0, failed: 1 });
    expect(chunks.all()).toEqual(originalChunks);
    expect(extracts.all()).toEqual(originalText);
    inspectionFails = false;

    ingest.request();
    const switching = ingest.waitIdle();
    await expect.poll(() => entered).toBe(true);
    expect(vectorIds.all()).toEqual([]);
    expect(chunks.all()).toEqual(originalChunks);
    expect(extracts.all()).toEqual(originalText);
    for (const mode of ["keyword", "hybrid", "semantic"] as const) {
      const found = await search.search({ query: "coolant", mode }, new AbortController().signal);
      expect(found.results[0]?.path).toBe("docs/a.txt");
      expect(found.usage).toEqual(
        mode === "keyword" ? { mode: "keyword" } : { mode: "keyword", fallbackReason: "embedding-rebuild" },
      );
    }
    mode = "fail";
    release();
    await switching;
    expect(progress.some((event) => event.pending === 0 && event.failed === 1)).toBe(true);
    expect(chunks.all()).toEqual(originalChunks);
    expect(extracts.all()).toEqual(originalText);
    expect(vectorIds.all()).toEqual([]);

    const found = await search.search({ query: "coolant", mode: "keyword" }, new AbortController().signal);
    expect(found.results[0]?.path).toBe("docs/a.txt");

    mode = "ready";
    ingest.request();
    await ingest.waitIdle();
    expect(vectorIds.all()).toEqual([next]);
    // A queued watcher pass can keep the rebuild marker after vectors are published.
    await expect.poll(() => rebuildingEmbeddings(db), { timeout: 5000 }).toBe(false);
    await expect(
      search.search({ query: "coolant", mode: "semantic" }, new AbortController().signal),
    ).rejects.toThrow("Keyword fallback must not invoke ranking.");

    mode = "crash";
    ingest.embeddingModelChanged();
    await ingest.waitIdle();
    await expect.poll(() => crashes, { timeout: 5000 }).toBe(2);
    await ingest.waitIdle();
    config = initialConfig;
    ingest.embeddingModelChanged();
    await ingest.waitIdle();
    expect(vectorIds.all()).toEqual([previous]);
    expect(extracts.all()).toEqual(originalText);

    await ingest.close();
    config = { ...initialConfig, embeddings: nextSettings };
    await writeFile(broken, "Unrelated source processing failure.");
    mode = "ready";
    ingest = start();
    await ingest.waitIdle();
    expect(extracts.all()).toEqual(originalText);
    expect(chunks.all().length).toBeGreaterThan(originalChunks.length);
    expect(vectorIds.all()).toEqual([next]);
    expect(ingest.phase()).toBe("settled-with-exceptions");
    expect(db.prepare("SELECT status FROM documents WHERE path='docs/broken.txt'").pluck().get()).toBe(
      "failed",
    );
    await expect(
      search.search({ query: "coolant", mode: "semantic" }, new AbortController().signal),
    ).rejects.toThrow("Keyword fallback must not invoke ranking.");
  } finally {
    release();
    await ingest?.close();
    db.close();
    await rm(root, { recursive: true, force: true });
  }
}, 15000);
