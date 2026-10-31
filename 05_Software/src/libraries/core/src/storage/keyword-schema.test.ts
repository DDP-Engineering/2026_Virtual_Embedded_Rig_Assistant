import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { openDb, type WorkbenchDatabase } from "./db.js";
import { DocumentsRepository } from "./repos/documents.js";

const roots: string[] = [];
const handles: WorkbenchDatabase[] = [];
const options = { workbenchId: "keyword-test", appVersion: "0.0.0" };
afterEach(async () => {
  for (const h of handles.splice(0)) h.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function file() {
  const root = await mkdtemp(join(tmpdir(), "vera-keyword-schema-"));
  roots.push(root);
  await mkdir(join(root, ".vera"));
  return join(root, ".vera/vera.db");
}
async function opened(path: string, extra = {}) {
  const h = await openDb(path, { ...options, ...extra });
  handles.push(h);
  return h;
}
function seed(db: Database.Database) {
  const rows = new DocumentsRepository(db);
  const doc = rows.save({
    path: "docs/register.pdf",
    kind: "pdf",
    sha256: "a".repeat(64),
    bytes: 100,
    mtime: "2026-10-12T00:00:00Z",
    pages: 2,
    status: "indexed",
    error: null,
    indexedAt: null,
  });
  rows.replaceChunks(doc.id, [{ text: "I2C1_CR1 control register", locator: { type: "page", page: 2 } }]);
  return { rows, doc };
}
function matches(db: Database.Database, query = "I2C1_CR1") {
  return ["chunks_fts", "chunks_tri"].map((table) =>
    db.prepare(`SELECT rowid FROM ${table} WHERE ${table} MATCH ? ORDER BY rowid`).pluck().all(`"${query}"`),
  );
}
function integrity(db: Database.Database) {
  for (const table of ["chunks_fts", "chunks_tri"])
    db.prepare(`INSERT INTO ${table}(${table},rank) VALUES('integrity-check',1)`).run();
}
it("creates both persisted keyword indexes with the current tokenizers", async () => {
  const path = await file();
  const h = await opened(path);
  seed(h.db);
  expect(matches(h.db)).toEqual([[1], [1]]);
  expect(matches(h.db, "C1_CR")).toEqual([[], [1]]);
  const definitions = h.db
    .prepare("SELECT sql FROM sqlite_master WHERE name IN ('chunks_fts','chunks_tri') ORDER BY name")
    .pluck()
    .all();
  expect(definitions[0]).toContain("unicode61 remove_diacritics 2 tokenchars '_'");
  expect(definitions[1]).toContain("trigram");
  integrity(h.db);
  h.close();
  expect(matches((await opened(path)).db)).toEqual([[1], [1]]);
});
it("keeps indexes atomic through replacement, repeated cleanup, SQL update, cascade and rollback", async () => {
  const { db } = await opened(await file());
  const { rows, doc } = seed(db);
  expect(matches(db)).toEqual([[1], [1]]);
  expect(() =>
    db.transaction(() => {
      rows.replaceChunks(doc.id, [{ text: "NEW2_VALUE", locator: { type: "lines", start: 3, end: 4 } }]);
      expect(matches(db)).toEqual([[], []]);
      throw Error("rollback");
    })(),
  ).toThrow("rollback");
  expect(matches(db)).toEqual([[1], [1]]);
  rows.replaceChunks(doc.id, [{ text: "NEW2_VALUE", locator: { type: "lines", start: 3, end: 4 } }]);
  expect(matches(db)).toEqual([[], []]);
  expect(matches(db, "NEW2_VALUE")).toEqual([[1], [1]]);
  db.prepare("UPDATE chunks SET text='OTHER3_VALUE' WHERE id=1").run();
  expect(matches(db, "NEW2_VALUE")).toEqual([[], []]);
  expect(matches(db, "OTHER3_VALUE")).toEqual([[1], [1]]);
  integrity(db);
  rows.clearDerived(doc.id);
  rows.clearDerived(doc.id);
  expect(matches(db, "OTHER3_VALUE")).toEqual([[], []]);
  seed(db);
  db.prepare("DELETE FROM documents WHERE id=?").run(doc.id);
  expect(matches(db)).toEqual([[], []]);
  integrity(db);
  seed(db);
  rows.remove(doc.path);
  rows.remove(doc.path);
  expect(matches(db)).toEqual([[], []]);
  integrity(db);
});
