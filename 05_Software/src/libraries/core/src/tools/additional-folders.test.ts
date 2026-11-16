import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import * as api from "../index.js";
import { workerFixture } from "../workers/worker.test-support.js";

let base: string;
let root: string;
let sibling: string;
let folders: string[];
let storage: api.WorkbenchDatabase;
let pool: api.NodeWorkerPool;
let bundle: ReturnType<typeof workerFixture>;
const signal = () => new AbortController().signal;
beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "vera-folder-tools-"));
  root = join(base, "bench");
  sibling = join(base, "sibling");
  folders = [sibling];
  await mkdir(join(root, ".vera"), { recursive: true });
  await mkdir(sibling);
  await writeFile(join(sibling, "notes.txt"), "sibling content\n");
  storage = await api.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  new api.SessionsRepository(storage.db).create({
    id: "ses_test",
    title: "",
    created_at: "now",
    updated_at: "now",
    model_ref: null,
    permission_mode: "ask",
    status: "idle",
    archived: 0,
  });
  bundle = workerFixture();
  pool = new api.NodeWorkerPool(bundle.url, { deadlineMs: 5000, capacity: 1 });
});
afterEach(async () => {
  await pool?.dispose();
  bundle?.close();
  storage?.close();
  await rm(base, { recursive: true, force: true });
});
function context(): api.ToolContext {
  return {
    ...api.createToolContext(root, pool),
    additionalFolders: () => folders,
    permissionMode: () => "ask",
    change: {
      db: storage.db,
      queue: new api.WriteQueue(),
      sessionId: "ses_test",
      turnId: "turn",
      callId: "call",
      now: () => "now",
      recorded: () => undefined,
    },
  };
}
// REQ-SEC-f0170302, REQ-SEC-f0170303, REQ-SEC-f0170304
it("reads lists globs greps and edits a sibling with absolute provenance and workbench-owned records", async () => {
  const ctx = context();
  const path = join(sibling, "notes.txt");
  const canonical = path.replaceAll("\\", "/");
  expect(await api.readTool.execute(ctx, { path }, signal())).toMatchObject({
    text: "1: sibling content",
    path: canonical,
  });
  expect(await api.readTool.execute(ctx, { path }, signal())).not.toHaveProperty("ref");
  expect(await api.listTool.execute(ctx, { path: sibling }, signal())).toMatchObject({
    entries: [{ name: canonical, type: "file" }],
  });
  expect(await api.globTool.execute(ctx, { path: sibling, pattern: "*.txt" }, signal())).toMatchObject({
    paths: [canonical],
  });
  expect(await api.grepTool.execute(ctx, { path: sibling, pattern: "sibling" }, signal())).toMatchObject({
    matches: [{ path: canonical, text: "sibling content" }],
  });
  const grep = await api.grepTool.execute(ctx, { path: sibling, pattern: "sibling" }, signal());
  expect((grep.matches as object[])[0]).not.toHaveProperty("ref");
  const edit = await api.editTool.prepare?.(
    ctx,
    { path, oldString: "sibling", newString: "changed" },
    signal(),
  );
  expect(edit?.request).toMatchObject({ path: canonical, protected: false });
  await edit?.apply(signal());
  expect(await readFile(path, "utf8")).toBe("changed content\n");
  const pending = await api.writeTool.prepare?.(
    ctx,
    { path: join(sibling, "new/deep.txt"), content: "no" },
    signal(),
  );
  folders = [];
  await expect(pending?.apply(signal())).rejects.toThrow();
  await expect(api.readTool.execute(ctx, { path }, signal())).rejects.toThrow();
  await expect(api.readTool.execute(ctx, { path: join(base, "unlisted.txt") }, signal())).rejects.toThrow();
  expect(storage.db.prepare("SELECT path FROM changes").all()).toEqual([{ path: canonical }]);
});
it("discards worker results if current folder authority changes during asynchronous work", async () => {
  const ctx = context();
  ctx.workers = {
    run: async () => {
      folders = [];
      return { matches: [{ path: join(sibling, "notes.txt"), line: 1, text: "private" }], truncated: false };
    },
    dispose: async () => {},
  };
  await expect(api.grepTool.execute(ctx, { path: sibling, pattern: "private" }, signal())).rejects.toThrow(
    /revoked/,
  );
});
it("refuses protected aliases and missing descendants in every mode despite folder grants", async () => {
  const data = join(sibling, "data");
  await mkdir(data);
  await writeFile(join(data, "secret.txt"), "private");
  await symlink(data, join(sibling, "alias"), process.platform === "win32" ? "junction" : "dir");
  const ctx = context();
  ctx.managedRoots = [data];
  for (const mode of ["read-only", "ask", "auto-edit", "bypass"] as const) {
    ctx.permissionMode = () => mode;
    for (const path of [
      join(data, "secret.txt"),
      join(sibling, "alias/secret.txt"),
      join(sibling, "alias/missing/new.txt"),
    ]) {
      await expect(api.readTool.execute(ctx, { path }, signal())).rejects.toThrow(/application data/);
      await expect(api.writeTool.prepare?.(ctx, { path, content: "no" }, signal())).rejects.toThrow(
        /application data/,
      );
    }
  }
  expect(await readFile(join(data, "secret.txt"), "utf8")).toBe("private");
});

