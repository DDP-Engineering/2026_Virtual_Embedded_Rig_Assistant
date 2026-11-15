import { describe, expect, it } from "vitest";
import * as shared from "./index.js";

// REQ-UX-3001bd00: execution deferred by explicit user policy.
it("replays queued and delivered markers without duplicating users or clearing undelivered messages", () => {
  let state = shared.emptySessionState();
  const queued = shared.sessionEventSchema.parse({
    type: "message.queued",
    messageId: "q",
    text: "Steer",
    timestamp: 1,
  });
  state = shared.applySessionEvent(state, queued);
  state = shared.applySessionEvent(state, queued);
  state = shared.applySessionEvent(state, { type: "turn.done", turnId: "t", stopReason: "aborted" });
  expect(shared.sessionStateSchema.parse(state).items).toEqual([
    { kind: "user", id: "q", text: "Steer", timestamp: 1, pending: true },
  ]);
  state = shared.applySessionEvent(state, { type: "message.delivered", messageIds: ["q"] });
  state = shared.applySessionEvent(state, { type: "message.delivered", messageIds: ["q"] });
  expect(state.items).toEqual([{ kind: "user", id: "q", text: "Steer", timestamp: 1 }]);
  expect(
    shared.sessionStateSchema.parse({ ...state, items: [{ kind: "user", id: "old", text: "Old" }] }).items,
  ).toHaveLength(1);
});

// REQ-UX-d1b480e0. Execution deferred; optional fields support historical events.
it("projects compaction status and request view size while retaining actual provider usage", () => {
  let state = shared.emptySessionState();
  for (const compactionStatus of ["none", "running", "completed", "unavailable", "failed"] as const) {
    const event = shared.sessionEventSchema.parse({
      type: "usage.updated",
      inputTokens: 17,
      outputTokens: 3,
      contextTokens: 1200,
      requestViewTokens: 1200,
      compactionStatus,
      estimated: true,
    });
    state = shared.applySessionEvent(state, event);
    expect(state.usage).toMatchObject({ compactionStatus, requestViewTokens: 1200, inputTokens: 17 });
  }
  state = shared.applySessionEvent(state, { type: "usage.updated", inputTokens: 34, outputTokens: 6 });
  expect(shared.sessionStateSchema.parse(state).usage).toMatchObject({
    inputTokens: 34,
    outputTokens: 6,
    compactionStatus: "failed",
    requestViewTokens: 1200,
  });
});

