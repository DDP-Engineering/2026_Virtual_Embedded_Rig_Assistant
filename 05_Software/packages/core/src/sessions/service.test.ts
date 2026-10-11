import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { Message } from "@earendil-works/pi-ai";
import { applySessionEvent, emptySessionState, type SessionEvent } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import * as citations from "../agent/citations.js";
import * as core from "../index.js";
import { ReplayGateway } from "../llm/replay.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const close of cleanup.splice(0).reverse()) await close();
});

it("persists user/start before dispatch and assistant/tool-start before execution, even with held citations", async () => {
  let release: () => void = () => {};
  let held = false;
  const check = vi.spyOn(citations, "validateCitations").mockImplementationOnce(async () => {
    held = true;
    await new Promise<void>((resolve) => {
      release = resolve;
    });
    return [];
  });
  const executed = vi.fn();
  const registry = new core.ToolRegistry([
    {
      name: "list",
      class: "read",
      description: "List",
      params: z.strictObject({}),
      execute: async () => {
        executed(
          (handle.db.prepare("SELECT status FROM tool_calls").get() as { status: string })?.status ===
            "pending",
          new core.MessagesRepository(handle.db).list(s.id).filter((r) => r.role === "assistant").length ===
            1,
        );
        return { text: "board.txt" };
      },
    },
  ]);
  const { service, gateway, handle } = await setup({ registry });
  const original = gateway.stream.bind(gateway);
  const observations: boolean[] = [];
  gateway.stream = (request) => {
    const rows = new core.MessagesRepository(handle.db).list(s.id);
    observations.push(
      rows.length > 0 &&
        service.list()[0]?.status === "running" &&
        service.get(s.id).snapshot.activeTurnId !== null,
    );
    if (request.messages.some((m) => m.role === "toolResult"))
      observations.push(rows.some((r) => r.role === "toolResult"));
    return original(request);
  };
  const s = service.create();
  service.send(s.id, "Read");
  await expect.poll(() => held).toBe(true);
  const beforeRelease = executed.mock.calls.length;
  release();
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
  expect(beforeRelease).toBe(0);
  expect(observations.length).toBeGreaterThan(0);
  expect(observations.every(Boolean)).toBe(true);
  expect(executed).toHaveBeenCalledExactlyOnceWith(true, true);
  check.mockRestore();
});

it("never dispatches a provider when initial persistence fails", async () => {
  const { service, gateway, handle } = await setup();
  const dispatch = vi.spyOn(gateway, "stream");
  const s = service.create();
  handle.db.exec(
    "CREATE TRIGGER fail_user BEFORE INSERT ON messages WHEN NEW.role='user' BEGIN SELECT RAISE(FAIL,'write failed'); END",
  );
  service.send(s.id, "Read");
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "error" });
  expect(dispatch).not.toHaveBeenCalled();
});

it("serializes nested publication for every subscriber and prevents replay duplicates for late listeners", async () => {
  const { service } = await setup();
  const s = service.create();
  const first: number[] = [];
  const second: number[] = [];
  const late: number[] = [];
  service.subscribe(s.id, 1, (seq, event) => {
    if (seq !== undefined) first.push(seq);
    if (event.type === "session.updated" && event.title === "outer") {
      service.rename(s.id, "inner");
      service.subscribe(s.id, 0, (seq) => {
        if (seq !== undefined) late.push(seq);
      });
    }
  });
  service.subscribe(s.id, 1, (seq) => {
    if (seq !== undefined) second.push(seq);
  });
  service.rename(s.id, "outer");
  expect(first).toEqual([2, 3]);
  expect(second).toEqual([2, 3]);
  expect(late).toEqual([1, 2, 3]);
});

