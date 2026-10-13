// REQ-FUNC-e5b6a1c9. Runtime execution deferred by direct user instruction.
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import type { LlmGateway, LlmRequest } from "../llm/gateway.js";
import { ContextCompactor } from "./compaction.js";
import { ContextPolicy } from "./context.js";
import { buildContext, ReferenceRuntime, zeroUsage } from "./runtime.js";
import type { RuntimeEvent } from "./types.js";

const caps = {
  contextWindow: 6000,
  maxOutputTokens: 1000,
  inputBudget: 3976,
  safetyMargin: 1024,
  supportsTools: true,
};
const policy = new ContextPolicy();
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
    JSON.stringify({
      summary: "Board investigation.",
      decisions: ["Use 3.3V for the board."],
      outstandingWork: ["Measure reset timing."],
    }),
  );
const exchange = (): Message[] => [
  { role: "user", content: `Use 3.3V. ${"u".repeat(850)}`, timestamp: 0 },
  answer(`Measure reset timing. [[board.txt#L1-L2]] ${"a".repeat(850)}`),
];
const request = (messages: Message[]) => ({ system: "Current system rules", tools: [], messages });

it("continues a small-window multi-turn replay, counts both requests and retains the complete transcript", async () => {
  const requests: LlmRequest[] = [];
  const events: RuntimeEvent[] = [];
  let id = 0;
  const gateway: LlmGateway = {
    capabilities: () => caps,
    selectedModel: () => "compaction",
    models: async () => ({ models: [], reachability: "pass" }),
    stream: async function* (input) {
      requests.push(input);
      const summarizing = input.system.includes("Return only JSON:");
      yield {
        type: "done",
        message: summarizing ? summary() : answer(`[[board.txt#L1-L2]] ${"a".repeat(850)}`),
      };
    },
  };
  const runtime = new ReferenceRuntime({
    gateway,
    now: () => 1,
    nextId: () => String(++id),
    approve: async () => "approved",
  });
  runtime.onEvent((event) => events.push(event));
  runtime.start({
    systemPrompt: "Current rules",
    model: "replay/compaction",
    tools: [],
    messages: [],
    contextPolicy: policy,
  });
  for (let turn = 0; turn < 6; turn++) {
    expect(await runtime.send(`Use 3.3V, measure reset timing. ${"u".repeat(850)}`)).toEqual({
      stopReason: "end",
    });
  }
  expect(requests.some((input) => input.system.includes("Return only JSON:"))).toBe(true);
  for (const input of requests) {
    expect(policy.prepare(input, caps, false).fits).toBe(true);
    expect(input.maxOutputTokens).toBe(1000);
  }
  const last = requests.at(-1);
  expect(JSON.stringify(last?.messages)).toContain("Use 3.3V for the board.");
  expect(JSON.stringify(last?.messages)).toContain("Measure reset timing.");
  expect(JSON.stringify(last?.messages)).toContain("board.txt#L1-L2");
  expect(runtime.messages()).toHaveLength(12);
  expect(JSON.stringify(runtime.messages())).not.toContain("Derived historical context");
  expect(events.some((e) => e.type === "usage.updated" && e.compactionStatus === "running")).toBe(true);
  expect(
    events.some(
      (e) =>
        e.type === "usage.updated" &&
        e.compactionStatus === "completed" &&
        e.requestViewTokens === e.contextTokens,
    ),
  ).toBe(true);
});

it("retains current first-turn reduction, oversized instruction and smaller-model limit semantics without summary dispatch", async () => {
  const summarize = vi.fn(async () => summary());
  const compactor = new ContextCompactor();
  const first = request([
    { role: "user", content: "Read board", timestamp: 0 },
    {
      ...answer(""),
      content: [{ type: "toolCall", id: "c", name: "read", arguments: {} }],
      stopReason: "toolUse",
    },
    {
      role: "toolResult",
      toolCallId: "c",
      toolName: "read",
      content: [{ type: "text", text: JSON.stringify({ body: "x".repeat(7000), ref: "board.txt#L1-L2" }) }],
      isError: false,
      timestamp: 1,
    },
  ]);
  const reduced = await compactor.prepare(first, caps, policy, summarize);
  expect(reduced.fits).toBe(true);
  expect(JSON.stringify(reduced.messages)).toContain("board.txt#L1-L2");
  const oversized = request([...exchange(), { role: "user", content: "x".repeat(7000), timestamp: 2 }]);
  expect((await compactor.prepare(oversized, caps, policy, summarize)).fits).toBe(false);
  const smaller = { ...caps, contextWindow: 1600, maxOutputTokens: 500 };
  expect(
    (
      await compactor.prepare(
        request([...exchange(), { role: "user", content: "keep", timestamp: 2 }]),
        smaller,
        policy,
        summarize,
      )
    ).fits,
  ).toBe(false);
  expect(summarize).not.toHaveBeenCalled();
});

it.each(["throw", "invalid", "length", "tools"])(
  "makes one %s summary attempt and falls back to M1",
  async (failure) => {
    const input = request([
      ...exchange(),
      ...exchange(),
      { role: "user", content: "Keep current instruction", timestamp: 2 },
    ]);
    const saved = JSON.stringify(input);
    const summarize = vi.fn(async () => {
      if (failure === "throw") throw Error("provider failed");
      if (failure === "invalid") return answer("invalid JSON");
      if (failure === "length") return { ...summary(), stopReason: "length" as const };
      return {
        ...summary(),
        content: [{ type: "toolCall" as const, id: "c", name: "write", arguments: {} }],
      };
    });
    const view = await new ContextCompactor().prepare(input, caps, policy, summarize);
    expect(summarize).toHaveBeenCalledTimes(1);
    expect(view.compactionStatus).toBe("failed");
    expect(view.messages).toEqual(policy.prepare(input, caps).messages);
    expect(view.fits).toBe(false);
    expect(JSON.stringify(input)).toBe(saved);
  },
);

