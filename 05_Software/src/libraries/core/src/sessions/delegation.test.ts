import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { ReferenceRuntime } from "../agent/runtime.js";
import { HelpLibrary } from "../help/library.js";
import type { LlmRequest } from "../llm/gateway.js";
import { ReplayGateway } from "../llm/replay.js";
import { openDb } from "../storage/db.js";
import { createToolContext } from "../tools/context.js";
import { readTool } from "../tools/read.js";
import { ToolRegistry } from "../tools/registry.js";
import type { SessionHost } from "./service.js";
import { SessionService } from "./service.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});
const failure = (code: string) => expect.objectContaining({ code });
const launch = { requestId: "request-1", instruction: "Inspect the fixture note." };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function setup(overrides: Partial<SessionHost> = {}) {
  const root = await mkdtemp(join(tmpdir(), "vera-delegation-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, ".vera"));
  const fixtures = join(root, "replay");
  await mkdir(fixtures);
  const unsafe = [
    { name: "write", args: { path: "note.txt", content: "changed" } },
    { name: "edit", args: {} },
    { name: "artifact_save", args: { name: "output.txt", content: "changed" } },
    { name: "todo", args: { items: [{ text: "persisted", status: "pending" }] } },
    { name: "run_command", args: { argv: ["sample-command"] } },
    { name: "run_program", args: {} },
    { name: "program_stop", args: {} },
    { name: "web_download", args: {} },
    { name: "plugin_install", args: {} },
    { name: "electrical_model_change", args: {} },
    { name: "terminal_read", args: {} },
    { name: "help", args: { plugin: "fixture-plugin" } },
    { name: "future_plugin", args: {} },
    { name: "delegate", args: {} },
  ];
  const scenarios = {
    parent: [{ text: "Parent finished independently." }],
    child: [{ text: "Child finished independently." }],
    tools: [
      { toolCalls: [{ name: "read", args: { path: "note.txt" } }, ...unsafe] },
      { text: "Inspection finished." },
    ],
  };
  for (const [name, steps] of Object.entries(scenarios))
    await writeFile(join(fixtures, `${name}.jsonl`), steps.map((step) => JSON.stringify(step)).join("\n"));
  await writeFile(join(root, "note.txt"), "Fixture note.\n");
  const storage = { workbenchId: `wb_${basename(root)}`, appVersion: "0.0.0" };
  const file = join(root, ".vera", "vera.db");
  const handle = await openDb(file, storage);
  cleanup.push(async () => handle.close());
  const requests: LlmRequest[] = [];
  const gates = new Map<string, ReturnType<typeof deferred>>();
  const hold = (model: string) => {
    const gate = deferred();
    gates.set(model, gate);
    return gate.resolve;
  };
  const clock = { now: () => new Date("2026-11-19T12:00:00Z"), sleep: async () => {} };
  const gateway = new (class extends ReplayGateway {
    override capabilities(model: string, output?: number) {
      return {
        ...super.capabilities(model, output),
        reasoningOptions: model === "replay/child" ? ["low", "high"] : [],
      };
    }
    override async *stream(request: LlmRequest) {
      requests.push(request);
      const gate = gates.get(request.model);
      if (gate) {
        const abort = deferred();
        request.signal.addEventListener("abort", abort.resolve, { once: true });
        try {
          if (!request.signal.aborted) await Promise.race([gate.promise, abort.promise]);
          request.signal.throwIfAborted();
        } finally {
          request.signal.removeEventListener("abort", abort.resolve);
        }
      }
      yield* super.stream(request);
    }
  })({ dir: fixtures, now: () => clock.now().getTime() });
  const prepareModel = vi.spyOn(gateway, "prepareModel");
  const host: SessionHost = {
    db: handle.db,
    root,
    gateway,
    clock,
    mode: "bypass",
    model: (model) => model ?? "replay/parent",
    prompt: (mode) => `Fixture workbench. Session mode: ${mode}`,
    ...overrides,
  };
  const service = new SessionService(host);
  cleanup.push(() => service.close());
  await service.waitReady();
  return {
    root,
    service,
    host,
    handle,
    storage,
    requests,
    prepareModel,
    hold,
  };
}

it("publishes initial durable events in order during reentrant delivery", async () => {
  const h = await setup();
  const parent = h.service.create();
  const events: string[] = [];
  const off = h.service.subscribe(parent.id, 1, (_seq, event) => {
    if (event.type === "message.user") h.service.bookmark(parent.id, event.messageId, true);
    events.push(event.type);
  });
  h.service.send(parent.id, "Inspect the note.");
  await h.service.waitIdle(parent.id);
  off();
  expect(events.slice(0, 4)).toEqual([
    "message.user",
    "session.updated",
    "message.bookmarked",
    "turn.started",
  ]);
  expect(h.service.get(parent.id).snapshot.bookmarkedMessageIds).toHaveLength(1);
});

it("runs replay parent and child independently with the selected model and reasoning", async () => {
  const h = await setup();
  const parent = h.service.create();
  const releaseParent = h.hold("replay/parent");
  const releaseChild = h.hold("replay/child");
  const parentTurn = h.service.send(parent.id, "Continue the parent task.");
  await vi.waitFor(() => expect(h.requests.some((request) => request.sessionId === parent.id)).toBe(true));
  const child = await h.service.launchDelegated(parent.id, {
    ...launch,
    modelRef: "replay/child",
    reasoning: "high",
  });
  await vi.waitFor(() =>
    expect(h.requests.some((request) => request.sessionId === child.sessionId)).toBe(true),
  );
  expect(h.service.get(parent.id).snapshot.activeTurnId).toBe(parentTurn.turnId);
  releaseParent();
  expect(await h.service.waitIdle(parent.id)).toEqual({ stopReason: "end" });
  expect(h.service.inspectDelegated(parent.id, child.sessionId).snapshot.activeTurnId).toBe(child.turnId);
  expect(h.requests.find((request) => request.sessionId === child.sessionId)).toMatchObject({
    model: "replay/child",
    reasoning: "high",
    messages: [{ role: "user", content: launch.instruction }],
  });
  expect(h.service.get(parent.id).snapshot.items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "assistant", text: "Parent finished independently." }),
    ]),
  );
  releaseChild();
  expect(await h.service.waitIdle(child.sessionId)).toEqual({ stopReason: "end" });
  const childView = h.service.inspectDelegated(parent.id, child.sessionId);
  expect(childView).toMatchObject({
    launch: child,
    session: { mode: "read-only", modelRef: "replay/child" },
    snapshot: {
      reasoning: "high",
      items: expect.arrayContaining([
        expect.objectContaining({ kind: "assistant", text: "Child finished independently." }),
      ]),
    },
  });
  const inherited = await h.service.launchDelegated(parent.id, { ...launch, requestId: "default" });
  await h.service.waitIdle(inherited.sessionId);
  expect(h.requests.find((request) => request.sessionId === inherited.sessionId)).toMatchObject({
    model: "replay/parent",
    reasoning: null,
  });
});

