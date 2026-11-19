import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";
import { ReferenceRuntime, zeroUsage } from "../agent/runtime.js";
import { MessagesRepository } from "../storage/repos/messages.js";
import { fixture, input, plan } from "./review-turn.test-support.js";
import { SessionImages } from "./session-images.js";

const answer = (text: string): AssistantMessage => ({
  role: "assistant",
  content: [{ type: "text", text }],
  api: "replay",
  provider: "replay",
  model: "test",
  timestamp: 1,
  usage: zeroUsage(),
  stopReason: "stop",
});

it("reconciles an accepted receipt before shutdown busy checks without admitting fresh work", async () => {
  const env = await fixture();
  const receipt = env.service.reviewPlan(env.id, input);
  const close = env.service.close();
  expect(env.service.reviewPlan(env.id, input)).toEqual(receipt);
  expect(() => env.service.reviewPlan(env.id, { ...input, expectedFeedbackRevision: 2 })).toThrow(
    expect.objectContaining({ code: "BUSY" }),
  );
  await close;
});

it("has an abortable review installed before seed observers can Stop it", async () => {
  const env = await fixture();
  const stopBackground = vi.fn();
  env.host.programs = { runner: { stopSession: stopBackground } } as never;
  const stream = vi.spyOn(env.host.gateway, "stream");
  const stopped: boolean[] = [];
  env.service.subscribe(env.id, env.service.revision(env.id).seq, (_seq, event) => {
    if (event.type === "plan.review.submitted") stopped.push(env.service.stop(env.id));
  });
  env.service.reviewPlan(env.id, input);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "aborted" });
  expect(stopped).toEqual([true]);
  expect(stopBackground).not.toHaveBeenCalled();
  expect(stream).not.toHaveBeenCalled();
});

it("keeps every summary and finalization boundary review-only, including fabricated gateway tool specs", async () => {
  const env = await fixture();
  const rows = new MessagesRepository(env.host.db);
  for (let i = 0; i < 4; i++) {
    const message: Message =
      i % 2 === 0 ? { role: "user", content: "h".repeat(850), timestamp: i } : answer("a".repeat(850));
    rows.create({
      session_id: env.id,
      seq: i + 1,
      role: message.role,
      content_json: JSON.stringify(message),
      created_at: new Date(i).toISOString(),
    });
  }
  env.host.gateway.capabilities = () => ({
    input: ["text"],
    contextWindow: 6000,
    maxOutputTokens: 1000,
    inputBudget: 3976,
    safetyMargin: 1024,
    supportsTools: true,
  });
  const refusals: unknown[] = [],
    offerings: string[][] = [],
    phases: string[] = [];
  env.host.gateway.stream = async function* (request) {
    const summary = request.system.includes("Return only JSON:");
    phases.push(summary ? "summary" : "normal");
    offerings.push(request.tools.map((tool) => tool.name));
    try {
      env.service.send(env.id, "Execute during model call");
    } catch (error) {
      refusals.push((error as { code: unknown }).code);
    }
    yield {
      type: "done",
      message: answer(
        summary
          ? JSON.stringify({ summary: "GPIO context", decisions: [], outstandingWork: [] })
          : "Brief explanation",
      ),
    };
  };
  env.host.runtime = (host) => {
    const runtime = new ReferenceRuntime({
      ...host,
      gateway: {
        ...host.gateway,
        stream: async function* (request) {
          const candidate = request.tools[0];
          yield* host.gateway.stream({
            ...request,
            tools: candidate ? [...request.tools, { ...candidate, name: "write" }] : [],
          });
        },
      },
    });
    runtime.onEvent((event) => {
      if (event.type === "turn.done") {
        try {
          env.service.send(env.id, "Execute during finalization");
        } catch (error) {
          refusals.push((error as { code: unknown }).code);
        }
      }
    });
    return runtime;
  };
  env.service.reviewPlan(env.id, input);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "end" });
  expect(phases).toContain("summary");
  expect(phases).toContain("normal");
  expect(offerings.every((tools) => tools.every((name) => name === "todo"))).toBe(true);
  expect(refusals).toEqual(phases.map(() => "BUSY").concat("BUSY"));
  expect(env.service.get(env.id).snapshot.items.some((item) => item.kind === "user" && item.pending)).toBe(
    false,
  );
});