it("drains replay reentrant emissions in sequence before later nested emissions", async () => {
  const { service } = await setup();
  const s = service.create();
  service.rename(s.id, "seed");
  const seqs: number[] = [];
  service.subscribe(s.id, 0, (seq, event) => {
    if (seq !== undefined) seqs.push(seq);
    if (event.type === "session.updated" && event.title === "") {
      service.rename(s.id, "one");
      service.rename(s.id, "two");
    }
    if (event.type === "session.updated" && event.title === "one") service.rename(s.id, "three");
  });
  expect(seqs).toEqual([1, 2, 3, 4, 5]);
});
async function setup(extra: Partial<core.SessionHost> = {}) {
  expect(typeof core.SessionService, "durable session engine exists").toBe("function");
  const root = await mkdtemp(join(tmpdir(), "vera-sessions-"));
  await mkdir(join(root, ".vera"));
  await writeFile(join(root, "board.txt"), "Board uses 3.3 V.\nSecond source line.\n");
  const handle = await core.openDb(join(root, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
  const gateway = new ReplayGateway({ dir: resolve("fixtures/llm-scripts"), now: () => 123 });
  const host: core.SessionHost = {
    db: handle.db,
    root,
    gateway,
    clock: { now: () => new Date(123), sleep: async () => {} },
    model: () => "replay/read-then-answer",
    prompt: () => "Ground claims in tool refs.",
    ...extra,
  };
  const service = new core.SessionService(host);
  cleanup.push(async () => {
    await service.close();
    handle.close();
    await rm(root, { recursive: true, force: true });
  });
  return { root, handle, host, service, gateway };
}
it("read-then-answer persists two tool pairs, valid citation and same live/durable snapshot then resumes", async () => {
  const { service, handle, host } = await setup();
  const session = service.create();
  const live: SessionEvent[] = [];
  const off = service.subscribe(session.id, 0, (_seq, event) => live.push(event));
  service.send(session.id, "Read the board");
  expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
  expect(live[1]).toMatchObject({ type: "message.user" });
  expect(live.filter((e) => e.type === "tool.started")).toHaveLength(2);
  expect(live.filter((e) => e.type === "tool.done")).toHaveLength(2);
  expect(live.filter((e) => e.type === "message.done").at(-1)).toMatchObject({
    citations: [{ ref: "board.txt#L1-L2", valid: true }],
  });
  const stored = new core.EventsRepository(handle.db).list(session.id);
  expect(stored.some((e) => ["message.delta", "reasoning.delta", "tool.update"].includes(e.type ?? ""))).toBe(
    false,
  );
  expect(live.some((e) => e.type === "message.delta")).toBe(true);
  expect(stored.map((e) => e.seq)).toEqual(stored.map((_e, i) => i + 1));
  expect(live.reduce(applySessionEvent, emptySessionState())).toEqual(service.get(session.id).snapshot);
  expect(
    handle.db.prepare("SELECT count(*) AS n FROM tool_calls WHERE session_id=?").get(session.id),
  ).toEqual({ n: 2 });
  const before = service.get(session.id);
  off();
  await service.close();
  const restarted = new core.SessionService(host);
  expect(restarted.get(session.id)).toEqual(before);
  restarted.send(session.id, "Continue reading");
  expect(await restarted.waitIdle(session.id)).toEqual({ stopReason: "end" });
  expect(restarted.get(session.id).snapshot.items.filter((i) => i.kind === "user")).toHaveLength(2);
  await restarted.close();
});
it("BUSY protects active turns and stop emits one aborted completion", async () => {
  let release: (() => void) | undefined;
  const { service, gateway } = await setup();
  const stream = gateway.stream.bind(gateway);
  gateway.stream = async function* (request) {
    await new Promise<void>((resolve) => {
      release = resolve;
      request.signal.addEventListener("abort", () => resolve(), { once: true });
    });
    yield* stream(request);
  };
  const s = service.create();
  service.send(s.id, "Read");
  expect(() => service.send(s.id, "Second")).toThrow(expect.objectContaining({ code: "BUSY" }));
  service.stop(s.id);
  release?.();
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "aborted" });
  expect(service.get(s.id).snapshot.turns).toHaveLength(1);
});
it("configured tool-call cap ends limit with valid retained call/result pairs", async () => {
  const { service, handle } = await setup({ maxToolCallsPerTurn: 1 });
  const s = service.create();
  service.send(s.id, "Read");
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "limit" });
  const messages = new core.MessagesRepository(handle.db)
    .list(s.id)
    .map((r) => JSON.parse(r.content_json) as Message);
  const calls = messages.flatMap((m) =>
    m.role === "assistant" ? m.content.filter((c) => c.type === "toolCall") : [],
  );
  expect(calls).toHaveLength(1);
  expect(messages.filter((m) => m.role === "toolResult")).toHaveLength(1);
});
it("long mandatory first instruction makes no provider call; model switch recalculates budget", async () => {
  const { service, gateway, handle } = await setup();
  let calls = 0;
  const original = gateway.stream.bind(gateway);
  gateway.stream = (request) => {
    calls++;
    return original(request);
  };
  const s = service.create();
  service.send(s.id, "x".repeat(40000));
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "limit" });
  expect(calls).toBe(0);
  expect(new core.MessagesRepository(handle.db).list(s.id)[0]?.content_json).toContain("x".repeat(40000));
  gateway.capabilities = () => ({
    contextWindow: 100000,
    maxOutputTokens: 100,
    safetyMargin: 5000,
    inputBudget: 94900,
    supportsTools: true,
  });
  service.setModel(s.id, "replay/read-then-answer");
  service.send(s.id, "Read");
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
  expect(service.get(s.id).snapshot.usage).toMatchObject({ contextWindow: 100000, inputBudgetTokens: 94900 });
});
it("CRUD keeps renamed title, deletes artifact folder and all rows; read-only denies writes", async () => {
  const { service, root, handle, host } = await setup();
  const s = service.create();
  service.rename(s.id, "Named");
  service.setMode(s.id, "read-only");
  service.send(s.id, "x".repeat(61));
  await service.waitIdle(s.id);
  expect(service.list()[0]).toMatchObject({ title: "Named", mode: "read-only" });
  await mkdir(join(root, ".vera/artifacts", s.id), { recursive: true });
  await writeFile(join(root, ".vera/artifacts", s.id, "a.txt"), "keep");
  await service.delete(s.id);
  expect(service.list()).toEqual([]);
  expect(new core.MessagesRepository(handle.db).list(s.id)).toEqual([]);
  const ro = new core.SessionService({ ...host, readOnly: true });
  expect(() => ro.create()).toThrow(expect.objectContaining({ code: "DENIED" }));
});
it("replay precedes reentrant live emission and callbacks cannot mutate persisted state", async () => {
  const { service } = await setup();
  const s = service.create();
  service.rename(s.id, "Before");
  const titles: string[] = [];
  const off = service.subscribe(s.id, 0, (_seq, e) => {
    if (e.type === "session.updated" && e.title !== undefined) {
      titles.push(e.title);
      if (e.title === "") service.rename(s.id, "After");
      e.title = "mutated";
    }
  });
  expect(titles).toEqual(["", "Before", "After"]);
  expect(service.get(s.id).snapshot.title).toBe("After");
  off();
});
it("recovery closes both active statuses and repairs unanswered calls idempotently without rewriting originals", async () => {
  const { service, host, handle } = await setup();
  const sessions = [service.create(), service.create()];
  const message: Message = {
    role: "assistant",
    api: "replay",
    provider: "replay",
    model: "read-then-answer",
    content: [{ type: "toolCall", id: "unanswered", name: "read", arguments: { path: "board.txt" } }],
    usage: core.zeroUsage(),
    stopReason: "toolUse",
    timestamp: 0,
  };
  const raw = JSON.stringify(message);
  for (const [i, s] of sessions.entries()) {
    handle.db
      .prepare("UPDATE sessions SET status=? WHERE id=?")
      .run(i ? "awaiting_approval" : "running", s.id);
    new core.EventsRepository(handle.db).create({
      session_id: s.id,
      seq: 2,
      type: "turn.started",
      payload_json: JSON.stringify({ type: "turn.started", turnId: `t${i}` }),
      created_at: "",
    });
    new core.MessagesRepository(handle.db).create({
      session_id: s.id,
      seq: 1,
      role: "assistant",
      content_json: raw,
      created_at: "",
    });
  }
  const recovered = new core.SessionService(host);
  for (const s of sessions) {
    expect(recovered.get(s.id).snapshot).toMatchObject({ status: "idle", activeTurnId: null });
    expect(new core.MessagesRepository(handle.db).list(s.id).map((r) => r.content_json)[0]).toBe(raw);
    expect(new core.MessagesRepository(handle.db).list(s.id)).toHaveLength(2);
  }
  const before = sessions.map((s) => recovered.get(s.id));
  const again = new core.SessionService(host);
  expect(sessions.map((s) => again.get(s.id))).toEqual(before);
  again.send(sessions[0]!.id, "Read");
  expect(await again.waitIdle(sessions[0]!.id)).toEqual({ stopReason: "end" });
});
it("permission port denies execution and no-output timeout terminates stalled streams", async () => {
  const { service } = await setup({ permissions: { allow: () => false } });
  const s = service.create();
  service.send(s.id, "Read");
  await service.waitIdle(s.id);
  expect(service.get(s.id).snapshot.items.some((i) => i.kind === "tool" && i.status === "error")).toBe(true);
  const next = await setup({ noOutputTimeoutMs: 10 });
  next.gateway.stream = async function* (request) {
    await new Promise<void>((resolve) =>
      request.signal.addEventListener("abort", () => resolve(), { once: true }),
    );
  };
  const s2 = next.service.create();
  next.service.send(s2.id, "Read");
  expect(await next.service.waitIdle(s2.id)).toEqual({ stopReason: "error" });
});
it("retains large first-turn tool results while every gateway request fits a transient input view", async () => {
  const registry = new core.ToolRegistry([
    {
      name: "list",
      class: "read",
      description: "List",
      params: z.strictObject({}),
      execute: async () => ({ text: "a".repeat(30000) }),
    },
    {
      name: "read",
      class: "read",
      description: "Read",
      params: z.strictObject({ path: z.string(), offset: z.number(), limit: z.number() }),
      execute: async () => ({ text: "b".repeat(30000), ref: "board.txt#L1-L2" }),
    },
  ]);
  const { service, gateway, handle } = await setup({ registry });
  gateway.capabilities = () => ({
    contextWindow: 6000,
    maxOutputTokens: 1000,
    safetyMargin: 1024,
    inputBudget: 3976,
    supportsTools: true,
  });
  const requests: Omit<core.LlmRequest, "signal">[] = [];
  const original = gateway.stream.bind(gateway);
  gateway.stream = (request) => {
    const { signal: _, ...data } = request;
    requests.push(structuredClone(data));
    return original(request);
  };
  const s = service.create();
  service.send(s.id, "Read " + "u".repeat(1500));
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "end" });
  expect(requests).toHaveLength(3);
  const policy = new core.ContextPolicy();
  for (const request of requests)
    expect(
      policy.prepare(
        { system: request.system, tools: request.tools, messages: request.messages },
        gateway.capabilities("replay/read-then-answer"),
      ).contextTokens,
    ).toBeLessThanOrEqual(3976);
  const raw = new core.MessagesRepository(handle.db)
    .list(s.id)
    .map((r) => r.content_json)
    .join("\n");
  expect(raw).toContain("a".repeat(30000));
  expect(raw).toContain("b".repeat(30000));
});
it("excess calls in one response get source-order error results and only the permitted call executes", async () => {
  const { service, gateway, handle } = await setup({ maxToolCallsPerTurn: 1 });
  const original = gateway.stream.bind(gateway);
  gateway.stream = async function* (request) {
    for await (const event of original(request)) {
      if (event.type === "done")
        event.message.content.push({ type: "toolCall", id: "excess", name: "list", arguments: {} });
      yield event;
    }
  };
  const s = service.create();
  service.send(s.id, "Read");
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "limit" });
  const messages = new core.MessagesRepository(handle.db)
    .list(s.id)
    .map((r) => JSON.parse(r.content_json) as Message);
  expect(messages.filter((m) => m.role === "toolResult")).toHaveLength(2);
  expect(messages.at(-1)).toMatchObject({ toolCallId: "excess", isError: true });
  expect(service.get(s.id).snapshot.items.filter((i) => i.kind === "tool")).toHaveLength(1);
});
it("persists a completed tool message before the next model response ends", async () => {
  const { service, gateway, handle } = await setup();
  let reached = false;
  let release: () => void = () => {};
  const original = gateway.stream.bind(gateway);
  gateway.stream = async function* (request) {
    if (request.messages.some((m) => m.role === "toolResult")) {
      reached = true;
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    }
    yield* original(request);
  };
  const s = service.create();
  service.send(s.id, "Read");
  await expect.poll(() => reached).toBe(true);
  await expect
    .poll(
      () => new core.MessagesRepository(handle.db).list(s.id).filter((r) => r.role === "toolResult").length,
    )
    .toBe(1);
  service.stop(s.id);
  release();
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "aborted" });
});
it("stop completes promptly even if the provider iterator ignores its abort signal", async () => {
  const { service, gateway } = await setup();
  gateway.stream = async function* () {
    await new Promise<void>(() => {});
  };
  const s = service.create();
  service.send(s.id, "Read");
  service.stop(s.id);
  expect(await service.waitIdle(s.id)).toEqual({ stopReason: "aborted" });
});
