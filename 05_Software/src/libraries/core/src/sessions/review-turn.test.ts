import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { type TodoItem, veraError } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { ReferenceRuntime } from "../agent/runtime.js";
import type { RuntimeHost } from "../agent/types.js";
import { ToolRegistry } from "../tools/registry.js";
import { todoTool } from "../tools/todo.js";
import { fixture, input, plan, target } from "./review-turn.test-support.js";

it("atomically accepts one exact owned envelope and user turn, publishes after commit, and reconciles its receipt across reopen", async () => {
  const env = await fixture();
  const input = { expectedPlanRevision: 1, expectedFeedbackRevision: 2 };
  const whole = { ...target, stepIndex: 0, range: null };
  env.service.savePlanComment(env.id, {
    action: "create",
    expectedFeedbackRevision: 1,
    target: whole,
    text: "Second occurrence",
  });
  const other = env.service.create().id;
  env.record(other, { type: "todo.updated", items: [{ text: "Foreign plan", status: "pending" }] });
  env.service.savePlanComment(other, {
    action: "create",
    expectedFeedbackRevision: 0,
    text: "Foreign feedback",
    target: { revision: 1, stepIndex: 0, stepText: "Foreign plan", range: null },
  });
  const requests = vi.spyOn(env.host.gateway, "stream");
  const seen: unknown[] = [];
  env.service.subscribe(env.id, env.service.revision(env.id).seq, (_seq, event) => {
    if (event.type !== "plan.review.submitted") return;
    const state = env.service.get(env.id).snapshot;
    let ordinaryCode: unknown;
    try {
      env.service.send(env.id, "Execute the plan now");
    } catch (error) {
      ordinaryCode = (error as { code: unknown }).code;
    }
    seen.push({
      drafts: state.planComments.length,
      user: state.items.find((item) => item.kind === "user"),
      status: state.status,
      turns: state.turns.length,
      messages: env.host.db.prepare("SELECT COUNT(*) AS n FROM messages WHERE session_id=?").get(env.id),
      ordinaryCode,
      replay: env.service.reviewPlan(env.id, input),
    });
  });
  const receipt = env.service.reviewPlan(env.id, input);
  expect(env.service.reviewPlan(env.id, input)).toEqual(receipt);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "end" });
  expect(seen).toEqual([
    {
      drafts: 0,
      status: "running",
      turns: 1,
      messages: { n: 1 },
      ordinaryCode: "BUSY",
      replay: receipt,
      user: expect.objectContaining({ kind: "user", id: receipt.messageId, reviewId: receipt.reviewId }),
    },
  ]);
  expect(requests).toHaveBeenCalledOnce();
  const request = requests.mock.calls[0]?.[0];
  expect(request?.system).toContain("Canonical engineering prompt");
  expect(request?.system).toMatch(/brief.*expla/i);
  expect(request?.system).toMatch(/clarification/i);
  expect(request?.system).toMatch(/todo/);
  expect(request?.system).toMatch(/never execute/i);
  const text = request?.messages.findLast((message) => message.role === "user")?.content;
  expect(typeof text).toBe("string");
  const payload = JSON.parse(
    String(text).split("\n<plan-review>\n")[1]?.split("\n</plan-review>")[0] ?? "null",
  );
  expect(payload).toMatchObject({
    planRevision: 1,
    feedbackRevision: 2,
    plan: plan.map((step, i) => ({ ...step, stepNumber: i + 1 })),
    comments: [
      { text: 'Vérifier 😀\n"quoted" feedback', target: { ...target, stepNumber: 2 } },
      { text: "Second occurrence", target: { ...whole, stepNumber: 1 } },
    ],
  });
  expect(JSON.stringify(payload)).not.toContain("Foreign");
  const saved = env.service.get(env.id).snapshot;
  expect(saved.todos).toEqual(plan); // A prose-only clarification never changes structured data.
  expect(saved.planReviews[0]).toMatchObject({
    id: receipt.reviewId,
    turnId: receipt.turnId,
    messageId: receipt.messageId,
    comments: [{ target }, { target: whole }],
    stopReason: "end",
  });
  const events = env.service.exportSession(env.id).events;
  expect(events.filter((row) => row.event.type === "message.user")).toHaveLength(1);
  expect(events.filter((row) => row.event.type === "turn.started")).toHaveLength(1);
  env.record(env.id, { type: "todo.updated", items: [] });
  await env.reopen();
  expect(env.service.reviewPlan(env.id, input)).toEqual(receipt);
  expect(requests).toHaveBeenCalledOnce();
  expect(env.service.get(env.id).snapshot.planReviews).toEqual(saved.planReviews);
});

