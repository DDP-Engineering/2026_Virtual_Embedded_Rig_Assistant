import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { inspectDatabase, openDb, type WorkbenchDatabase } from "./db.js";

const roots: string[] = [];
const handles: WorkbenchDatabase[] = [];
const options = { workbenchId: "wb_test", appVersion: "0.0.0" };
afterEach(async () => {
  for (const handle of handles.splice(0)) handle.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function path() {
  const root = await mkdtemp(join(tmpdir(), "vera-db-ă-"));
  roots.push(root);
  await mkdir(join(root, ".vera"));
  return join(root, ".vera", "vera.db");
}
async function opened(file: string, extra = {}) {
  const handle = await openDb(file, { ...options, ...extra });
  handles.push(handle);
  return handle;
}
async function bytes(file: string) {
  const result: Record<string, string> = {};
  for (const entry of await readdir(dirname(file), { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    result[entry.name] = createHash("sha256")
      .update(await readFile(join(dirname(file), entry.name)))
      .digest("hex");
  }
  return result;
}
it("creates the complete current schema directly, with SQLite pragmas and no automatic backups", async () => {
  const file = await path();
  const { db } = await opened(file);
  expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  expect(db.pragma("synchronous", { simple: true })).toBe(1);
  expect(db.prepare("SELECT * FROM meta ORDER BY key").all()).toEqual([
    { key: "created_by", value: "0.0.0" },
    { key: "embedding_epoch", value: "0" },
    { key: "schema_version", value: "3" },
    { key: "workbench_id", value: "wb_test" },
  ]);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all()).toEqual(
    expect.arrayContaining([
      "meta",
      "sessions",
      "messages",
      "events",
      "tool_calls",
      "approvals",
      "changes",
      "artifacts",
      "todos",
      "documents",
      "chunks",
      "chunks_fts",
      "chunks_tri",
      "embeddings",
      "document_extractions",
    ]),
  );
  for (const table of ["messages", "events", "tool_calls", "approvals", "changes", "artifacts", "todos"]) {
    expect(db.pragma(`foreign_key_list(${table})`)).toEqual(
      expect.arrayContaining([expect.objectContaining({ table: "sessions", on_delete: "CASCADE" })]),
    );
    const indices = db.pragma(`index_list(${table})`) as { name: string }[];
    expect(
      indices.some(
        (i) => (db.pragma(`index_info(${i.name})`) as { name: string }[])[0]?.name === "session_id",
      ),
    ).toBe(true);
  }
  expect(db.pragma("index_info(idx_chunks_doc)")).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "doc_id" })]),
  );
  expect(db.pragma("integrity_check", { simple: true })).toBe("ok");
  expect(db.pragma("foreign_key_check")).toEqual([]);
  expect(existsSync(join(dirname(file), "backups"))).toBe(false);
});
it("reopens current data and metadata unchanged, including committed WAL rows, without generating backups", async () => {
  const file = await path();
  const h = await opened(file);
  h.db.exec(
    "CREATE TABLE keep(text TEXT); INSERT INTO keep VALUES ('Banc ă'); INSERT INTO meta VALUES('opaque','preserve')",
  );
  const metadata = h.db.prepare("SELECT * FROM meta ORDER BY key").all();
  const schema = h.db.prepare("SELECT * FROM sqlite_master ORDER BY name").all();
  const before = await bytes(file);
  const next = await opened(file, { appVersion: "1.2.3" });
  expect(next.db.prepare("SELECT text FROM keep").pluck().get()).toBe("Banc ă");
  expect(next.db.prepare("SELECT * FROM meta ORDER BY key").all()).toEqual(metadata);
  expect(next.db.prepare("SELECT * FROM sqlite_master ORDER BY name").all()).toEqual(schema);
  next.close();
  expect(await bytes(file)).toEqual(before);
  h.close();
  const disk = await bytes(file);
  (await opened(file)).close();
  expect(await bytes(file)).toEqual(disk);
  expect(existsSync(join(dirname(file), "backups"))).toBe(false);
});
it.each(["0", "1", "2", "99", "not-a-version"])(
  "refuses a non-current schema (%s) without changing DB/WAL/SHM",
  async (version) => {
    const file = await path();
    const { db } = await opened(file);
    db.prepare("UPDATE meta SET value=? WHERE key='schema_version'").run(version);
    const before = await bytes(file);
    await expect(inspectDatabase(file, options)).rejects.toMatchObject({ code: "INVALID" });
    await expect(openDb(file, options)).rejects.toMatchObject({ code: "INVALID" });
    expect(await bytes(file)).toEqual(before);
    expect(existsSync(join(dirname(file), "backups"))).toBe(false);
  },
);
it.each(["TABLE document_extractions", "INDEX idx_chunks_doc", "TRIGGER chunks_keyword_insert"])(
  "refuses an incomplete current schema (%s) instead of repairing it",
  async (object) => {
    const file = await path();
    const h = await opened(file);
    h.db.exec(`DROP ${object}`);
    h.close();
    const before = await bytes(file);
    await expect(openDb(file, options)).rejects.toMatchObject({ code: "INVALID" });
    expect(await bytes(file)).toEqual(before);
  },
);
it("read-only snapshots see WAL data and never modify source or permit writes", async () => {
  const file = await path();
  const h = await opened(file);
  h.db.exec("CREATE TABLE keep(x); INSERT INTO keep VALUES (123)");
  const before = await bytes(file);
  const readOnly = await opened(file, { readOnly: true });
  expect(readOnly.db.prepare("SELECT x FROM keep").pluck().get()).toBe(123);
  expect(() => readOnly.db.exec("INSERT INTO keep VALUES (2)")).toThrow();
  readOnly.close();
  expect(await bytes(file)).toEqual(before);
});
it("rejects mismatched identity and linked management paths without touching the database", async () => {
  const file = await path();
  (await opened(file)).close();
  const before = await bytes(file);
  await expect(openDb(file, { ...options, workbenchId: "different" })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  expect(await bytes(file)).toEqual(before);
  const target = await path();
  const link = join(dirname(target), "linked");
  await symlink(dirname(file), link, process.platform === "win32" ? "junction" : "dir");
  await expect(openDb(join(link, "vera.db"), options)).rejects.toMatchObject({ code: "DENIED" });
});
it("never initializes an existing unrecognized database", async () => {
  const file = await path();
  const raw = new Database(file);
  raw.exec("CREATE TABLE retained(value); INSERT INTO retained VALUES('keep exactly')");
  raw.close();
  const before = await bytes(file);
  await expect(openDb(file, options)).rejects.toMatchObject({ code: "INVALID" });
  expect(await bytes(file)).toEqual(before);
});
it("initializes an empty writable database but never initializes a read-only one", async () => {
  const file = await path();
  new Database(file).close();
  const before = await bytes(file);
  await expect(openDb(file, { ...options, readOnly: true })).rejects.toMatchObject({ code: "INVALID" });
  expect(await bytes(file)).toEqual(before);
  expect((await opened(file)).db.prepare("SELECT COUNT(*) FROM sessions").pluck().get()).toBe(0);
});
it("does not read, replace or extend old backup files", async () => {
  const file = await path();
  const directory = join(dirname(file), "backups");
  await mkdir(directory);
  const backup = join(directory, "vera.db.v0.bak");
  await writeFile(backup, "leave this file alone");
  (await opened(file)).close();
  (await opened(file)).close();
  expect(await readdir(directory)).toEqual(["vera.db.v0.bak"]);
  expect(await readFile(backup, "utf8")).toBe("leave this file alone");
});
