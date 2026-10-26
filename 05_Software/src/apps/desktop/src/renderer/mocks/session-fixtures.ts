// REQ-TEST-4bea0008
import type { SessionEvent } from "@vera/shared";

const user: SessionEvent = { type: "message.user", messageId: "user", text: "Read the board" };
const tools: SessionEvent[] = [
  user,
  { type: "turn.started", turnId: "fixture-turn" },
  { type: "tool.started", callId: "read-1", name: "read", args: { path: "board.txt" } },
  {
    type: "tool.done",
    callId: "read-1",
    ok: true,
    summary: "2 lines",
    preview: "1: Board uses 3.3 V.\n2: Source line.",
    durationMs: 5,
  },
  { type: "tool.started", callId: "read-2", name: "read", args: { path: "board.txt", offset: 2 } },
  {
    type: "tool.done",
    callId: "read-2",
    ok: true,
    summary: "1 line",
    preview: "2: Source line.",
    durationMs: 3,
  },
  {
    type: "message.done",
    messageId: "answer",
    text: "**Board** uses 3.3 V. [[board.txt#L1-L2]]\n\n```c\nint voltage = 33;\n```",
    citations: [{ ref: "board.txt#L1-L2", valid: true }],
  },
  { type: "turn.done", turnId: "fixture-turn", stopReason: "end" },
];
export const sessionFixtures: { title: string; events: SessionEvent[]; live?: SessionEvent[] }[] = [
  { title: "Empty session", events: [] },
  {
    title: "Streaming answer",
    events: [user, { type: "turn.started", turnId: "stream-turn" }],
    live: [
      { type: "reasoning.delta", messageId: "stream-answer", text: "Checking the board source." },
      { type: "message.delta", messageId: "stream-answer", text: "Streaming mock answer…" },
    ],
  },
  { title: "Tool rows", events: tools },
  {
    title: "Invalid citation",
    events: [
      user,
      {
        type: "message.done",
        messageId: "invalid-answer",
        text: "Unverified [[missing.txt#L1-L2]]",
        citations: [{ ref: "missing.txt#L1-L2", valid: false }],
      },
    ],
  },
  {
    title: "Provider error",
    events: [
      user,
      { type: "error", code: "PROVIDER", messageKey: "provider.auth", retryable: true },
      { type: "turn.done", turnId: "error-turn", stopReason: "error" },
    ],
  },
  {
    title: "Context limit",
    events: [
      { type: "message.user", messageId: "history", text: `FULL HISTORY ${"unchanged text ".repeat(2000)}` },
      ...tools,
      {
        type: "usage.updated",
        inputTokens: 10,
        outputTokens: 20,
        contextTokens: 27034,
        contextWindow: 32768,
        inputBudgetTokens: 27033,
        reservedOutputTokens: 4096,
        safetyMarginTokens: 1639,
        estimated: true,
      },
      { type: "error", code: "CONTEXT_LIMIT", messageKey: "context.budget_exceeded", retryable: false },
      { type: "turn.done", turnId: "limit-turn", stopReason: "limit" },
    ],
  },
];
