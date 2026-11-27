// REQ-FUNC-e5b6a1c9. Runtime execution deferred by direct user instruction.
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { LlmGateway, LlmRequest } from "../llm/gateway.js";
import { ContextCompactor, type SummarizeHistory } from "./compaction.js";
import { conservativeCompactor } from "./conservative-counting.test-support.js";
import { ContextPolicy, conservativeCounter } from "./context.js";
import { buildContext, ReferenceRuntime, zeroUsage } from "./runtime.js";
import type { RuntimeEvent } from "./types.js";

const caps = {
  contextWindow: 6000,
  maxOutputTokens: 1000,
  input: ["text" as const],
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
const text = (value: string) => ({ type: "text" as const, text: value });

it("bounds full prefix measurements while finding the longest prefix that fits", async () => {
  const count = vi.fn(conservativeCounter);
  const measured = new ContextPolicy(count);
  const history = Array.from(
    { length: 128 },
    (_, index): Message => ({
      role: "user",
      content: `${index}: ${"a".repeat(80)}`,
      timestamp: index,
    }),
  );
  const input = request([...history, { role: "user", content: "Current", timestamp: 200 }]);
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  await new ContextCompactor().prepare(input, caps, measured, summarize, undefined, undefined, false, true);
  expect(count.mock.calls.length).toBeLessThan(16);
  const chosen = summarize.mock.calls[0]?.[0];
  expect(chosen).toBeDefined();
  if (!chosen) throw Error("Expected a summary request");
  expect(policy.prepare(chosen, caps, false).fits).toBe(true);
  const following = history[chosen.messages.length - 1];
  const instruction = chosen.messages.at(-1);
  if (!following || !instruction) throw Error("Expected an unselected message and instruction");
  expect(
    policy.prepare(
      { ...chosen, messages: [...chosen.messages.slice(0, -1), following, instruction] },
      caps,
      false,
    ).fits,
  ).toBe(false);
});

it("bounds summary candidate measurements for complete tool exchanges", async () => {
  const count = vi.fn(conservativeCounter);
  const measured = new ContextPolicy(count);
  const history = Array.from({ length: 96 }, (_, index): Message[] => {
    const id = `read-${index}`;
    return [
      {
        ...answer(""),
        stopReason: "toolUse",
        content: [{ type: "toolCall", id, name: "read", arguments: {} }],
      },
      {
        role: "toolResult",
        toolCallId: id,
        toolName: "read",
        content: [text("result ".repeat(100))],
        isError: false,
        timestamp: index,
      },
    ];
  }).flat();
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const current: Message = { role: "user", content: "Current", timestamp: 200 };
  await new ContextCompactor().prepare(
    request([...history, current]),
    caps,
    measured,
    summarize,
    history.length,
    undefined,
    false,
    true,
  );
  const probes = count.mock.calls.filter(([input]) => input.system.includes("Return only JSON:"));
  expect(probes.length).toBeLessThan(17);
  expect(summarize).toHaveBeenCalledTimes(1);
  const chosen = summarize.mock.calls[0];
  expect(chosen?.[1].fits).toBe(true);
  expect(chosen?.[0].messages.at(-2)?.role).toBe("toolResult");
});

it("keeps the adopted summary and reports a failed follow-up in the same prepare", async () => {
  const compactor = new ContextCompactor();
  compactor.settings = { ...compactor.settings, trigger: 0.05, tailTokens: 0 };
  const summarize = vi
    .fn<SummarizeHistory>()
    .mockResolvedValueOnce(summary())
    .mockRejectedValueOnce(Error("offline"));
  const history = Array.from(
    { length: 6 },
    (_, index): Message => ({ role: "user", content: `${index} ${"a".repeat(700)}`, timestamp: index }),
  );
  const input = request([...history, { role: "user", content: "Current", timestamp: 7 }]);
  const view = await compactor.prepare(input, caps, policy, summarize);
  expect(summarize).toHaveBeenCalledTimes(2);
  expect(view).toMatchObject({ compactionStatus: "failed", fits: true });
  expect(JSON.stringify(view.messages)).toContain("Board investigation.");
});

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
      const reply = summarizing ? summary() : answer(`[[board.txt#L1-L2]] ${"a".repeat(850)}`);
      // The provider reports the conservative estimate itself, so calibration keeps the small window.
      reply.usage.input = policy.prepare(input, caps, false).rawTokens;
      yield { type: "done", message: reply };
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

it("attempts a failing automatic summary only once per turn", async () => {
  let summaries = 0;
  let normalRequests = 0;
  let id = 0;
  const capabilities = { ...caps, contextWindow: 12_000 };
  const compactor = new ContextCompactor();
  compactor.settings = { ...compactor.settings, trigger: 0.25 };
  const runtime = new ReferenceRuntime({
    gateway: {
      capabilities: () => capabilities,
      selectedModel: () => "compaction",
      models: async () => ({ models: [], reachability: "pass" }),
      async *stream(input) {
        if (input.system.includes("Return only JSON:")) {
          summaries++;
          yield { type: "done", message: answer("invalid JSON") };
          return;
        }
        normalRequests++;
        const response = normalRequests === 1 ? (call("probe") as AssistantMessage) : answer("Completed.");
        response.usage.input = policy.prepare(input, capabilities, false).rawTokens;
        yield { type: "done", message: response };
      },
    },
    now: () => 1,
    nextId: () => String(++id),
    approve: async () => "approved",
  });
  runtime.start({
    systemPrompt: "Current rules",
    model: "replay/compaction",
    tools: [
      {
        name: "read",
        class: "read",
        description: "Read a fixture",
        params: z.strictObject({}),
        execute: async () => "Fixture result",
      },
    ],
    messages: [...exchange(), ...exchange()],
    contextPolicy: policy,
    contextCompactor: compactor,
  });
  expect(await runtime.send("Read the fixture")).toEqual({ stopReason: "end" });
  expect(normalRequests).toBe(2);
  expect(summaries).toBe(1);
  expect(await runtime.send("Next turn")).toEqual({ stopReason: "end" });
  expect(summaries).toBe(2);
});

it("retains current first-turn reduction, oversized instruction and smaller-model limit semantics without summary dispatch", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
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

const acceptedReplies: [string, (json: string) => AssistantMessage["content"]][] = [
  ["a reasoning block", (json) => [{ type: "thinking", thinking: "plan" }, text(json)]],
  ["a json code fence", (json) => [text(`\`\`\`json\n${json}\n\`\`\`\n`)]],
  ["a bare code fence", (json) => [text(`\`\`\`\n${json}\n\`\`\``)]],
];
it.each(acceptedReplies)("accepts a summary reply with %s", async (_name, content) => {
  const input = request([
    ...exchange(),
    ...exchange(),
    { role: "user", content: "Keep current instruction", timestamp: 2 },
  ]);
  const reply = summary();
  const json = reply.content[0]?.type === "text" ? reply.content[0].text : "";
  const view = await new ContextCompactor().prepare(input, caps, policy, async () => ({
    ...reply,
    content: content(json),
  }));
  expect(view.compactionStatus).toBe("completed");
  expect(JSON.stringify(view.messages)).toContain("Use 3.3V for the board.");
});

const call = (id: string): Message => ({
  ...answer(""),
  content: [{ type: "toolCall", id, name: "read", arguments: { path: id } }],
  stopReason: "toolUse",
});
const result = (id: string, body: string): Message => ({
  role: "toolResult",
  toolCallId: id,
  toolName: "read",
  content: [{ type: "text", text: body }],
  isError: false,
  timestamp: 1,
});

it.each([4924, 5124])(
  "fits a one-pass compaction when a longer prefix needs reduced results (%s)",
  async (contextWindow) => {
    const user = (content: string): Message => ({ role: "user", content, timestamp: 0 });
    const history = [
      user("u".repeat(50)),
      call("early"),
      result("early", "d".repeat(500)),
      call("later"),
      result("later", "e".repeat(2900)),
      user("a".repeat(600)),
      answer("done"),
      user("b".repeat(600)),
      answer("done"),
    ];
    const compactor = new ContextCompactor();
    compactor.settings = { ...compactor.settings, maxPasses: 1, tailTokens: 0 };
    const summarize = vi.fn<SummarizeHistory>(async () => summary());
    const budget = { ...caps, contextWindow };
    const view = await compactor.prepare(
      request([...history, user("c".repeat(30))]),
      budget,
      policy,
      summarize,
    );
    expect(view).toMatchObject({ fits: true, compactionStatus: "completed" });
    expect(compactor.takeRecord()?.covered).toBeGreaterThanOrEqual(5);
    const selected = summarize.mock.calls[0];
    if (!selected) throw Error("Expected one summary request");
    const [detailed, summaryView] = selected;
    expect(summaryView.fits).toBe(true);
    expect(
      summaryView.messages.some((message) => message.role === "toolResult" && message.toolCallId === "later"),
    ).toBe(true);
    const withEarlierDetail = summaryView.messages.map((message, index) =>
      message.role === "toolResult" && message.toolCallId === "early"
        ? (detailed.messages[index] ?? message)
        : message,
    );
    expect(JSON.stringify(summaryView.messages).includes("d".repeat(500))).toBe(
      policy.prepare({ ...detailed, messages: withEarlierDetail }, budget, false).fits,
    );
  },
);
/** Every tool result in a view follows the assistant call that requested it. */
function pairsIntact(messages: Message[]): boolean {
  const calls = new Set<string>();
  for (const message of messages) {
    if (message.role === "assistant")
      for (const block of message.content) if (block.type === "toolCall") calls.add(block.id);
    if (message.role === "toolResult" && !calls.has(message.toolCallId)) return false;
  }
  return true;
}

// REQ-FUNC-e5b6a1c9
it("summarizes turns split by steering, aborted and limit turns, keeping the recent tail verbatim and tool pairs whole", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const stored: Message[] = [
    { role: "user", content: `SPLIT-TURN ${"u".repeat(300)}`, timestamp: 0 },
    call("c1"),
    result("c1", "r".repeat(300)),
    { role: "user", content: `STEERING ${"s".repeat(200)}`, timestamp: 1 },
    answer("steered done"),
    { role: "user", content: `ABORTED-TURN ${"u".repeat(300)}`, timestamp: 2 },
    { ...answer("partial"), stopReason: "aborted" },
    { role: "user", content: `LIMIT-TURN ${"u".repeat(300)}`, timestamp: 3 },
    call("c3"),
    result("c3", "r".repeat(300)),
    ...exchange(),
    { role: "user", content: "Current instruction", timestamp: 9 },
  ];
  const input = request(buildContext(stored, 10));
  expect(policy.prepare(input, caps, false).contextTokens).toBeGreaterThan(caps.inputBudget * 0.8);
  const view = await new ContextCompactor().prepare(input, caps, policy, summarize);
  expect(view.compactionStatus).toBe("completed");
  expect(view.fits).toBe(true);
  // Passes continue until the view is below the trigger; together they cover the old turns.
  const sent = JSON.stringify(summarize.mock.calls.map((args) => args[0]));
  expect(
    policy.prepare({ ...input, messages: view.messages }, caps, false).contextTokens,
  ).toBeLessThanOrEqual(caps.inputBudget * 0.8);
  for (const marker of ["SPLIT-TURN", "STEERING", "ABORTED-TURN", "LIMIT-TURN"]) {
    expect(sent).toContain(marker);
    expect(JSON.stringify(view.messages)).not.toContain(marker);
  }
  expect(JSON.stringify(view.messages)).toContain("Derived historical context");
  // The most recent completed exchange stays verbatim, then the current instruction.
  expect(view.messages.at(-1)).toMatchObject({ role: "user", content: "Current instruction" });
  expect(JSON.stringify(view.messages.slice(-3, -1))).toContain("Measure reset timing.");
  expect(pairsIntact(view.messages)).toBe(true);
});

// REQ-FUNC-bd5e5e8d
it("cuts tool results to 2,000 characters in the summary request and keeps their refs", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const body = `${"b".repeat(2500)} [[late.txt#L7-L9]] ${"c".repeat(6000)}`;
  const stored: Message[] = [
    { role: "user", content: "Read the log", timestamp: 0 },
    call("big"),
    result("big", body),
    answer("Read."),
    ...exchange(),
    { role: "user", content: "Current instruction", timestamp: 9 },
  ];
  const view = await new ContextCompactor().prepare(
    request(buildContext(stored, 10)),
    caps,
    policy,
    summarize,
  );
  expect(view.compactionStatus).toBe("completed");
  const sent = summarize.mock.calls[0]?.[0] as unknown as { messages: Message[] };
  const cut = sent.messages.find((m) => m.role === "toolResult");
  const textBlock = cut?.role === "toolResult" ? cut.content[0] : undefined;
  const text = textBlock?.type === "text" ? textBlock.text : "";
  expect(text.startsWith("b".repeat(2000))).toBe(true);
  expect(text).toContain(`[tool result truncated: ${body.length - 2000} characters omitted]`);
  expect(text.length).toBeLessThan(2100);
  expect(cut).toMatchObject({ toolCallId: "big", isError: false });
  expect(JSON.stringify(view.messages)).toContain("late.txt#L7-L9");
  // The durable transcript is not changed.
  expect((stored[2] as { content: { text: string }[] }).content[0]?.text).toBe(body);
});

