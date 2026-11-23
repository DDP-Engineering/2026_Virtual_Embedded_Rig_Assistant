import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, expect, it, vi } from "vitest";
import { openDb, type WorkbenchDatabase } from "./db.js";

// Observe private copies: a temporary vera-storage-* folder, and a hook run before each file copy.
const copies = vi.hoisted(() => ({
  folders: [] as string[],
  before: undefined as undefined | ((source: string) => Promise<void>),
  removeFails: false,
}));
vi.mock("node:fs", async (original) => {
  const actual = await original<typeof import("node:fs")>();
  return {
    ...actual,
    mkdtempSync: (prefix: string) => {
      copies.folders.push(prefix);
      return actual.mkdtempSync(prefix);
    },
    rmSync: (...args: Parameters<typeof actual.rmSync>) => {
      if (copies.removeFails) throw Object.assign(new Error("EBUSY"), { code: "EBUSY" });
      return actual.rmSync(...args);
    },
  };
});
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    mkdtemp: (prefix: string) => {
      copies.folders.push(prefix);
      return actual.mkdtemp(prefix);
    },
    copyFile: async (source: string, target: string, mode?: number) => {
      await copies.before?.(source);
      return actual.copyFile(source, target, mode);
    },
  };
});
const privateCopies = () => copies.folders.filter((prefix) => prefix.includes("vera-storage-"));

