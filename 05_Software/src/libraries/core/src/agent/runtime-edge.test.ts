import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import { z } from "zod";
import type { LlmEvent, LlmGateway, LlmRequest } from "../llm/gateway.js";
import { ContextPolicy } from "./context.js";
import { buildContext, ReferenceRuntime, zeroUsage } from "./runtime.js";
import type { RuntimeEvent, ToolDef } from "./types.js";

const message = (
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage => ({
  role: "assistant",
  content,
  stopReason,
  usage: { ...zeroUsage(), input: 17, output: 3 },
  timestamp: 123,
  api: "replay",
  provider: "replay",
  model: "scenario",
});
const call = { type: "toolCall" as const, id: "call", name: "read", arguments: { path: "a" } };
function fixture(stream: LlmGateway["stream"], tools: ToolDef[] = []) {
  let id = 0,
    output = 1000,
    window = 6000;
  const events: RuntimeEvent[] = [],
    requests: LlmRequest[] = [];
  const gateway: LlmGateway = {
    selectedModel: () => "scenario",
    models: async () => ({ reachability: "pass", models: [] }),
    capabilities: () => ({
      contextWindow: window,
      maxOutputTokens: output,
      safetyMargin: 1024,
      inputBudget: window - output - 1024,
      supportsTools: true,
    }),
    stream: (request) => {
      requests.push(request);
      return stream(request);
    },
  };
  const runtime = new ReferenceRuntime({
    gateway,
    now: () => 123,
    nextId: () => `id${++id}`,
    approve: async () => "approved",
  });
  runtime.onEvent((e) => events.push(e));
  runtime.start({
    systemPrompt: "rules",
    model: "replay/scenario",
    tools,
    messages: [],
    contextPolicy: new ContextPolicy(),
  });
  return {
    runtime,
    events,
    requests,
    setBudget: (c: number, o: number) => {
      window = c;
      output = o;
    },
  };
}
it("retains text on stream abort with no executable partial calls and closes once", async () => {
  const f = fixture(async function* () {
    yield { type: "text", delta: "partial text" };
    yield { type: "error", error: { code: "PROVIDER", messageKey: "error.provider" }, aborted: true };
  });
  f.runtime.onEvent((e) => {
    if (e.type === "message.delta") f.runtime.abort();
  });
  expect((await f.runtime.send("start")).stopReason).toBe("aborted");
  expect(JSON.stringify(f.runtime.messages())).toContain("partial text");
  expect(f.events.filter((e) => e.type === "turn.done")).toHaveLength(1);
});
it("retains streamed text on terminal EOF without executing partial tools and closes once", async () => {
  let executions = 0;
  const f = fixture(
    async function* () {
      yield { type: "text", delta: "visible partial" };
      yield { type: "tool", index: 0, delta: '{"path":"a"' };
    },
    [
      {
        name: "read",
        class: "read",
        description: "read",
        params: z.strictObject({ path: z.string() }),
        execute: async () => {
          executions++;
          return "ran";
        },
      },
    ],
  );
  expect((await f.runtime.send("start")).stopReason).toBe("error");
  expect(f.runtime.messages().at(-1)).toMatchObject({
    role: "assistant",
    content: [{ type: "text", text: "visible partial" }],
  });
  expect(executions).toBe(0);
  expect(f.events.filter((e) => e.type === "message.done")).toHaveLength(1);
  expect(f.events.filter((e) => e.type === "error")).toHaveLength(1);
  expect(f.events.filter((e) => e.type === "turn.done")).toEqual([
    expect.objectContaining({ stopReason: "error" }),
  ]);
});
it("stops an executing tool through its signal and closes every call", async () => {
  let resolveStarted!: () => void;
  const started = new Promise<void>((r) => {
    resolveStarted = r;
  });
  const tool: ToolDef = {
    name: "read",
    class: "read",
    description: "read",
    params: z.strictObject({ path: z.string() }),
    execute: async (_args, signal) =>
      new Promise((_resolve, reject) => {
        resolveStarted();
        signal.addEventListener("abort", () => reject(Error("aborted")), { once: true });
      }),
  };
  const f = fixture(
    async function* () {
      yield { type: "done", message: message([call], "toolUse") };
    },
    [tool],
  );
  const turn = f.runtime.send("start");
  await started;
  f.runtime.abort();
  expect((await turn).stopReason).toBe("aborted");
  expect(f.runtime.messages().at(-1)).toMatchObject({
    role: "toolResult",
    toolCallId: "call",
    isError: true,
  });
});
it("never executes truncated model tool arguments", async () => {
  let executions = 0;
  const tool: ToolDef = {
    name: "read",
    class: "read",
    description: "read",
    params: z.strictObject({ path: z.string() }),
    execute: async () => {
      executions++;
      return "ran";
    },
  };
  const f = fixture(
    async function* () {
      yield { type: "done", message: message([call], "length") };
    },
    [tool],
  );
  expect((await f.runtime.send("truncated")).stopReason).toBe("limit");
  expect(executions).toBe(0);
  expect(f.runtime.messages().at(-1)).toMatchObject({ role: "toolResult", isError: true });
});
it("provider context rejection ends limit without retries and keeps actual usage separate", async () => {
  let n = 0;
  const f = fixture(async function* () {
    n++;
    yield {
      type: "error",
      error: { code: "PROVIDER", messageKey: "providers.error.context", params: { reason: "context" } },
      aborted: false,
    };
  });
  expect((await f.runtime.send("start")).stopReason).toBe("limit");
  expect(n).toBe(1);
  expect(f.events).toContainEqual({
    type: "error",
    code: "CONTEXT_LIMIT",
    messageKey: "context.budget_exceeded",
    retryable: false,
  });
});
it("re-resolves output reserve on every model call and preserves actual reported usage", async () => {
  let n = 0;
  const tool: ToolDef = {
    name: "read",
    class: "read",
    description: "read",
    params: z.strictObject({ path: z.string() }),
    execute: async () => {
      f.setBudget(6000, 2000);
      return "done";
    },
  };
  const f = fixture(
    async function* () {
      yield {
        type: "done",
        message: message(n++ ? [{ type: "text", text: "done" }] : [call], n === 1 ? "toolUse" : "stop"),
      };
    },
    [tool],
  );
  expect((await f.runtime.send("start")).stopReason).toBe("end");
  expect(f.requests.map((r) => r.maxOutputTokens)).toEqual([1000, 2000]);
  expect(f.events.filter((e) => e.type === "usage.updated" && e.contextWindow)).toContainEqual(
    expect.objectContaining({
      inputTokens: 17,
      outputTokens: 3,
      reservedOutputTokens: 2000,
      inputBudgetTokens: 2976,
    }),
  );
});
it("interrupted resume repairs only transient pairs and observers cannot corrupt history", async () => {
  const stored: Message[] = [
    message([call], "toolUse"),
    { role: "user", content: "continue", timestamp: 123 },
  ];
  const saved = JSON.stringify(stored),
    view = buildContext(stored, 123);
  expect(JSON.stringify(stored)).toBe(saved);
  expect(view[1]).toMatchObject({ role: "toolResult", toolCallId: "call", isError: true });
  expect(view[2]).toMatchObject({ role: "assistant" });
  const f = fixture(async function* () {
    yield { type: "done", message: message([{ type: "text", text: "done" }]) };
  });
  f.runtime.onEvent(() => {
    throw Error("bad observer");
  });
  expect((await f.runtime.send("start")).stopReason).toBe("end");
});
it("empty terminal stream yields an error and tool cap closes all unexecuted pairs", async () => {
  const empty = fixture(async function* (): AsyncIterable<LlmEvent> {});
  expect((await empty.runtime.send("start")).stopReason).toBe("error");
  let executions = 0;
  const tool: ToolDef = {
    name: "read",
    class: "read",
    description: "read",
    params: z.strictObject({ path: z.string() }),
    execute: async () => {
      executions++;
      return "ok";
    },
  };
  const cap = fixture(
    async function* () {
      yield {
        type: "done",
        message: message(
          Array.from({ length: 51 }, (_, i) => ({ ...call, id: `call${i}` })),
          "toolUse",
        ),
      };
    },
    [tool],
  );
  cap.setBudget(32768, 1000);
  expect((await cap.runtime.send("cap")).stopReason).toBe("limit");
  expect(executions).toBe(50);
  expect(cap.runtime.messages().filter((m) => m.role === "toolResult")).toHaveLength(51);
});