it("fails the first dispatch if its selected reasoning disappears during model refresh", async () => {
  const h = await setup();
  const parent = h.service.create();
  const preparation = deferred();
  let reasoning = ["low", "high"];
  const capabilities = h.host.gateway.capabilities.bind(h.host.gateway);
  vi.spyOn(h.host.gateway, "capabilities").mockImplementation((model, output) => ({
    ...capabilities(model, output),
    reasoningOptions: reasoning,
  }));
  h.prepareModel
    .mockImplementationOnce(async () => {})
    .mockImplementationOnce(async () => {
      await preparation.promise;
      reasoning = ["low"];
    });
  const child = await h.service.launchDelegated(parent.id, {
    ...launch,
    modelRef: "replay/child",
    reasoning: "high",
  });
  preparation.resolve();
  expect(await h.service.waitIdle(child.sessionId)).toEqual({ stopReason: "error" });
  expect(h.requests).toEqual([]);
  expect(h.service.exportSession(child.sessionId).events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ event: expect.objectContaining({ type: "error", code: "INVALID" }) }),
    ]),
  );
});

it("rejects invalid launch options before allocating a child", async () => {
  const privateText = 'synthetic"secret';
  const h = await setup({ scrub: (text) => text.replaceAll(privateText, "[REDACTED]") });
  const parent = h.service.create();
  await expect(h.service.launchDelegated(parent.id, { ...launch, instruction: " " })).rejects.toMatchObject(
    failure("INVALID"),
  );
  await expect(
    h.service.launchDelegated(parent.id, { ...launch, modelRef: "replay/missing" }),
  ).rejects.toMatchObject(failure("NOT_FOUND"));
  await expect(h.service.launchDelegated(parent.id, { ...launch, reasoning: "high" })).rejects.toMatchObject(
    failure("INVALID"),
  );
  await expect(
    h.service.launchDelegated(parent.id, { ...launch, instruction: privateText }),
  ).rejects.toMatchObject(failure("INVALID"));
  expect(h.service.list().map((session) => session.id)).toEqual([parent.id]);
  expect(h.requests).toEqual([]);
});