it("keeps historical image references text-only during review without reading project images", async () => {
  const env = await fixture();
  const capabilities = env.host.gateway.capabilities.bind(env.host.gateway);
  env.host.gateway.capabilities = (...args) => ({ ...capabilities(...args), input: ["text", "image"] });
  new MessagesRepository(env.host.db).create({
    session_id: env.id,
    seq: 1,
    role: "user",
    content_json: JSON.stringify({
      role: "user",
      content: "Inspect image",
      images: ["board.png"],
      timestamp: 1,
    }),
    created_at: new Date(1).toISOString(),
  });
  const read = vi.spyOn(SessionImages.prototype, "read");
  const stream = vi.spyOn(env.host.gateway, "stream");
  try {
    env.service.reviewPlan(env.id, input);
    expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "end" });
    expect(read).not.toHaveBeenCalled();
    expect(stream).toHaveBeenCalled();
    for (const [request] of stream.mock.calls) {
      expect(JSON.stringify(request.messages)).toContain("Image attachment: board.png");
      expect(
        request.messages.some(
          (message) =>
            Array.isArray(message.content) && message.content.some((part) => part.type === "image"),
        ),
      ).toBe(false);
      expect(request.tools.map((tool) => tool.name)).toEqual(["todo"]);
    }
  } finally {
    read.mockRestore();
  }
});

it("rejects image steering during review before attachment validation can probe files", async () => {
  const env = await fixture();
  const validate = vi.spyOn(SessionImages.prototype, "validate");
  try {
    env.service.reviewPlan(env.id, input);
    await expect(env.service.sendWithImages(env.id, "Execute", ["missing.png"])).rejects.toMatchObject({
      code: "BUSY",
    });
    expect(validate).not.toHaveBeenCalled();
    expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "end" });
    expect(env.service.get(env.id).snapshot.items.some((item) => item.kind === "user" && item.pending)).toBe(
      false,
    );
  } finally {
    validate.mockRestore();
  }
});

it("does not bypass an injected host permission policy for the built-in todo tool", async () => {
  const env = await fixture("bypass");
  await env.script([{ toolCalls: [{ name: "todo", args: { items: [] } }] }, { text: "Clarification only" }]);
  const deny = vi.fn(async () => false);
  env.host.permissions = { allow: deny };
  env.service.reviewPlan(env.id, input);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "end" });
  expect(deny).toHaveBeenCalledOnce();
  expect(env.service.get(env.id).snapshot.todos).toEqual(plan);
  expect(env.service.get(env.id).snapshot.approvals).toEqual([]);
});

it("rechecks disabled todo after an asynchronous host policy wait and never widens capabilities on mode changes", async () => {
  const env = await fixture("ask");
  await env.script([{ toolCalls: [{ name: "todo", args: { items: [] } }] }, { text: "Clarification only" }]);
  env.host.permissions = {
    allow: async () => {
      env.service.setMode(env.id, "bypass");
      env.host.disabledTools = ["todo"];
      return true;
    },
  };
  const stream = vi.spyOn(env.host.gateway, "stream");
  env.service.reviewPlan(env.id, input);
  expect(await env.service.waitIdle(env.id)).toEqual({ stopReason: "end" });
  expect(env.service.get(env.id).snapshot.todos).toEqual(plan);
  expect(env.service.get(env.id).snapshot.approvals).toEqual([]);
  for (const [request] of stream.mock.calls)
    expect(request.tools.every((tool) => tool.name === "todo")).toBe(true);
});
