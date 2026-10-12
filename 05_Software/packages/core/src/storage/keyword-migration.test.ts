import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { openDb, type WorkbenchDatabase } from "./db.js";
import { migrations } from "./migrate.js";
import * as initial from "./migrations/0001_initial.js";
import { DocumentsRepository } from "./repos/documents.js";

const roots: string[] = [];
const handles: WorkbenchDatabase[] = [];
const options = { workbenchId: "keyword-test", appVersion: "0.0.0", migrations: migrations.slice(0, 2) };
afterEach(async () => {
  for (const h of handles.splice(0)) h.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function file() {
  const root = await mkdtemp(join(tmpdir(), "vera-keyword-migration-"));
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
it("upgrades schema1 with backfill, exact tokenizers, immutable checksum and committed-view backup", async () => {
  const path = await file();
  const old = await opened(path, { migrations: [initial] });
  const { doc } = seed(old.db);
  const next = await opened(path);
  expect(next.db.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("2");
  expect(matches(next.db)).toEqual([[1], [1]]);
  expect(matches(next.db, "C1_CR")).toEqual([[], [1]]);
  expect(next.db.prepare("SELECT doc_id,locator_json FROM chunks").get()).toEqual({
    doc_id: doc.id,
    locator_json: '{"type":"page","page":2}',
  });
  expect(next.db.prepare("SELECT value FROM meta WHERE key='migration_0001_sha256'").pluck().get()).toBe(
    createHash("sha256").update(initial.sql).digest("hex"),
  );
  const definitions = next.db
    .prepare("SELECT sql FROM sqlite_master WHERE name IN ('chunks_fts','chunks_tri') ORDER BY name")
    .pluck()
    .all();
  expect(definitions[0]).toContain("unicode61 remove_diacritics 2 tokenchars '_'");
  expect(definitions[1]).toContain("trigram");
  integrity(next.db);
  const backup = new Database(join(path, "../backups/vera.db.v1.bak"), { readonly: true });
  try {
    expect(backup.prepare("SELECT text FROM chunks").pluck().get()).toBe("I2C1_CR1 control register");
    expect(backup.prepare("SELECT name FROM sqlite_master WHERE name='chunks_fts'").get()).toBeUndefined();
  } finally {
    backup.close();
  }
  next.close();
  old.close();
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
it("rolls back new FTS/backfill/meta on migration failure and retains the exclusive recovery backup", async () => {
  const path = await file();
  const old = await opened(path, { migrations: [initial] });
  seed(old.db);
  old.close();
  const keyword = migrations[1];
  expect(keyword?.version).toBe(2);
  const bad = [initial, { version: 2, sql: `${keyword?.sql}\nSELECT * FROM missing_keyword_table;` }];
  await expect(openDb(path, { ...options, migrations: bad })).rejects.toThrow();
  const raw = new Database(path);
  try {
    expect(raw.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("1");
    expect(
      raw
        .prepare("SELECT name FROM sqlite_master WHERE name LIKE 'chunks_fts%' OR name LIKE 'chunks_tri%'")
        .all(),
    ).toEqual([]);
    expect(raw.prepare("SELECT text FROM chunks").pluck().get()).toBe("I2C1_CR1 control register");
  } finally {
    raw.close();
  }
  const before = await readFile(join(path, "../backups/vera.db.v1.bak"));
  await expect(openDb(path, options)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await readFile(join(path, "../backups/vera.db.v1.bak"))).toEqual(before);
});
it("preserves a schema1 read-only snapshot and refuses newer/checksum-changed catalogs", async () => {
  const path = await file();
  const old = await opened(path, { migrations: [initial] });
  seed(old.db);
  old.close();
  const before = await readFile(path);
  const read = await opened(path, { readOnly: true });
  expect(read.db.prepare("SELECT name FROM sqlite_master WHERE name='chunks_fts'").get()).toBeUndefined();
  read.close();
  expect(await readFile(path)).toEqual(before);
  const next = await opened(path);
  next.close();
  await expect(openDb(path, { ...options, migrations: [initial] })).rejects.toMatchObject({
    code: "WORKBENCH_TOO_NEW",
  });
  await expect(
    openDb(path, {
      ...options,
      migrations: [initial, { version: 2, sql: `${migrations[1]?.sql}\n-- modified` }],
    }),
  ).rejects.toMatchObject({ code: "INVALID" });
});