it("rejects interrupted exchanges, including transient pair repair", async () => {
  const summarize = vi.fn(async () => summary());
  const interrupted: Message[] = [
    { role: "user", content: "u".repeat(2400), timestamp: 0 },
    {
      ...answer(""),
      content: [{ type: "toolCall", id: "c", name: "read", arguments: {} }],
      stopReason: "toolUse",
    },
    {
      role: "toolResult",
      toolCallId: "c",
      toolName: "read",
      content: [{ type: "text", text: "read" }],
      isError: false,
      timestamp: 1,
    },
    { role: "user", content: "current", timestamp: 2 },
  ];
  const input = request(buildContext(interrupted, 3));
  await new ContextCompactor().prepare(input, caps, policy, summarize);
  expect(summarize).not.toHaveBeenCalled();
});

it("retains structured refs across repeated cached summaries and invalidates changed history", async () => {
  const compactor = new ContextCompactor();
  const summarize = vi.fn(async () => summary());
  const first: Message[] = [
    { role: "user", content: "u".repeat(850), timestamp: 0 },
    {
      ...answer(""),
      content: [{ type: "toolCall", id: "c", name: "read", arguments: {} }],
      stopReason: "toolUse",
    },
    {
      role: "toolResult",
      toolCallId: "c",
      toolName: "read",
      content: [
        { type: "text", text: JSON.stringify({ body: "x".repeat(6000), ref: "structured.txt#L3-L4" }) },
      ],
      isError: false,
      timestamp: 1,
    },
    answer("done"),
    { role: "user", content: "current", timestamp: 2 },
  ];
  const one = await compactor.prepare(request(first), caps, policy, summarize);
  expect(one.compactionStatus).toBe("completed");
  const later = [
    ...first.slice(0, -1),
    ...exchange(),
    ...exchange(),
    { role: "user" as const, content: "current", timestamp: 3 },
  ];
  const two = await compactor.prepare(request(later), caps, policy, summarize);
  expect(two.compactionStatus).toBe("completed");
  expect(JSON.stringify(two.messages)).toContain("structured.txt#L3-L4");
  expect(summarize).toHaveBeenCalledTimes(2);
  const replacement = request([{ role: "user", content: "new session", timestamp: 4 }]);
  expect((await compactor.prepare(replacement, caps, policy, summarize)).messages).toEqual(
    replacement.messages,
  );
});

it("reuses summaries across advancing clocks while retaining interrupted history", async () => {
  const compactor = new ContextCompactor();
  const summarize = vi.fn(async () => summary());
  const stored: Message[] = [
    { role: "user", content: `unfinished ${"u".repeat(400)}`, timestamp: 0 },
    {
      ...answer(""),
      content: [{ type: "toolCall", id: "pending", name: "read", arguments: {} }],
      stopReason: "toolUse",
    },
    ...exchange(),
    { role: "user", content: "Current instruction", timestamp: 2 },
  ];
  const first = request(buildContext(stored, 10));
  expect(policy.prepare(first, caps, false).contextTokens).toBeGreaterThan(caps.inputBudget * 0.8);
  const one = await compactor.prepare(first, caps, policy, summarize);
  expect(one.compactionStatus).toBe("completed");
  expect(JSON.stringify(one.messages)).toContain("Interrupted: call outcome unresolved.");
  const later = request(buildContext(stored, 20));
  expect(later.messages).toEqual(first.messages);
  const two = await compactor.prepare(later, caps, policy, summarize);
  expect(two.messages).toEqual(one.messages);
  expect(summarize).toHaveBeenCalledTimes(1);
});

it("settles running compaction usage after abort without dispatching a normal request", async () => {
  const events: RuntimeEvent[] = [];
  let calls = 0;
  let id = 0;
  const gateway: LlmGateway = {
    capabilities: () => caps,
    selectedModel: () => "compaction",
    models: async () => ({ models: [], reachability: "pass" }),
    stream: async function* (input) {
      calls++;
      expect(input.system).toContain("Return only JSON:");
      runtime.abort();
      yield { type: "error", error: { code: "PROVIDER", messageKey: "error.provider" }, aborted: true };
    },
  };
  const runtime = new ReferenceRuntime({
    gateway,
    now: () => 1,
    nextId: () => String(++id),
    approve: async () => "approved",
  });
  runtime.onEvent((event) => events.push(event));
  runtime.start({
    systemPrompt: "Rules",
    model: "replay/compaction",
    tools: [],
    messages: [...exchange(), ...exchange()],
    contextPolicy: policy,
  });
  expect(await runtime.send("Current instruction")).toEqual({ stopReason: "aborted" });
  expect(calls).toBe(1);
  const usage = events.filter((event) => event.type === "usage.updated");
  expect(usage[0]).toMatchObject({ compactionStatus: "running" });
  expect(usage.at(-1)).toMatchObject({ compactionStatus: "failed" });
  expect(events.at(-1)).toMatchObject({ type: "turn.done", stopReason: "aborted" });
});