it("retains structured refs across repeated cached summaries and invalidates changed history", async () => {
  const compactor = new ContextCompactor();
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
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
  expect(summarize.mock.calls.length).toBeGreaterThanOrEqual(2);
  const replacement = request([{ role: "user", content: "new session", timestamp: 4 }]);
  expect((await compactor.prepare(replacement, caps, policy, summarize)).messages).toEqual(
    replacement.messages,
  );
});

// A restarted session meets its whole history at once, without a cached summary.
it("compacts a long history in a few passes when one summary is not enough", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const history = Array.from({ length: 5 }, exchange).flat();
  const view = await new ContextCompactor().prepare(
    request([...history, { role: "user", content: "Continue using 3.3V", timestamp: 9 }]),
    caps,
    policy,
    summarize,
  );
  expect(view.compactionStatus).toBe("completed");
  expect(view.fits).toBe(true);
  // One summary request holds only part of this history, so more than one pass runs.
  expect(summarize.mock.calls.length).toBeGreaterThan(1);
  expect(summarize.mock.calls.length).toBeLessThanOrEqual(5);
  // A later pass summarizes the earlier summary together with the next exchanges.
  expect(JSON.stringify(summarize.mock.calls.at(1)?.at(0))).toContain("Derived historical context");
  // Only the last pass's note stays in the request.
  expect(JSON.stringify(view.messages).match(/Derived historical context/g)).toHaveLength(1);
});

