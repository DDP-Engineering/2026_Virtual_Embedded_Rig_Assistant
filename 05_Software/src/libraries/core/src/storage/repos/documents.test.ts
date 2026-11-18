import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { schemaSql } from "../schema.js";
import { DocumentsRepository } from "./documents.js";

it("validates chunks apart from the transaction that stores them", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    db.exec(schemaSql);
    const rows = new DocumentsRepository(db);
    const doc = rows.save({
      path: "docs/a.pdf",
      kind: "pdf",
      sha256: "a".repeat(64),
      bytes: 10,
      mtime: "2026-10-12T00:00:00Z",
      pages: 1,
      status: "indexed",
      error: null,
      indexedAt: null,
    });
    const locator = { type: "page" as const, page: 1 };
    const vector = new Float32Array(384);
    vector[0] = 1;
    const derived = {
      modelId: "test",
      vectors: [vector],
      extraction: { kind: "pdf" as const, pages: ["page text"] },
    };
    const count = (table: string) => db.prepare(`SELECT count(*) FROM ${table}`).pluck().get();
    const valid = rows.validateChunks([{ text: "page text", locator }], derived);
    expect(count("chunks")).toBe(0);
    db.transaction(() => rows.writeChunks(doc.id, valid))();
    expect([count("chunks"), count("embeddings"), count("document_extractions")]).toEqual([1, 1, 1]);
    // A rejected chunk or vector set fails before anything is written.
    expect(() => rows.validateChunks([{ text: "x".repeat(1401), locator }])).toThrow();
    expect(() => rows.validateChunks([{ text: "page text", locator }], { ...derived, vectors: [] })).toThrow(
      "Invalid normalized embeddings.",
    );
    expect(() => rows.replaceChunks(doc.id, [{ text: "x".repeat(1401), locator }])).toThrow();
    expect([count("chunks"), count("embeddings"), count("document_extractions")]).toEqual([1, 1, 1]);
  } finally {
    db.close();
  }
});
