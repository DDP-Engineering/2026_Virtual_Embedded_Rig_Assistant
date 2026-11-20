import { type LlmEvent, type LlmRequest, resolveCuratedConnection } from "@vera/core";
import { describe, expect, it, vi } from "vitest";
import { answer, toolCall } from "./direct-provider-streams.test-support.js";
import { ProviderGateway } from "./provider-gateway.js";
import { providerSettingsHarness } from "./provider-settings.test-support.js";

const miniMaxBase = "https://api.minimax.io/anthropic";
const miniMaxModel = "MiniMax-M3.1-Flash";
const glmModel = "glm-5.3-flash";
const offerings = [
  { id: "minimax-api", base: miniMaxBase, model: miniMaxModel, messages: true },
  { id: "minimax-m-plan", base: miniMaxBase, model: miniMaxModel, messages: true },
  { id: "zai-api", base: "https://api.z.ai/api/paas/v4", model: glmModel, messages: false },
  { id: "zai-coding-plan", base: "https://api.z.ai/api/coding/paas/v4", model: glmModel, messages: false },
] as const;
type Offering = (typeof offerings)[number];
function key(offering: Offering) {
  const fixture = `fixture-${offering.id}-private-value`;
  if (offering.id === "minimax-api") return `sk-api-${fixture}`;
  if (offering.id === "minimax-m-plan") return `sk-cp-${fixture}`;
  return fixture;
}
const config = (offering: Offering) => ({
  name: offering.id,
  baseUrl: offering.base,
  model: offering.model,
  preset: { id: offering.id, binding: "international" },
});
const tool = {
  name: "echo",
  description: "Echo text",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
    additionalProperties: false,
  },
} as const;
const thinkingSignature = "signed-thinking-fixture";

async function setup(fetcher: (request: Request) => Promise<Response> | Response) {
  const h = providerSettingsHarness();
  await h.settings.load();
  for (const offering of offerings)
    await h.service.save({ provider: "custom", config: config(offering), apiKey: key(offering) });
  const connections = (await h.service.list()).custom;
  const gateway = new ProviderGateway(
    h.settings,
    h.credentials,
    h.service,
    { now: () => new Date(0), sleep: async () => {} },
    undefined,
    undefined,
    (input, init) => Promise.resolve(fetcher(new Request(input, init))),
  );
  return {
    ...h,
    gateway,
    id: (offering: Offering) =>
      connections.find(({ name }) => name === offering.id)!.id as `custom:${string}`,
  };
}

function checkRoute(request: Request, offering: Offering) {
  expect(request.method).toBe("POST");
  expect(request.url).toBe(offering.base + (offering.messages ? "/v1/messages" : "/chat/completions"));
  expect(request.redirect).toBe("error");
  expect(request.headers.get("authorization")).toBe(offering.messages ? null : `Bearer ${key(offering)}`);
  expect(request.headers.get("x-api-key")).toBe(offering.messages ? key(offering) : null);
}