it("stops after five summary passes even when the history still does not fit", async () => {
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const history = Array.from({ length: 30 }, exchange).flat();
  const view = await new ContextCompactor().prepare(
    request([...history, { role: "user", content: "Continue", timestamp: 9 }]),
    caps,
    policy,
    summarize,
  );
  expect(summarize).toHaveBeenCalledTimes(5);
  expect(view.fits).toBe(false);
});

it("reuses summaries across advancing clocks and summarizes repaired interrupted history", async () => {
  const compactor = new ContextCompactor();
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const stored: Message[] = [
    { role: "user", content: `unfinished ${"u".repeat(400)}`, timestamp: 0 },
    {
      ...answer(""),
      content: [{ type: "toolCall", id: "pending", name: "read", arguments: {} }],
      stopReason: "toolUse",
    },
    ...exchange(),
    ...exchange(),
    { role: "user", content: "Current instruction", timestamp: 2 },
  ];
  const first = request(buildContext(stored, 10));
  expect(policy.prepare(first, caps, false).contextTokens).toBeGreaterThan(caps.inputBudget * 0.8);
  const one = await compactor.prepare(first, caps, policy, summarize);
  expect(one.compactionStatus).toBe("completed");
  expect(JSON.stringify(summarize.mock.calls[0]?.[0])).toContain("Interrupted: call outcome unresolved.");
  expect(JSON.stringify(one.messages)).not.toContain("unfinished");
  const later = request(buildContext(stored, 20));
  expect(later.messages).toEqual(first.messages);
  const calls = summarize.mock.calls.length;
  const two = await compactor.prepare(later, caps, policy, summarize);
  expect(two.messages).toEqual(one.messages);
  // The cached summary is reused: no further summary call.
  expect(summarize).toHaveBeenCalledTimes(calls);
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
      yield { type: "error", error: { code: "PROVIDER", messageKey: "errors.PROVIDER" }, aborted: true };
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
    contextCompactor: conservativeCompactor(),
  });
  expect(await runtime.send("Current instruction")).toEqual({ stopReason: "aborted" });
  expect(calls).toBe(1);
  const usage = events.filter((event) => event.type === "usage.updated");
  expect(usage[0]).toMatchObject({ compactionStatus: "running" });
  expect(usage.at(-1)).toMatchObject({ compactionStatus: "failed" });
  expect(events.at(-1)).toMatchObject({ type: "turn.done", stopReason: "aborted" });
});

