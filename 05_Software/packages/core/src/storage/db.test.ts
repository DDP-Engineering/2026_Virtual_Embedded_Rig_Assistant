import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeAll, expect, it } from "vitest";

let openDb: typeof import("./db.js").openDb;
let inspectDatabase: typeof import("./db.js").inspectDatabase;
let migrations: typeof import("./migrate.js").migrations;
beforeAll(async () => {
  expect(existsSync(new URL("./db.ts", import.meta.url)), "storage implementation exists").toBe(true);
  ({ openDb, inspectDatabase } = await import("./db.js"));
  ({ migrations } = await import("./migrate.js"));
});
const roots: string[] = [];
const handles: { close(): void }[] = [];
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
const options = { workbenchId: "wb_test", appVersion: "0.0.0" };
async function opened(file: string, extra = {}) {
  const handle = await openDb(file, { ...options, ...extra });
  handles.push(handle);
  return handle;
}
async function bytes(file: string) {
  const directory = join(file, "..");
  const result: Record<string, string> = {};
  for (const name of (await readdir(directory)).sort()) {
    if (name === "backups") continue;
    result[name] = createHash("sha256")
      .update(await readFile(join(directory, name)))
      .digest("hex");
  }
  return result;
}
it("migrates fresh real SQLite, configures pragmas, and reopening applies nothing", async () => {
  const file = await path();
  let h = await opened(file);
  expect(h.db.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(h.db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(h.db.pragma("busy_timeout", { simple: true })).toBe(5000);
  expect(h.db.pragma("synchronous", { simple: true })).toBe(1);
  expect(h.db.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("1");
  expect(h.db.prepare("SELECT value FROM meta WHERE key='migration_0001_sha256'").pluck().get()).toBe(
    createHash("sha256")
      .update(migrations[0]?.sql ?? "")
      .digest("hex"),
  );
  expect(h.db.prepare("SELECT value FROM meta WHERE key='workbench_id'").pluck().get()).toBe("wb_test");
  const before = h.db.prepare("SELECT * FROM meta ORDER BY key").all();
  h.close();
  h = await opened(file);
  expect(h.db.prepare("SELECT * FROM meta ORDER BY key").all()).toEqual(before);
  expect(await readdir(join(file, "../backups"))).toEqual(["vera.db.v0.bak"]);
});
it("initial schema supplies all specified tables, indexes and cascading foreign keys", async () => {
  const { db } = await opened(await path());
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").pluck().all()).toEqual(
    [
      "approvals",
      "artifacts",
      "changes",
      "chunks",
      "documents",
      "events",
      "messages",
      "meta",
      "sessions",
      "todos",
      "tool_calls",
    ],
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
  expect(db.pragma("index_info(idx_documents_status)")).toEqual(
    expect.arrayContaining([expect.objectContaining({ name: "status" })]),
  );
});
it("refuses changed or missing applied checksum before touching source bytes", async () => {
  const file = await path();
  const h = await opened(file);
  h.close();
  const before = await bytes(file);
  await expect(
    openDb(file, { ...options, migrations: [{ version: 1, sql: `${migrations[0]?.sql}\n-- changed` }] }),
  ).rejects.toMatchObject({ code: "INVALID", params: { reason: expect.stringContaining("checksum") } });
  expect(await bytes(file)).toEqual(before);
  const raw = new Database(file);
  raw.prepare("DELETE FROM meta WHERE key='migration_0001_sha256'").run();
  raw.close();
  await expect(openDb(file, options)).rejects.toMatchObject({
    code: "INVALID",
    params: { reason: expect.stringContaining("checksum") },
  });
});
it("backs up actual WAL data before each pending migration and preserves earlier backup", async () => {
  const file = await path();
  const h = await opened(file);
  h.db.exec("CREATE TABLE keep(text TEXT); INSERT INTO keep VALUES ('Banc ă');");
  const v2 = [...migrations, { version: 2, sql: "ALTER TABLE keep ADD COLUMN extra TEXT;" }];
  // The original connection stays alive, leaving committed rows in WAL.
  const next = await opened(file, { migrations: v2 });
  expect(next.db.pragma("table_info(keep)")).toHaveLength(2);
  expect(await readdir(join(file, "../backups"))).toEqual(["vera.db.v0.bak", "vera.db.v1.bak"]);
  const backup = new Database(join(file, "../backups/vera.db.v1.bak"), { readonly: true });
  expect(backup.prepare("SELECT text FROM keep").pluck().get()).toBe("Banc ă");
  expect(backup.pragma("table_info(keep)")).toHaveLength(1);
  expect(backup.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("1");
  backup.close();
});
it("rolls back failed migration and blocks existing backup overwrite on retry", async () => {
  const file = await path();
  const h = await opened(file);
  h.close();
  const bad = [...migrations, { version: 2, sql: "CREATE TABLE partial(x); SELECT * FROM nonexistent;" }];
  await expect(openDb(file, { ...options, migrations: bad })).rejects.toThrow();
  const raw = new Database(file);
  expect(raw.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("1");
  expect(raw.prepare("SELECT name FROM sqlite_master WHERE name='partial'").get()).toBeUndefined();
  raw.close();
  const backup = await readFile(join(file, "../backups/vera.db.v1.bak"));
  await expect(openDb(file, { ...options, migrations: bad })).rejects.toMatchObject({ code: "CONFLICT" });
  expect(await readFile(join(file, "../backups/vera.db.v1.bak"))).toEqual(backup);
});
it("applies multiple pending steps in order with a complete backup before each step", async () => {
  const file = await path();
  const list = [
    ...migrations,
    { version: 2, sql: "CREATE TABLE step2(x); INSERT INTO step2 VALUES (2)" },
    { version: 3, sql: "ALTER TABLE step2 ADD COLUMN y; UPDATE step2 SET y=3" },
  ];
  const h = await opened(file, { migrations: list });
  expect(h.db.prepare("SELECT * FROM step2").get()).toEqual({ x: 2, y: 3 });
  expect(h.db.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("3");
  const backup = new Database(join(file, "../backups/vera.db.v2.bak"), { readonly: true });
  expect(backup.prepare("SELECT * FROM step2").get()).toEqual({ x: 2 });
  expect(backup.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("2");
  backup.close();
});
it("refuses newer schema in WAL before checksums and leaves DB/WAL/SHM and backups untouched", async () => {
  const file = await path();
  const h = await opened(file);
  h.db.prepare("UPDATE meta SET value='99' WHERE key='schema_version'").run();
  h.db.prepare("DELETE FROM meta WHERE key LIKE 'migration_%'").run();
  const before = await bytes(file);
  const backups = await readdir(join(file, "../backups"));
  await expect(inspectDatabase(file, options)).rejects.toMatchObject({ code: "WORKBENCH_TOO_NEW" });
  await expect(openDb(file, options)).rejects.toMatchObject({ code: "WORKBENCH_TOO_NEW" });
  expect(await bytes(file)).toEqual(before);
  expect(await readdir(join(file, "../backups"))).toEqual(backups);
});
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
it("refuses invalid catalogue, malformed version, mismatched identity and unsafe management paths", async () => {
  const file = await path();
  await expect(
    openDb(file, { ...options, migrations: [{ version: 2, sql: "SELECT 1" }] }),
  ).rejects.toMatchObject({ code: "INVALID" });
  expect(existsSync(file)).toBe(false);
  const h = await opened(file);
  h.close();
  await expect(openDb(file, { ...options, workbenchId: "different" })).rejects.toMatchObject({
    code: "CONFLICT",
  });
  const raw = new Database(file);
  raw.prepare("UPDATE meta SET value='not-a-version' WHERE key='schema_version'").run();
  raw.close();
  await expect(openDb(file, options)).rejects.toMatchObject({ code: "INVALID" });
  const target = await path();
  await symlink(
    join(file, ".."),
    join(target, "../backups"),
    process.platform === "win32" ? "junction" : "dir",
  );
  await expect(openDb(target, options)).rejects.toMatchObject({ code: "DENIED" });
});
