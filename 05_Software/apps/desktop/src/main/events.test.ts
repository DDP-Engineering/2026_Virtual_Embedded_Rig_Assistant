import { existsSync } from "node:fs";
import { scrub } from "@vera/core";
import { emptySessionState, eventEnvelopeSchema, workbenchSchema } from "@vera/shared";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import * as sessionOutput from "./events.js";

let createEventEmitter: typeof import("./events.js").createEventEmitter;
let createDeltaCoalescer: typeof import("./events.js").createDeltaCoalescer;
beforeAll(async () => {
  expect(existsSync(new URL("./events.ts", import.meta.url)), "event emitter and coalescer exist").toBe(true);
  ({ createEventEmitter, createDeltaCoalescer } = await import("./events.js"));
});
afterEach(() => vi.useRealTimers());
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
    [privateKey]: { detail: privateKey },
  });
  for (const short of ["t", "type", "config", "warnings", "name", "/", "ask", "UNKNOWN_KEY"]) {
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
