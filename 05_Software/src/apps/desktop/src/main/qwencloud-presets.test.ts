import type { LlmEvent, LlmRequest } from "@vera/core";
import type { ProviderSave } from "@vera/shared";
import { describe, expect, it, vi } from "vitest";
import { ProviderGateway } from "./provider-gateway.js";
import { providerSettingsHarness } from "./provider-settings.test-support.js";

const vision = "qwen3.8-flash";
const max = "qwen3.7-max";
const plans = [
  {
    id: "qwencloud-standard",
    label: "QwenCloud Standard",
    base: "https://maas.qwencloudapi.com/compatible-mode/v1",
    key: "sk-ws-fixture-standard",
  },
  {
    id: "qwencloud-token-plan",
    label: "QwenCloud Token Plan",
    base: "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1",
    key: "sk-sp-fixture-token-plan",
  },
] as const;
type Plan = (typeof plans)[number];

function setup(
  plan: Plan,
  model = vision,
  key: string = plan.key,
): Extract<ProviderSave, { provider: "custom" }> {
  return {
    provider: "custom",
    config: {
      name: plan.label,
      baseUrl: plan.base,
      model,
      preset: { id: plan.id, binding: "default" },
    },
    apiKey: key,
  };
}

async function configured(fetcher: typeof fetch, model = vision, keys = plans.map(({ key }): string => key)) {
  const h = providerSettingsHarness();
  await h.settings.load();
  for (const [index, plan] of plans.entries()) await h.service.save(setup(plan, model, keys[index]));
  const gateway = new ProviderGateway(
    h.settings,
    h.credentials,
    h.service,
    { now: () => new Date(0), sleep: async () => {} },
    undefined,
    undefined,
    fetcher,
  );
  return { ...h, gateway, connections: (await h.service.list()).custom };
}