const roots: string[] = [];
const handles: WorkbenchDatabase[] = [];
const options = { workbenchId: "wb_test", appVersion: "0.0.0" };
afterEach(async () => {
  copies.folders.length = 0;
  copies.before = undefined;
  copies.removeFails = false;
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
/** An owned database's DB and WAL bytes; the SHM index is SQLite's shared memory for live readers. */
async function content(file: string) {
  const { [`${basename(file)}-shm`]: _shm, ...rest } = await bytes(file);
  return rest;
}
it("can require an existing initialized database without creating or initializing storage", async () => {
  const file = await path();
  const existing = { ...options, existingOnly: true };
  await expect(openDb(file, existing)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(existsSync(file)).toBe(false);
  await writeFile(file, "");
  await expect(openDb(file, existing)).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(await readFile(file)).toHaveLength(0);
  expect(await readdir(dirname(file))).toEqual(["vera.db"]);
});

it("creates the complete current schema directly, with SQLite pragmas", async () => {
  const file = await path();
  const { db } = await opened(file);
  expect(db.pragma("journal_mode", { simple: true })).toBe("wal");
  expect(db.pragma("foreign_keys", { simple: true })).toBe(1);
  expect(db.pragma("busy_timeout", { simple: true })).toBe(5000);
  expect(db.pragma("synchronous", { simple: true })).toBe(1);
  expect(db.prepare("SELECT * FROM meta ORDER BY key").all()).toEqual([
    { key: "created_by", value: "0.0.0" },
    { key: "embedding_epoch", value: "0" },
    { key: "schema_version", value: "1" },
    { key: "workbench_id", value: "wb_test" },
  ]);
  expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").pluck().all()).toEqual(
    expect.arrayContaining([
      "meta",
      "sessions",
      "session_delegations",
      "session_delegation_requests",
      "session_delegation_bypass",
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
});
it("reopens current data and metadata unchanged, including committed WAL rows", async () => {
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
});
// Version 1 is the only database format during development (AGENTS.md).
it.each(["0", "2", "99", "not-a-version"])(
  "refuses a schema version other than the current one (%s) without changing DB/WAL",
  async (version) => {
    const file = await path();
    const { db } = await opened(file);
    db.prepare("UPDATE meta SET value=? WHERE key='schema_version'").run(version);
    const before = await content(file);
    await expect(openDb(file, options)).rejects.toMatchObject({ code: "INVALID" });
    expect(await content(file)).toEqual(before);
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
// REQ-REL-c12f79d2
it("opens an owned database in place, without a private copy", async () => {
  const file = await path();
  const h = await opened(file);
  h.db.exec("CREATE TABLE keep(x); INSERT INTO keep VALUES (7)");
  h.close();
  copies.folders.length = 0;
  const next = await opened(file);
  expect(privateCopies()).toEqual([]);
  expect(next.db.prepare("SELECT x FROM keep").pluck().get()).toBe(7);
  next.db.exec("INSERT INTO keep VALUES (8)");
});
// REQ-REL-e939f88a
it("refuses an owned database in another schema before any write, with a live WAL", async () => {
  const file = await path();
  const h = await opened(file);
  h.db.prepare("UPDATE meta SET value='99' WHERE key='schema_version'").run();
  const before = await content(file);
  expect(Object.keys(before)).toContain("vera.db-wal");
  await expect(openDb(file, options)).rejects.toMatchObject({ code: "INVALID" });
  expect(await content(file)).toEqual(before);
  expect(h.db.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("99");
});
// REQ-REL-93a4a5e0
it("read-only opens query an asynchronous private copy that close removes", async () => {
  const file = await path();
  const h = await opened(file);
  h.db.exec("CREATE TABLE keep(x); INSERT INTO keep VALUES (5)");
  const copied: string[] = [];
  copies.before = async (source) => {
    copied.push(source);
  };
  const readOnly = await opened(file, { readOnly: true });
  expect(copied).toEqual([file, `${file}-wal`]);
  expect(privateCopies()).toHaveLength(1);
  expect(readOnly.db.name).not.toBe(file);
  expect(readOnly.db.prepare("SELECT x FROM keep").pluck().get()).toBe(5);
  readOnly.close();
  expect(existsSync(dirname(readOnly.db.name))).toBe(false);
});
it("a source that changes during the copy and its retry fails BUSY", async () => {
  const file = await path();
  const h = await opened(file);
  const attempts: string[] = [];
  copies.before = async (source) => {
    attempts.push(source);
    if (source === file)
      h.db.exec("CREATE TABLE IF NOT EXISTS churn(x); INSERT INTO churn VALUES (randomblob(9000))");
  };
  await expect(openDb(file, { ...options, readOnly: true })).rejects.toMatchObject({ code: "BUSY" });
  expect(attempts.filter((source) => source === file)).toHaveLength(2);
  let once = false;
  copies.before = async (source) => {
    if (source === file && !once) {
      once = true;
      h.db.exec("INSERT INTO churn VALUES (1)");
    }
  };
  const settled = await opened(file, { readOnly: true });
  expect(settled.db.prepare("SELECT count(*) FROM churn").pluck().get()).toBe(3);
});
it.each(["EBUSY", "EPERM"])("a copy refused with %s fails BUSY", async (code) => {
  const file = await path();
  (await opened(file)).close();
  copies.before = async () => {
    throw Object.assign(new Error(code), { code });
  };
  await expect(openDb(file, { ...options, readOnly: true })).rejects.toMatchObject({ code: "BUSY" });
  expect(privateCopies()).toHaveLength(1);
});
it("closing a snapshot never throws when its private copy cannot be removed", async () => {
  const file = await path();
  (await opened(file)).close();
  const readOnly = await openDb(file, { ...options, readOnly: true });
  const copy = dirname(readOnly.db.name);
  roots.push(copy);
  copies.removeFails = true;
  expect(() => readOnly.close()).not.toThrow();
  expect(existsSync(copy)).toBe(true);
});
it("a new snapshot removes private copies older than a day and keeps recent ones", async () => {
  const file = await path();
  (await opened(file)).close();
  const stale = await mkdtemp(join(tmpdir(), "vera-storage-"));
  const recent = await mkdtemp(join(tmpdir(), "vera-storage-"));
  roots.push(stale, recent);
  const old = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
  await utimes(stale, old, old);
  await opened(file, { readOnly: true });
  expect(existsSync(stale)).toBe(false);
  expect(existsSync(recent)).toBe(true);
});
