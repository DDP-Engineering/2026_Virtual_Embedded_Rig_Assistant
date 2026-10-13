import { expect, it } from "vitest";
import * as shared from "./index.js";

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