it("folds terminal events identically with or without live deltas", () => {
  expect(typeof shared.applySessionEvent).toBe("function");
  const events: shared.SessionEvent[] = [
    { type: "session.updated", title: "Board", status: "idle", mode: "ask" },
    { type: "message.user", messageId: "u", text: "Read" },
    { type: "turn.started", turnId: "t" },
    { type: "message.delta", messageId: "m", text: "partial" },
    { type: "reasoning.delta", messageId: "m", text: "transient" },
    { type: "message.done", messageId: "m", text: "Reading", citations: [] },
    { type: "tool.started", callId: "c", name: "read", args: { path: "a" } },
    { type: "tool.update", callId: "c", text: "progress" },
    { type: "tool.done", callId: "c", ok: true, summary: "a", durationMs: 1 },
    {
      type: "message.done",
      messageId: "a",
      text: "Answer [[a#L1-L1]]",
      citations: [{ ref: "a#L1-L1", valid: true }],
    },
    { type: "usage.updated", inputTokens: 4, outputTokens: 2, contextTokens: 100, estimated: true },
    { type: "usage.updated", inputTokens: 8, outputTokens: 3 },
    { type: "turn.done", turnId: "t", stopReason: "end" },
  ];
  const initial = shared.emptySessionState();
  const live = events.reduce(shared.applySessionEvent, initial);
  const saved = events.filter((e) => !shared.isLiveSessionEvent(e)).reduce(shared.applySessionEvent, initial);
  expect(live).toEqual(saved);
  expect(initial.items).toEqual([]);
  expect(live.items.map((i) => i.kind)).toEqual(["user", "assistant", "tool", "assistant"]);
  expect(live.usage).toMatchObject({ inputTokens: 8, outputTokens: 3, contextTokens: 100 });
  expect(live.turns).toEqual([{ turnId: "t", steps: 1, stopReason: "end" }]);
  expect(shared.sessionStateSchema.parse(live)).toEqual(live);
});
it("projects reserved approval, change, artifact, todo, interruption and error events", () => {
  const events: shared.SessionEvent[] = [
    { type: "session.updated", modelRef: "openai/test", mode: "auto-edit" },
    { type: "turn.started", turnId: "t" },
    {
      type: "approval.requested",
      approvalId: "a",
      callId: "c",
      requestSha256: "sha",
      tool: "edit",
      path: "board.txt",
      diff: "+line",
      bytes: 5,
    },
    { type: "approval.decided", approvalId: "missing", decision: "denied", by: "user" },
    { type: "approval.decided", approvalId: "a", decision: "approved", by: "mode" },
    { type: "change.recorded", changeId: 1, path: "board.txt", added: 1, removed: 0 },
    { type: "artifact.saved", artifactId: "report", name: "report.txt", bytes: 5 },
    { type: "todo.updated", items: [{ text: "check", status: "done" }] },
    { type: "error", code: "INTERNAL", messageKey: "errors.INTERNAL", retryable: false },
    { type: "session.interrupted", turnId: "t" },
    { type: "turn.done", turnId: "t", stopReason: "aborted" },
    { type: "session.updated", modelRef: null },
  ];
  for (const event of events) expect(shared.sessionEventSchema.parse(event)).toEqual(event);
  const state = events.reduce(shared.applySessionEvent, shared.emptySessionState());
  expect(state).toMatchObject({
    status: "idle",
    modelRef: null,
    mode: "auto-edit",
    activeTurnId: null,
    interrupted: ["t"],
    approvals: [{ approvalId: "a", decision: "approved", by: "mode" }],
    changes: [{ changeId: 1 }],
    artifacts: [{ artifactId: "report" }],
    todos: [{ text: "check", status: "done" }],
    items: [{ kind: "error", code: "INTERNAL" }],
  });
  expect(shared.sessionStateSchema.parse(state)).toEqual(state);
});
it("drops unfinalized live text at an aborted boundary and detaches event-owned data", () => {
  const durable: shared.SessionEvent[] = [
    { type: "turn.started", turnId: "t" },
    { type: "turn.done", turnId: "t", stopReason: "aborted" },
  ];
  const live: shared.SessionEvent[] = [
    durable[0] as shared.SessionEvent,
    { type: "message.delta", messageId: "m", text: "unfinalized" },
    durable[1] as shared.SessionEvent,
  ];
  expect(live.reduce(shared.applySessionEvent, shared.emptySessionState())).toEqual(
    durable.reduce(shared.applySessionEvent, shared.emptySessionState()),
  );
  const event: shared.SessionEvent = { type: "todo.updated", items: [{ text: "read", status: "pending" }] };
  const state = shared.applySessionEvent(shared.emptySessionState(), event);
  event.items[0]!.text = "mutated";
  expect(state.todos[0]?.text).toBe("read");
});