it("rolls back startup and initial persistence failures and permits the same key to retry", async () => {
  let failStart = true;
  const h = await setup({
    runtime: (host) => {
      if (failStart) throw Error("fixture startup failure");
      return new ReferenceRuntime(host);
    },
  });
  const parent = h.service.create();
  await expect(h.service.launchDelegated(parent.id, launch)).rejects.toThrow("fixture startup failure");
  failStart = false;
  h.handle.db.exec(`CREATE TEMP TRIGGER fixture_failure BEFORE INSERT ON events
    WHEN NEW.type='turn.started' BEGIN SELECT RAISE(ABORT, 'fixture persistence failure'); END`);
  await expect(h.service.launchDelegated(parent.id, launch)).rejects.toThrow("fixture persistence failure");
  expect(h.service.list().map((s) => s.id)).toEqual([parent.id]);
  expect(h.service.listDelegated(parent.id)).toEqual([]);
  expect(h.service.hasActiveWork()).toBe(false);
  expect(h.requests).toEqual([]);
  h.handle.db.exec("DROP TRIGGER fixture_failure");
  h.handle.db.exec(`CREATE TEMP TRIGGER fixture_failure BEFORE INSERT ON session_delegations
    BEGIN SELECT RAISE(ABORT, 'fixture relationship failure'); END`);
  await expect(h.service.launchDelegated(parent.id, launch)).rejects.toThrow("fixture relationship failure");
  expect(h.service.list().map((s) => s.id)).toEqual([parent.id]);
  expect(h.service.hasActiveWork()).toBe(false);
  expect(h.requests).toEqual([]);
  expect(h.prepareModel).toHaveBeenCalledTimes(3);
  h.handle.db.exec("DROP TRIGGER fixture_failure");
  const child = await h.service.launchDelegated(parent.id, launch);
  expect(await h.service.waitIdle(child.sessionId)).toEqual({ stopReason: "end" });
});

it("cancels a launch waiting on model preparation when the workbench closes", async () => {
  const h = await setup();
  const parent = h.service.create();
  const preparation = deferred();
  h.prepareModel.mockImplementationOnce(() => preparation.promise);
  const request = h.service.launchDelegated(parent.id, launch);
  let failure: unknown;
  const settled = request.catch((error) => {
    failure = error;
  });
  try {
    await vi.waitFor(() => expect(h.prepareModel).toHaveBeenCalledOnce());
    await h.service.close();
    await vi.waitFor(() => expect(failure).toMatchObject({ name: "AbortError" }), { timeout: 500 });
  } finally {
    preparation.resolve();
    await settled;
  }
  expect(h.handle.db.prepare("SELECT id FROM sessions").pluck().all()).toEqual([parent.id]);
  expect(h.requests).toEqual([]);
});

it("aborts an admitted child stuck refreshing model metadata", async () => {
  const h = await setup();
  const parent = h.service.create();
  const preparation = deferred();
  h.prepareModel.mockImplementationOnce(async () => {}).mockImplementationOnce(() => preparation.promise);
  const child = await h.service.launchDelegated(parent.id, launch);
  let result: unknown;
  const settled = h.service.waitIdle(child.sessionId).then((status) => {
    result = status;
  });
  try {
    await vi.waitFor(() => expect(h.prepareModel).toHaveBeenCalledTimes(2));
    expect(h.service.stopDelegated(parent.id, child.sessionId)).toBe(true);
    await vi.waitFor(() => expect(result).toEqual({ stopReason: "aborted" }), { timeout: 500 });
  } finally {
    preparation.resolve();
    await settled;
  }
  expect(h.requests).toEqual([]);
});

