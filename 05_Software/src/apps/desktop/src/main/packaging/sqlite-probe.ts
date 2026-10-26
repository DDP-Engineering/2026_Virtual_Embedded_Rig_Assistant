import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";

interface Database {
  exec(sql: string): unknown;
  prepare(sql: string): { get(...parameters: string[]): unknown };
  close(): unknown;
}
type OpenDatabase = (path: string) => Database;

export async function exerciseDatabase(open: OpenDatabase) {
  const directory = await mkdtemp(join(tmpdir(), "vera-packaging-sqlite-"));
  const path = join(directory, "probe.db");
  let database: Database | undefined;
  try {
    database = open(path);
    const wal = database.prepare("PRAGMA journal_mode=WAL").get();
    database.exec(`
      CREATE TABLE registers (id INTEGER PRIMARY KEY, text TEXT NOT NULL);
      CREATE VIRTUAL TABLE words USING fts5(text, tokenize="unicode61 remove_diacritics 2 tokenchars '_'");
      CREATE VIRTUAL TABLE fragments USING fts5(text, tokenize='trigram');
      INSERT INTO registers(text) VALUES ('I2C1_CR1 enables the peripheral clock');
      INSERT INTO words(text) SELECT text FROM registers;
      INSERT INTO fragments(text) SELECT text FROM registers;
    `);
    const unicode61 = database.prepare("SELECT text FROM words WHERE words MATCH ?").get('"I2C1_CR1"');
    const trigram = database.prepare("SELECT text FROM fragments WHERE fragments MATCH ?").get('"C1_C"');
    const walFile = existsSync(`${path}-wal`);
    const version = database.prepare("SELECT sqlite_version() AS version").get();
    database.close();
    database = open(path);
    const persisted = database.prepare("SELECT COUNT(*) AS count FROM registers").get();
    const result = { wal, walFile, unicode61, trigram, version, persisted };
    const values = result as typeof result & {
      wal: { journal_mode: string };
      unicode61: { text: string };
      trigram: { text: string };
      persisted: { count: number };
    };
    if (
      values.wal.journal_mode !== "wal" ||
      !walFile ||
      !values.unicode61?.text.includes("I2C1_CR1") ||
      !values.trigram?.text.includes("I2C1_CR1") ||
      values.persisted.count !== 1
    ) {
      throw new Error("SQLite WAL/FTS5/persistence assertion failed");
    }
    return { status: "passed", ...result };
  } finally {
    try {
      database?.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export async function probeSqlite() {
  const started = performance.now();
  let primary: Record<string, unknown>;
  try {
    const { default: BetterSqlite3 } = await import("better-sqlite3");
    // The N-API addon is loaded lazily by the first constructor.
    new BetterSqlite3(":memory:").close();
    const loadMs = performance.now() - started;
    primary = { loadMs, ...(await exerciseDatabase((path) => new BetterSqlite3(path))) };
  } catch (error) {
    primary = { status: "failed", loadMs: performance.now() - started, error: String(error) };
  }
  let fallback: Record<string, unknown>;
  const fallbackStarted = performance.now();
  try {
    const { DatabaseSync } = await import("node:sqlite");
    new DatabaseSync(":memory:").close();
    fallback = {
      loadMs: performance.now() - fallbackStarted,
      ...(await exerciseDatabase((path) => new DatabaseSync(path))),
    };
  } catch (error) {
    fallback = { status: "unavailable", loadMs: performance.now() - fallbackStarted, error: String(error) };
  }
  return { primary, fallback };
}
