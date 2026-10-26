import Database from "better-sqlite3";
import { expect, it } from "vitest";
import { migrations } from "./migrate.js";
import { DocumentsRepository } from "./repos/documents.js";

it("publishes embeddings and extraction atomically and invalidates on replacement/cascade", () => {
  const db = new Database(":memory:");
  try {
    db.pragma("foreign_keys=ON");
    for (const migration of migrations) db.exec(migration.sql);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='embeddings'").get()).toBeDefined();
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
    const vector = new Float32Array(384);
    vector[0] = 1;
    const derived = {
      modelId: "test",
      vectors: [vector],
      extraction: { kind: "pdf" as const, pages: ["page text"] },
    };
    rows.replaceChunks(doc.id, [{ text: "page text", locator: { type: "page", page: 1 } }], derived);
    expect(db.prepare("SELECT model_id,dim,length(vector) AS bytes FROM embeddings").get()).toEqual({
      model_id: "test",
      dim: 384,
      bytes: 1536,
    });
    expect(() =>
      db.transaction(() => {
        rows.clearDerived(doc.id);
        throw Error("rollback");
      })(),
    ).toThrow("rollback");
    expect(db.prepare("SELECT count(*) FROM embeddings").pluck().get()).toBe(1);
    rows.replaceChunks(doc.id, [{ text: "changed", locator: { type: "page", page: 1 } }]);
    expect(db.prepare("SELECT count(*) FROM embeddings").pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM document_extractions").pluck().get()).toBe(0);
    rows.replaceChunks(doc.id, [{ text: "page text", locator: { type: "page", page: 1 } }], derived);
    db.prepare("DELETE FROM documents WHERE id=?").run(doc.id);
    expect(db.prepare("SELECT count(*) FROM embeddings").pluck().get()).toBe(0);
    expect(db.prepare("SELECT count(*) FROM document_extractions").pluck().get()).toBe(0);
  } finally {
    db.close();
  }
});
