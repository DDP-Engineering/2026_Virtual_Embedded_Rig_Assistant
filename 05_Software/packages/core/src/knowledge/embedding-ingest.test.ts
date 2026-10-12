import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { workbenchSchema } from "@vera/shared";
import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrations } from "../storage/migrate.js";
import type { EmbeddingPort } from "./embedding.js";
import { Ingester } from "./ingest.js";
import { createDocumentProcessor } from "./processor.js";

it("re-embeds unchanged source on descriptor change and atomically invalidates change/delete/reindex", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-embedding-ingest-")),
    db = new Database(":memory:");
  let ingest: Ingester | undefined,
    calls = 0;
  try {
    db.pragma("foreign_keys=ON");
    for (const m of migrations) db.exec(m.sql);
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
    for (const m of migrations) db.exec(m.sql);
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