it("deduplicates concurrent retries and admits three active children across the workbench", async () => {
  const h = await setup();
  const releaseChildren = h.hold("replay/child");
  const parent = h.service.create();
  const other = h.service.create();
  const request = { ...launch, modelRef: "replay/child" };
  const attempts = await Promise.all(
    Array.from({ length: 5 }, () => h.service.launchDelegated(parent.id, request)),
  );
  const first = attempts[0]!;
  expect(attempts).toEqual(Array(5).fill(first));
  expect(h.service.get(first.sessionId).snapshot.items).toHaveLength(1);
  await expect(
    h.service.launchDelegated(parent.id, { ...request, instruction: "Different task." }),
  ).rejects.toMatchObject(failure("CONFLICT"));
  const competing = await Promise.allSettled(
    ["second", "third", "fourth"].map((requestId) =>
      h.service.launchDelegated(other.id, { ...request, requestId }),
    ),
  );
  expect(competing.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);
  expect(competing.filter((outcome) => outcome.status === "rejected")).toEqual([
    expect.objectContaining({ reason: failure("BUSY") }),
  ]);
  expect(await h.service.launchDelegated(parent.id, request)).toEqual(first);
  expect(h.service.stopDelegated(parent.id, first.sessionId)).toBe(true);
  expect(await h.service.waitIdle(first.sessionId)).toEqual({ stopReason: "aborted" });
  const next = await h.service.launchDelegated(parent.id, { ...request, requestId: "available" });
  expect(() => h.service.send(first.sessionId, "Resume the first child.")).toThrow(failure("BUSY"));
  releaseChildren();
  expect(await h.service.waitIdle(next.sessionId)).toEqual({ stopReason: "end" });
});

it("projects committed delegation outcomes even when the Desktop notification fails", async () => {
  const statuses: (string | undefined)[] = [];
  const observer = vi.fn(() => {
    statuses.push(h.service.list(true).find((row) => row.delegation)?.delegation?.status);
    throw Error("Renderer disconnected");
  });
  const h = await setup({ onDelegationsChanged: observer });
  const parent = h.service.create();
  const release = h.hold("replay/child");
  const child = await h.service.launchDelegated(parent.id, { ...launch, modelRef: "replay/child" });
  const linked = () => h.service.list(true).find((row) => row.id === child.sessionId)?.delegation;
  expect(linked()).toEqual({ parentSessionId: parent.id, status: "running" });
  expect(h.service.list().find((row) => row.id === child.sessionId)?.delegation).toBeUndefined();
  release();
  expect(await h.service.waitIdle(child.sessionId)).toEqual({ stopReason: "end" });
  expect(linked()).toEqual({ parentSessionId: parent.id, status: "completed" });
  expect(statuses).toEqual(["running", "completed"]);
  expect(observer).toHaveBeenCalledTimes(2);
  h.service.send(child.sessionId, "Follow up");
  expect(linked()?.status).toBe("completed");
  await h.service.waitIdle(child.sessionId);
  await h.service.delete(child.sessionId);
  expect(linked()).toBeUndefined();
});

it("reports the initial delegated tool limit in the Desktop list", async () => {
  const h = await setup({ maxToolCallsPerTurn: 1 });
  const parent = h.service.create();
  const child = await h.service.launchDelegated(parent.id, { ...launch, modelRef: "replay/tools" });
  expect(await h.service.waitIdle(child.sessionId)).toEqual({ stopReason: "limit" });
  expect(h.service.list(true).find((row) => row.id === child.sessionId)?.delegation).toEqual({
    parentSessionId: parent.id,
    status: "limit",
  });
});

