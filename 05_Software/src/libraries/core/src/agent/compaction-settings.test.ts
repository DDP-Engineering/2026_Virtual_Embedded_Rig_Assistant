// REQ-FUNC-1cec8616 REQ-FUNC-8ac5ec27 REQ-FUNC-4e63e8d4 REQ-FUNC-28f652c7 REQ-FUNC-e816fc22 REQ-FUNC-a786b11d
// REQ-FUNC-5983a9e0 REQ-FUNC-eeaf29bd
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { ContextCompactor, defaultCompactionSettings, type SummarizeHistory } from "./compaction.js";
import { ContextPolicy } from "./context.js";
import { zeroUsage } from "./runtime.js";

const caps = {
  contextWindow: 6000,
  maxOutputTokens: 1000,
  input: ["text" as const],
  inputBudget: 3976,
  safetyMargin: 1024,
  supportsTools: true,
};
const big = { ...caps, contextWindow: 200_000, inputBudget: 189_000 };
const policy = new ContextPolicy();
// An exact counter at four bytes per token.
const exact = new ContextPolicy((input) => ({
  tokens: Math.ceil(Buffer.byteLength(JSON.stringify(input), "utf8") / 4),
  estimated: false,
}));
const answer = (text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  stopReason: "stop",
  api: "replay",
  model: "compaction",
  provider: "replay",
  timestamp: 1,
  usage: { ...zeroUsage(), input: 17, output: 3 },
});
const summary = () =>
  answer(
    JSON.stringify({ summary: "Board investigation.", decisions: ["3.3V"], outstandingWork: ["Reset"] }),
  );
const exchange = (): Message[] => [
  { role: "user", content: `Use 3.3V. ${"u".repeat(850)}`, timestamp: 0 },
  answer(`Measure reset timing. ${"a".repeat(850)}`),
];
const request = (messages: Message[]) => ({ system: "Current system rules", tools: [], messages });
/** About 85 % of the large budget: 64 exchanges of about 2,500 tokens each. */
const large = () =>
  request([
    ...Array.from({ length: 64 }, (_, index): Message[] => [
      { role: "user", content: `E${index} ${"u".repeat(5000)}`, timestamp: 0 },
      answer(`R${index} ${"a".repeat(5000)}`),
    ]).flat(),
    { role: "user", content: "Current instruction", timestamp: 9 },
  ]);
const compactor = (settings: Partial<typeof defaultCompactionSettings>) => {
  const value = new ContextCompactor();
  value.settings = { ...defaultCompactionSettings, ...settings };
  return value;
};

it("compacts only above the configured trigger", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const high = await compactor({ trigger: 0.95 }).prepare(large(), big, exact, summarize);
  expect(high.compactionStatus).toBe("none");
  expect(summarize).not.toHaveBeenCalled();
  const low = await compactor({ trigger: 0.6 }).prepare(large(), big, exact, summarize);
  expect(low.compactionStatus).toBe("completed");
});

it("keeps the configured recent tail verbatim", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const view = await compactor({ tailTokens: 5000 }).prepare(large(), big, exact, summarize);
  expect(view.compactionStatus).toBe("completed");
  const tokens = exact.prepare(request(view.messages.slice(1, -1)), big, false).contextTokens;
  expect(tokens).toBeGreaterThanOrEqual(5000 - 100);
  expect(tokens).toBeLessThan(5000 + 2600);
});

it("cuts tool results in summary requests to the configured size", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const body = "b".repeat(3000);
  const stored: Message[] = [
    { role: "user", content: "Read the log", timestamp: 0 },
    {
      ...answer(""),
      content: [{ type: "toolCall", id: "big", name: "read", arguments: {} }],
      stopReason: "toolUse",
    },
    {
      role: "toolResult",
      toolCallId: "big",
      toolName: "read",
      content: [{ type: "text", text: body }],
      isError: false,
      timestamp: 1,
    },
    answer("Read."),
    ...exchange(),
    { role: "user", content: "Current instruction", timestamp: 9 },
  ];
  await compactor({ toolResultChars: 500 }).prepare(request(stored), caps, policy, summarize);
  const sent = summarize.mock.calls[0]?.[0] as unknown as { messages: Message[] };
  const cut = sent.messages.find((m) => m.role === "toolResult");
  const block = cut?.role === "toolResult" ? cut.content[0] : undefined;
  const text = block?.type === "text" ? block.text : "";
  expect(text).toBe(`${"b".repeat(500)}\n[tool result truncated: 2500 characters omitted]`);
});

it("runs at most the configured summary passes", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const history = Array.from({ length: 30 }, exchange).flat();
  await compactor({ maxPasses: 2 }).prepare(
    request([...history, { role: "user", content: "Continue", timestamp: 9 }]),
    caps,
    policy,
    summarize,
  );
  expect(summarize).toHaveBeenCalledTimes(2);
});

it("scales a calibrated count by the margin, and ignores calibration while provider counts are off", () => {
  const value = compactor({ margin: 1.2 });
  value.calibrate("m", 50, 100);
  expect(value.scale("m")).toBeCloseTo(0.6);
  value.settings = { ...value.settings, margin: 1 };
  expect(value.scale("m")).toBeCloseTo(0.5);
  value.settings = { ...value.settings, calibrated: false };
  expect(value.scale("m")).toBeUndefined();
  value.settings = { ...value.settings, calibrated: true };
  expect(value.scale("m")).toBeCloseTo(0.5);
});

it("makes no summary while automatic compaction is off, and leaves an oversized request unfitted", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const above = await compactor({ automatic: false }).prepare(large(), big, exact, summarize);
  expect(above.compactionStatus).toBe("none");
  const over = Array.from({ length: 30 }, exchange).flat();
  const view = await compactor({ automatic: false }).prepare(
    request([...over, { role: "user", content: "Continue", timestamp: 9 }]),
    caps,
    policy,
    summarize,
  );
  expect(summarize).not.toHaveBeenCalled();
  expect(view.fits).toBe(false);
});

it("summarizes below the trigger when forced, once", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const brief = (): Message[] => [{ role: "user", content: "Use 3.3V.", timestamp: 0 }, answer("Noted.")];
  const short = request([...brief(), ...brief(), { role: "user", content: "next", timestamp: 9 }]);
  const plain = await compactor({}).prepare(short, caps, policy, summarize);
  expect(plain.compactionStatus).toBe("none");
  const forced = await compactor({ tailTokens: 0 }).prepare(
    short,
    caps,
    policy,
    summarize,
    undefined,
    undefined,
    true,
    true,
  );
  expect(forced.compactionStatus).toBe("completed");
  expect(summarize).toHaveBeenCalledTimes(1);
  // Compact now also works while automatic compaction is off.
  const paused = await compactor({ tailTokens: 0, automatic: false }).prepare(
    short,
    caps,
    policy,
    summarize,
    undefined,
    undefined,
    true,
    true,
  );
  expect(paused.compactionStatus).toBe("completed");
  expect(summarize).toHaveBeenCalledTimes(2);
});