/** The pre-PERF-02 reducer, kept verbatim as the oracle for the in-place fold and the copy-on-write apply. */
function oracleApply(state: shared.SessionState, input: shared.SessionEvent): shared.SessionState {
  const event: shared.SessionEvent = JSON.parse(JSON.stringify(input));
  const s: shared.SessionState = JSON.parse(JSON.stringify(state));
  const turnId = s.activeTurnId;
  switch (event.type) {
    case "session.updated": {
      const { type: _, ...fields } = event;
      Object.assign(s, fields);
      break;
    }
    case "session.interrupted":
      s.interrupted.push(event.turnId);
      break;
    case "turn.started":
      s.activeTurnId = event.turnId;
      s.usage = { inputTokens: 0, outputTokens: 0 };
      s.status = "running";
      s.turns.push({ turnId: event.turnId, steps: 0, stopReason: null });
      break;
    case "turn.done":
      s.activeTurnId = null;
      s.status = event.stopReason === "error" ? "error" : "idle";
      for (const t of s.turns) if (t.turnId === event.turnId) t.stopReason = event.stopReason;
      s.items = s.items.filter((item) => item.kind !== "assistant" || !item.streaming);
      for (const i of s.items) {
        if (i.kind === "assistant") i.streaming = false;
        if (i.kind === "tool" && i.status === "running") {
          i.status = "error";
          i.summary = "Interrupted.";
        }
      }
      break;
    case "message.user":
      if (!s.items.some((i) => i.id === event.messageId))
        s.items.push({ kind: "user", id: event.messageId, text: event.text });
      break;
    case "message.queued":
      if (!s.items.some((i) => i.id === event.messageId))
        s.items.push({
          kind: "user",
          id: event.messageId,
          text: event.text,
          pending: true,
          timestamp: event.timestamp,
        });
      break;
    case "message.delivered":
      for (const item of s.items)
        if (item.kind === "user" && event.messageIds.includes(item.id)) delete item.pending;
      break;
    case "reasoning.delta":
      break;
    case "message.delta": {
      let i = s.items.find((i) => i.kind === "assistant" && i.id === event.messageId);
      if (!i) {
        i = { kind: "assistant", id: event.messageId, turnId, text: "", streaming: true, citations: [] };
        s.items.push(i);
      }
      if (i.kind === "assistant") i.text += event.text;
      break;
    }
    case "message.done": {
      const item = {
        kind: "assistant" as const,
        id: event.messageId,
        turnId,
        text: event.text,
        streaming: false,
        citations: event.citations,
      };
      const index = s.items.findIndex((i) => i.kind === "assistant" && i.id === event.messageId);
      if (index < 0) s.items.push(item);
      else s.items[index] = item;
      break;
    }
    case "tool.started":
      s.items.push({
        kind: "tool",
        id: event.callId,
        turnId,
        name: event.name,
        args: event.args,
        status: "running",
      });
      for (const t of s.turns) if (t.turnId === turnId) t.steps++;
      break;
    case "tool.update":
      break;
    case "tool.done": {
      const i = s.items.find((i) => i.kind === "tool" && i.id === event.callId);
      if (i?.kind === "tool") {
        i.status = event.ok ? "ok" : "error";
        i.summary = event.summary;
        i.durationMs = event.durationMs;
        if (event.preview !== undefined) i.preview = event.preview;
      }
      break;
    }
    case "approval.requested": {
      const { type: _, ...a } = event;
      s.approvals.push({ ...a, decision: null });
      s.status = "awaiting_approval";
      break;
    }
    case "approval.decided": {
      const a = s.approvals.find((a) => a.approvalId === event.approvalId);
      if (a) {
        a.decision = event.decision;
        a.by = event.by;
      }
      s.status = s.activeTurnId ? "running" : "idle";
      break;
    }
    case "change.recorded": {
      const { type: _, ...c } = event;
      s.changes.push(c);
      break;
    }
    case "artifact.saved": {
      const { type: _, ...a } = event;
      s.artifacts.push(a);
      break;
    }
    case "todo.updated":
      s.todos = event.items;
      break;
    case "usage.updated": {
      const input = Math.max(0, event.inputTokens - s.usage.inputTokens);
      const output = Math.max(0, event.outputTokens - s.usage.outputTokens);
      const owners = new Set(event.promptIds);
      for (const item of s.items) {
        if (item.kind !== "user" || item.pending || !owners.has(item.id)) continue;
        const usage = item.usage ?? {};
        if (input || output) {
          usage.inputTokens = (usage.inputTokens ?? 0) + input;
          usage.outputTokens = (usage.outputTokens ?? 0) + output;
        }
        if (
          usage.contextTokens === undefined &&
          event.contextTokens !== undefined &&
          event.compactionStatus !== "running"
        ) {
          usage.contextTokens = event.requestViewTokens ?? event.contextTokens;
          if (event.contextWindow) usage.contextWindow = event.contextWindow;
          usage.estimated = event.estimated ?? true;
        }
        if (owners.size > 1) usage.shared = true;
        item.usage = usage;
      }
      const { type: _, ...u } = event;
      s.usage = { ...s.usage, ...u };
      break;
    }
    case "error": {
      const { type: _, ...e } = event;
      s.items.push({ kind: "error", id: `error-${s.items.filter((i) => i.kind === "error").length}`, ...e });
      break;
    }
  }
  return s;
}