it("rolls back envelope, user row, draft consumption and running status if any admission write fails", async () => {
  const env = await fixture();
  const input = { expectedPlanRevision: 1, expectedFeedbackRevision: 2 };
  env.service.savePlanComment(env.id, {
    action: "create",
    expectedFeedbackRevision: 1,
    target: { ...target, range: null },
    text: "Second captured draft",
  });
  const sends = vi.fn();
  env.host.runtime = (host) => {
    const runtime = new ReferenceRuntime(host);
    const send = runtime.send.bind(runtime);
    runtime.send = (text) => {
      sends();
      return send(text);
    };
    return runtime;
  };
  const stream = vi.spyOn(env.host.gateway, "stream");
  const published = vi.fn();
  env.service.subscribe(env.id, env.service.revision(env.id).seq, published);
  const before = env.service.get(env.id);
  env.host.db.exec(
    "CREATE TEMP TRIGGER reject_turn BEFORE INSERT ON events WHEN NEW.type='turn.started' BEGIN SELECT RAISE(ABORT,'admission failed'); END",
  );
  expect(() => env.service.reviewPlan(env.id, input)).toThrow("admission failed");
  expect(env.service.get(env.id)).toEqual(before);
  expect(env.host.db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
  expect(sends).not.toHaveBeenCalled();
  expect(stream).not.toHaveBeenCalled();
  expect(published).not.toHaveBeenCalled();
  env.host.db.exec("DROP TRIGGER reject_turn");
  env.service.reviewPlan(env.id, input);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "end" });
});

it("rejects empty, stale, changed-projection and changed-feedback submissions without consuming drafts", async () => {
  const env = await fixture();
  const blank = env.service.create().id;
  expect(() =>
    env.service.reviewPlan(blank, { expectedPlanRevision: 0, expectedFeedbackRevision: 0 }),
  ).toThrow(expect.objectContaining({ code: "INVALID" }));
  env.record(blank, { type: "todo.updated", items: plan });
  expect(() =>
    env.service.reviewPlan(blank, { expectedPlanRevision: 1, expectedFeedbackRevision: 0 }),
  ).toThrow(expect.objectContaining({ code: "INVALID" }));
  const before = env.service.get(env.id);
  for (const [request, code] of [
    [{ ...input, expectedPlanRevision: -1 }, "INVALID"],
    [{ ...input, expectedFeedbackRevision: 0 }, "CONFLICT"],
    [{ ...input, plan } as never, "INVALID"],
  ] as const)
    expect(() => env.service.reviewPlan(env.id, request)).toThrow(expect.objectContaining({ code }));
  env.host.scrub = (text) => text.replaceAll("😀", "[REDACTED]");
  expect(() => env.service.reviewPlan(env.id, input)).toThrow(expect.objectContaining({ code: "CONFLICT" }));
  delete env.host.scrub;
  expect(env.service.get(env.id)).toEqual(before);
  env.record(env.id, { type: "todo.updated", items: plan });
  expect(() => env.service.reviewPlan(env.id, { ...input, expectedPlanRevision: 2 })).toThrow(
    expect.objectContaining({ code: "CONFLICT" }),
  );
  env.record(env.id, { type: "todo.updated", items: [] });
  expect(() => env.service.reviewPlan(env.id, { ...input, expectedPlanRevision: 3 })).toThrow(
    expect.objectContaining({ code: "INVALID" }),
  );
  expect(env.service.get(env.id).snapshot.planComments).toHaveLength(1);
  expect(env.host.db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
});

for (const mode of ["read-only", "ask", "auto-edit", "bypass"] as const)
  it(`enforces the built-in-todo-only boundary against hostile calls and injected overrides in ${mode}`, async () => {
    const env = await fixture(mode);
    const overridden = vi.fn(async () => {
      throw Error("Injected todo must not run");
    });
    env.host.registry = new ToolRegistry([{ ...todoTool, execute: overridden }]);
    const approve = vi.fn(async (_request: unknown) => true);
    env.host.permissions = { allow: approve };
    const stopBackground = vi.fn();
    const programAccess = vi.fn(() => ({ runner: { stopSession: stopBackground } }));
    Object.defineProperty(env.host, "programs", { configurable: true, get: programAccess });
    const revised: TodoItem[] = [{ text: "Review GPIO safely", status: "pending" }];
    await env.script([
      {
        toolCalls: [
          { name: "write", args: { path: "board.txt", content: "Changed" } },
          { name: "edit", args: { path: "board.txt", oldText: "Original", newText: "Changed" } },
          { name: "read", args: { path: "board.txt" } },
          { name: "run_command", args: { command: "touch executed" } },
          { name: "run_program", args: { program: "execute" } },
          { name: "permission_change", args: { mode: "bypass" } },
          { name: "todo", args: { items: revised } },
        ],
      },
      { text: "Brief explanation: revised GPIO checks only." },
    ]);
    const requests = vi.spyOn(env.host.gateway, "stream");
    let runtimeHost: RuntimeHost | undefined;
    env.host.runtime = (host) => {
      runtimeHost = host;
      return new ReferenceRuntime(host);
    };
    env.service.reviewPlan(env.id, input);
    expect(
      await runtimeHost?.approve(
        { type: "toolCall", id: "hostile", name: "write", arguments: {} },
        new AbortController().signal,
      ),
    ).toBe("denied");
    expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "end" });
    for (const [request] of requests.mock.calls)
      expect(request.tools.map((tool) => tool.name)).toEqual(["todo"]);
    expect(env.service.get(env.id).snapshot.todos).toEqual(revised);
    expect(env.service.get(env.id).snapshot.approvals).toEqual([]);
    expect(env.service.get(env.id).snapshot.mode).toBe(mode);
    expect(await readFile(join(env.root, "board.txt"), "utf8")).toBe("Original board");
    expect(overridden).not.toHaveBeenCalled();
    expect(programAccess).not.toHaveBeenCalled();
    expect(approve).toHaveBeenCalledOnce();
    expect(approve.mock.calls[0]?.[0]).toMatchObject({ tool: { name: "todo" } });
    expect(stopBackground).not.toHaveBeenCalled();
  });

