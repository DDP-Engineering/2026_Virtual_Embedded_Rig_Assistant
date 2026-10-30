// REQ-DATA-e31bdc18
import { expect, it } from "vitest";
import {
  applySessionEvent,
  emptySessionState,
  type SessionEvent,
  sessionEventSchema,
  sessionStateSchema,
} from "./index.js";

const fold = (events: unknown[]) =>
  events.map((e) => sessionEventSchema.parse(e)).reduce(applySessionEvent, emptySessionState());
const user = (state: ReturnType<typeof emptySessionState>, id: string) =>
  state.items.find((i) => i.kind === "user" && i.id === id);
const usage = (inputTokens: number, outputTokens: number, promptIds = ["u1"], context?: number) => ({
  type: "usage.updated",
  inputTokens,
  outputTokens,
  promptIds,
  ...(context === undefined
    ? {}
    : { contextTokens: context, requestViewTokens: context, contextWindow: 1000, estimated: true }),
});

it("retains initial per-prompt context and accumulates each reported call once across independent turns and replay", () => {
  const events = [
    { type: "message.user", messageId: "u1", text: "One" },
    { type: "turn.started", turnId: "t1" },
    usage(0, 0, ["u1"], 100),
    usage(15, 2),
    usage(15, 2, ["u1"], 300),
    usage(38, 6),
    { type: "turn.done", turnId: "t1", stopReason: "end" },
    { type: "message.user", messageId: "u2", text: "Two" },
    { type: "turn.started", turnId: "t2" },
    usage(0, 0, ["u2"], 450),
    usage(12, 3, ["u2"]),
    { type: "turn.done", turnId: "t2", stopReason: "end" },
  ];
  const state = fold(events);
  expect(user(state, "u1")).toMatchObject({
    usage: { inputTokens: 38, outputTokens: 6, contextTokens: 100, contextWindow: 1000, estimated: true },
  });
  expect(user(state, "u2")).toMatchObject({
    usage: { inputTokens: 12, outputTokens: 3, contextTokens: 450 },
  });
  expect(sessionStateSchema.parse(state)).toEqual(state);
  expect(fold(JSON.parse(JSON.stringify(events)))).toEqual(state);
});

it("marks batched consumption as shared without changing an earlier owner's totals or undelivered messages", () => {
  const state = fold([
    { type: "message.user", messageId: "u1", text: "One" },
    { type: "turn.started", turnId: "t" },
    usage(0, 0, ["u1"], 100),
    usage(15, 2),
    ...["q1", "q2", "pending"].map((messageId) => ({
      type: "message.queued",
      messageId,
      text: messageId,
      timestamp: 1,
    })),
    { type: "message.delivered", messageIds: ["q1", "q2"] },
    usage(15, 2, ["q1", "q2"], 300),
    usage(38, 6, ["q1", "q2"]),
  ]);
  expect(user(state, "u1")).toMatchObject({
    usage: { inputTokens: 15, outputTokens: 2, contextTokens: 100 },
  });
  for (const id of ["q1", "q2"])
    expect(user(state, id)).toMatchObject({
      usage: { inputTokens: 23, outputTokens: 4, contextTokens: 300, shared: true },
    });
  expect(user(state, "pending")).not.toHaveProperty("usage");
});

it("does not invent zero measurements or freeze internal-summary context as the prompt context", () => {
  const state = fold([
    { type: "message.user", messageId: "u1", text: "One" },
    { type: "turn.started", turnId: "t" },
    {
      type: "usage.updated",
      inputTokens: 0,
      outputTokens: 0,
      contextTokens: 900,
      compactionStatus: "running",
    },
    usage(0, 0, ["u1"], 120),
    usage(0, 0),
    { type: "turn.done", turnId: "t", stopReason: "aborted" },
  ]);
  expect(user(state, "u1")).toMatchObject({ usage: { contextTokens: 120 } });
  const row = user(state, "u1");
  expect(row?.kind === "user" && row.usage?.inputTokens).toBeUndefined();
  expect(row?.kind === "user" && row.usage?.outputTokens).toBeUndefined();
  const noOwner: SessionEvent = { type: "usage.updated", inputTokens: 10, outputTokens: 2 };
  expect(applySessionEvent(state, noOwner).items).toEqual(state.items);
});
