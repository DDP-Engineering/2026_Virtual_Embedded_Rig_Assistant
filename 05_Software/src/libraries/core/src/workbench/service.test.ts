import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { afterEach, beforeAll, expect, it } from "vitest";
import { createDocumentProcessor } from "../knowledge/processor.js";
import { PluginStore } from "../plugins/store.js";
import { SettingsService } from "../settings/service.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import { acquireGuard } from "./guard.js";
import { createIgnoreRules } from "./ignore.js";

let WorkbenchService: typeof import("./service.js").WorkbenchService;
let parseConfig: typeof import("./service.js").parseConfig;
beforeAll(async () => {
  expect(existsSync(new URL("./service.ts", import.meta.url)), "workbench lifecycle service exists").toBe(
    true,
  );
  ({ WorkbenchService, parseConfig } = await import("./service.js"));
});
const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function harness() {
  const root = await mkdtemp(join(tmpdir(), "vera-wb-"));
  roots.push(root);
  const folder = join(root, "bench");
  await mkdir(join(folder, ".vera"), { recursive: true });
  const events: unknown[] = [];
  const files = {
    read: async (path: string) => {
      try {
        return await readFile(path, "utf8");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
        throw e;
      }
    },
    writeAtomic: async (path: string, text: string) => {
      await writeFile(path, text);
    },
    backup: async () => true,
  };
  const paths = { userData: root, settings: join(root, "settings.json"), logs: join(root, "logs") };
  const settings = new SettingsService({ files, paths, uuid: randomUUID, changed: () => {} });
  await settings.load();
  const host = {
    userData: root,
    files,
    settings,
    appVersion: "0.0.0",
    now: () => new Date("2026-10-11T00:00:00Z"),
    pid: process.pid,
    isProcessAlive: (pid: number) => pid === process.pid,
    token: randomUUID,
    changed: (event: unknown) => {
      events.push(event);
    },
  };
  return { root, folder, host, events, settings, paths, service: new WorkbenchService(host) };
}
it("creates project metadata only inside .vera and reopens it", async () => {
  const h = await harness();
  try {
    const created = await h.service.create(h.folder, "Current layout");
    expect(existsSync(join(h.folder, ".vera/workbench.yaml"))).toBe(true);
    expect(existsSync(join(h.folder, ".vera/WORKBENCH.md"))).toBe(true);
    expect(existsSync(join(h.folder, ".vera/skills"))).toBe(true);
    for (const name of ["docs", "workbench.yaml", "WORKBENCH.md", "skills"])
      expect(existsSync(join(h.folder, name))).toBe(false);
    await h.service.updatePinned("Project context");
    await h.service.updateConfig({ name: "Updated" });
    await h.service.close();
    expect((await h.service.open(h.folder)).config.id).toBe(created.config.id);
    expect((await h.service.getPinned()).content).toBe("Project context");
    expect(await readdir(h.folder)).toEqual([".vera"]);
  } finally {
    await h.service.close();
  }
});
it.each(["file", "directory"])("leaves user-owned docs %s unchanged on create and open", async (kind) => {
  const h = await harness();
  const docs = join(h.folder, "docs");
  if (kind === "directory") await mkdir(docs);
  const path = kind === "file" ? docs : join(docs, "notes.md");
  await writeFile(path, "User content");
  try {
    await h.service.create(h.folder, "User-owned documents");
    await h.service.close();
    await h.service.open(h.folder);
    expect(await readFile(path, "utf8")).toBe("User content");
    expect((await readdir(h.folder)).sort()).toEqual([".vera", "docs"]);
    if (kind === "directory") expect(await readdir(docs)).toEqual(["notes.md"]);
  } finally {
    await h.service.close();
  }
});
it("persists registered workbench pinning and rejects unregistered folders", async () => {
  const h = await harness();
  try {
    await h.service.create(h.folder, "Pinned board");
    expect((await h.service.recent(undefined, { folder: h.folder, value: true }))[0]?.pinned).toBe(true);
    await h.service.close();
    await h.service.open(h.folder);
    expect((await h.service.recent())[0]?.pinned).toBe(true);
    expect((await h.service.recent(undefined, { folder: h.folder, value: false }))[0]?.pinned).toBe(false);
    await expect(h.service.recent(undefined, { folder: h.root, value: true })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  } finally {
    await h.service.close();
  }
});
it("moves a workbench only within its pinned group and keeps its place when opened", async () => {
  const h = await harness();
  const folders: string[] = [];
  for (const n of [0, 1, 2, 3]) {
    const folder = join(h.root, `move${n}`);
    await mkdir(folder);
    await h.service.create(folder, `Move${n}`);
    folders.push(folder);
  }
  await h.service.close();
  const names = async () => (await h.service.recent()).map((e) => e.name);
  // Created last first; pin the two oldest so the stored order is Move3, Move2, Move1*, Move0*.
  await h.service.recent(undefined, { folder: folders[1] as string, value: true });
  await h.service.recent(undefined, { folder: folders[0] as string, value: true });
  expect(await names()).toEqual(["Move3", "Move2", "Move1", "Move0"]);
  const move = (n: number, offset: -1 | 1) =>
    h.service.recent(undefined, undefined, { folder: folders[n] as string, offset });
  // The second pinned entry moves up over the first pinned one, across the unpinned ones.
  expect((await move(0, -1)).map((e) => e.name)).toEqual(["Move3", "Move2", "Move0", "Move1"]);
  // The first unpinned entry has no unpinned neighbour above it.
  expect((await move(3, -1)).map((e) => e.name)).toEqual(["Move3", "Move2", "Move0", "Move1"]);
  expect((await move(3, 1)).map((e) => e.name)).toEqual(["Move2", "Move3", "Move0", "Move1"]);
  // The last pinned entry cannot move further down.
  expect((await move(1, 1)).map((e) => e.name)).toEqual(["Move2", "Move3", "Move0", "Move1"]);
  await expect(h.service.recent(undefined, undefined, { folder: h.root, offset: 1 })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  // Opening a listed workbench updates it in place; a new folder goes first.
  h.host.now = () => new Date("2026-10-12T00:00:00Z");
  await h.service.open(folders[3] as string);
  await h.service.close();
  const entries = await h.service.recent();
  expect(entries.map((e) => e.name)).toEqual(["Move2", "Move3", "Move0", "Move1"]);
  expect(entries[1]?.lastOpened).toBe("2026-10-12T00:00:00.000Z");
  await h.service.create(h.folder, "Fresh");
  await h.service.close();
  expect(await names()).toEqual(["Fresh", "Move2", "Move3", "Move0", "Move1"]);
  // The order survives a settings reload.
  const settings = new SettingsService({
    files: h.host.files,
    paths: h.paths,
    uuid: randomUUID,
    changed: () => {},
  });
  await settings.load();
  expect((await new WorkbenchService({ ...h.host, settings }).recent()).map((e) => e.name)).toEqual([
    "Fresh",
    "Move2",
    "Move3",
    "Move0",
    "Move1",
  ]);
});
it("opens the current workbench format unchanged and refuses another format without runtime or recent writes", async () => {
  const h = await harness();
  const file = join(h.folder, ".vera/workbench.yaml");
  const current = await readFile(resolve("tests/fixtures/app-data/workbench.yaml"), "utf8");
  await writeFile(file, current);
  const opened = await h.service.open(h.folder);
  expect(opened.config).toMatchObject({ format: 1, extension: "kept" });
  await h.service.close();
  expect(await readFile(file, "utf8")).toBe(current);
  // Format 1 is the only format during development (AGENTS.md).
  const other = current.replace("format: 1", "format: 2");
  await writeFile(file, other);
  const beforeSettings = await readFile(h.paths.settings, "utf8");
  await expect(h.service.open(h.folder)).rejects.toMatchObject({ code: "INVALID" });
  expect(await readFile(file, "utf8")).toBe(other);
  expect(await readFile(h.paths.settings, "utf8")).toBe(beforeSettings);
  expect(existsSync(join(h.folder, ".vera/lock"))).toBe(false);
});
it("manages skills exclusively with stale hash, ownership and current workbench admission", async () => {
  const h = await harness();
  try {
    const wb = await h.service.create(h.folder, "Skills");
    const created = await h.service.saveSkill(wb.config.id, "workbench", "reader");
    expect(created.content).toContain("name: reader");
    await expect(h.service.saveSkill(wb.config.id, "workbench", "reader")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const edited = await h.service.saveSkill(
      wb.config.id,
      "workbench",
      "reader",
      created.content.replace("Describe", "Read"),
      created.sha256,
    );
    await expect(
      h.service.saveSkill(wb.config.id, "workbench", "reader", "lost", created.sha256),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await h.service.openSkill(wb.config.id, "workbench", "reader")).toEqual(edited);
    await h.service.saveSkill(wb.config.id, "user", "personal");
    expect((await h.service.listSkills(wb.config.id)).map((s) => s.source)).toEqual(["user", "workbench"]);
    await h.service.toggleSkill(wb.config.id, "reader", false);
    expect((await h.service.getConfig()).warnings).not.toContainEqual({
      code: "UNKNOWN_NAME",
      path: "skills.disabled.reader",
    });
    expect((await h.service.skillCatalog(wb.config.id).metadata()).map((s) => s.name)).toEqual(["personal"]);
    const external = await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8");
    await writeFile(join(h.folder, ".vera/workbench.yaml"), external.replace("- reader", "- personal"));
    expect((await h.service.skillCatalog(wb.config.id).metadata()).map((s) => s.name)).toEqual(["reader"]);
    await expect(h.service.listSkills("wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    const lockPath = join(h.folder, ".vera/lock"),
      original = await readFile(lockPath, "utf8");
    try {
      await writeFile(
        lockPath,
        JSON.stringify({ pid: process.pid, token: "foreign", app: "0", since: "2026-10-13" }),
      );
      await expect(h.service.saveSkill(wb.config.id, "user", "denied")).rejects.toMatchObject({
        code: "DENIED",
      });
    } finally {
      await writeFile(lockPath, original);
    }
    const oldCatalog = h.service.skillCatalog(wb.config.id);
    await h.service.close();
    await h.service.open(h.folder);
    await expect(oldCatalog.metadata()).rejects.toMatchObject({ code: "CONFLICT" });
  } finally {
    await h.service.close();
  }
});
it("create/open roundtrip writes validating YAML/template/runtime and preserves existing content", async () => {
  const h = await harness();
  await writeFile(join(h.folder, ".vera/WORKBENCH.md"), "my pinned content");
  await writeFile(join(h.folder, "existing.txt"), "user data");
  const created = await h.service.create(h.folder, "Board");
  expect(created.config.id).toMatch(/^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  expect(parseConfig(await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8"))).toEqual(created.config);
  expect(await readFile(join(h.folder, ".vera/WORKBENCH.md"), "utf8")).toBe("my pinned content");
  expect(await readFile(join(h.folder, ".vera/.gitignore"), "utf8")).toBe(
    "*\n!.gitignore\n!workbench.yaml\n!WORKBENCH.md\n!.veraignore\n!skills/\n!skills/**\n",
  );
  expect(existsSync(join(h.folder, "docs"))).toBe(false);
  expect(existsSync(join(h.folder, ".vera/skills"))).toBe(true);
  await expect(h.service.create(h.folder, "Other")).rejects.toMatchObject({ code: "CONFLICT" });
  await h.service.close();
  expect(existsSync(join(h.folder, ".vera/lock"))).toBe(false);
  const opened = await h.service.open(h.folder);
  expect(opened.config).toEqual(created.config);
  expect(opened.readOnly).toBe(false);
  await h.service.close();
  expect(await readFile(join(h.folder, "existing.txt"), "utf8")).toBe("user data");
});
// REQ-FUNC-28ad0001 REQ-UX-28ad0003
it("scopes document reads and reindex to identity/current ownership and serializes close", async () => {
  const h = await harness();
  try {
    const opened = await h.service.create(h.folder, "Docs");
    expect(await h.service.listDocuments(opened.config.id)).toEqual([]);
    await expect(h.service.listDocuments("wb_00000000000000000000000000")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await expect(h.service.reindexDocuments("wb_00000000000000000000000000")).rejects.toMatchObject({
      code: "CONFLICT",
    });
    let release: () => void = () => {};
    const read = h.service.readDocuments(
      opened.config.id,
      async () =>
        new Promise((done) => {
          release = () => done("source");
        }),
    );
    await expect.poll(() => release.toString().includes('done("source")')).toBe(true);
    let closed = false;
    const closing = h.service.close().then(() => {
      closed = true;
    });
    await Promise.resolve();
    expect(closed).toBe(false);
    release();
    expect(await read).toBe("source");
    await closing;
    await expect(h.service.listDocuments(opened.config.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  } finally {
    await h.service.close();
  }
});
it("Docs search verifies current source hash/status/kind/locator and rejects edited, replaced or binary text", async () => {
  const h = await harness();
  try {
    const opened = await h.service.create(h.folder, "Current docs"),
      path = "docs/current.md";
    const text = "# Supply\nCURRENT_DOC_TOKEN123 3.3 V\n# Reset\nCURRENT_DOC_TOKEN123 assert reset\n";
    await mkdir(join(h.folder, "docs"));
    await writeFile(join(h.folder, path), text);
    const sha256 = createHash("sha256").update(text).digest("hex");
    const result = await createDocumentProcessor(async () => {
      throw Error("No PDF expected");
    })({
      root: h.folder,
      path,
      kind: "markdown",
      sha256,
      signal: new AbortController().signal,
      assertWritable: () => {},
    });
    const rows = new DocumentsRepository(h.service.getDatabase());
    const doc = rows.save({
      path,
      kind: "markdown",
      sha256,
      bytes: Buffer.byteLength(text),
      mtime: new Date().toISOString(),
      pages: null,
      status: "indexed",
      error: null,
      indexedAt: null,
    });
    rows.replaceChunks(doc.id, result.chunks ?? [], result.derived);
    expect(await h.service.searchDocuments(opened.config.id, "CURRENT_DOC_TOKEN123")).toHaveLength(2);
    await writeFile(join(h.folder, path), "# Supply\nChanged source\n");
    expect(await h.service.searchDocuments(opened.config.id, "CURRENT_DOC_TOKEN123")).toEqual([]);
    await writeFile(join(h.folder, "replacement.md"), "# Replacement\nDifferent bytes\n");
    await rename(join(h.folder, "replacement.md"), join(h.folder, path));
    expect(await h.service.searchDocuments(opened.config.id, "CURRENT_DOC_TOKEN123")).toEqual([]);
    await writeFile(join(h.folder, path), text);
    rows.save({ ...doc, status: "pending" });
    expect(await h.service.searchDocuments(opened.config.id, "CURRENT_DOC_TOKEN123")).toEqual([]);
    const binary = Buffer.from([0, 1, 2, 3]);
    await writeFile(join(h.folder, path), binary);
    rows.save({ ...doc, sha256: createHash("sha256").update(binary).digest("hex"), bytes: binary.length });
    expect(await h.service.searchDocuments(opened.config.id, "CURRENT_DOC_TOKEN123")).toEqual([]);
    await writeFile(join(h.folder, path), text);
    rows.save(doc);
    await writeFile(join(h.folder, ".vera/.veraignore"), `${path}\n`);
    expect(await h.service.searchDocuments(opened.config.id, "CURRENT_DOC_TOKEN123")).toEqual([]);
  } finally {
    await h.service.close();
  }
});
// REQ-FUNC-73136b97
it("Docs search lists hits from a headingless docx with its #h= ref and drops them once the source changes", async () => {
  const h = await harness();
  try {
    const opened = await h.service.create(h.folder, "Plain docs"),
      path = "docs/notes.docx";
    const bytes = await readFile(
      new URL("../../../../../tests/fixtures/documents/office/plain.docx", import.meta.url),
    );
    await mkdir(join(h.folder, "docs"));
    await writeFile(join(h.folder, path), bytes);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const result = await createDocumentProcessor(async () => {
      throw Error("No PDF expected");
    })({
      root: h.folder,
      path,
      kind: "document",
      sha256,
      signal: new AbortController().signal,
      assertWritable: () => {},
    });
    const rows = new DocumentsRepository(h.service.getDatabase());
    const doc = rows.save({
      path,
      kind: "document",
      sha256,
      bytes: bytes.length,
      mtime: new Date().toISOString(),
      pages: null,
      status: "indexed",
      error: null,
      indexedAt: null,
    });
    rows.replaceChunks(doc.id, result.chunks ?? [], result.derived);
    expect(await h.service.searchDocuments(opened.config.id, "SWD clock")).toMatchObject([
      { ref: "docs/notes.docx#h=", path },
    ]);
    await writeFile(join(h.folder, path), bytes.subarray(0, bytes.length - 1));
    expect(await h.service.searchDocuments(opened.config.id, "SWD clock")).toEqual([]);
  } finally {
    await h.service.close();
  }
});

it("serializes pinned and config application saves through the exposed workbench write queue", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  const queue = h.service.getWriteQueue();
  let release: () => void = () => {};
  let held = false;
  const first = queue.run(async () => {
    held = true;
    await new Promise<void>((done) => {
      release = done;
    });
  });
  await expect.poll(() => held).toBe(true);
  let saved = false;
  const pinned = h.service.updatePinned("queued pinned").then(() => {
    saved = true;
  });
  const config = h.service.updateConfig({ name: "Queued board" });
  await new Promise<void>((done) => setTimeout(done, 20));
  expect(saved).toBe(false);
  expect(await readFile(join(h.folder, ".vera/WORKBENCH.md"), "utf8")).not.toBe("queued pinned");
  release();
  await Promise.all([first, pinned, config]);
  expect(h.service.getWriteQueue()).toBe(queue);
  expect(await readFile(join(h.folder, ".vera/WORKBENCH.md"), "utf8")).toBe("queued pinned");
  expect(parseConfig(await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8")).name).toBe(
    "Queued board",
  );
  await h.service.close();
});

it("database lifetime follows owned open, same-folder reopen, close and failed replacement", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  expect(existsSync(join(h.folder, ".vera/vera.db"))).toBe(true);
  const first = h.service.getDatabase();
  first.exec("CREATE TABLE retained(x); INSERT INTO retained VALUES (1)");
  await h.service.open(h.folder);
  expect(h.service.getDatabase()).toBe(first);
  const second = join(h.root, "second");
  await mkdir(join(second, ".vera"), { recursive: true });
  await writeFile(
    join(second, ".vera/workbench.yaml"),
    await readFile(join(h.folder, ".vera/workbench.yaml")),
  );
  h.host.settings.update = async () => {
    throw new Error("recent failed");
  };
  await expect(h.service.open(second)).rejects.toThrow("recent failed");
  expect(existsSync(join(second, ".vera/lock"))).toBe(false);
  expect(h.service.getDatabase()).toBe(first);
  expect(first.prepare("SELECT x FROM retained").pluck().get()).toBe(1);
  const replacement = new Database(join(second, ".vera/vera.db"));
  replacement.pragma("locking_mode=EXCLUSIVE");
  replacement.exec("BEGIN EXCLUSIVE; COMMIT;");
  replacement.close();
  await h.service.close();
  expect(first.open).toBe(false);
});
it("a database in another format is refused before lock/recents changes and failed storage switch retains previous", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  const first = h.service.getDatabase();
  const second = join(h.root, "second");
  await mkdir(join(second, ".vera"), { recursive: true });
  await writeFile(
    join(second, ".vera/workbench.yaml"),
    await readFile(join(h.folder, ".vera/workbench.yaml")),
  );
  const file = join(second, ".vera/vera.db");
  const db = new Database(file);
  db.exec(
    "CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); INSERT INTO meta VALUES ('schema_version','99')",
  );
  db.close();
  await writeFile(
    join(second, ".vera/lock"),
    JSON.stringify({ pid: 999999, app: "newer", since: "now", token: "untouched" }),
  );
  const original = await readFile(file);
  const lock = await readFile(join(second, ".vera/lock"));
  const settings = await readFile(h.paths.settings);
  await expect(h.service.open(second)).rejects.toMatchObject({ code: "INVALID" });
  expect(await readFile(file)).toEqual(original);
  expect(await readFile(join(second, ".vera/lock"))).toEqual(lock);
  expect(await readFile(h.paths.settings)).toEqual(settings);
  expect(h.service.getDatabase()).toBe(first);
  await h.service.close();
});
it("lost token reopen and close preserve every live-owner runtime byte while disposing prior storage", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  const first = h.service.getDatabase();
  first.exec("CREATE TABLE retained(x); INSERT INTO retained VALUES(123)");
  await writeFile(
    join(h.folder, ".vera/lock"),
    JSON.stringify({ pid: process.pid, app: "other", since: "now", token: "replacement" }),
  );
  const files = ["vera.db", "vera.db-wal", "vera.db-shm", "lock"];
  const before = await Promise.all(files.map((f) => readFile(join(h.folder, ".vera", f))));
  expect((await h.service.open(h.folder)).readOnly).toBe(true);
  expect(first.open).toBe(false);
  expect(h.service.getDatabase().prepare("SELECT x FROM retained").pluck().get()).toBe(123);
  expect(await Promise.all(files.map((f) => readFile(join(h.folder, ".vera", f))))).toEqual(before);
  await h.service.close();
  expect(await Promise.all(files.map((f) => readFile(join(h.folder, ".vera", f))))).toEqual(before);
});
it("failed prior-lock unlink leaves prior storage usable and releases replacement storage/token", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  const first = h.service.getDatabase();
  const second = join(h.root, "second");
  await mkdir(join(second, ".vera"), { recursive: true });
  await writeFile(
    join(second, ".vera/workbench.yaml"),
    await readFile(join(h.folder, ".vera/workbench.yaml")),
  );
  const lockPath = join(h.folder, ".vera/lock");
  const original = await readFile(lockPath, "utf8");
  const read = h.host.files.read;
  h.host.files.read = async (path) => {
    const result = await read(path);
    if (path === lockPath) {
      await rm(lockPath);
      await mkdir(lockPath);
      h.host.files.read = read;
    }
    return result;
  };
  await expect(h.service.open(second)).rejects.toThrow();
  expect(h.service.getDatabase()).toBe(first);
  expect(first.open).toBe(true);
  expect(first.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("1");
  expect(existsSync(join(second, ".vera/lock"))).toBe(false);
  await rm(lockPath, { recursive: true });
  await writeFile(lockPath, original);
  await h.service.close();
});
it("live owner opens a WAL snapshot readonly and leaves source bytes intact, absent DB creates nothing", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  h.service.getDatabase().exec("CREATE TABLE data(x); INSERT INTO data VALUES (123)");
  const files = ["vera.db", "vera.db-wal", "vera.db-shm", "lock"];
  const before = await Promise.all(files.map((f) => readFile(join(h.folder, ".vera", f))));
  const reader = new WorkbenchService({ ...h.host, pid: process.pid + 1 });
  expect((await reader.open(h.folder)).readOnly).toBe(true);
  expect(reader.getDatabase().prepare("SELECT x FROM data").pluck().get()).toBe(123);
  expect(() => reader.getDatabase().exec("INSERT INTO data VALUES (1)")).toThrow();
  await reader.close();
  expect(await Promise.all(files.map((f) => readFile(join(h.folder, ".vera", f))))).toEqual(before);
  await h.service.close();
  await rm(join(h.folder, ".vera/vera.db"));
  await writeFile(
    join(h.folder, ".vera/lock"),
    JSON.stringify({ pid: process.pid, app: "owner", since: "now" }),
  );
  expect((await reader.open(h.folder)).readOnly).toBe(true);
  expect(existsSync(join(h.folder, ".vera/vera.db"))).toBe(false);
  expect(() => reader.getDatabase()).toThrow();
  await reader.close();
});
it("creates the specified English template and rejects malformed YAML with line and another format before writes", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Test board");
  await h.service.close();
  expect(await readFile(join(h.folder, ".vera/WORKBENCH.md"), "utf8")).toContain(
    "## Device under test\nBoard, MCU, revision, key parts.",
  );
  await rm(join(h.folder, ".vera"), { recursive: true });
  await mkdir(join(h.folder, ".vera"));
  const other = "format: 2\nid: wb_01K00000000000000000000000\nname: Other\n";
  await writeFile(join(h.folder, ".vera/workbench.yaml"), other);
  await expect(h.service.open(h.folder)).rejects.toMatchObject({ code: "INVALID" });
  expect(existsSync(join(h.folder, ".vera/lock"))).toBe(false);
  expect(await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8")).toBe(other);
  await writeFile(join(h.folder, ".vera/workbench.yaml"), "format: 1\nname: [broken\n");
  await expect(h.service.open(h.folder)).rejects.toMatchObject({
    code: "INVALID",
    messageKey: "errors.YAML_INVALID",
    params: { line: 3 },
  });
});
it("takes over dead lock, respects live owner without mutations, and closes only owned token", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  await h.service.close();
  const lock = join(h.folder, ".vera/lock");
  await writeFile(lock, JSON.stringify({ pid: 987654, app: "0.0.0", since: "2020-01-01T00:00:00Z" }));
  expect((await h.service.open(h.folder)).readOnly).toBe(false);
  expect(JSON.parse(await readFile(lock, "utf8"))).toMatchObject({
    pid: process.pid,
    token: expect.any(String),
  });
  const other = new WorkbenchService(h.host);
  const before = await readFile(lock, "utf8");
  expect((await other.open(h.folder)).readOnly).toBe(true);
  await other.close();
  expect(await readFile(lock, "utf8")).toBe(before);
  await writeFile(
    lock,
    JSON.stringify({ pid: process.pid, app: "0.0.0", since: "2026-10-11", token: "replacement" }),
  );
  await h.service.close();
  expect(JSON.parse(await readFile(lock, "utf8")).token).toBe("replacement");
});
it("concurrent opens have one writer, guard contention is conservative, malformed locks conflict", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  await h.service.close();
  const services = Array.from({ length: 5 }, () => new WorkbenchService(h.host));
  const opened = await Promise.all(services.map((s) => s.open(h.folder)));
  expect(opened.filter((s) => !s.readOnly)).toHaveLength(1);
  await Promise.all(services.map((s) => s.close()));
  await mkdir(join(h.folder, ".vera/lock.guard"));
  expect(await h.service.open(h.folder)).toMatchObject({ readOnly: false });
  await h.service.close();
  await rm(join(h.folder, ".vera/lock.guard"), { recursive: true });
  await writeFile(join(h.folder, ".vera/lock"), "invalid");
  await expect(h.service.open(h.folder)).rejects.toMatchObject({ code: "CONFLICT" });
});
it("reassesses same-folder ownership on reopen", async () => {
  const h = await harness();
  const writer = h.service;
  const first = await writer.create(h.folder, "Board");
  const reader = new WorkbenchService(h.host);
  expect((await reader.open(h.folder)).readOnly).toBe(true);
  await writer.close();
  expect((await reader.open(h.folder)).readOnly).toBe(false);
  await reader.updatePinned("writer after reopen");
  await writeFile(
    join(h.folder, ".vera/lock"),
    JSON.stringify({ pid: process.pid, app: "0.0.0", since: "2026-10-11", token: "replacement" }),
  );
  expect((await reader.open(h.folder)).readOnly).toBe(true);
  await expect(reader.updatePinned("denied")).rejects.toMatchObject({ code: "DENIED" });
  await reader.close();
  expect(JSON.parse(await readFile(join(h.folder, ".vera/lock"), "utf8")).token).toBe("replacement");
  expect(first.config.id).toBe(h.settings.get().settings.recentWorkbenches[0]?.id);
});
it("takes over a crashed child process lock after OS coordination is released", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  await h.service.close();
  h.host.isProcessAlive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const child = spawn(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `
    import { acquireGuard } from ${JSON.stringify(new URL("./guard.ts", import.meta.url).href)};
    import { writeFile } from "node:fs/promises";
    const release = await acquireGuard(${JSON.stringify(h.folder)});
    await writeFile(${JSON.stringify(join(h.folder, ".vera/lock"))}, JSON.stringify({pid:process.pid,app:"0.0.0",since:"2026-10-11",token:"child"}));
    process.send(Boolean(release));
  `,
    ],
    { stdio: ["ignore", "pipe", "pipe", "ipc"] },
  );
  const exited = once(child, "exit");
  let error = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    error += chunk.toString();
  });
  try {
    const ready = once(child, "message");
    await Promise.race([
      ready,
      exited.then(() => {
        throw new Error(error);
      }),
    ]);
    expect(await acquireGuard(h.folder)).toBeUndefined();
    expect((await h.service.open(h.folder)).readOnly).toBe(true);
    child.kill("SIGKILL");
    await exited;
    expect((await h.service.open(h.folder)).readOnly).toBe(false);
    await h.service.updatePinned("recovered after process death");
    await h.service.close();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
});
it("permanent ignores reject casing variants even when negated", async () => {
  const ignored = createIgnoreRules("!.VERA/\n!.GIT/\n!NODE_MODULES/\n");
  for (const path of [".VERA/lock", ".GIT/config", "NODE_MODULES/a.js", "src/.Vera/file"])
    expect(ignored(path)).toBe(true);
  const h = await harness();
  await h.service.create(h.folder, "Board");
  for (const dir of [".GIT", "NODE_MODULES"]) {
    await mkdir(join(h.folder, dir));
    await writeFile(join(h.folder, dir, "secret.txt"), "excluded");
  }
  await writeFile(join(h.folder, ".vera/.veraignore"), "!.GIT/\n!NODE_MODULES/\n");
  expect(await h.service.files("secret")).toEqual([]);
  await h.service.close();
});
it("rejects YAML tagged non-JSON extensions without bytes or runtime changes", async () => {
  const h = await harness();
  const header = "format: 1\nid: wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C\nname: Board\n";
  for (const value of ["!!set {x: null}", "!!omap [{x: 1}]", "!!binary aGVsbG8="]) {
    const raw = `${header}vendor: ${value}\n`;
    await writeFile(join(h.folder, ".vera/workbench.yaml"), raw);
    await expect(h.service.open(h.folder)).rejects.toMatchObject({ code: "INVALID" });
    expect(await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8")).toBe(raw);
    expect(existsSync(join(h.folder, ".vera/lock"))).toBe(false);
  }
});
it("recognizes built-in checkbox tool selections while reporting unavailable names", async () => {
  const h = await harness();
  try {
    await h.service.create(h.folder, "Tools");
    const saved = await h.service.updateConfig({ tools: { disabled: ["grep", "read", "unavailable_tool"] } });
    expect(saved.warnings.filter((warning) => warning.code === "UNKNOWN_NAME")).toEqual([
      { code: "UNKNOWN_NAME", path: "tools.disabled.unavailable_tool" },
    ]);
  } finally {
    await h.service.close();
  }
});

it("updates config preserving unknown nested keys/id and emits confirmed change; pinned full content warns", async () => {
  const h = await harness();
  const original = await h.service.create(h.folder, "Board");
  const path = join(h.folder, ".vera/workbench.yaml");
  await writeFile(path, `${await readFile(path, "utf8")}vendor: {version: 7}\n`);
  const text = await readFile(path, "utf8");
  await writeFile(
    path,
    text.replace("permission_mode: ask", "permission_mode: ask\n  experimental: { enabled: true }"),
  );
  const saved = await h.service.updateConfig({ name: "Renamed", agent: { model: "custom:test/model" } });
  expect(saved.config).toMatchObject({
    id: original.config.id,
    name: "Renamed",
    vendor: { version: 7 },
    agent: { experimental: { enabled: true }, permission_mode: "ask", model: "custom:test/model" },
  });
  expect(parseConfig(await readFile(path, "utf8"))).toEqual(saved.config);
  expect(h.events.at(-1)).toMatchObject({
    id: original.config.id,
    event: { type: "config.changed", config: saved.config },
  });
  const long = "Ãƒâ€žÃ†â€™".repeat(9000);
  expect(await h.service.updatePinned(long)).toEqual({ content: long, oversized: true });
  expect(await h.service.getPinned()).toEqual({ content: long, oversized: true });
  await expect(h.service.updateConfig({ id: "bad" } as never)).rejects.toMatchObject({ code: "INVALID" });
  await h.service.close();
});
it("read-only and lost-ownership deny writes; failed atomic save preserves disk/config; failed switch retains active", async () => {
  const h = await harness();
  const snapshot = await h.service.create(h.folder, "Board");
  const reader = new WorkbenchService(h.host);
  expect((await reader.open(h.folder)).readOnly).toBe(true);
  await expect(reader.updatePinned("bad")).rejects.toMatchObject({ code: "DENIED" });
  await expect(reader.updateConfig({ name: "bad" })).rejects.toMatchObject({ code: "DENIED" });
  const raw = await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8");
  h.host.files.writeAtomic = async () => {
    throw new Error("I/O error");
  };
  await expect(h.service.updateConfig({ name: "Failed" })).rejects.toThrow("I/O error");
  expect(await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8")).toBe(raw);
  expect((await h.service.getConfig()).config).toEqual(snapshot.config);
  await expect(h.service.open(join(h.root, "missing"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect((await h.service.getConfig()).config).toEqual(snapshot.config);
  await writeFile(
    join(h.folder, ".vera/lock"),
    JSON.stringify({ pid: process.pid, app: "0.0.0", since: "2026-10-11", token: "changed" }),
  );
  await expect(h.service.updatePinned("bad")).rejects.toMatchObject({ code: "DENIED" });
  await h.service.close();
  await reader.close();
});
it("completion caps50 relative paths, obeys root ignore negations and permanent exclusions, skips escaping links", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  for (const dir of [".git", "node_modules", "docs/nested/.vera"]) {
    await mkdir(join(h.folder, dir), { recursive: true });
    await writeFile(join(h.folder, dir, "hidden.txt"), "hidden");
  }
  await writeFile(join(h.folder, ".vera/.veraignore"), "*.log\n!keep.log\n!.vera/lock\n");
  for (const name of ["ignored.log", "keep.log", "docs/pinout.csv"])
    await writeFile(join(h.folder, name), "data");
  const outside = join(h.root, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(h.folder, "outside-link"), process.platform === "win32" ? "junction" : "dir");
  expect(await h.service.files("PINOUT")).toEqual(["docs/pinout.csv"]);
  expect(await h.service.files("hidden")).toEqual([]);
  expect(await h.service.files("secret")).toEqual([]);
  expect(await h.service.files(".log")).toEqual(["keep.log"]);
  for (let n = 0; n < 65; n++)
    await writeFile(join(h.folder, "docs", `f${String(n).padStart(2, "0")}.txt`), "text");
  const paths = await h.service.files("f");
  expect(paths).toHaveLength(50);
  expect(paths.every((p) => !p.includes("\\") && !p.startsWith("/"))).toBe(true);
  await h.service.close();
});
it("rejects redirected management files before writes and recognizes UNC network paths", async () => {
  const { isNetworkShare } = await import("./service.js");
  expect(isNetworkShare("\\\\server\\share\\bench")).toBe(true);
  expect(isNetworkShare("//server/share/bench")).toBe(true);
  expect(isNetworkShare("\\\\?\\C:\\bench")).toBe(false);
  const h = await harness();
  const outside = join(h.root, "outside");
  await mkdir(outside);
  await rm(join(h.folder, ".vera"), { recursive: true });
  await symlink(outside, join(h.folder, ".vera"), process.platform === "win32" ? "junction" : "dir");
  await expect(h.service.create(h.folder, "Board")).rejects.toMatchObject({ code: "DENIED" });
  expect(existsSync(join(h.folder, ".vera/workbench.yaml"))).toBe(false);
});
it("retains all unique registered workbenches, derives missing folder and removes entry across restarts", async () => {
  const h = await harness();
  for (let n = 0; n < 11; n++) {
    const folder = join(h.root, `bench${n}`);
    await mkdir(folder);
    await h.service.create(folder, `Board${n}`);
  }
  let entries = await h.service.recent();
  expect(entries).toHaveLength(11);
  expect(entries[0]?.name).toBe("Board10");
  expect(entries.some((e) => e.name === "Board0")).toBe(true);
  await h.service.open(join(h.root, "bench5"));
  await h.service.close();
  entries = await h.service.recent();
  // Opening keeps the entry's place (TASK-c99ca08c).
  expect(entries[5]?.name).toBe("Board5");
  expect(entries).toHaveLength(11);
  await rm(join(h.root, "bench5"), { recursive: true });
  const settings = new SettingsService({
    files: h.host.files,
    paths: h.paths,
    uuid: randomUUID,
    changed: () => {},
  });
  await settings.load();
  const service = new WorkbenchService({ ...h.host, settings });
  expect((await service.recent())[5]).toMatchObject({ name: "Board5", missing: true });
  expect(await service.recent(join(h.root, "bench5"))).toHaveLength(10);
  expect(settings.get().settings.recentWorkbenches.every((e) => e.name !== "Board5")).toBe(true);
});
it("failed recent save releases replacement lock and retains previous", async () => {
  const h = await harness();
  const first = await h.service.create(h.folder, "First");
  const second = join(h.root, "second");
  await mkdir(join(second, ".vera"), { recursive: true });
  const copy = await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8");
  await writeFile(join(second, ".vera/workbench.yaml"), copy.replace("name: First", "name: Second"));
  const atomic = h.host.files.writeAtomic;
  h.host.files.writeAtomic = async () => {
    throw new Error("disk failed");
  };
  await expect(h.service.open(second)).rejects.toThrow("disk failed");
  expect(existsSync(join(second, ".vera/lock"))).toBe(false);
  expect((await h.service.getConfig()).config).toEqual(first.config);
  h.host.files.writeAtomic = atomic;
  await h.service.close();
});
it("refuses external format/identity changes during pinned saves and closing redirected runtime", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  const yaml = join(h.folder, ".vera/workbench.yaml");
  const raw = await readFile(yaml, "utf8");
  await writeFile(yaml, raw.replace("format: 1", "format: 2"));
  await expect(h.service.updatePinned("bad")).rejects.toMatchObject({ code: "INVALID" });
  await writeFile(yaml, raw);
  const before = await readFile(join(h.folder, ".vera/WORKBENCH.md"), "utf8");
  const { rename } = await import("node:fs/promises");
  // Release the Windows storage handles so the redirection fixture can be constructed.
  // Keep service state and the owned token live: close must still reject the redirected path.
  (h.service as unknown as { database: { close(): void } }).database.close();
  await rename(join(h.folder, ".vera"), join(h.root, "owned-runtime"));
  const outside = join(h.root, "external");
  await mkdir(outside);
  await symlink(outside, join(h.folder, ".vera"), process.platform === "win32" ? "junction" : "dir");
  await expect(h.service.close()).rejects.toMatchObject({ code: "DENIED" });
  expect(existsSync(join(outside, "lock.guard"))).toBe(false);
  expect(await readFile(join(h.root, "owned-runtime/WORKBENCH.md"), "utf8")).toBe(before);
});
it("rejects non-JSON/circular YAML extensions before runtime or save", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  await h.service.close();
  const path = join(h.folder, ".vera/workbench.yaml");
  const raw = await readFile(path, "utf8");
  await rm(join(h.folder, ".vera"), { recursive: true });
  await mkdir(join(h.folder, ".vera"));
  for (const extension of ["vendor: .inf\n", "vendor: &loop [*loop]\n"]) {
    const text = raw + extension;
    await writeFile(path, text);
    await expect(h.service.open(h.folder)).rejects.toMatchObject({ code: "INVALID" });
    expect(await readFile(path, "utf8")).toBe(text);
    expect(existsSync(join(h.folder, ".vera/lock"))).toBe(false);
  }
});
// REQ-FUNC-81ce68df
it("inspects a chosen folder without writing: name, existing workbench, instructions and skills", async () => {
  const h = await harness();
  const plain = join(h.root, "esp32-s3-devkit");
  await mkdir(plain);
  await mkdir(join(h.root, "skills/flash-esp32"), { recursive: true });
  await writeFile(
    join(h.root, "skills/flash-esp32/SKILL.md"),
    "---\nname: flash-esp32\ndescription: Flash ESP32 boards\n---\nBody",
  );
  const empty = await h.service.inspect(plain);
  expect(empty).toEqual({
    folder: resolve(plain),
    name: "esp32-s3-devkit",
    existing: false,
    instructions: null,
    skills: [{ name: "flash-esp32", source: "user", description: "Flash ESP32 boards", enabled: true }],
  });
  expect(await readdir(plain)).toEqual([]);
  await mkdir(join(plain, ".vera/skills/probe"), { recursive: true });
  await writeFile(join(plain, ".vera/WORKBENCH.md"), "kept notes");
  await writeFile(join(plain, ".vera/skills/probe/SKILL.md"), "---\nname: probe\ndescription: Probe\n---\n");
  const seeded = await h.service.inspect(plain);
  expect(seeded.instructions).toBe("kept notes");
  expect(seeded.skills.map((s) => [s.name, s.source])).toEqual([
    ["flash-esp32", "user"],
    ["probe", "workbench"],
  ]);
  expect((await readdir(join(plain, ".vera"))).sort()).toEqual(["WORKBENCH.md", "skills"]);
  await h.service.create(h.folder, "Board");
  await h.service.close();
  expect((await h.service.inspect(h.folder)).existing).toBe(true);
  await expect(h.service.inspect(join(h.root, "absent"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(h.service.inspect("relative")).rejects.toMatchObject({ code: "INVALID" });
});
// REQ-FUNC-3815bacc
it("creates with an initial configuration and instructions, keeping an existing WORKBENCH.md", async () => {
  const h = await harness();
  try {
    const created = await h.service.create(h.folder, "Board", {
      config: {
        description: "STM32G4 motor bench",
        docs: { include: ["datasheets/**", "notes/**"], exclude: ["**/old/**"] },
        tools: { disabled: ["web_search"] },
        skills: { disabled: ["flash-esp32"] },
        agent: { permission_mode: "read-only", model: "openai/gpt-5" },
        embeddings: { model: "Xenova/bge-small-en-v1.5", chunkSize: 800, overlap: 100 },
      },
      instructions: "# Board\n\nDevice under test: STM32G474.\n",
    });
    const disk = parseConfig(await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8"));
    expect(disk).toEqual(created.config);
    expect(disk).toMatchObject({
      name: "Board",
      description: "STM32G4 motor bench",
      docs: { include: ["datasheets/**", "notes/**"], exclude: ["**/old/**"] },
      tools: { disabled: ["web_search"] },
      skills: { disabled: ["flash-esp32"] },
      agent: { permission_mode: "read-only", model: "openai/gpt-5" },
      embeddings: { chunkSize: 800, overlap: 100 },
    });
    expect(await readFile(join(h.folder, ".vera/WORKBENCH.md"), "utf8")).toBe(
      "# Board\n\nDevice under test: STM32G474.\n",
    );
  } finally {
    await h.service.close();
  }
  const other = await harness();
  try {
    await writeFile(join(other.folder, ".vera/WORKBENCH.md"), "existing notes");
    await other.service.create(other.folder, "Other", { instructions: "replacement" });
    expect(await readFile(join(other.folder, ".vera/WORKBENCH.md"), "utf8")).toBe("existing notes");
  } finally {
    await other.service.close();
  }
});
// REQ-FUNC-38107da8
it("rejects an invalid initial configuration with INVALID before writing workbench.yaml", async () => {
  const h = await harness();
  await expect(
    h.service.create(h.folder, "Board", {
      config: { embeddings: { model: "Xenova/bge-small-en-v1.5", chunkSize: 400, overlap: 400 } },
    }),
  ).rejects.toMatchObject({ code: "INVALID" });
  expect(existsSync(join(h.folder, ".vera/workbench.yaml"))).toBe(false);
  expect(existsSync(join(h.folder, ".vera/WORKBENCH.md"))).toBe(false);
  for (const config of [{ name: "Other" }, { unknown: true }, { tools: { disabled: [""] } }])
    await expect(
      h.service.create(h.folder, "Board", { config: config as Record<string, unknown> }),
    ).rejects.toMatchObject({ code: "INVALID" });
  expect(await readdir(join(h.folder, ".vera"))).toEqual([]);
});
// REQ-FUNC-81ce68df
it("inspect refuses redirected or non-ordinary management entries without writing", async () => {
  const h = await harness();
  await mkdir(join(h.folder, ".vera/WORKBENCH.md"));
  await expect(h.service.inspect(h.folder)).rejects.toMatchObject({ code: "DENIED" });
  expect((await readdir(join(h.folder, ".vera"))).sort()).toEqual(["WORKBENCH.md"]);
  const other = join(h.root, "plain");
  await mkdir(other);
  await writeFile(join(other, ".vera"), "not a directory");
  await expect(h.service.inspect(other)).rejects.toMatchObject({ code: "DENIED" });
  expect(await readdir(other)).toEqual([".vera"]);
});
// REQ-FUNC-4ee03ca8 REQ-FUNC-ad5868a2 REQ-FUNC-03b73d56
it("documentation scan, preview and relative folders apply the folder's ignore rules and errors", async () => {
  const h = await harness();
  await mkdir(join(h.folder, "datasheets"), { recursive: true });
  await mkdir(join(h.folder, "drafts"), { recursive: true });
  await writeFile(join(h.folder, "datasheets/a.pdf"), "%PDF");
  await writeFile(join(h.folder, "drafts/b.pdf"), "%PDF");
  await writeFile(join(h.folder, ".vera/.veraignore"), "drafts/\n");
  expect((await h.service.scanDocuments(h.folder)).folders.map((f) => f.path)).toEqual(["datasheets"]);
  expect(
    (await h.service.previewDocuments(h.folder, { include: ["datasheets/**", "drafts/**"], exclude: [] }))
      .files,
  ).toBe(1);
  expect(await h.service.relativeFolder(h.folder, join(h.folder, "datasheets"))).toBe("datasheets");
  await expect(h.service.relativeFolder(h.folder, join(h.folder, "drafts"))).rejects.toMatchObject({
    code: "DENIED",
  });
  await expect(h.service.relativeFolder(h.folder, "datasheets")).rejects.toMatchObject({ code: "INVALID" });
  await expect(h.service.scanDocuments(join(h.root, "absent"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(h.service.previewDocuments("relative", { include: [], exclude: [] })).rejects.toMatchObject({
    code: "INVALID",
  });
});

// REQ-FUNC-41f5c03b, REQ-FUNC-0c4bc419
it("enables a plugin for one workbench only and warns about plugins that are not installed", async () => {
  const h = await harness();
  const other = join(h.root, "other");
  await mkdir(other);
  await mkdir(join(h.root, "plugins/installed/esp32-esptool"), { recursive: true });
  try {
    const wb = await h.service.create(h.folder, "Bench A");
    expect(wb.config.plugins).toEqual({ enabled: [] });
    await h.service.togglePlugin(wb.config.id, "esp32-esptool", true);
    await h.service.togglePlugin(wb.config.id, "esp32-esptool", true);
    await h.service.togglePlugin(wb.config.id, "ghost", true);
    expect(h.service.enabledPlugins(wb.config.id)).toEqual(["esp32-esptool", "ghost"]);
    expect(parseConfig(await readFile(join(h.folder, ".vera/workbench.yaml"), "utf8")).plugins).toEqual({
      enabled: ["esp32-esptool", "ghost"],
    });
    const warnings = (await h.service.getConfig()).warnings;
    expect(warnings).toContainEqual({ code: "UNKNOWN_NAME", path: "plugins.enabled.ghost" });
    expect(warnings).not.toContainEqual({ code: "UNKNOWN_NAME", path: "plugins.enabled.esp32-esptool" });
    await h.service.togglePlugin(wb.config.id, "ghost", false);
    expect((await h.service.getConfig()).warnings).not.toContainEqual({
      code: "UNKNOWN_NAME",
      path: "plugins.enabled.ghost",
    });
    await expect(h.service.togglePlugin("wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", "x", true)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    await h.service.close();
    const b = await h.service.create(other, "Bench B");
    expect(b.config.plugins).toEqual({ enabled: [] });
    expect(h.service.enabledPlugins(b.config.id)).toEqual([]);
    await h.service.updateConfig({ plugins: { enabled: ["esp32-esptool"] } });
    expect(h.service.enabledPlugins(b.config.id)).toEqual(["esp32-esptool"]);
    await h.service.close();
    expect((await h.service.open(h.folder)).config.plugins).toEqual({ enabled: ["esp32-esptool"] });
  } finally {
    await h.service.close();
  }
});

// REQ-FUNC-6d88d2ec, REQ-FUNC-fa6222a5
it("loads the enabled, installed plugins and lists their skills", async () => {
  const h = await harness();
  const fixture = join(
    dirname(fileURLToPath(import.meta.url)),
    "../../../../../tests/fixtures/plugins/echo-tools",
  );
  await new PluginStore({ root: join(h.root, "plugins") }).install(fixture);
  try {
    const wb = await h.service.create(h.folder, "Bench A");
    expect(await h.service.loadPlugins(wb.config.id)).toEqual([]);
    expect((await h.service.listSkills(wb.config.id)).map((s) => s.name)).toEqual([]);
    await h.service.togglePlugin(wb.config.id, "ghost", true);
    await h.service.togglePlugin(wb.config.id, "echo-tools", true);
    expect((await h.service.loadPlugins(wb.config.id)).map((p) => p.manifest.id)).toEqual(["echo-tools"]);
    expect(await h.service.listSkills(wb.config.id)).toEqual([
      expect.objectContaining({ name: "echo-guide", source: "plugin", plugin: "echo-tools", enabled: true }),
    ]);
  } finally {
    await h.service.close();
  }
});
