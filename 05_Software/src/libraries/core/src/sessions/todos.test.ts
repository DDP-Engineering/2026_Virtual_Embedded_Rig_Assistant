// REQ-FUNC-2e8a54c7 REQ-DATA-d968385c
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SessionEvent } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import * as core from "../index.js";
import { ReplayGateway } from "../llm/replay.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});
async function setup(calls?: { name: string; args: Record<string, unknown> }[]) {
  const root = await mkdtemp(join(tmpdir(), "vera-todo-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "scripts"));
  await writeFile(
    join(root, "scripts/plan.jsonl"),
    calls
      ? [{ toolCalls: calls }, { text: "Done" }].map((x) => JSON.stringify(x)).join("\n")
      : await readFile(resolve("tests/fixtures/llm-scripts/plan-updates.jsonl"), "utf8"),
  );
  const handle = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  cleanup.push(async () => handle.close());
  const host: core.SessionHost = {
    root,
    db: handle.db,
    gateway: new ReplayGateway({ dir: join(root, "scripts"), now: () => Date.now() }),
    clock: { now: () => new Date(), sleep: async () => {} },
    model: () => "replay/plan",
    prompt: () => "Test",
  };
  const service = new core.SessionService(host);
  cleanup.push(() => service.close());
  await service.waitReady();
  return { root, handle, host, service };
}
const todo = (items: unknown) => ({ name: "todo", args: { items } });
it("registers a session todo and rejects count/text/status boundaries without replacing the valid list", async () => {
  const valid = Array.from({ length: 50 }, (_, i) => ({
    ...(i ? {} : { id: "first" }),
    text: "ă".repeat(200),
    status: ["pending", "in_progress", "done"][i % 3],
  }));
  const { service, handle } = await setup([
    todo(valid),
    todo([...valid, valid[0]]),
    todo([{ text: "ă".repeat(201), status: "done" }]),
    todo([{ text: "Invalid", status: "unknown" }]),
  ]);
  const s = service.create();
  service.send(s.id, "plan");
  await service.waitIdle(s.id);
  expect(new core.ToolRegistry().available().find((t) => t.name === "todo")?.class).toBe("session");
  expect(service.get(s.id).snapshot.todos).toEqual(valid);
  const calls = handle.db.prepare("SELECT status,result_json FROM tool_calls ORDER BY rowid").all() as {
    status: string;
    result_json: string;
  }[];
  expect(calls.map((x) => x.status)).toEqual(["ok", "error", "error", "error"]);
  expect(JSON.parse(calls[0]?.result_json ?? "{}").content[0].text).toContain('"items"');
  expect(calls[1]?.result_json).toMatch(/50/);
  expect(calls[2]?.result_json).toMatch(/200/);
  expect(calls[3]?.result_json).toMatch(/pending.*in_progress.*done/);
  for (const row of calls.slice(1)) expect(JSON.parse(row.result_json).isError).toBe(true);
  expect(handle.db.prepare("SELECT * FROM events WHERE type='todo.updated'").all()).toHaveLength(1);
});
it("atomically publishes each sequential replacement and restores the final list after service restart", async () => {
  const a = [
    { id: "a", text: "Inspect", status: "pending" as const },
    { text: "Verify", status: "pending" as const },
  ];
  const b = [
    { text: "Verify", status: "in_progress" as const },
    { id: "a", text: "Inspect", status: "done" as const },
  ];
  const c = [{ text: "Summary", status: "done" as const }];
  const { service, handle, host } = await setup([todo(a), todo(b), todo(c)]);
  const s = service.create(null, "read-only"),
    other = service.create();
  const seen: SessionEvent[] = [];
  const committed: unknown[] = [];
  service.subscribe(s.id, service.get(s.id).seq, (_seq, event) => {
    if (event.type !== "todo.updated") return;
    const row = handle.db.prepare("SELECT items_json,updated_at FROM todos WHERE session_id=?").get(s.id) as {
      items_json: string;
      updated_at: string;
    };
    committed.push({ items: JSON.parse(row.items_json), updatedAt: row.updated_at });
    seen.push(event);
  });
  service.send(s.id, "plan");
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
  expect(seen).toEqual([a, b, c].map((items) => ({ type: "todo.updated", items })));
  expect(committed).toEqual([a, b, c].map((items) => ({ items, updatedAt: expect.any(String) })));
  expect(service.get(other.id).snapshot.todos).toEqual([]);
  expect(handle.db.prepare("SELECT * FROM approvals").all()).toEqual([]);
  await service.close();
  const restarted = new core.SessionService(host);
  cleanup.push(() => restarted.close());
  await restarted.waitReady();
  expect(restarted.get(s.id).snapshot.todos).toEqual(c);
  await restarted.delete(s.id);
  expect(handle.db.prepare("SELECT * FROM todos").all()).toEqual([]);
});

it("validates registry and repository boundaries, clears, and rolls back failed event persistence", async () => {
  const { service, handle, root } = await setup([]);
  const s = service.create();
  const repository = new core.TodosRepository(handle.db);
  const ctx = core.createToolContext(root);
  let published = 0;
  ctx.todos = {
    db: handle.db,
    repository,
    sessionId: s.id,
    now: () => "2026-10-12T00:00:00.000Z",
    assertWritable: () => {},
    record: (event) => {
      handle.db
        .prepare("INSERT INTO events(session_id,seq,type,payload_json) VALUES (?,999,?,?)")
        .run(s.id, event.type, JSON.stringify(event));
      return () => {
        published++;
      };
    },
  };
  const registry = new core.ToolRegistry();
  const signal = new AbortController().signal;
  const old = [{ text: "Old", status: "pending" as const }];
  expect((await registry.execute(ctx, "todo", { items: old }, signal)).isError).toBe(false);
  const before = repository.get(s.id);
  // Duplicate event seq forces rollback after upsert, before publication.
  expect((await registry.execute(ctx, "todo", { items: [] }, signal)).isError).toBe(true);
  expect(repository.get(s.id)).toEqual(before);
  expect(published).toBe(1);
  for (const items of [
    Array.from({ length: 51 }, () => old[0]),
    [{ text: "a".repeat(201), status: "done" }],
    [{ text: "wrong", status: "unknown" }],
  ]) {
    const result = await registry.execute(ctx, "todo", { items }, signal);
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/Invalid arguments for todo/);
    expect(() => repository.replace(s.id, items as typeof old, "now")).toThrow();
    expect(repository.get(s.id)).toEqual(before);
  }
  handle.db.prepare("DELETE FROM events WHERE session_id=? AND seq=999").run(s.id);
  expect(JSON.parse((await registry.execute(ctx, "todo", { items: [] }, signal)).text)).toEqual({
    items: [],
  });
  expect(JSON.parse(repository.get(s.id)?.items_json ?? "null")).toEqual([]);
});

it("denies aborted and unowned mutation and scrubs user fields before storage/events", async () => {
  const { service, handle, root, host } = await setup([]);
  const s = service.create();
  const ctx = core.createToolContext(root),
    repository = new core.TodosRepository(handle.db);
  const records: SessionEvent[] = [];
  let owned = true;
  ctx.todos = {
    db: handle.db,
    repository,
    sessionId: s.id,
    now: () => "2026-10-12T00:00:00.000Z",
    assertWritable: () => {
      if (!owned) throw Error("Ownership lost");
    },
    record: (event) => () => records.push(event),
    scrub: (text) => text.replaceAll("secret", "[REDACTED]"),
  };
  const registry = new core.ToolRegistry(),
    abort = new AbortController();
  abort.abort();
  const items = [{ id: "secret", text: "secret", status: "done" }];
  expect((await registry.execute(ctx, "todo", { items }, abort.signal)).isError).toBe(true);
  owned = false;
  expect((await registry.execute(ctx, "todo", { items }, new AbortController().signal)).isError).toBe(true);
  expect(repository.get(s.id)).toBeUndefined();
  expect(records).toEqual([]);
  owned = true;
  expect((await registry.execute(ctx, "todo", { items }, new AbortController().signal)).isError).toBe(false);
  const scrubbed = [{ id: "[REDACTED]", text: "[REDACTED]", status: "done" }];
  expect(JSON.parse(repository.get(s.id)?.items_json ?? "null")).toEqual(scrubbed);
  expect(records).toEqual([{ type: "todo.updated", items: scrubbed }]);
  await service.close();
  const readOnly = new core.SessionService({ ...host, readOnly: true });
  cleanup.push(() => readOnly.close());
  expect(() => readOnly.send(s.id, "plan")).toThrow(expect.objectContaining({ code: "DENIED" }));
  expect(repository.get(s.id)).toBeDefined();
});

it("runs the Plan fixture and preserves existing automatic fixture routing", async () => {
  const { service } = await setup();
  const s = service.create();
  service.send(s.id, "Update the plan");
  await service.waitIdle(s.id);
  expect(service.get(s.id).snapshot.todos).toEqual([
    { id: "summary", text: "Board verification complete", status: "done" },
  ]);
  const gateway = new ReplayGateway({ dir: resolve("tests/fixtures/llm-scripts"), now: () => Date.now() });
  for (const [prompt, expected] of [
    ["Update the plan", "plan-updates"],
    ["Save summary", "save-artifact"],
    ["Pathological grep", "ui-grep-bad"],
    ["Normal grep", "ui-grep-good"],
  ]) {
    const events = [];
    for await (const event of gateway.stream({
      sessionId: "test",
      system: "test",
      model: "replay/auto",
      maxOutputTokens: 1000,
      tools: [],
      messages: [{ role: "user", content: prompt ?? "", timestamp: 1 }],
      signal: new AbortController().signal,
    }))
      events.push(event);
    expect(events.find((e) => e.type === "done")).toMatchObject({ message: { model: expected } });
  }
});