async function collect(stream: AsyncIterable<LlmEvent>) {
  const events: LlmEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function requestFor(id: string, model: string): LlmRequest {
  return {
    model: `${id}/${model}`,
    system: "Complete the request.",
    messages: [
      {
        role: "user",
        timestamp: 0,
        content: [
          { type: "text", text: "Echo OK." },
          { type: "image", data: "Zml4dHVyZQ==", mimeType: "image/png" },
        ],
      },
    ],
    tools: [tool],
    signal: new AbortController().signal,
    maxOutputTokens: 4096,
  };
}

describe("International MiniMax and Z.AI plans through the desktop gateway", () => {
  it("keeps credential slots and model profiles separate and rejects changed routes or regions", async () => {
    const fetcher = vi.fn(() => {
      throw Error("Manual selection must not contact a catalog");
    });
    const h = await setup(fetcher);
    const slots = await h.credentials.list();
    expect(slots).toHaveLength(4);
    expect(new Set(slots.map(({ providerId }) => providerId)).size).toBe(4);
    const standard = offerings[0];
    const plan = offerings[1];
    const standardModels = (await h.gateway.models(h.id(standard))).models;
    expect(standardModels.find(({ id }) => id === "MiniMax-M3")).toMatchObject({
      input: ["text", "image"],
      contextWindow: 1000000,
      maxOutputTokens: 131072,
      providerMaxOutputTokens: 524288,
      supportsTools: true,
      reasoningOptions: ["off", "on"],
    });
    expect((await h.gateway.models(h.id(plan))).models.map(({ id }) => id)).toEqual([miniMaxModel]);
    for (const offering of offerings) {
      const { models } = await h.gateway.models(h.id(offering));
      expect(models.find(({ id }) => id === offering.model)).toMatchObject({
        input: ["text", "image"],
        contextWindow: 1000000,
        maxOutputTokens: 131072,
        providerMaxOutputTokens: offering.messages ? 524288 : 131072,
        supportsTools: true,
        reasoningOptions: offering.messages
          ? ["low", "medium", "high", "xhigh", "max"]
          : ["low", "high", "max"],
      });
      if (!offering.messages)
        expect(models.find(({ id }) => id === "glm-5.3")).toMatchObject({
          input: ["text"],
          supportsTools: true,
        });
      expect(
        await h.gateway.discoverPreset({ preset: config(offering).preset, savedId: h.id(offering) }),
      ).toEqual({ status: "manual", reason: "configured" });
    }
    expect(
      await h.gateway.discoverPreset({ preset: config(plan).preset, savedId: h.id(standard) }),
    ).toMatchObject({ status: "failed", error: { code: "DENIED" } });
    expect(await h.gateway.discoverPreset({ preset: { id: standard.id, binding: "cn" } })).toMatchObject({
      status: "failed",
      error: { code: "NOT_FOUND" },
    });
    const zai = offerings[2];
    await expect(
      h.service.save({
        provider: "custom",
        id: h.id(zai),
        config: { ...config(zai), baseUrl: offerings[3].base },
      }),
    ).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      h.service.save({ provider: "custom", id: h.id(standard), config: config(plan) }),
    ).rejects.toMatchObject({ code: "DENIED" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [offerings[0], offerings[1]],
    [offerings[1], offerings[0]],
  ] as const)("rejects the other MiniMax key class in %o", async (offering, other) => {
    const fetcher = vi.fn(() => {
      throw Error("A mismatched MiniMax key must not reach the service");
    });
    const h = await setup(fetcher);
    const id = h.id(offering);
    const settingsBefore = h.disk.get("/data/settings.json");
    const credentialsBefore = h.disk.get("/data/credentials.json");
    const authError = { code: "PROVIDER", messageKey: "provider.auth" };
    await expect(
      h.service.save({
        provider: "custom",
        id,
        config: config(offering),
        apiKey: key(other),
      }),
    ).rejects.toMatchObject(authError);
    await expect(
      h.service.save({
        provider: "custom",
        config: { ...config(offering), name: "New MiniMax connection" },
        apiKey: key(other),
      }),
    ).rejects.toMatchObject(authError);
    expect(h.disk.get("/data/settings.json")).toBe(settingsBefore);
    expect(h.disk.get("/data/credentials.json")).toBe(credentialsBefore);

    const saved = h.settings.get().settings.providers.custom.find(({ name }) => name === offering.id)!;
    const { slot } = resolveCuratedConnection(saved, h.service.presets);
    await h.credentials.modify(slot, async () => ({ type: "api_key", key: key(other) }));
    const result = await collect(h.gateway.api.stream(requestFor(id, offering.model)));
    expect(result).toEqual([
      expect.objectContaining({ type: "error", error: expect.objectContaining(authError) }),
    ]);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(offerings)("streams thinking and a complete tool continuation through $id", async (offering) => {
    const bodies: Record<string, unknown>[] = [];
    const h = await setup(async (request) => {
      checkRoute(request, offering);
      bodies.push(await request.json());
      return bodies.length === 1 ? toolCall(offering, thinkingSignature) : answer(offering);
    });
    const first = { ...requestFor(h.id(offering), offering.model), reasoning: "high" };
    const start = await collect(h.gateway.api.stream(first));
    const done = start.find((event) => event.type === "done");
    expect(done?.message.content).toEqual([
      expect.objectContaining({ type: "thinking", thinking: "Prepare the echo." }),
      expect.objectContaining({ type: "toolCall", id: "call_echo", name: "echo", arguments: { text: "OK" } }),
    ]);
    if (!done) throw Error("Missing the assistant tool call");
    const result = await collect(
      h.gateway.api.stream({
        ...first,
        reasoning: null,
        messages: [
          ...first.messages,
          done.message,
          {
            role: "toolResult",
            toolCallId: "call_echo",
            toolName: "echo",
            isError: false,
            content: [{ type: "text", text: "OK" }],
            timestamp: 0,
          },
        ],
      }),
    );
    const streamed = result.filter((event) => event.type === "text");
    expect(streamed.map(({ delta }) => delta).join("")).toBe("Echo received.");
    expect(streamed.at(-1)?.sourceDeltas).toBe(2);
    expect(result.at(-1)?.type).toBe("done");
    expect(bodies).toHaveLength(2);
    if (offering.messages) {
      expect(bodies[0]).toMatchObject({
        model: offering.model,
        output_config: { effort: "high" },
        stream: true,
      });
      expect(bodies[1]).not.toHaveProperty("output_config");
      expect(bodies[1]).not.toHaveProperty("thinking");
      expect(bodies[1]).toMatchObject({
        max_tokens: 4096,
        messages: [
          { role: "user", content: [{ type: "text" }, { type: "image", source: { type: "base64" } }] },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Prepare the echo.", signature: thinkingSignature },
              { type: "tool_use", id: "call_echo", name: "echo", input: { text: "OK" } },
            ],
          },
          { role: "user", content: [{ type: "tool_result", tool_use_id: "call_echo", content: "OK" }] },
        ],
      });
    } else {
      expect(bodies[0]).toMatchObject({ model: offering.model, reasoning_effort: "high", stream: true });
      expect(bodies[1]).not.toHaveProperty("max_completion_tokens");
      expect(bodies[1]).toMatchObject({
        max_tokens: 4096,
        tool_stream: true,
        thinking: { type: "enabled", clear_thinking: false },
        reasoning_effort: "max",
        messages: [
          { role: "system" },
          { role: "user", content: [{ type: "text" }, { type: "image_url" }] },
          {
            role: "assistant",
            reasoning_content: "Prepare the echo.",
            tool_calls: [
              { id: "call_echo", type: "function", function: { name: "echo", arguments: '{"text":"OK"}' } },
            ],
          },
          { role: "tool", tool_call_id: "call_echo", content: "OK" },
        ],
      });
    }
  });

  it.each(offerings)(
    "tests $id and stops at the selected route for rejected keys and cancellation",
    async (offering) => {
      let response: "ok" | "unauthorized" | "hold" = "ok";
      let started!: (signal: AbortSignal) => void;
      const held = new Promise<AbortSignal>((resolve) => {
        started = resolve;
      });
      const fetcher = vi.fn(async (request: Request) => {
        checkRoute(request, offering);
        if (response === "unauthorized")
          return Response.json({ error: { message: key(offering) } }, { status: 401 });
        if (response === "hold") {
          started(request.signal);
          return new Promise<Response>((_resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
          });
        }
        const body = await request.json();
        expect(body).toMatchObject({
          model: offering.model,
          max_tokens: 4096,
          ...(offering.messages ? { output_config: { effort: "low" } } : { reasoning_effort: "low" }),
        });
        return body.tools ? toolCall(offering, thinkingSignature) : answer(offering);
      });
      const h = await setup(fetcher);
      expect((await h.gateway.test(h.id(offering))).steps.map(({ status }) => status)).toEqual([
        "skipped",
        "pass",
        "pass",
        "pass",
      ]);
      expect(fetcher).toHaveBeenCalledTimes(3);
      response = "unauthorized";
      const rejected = await h.gateway.test(h.id(offering));
      expect(rejected.steps).toContainEqual(
        expect.objectContaining({
          step: "authentication",
          status: "fail",
          error: expect.objectContaining({ messageKey: "provider.auth" }),
        }),
      );
      expect(JSON.stringify(rejected)).not.toContain(key(offering));
      expect(rejected.steps.slice(2).map(({ status }) => status)).toEqual(["skipped", "skipped"]);
      expect(fetcher).toHaveBeenCalledTimes(4);
      response = "hold";
      const controller = new AbortController();
      const pending = collect(
        h.gateway.api.stream({ ...requestFor(h.id(offering), offering.model), signal: controller.signal }),
      );
      const signal = await Promise.race([
        held,
        pending.then(() => {
          throw Error("Transport did not start");
        }),
      ]);
      controller.abort();
      expect((await pending).at(-1)).toMatchObject({ type: "error", aborted: true });
      expect(signal.aborted).toBe(true);
      expect(fetcher).toHaveBeenCalledTimes(5);
    },
  );

  it("keeps the M3 reasoning toggle distinct from Flash and leaves a manual GLM model unverified", async () => {
    const standard = offerings[0];
    const plan = offerings[3];
    const requests: Record<string, unknown>[] = [];
    const h = await setup(async (request) => {
      const body = await request.json();
      requests.push(body);
      if (body.model === "MiniMax-M3") return answer({ messages: true, model: body.model });
      return body.tools ? toolCall(plan) : answer(plan);
    });
    const m3 = { ...requestFor(h.id(standard), "MiniMax-M3"), tools: [] };
    expect((await collect(h.gateway.api.stream({ ...m3, reasoning: "on" }))).at(-1)?.type).toBe("done");
    expect((await collect(h.gateway.api.stream({ ...m3, reasoning: "off" }))).at(-1)?.type).toBe("done");
    expect(requests[0]).toMatchObject({ thinking: { type: "adaptive" } });
    expect(requests[1]).toMatchObject({ thinking: { type: "disabled" } });
    expect(requests[0]).not.toHaveProperty("output_config");
    expect(requests[1]).not.toHaveProperty("output_config");

    await h.service.save({
      provider: "custom",
      id: h.id(plan),
      config: { ...config(plan), model: "glm-manual" },
    });
    expect((await h.gateway.test(h.id(plan))).steps.find(({ step }) => step === "tools")?.status).toBe(
      "pass",
    );
    const manual = (await h.gateway.models(h.id(plan))).models.find(({ id }) => id === "glm-manual");
    expect(manual).toMatchObject({ inputVerified: false, contextVerified: false });
    expect(manual?.supportsTools).toBeUndefined();
    expect(manual?.reasoningOptions).toBeUndefined();
    expect(requests.at(-1)).not.toHaveProperty("thinking");
  });
});
