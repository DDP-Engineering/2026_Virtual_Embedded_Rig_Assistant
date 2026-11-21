import { addAbortListener } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ReferenceRuntime } from "../agent/runtime.js";
import type { RuntimeInit, ToolDef } from "../agent/types.js";
import type { LlmRequest } from "../llm/gateway.js";
import { ReplayGateway } from "../llm/replay.js";
import { openDb } from "../storage/db.js";
import { SessionHub } from "./hub.js";
import type { SessionHost } from "./service.js";
import { SessionService } from "./service.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function setup(overrides: Partial<SessionHost> = {}) {
  const root = await mkdtemp(join(tmpdir(), "vera-delegation-tools-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const dir = join(root, "replay");
  await mkdir(dir);
  const scenario = (name: string, steps: readonly unknown[]) =>
    writeFile(join(dir, `${name}.jsonl`), steps.map((step) => JSON.stringify(step)).join("\n"));
  await scenario("child", [{ text: "The fixture is connected." }]);
  await scenario("parent", [{ text: "Parent ready." }]);
  await writeFile(join(root, "note.txt"), "Parent read this while the child was running.\n");
  const storage = { workbenchId: `wb_${basename(root)}`, appVersion: "0.0.0" };
  const handle = await openDb(join(root, "vera.db"), storage);
  cleanup.push(async () => handle.close());
  const gates = new Map<string, Promise<void>>();
  const requests: LlmRequest[] = [];
  const offered = new Map<string, ToolDef[]>();
  const clock = { now: () => new Date(), sleep: async () => {} };
  const gateway = new (class extends ReplayGateway {
    override capabilities(model: string, output?: number) {
      const capabilities = super.capabilities(model, output);
      if (model !== "replay/child") return capabilities;
      const contextWindow = 65536;
      const safetyMargin = Math.ceil(contextWindow * 0.05);
      return {
        ...capabilities,
        contextWindow,
        safetyMargin,
        inputBudget: contextWindow - capabilities.maxOutputTokens - safetyMargin,
        reasoningOptions: ["low", "high"],
      };
    }
    override async *stream(request: LlmRequest) {
      requests.push(request);
      const gate = gates.get(request.model);
      if (gate) {
        const cancelled = deferred();
        const listener = addAbortListener(request.signal, cancelled.resolve);
        try {
          await Promise.race([gate, cancelled.promise]);
          request.signal.throwIfAborted();
        } finally {
          listener[Symbol.dispose]();
        }
      }
      yield* super.stream(request);
    }
  })({ dir, now: () => clock.now().getTime() });
  const host: SessionHost = {
    db: handle.db,
    root,
    gateway,
    clock,
    model: (model) => model ?? "replay/parent",
    prompt: () => "Delegation tool replay fixture.",
    runtime: (runtimeHost) =>
      new (class extends ReferenceRuntime {
        override start(init: RuntimeInit) {
          offered.set(init.model, init.tools);
          super.start(init);
        }
      })(runtimeHost),
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
    scenario,
    hold(model: string) {
      const gate = deferred();
      gates.set(model, gate.promise);
      return gate.resolve;
    },
    tool(model: string, name: string) {
      const tool = offered.get(model)?.find((entry) => entry.name === name);
      expect(tool, `${name} is offered to ${model}`).toBeDefined();
      if (!tool) throw Error(`Missing ${name}`);
      return {
        ...tool,
        async execute(...args: Parameters<ToolDef["execute"]>) {
          const output = await tool.execute(...args);
          if (typeof output !== "string") throw Error("Delegation tools must return text only.");
          return output;
        },
      };
    },
  };
}

const childRequest = { instruction: "Inspect the fixture.", modelRef: "replay/child", reasoning: "high" };

function result(service: SessionService, id: string, name: string): Record<string, unknown> | undefined {
  const item = service.get(id).snapshot.items.find((entry) => entry.kind === "tool" && entry.name === name);
  if (item?.kind !== "tool" || item.status !== "ok" || !item.summary) return undefined;
  return JSON.parse(item.summary);
}

it("replays launch, independent parent work, progress and use of the child reply in one turn", async () => {
  const h = await setup();
  const childId = { sessionId: "{{sessionId}}" };
  await h.scenario("parent", [
    { toolCalls: [{ name: "session_launch", args: childRequest }] },
    { toolCalls: [{ name: "read", args: { path: "note.txt" } }] },
    { toolCalls: [{ name: "session_status", args: childId }] },
    { toolCalls: [{ name: "session_wait", args: { ...childId, waitMs: 3000 } }] },
    { text: "Parent used the result: {{reply}}" },
  ]);
  const releaseChild = h.hold("replay/child");
  const observed = vi.spyOn(h.service, "subscribeDelegated");
  const parent = h.service.create();
  h.service.send(parent.id, "Delegate fixture inspection, then report the result.");
  await vi.waitFor(() =>
    expect(result(h.service, parent.id, "session_launch")).toMatchObject({
      sessionId: expect.any(String),
      turnId: expect.any(String),
    }),
  );
  const child = h.service.listDelegated(parent.id)[0];
  if (!child) throw Error("Launch did not create a child.");
  await vi.waitFor(() => expect(observed).toHaveBeenCalledOnce());
  expect(result(h.service, parent.id, "read")?.text).toContain("Parent read this");
  expect(result(h.service, parent.id, "session_status")).toMatchObject({ status: "running", toolSteps: 0 });
  const childDispatch = h.requests.find((request) => request.sessionId === child.id);
  expect(childDispatch).toMatchObject({
    model: "replay/child",
    reasoning: "high",
    messages: [
      { role: "user", content: `Parent agent instruction (${parent.id}):\n${childRequest.instruction}` },
    ],
  });
  expect(childDispatch?.tools.map((tool) => tool.name)).not.toContain("session_launch");
  releaseChild();
  expect(await h.service.waitIdle(parent.id)).toEqual({ stopReason: "end" });
  expect(result(h.service, parent.id, "session_wait")).toMatchObject({
    status: "completed",
    reply: "The fixture is connected.",
  });
  expect(h.service.get(parent.id).snapshot.items.at(-1)).toMatchObject({
    kind: "assistant",
    text: "Parent used the result: The fixture is connected.",
  });
});

it("takes caller and retry identity from the bound turn and enforces child ownership", async () => {
  const h = await setup();
  const releaseParent = h.hold("replay/parent");
  h.hold("replay/child");
  await h.scenario("other", [{ text: "Unrelated session." }]);
  const owner = h.service.create();
  const unrelated = h.service.create("replay/other");
  h.service.send(owner.id, "Owner.");
  h.service.send(unrelated.id, "Unrelated.");
  await h.service.waitIdle(unrelated.id);

  const signal = new AbortController().signal;
  const launch = h.tool("replay/parent", "session_launch");
  expect(launch.params.safeParse({ ...childRequest, parentId: unrelated.id }).success).toBe(false);
  expect(launch.params.safeParse({ ...childRequest, requestId: "forged" }).success).toBe(false);
  await expect(launch.execute(childRequest, signal)).rejects.toThrow(/INVALID/);
  const first = JSON.parse(await launch.execute(childRequest, signal, "invocation/one"));
  expect(JSON.parse(await launch.execute(childRequest, signal, "invocation/one"))).toEqual(first);
  await expect(
    launch.execute({ ...childRequest, instruction: "Different task." }, signal, "invocation/one"),
  ).rejects.toThrow(/CONFLICT/);
  const second = JSON.parse(await launch.execute(childRequest, signal, "invocation/two"));
  expect(second.sessionId).not.toBe(first.sessionId);
  expect(h.service.listDelegated(owner.id)).toHaveLength(2);

  const args = { sessionId: first.sessionId };
  for (const name of ["session_status", "session_wait", "session_stop"])
    await expect(h.tool("replay/other", name).execute(args, signal)).rejects.toThrow(/NOT_FOUND/);

  const stop = h.tool("replay/parent", "session_stop");
  expect(JSON.parse(await stop.execute(args, signal))).toMatchObject({ stopRequested: true });
  expect(await h.service.waitIdle(first.sessionId)).toEqual({ stopReason: "aborted" });
  expect(h.service.get(first.sessionId).snapshot.items[0]).toMatchObject({
    kind: "user",
    text: childRequest.instruction,
  });
  expect(JSON.parse(await h.tool("replay/parent", "session_status").execute(args, signal))).toMatchObject({
    status: "stopped",
  });

  h.service.send(first.sessionId, "Unrelated later turn.");
  expect(JSON.parse(await stop.execute(args, signal))).toMatchObject({ stopRequested: false });
  expect(h.service.get(first.sessionId).snapshot.activeTurnId).not.toBeNull();
  expect(h.service.stop(first.sessionId)).toBe(true);
  await h.service.waitIdle(first.sessionId);
  releaseParent();
  await h.service.waitIdle(owner.id);
});

it("returns current progress on timeout and disposes wait listeners on timeout, cancel and error", async () => {
  const h = await setup();
  const releaseChild = h.hold("replay/child");
  const parent = h.service.create();
  h.service.send(parent.id, "Parent tool host.");
  await h.service.waitIdle(parent.id);
  const child = await h.service.launchDelegated(parent.id, { ...childRequest, requestId: "timeout" });
  const wait = h.tool("replay/parent", "session_wait");
  const args = { sessionId: child.sessionId, waitMs: 10 };
  const dispose = vi.fn();
  const subscribe = h.service.subscribeDelegated.bind(h.service);
  const subscribed = vi.spyOn(h.service, "subscribeDelegated").mockImplementation((...input) => {
    const off = subscribe(...input);
    return () => {
      dispose();
      off();
    };
  });

  const signal = new AbortController().signal;
  expect(JSON.parse(await wait.execute(args, signal))).toMatchObject({
    status: "running",
    timedOut: true,
  });
  expect(dispose).toHaveBeenCalledTimes(1);
  const cancel = new AbortController();
  const cancelled = wait.execute({ ...args, waitMs: 30000 }, cancel.signal);
  const aborted = expect(cancelled).rejects.toThrow(/aborted/i);
  await vi.waitFor(() => expect(subscribed).toHaveBeenCalledTimes(2));
  cancel.abort();
  await aborted;
  expect(dispose).toHaveBeenCalledTimes(2);
  expect(h.service.get(child.sessionId).snapshot.activeTurnId).toBe(child.turnId);

  const failing = wait.execute({ ...args, waitMs: 3000 }, signal);
  await vi.waitFor(() => expect(subscribed).toHaveBeenCalledTimes(3));
  await h.scenario("child", []);
  releaseChild();
  expect(JSON.parse(await failing)).toMatchObject({ status: "error" });
  expect(dispose).toHaveBeenCalledTimes(3);
});

it("replays a terminal event committed before subscription and rejects a deleted target", async () => {
  const h = await setup();
  const releaseChild = h.hold("replay/child");
  const parent = h.service.create();
  h.service.send(parent.id, "Parent tool host.");
  await h.service.waitIdle(parent.id);
  const child = await h.service.launchDelegated(parent.id, { ...childRequest, requestId: "gap" });
  const args = { sessionId: child.sessionId };
  const stale = h.service.inspectDelegated(parent.id, child.sessionId);
  const stopAfterFinish = vi.fn();
  const off = h.service.subscribeDelegated(parent.id, child.sessionId, stale.seq, (_seq, event) => {
    if (event.type === "turn.done")
      stopAfterFinish(h.service.stopDelegated(parent.id, child.sessionId, child.turnId));
  });
  releaseChild();
  await h.service.waitIdle(child.sessionId);
  off();
  expect(stopAfterFinish).toHaveBeenCalledExactlyOnceWith(false);

  const wait = h.tool("replay/parent", "session_wait");
  const signal = new AbortController().signal;
  const inspect = vi.spyOn(h.service, "inspectDelegated");
  const coreSubscribe = h.service.subscribeDelegated.bind(h.service);
  const disposed = vi.fn();
  const subscribe = vi.spyOn(h.service, "subscribeDelegated").mockImplementation((...input) => {
    const off = coreSubscribe(...input);
    return () => {
      disposed();
      off();
    };
  });
  expect(JSON.parse(await wait.execute(args, signal))).toMatchObject({ status: "completed" });
  expect(subscribe).not.toHaveBeenCalled();
  inspect.mockReturnValueOnce(stale);
  expect(JSON.parse(await wait.execute(args, signal))).toMatchObject({
    status: "completed",
    reply: "The fixture is connected.",
  });
  expect(subscribe).toHaveBeenCalledWith(parent.id, child.sessionId, stale.seq, expect.any(Function));
  expect(disposed).toHaveBeenCalledOnce();

  await h.service.delete(child.sessionId);
  inspect.mockReturnValueOnce(stale);
  await expect(wait.execute(args, signal)).rejects.toThrow(/NOT_FOUND/);
});

it("reports only the masked bounded reply of the original turn despite later child history", async () => {
  const secret = 'synthetic"secret\\token';
  let mask = false;
  const h = await setup({
    masking: () => mask,
    scrub: (text) => text.replaceAll(secret, "[redacted]"),
  });
  await h.scenario("child", [{ text: secret + 'circuit "pin" '.repeat(2600) }]);
  const parent = h.service.create();
  h.service.send(parent.id, "Parent tool host.");
  await h.service.waitIdle(parent.id);
  const child = await h.service.launchDelegated(parent.id, { ...childRequest, requestId: "masked" });
  expect(await h.service.waitIdle(child.sessionId)).toEqual({ stopReason: "end" });

  const status = h.tool("replay/parent", "session_status");
  const args = { sessionId: child.sessionId };
  const signal = new AbortController().signal;
  mask = true;
  const bounded = await status.execute(args, signal);
  expect(bounded.length).toBeLessThanOrEqual(32000);
  expect(JSON.parse(bounded)).toMatchObject({
    status: "completed",
    reply: expect.stringMatching(/^\[redacted\]circuit/u),
    truncated: true,
  });
  expect(JSON.parse(bounded).reply).not.toContain(secret);

  await h.scenario("child", [{ text: "PRIVATE LATER REPLY." }]);
  h.service.send(child.sessionId, "Private unrelated prompt.");
  expect(await h.service.waitIdle(child.sessionId)).toEqual({ stopReason: "end" });
  expect(h.service.get(child.sessionId).snapshot.items.at(-1)).toMatchObject({
    kind: "assistant",
    text: "PRIVATE LATER REPLY.",
  });
  expect(await status.execute(args, signal)).toBe(bounded);
});

it("keeps the child alive after the parent ends and reports the recovered interruption after reopen", async () => {
  const h = await setup();
  await h.scenario("parent", [
    { toolCalls: [{ name: "session_launch", args: childRequest }] },
    { text: "I can finish before the child." },
  ]);
  h.hold("replay/child");
  const parent = h.service.create();
  h.service.send(parent.id, "Delegate without waiting.");
  expect(await h.service.waitIdle(parent.id)).toEqual({ stopReason: "end" });
  const child = h.service.listDelegated(parent.id)[0];
  if (!child) throw Error("Child is missing.");
  expect(h.service.get(child.id).snapshot.activeTurnId).not.toBeNull();

  const recoveredPath = join(h.root, "recovered.db");
  await h.handle.db.backup(recoveredPath);
  const copy = await openDb(recoveredPath, h.storage);
  cleanup.push(async () => copy.close());
  const reopened = new SessionService({ ...h.host, db: copy.db });
  cleanup.push(() => reopened.close());
  await reopened.waitReady();
  await h.scenario("parent", [
    { toolCalls: [{ name: "session_status", args: { sessionId: child.id } }] },
    { text: "{{status}}" },
  ]);
  reopened.send(parent.id, "Inspect the recovered child.");
  expect(await reopened.waitIdle(parent.id)).toEqual({ stopReason: "end" });
  expect(result(reopened, parent.id, "session_status")).toMatchObject({ status: "interrupted" });
});

it("respects workbench-disabled delegation tools even for an ordinary parent", async () => {
  const h = await setup({ disabledTools: ["session_launch"] });
  const parent = h.service.create();
  await h.scenario("parent", [{ toolCalls: [{ name: "session_launch", args: childRequest }] }]);
  h.service.send(parent.id, "Try a disabled tool.");
  await h.service.waitIdle(parent.id);
  expect(h.requests.at(0)?.tools.map((tool) => tool.name)).not.toContain("session_launch");
  expect(h.service.listDelegated(parent.id)).toEqual([]);
});

it("removes a hub listener if stored replay throws during subscription", async () => {
  const h = await setup();
  const parent = h.service.create();
  const hub = new SessionHub(h.handle.db, () => "2026-11-19T12:00:00Z");
  h.handle.db.prepare("UPDATE events SET payload_json='{}' WHERE session_id=? AND seq=1").run(parent.id);
  const listener = vi.fn();
  expect(() => hub.subscribe(parent.id, 0, listener)).toThrow();
  hub.emit(parent.id, { type: "session.updated", title: "Later event." });
  expect(listener).not.toHaveBeenCalled();
});

it.each(["session_status", "session_wait"])(
  "reprojects the complete reply when Agent masking changes before publishing %s",
  async (name) => {
    let mask = false;
    const secret = "CRED_SCOPED_TOKEN";
    const prefix = "a".repeat(19994);
    const fullReply = prefix + secret + "b".repeat(40000 - prefix.length - secret.length);
    const h = await setup({
      masking: () => mask,
      knownSecrets: () => [secret],
      scrub: (text) => text.replaceAll(secret, "[redacted]".repeat(30)),
    });
    await h.scenario("child", [{ text: fullReply }]);
    const parent = h.service.create();
    h.service.send(parent.id, "Prepare the parent tool host.");
    await h.service.waitIdle(parent.id);
    const child = await h.service.launchDelegated(parent.id, { ...childRequest, requestId: "mask-toggle" });
    await h.service.waitIdle(child.sessionId);
    const tool = h.tool("replay/parent", name);
    const args = { sessionId: child.sessionId };
    const initial = await tool.execute(args, new AbortController().signal);
    mask = true;
    const published = tool.publish?.(args, initial);
    expect(published?.length).toBeLessThanOrEqual(32000);
    expect(published && JSON.parse(published)).toMatchObject({
      status: "completed",
      reply: expect.stringContaining("[redacted]"),
      truncated: true,
    });
    expect(published).not.toContain("CRED_S");
    expect(initial).not.toContain("CRED_S");
  },
);
