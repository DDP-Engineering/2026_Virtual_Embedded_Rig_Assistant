import { existsSync } from "node:fs";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

let createEventEmitter: typeof import("./events.js").createEventEmitter;
let createDeltaCoalescer: typeof import("./events.js").createDeltaCoalescer;
beforeAll(async () => {
  expect(existsSync(new URL("./events.ts", import.meta.url)), "event emitter and coalescer exist").toBe(true);
  ({ createEventEmitter, createDeltaCoalescer } = await import("./events.js"));
});
afterEach(() => vi.useRealTimers());
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