/** Every event type, two turns, duplicates, unknown references and cross-kind id collisions. */
const mixed: shared.SessionEvent[] = [
  {
    type: "session.updated",
    title: "Board",
    status: "idle",
    mode: "ask",
    modelRef: "openai/test",
    reasoning: "high",
  },
  { type: "message.user", messageId: "u1", text: "Read the board" },
  { type: "message.user", messageId: "u1", text: "duplicate" },
  { type: "turn.started", turnId: "t1" },
  { type: "message.queued", messageId: "q1", text: "Steer", timestamp: 5 },
  { type: "message.queued", messageId: "q1", text: "Steer again", timestamp: 6 },
  { type: "reasoning.delta", messageId: "m1", text: "thinking" },
  { type: "message.delta", messageId: "m1", text: "Hel" },
  { type: "message.delta", messageId: "m1", text: "lo" },
  { type: "message.done", messageId: "m1", text: "Hello", citations: [{ ref: "a#L1-L1", valid: true }] },
  { type: "tool.started", callId: "c1", name: "read", args: { path: "a", lines: [1, 2] } },
  { type: "tool.update", callId: "c1", text: "progress" },
  { type: "tool.done", callId: "c1", ok: true, summary: "read a", preview: "x".repeat(300), durationMs: 3 },
  { type: "tool.done", callId: "missing", ok: false, summary: "ignored", durationMs: 1 },
  { type: "tool.started", callId: "c2", name: "grep", args: { pattern: "GPIO" } },
  {
    type: "approval.requested",
    approvalId: "a1",
    callId: "c3",
    requestSha256: "sha",
    tool: "edit",
    path: "board.txt",
    diff: "+line",
    bytes: 5,
  },
  { type: "approval.decided", approvalId: "missing", decision: "denied", by: "user" },
  { type: "approval.decided", approvalId: "a1", decision: "approved", by: "mode" },
  { type: "change.recorded", changeId: 1, path: "board.txt", added: 1, removed: 0 },
  { type: "artifact.saved", artifactId: "report", name: "report.txt", bytes: 5 },
  { type: "todo.updated", items: [{ text: "check", status: "in_progress" }] },
  { type: "todo.updated", items: [{ text: "check", status: "done" }] },
  {
    type: "usage.updated",
    inputTokens: 10,
    outputTokens: 2,
    promptIds: ["u1", "q1"],
    contextTokens: 900,
    contextWindow: 8000,
    estimated: false,
  },
  { type: "message.delivered", messageIds: ["q1", "unknown"] },
  { type: "usage.updated", inputTokens: 14, outputTokens: 4, promptIds: ["u1", "q1"], contextTokens: 950 },
  { type: "error", code: "INTERNAL", messageKey: "errors.INTERNAL", retryable: false },
  { type: "message.delta", messageId: "m2", text: "unfinalized" },
  { type: "error", code: "RATE", messageKey: "errors.RATE", retryable: true },
  { type: "session.interrupted", turnId: "t1" },
  { type: "turn.done", turnId: "t1", stopReason: "aborted" },
  { type: "turn.started", turnId: "t2" },
  { type: "message.user", messageId: "m1", text: "collides with an assistant id" },
  { type: "message.delta", messageId: "u1", text: "assistant reusing a user id" },
  { type: "message.done", messageId: "u1", text: "assistant reusing a user id, done", citations: [] },
  { type: "tool.started", callId: "u1", name: "list", args: { all: true } },
  { type: "tool.done", callId: "u1", ok: false, summary: "failed", durationMs: 2 },
  { type: "usage.updated", inputTokens: 3, outputTokens: 1, compactionStatus: "running", contextTokens: 10 },
  { type: "error", code: "PROVIDER", messageKey: "errors.PROVIDER", retryable: true },
  { type: "turn.done", turnId: "t2", stopReason: "error" },
  { type: "session.updated", status: "idle", modelRef: null, reasoning: null },
];

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
const owned = (events: shared.SessionEvent[]): shared.SessionEvent[] => JSON.parse(JSON.stringify(events));

