// REQ-FUNC-a7ad5920
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PermissionMode } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import {
  createToolContext,
  openDb,
  recoverChanges,
  SessionService,
  SessionsRepository,
  ToolRegistry,
  WriteQueue,
} from "../index.js";
import { ReplayGateway } from "../llm/replay.js";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function files() {
  const root = await mkdtemp(join(tmpdir(), "vera-bypass-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const bench = join(root, "bench"),
    outside = join(root, "outside");
  await mkdir(join(bench, ".vera"), { recursive: true });
  await mkdir(outside);
  await writeFile(join(outside, "notes.txt"), "old external text\n");
  await writeFile(join(bench, ".vera/private.txt"), "old metadata\n");
  return { root, bench, outside };
}

it("Bypass reads and writes outside the workbench without manual approval and persists its mode", async () => {
  const { root, bench, outside } = await files();
  const scripts = join(root, "scripts");
  await mkdir(scripts);
  const path = join(outside, "notes.txt");
  await writeFile(
    join(scripts, "access.jsonl"),
    [
      { match: "change", toolCalls: [{ name: "read", args: { path } }] },
      { toolCalls: [{ name: "edit", args: { path, oldString: "old", newString: "new" } }] },
      { toolCalls: [{ name: "write", args: { path: join(outside, "created.txt"), content: "created" } }] },
      { toolCalls: [{ name: "write", args: { path: ".vera/created.txt", content: "metadata" } }] },
      { text: "Done" },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  const handle = await openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  cleanup.push(async () => handle.close());
  const gateway = new ReplayGateway({ dir: scripts, now: () => Date.now() });
  await gateway.models("replay", new AbortController().signal);
  const host = {
    root: bench,
    db: handle.db,
    gateway,
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/access",
    prompt: () => "Test",
  };
  let service = new SessionService(host);
  cleanup.push(() => service.close());
  await service.waitReady();
  const session = service.create(null, "bypass" as PermissionMode);
  service.send(session.id, "change");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  expect(await readFile(path, "utf8")).toBe("new external text\n");
  expect(await readFile(join(outside, "created.txt"), "utf8")).toBe("created");
  expect(await readFile(join(bench, ".vera/created.txt"), "utf8")).toBe("metadata");
  const approvals = handle.db.prepare("SELECT decision,decided_by,consumed_at FROM approvals").all();
  expect(approvals).toHaveLength(3);
  for (const approval of approvals)
    expect(approval).toMatchObject({
      decision: "approved",
      decided_by: "mode",
      consumed_at: expect.any(String),
    });
  await service.close();
  service = new SessionService(host);
  await service.waitReady();
  expect(service.get(session.id).snapshot.mode).toBe("bypass");
});

it("full scope covers read/list/glob and ignored files; other modes keep confinement", async () => {
  const { bench, outside } = await files();
  let mode = "bypass" as PermissionMode;
  const ctx = Object.assign(createToolContext(bench), { permissionMode: () => mode });
  const registry = new ToolRegistry();
  const signal = new AbortController().signal;
  const read = await registry.execute(ctx, "read", { path: join(outside, "notes.txt") }, signal);
  expect(read.isError).toBe(false);
  expect(JSON.parse(read.text)).toMatchObject({ text: "1: old external text" });
  expect(JSON.parse(read.text).ref).toBeUndefined();
  expect((await registry.execute(ctx, "list", { path: outside }, signal)).text).toContain("notes.txt");
  expect(
    (await registry.execute(ctx, "glob", { path: outside, pattern: "**/*.txt" }, signal)).text,
  ).toContain("notes.txt");
  expect((await registry.execute(ctx, "read", { path: ".vera/private.txt" }, signal)).isError).toBe(false);
  for (const confined of ["ask", "auto-edit", "read-only"] as const) {
    mode = confined;
    expect((await registry.execute(ctx, "read", { path: join(outside, "notes.txt") }, signal)).isError).toBe(
      true,
    );
    expect((await registry.execute(ctx, "read", { path: ".vera/private.txt" }, signal)).isError).toBe(true);
  }
});

it("revoking Bypass aborts an in-flight grep and prevents a queued external write", async () => {
  const { bench, outside } = await files();
  let mode = "bypass" as PermissionMode;
  const scope = new AbortController();
  let started = false;
  const ctx = Object.assign(createToolContext(bench), {
    permissionMode: () => mode,
    bypassSignal: () => scope.signal,
    workers: {
      run: async (task: { scope?: "filesystem" }, signal: AbortSignal) => {
        expect(task.scope).toBe("filesystem");
        started = true;
        return new Promise<{ matches: []; truncated: boolean; reason: "aborted" }>((done) =>
          signal.addEventListener("abort", () => done({ matches: [], truncated: true, reason: "aborted" }), {
            once: true,
          }),
        );
      },
      dispose: async () => {},
    },
  });
  const registry = new ToolRegistry();
  const result = registry.execute(
    ctx,
    "grep",
    { path: outside, pattern: "old" },
    new AbortController().signal,
  );
  await expect.poll(() => started).toBe(true);
  mode = "ask";
  scope.abort();
  expect((await result).isError).toBe(true);

  const handle = await openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  cleanup.push(async () => handle.close());
  new SessionsRepository(handle.db).create({
    id: "ses_test",
    title: "",
    created_at: "now",
    updated_at: "now",
    model_ref: null,
    permission_mode: "bypass",
    status: "idle",
    archived: 0,
  });
  mode = "bypass";
  const queue = new WriteQueue();
  const writeCtx = Object.assign(createToolContext(bench), {
    permissionMode: () => mode,
    change: {
      db: handle.db,
      queue,
      sessionId: "ses_test",
      turnId: "turn",
      callId: "call",
      now: () => "now",
      recorded: () => undefined,
    },
  });
  const path = join(outside, "notes.txt");
  await registry.execute(writeCtx, "read", { path }, new AbortController().signal);
  const prepared = await registry.prepare(
    writeCtx,
    "edit",
    { path, oldString: "old", newString: "new" },
    new AbortController().signal,
  );
  let release!: () => void;
  const blocked = queue.run(
    () =>
      new Promise<void>((done) => {
        release = done;
      }),
  );
  await expect.poll(() => typeof release).toBe("function");
  const apply = prepared.apply(new AbortController().signal);
  mode = "ask";
  release();
  await blocked;
  await expect(apply).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("old external text\n");
});

it("hash-only recovery reconciles a recorded absolute change without rewriting the external file", async () => {
  const { bench, outside } = await files();
  const handle = await openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  cleanup.push(async () => handle.close());
  new SessionsRepository(handle.db).create({
    id: "ses_test",
    title: "",
    created_at: "now",
    updated_at: "now",
    model_ref: null,
    permission_mode: "bypass",
    status: "idle",
    archived: 0,
  });
  const ctx = Object.assign(createToolContext(bench), {
    permissionMode: () => "bypass" as PermissionMode,
    change: {
      db: handle.db,
      queue: new WriteQueue(),
      sessionId: "ses_test",
      turnId: "turn",
      callId: "call",
      now: () => "now",
      recorded: () => undefined,
    },
  });
  const registry = new ToolRegistry();
  const path = join(outside, "notes.txt"),
    signal = new AbortController().signal;
  await registry.execute(ctx, "read", { path }, signal);
  const change = await registry.prepare(ctx, "edit", { path, oldString: "old", newString: "new" }, signal);
  await change.apply(signal);
  handle.db.prepare("UPDATE changes SET status='pending'").run();
  await recoverChanges(bench, handle.db, signal);
  expect(handle.db.prepare("SELECT status FROM changes").get()).toEqual({ status: "applied" });
  expect(await readFile(path, "utf8")).toBe("new external text\n");
});

it("a live session downgrade cancels its in-flight full-scope worker", async () => {
  const { root, bench, outside } = await files();
  const scripts = join(root, "scripts");
  await mkdir(scripts);
  await writeFile(
    join(scripts, "search.jsonl"),
    [
      { match: "search", toolCalls: [{ name: "grep", args: { path: outside, pattern: "old" } }] },
      { text: "Stopped external search" },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  const handle = await openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  cleanup.push(async () => handle.close());
  const gateway = new ReplayGateway({ dir: scripts, now: () => Date.now() });
  await gateway.models("replay", new AbortController().signal);
  let workerSignal: AbortSignal | undefined;
  const service = new SessionService({
    root: bench,
    db: handle.db,
    gateway,
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/search",
    prompt: () => "Test",
    workers: {
      run: async (task, signal) => {
        expect(task.scope).toBe("filesystem");
        workerSignal = signal;
        return new Promise((done) =>
          signal.addEventListener("abort", () => done({ matches: [], truncated: true, reason: "aborted" }), {
            once: true,
          }),
        );
      },
      dispose: async () => {},
    },
  });
  cleanup.push(() => service.close());
  await service.waitReady();
  const session = service.create(null, "bypass");
  service.send(session.id, "search");
  await expect.poll(() => !!workerSignal).toBe(true);
  service.setMode(session.id, "ask");
  await service.waitIdle(session.id);
  expect(workerSignal?.aborted).toBe(true);
  expect(service.get(session.id).snapshot.mode).toBe("ask");
  expect(service.get(session.id).snapshot.items.filter((item) => item.kind === "tool")).toMatchObject([
    { status: "error" },
  ]);
});
