// SQLite access (01: better-sqlite3, raw SQL behind a small repo layer, no ORM).
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

export type Db = Database.Database;

const SCHEMA = readFileSync(path.join(import.meta.dirname, "schema.sql"), "utf8");

/** Opens (and creates) the DB. `:memory:` for tests and scratch evaluation. */
export function openDb(file: string): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.exec(SCHEMA);
  return db;
}

/** Drops every table and FTS index of schema.sql and recreates them (seed, /admin/reset). */
export function resetDb(db: Db): void {
  const names = (where: string) =>
    (db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ${where}`).all() as {
      name: string;
    }[]).map((r) => r.name);
  db.transaction(() => {
    // FTS tables first: dropping one also drops its shadow tables.
    for (const t of names("AND sql LIKE 'CREATE VIRTUAL TABLE%'")) db.exec(`DROP TABLE "${t}"`);
    for (const t of names("")) db.exec(`DROP TABLE "${t}"`);
  })();
  db.exec(SCHEMA);
}

export const dbFile = (runtimeDir: string) => path.join(runtimeDir, "benchpilot.db");