it("scopes child controls to the same-workbench parent and denies recursive delegation", async () => {
  const h = await setup();
  const foreign = await setup();
  const parent = h.service.create();
  const unrelated = h.service.create();
  const foreignParent = foreign.service.create();
  const child = await h.service.launchDelegated(parent.id, launch);
  await expect(h.service.launchDelegated(child.sessionId, launch)).rejects.toMatchObject(failure("DENIED"));
  await expect(h.service.launchDelegated(foreignParent.id, launch)).rejects.toMatchObject(
    failure("NOT_FOUND"),
  );
  expect(() => h.service.inspectDelegated(unrelated.id, child.sessionId)).toThrow(failure("NOT_FOUND"));
  expect(() => h.service.inspectDelegated(parent.id, unrelated.id)).toThrow(failure("NOT_FOUND"));
  expect(() => h.service.stopDelegated(unrelated.id, child.sessionId)).toThrow(failure("NOT_FOUND"));
  expect(() => h.service.subscribeDelegated(unrelated.id, child.sessionId, 0, vi.fn())).toThrow(
    failure("NOT_FOUND"),
  );
  expect(() => foreign.service.stopDelegated(foreignParent.id, child.sessionId)).toThrow(
    failure("NOT_FOUND"),
  );
  const listener = vi.fn();
  const off = h.service.subscribeDelegated(parent.id, child.sessionId, 0, listener);
  await h.service.waitIdle(child.sessionId);
  off();
  expect(listener).toHaveBeenCalledWith(expect.any(Number), {
    type: "turn.done",
    turnId: child.turnId,
    stopReason: "end",
  });
});

it("allows canonical inspection and denies forged, custom, and prepared child calls before permission", async () => {
  const allow = vi.fn(() => true);
  const plugin = {
    name: "future_plugin",
    class: "read" as const,
    description: "Fixture plugin.",
    params: z.strictObject({}),
    execute: vi.fn(async () => ({ ok: true })),
  };
  const registry = new ToolRegistry([...new ToolRegistry().available(), plugin]);
  const plugins = vi.fn(async () => []);
  const help = { app: new HelpLibrary("."), language: () => "en" as const, plugins };
  const h = await setup({ registry, permissions: { allow }, help });
  const parent = h.service.create();
  const child = await h.service.launchDelegated(parent.id, { ...launch, modelRef: "replay/tools" });
  expect(() => h.service.setMode(child.sessionId, "bypass")).toThrow(failure("DENIED"));
  expect(await h.service.waitIdle(child.sessionId)).toEqual({ stopReason: "end" });
  const request = h.requests.find((request) => request.sessionId === child.sessionId);
  expect(request?.system).toContain("Session mode: read-only");
  expect(request?.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining(["read", "search_docs"]));
  const results = h.service.get(child.sessionId).snapshot.items.filter((item) => item.kind === "tool");
  expect(results).toHaveLength(15);
  expect(plugins).not.toHaveBeenCalled();
  expect(results.filter((item) => item.status === "ok").map((item) => item.name)).toEqual(["read"]);
  expect(allow.mock.calls).toHaveLength(1);
  expect(plugin.execute).not.toHaveBeenCalled();
  expect(await readFile(join(h.root, "note.txt"), "utf8")).toBe("Fixture note.\n");
  expect(h.service.listArtifacts(child.sessionId)).toEqual([]);
  expect(h.service.get(child.sessionId).snapshot.todos).toEqual([]);
  expect(h.handle.db.prepare("SELECT * FROM approvals").all()).toEqual([]);

  const foreign = await setup();
  const ctx = {
    ...createToolContext(h.root),
    help,
    delegated: true as const,
    permissionMode: () => "bypass" as const,
    additionalFolders: () => [foreign.root],
  };
  const signal = new AbortController().signal;
  const replacedRead = vi.fn(readTool.execute);
  const replaced = new ToolRegistry([{ ...readTool, execute: replacedRead }, plugin]);
  expect(replaced.bind(ctx)).toEqual([]);
  expect((await replaced.execute(ctx, "read", { path: "note.txt" }, signal)).isError).toBe(true);
  expect((await registry.execute(ctx, "artifact_save", {}, signal)).isError).toBe(true);
  expect((await registry.execute(ctx, "help", { plugin: "fixture-plugin" }, signal)).isError).toBe(true);
  expect(plugins).not.toHaveBeenCalled();
  expect(
    (await registry.execute(ctx, "read", { path: join(foreign.root, "note.txt") }, signal)).isError,
  ).toBe(true);
  expect((await registry.execute(ctx, "read", { path: "note.txt" }, signal)).isError).toBe(false);
  await expect(
    registry.prepare(ctx, "write", { path: "note.txt", content: "changed" }, signal),
  ).rejects.toThrow("unavailable");
  expect(replacedRead).not.toHaveBeenCalled();
});