it("replaces compacted images with durable path notes in successive request views", async () => {
  const historical = { role: "user" as const, content: "Earlier board", timestamp: 0, images: ["board.png"] };
  const current = { role: "user" as const, content: "Current scope", timestamp: 2, images: ["scope.png"] };
  const compactor = new ContextCompactor();
  const vision = { ...caps, contextWindow: 10000, input: ["text", "image"] as const };
  const input = request([historical, answer("a".repeat(3500)), current]);
  const summarize = vi.fn(async (_input) => summary());
  const result = await compactor.prepare(input, { ...vision, input: [...vision.input] }, policy, summarize);
  expect(result.compactionStatus).toBe("completed");
  const summaryRequest = JSON.stringify(summarize.mock.calls[0]?.[0].messages);
  expect(summaryRequest).toContain("board.png");
  expect(summaryRequest).toContain("Image omitted during compaction");
  expect(summaryRequest).not.toContain('"images":');
  expect(summaryRequest).not.toContain("scope.png");
  expect(JSON.stringify(result.messages[0])).toContain("Image omitted during compaction");
  expect(JSON.stringify(result.messages[0])).toContain("board.png");
  expect(result.messages.at(-1)).toEqual(current);
  expect(input.messages[0]).toEqual(historical);
  const cached = await compactor.prepare(input, { ...vision, input: [...vision.input] }, policy, summarize);
  expect(summarize).toHaveBeenCalledTimes(1);
  expect(cached.messages).toEqual(result.messages);
});