function streamResponse(deltas: object[], stop = "stop") {
  const data = deltas.map((delta, index) => {
    const chunk = {
      id: "fixture",
      choices: [{ index: 0, delta, finish_reason: index === deltas.length - 1 ? stop : null }],
    };
    return `data: ${JSON.stringify(chunk)}\n\n`;
  });
  return new Response(`${data.join("")}data: [DONE]\n\n`, {
    headers: { "content-type": "text/event-stream" },
  });
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function requestFor(model: string, signal = new AbortController().signal): LlmRequest {
  return {
    model,
    system: "Complete the request.",
    messages: [{ role: "user", content: "Echo OK", timestamp: 0 }],
    tools: [],
    signal,
  };
}

async function collect(stream: AsyncIterable<LlmEvent>) {
  const result: LlmEvent[] = [];
  for await (const event of stream) result.push(event);
  return result;
}

describe("QwenCloud presets through the production provider gateway", () => {
  it("scopes discovered IDs, documented capabilities and credentials to each international route", async () => {
    const visited = new Set<string>();
    const h = await configured(async (input, init) => {
      const request = new Request(input, init);
      const index = plans.findIndex(({ base }) => request.url === `${base}/models`);
      const plan = plans[index];
      if (!plan) throw Error("Unexpected catalog route");
      expect(request.method).toBe("GET");
      expect(request.redirect).toBe("error");
      expect(request.headers.get("authorization")).toBe(`Bearer ${plan.key}`);
      visited.add(plan.id);
      return Response.json({ data: [{ id: vision }, { id: index === 0 ? max : "org/team-chat" }] });
    });
    for (const [index, plan] of plans.entries()) {
      const connection = h.connections[index]!;
      const other = h.connections[1 - index]!;
      const preset = setup(plan).config.preset!;
      expect(await h.gateway.discoverPreset({ preset, savedId: other.id })).toMatchObject({
        status: "failed",
        error: { code: "DENIED" },
      });
      const second = index === 0 ? max : "org/team-chat";
      expect(await h.gateway.discoverPreset({ preset, savedId: connection.id })).toMatchObject({
        status: "discovered",
        models: [vision, second],
      });
      const { models } = await h.gateway.models(connection.id);
      expect(models.map(({ id }) => id)).toEqual([vision, second]);
      expect(models[0]).toMatchObject({
        reference: `${connection.id}/${vision}`,
        providerName: plan.label,
        input: ["text", "image"],
        contextVerified: true,
        supportsTools: true,
        reasoningOptions: ["off", "on"],
      });
      expect(models[1]).toMatchObject(
        index === 0
          ? { input: ["text"], inputVerified: true, supportsTools: true, reasoningOptions: ["off", "on"] }
          : { input: ["text"], inputVerified: false, contextVerified: false },
      );
      if (index === 1) {
        expect(models[1]?.supportsTools).toBeUndefined();
        expect(models[1]?.reasoningOptions).toBeUndefined();
      }
      await expect(h.gateway.api.prepareModel?.(`${connection.id}/${second}`)).resolves.toBeUndefined();
      await expect(
        h.gateway.api.prepareModel?.(`${connection.id}/${index === 0 ? "org/team-chat" : max}`),
      ).rejects.toMatchObject({ messageKey: "provider.qwenCloudModel" });
    }
    expect(visited).toEqual(new Set(plans.map(({ id }) => id)));
  });

  it.each([401, 404])("allows manual configuration when the catalog returns %i", async (status) => {
    const ps = vi.fn<(body: unknown) => void>();
    const model = "org/manual-model";
    const h = await configured(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") return Response.json({}, { status });
      const body = await request.json();
      expect(request.url).toBe(`${plans[0].base}/chat/completions`);
      expect(body).toHaveProperty("model", model);
      expect(body).not.toHaveProperty("enable_thinking");
      ps(body);
      return body.tools
        ? streamResponse(
            [
              {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_echo",
                    type: "function",
                    function: { name: "echo", arguments: '{"text":"OK"}' },
                  },
                ],
              },
            ],
            "tool_calls",
          )
        : streamResponse([{ content: "O" }, { content: "K" }]);
    }, model);
    const connection = h.connections[0]!;
    expect(
      await h.gateway.discoverPreset({
        preset: setup(plans[0]).config.preset!,
        savedId: connection.id,
      }),
    ).toEqual({ status: "manual", reason: "unavailable" });
    expect((await h.gateway.models(connection.id)).models.map(({ id }) => id)).toEqual([model]);
    expect((await h.gateway.test(connection.id)).steps.map(({ status }) => status)).toEqual([
      "skipped",
      "pass",
      "pass",
      "pass",
    ]);
    expect(ps).toHaveBeenCalledTimes(3);
  });

  it.each(plans)(
    "continues streamed thinking and tools, then cancels and recovers on $label",
    async (plan) => {
      const posts: Record<string, unknown>[] = [];
      const held = deferred<AbortSignal>();
      const h = await configured(async (input, init) => {
        const request = new Request(input, init);
        expect(request.headers.get("authorization")).toBe(`Bearer ${plan.key}`);
        expect(request.redirect).toBe("error");
        if (request.method === "GET") {
          expect(request.url).toBe(`${plan.base}/models`);
          return Response.json({ data: [{ id: vision }] });
        }
        expect(request.url).toBe(`${plan.base}/chat/completions`);
        posts.push(await request.json());
        if (posts.length === 1) {
          return streamResponse(
            [
              { reasoning_content: "Prepare " },
              { reasoning_content: "the echo." },
              {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_echo",
                    type: "function",
                    function: { name: "echo", arguments: '{"text":' },
                  },
                ],
              },
              { tool_calls: [{ index: 0, function: { arguments: '"OK"}' } }] },
            ],
            "tool_calls",
          );
        }
        if (posts.length === 3) {
          held.resolve(request.signal);
          return new Promise((_resolve, reject) => {
            request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
          });
        }
        return streamResponse([{ content: "Echo " }, { content: "received." }]);
      });
      const model = `${h.connections[plans.indexOf(plan)]!.id}/${vision}`;
      const request: LlmRequest = {
        ...requestFor(model),
        reasoning: "on",
        sessionId: "ses_fixture",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Echo OK" },
              { type: "image", data: "Zml4dHVyZQ==", mimeType: "image/png" },
            ],
            timestamp: 0,
          },
        ],
        tools: [
          {
            name: "echo",
            description: "Echo",
            parameters: { type: "object", properties: { text: { type: "string" } } },
          },
        ],
      };
      const first = await collect(h.gateway.api.stream(request));
      expect(first.some(({ type }) => type === "tool")).toBe(true);
      const terminal = first.at(-1);
      if (terminal?.type !== "done") throw Error("Expected complete tool call");
      expect(terminal.message.content).toContainEqual({
        type: "toolCall",
        id: "call_echo",
        name: "echo",
        arguments: { text: "OK" },
      });
      const continued = await collect(
        h.gateway.api.stream({
          ...request,
          messages: [
            ...request.messages,
            terminal.message,
            {
              role: "toolResult",
              toolCallId: "call_echo",
              toolName: "echo",
              content: [{ type: "text", text: "OK" }],
              isError: false,
              timestamp: 1,
            },
          ],
        }),
      );
      expect(continued.at(-1)).toMatchObject({
        type: "done",
        message: { content: [{ text: "Echo received." }] },
      });
      expect(continued).toContainEqual(expect.objectContaining({ type: "text", sourceDeltas: 2 }));
      expect(posts[0]).toMatchObject({
        stream: true,
        enable_thinking: true,
        messages: expect.arrayContaining([
          expect.objectContaining({
            role: "user",
            content: expect.arrayContaining([
              {
                type: "image_url",
                image_url: { url: "data:image/png;base64,Zml4dHVyZQ==" },
              },
            ]),
          }),
        ]),
      });
      expect(posts[0]).not.toHaveProperty("reasoning_effort");
      expect(posts[1]?.messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            reasoning_content: "Prepare the echo.",
            tool_calls: [expect.objectContaining({ id: "call_echo" })],
          }),
          expect.objectContaining({ role: "tool", tool_call_id: "call_echo", content: "OK" }),
        ]),
      );
      const stopped = new AbortController();
      const inFlight = collect(
        h.gateway.api.stream({ ...request, signal: stopped.signal, reasoning: "off" }),
      );
      const transportSignal = await held.promise;
      stopped.abort();
      expect((await inFlight).at(-1)).toMatchObject({ type: "error", aborted: true });
      expect(transportSignal.aborted).toBe(true);
      expect(posts[2]).toHaveProperty("enable_thinking", false);
      expect((await collect(h.gateway.api.stream(request))).at(-1)).toMatchObject({ type: "done" });
    },
  );

  it("does not authorize a secondary model from a superseded catalog response", async () => {
    const oldRequest = deferred<void>();
    const oldResponse = deferred<Response>();
    let listings = 0;
    const infer = vi.fn(() => streamResponse([{ content: "This POST should never happen." }]));
    const h = await configured(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "POST") return infer();
      if (++listings === 1) {
        oldRequest.resolve();
        return oldResponse.promise;
      }
      return Response.json({ data: [{ id: vision }, { id: "org/current" }] });
    });
    const id = h.connections[0]!.id;
    const pending = collect(h.gateway.api.stream(requestFor(`${id}/org/removed`)));
    await oldRequest.promise;
    expect((await h.gateway.api.models(id, undefined, true)).models.map(({ id }) => id)).toEqual([
      vision,
      "org/current",
    ]);
    oldResponse.resolve(Response.json({ data: [{ id: vision }, { id: "org/removed" }] }));
    expect((await pending).at(-1)).toMatchObject({
      type: "error",
      error: { messageKey: "provider.qwenCloudModel" },
    });
    expect(infer).not.toHaveBeenCalled();
  });

  it("uses short non-thinking probes for a documented hybrid model", async () => {
    const h = await configured(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") return Response.json({ data: [] });
      const body = await request.json();
      expect(body).toMatchObject({ model: vision, max_completion_tokens: 256, enable_thinking: false });
      return body.tools
        ? streamResponse(
            [
              {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_echo_test",
                    type: "function",
                    function: { name: "echo", arguments: '{"text":"OK"}' },
                  },
                ],
              },
            ],
            "tool_calls",
          )
        : streamResponse([{ content: "O" }, { content: "K" }]);
    });
    const connection = h.connections[1]!;
    expect(
      await h.gateway.discoverPreset({
        preset: setup(plans[1]).config.preset!,
        savedId: connection.id,
      }),
    ).toEqual({ status: "manual", reason: "empty" });
    expect((await h.gateway.test(connection.id)).steps.map(({ status }) => status)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
  });

  it("rejects keys entered for the wrong plan before dispatch", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const h = await configured(fetcher, vision, [plans[1].key, plans[0].key]);
    for (const [index, plan] of plans.entries()) {
      const connection = h.connections[index]!;
      const expected = { code: "PROVIDER", messageKey: "provider.qwenCloudAuth" };
      expect(
        await h.gateway.discoverPreset({
          preset: setup(plan).config.preset!,
          savedId: connection.id,
        }),
      ).toEqual({ status: "failed", error: expected });
      expect(
        (await collect(h.gateway.api.stream(requestFor(`${connection.id}/${vision}`)))).at(-1),
      ).toMatchObject({ type: "error", error: expected });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each(plans)("separates rejected keys, models, quota and throttling on $label", async (plan) => {
    let errorResponse = () => Response.json({});
    const h = await configured(async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.get("authorization")).toBe(`Bearer ${plan.key}`);
      if (request.method === "GET") return Response.json({ data: [{ id: vision }] });
      expect(request.url).toBe(`${plan.base}/chat/completions`);
      return errorResponse();
    });
    const connection = h.connections[plans.indexOf(plan)]!;
    const stream = () => collect(h.gateway.api.stream(requestFor(`${connection.id}/${vision}`)));
    for (const [status, body, messageKey] of [
      [401, { code: "InvalidApiKey", message: plan.key }, "provider.qwenCloudAuth"],
      [403, { error: { code: "AccessDenied.Unpurchased", message: plan.key } }, "provider.qwenCloudModel"],
      [403, { code: "Model.AccessDenied", message: plan.key }, "provider.qwenCloudModel"],
      [403, { error: { type: "App.AccessDenied", code: null } }, "provider.qwenCloudModel"],
      [
        400,
        { error: { code: "invalid_parameter_error", message: "The product is not activated." } },
        "provider.qwenCloudModel",
      ],
      [400, { code: "InvalidParameter", message: "Model not exist." }, "provider.qwenCloudModel"],
      [
        400,
        { error: { code: "invalid_parameter_error", message: "Required body invalid." } },
        "provider.failure",
      ],
      [404, { error: { code: "model_not_found", message: plan.key } }, "provider.qwenCloudModel"],
      [
        429,
        { error: { code: "insufficient_quota", message: plan.key } },
        plan === plans[1] ? "provider.qwenCloudQuota" : "provider.rateLimit",
      ],
      [429, { code: "limit_requests", message: plan.key }, "provider.rateLimit"],
      [
        429,
        { code: "Throttling.AllocationQuota", message: "Allocated quota exceeded" },
        "provider.rateLimit",
      ],
    ] as const) {
      errorResponse = () => Response.json(body, { status, headers: { "Retry-After": "30" } });
      const last = (await stream()).at(-1);
      expect(last).toMatchObject({
        type: "error",
        aborted: false,
        error: {
          code: "PROVIDER",
          messageKey,
          ...(messageKey === "provider.rateLimit" ? { params: { retryAfter: "30" } } : {}),
        },
      });
      expect(JSON.stringify(last)).not.toContain(plan.key);
    }
  });
});