describe("PERF-02 reducer without full-state copies (REQ-FUNC-5e2438d5)", () => {
  it("covers every session event type in the mixed sequence", () => {
    const all: Record<shared.SessionEvent["type"], true> = {
      "session.updated": true,
      "session.interrupted": true,
      "turn.started": true,
      "turn.done": true,
      "message.user": true,
      "message.queued": true,
      "message.delivered": true,
      "message.delta": true,
      "reasoning.delta": true,
      "message.done": true,
      "tool.started": true,
      "tool.update": true,
      "tool.done": true,
      "approval.requested": true,
      "approval.decided": true,
      "change.recorded": true,
      "artifact.saved": true,
      "todo.updated": true,
      "usage.updated": true,
      error: true,
    };
    expect(new Set(mixed.map((e) => e.type))).toEqual(new Set(Object.keys(all)));
    for (const event of mixed) expect(shared.sessionEventSchema.parse(event)).toEqual(event);
  });

  it("folds every prefix like the old reducer, with and without live events", () => {
    const durable = mixed.filter((e) => !shared.isLiveSessionEvent(e));
    for (const events of [mixed, durable])
      for (let n = 0; n <= events.length; n++) {
        const prefix = events.slice(0, n);
        expect(shared.foldSessionEvents(owned(prefix))).toEqual(
          prefix.reduce(oracleApply, shared.emptySessionState()),
        );
      }
    const folded = shared.foldSessionEvents(owned(mixed));
    expect(folded.items.map((i) => `${i.kind}:${i.id}`)).toEqual([
      "user:u1",
      "user:q1",
      "assistant:m1",
      "tool:c1",
      "tool:c2",
      "error:error-0",
      "error:error-1",
      "assistant:u1",
      "tool:u1",
      "error:error-2",
    ]);
    expect(shared.sessionStateSchema.parse(folded)).toEqual(folded);
  });

  it("never writes to the events it folds", () => {
    const events = deepFreeze(owned(mixed));
    expect(shared.foldSessionEvents(events)).toEqual(mixed.reduce(oracleApply, shared.emptySessionState()));
  });

  it("applies every event like the old reducer without mutating the input state or event", () => {
    let state = deepFreeze(shared.emptySessionState());
    let oracle = shared.emptySessionState();
    for (const input of mixed) {
      const next = shared.applySessionEvent(state, deepFreeze(owned([input])[0] as shared.SessionEvent));
      oracle = oracleApply(oracle, input);
      expect(next).toEqual(oracle);
      expect(next).not.toBe(state);
      state = deepFreeze(next);
    }
  });

  it("copies only the collection and item an applied event touches", () => {
    const base = deepFreeze(shared.foldSessionEvents(owned(mixed.slice(0, 15))));
    const delta = shared.applySessionEvent(base, { type: "message.delta", messageId: "m9", text: "new" });
    expect(delta.items).not.toBe(base.items);
    base.items.forEach((item, index) => {
      expect(delta.items[index]).toBe(item);
    });
    for (const key of [
      "turns",
      "approvals",
      "changes",
      "artifacts",
      "todos",
      "interrupted",
      "usage",
    ] as const)
      expect(delta[key]).toBe(base[key]);

    const streamed = deepFreeze(delta);
    const more = shared.applySessionEvent(streamed, { type: "message.delta", messageId: "m9", text: "er" });
    const last = more.items.length - 1;
    expect(more.items[last]).toMatchObject({ text: "newer", streaming: true });
    expect(more.items[last]).not.toBe(streamed.items[last]);
    streamed.items.slice(0, last).forEach((item, index) => {
      expect(more.items[index]).toBe(item);
    });

    const live: shared.SessionEvent[] = [
      { type: "reasoning.delta", messageId: "m9", text: "t" },
      { type: "tool.update", callId: "c2", text: "p" },
    ];
    for (const event of live) {
      const same = shared.applySessionEvent(base, event);
      expect(same.items).toBe(base.items);
      expect(same).toEqual(base);
    }

    const done = shared.applySessionEvent(base, {
      type: "tool.done",
      callId: "c2",
      ok: true,
      summary: "ok",
      durationMs: 1,
    });
    const c2 = base.items.findIndex((i) => i.id === "c2");
    base.items.forEach((item, index) => {
      if (index === c2) expect(done.items[index]).not.toBe(item);
      else expect(done.items[index]).toBe(item);
    });
    expect(done.turns).toBe(base.turns);
  });
});