// REQ-FUNC-e5b6a1c9
it("keeps about 20,000 tokens of recent history verbatim in a large window, counted like the request", async () => {
  const big = { ...caps, contextWindow: 200_000, maxOutputTokens: 1000, inputBudget: 189_000 };
  // An exact counter at four bytes per token.
  const exact = new ContextPolicy((input) => ({
    tokens: Math.ceil(Buffer.byteLength(JSON.stringify(input), "utf8") / 4),
    estimated: false,
  }));
  const summarize = vi.fn<SummarizeHistory>(async () => summary());
  const history = Array.from({ length: 64 }, (_, index): Message[] => [
    { role: "user", content: `E${index} ${"u".repeat(5000)}`, timestamp: 0 },
    answer(`R${index} ${"a".repeat(5000)}`),
  ]).flat();
  const input = request([...history, { role: "user", content: "Current instruction", timestamp: 9 }]);
  expect(exact.prepare(input, big, false).contextTokens).toBeGreaterThan(0.8 * 189_000 - 10_000);
  const view = await new ContextCompactor().prepare(input, big, exact, summarize);
  expect(view.compactionStatus).toBe("completed");
  const kept = view.messages.slice(1, -1);
  const tokens = exact.prepare(request(kept), big, false).contextTokens;
  // At least the 20,000-token tail and less than one more exchange beyond it.
  expect(tokens).toBeGreaterThanOrEqual(20_000 - 100);
  expect(tokens).toBeLessThan(20_000 + 2_600);
  expect(JSON.stringify(view.messages)).toContain("E63 ");
  expect(JSON.stringify(view.messages)).not.toContain("E0 ");
});