it("respects disabled todo, blocks steering throughout review and Stop does not stop background runs", async () => {
  const env = await fixture();
  env.host.disabledTools = ["todo"];
  const stopBackground = vi.fn();
  env.host.programs = { runner: { stopSession: stopBackground } } as never;
  let release: () => void = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const stream = env.host.gateway.stream.bind(env.host.gateway);
  env.host.gateway.stream = async function* (request) {
    expect(request.tools).toEqual([]);
    await held;
    yield* stream(request);
  };
  const receipt = env.service.reviewPlan(env.id, input);
  await vi.waitFor(() => expect(env.service.get(env.id).snapshot.usage).toBeDefined());
  expect(() => env.service.send(env.id, "Execute steps")).toThrow(expect.objectContaining({ code: "BUSY" }));
  env.service.savePlanComment(env.id, {
    action: "create",
    expectedFeedbackRevision: 2,
    target,
    text: "Later draft",
  });
  expect(() => env.service.reviewPlan(env.id, { ...input, expectedFeedbackRevision: 3 })).toThrow(
    expect.objectContaining({ code: "BUSY" }),
  );
  env.service.stop(env.id);
  release();
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "aborted" });
  expect(stopBackground).not.toHaveBeenCalled();
  expect(env.service.get(env.id).snapshot.items.some((item) => item.kind === "user" && item.pending)).toBe(
    false,
  );
  expect(env.service.get(env.id).snapshot.planReviews[0]).toMatchObject({
    id: receipt.reviewId,
    stopReason: "aborted",
  });
  expect(env.service.get(env.id).snapshot.planComments).toMatchObject([{ text: "Later draft" }]);
});

it("refuses recovered queue and ordinary work, archived or lost authority before preparing a review", async () => {
  const env = await fixture();
  env.record(env.id, { type: "message.queued", messageId: "pending", text: "Execute", timestamp: 1 });
  expect(() => env.service.reviewPlan(env.id, input)).toThrow(expect.objectContaining({ code: "BUSY" }));
  env.record(env.id, { type: "message.delivered", messageIds: ["pending"] });
  env.service.setArchived(env.id, true);
  expect(() => env.service.reviewPlan(env.id, input)).toThrow(expect.objectContaining({ code: "DENIED" }));
  env.service.setArchived(env.id, false);
  env.host.assertWritable = () => {
    throw veraError("DENIED");
  };
  expect(() => env.service.reviewPlan(env.id, input)).toThrow(expect.objectContaining({ code: "DENIED" }));
  delete env.host.assertWritable;
  env.host.readOnly = true;
  expect(() => env.service.reviewPlan(env.id, input)).toThrow(expect.objectContaining({ code: "DENIED" }));
  env.host.readOnly = false;
  env.service.send(env.id, "ordinary");
  expect(() => env.service.reviewPlan(env.id, input)).toThrow(expect.objectContaining({ code: "BUSY" }));
  await env.service.waitIdle(env.id);
  expect(env.service.get(env.id).snapshot.planReviews).toEqual([]);
});

it("closes accepted startup/identity failures without admitting a second user message", async () => {
  for (const failure of ["startup", "identity"] as const) {
    const env = await fixture();
    env.host.runtime = (host) => {
      const runtime = new ReferenceRuntime(host);
      if (failure === "startup")
        runtime.send = () => {
          throw Error("Startup failed");
        };
      else {
        const start = runtime.start.bind(runtime);
        runtime.start = (init) => {
          const { requestIdentity: _, ...wrong } = init;
          start(wrong);
        };
      }
      return runtime;
    };
    const stream = vi.spyOn(env.host.gateway, "stream");
    const receipt = env.service.reviewPlan(env.id, input);
    expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "error" });
    expect(env.service.get(env.id).snapshot.planReviews).toMatchObject([
      { id: receipt.reviewId, stopReason: "error" },
    ]);
    expect(
      env.service.exportSession(env.id).events.filter((e) => e.event.type === "message.user"),
    ).toHaveLength(1);
    expect(stream).not.toHaveBeenCalled();
    expect(env.service.reviewPlan(env.id, input)).toEqual(receipt);
  }
});