it("keeps archived history and prevents the parent from being deleted before the child", async () => {
  const h = await setup();
  const parent = h.service.create();
  const child = await h.service.launchDelegated(parent.id, launch);
  await h.service.waitIdle(child.sessionId);
  h.service.setArchived(parent.id, true);
  h.service.setArchived(child.sessionId, true);
  expect(h.service.delegationParent(child.sessionId)).toBe(parent.id);
  expect(h.service.inspectDelegated(parent.id, child.sessionId)).toMatchObject({
    launch: child,
    session: { archived: true },
    snapshot: { turns: [{ turnId: child.turnId, stopReason: "end" }] },
  });
  const copy = join(h.root, ".vera", "archived.db");
  await h.handle.db.backup(copy);
  const reopened = await openDb(copy, { ...h.storage, readOnly: true });
  cleanup.push(async () => reopened.close());
  const readOnly = new SessionService({ ...h.host, db: reopened.db, readOnly: true });
  cleanup.push(() => readOnly.close());
  expect(readOnly.inspectDelegated(parent.id, child.sessionId)).toEqual(
    h.service.inspectDelegated(parent.id, child.sessionId),
  );
  expect(readOnly.list().find((session) => session.id === parent.id)?.archived).toBe(true);
  await expect(h.service.delete(parent.id)).rejects.toMatchObject(failure("CONFLICT"));
  await h.service.delete(child.sessionId);
  expect(h.service.listDelegated(parent.id)).toEqual([]);
  await expect(h.service.launchDelegated(parent.id, launch)).rejects.toMatchObject(failure("CONFLICT"));
  await h.service.delete(parent.id);
  expect(h.service.list()).toEqual([]);
  expect(h.handle.db.pragma("foreign_key_check")).toEqual([]);
});

it("reopens an interrupted replay child with the same request and recovered turn", async () => {
  const h = await setup();
  h.hold("replay/child");
  const parent = h.service.create();
  const request = { ...launch, modelRef: "replay/child", reasoning: "low" };
  const child = await h.service.launchDelegated(parent.id, request);
  await vi.waitFor(() => expect(h.requests.some((item) => item.sessionId === child.sessionId)).toBe(true));
  h.service.setArchived(parent.id, true);
  const snapshot = join(h.root, ".vera", "interrupted.db");
  await h.handle.db.backup(snapshot);
  const reopened = await openDb(snapshot, h.storage);
  cleanup.push(async () => reopened.close());
  const recovered = new SessionService({ ...h.host, db: reopened.db });
  cleanup.push(() => recovered.close());
  expect(recovered.delegationParent(child.sessionId)).toBe(parent.id);
  expect(recovered.list(true).find((row) => row.id === child.sessionId)?.delegation).toEqual({
    parentSessionId: parent.id,
    status: "interrupted",
  });
  const view = recovered.inspectDelegated(parent.id, child.sessionId);
  expect(view).toMatchObject({
    launch: child,
    session: { status: "idle", modelRef: "replay/child" },
    snapshot: { reasoning: "low", turns: [{ turnId: child.turnId, stopReason: "aborted" }] },
  });
  expect(view.snapshot.items).toEqual(
    expect.arrayContaining([expect.objectContaining({ kind: "user", text: launch.instruction })]),
  );
  expect(recovered.exportSession(child.sessionId).events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ event: { type: "session.interrupted", turnId: child.turnId } }),
    ]),
  );
  expect(await recovered.launchDelegated(parent.id, request)).toEqual(child);
  expect(recovered.list().find((session) => session.id === parent.id)?.archived).toBe(true);
  const second = new SessionService({ ...h.host, db: reopened.db });
  cleanup.push(() => second.close());
  expect(second.inspectDelegated(parent.id, child.sessionId)).toEqual(view);
});
