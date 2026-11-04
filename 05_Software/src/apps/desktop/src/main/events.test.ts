import { existsSync } from "node:fs";
import { scrub } from "@vera/core";
import { emptySessionState, eventEnvelopeSchema, sessionStateSchema, workbenchSchema } from "@vera/shared";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import * as sessionOutput from "./events.js";

let createEventEmitter: typeof import("./events.js").createEventEmitter;
let createDeltaCoalescer: typeof import("./events.js").createDeltaCoalescer;
beforeAll(async () => {
  expect(existsSync(new URL("./events.ts", import.meta.url)), "event emitter and coalescer exist").toBe(true);
  ({ createEventEmitter, createDeltaCoalescer } = await import("./events.js"));
});
afterEach(() => vi.useRealTimers());
it("transports ingest progress and redacts document paths while preserving status/hash/reason", () => {
  const send = vi.fn();
  const emit = createEventEmitter(
    () => ({ isDestroyed: () => false, send }),
    (text) => text.replaceAll("secret", "[REDACTED]"),
  );
  const document = {
    id: 1,
    path: "docs/secret.pdf",
    kind: "pdf" as const,
    sha256: "a".repeat(64),
    bytes: 5,
    mtime: "2026-10-12T00:00:00.000Z",
    pages: null,
    status: "unsupported" as const,
    error: "SIZE_LIMIT" as const,
    indexedAt: null,
  };
  emit({
    topic: "workbench",
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    event: { type: "index.document", path: document.path, document },
  });
  emit({
    topic: "workbench",
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    event: { type: "index.progress", pending: 0, done: 1, failed: 0 },
  });
  expect(send.mock.calls[0]?.[1].event.document).toEqual({ ...document, path: "docs/[REDACTED].pdf" });
  expect(send.mock.calls[0]?.[1].event.path).toBe("docs/[REDACTED].pdf");
  expect(send.mock.calls[1]?.[1].event).toEqual({ type: "index.progress", pending: 0, done: 1, failed: 0 });
  for (const call of send.mock.calls) expect(eventEnvelopeSchema.safeParse(call[1]).success).toBe(true);
});
// REQ-FUNC-2e8a54c7 REQ-DATA-d968385c
it("keeps Plan snapshot and replay schemas valid when late redaction expands 200-character text", () => {
  const state = emptySessionState();
  state.todos = [{ text: "x".repeat(200), status: "done" }];
  const redact = (text: string) => scrub(text, ["x"]);
  const output = sessionOutput.sanitizeSessionSnapshot(state, redact);
  expect(output.todos[0]?.text.length).toBeLessThanOrEqual(200);
  expect(sessionStateSchema.safeParse(output).success).toBe(true);
  const send = vi.fn();
  const emit = createEventEmitter(() => ({ isDestroyed: () => false, send }), redact);
  expect(() =>
    emit({
      topic: "session",
      id: "ses_00000000000000000000000001",
      seq: 5,
      event: { type: "todo.updated", items: state.todos },
    }),
  ).not.toThrow();
  expect(send.mock.calls[0]?.[1].event.items).toEqual(output.todos);
});
// REQ-FUNC-2e8a54c7 REQ-DATA-d968385c
it("redacts todo IDs and bounds snapshot/replay text when a secret becomes known after persistence", () => {
  const state = emptySessionState();
  state.todos = [{ id: "later-private-key", text: "x".repeat(200), status: "pending" }];
  const original = structuredClone(state.todos);
  const secrets: string[] = [];
  const redact = (text: string) => scrub(text, secrets);
  expect(sessionOutput.sanitizeSessionSnapshot(state, redact).todos).toEqual(original);
  // Stored fields can precede credential registration; both output boundaries must use current secrets.
  secrets.push("later-private-key", "x", "pending");
  const output = sessionOutput.sanitizeSessionSnapshot(state, redact);
  expect(JSON.stringify(output.todos)).not.toContain("later-private-key");
  expect(output.todos[0]?.text).not.toContain("x");
  expect(output.todos[0]?.text.length).toBeLessThanOrEqual(200);
  expect(sessionStateSchema.safeParse(output).success).toBe(true);
  const send = vi.fn();
  const emit = createEventEmitter(() => ({ isDestroyed: () => false, send }), redact);
  expect(
    emit({
      topic: "session",
      id: "ses_00000000000000000000000001",
      seq: 4,
      event: { type: "todo.updated", items: original },
    }),
  ).toBe(true);
  const envelope = send.mock.calls[0]?.[1];
  expect(eventEnvelopeSchema.safeParse(envelope).success).toBe(true);
  expect(envelope.event.items).toEqual(output.todos);
  expect(envelope).toMatchObject({
    topic: "session",
    id: "ses_00000000000000000000000001",
    seq: 4,
    event: { type: "todo.updated", items: [{ id: "[REDACTED]", status: "pending" }] },
  });
  expect(state.todos).toEqual(original);
});
it("scrubs get/list session user fields without altering schema identities", () => {
  const privateKey = "fake-session-output-private";
  const redact = (text: string) => scrub(text, [privateKey, "assistant", "ask", "type"]);
  const state = emptySessionState();
  state.title = privateKey;
  state.items.push({
    kind: "assistant",
    id: "m",
    turnId: "t",
    text: privateKey,
    streaming: false,
    citations: [{ ref: `${privateKey}#L1-L1`, valid: false }],
  });
  state.items.push({
    kind: "tool",
    id: "c",
    turnId: "t",
    name: "read",
    args: { [privateKey]: privateKey },
    status: "ok",
    summary: privateKey,
  });
  expect(typeof sessionOutput.sanitizeSessionSnapshot).toBe("function");
  const output = sessionOutput.sanitizeSessionSnapshot(state, redact);
  expect(JSON.stringify(output)).not.toContain(privateKey);
  expect(output).toMatchObject({
    mode: "ask",
    items: [
      { kind: "assistant", id: "m" },
      { kind: "tool", id: "c" },
    ],
  });
  expect(state.title).toBe(privateKey);
});
it("keeps session protocol fields and bounded titles when redaction expands short secrets", () => {
  const send = vi.fn();
  const emit = createEventEmitter(
    () => ({ isDestroyed: () => false, send }),
    (text) => scrub(text, ["x", "type", "ask"]),
  );
  expect(
    emit({
      topic: "session",
      id: "ses_00000000000000000000000001",
      seq: 1,
      event: { type: "session.updated", title: "x".repeat(60), mode: "ask", status: "idle" },
    }),
  ).toBe(true);
  expect(send.mock.calls[0]?.[1].event).toMatchObject({
    type: "session.updated",
    mode: "ask",
    status: "idle",
  });
  expect(send.mock.calls[0]?.[1].event.title.length).toBeLessThanOrEqual(60);
});
it("emits validated envelopes only to a live target", () => {
  const send = vi.fn();
  let dead = false;
  const emit = createEventEmitter(() => ({ isDestroyed: () => dead, send }));
  const envelope = {
    topic: "app" as const,
    id: "app" as const,
    seq: 2,
    event: { type: "settings.changed" as const },
  };
  expect(emit(envelope)).toBe(true);
  expect(send).toHaveBeenCalledExactlyOnceWith("vera:event", envelope);
  dead = true;
  expect(emit(envelope)).toBe(false);
  expect(createEventEmitter(() => undefined)(envelope)).toBe(false);
  expect(() => emit({ ...envelope, seq: -1 })).toThrow();
});
it("scrubs event user text while short secrets preserve protocol fields and discriminants", () => {
  const privateKey = "fake-event-private-WP08";
  const config = workbenchSchema.parse({
    format: 1,
    id: "wb_01J00000000000000000000000",
    name: `Board ${privateKey}`,
    description: privateKey,
    docs: { include: [`docs/${privateKey}/**`] },
    agent: { permission_mode: "ask", model: "provider/model" },
    chat: { detail: "minimal", extension: privateKey },
    [privateKey]: { detail: privateKey },
  });
  for (const short of [
    "t",
    "type",
    "config",
    "warnings",
    "name",
    "/",
    "ask",
    "UNKNOWN_KEY",
    "chat",
    "detail",
    "minimal",
  ]) {
    const send = vi.fn();
    const emit = createEventEmitter(
      () => ({ isDestroyed: () => false, send }),
      (text) => scrub(text, [short, privateKey]),
    );
    expect(emit({ topic: "app", id: "app", event: { type: "settings.changed" } })).toBe(true);
    for (const event of [
      {
        type: "config.changed" as const,
        config,
        warnings: [{ code: "UNKNOWN_KEY" as const, path: privateKey }],
      },
      {
        type: "opened" as const,
        workbench: { config, folder: `/data/${privateKey}`, readOnly: false, warnings: [] },
      },
    ])
      expect(emit({ topic: "workbench", id: config.id, event })).toBe(true);
    for (const [, envelope] of send.mock.calls) {
      expect(eventEnvelopeSchema.safeParse(envelope).success).toBe(true);
      expect(JSON.stringify(envelope)).not.toContain(privateKey);
    }
    expect(send.mock.calls[1]?.[1].event.config.chat.detail).toBe("minimal");
    expect(send.mock.calls[0]?.[1]).toEqual({ topic: "app", id: "app", event: { type: "settings.changed" } });
  }
});
it("merges keyed deltas at 50ms with first-key order and isolates streams", () => {
  vi.useFakeTimers();
  type Delta = { stream: string; message: string; text: string; seq: number };
  const send = vi.fn<(delta: Delta) => void>();
  const queue = createDeltaCoalescer<Delta>({
    key: (value) => JSON.stringify([value.stream, value.message]),
    merge: (previous, next) => ({ ...next, text: previous.text + next.text }),
    emit: send,
  });
  queue.push({ stream: "a", message: "m", text: "hel", seq: 1 });
  queue.push({ stream: "b", message: "m", text: "other", seq: 1 });
  vi.advanceTimersByTime(49);
  queue.push({ stream: "a", message: "m", text: "lo", seq: 2 });
  expect(send).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(send.mock.calls).toEqual([
    [{ stream: "a", message: "m", text: "hello", seq: 2 }],
    [{ stream: "b", message: "m", text: "other", seq: 1 }],
  ]);
  queue.push({ stream: "a", message: "m", text: "!", seq: 3 });
  vi.advanceTimersByTime(50);
  expect(send).toHaveBeenCalledTimes(3);
  queue.dispose();
  expect(vi.getTimerCount()).toBe(0);
});
it("retains latest tool update, flushes before terminal and cancels on dispose", () => {
  vi.useFakeTimers();
  const output: string[] = [];
  const queue = createDeltaCoalescer<{ id: string; value: string }>({
    key: (value) => value.id,
    merge: (_previous, next) => next,
    emit: (value) => output.push(value.value),
  });
  queue.push({ id: "tool", value: "working" });
  queue.push({ id: "tool", value: "done" });
  queue.flush();
  output.push("terminal");
  expect(output).toEqual(["done", "terminal"]);
  expect(vi.getTimerCount()).toBe(0);
  queue.push({ id: "tool", value: "discard" });
  queue.dispose();
  queue.push({ id: "tool", value: "after disposal" });
  vi.advanceTimersByTime(100);
  expect(output).toEqual(["done", "terminal"]);
});
// REQ-SEC-cf3aa5a4 REQ-UX-9744e270
it("redacts known credentials from program approval payloads in events and snapshots", () => {
  const redact = (text: string) => scrub(text, ["s3cr"]);
  const program = {
    pluginId: "esp32-efuse",
    trial: false,
    program: "espefuse",
    programVersion: "5.1.0",
    executable: "/home/s3cr/espefuse",
    args: ["--token=s3cr", "burn-key", "k"],
    cwd: "s3cr",
    risk: "irreversible" as const,
    confirm: "burn-key",
    notes: ["Uses s3cr."],
    files: [{ arg: 2, path: "s3cr/key.bin", sha256: "b".repeat(64) }],
  };
  const requested = {
    type: "approval.requested" as const,
    approvalId: "a",
    callId: "c",
    requestSha256: "a".repeat(64),
    tool: "run_program" as const,
    path: "espefuse",
    diff: "",
    bytes: 0,
    program,
  };
  const event = sessionOutput.sanitizeEvent(
    { topic: "session", id: `ses_${"0".repeat(26)}`, event: requested },
    redact,
  ).event as typeof requested;
  const state = sessionOutput.sanitizeSessionSnapshot(
    {
      ...emptySessionState(),
      approvals: [{ ...requested, type: undefined, decision: null }].map(({ type: _, ...a }) => a),
    },
    redact,
  );
  for (const output of [event.program, state.approvals[0]?.program]) {
    expect(JSON.stringify(output)).not.toContain("s3cr");
    expect(output).toMatchObject({
      confirm: "burn-key",
      risk: "irreversible",
      args: ["--token=[REDACTED]", "burn-key", "k"],
    });
  }
  expect(sessionStateSchema.safeParse(state).success).toBe(true);
});
