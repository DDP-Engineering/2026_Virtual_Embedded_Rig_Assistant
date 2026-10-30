// REQ-DATA-e31bdc18
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { veraError } from "@vera/shared";
import { expect, it } from "vitest";
import { z } from "zod";
import type { LlmGateway } from "../llm/gateway.js";
import { ContextPolicy } from "./context.js";
import { ReferenceRuntime, zeroUsage } from "./runtime.js";
import type { RuntimeEvent } from "./types.js";

it("attributes normal request budgets and cached input consumption to the admitted prompt group", async () => {
  let id = 0,
    calls = 0;
  const events: RuntimeEvent[] = [];
  const queue: { messageId: string; text: string; timestamp: number }[] = [];
  const gateway: LlmGateway = {
    selectedModel: () => "replay/usage",
    models: async () => ({ reachability: "pass", models: [] }),
    capabilities: () => ({
      contextWindow: 6000,
      maxOutputTokens: 1000,
      safetyMargin: 1024,
      inputBudget: 3976,
      supportsTools: true,
    }),
    stream: async function* () {
      const first = calls++ === 0;
      const message: AssistantMessage = {
        role: "assistant",
        api: "replay",
        provider: "replay",
        model: "usage",
        timestamp: 1,
        usage: {
          ...zeroUsage(),
          input: first ? 10 : 20,
          output: first ? 2 : 4,
          cacheRead: first ? 5 : 0,
          cacheWrite: first ? 0 : 3,
        },
        content: first
          ? [{ type: "toolCall", id: "c", name: "read", arguments: {} }]
          : [{ type: "text", text: "Done" }],
        stopReason: first ? "toolUse" : "stop",
      };
      yield { type: "done", message };
    },
  };
  const runtime = new ReferenceRuntime({
    gateway,
    now: () => 1,
    nextId: () => String(++id),
    approve: async () => "approved",
    steering: () => structuredClone(queue),
  });
  runtime.onEvent((event) => {
    events.push(event);
    if (event.type === "message.delivered") queue.splice(0);
  });
  runtime.start({
    systemPrompt: "Rules",
    model: "replay/usage",
    messages: [],
    contextPolicy: new ContextPolicy(() => ({ tokens: 120 + calls * 100, estimated: true })),
    tools: [
      {
        name: "read",
        description: "Read",
        class: "read",
        params: z.object({}),
        execute: async () => {
          queue.push(...["q1", "q2"].map((messageId) => ({ messageId, text: "More", timestamp: 1 })));
          return "Result";
        },
      },
    ],
  });
  await runtime.send("One");
  const usages = events.filter((event) => event.type === "usage.updated");
  expect(usages[0]).toMatchObject({ promptIds: ["2"], contextTokens: 120 });
  expect(usages[1]).toMatchObject({ promptIds: ["2"], inputTokens: 15, outputTokens: 2 });
  expect(usages[2]).toMatchObject({ promptIds: ["q1", "q2"], contextTokens: 220 });
  expect(usages.at(-1)).toMatchObject({ promptIds: ["q1", "q2"], inputTokens: 38, outputTokens: 6 });
  expect(calls).toBe(2);
  expect(events.findIndex((e) => e.type === "message.delivered")).toBeLessThan(
    events.indexOf(usages[2] as RuntimeEvent),
  );
});

it("retains reported usage from a failed historical summary without adopting its partial text", async () => {
  let id = 0,
    summaries = 0;
  const events: RuntimeEvent[] = [];
  const partial: AssistantMessage = {
    role: "assistant",
    api: "replay",
    provider: "replay",
    model: "usage",
    timestamp: 1,
    content: [{ type: "text", text: "INVALID PARTIAL SUMMARY" }],
    stopReason: "error",
    usage: { ...zeroUsage(), input: 17, output: 3, cacheRead: 5 },
  };
  const history: Message[] = [];
  for (let i = 0; i < 2; i++)
    history.push(
      { role: "user", content: "u".repeat(850), timestamp: 0 },
      {
        ...partial,
        content: [{ type: "text", text: "a".repeat(850) }],
        usage: zeroUsage(),
        stopReason: "stop",
      },
    );
  const gateway: LlmGateway = {
    selectedModel: () => "replay/usage",
    models: async () => ({ reachability: "pass", models: [] }),
    capabilities: () => ({
      contextWindow: 6000,
      maxOutputTokens: 1000,
      safetyMargin: 1024,
      inputBudget: 3976,
      supportsTools: true,
    }),
    stream: async function* (request) {
      if (request.system.includes("Return only JSON:")) {
        summaries++;
        yield { type: "error", error: veraError("PROVIDER"), aborted: false, partial };
      } else
        yield { type: "done", message: { ...partial, content: [], usage: zeroUsage(), stopReason: "stop" } };
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
    model: "replay/usage",
    messages: history,
    tools: [],
    contextPolicy: new ContextPolicy(),
  });
  await runtime.send("Next");
  expect(summaries).toBe(1);
  expect(events.filter((event) => event.type === "usage.updated").at(-1)).toMatchObject({
    promptIds: ["2"],
    inputTokens: 22,
    outputTokens: 3,
  });
  expect(JSON.stringify(runtime.messages())).not.toContain("INVALID PARTIAL SUMMARY");
});

it.each(["provider-error", "provider-abort", "done-before-abort"])(
  "preserves terminal reported consumption once on %s",
  async (failure) => {
    let id = 0;
    const events: RuntimeEvent[] = [];
    let runtime: ReferenceRuntime;
    const partial: AssistantMessage = {
      role: "assistant",
      api: "replay",
      provider: "replay",
      model: "usage",
      timestamp: 1,
      content: [],
      stopReason: "error",
      usage: { ...zeroUsage(), input: 17, output: 3, cacheRead: 5, cacheWrite: 2 },
    };
    const gateway: LlmGateway = {
      selectedModel: () => "replay/usage",
      models: async () => ({ reachability: "pass", models: [] }),
      capabilities: () => ({
        contextWindow: 6000,
        maxOutputTokens: 1000,
        safetyMargin: 1024,
        inputBudget: 3976,
        supportsTools: true,
      }),
      stream: async function* () {
        if (failure === "done-before-abort") {
          yield { type: "done", message: partial };
          runtime.abort();
        } else
          yield {
            type: "error",
            error: veraError("PROVIDER"),
            aborted: failure === "provider-abort",
            partial,
          };
      },
    };
    runtime = new ReferenceRuntime({
      gateway,
      now: () => 1,
      nextId: () => String(++id),
      approve: async () => "approved",
    });
    runtime.onEvent((event) => events.push(event));
    runtime.start({
      systemPrompt: "Rules",
      model: "replay/usage",
      messages: [],
      tools: [],
      contextPolicy: new ContextPolicy(),
    });
    expect((await runtime.send("One")).stopReason).toBe(failure === "provider-error" ? "error" : "aborted");
    const reported = events.filter((event) => event.type === "usage.updated" && event.inputTokens > 0);
    expect(reported).toHaveLength(1);
    expect(reported[0]).toMatchObject({ promptIds: ["2"], inputTokens: 24, outputTokens: 3 });
  },
);
