// REQ-FUNC-63733e2c. Authored for deferred runtime verification; do not imply execution.
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import type { LlmGateway, LlmRequest } from "../llm/gateway.js";
import { ContextPolicy } from "./context.js";
import { ReferenceRuntime, zeroUsage } from "./runtime.js";
import type { RuntimeEvent } from "./types.js";

const caps = {
  contextWindow: 6000,
  maxOutputTokens: 1000,
  inputBudget: 3976,
  safetyMargin: 1024,
  supportsTools: true,
};
const answer = (text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "replay",
  provider: "replay",
  model: "steering",
  timestamp: 1,
  usage: zeroUsage(),
  stopReason: "stop",
});
function rig(stream: LlmGateway["stream"], messages: Message[] = []) {
  const queue: { messageId: string; text: string; timestamp: number }[] = [];
  const events: RuntimeEvent[] = [];
  let id = 0;
  const runtime = new ReferenceRuntime({
    gateway: {
      capabilities: () => caps,
      selectedModel: () => "steering",
      models: async () => ({ models: [], reachability: "pass" }),
      stream,
    },
    now: () => 1,
    nextId: () => String(++id),
    approve: async () => "approved",
    steering: () => structuredClone(queue),
  });
  runtime.onEvent((event) => {
    events.push(event);
    if (event.type === "message.delivered")
      for (let i = queue.length - 1; i >= 0; i--)
        if (event.messageIds.includes(queue[i]?.messageId ?? "")) queue.splice(i, 1);
  });
  runtime.start({
    systemPrompt: "Current rules",
    model: "replay/steering",
    tools: [],
    messages,
    contextPolicy: new ContextPolicy(),
  });
  return { runtime, queue, events };
}

it("includes summary-time steering in the next normal request and preserves the whole current instruction", async () => {
  const history: Message[] = [];
  for (let i = 0; i < 2; i++)
    history.push({ role: "user", content: "h".repeat(850), timestamp: i }, answer("a".repeat(850)));
  const requests: LlmRequest[] = [];
  const host = rig(async function* (request) {
    requests.push(request);
    const summary = request.system.includes("Return only JSON:");
    if (summary) {
      expect(JSON.stringify(request.messages)).not.toContain("CURRENT ORIGINAL");
      expect(JSON.stringify(request.messages)).not.toContain("STEER BEFORE");
      host.queue.push({ messageId: "during", text: "STEER DURING SUMMARY", timestamp: 3 });
    }
    yield {
      type: "done",
      message: answer(
        summary
          ? JSON.stringify({ summary: "Board", decisions: ["3.3V"], outstandingWork: ["Reset"] })
          : "Done",
      ),
    };
  }, history);
  host.runtime.onEvent((event) => {
    if (event.type === "turn.started")
      host.queue.push({ messageId: "before", text: "STEER BEFORE", timestamp: 2 });
  });
  expect(await host.runtime.send("CURRENT ORIGINAL")).toEqual({ stopReason: "end" });
  expect(requests.filter((request) => request.system.includes("Return only JSON:"))).toHaveLength(1);
  const normal = requests.find((request) => !request.system.includes("Return only JSON:"));
  expect(JSON.stringify(normal?.messages)).toContain("CURRENT ORIGINAL");
  expect(JSON.stringify(normal?.messages)).toContain("STEER BEFORE");
  expect(JSON.stringify(normal?.messages)).toContain("STEER DURING SUMMARY");
  for (const request of requests) expect(new ContextPolicy().prepare(request, caps, false).fits).toBe(true);
  expect(host.events.filter((event) => event.type === "message.delivered")).toEqual([
    { type: "message.delivered", messageIds: ["before", "during"] },
  ]);
  expect(host.runtime.messages()).toHaveLength(history.length + 4);
  expect(JSON.stringify(host.runtime.messages())).not.toContain("Derived historical context");
});

it("continues after a final answer for queued steering and retains irreducible pending messages on limit", async () => {
  let calls = 0;
  const host = rig(async function* () {
    calls++;
    host.queue.push({ messageId: "huge", text: "x".repeat(10000), timestamp: 2 });
    yield { type: "done", message: answer("Finished the first request") };
  });
  expect(await host.runtime.send("Current instruction")).toEqual({ stopReason: "limit" });
  expect(calls).toBe(1);
  expect(host.queue).toHaveLength(1);
  expect(host.events.some((event) => event.type === "message.delivered")).toBe(false);
  expect(host.events).toContainEqual(expect.objectContaining({ type: "error", code: "CONTEXT_LIMIT" }));
  expect(JSON.stringify(host.runtime.messages())).not.toContain("x".repeat(10000));
});

it("reuses recovered steering ahead of the new instruction through every call in the next turn", async () => {
  const requests: LlmRequest[] = [];
  const host = rig(async function* (request) {
    requests.push(request);
    if (requests.length === 1) host.queue.push({ messageId: "late", text: "Latest", timestamp: 3 });
    yield { type: "done", message: answer("Done") };
  });
  host.queue.push({ messageId: "old", text: "Recovered", timestamp: 0 });
  expect(await host.runtime.send("New instruction")).toEqual({ stopReason: "end" });
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    const users = request.messages
      .filter((message) => message.role === "user")
      .map((message) => message.content);
    expect(users.slice(0, 2)).toEqual(["Recovered", "New instruction"]);
  }
  expect(host.queue).toEqual([]);
});
