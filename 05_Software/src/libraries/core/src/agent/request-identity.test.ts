import { expect, it } from "vitest";
import { ReplayGateway } from "../llm/replay.js";
import { ContextPolicy } from "./context.js";
import { ReferenceRuntime, zeroUsage } from "./runtime.js";
import type { RuntimeEvent } from "./types.js";

it("uses a precommitted initial request identity once and generates ordinary identities afterwards", async () => {
  const gateway = new ReplayGateway({ dir: ".", now: () => 1 });
  gateway.stream = async function* () {
    yield {
      type: "done",
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
        api: "replay",
        provider: "replay",
        model: "test",
        timestamp: 1,
        usage: zeroUsage(),
        stopReason: "stop",
      },
    };
  };
  let id = 0;
  const events: RuntimeEvent[] = [];
  const runtime = new ReferenceRuntime({
    gateway,
    now: () => 1,
    nextId: () => `generated_${++id}`,
    approve: async () => "denied",
  });
  runtime.onEvent((event) => events.push(event));
  runtime.start({
    systemPrompt: "Test",
    model: "replay/test",
    tools: [],
    messages: [],
    contextPolicy: new ContextPolicy(),
    requestIdentity: { turnId: "accepted_turn", messageId: "accepted_message" },
  });
  expect(await runtime.send("Review")).toEqual({ stopReason: "end" });
  expect(events.filter((event) => event.type === "message.user" || event.type === "turn.started")).toEqual([
    { type: "message.user", messageId: "accepted_message", text: "Review" },
    { type: "turn.started", turnId: "accepted_turn" },
  ]);
  expect(events).toContainEqual({ type: "turn.done", turnId: "accepted_turn", stopReason: "end" });
  events.length = 0;
  await runtime.send("Ordinary");
  expect(events.find((event) => event.type === "message.user")).toMatchObject({
    messageId: expect.stringMatching(/^generated_/),
  });
  expect(events.find((event) => event.type === "turn.started")).toMatchObject({
    turnId: expect.stringMatching(/^generated_/),
  });
});