it("rechecks removal after asynchronous final write validation before any target rename", async () => {
  const ctx = context();
  const path = join(sibling, "new.txt");
  const pending = await api.writeTool.prepare?.(ctx, { path, content: "no" }, signal());
  const queue = ctx.change?.queue;
  if (!queue || !pending) throw Error("Missing prepared change");
  const { PathGuard } = await import("../workbench/path-guard.js");
  const original = PathGuard.prototype.resolve;
  let resolutions = 0;
  const { vi } = await import("vitest");
  const spy = vi.spyOn(PathGuard.prototype, "resolve").mockImplementation(async function (
    this: api.PathGuard,
    value: string,
  ) {
    const result = await original.call(this, value);
    if (++resolutions === 3) folders = [];
    return result;
  });
  try {
    await expect(pending.apply(signal())).rejects.toThrow(/revoked/);
  } finally {
    spy.mockRestore();
  }
  await expect(readFile(path)).rejects.toMatchObject({ code: "ENOENT" });
});

it("keeps worker scope captured before an Ask to Bypass to Ask transition", async () => {
  const ctx = context();
  let mode: "ask" | "bypass" = "ask";
  ctx.permissionMode = () => mode;
  const unlisted = join(base, "unlisted");
  await mkdir(unlisted);
  await writeFile(join(unlisted, "notes.txt"), "unlisted private");
  let dispatchedScope: string | undefined;
  ctx.workers = {
    run: async (task, lifetime) => {
      dispatchedScope = task.scope;
      mode = "ask";
      return pool.run(task, lifetime);
    },
    dispose: async () => {},
  };
  const original = api.PathGuard.create.bind(api.PathGuard);
  const spy = vi.spyOn(api.PathGuard, "create").mockImplementationOnce(async (...args) => {
    const guard = await original(...args);
    mode = "bypass";
    return guard;
  });
  try {
    await expect(
      api.grepTool.execute(ctx, { path: unlisted, pattern: "private" }, signal()),
    ).rejects.toThrow();
    expect(dispatchedScope).toBeUndefined();
  } finally {
    spy.mockRestore();
  }
});
it("refuses an admitted additional root retargeted before the actual worker starts", async () => {
  const ctx = context();
  const unlisted = join(base, "unlisted");
  await mkdir(unlisted);
  await writeFile(join(unlisted, "notes.txt"), "unlisted private");
  ctx.workers = {
    run: async (task, lifetime) => {
      await rename(sibling, join(base, "original-sibling"));
      await symlink(unlisted, sibling, process.platform === "win32" ? "junction" : "dir");
      return pool.run(task, lifetime);
    },
    dispose: async () => {},
  };
  await expect(api.grepTool.execute(ctx, { path: sibling, pattern: "private" }, signal())).rejects.toThrow();
});
it("reports the absolute identity actually read when an in-grant alias changes before opening", async () => {
  const ctx = context();
  const a = join(sibling, "a");
  const b = join(sibling, "b");
  const alias = join(sibling, "source");
  await mkdir(a);
  await mkdir(b);
  await writeFile(join(a, "notes.txt"), "first");
  await writeFile(join(b, "notes.txt"), "second");
  await symlink(a, alias, process.platform === "win32" ? "junction" : "dir");
  const original = api.PathGuard.prototype.resolve;
  let first = true;
  const spy = vi.spyOn(api.PathGuard.prototype, "resolve").mockImplementation(async function (
    this: api.PathGuard,
    path: string,
  ) {
    const target = await original.call(this, path);
    if (first) {
      first = false;
      await rename(alias, join(sibling, "old-source"));
      await symlink(b, alias, process.platform === "win32" ? "junction" : "dir");
    }
    return target;
  });
  try {
    expect(await api.readTool.execute(ctx, { path: join(alias, "notes.txt") }, signal())).toMatchObject({
      text: "1: second",
      path: join(b, "notes.txt").replaceAll("\\", "/"),
    });
  } finally {
    spy.mockRestore();
  }
});
