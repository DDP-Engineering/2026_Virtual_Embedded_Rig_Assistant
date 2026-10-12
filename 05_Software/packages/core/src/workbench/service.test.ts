import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, beforeAll, expect, it } from "vitest";
import { createDocumentProcessor } from "../knowledge/processor.js";
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
  await mkdir(folder);
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
it("create/open roundtrip writes validating YAML/template/runtime and preserves existing content", async () => {
  const h = await harness();
  await writeFile(join(h.folder, "WORKBENCH.md"), "my pinned content");
  await writeFile(join(h.folder, "existing.txt"), "user data");
  const created = await h.service.create(h.folder, "Board");
  expect(created.config.id).toMatch(/^wb_[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
  expect(parseConfig(await readFile(join(h.folder, "workbench.yaml"), "utf8"))).toEqual(created.config);
  expect(await readFile(join(h.folder, "WORKBENCH.md"), "utf8")).toBe("my pinned content");
  expect(await readFile(join(h.folder, ".vera/.gitignore"), "utf8")).toBe("*\n");
  expect(existsSync(join(h.folder, "docs"))).toBe(true);
  expect(existsSync(join(h.folder, "skills"))).toBe(true);
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
    await writeFile(join(h.folder, ".veraignore"), `${path}\n`);
    expect(await h.service.searchDocuments(opened.config.id, "CURRENT_DOC_TOKEN123")).toEqual([]);
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
  expect(await readFile(join(h.folder, "WORKBENCH.md"), "utf8")).not.toBe("queued pinned");
  release();
  await Promise.all([first, pinned, config]);
  expect(h.service.getWriteQueue()).toBe(queue);
  expect(await readFile(join(h.folder, "WORKBENCH.md"), "utf8")).toBe("queued pinned");
  expect(parseConfig(await readFile(join(h.folder, "workbench.yaml"), "utf8")).name).toBe("Queued board");
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
  await mkdir(second);
  await writeFile(join(second, "workbench.yaml"), await readFile(join(h.folder, "workbench.yaml")));
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
it("newer database is refused before lock/recents changes and failed storage switch retains previous", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  const first = h.service.getDatabase();
  const second = join(h.root, "second");
  await mkdir(join(second, ".vera"), { recursive: true });
  await writeFile(join(second, "workbench.yaml"), await readFile(join(h.folder, "workbench.yaml")));
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
  await expect(h.service.open(second)).rejects.toMatchObject({ code: "WORKBENCH_TOO_NEW" });
  expect(await readFile(file)).toEqual(original);
  expect(await readFile(join(second, ".vera/lock"))).toEqual(lock);
  expect(await readFile(h.paths.settings)).toEqual(settings);
  expect(h.service.getDatabase()).toBe(first);
  await h.service.close();
});
it("failed database preparation releases the new token and retains the previous database", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  const first = h.service.getDatabase();
  const second = join(h.root, "second");
  await mkdir(join(second, ".vera/backups"), { recursive: true });
  await writeFile(join(second, "workbench.yaml"), await readFile(join(h.folder, "workbench.yaml")));
  await writeFile(join(second, ".vera/backups/vera.db.v0.bak"), "existing recovery data");
  await expect(h.service.open(second)).rejects.toMatchObject({ code: "CONFLICT" });
  expect(existsSync(join(second, ".vera/lock"))).toBe(false);
  expect(await readFile(join(second, ".vera/backups/vera.db.v0.bak"), "utf8")).toBe("existing recovery data");
  expect(h.service.getDatabase()).toBe(first);
  expect(first.open).toBe(true);
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
  await mkdir(second);
  await writeFile(join(second, "workbench.yaml"), await readFile(join(h.folder, "workbench.yaml")));
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
  expect(first.prepare("SELECT value FROM meta WHERE key='schema_version'").pluck().get()).toBe("3");
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
it("creates the specified English template and rejects malformed YAML with line and newer format before writes", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Test board");
  await h.service.close();
  expect(await readFile(join(h.folder, "WORKBENCH.md"), "utf8")).toContain(
    "## Device under test\nBoard, MCU, revision, key parts.",
  );
  await rm(join(h.folder, ".vera"), { recursive: true });
  const newer = "format: 2\nfuture: yes\n";
  await writeFile(join(h.folder, "workbench.yaml"), newer);
  await expect(h.service.open(h.folder)).rejects.toMatchObject({ code: "WORKBENCH_TOO_NEW" });
  expect(existsSync(join(h.folder, ".vera"))).toBe(false);
  expect(await readFile(join(h.folder, "workbench.yaml"), "utf8")).toBe(newer);
  await writeFile(join(h.folder, "workbench.yaml"), "format: 1\nname: [broken\n");
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
it("reassesses same-folder ownership and preserves recent extensions on reopen", async () => {
  const h = await harness();
  const writer = h.service;
  const first = await writer.create(h.folder, "Board");
  const reader = new WorkbenchService(h.host);
  expect((await reader.open(h.folder)).readOnly).toBe(true);
  const entry = h.settings.get().settings.recentWorkbenches[0];
  if (!entry) throw new Error("Created workbench must be remembered");
  await h.settings.update({
    recentWorkbenches: [{ ...entry, vendor: { flag: true } }],
  });
  await writer.close();
  expect((await reader.open(h.folder)).readOnly).toBe(false);
  expect(h.settings.get().settings.recentWorkbenches[0]?.vendor).toEqual({ flag: true });
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
  await writeFile(join(h.folder, ".veraignore"), "!.GIT/\n!NODE_MODULES/\n");
  expect(await h.service.files("secret")).toEqual([]);
  await h.service.close();
});
it("rejects YAML tagged non-JSON extensions without bytes or runtime changes", async () => {
  const h = await harness();
  const header = "format: 1\nid: wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C\nname: Board\n";
  for (const value of ["!!set {x: null}", "!!omap [{x: 1}]", "!!binary aGVsbG8="]) {
    const raw = `${header}vendor: ${value}\n`;
    await writeFile(join(h.folder, "workbench.yaml"), raw);
    await expect(h.service.open(h.folder)).rejects.toMatchObject({ code: "INVALID" });
    expect(await readFile(join(h.folder, "workbench.yaml"), "utf8")).toBe(raw);
    expect(existsSync(join(h.folder, ".vera"))).toBe(false);
  }
});
it("updates config preserving unknown nested keys/id and emits confirmed change; pinned full content warns", async () => {
  const h = await harness();
  const original = await h.service.create(h.folder, "Board");
  const path = join(h.folder, "workbench.yaml");
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
  const long = "ă".repeat(9000);
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
  const raw = await readFile(join(h.folder, "workbench.yaml"), "utf8");
  h.host.files.writeAtomic = async () => {
    throw new Error("I/O error");
  };
  await expect(h.service.updateConfig({ name: "Failed" })).rejects.toThrow("I/O error");
  expect(await readFile(join(h.folder, "workbench.yaml"), "utf8")).toBe(raw);
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
  await writeFile(join(h.folder, ".veraignore"), "*.log\n!keep.log\n!.vera/lock\n");
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
  await symlink(outside, join(h.folder, ".vera"), process.platform === "win32" ? "junction" : "dir");
  await expect(h.service.create(h.folder, "Board")).rejects.toMatchObject({ code: "DENIED" });
  expect(existsSync(join(h.folder, "workbench.yaml"))).toBe(false);
});
it("persists ten unique recents, derives missing folder and removes entry across restarts", async () => {
  const h = await harness();
  for (let n = 0; n < 11; n++) {
    const folder = join(h.root, `bench${n}`);
    await mkdir(folder);
    await h.service.create(folder, `Board${n}`);
  }
  let entries = await h.service.recent();
  expect(entries).toHaveLength(10);
  expect(entries[0]?.name).toBe("Board10");
  expect(entries.some((e) => e.name === "Board0")).toBe(false);
  await h.service.open(join(h.root, "bench5"));
  await h.service.close();
  entries = await h.service.recent();
  expect(entries[0]?.name).toBe("Board5");
  expect(entries).toHaveLength(10);
  await rm(join(h.root, "bench5"), { recursive: true });
  const settings = new SettingsService({
    files: h.host.files,
    paths: h.paths,
    uuid: randomUUID,
    changed: () => {},
  });
  await settings.load();
  const service = new WorkbenchService({ ...h.host, settings });
  expect((await service.recent())[0]).toMatchObject({ name: "Board5", missing: true });
  expect(await service.recent(join(h.root, "bench5"))).toHaveLength(9);
  expect(settings.get().settings.recentWorkbenches.every((e) => e.name !== "Board5")).toBe(true);
});
it("failed recent save releases replacement lock and retains previous; future settings suppress recents", async () => {
  const h = await harness();
  const first = await h.service.create(h.folder, "First");
  const second = join(h.root, "second");
  await mkdir(second);
  const copy = await readFile(join(h.folder, "workbench.yaml"), "utf8");
  await writeFile(join(second, "workbench.yaml"), copy.replace("name: First", "name: Second"));
  const atomic = h.host.files.writeAtomic;
  h.host.files.writeAtomic = async () => {
    throw new Error("disk failed");
  };
  await expect(h.service.open(second)).rejects.toThrow("disk failed");
  expect(existsSync(join(second, ".vera/lock"))).toBe(false);
  expect((await h.service.getConfig()).config).toEqual(first.config);
  h.host.files.writeAtomic = atomic;
  await h.service.close();
  const future = '{"schemaVersion":99,"future":true}';
  await writeFile(h.paths.settings, future);
  const settings = new SettingsService({
    files: h.host.files,
    paths: h.paths,
    uuid: randomUUID,
    changed: () => {},
  });
  await settings.load();
  const service = new WorkbenchService({ ...h.host, settings });
  expect((await service.open(h.folder)).readOnly).toBe(false);
  expect(await service.recent()).toEqual([]);
  await expect(service.recent(h.folder)).rejects.toMatchObject({ code: "DENIED" });
  await service.close();
  expect(await readFile(h.paths.settings, "utf8")).toBe(future);
});
it("refuses external format/identity changes during pinned saves and closing redirected runtime", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  const yaml = join(h.folder, "workbench.yaml");
  const raw = await readFile(yaml, "utf8");
  await writeFile(yaml, raw.replace("format: 1", "format: 2"));
  await expect(h.service.updatePinned("bad")).rejects.toMatchObject({ code: "WORKBENCH_TOO_NEW" });
  await writeFile(yaml, raw);
  const before = await readFile(join(h.folder, "WORKBENCH.md"), "utf8");
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
  expect(await readFile(join(h.folder, "WORKBENCH.md"), "utf8")).toBe(before);
});
it("rejects non-JSON/circular YAML extensions before runtime or save", async () => {
  const h = await harness();
  await h.service.create(h.folder, "Board");
  await h.service.close();
  const path = join(h.folder, "workbench.yaml");
  const raw = await readFile(path, "utf8");
  await rm(join(h.folder, ".vera"), { recursive: true });
  for (const extension of ["vendor: .inf\n", "vendor: &loop [*loop]\n"]) {
    const text = raw + extension;
    await writeFile(path, text);
    await expect(h.service.open(h.folder)).rejects.toMatchObject({ code: "INVALID" });
    expect(await readFile(path, "utf8")).toBe(text);
    expect(existsSync(join(h.folder, ".vera"))).toBe(false);
  }
});
