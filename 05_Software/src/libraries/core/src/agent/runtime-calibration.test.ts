// REQ-NFR-4721c12f
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import type { LlmGateway, LlmRequest } from "../llm/gateway.js";
import { COLD_CALIBRATION_RATIO, ContextCompactor } from "./compaction.js";
import { conservativeCompactor } from "./conservative-counting.test-support.js";
import { ContextPolicy } from "./context.js";
import { ReferenceRuntime, zeroUsage } from "./runtime.js";
import type { RuntimeEvent } from "./types.js";

const caps = {
  contextWindow: 60000,
  maxOutputTokens: 1000,
  safetyMargin: 3000,
  input: ["text" as const],
  inputBudget: 56000,
  supportsTools: true,
};
const reply = (input: number): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text: "Answer" }],
  stopReason: "stop",
  usage: { ...zeroUsage(), input },
  timestamp: 123,
  api: "replay",
  provider: "replay",
  model: "scenario",
});
/** By default the provider reports a quarter of the conservative estimate, a plausible ratio. */
function fixture(
  compactor: ContextCompactor,
  model = "replay/scenario",
  reported: number | ((request: LlmRequest) => number) = (request) => Math.ceil(raw(request) / 4),
) {
  const events: RuntimeEvent[] = [];
  const requests: LlmRequest[] = [];
  let id = 0;
  const gateway: LlmGateway = {
    selectedModel: () => "scenario",
    models: async () => ({ reachability: "pass", models: [] }),
    capabilities: () => caps,
    async *stream(request) {
      requests.push(request);
      yield { type: "done", message: reply(typeof reported === "number" ? reported : reported(request)) };
    },
  };
  const runtime = new ReferenceRuntime({
    gateway,
    now: () => 123,
    nextId: () => `id${++id}`,
    approve: async () => "approved",
  });
  runtime.onEvent((event) => events.push(event));
  const start = (messages = runtime.messages()) =>
    runtime.start({
      systemPrompt: "rules",
      model,
      tools: [],
      messages,
      contextPolicy: new ContextPolicy(),
      contextCompactor: compactor,
    });
  start([]);
  return { runtime, events, requests, start };
}
const preflights = (events: RuntimeEvent[]) =>
  events.filter(
    (e): e is Extract<RuntimeEvent, { type: "usage.updated" }> =>
      e.type === "usage.updated" && e.contextTokens !== undefined,
  );
const raw = (request: LlmRequest) =>
  new ContextPolicy().prepare(
    { system: request.system, tools: request.tools, messages: request.messages },
    caps,
  ).rawTokens;

it("calibrates later requests from the reported input of the previous one and keeps the ratio with the session compactor", async () => {
  const compactor = new ContextCompactor();
  const f = fixture(compactor);
  await f.runtime.send(`First ${"context ".repeat(500)}`);
  const report = f.events.find((e) => e.type === "usage.updated" && e.calibration);
  const first = raw(f.requests[0] as LlmRequest);
  const ratio = Math.ceil(first / 4) / first;
  expect(report).toMatchObject({ calibration: { modelRef: "replay/scenario", ratio } });
  // Before any report the count is the cold ratio of the conservative estimate.
  expect(preflights(f.events)[0]?.contextTokens).toBe(Math.ceil(first * COLD_CALIBRATION_RATIO));
  expect(JSON.stringify(f.events)).not.toContain("rawTokens");

  const next = fixture(compactor);
  next.start(f.runtime.messages());
  await next.runtime.send("Second");
  const second = raw(next.requests[0] as LlmRequest);
  expect(preflights(next.events)[0]?.contextTokens).toBe(Math.ceil(second * ratio * 1.1));
});

it("counts another model cold again and never keeps a ratio above one", async () => {
  const compactor = new ContextCompactor();
  const f = fixture(compactor, "replay/scenario", 10_000_000);
  await f.runtime.send("Question");
  expect(f.events.find((e) => e.type === "usage.updated" && e.calibration)).toMatchObject({
    calibration: { ratio: 1 },
  });
  const other = fixture(compactor, "replay/other");
  other.start(f.runtime.messages());
  await other.runtime.send("Again");
  // The first model's ratio does not carry over: the other model starts at the cold ratio.
  expect(preflights(other.events)[0]?.contextTokens).toBe(
    Math.ceil(raw(other.requests[0] as LlmRequest) * COLD_CALIBRATION_RATIO),
  );
});

it("counts conservatively, cold or measured, while provider token counts are off", async () => {
  const compactor = conservativeCompactor();
  const f = fixture(compactor);
  await f.runtime.send(`First ${"context ".repeat(500)}`);
  expect(preflights(f.events)[0]?.contextTokens).toBe(raw(f.requests[0] as LlmRequest));
  const next = fixture(compactor);
  next.start(f.runtime.messages());
  await next.runtime.send("Second");
  expect(preflights(next.events)[0]?.contextTokens).toBe(raw(next.requests[0] as LlmRequest));
});

it("lets a first request that the conservative estimate refused reach a 32K model", async () => {
  // A plain session's system prompt and tool schemas alone are about 27 000 bytes, against an input budget
  // of 27 033 tokens: at one token per byte a small WORKBENCH.md was enough to refuse every first message.
  const window = { ...caps, contextWindow: 32_768, maxOutputTokens: 4_096 };
  const request = { system: "s".repeat(30_000), tools: [], messages: [] };
  const policy = new ContextPolicy();
  expect(policy.prepare(request, window).fits).toBe(false);
  expect(
    policy.prepare(request, window, true, undefined, new ContextCompactor().scale("replay/any")).fits,
  ).toBe(true);
  expect(
    policy.prepare(request, window, true, undefined, conservativeCompactor().scale("replay/any")).fits,
  ).toBe(false);
});

it("ignores an implausibly small report, as from a prefix-caching server, and keeps the earlier ratio", async () => {
  const compactor = new ContextCompactor();
  const f = fixture(compactor);
  await f.runtime.send(`First ${"context ".repeat(500)}`);
  const kept = compactor.calibration;
  expect(kept).toBeDefined();
  const partial = fixture(compactor, "replay/scenario", 1);
  partial.start(f.runtime.messages());
  await partial.runtime.send("Second");
  expect(partial.events.some((e) => e.type === "usage.updated" && e.calibration)).toBe(false);
  expect(compactor.calibration).toEqual(kept);
});
