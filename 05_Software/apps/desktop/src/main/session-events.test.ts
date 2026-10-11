import type { EventEnvelope } from "@vera/shared";
import { afterEach, expect, it, vi } from "vitest";
import { createSessionTransport } from "./session-events.js";

afterEach(() => vi.useRealTimers());
it("coalesces text per session subscriber at50ms and flushes before terminal persisted events", () => {
  vi.useFakeTimers();
  const events: EventEnvelope[] = [];
  const transport = createSessionTransport("ses_01J00000000000000000000000", "sub", (e) => events.push(e));
  transport.on(undefined, { type: "message.delta", messageId: "m", text: "a" });
  transport.on(undefined, { type: "message.delta", messageId: "m", text: "b" });
  vi.advanceTimersByTime(49);
  expect(events).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(events).toEqual([
    {
      topic: "session",
      id: "ses_01J00000000000000000000000",
      subscriptionId: "sub",
      event: { type: "message.delta", messageId: "m", text: "ab" },
    },
  ]);
  transport.on(undefined, { type: "tool.update", callId: "c", text: "work" });
  transport.on(3, { type: "turn.done", turnId: "t", stopReason: "end" });
  expect(events.map((e) => e.event.type)).toEqual(["message.delta", "tool.update", "turn.done"]);
  transport.on(undefined, { type: "message.delta", messageId: "m", text: "discard" });
  transport.dispose();
  vi.advanceTimersByTime(100);
  expect(events).toHaveLength(3);
});
