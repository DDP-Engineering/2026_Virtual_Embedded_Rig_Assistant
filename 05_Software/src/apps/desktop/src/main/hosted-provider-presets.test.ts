import { type LlmEvent, type LlmRequest, resolveCuratedConnection } from "@vera/core";
import { describe, expect, it, vi } from "vitest";
import { answer, toolCall } from "./direct-provider-streams.test-support.js";
import { ProviderGateway } from "./provider-gateway.js";
import { providerSettingsHarness } from "./provider-settings.test-support.js";

const fireworksId = "accounts/fireworks/models/glm-5p3-flash";
const fireworksUnknown = "accounts/fireworks/models/New-Fixture";
const fireworksCatalog = "https://api.fireworks.ai/v1/accounts/fireworks/models";
const togetherId = "openai/gpt-oss-120b";
const groqId = "llama-3.3-70b-versatile";
const cerebrasId = "gpt-oss-120b";
const hosted = [
  {
    id: "fireworks",
    reasoningField: "reasoning_content",
    baseUrl: "https://api.fireworks.ai/inference/v1",
    catalogUrl: fireworksCatalog,
    model: fireworksId,
    tokenField: "max_tokens",
    input: ["text", "image"],
    catalog: {
      models: [
        { name: fireworksId, supportsServerless: true, supportsTools: true, supportsImageInput: true },
        { name: "accounts/fireworks/models/image-only", supportsServerless: true, supportsImageInput: true },
        { name: "accounts/fireworks/models/not-serverless", supportsServerless: false, supportsTools: true },
      ],
    },
  },
  {
    id: "together",
    reasoningField: "reasoning",
    baseUrl: "https://api.together.ai/v1",
    catalogUrl: "https://api.together.ai/v1/models",
    model: togetherId,
    tokenField: "max_tokens",
    input: ["text"],
    catalog: [
      { id: togetherId, type: "chat", display_name: "GPT-OSS published", context_length: 120000 },
      { id: "Together/Custom-Chat", type: "chat", display_name: null, context_length: -1 },
      { id: "Qwen/Qwen3.5-9B", type: "chat" },
      { id: "Together/Image-Only", type: "image" },
    ],
  },
  {
    id: "groq",
    reasoningField: null,
    baseUrl: "https://api.groq.com/openai/v1",
    catalogUrl: "https://api.groq.com/openai/v1/models",
    model: groqId,
    tokenField: "max_completion_tokens",
    input: ["text"],
    catalog: {
      data: [
        { id: groqId, active: true, context_window: 120000, max_completion_tokens: 8192 },
        { id: "qwen/qwen3.8-27b", active: true, context_window: 131072, max_completion_tokens: 16384 },
        { id: "Owner/Future-Groq", active: true, max_completion_tokens: 2048 },
        { id: "openai/gpt-oss-20b", active: true },
        { id: "openai/gpt-oss-safeguard-20b", active: true },
        { id: "whisper-large-v3", active: true, context_window: 448 },
        { id: "Owner/Inactive", active: false },
      ],
    },
  },
  {
    id: "cerebras",
    reasoningField: "reasoning",
    baseUrl: "https://api.cerebras.ai/v1",
    catalogUrl: "https://api.cerebras.ai/v1/models",
    model: cerebrasId,
    tokenField: "max_completion_tokens",
    input: ["text"],
    catalog: {
      object: "list",
      data: [{ id: cerebrasId, owned_by: "Cerebras" }, { id: "org/Dedicated-Chat" }],
    },
  },
] as const;
type Service = (typeof hosted)[number];
const selection = (service: Service) => ({ id: service.id, binding: "global" });
const secret = (service: Service) => `fixture-key-for-${service.id}-354`;

async function setup(fetcher: (r: Request) => Response | Promise<Response>) {
  const h = providerSettingsHarness();
  await h.settings.load();
  const gateway = new ProviderGateway(
    h.settings,
    h.credentials,
    h.service,
    { now: () => new Date(0), sleep: async () => {} },
    undefined,
    undefined,
    async (input, init) => fetcher(new Request(input, init)),
  );
  async function save(service: Service, model: string = service.model) {
    const config = { name: service.id, preset: selection(service), baseUrl: service.baseUrl, model };
    expect(await h.service.save({ provider: "custom", config, apiKey: secret(service) })).toEqual({
      status: "saved",
    });
    const connection = (await h.service.list()).custom.find(({ name }) => name === service.id);
    if (!connection) throw Error("Missing saved connection");
    return connection.id as `custom:${string}`;
  }
  return { ...h, save, gateway };
}

const echo = {
  name: "echo",
  description: "Echo text",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};
const prompt = (id: string, model: string, signal = new AbortController().signal): LlmRequest => ({
  model: `${id}/${model}`,
  system: "Complete the request.",
  messages: [{ role: "user", content: "Echo OK.", timestamp: 0 }],
  tools: [echo],
  maxOutputTokens: 512,
  signal,
});
async function collect(stream: AsyncIterable<LlmEvent>) {
  const events: LlmEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function expectRoute(request: Request, service: Service) {
  const url = new URL(request.url);
  expect(url.origin + url.pathname).toBe(
    request.method === "GET" ? service.catalogUrl : `${service.baseUrl}/chat/completions`,
  );
  expect(request.redirect).toBe("error");
  expect(request.headers.get("authorization")).toBe(`Bearer ${secret(service)}`);
}

describe("hosted inference provider presets", () => {
  it("saves all four bindings and streams and continues tool calls with isolated routes and keys", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      const url = new URL(request.url);
      const service = hosted.find(
        (entry) =>
          url.origin + url.pathname === entry.catalogUrl ||
          request.url === `${entry.baseUrl}/chat/completions`,
      );
      if (!service) throw Error("Unexpected host or route");
      expectRoute(request, service);
      if (request.method === "GET") return Response.json(service.catalog);
      const body = await request.json();
      expect(body).toMatchObject({ model: service.model, stream: true });
      const probe = body.messages[0].content === "Connection test.";
      expect(body[service.tokenField]).toBe(probe ? (service.id === "groq" ? 256 : 4096) : 512);
      expect(
        body[service.tokenField === "max_tokens" ? "max_completion_tokens" : "max_tokens"],
      ).toBeUndefined();
      if (service.id === "cerebras" || service.id === "together") expect(body.stream_options).toBeUndefined();
      if (body.messages.some(({ role }: { role: string }) => role === "tool")) {
        expect(body.messages).toMatchObject([
          { role: "system" },
          { role: "user" },
          {
            role: "assistant",
            tool_calls: [{ id: "call_echo", function: { name: "echo", arguments: '{"text":"OK"}' } }],
          },
          { role: "tool", tool_call_id: "call_echo", content: "OK" },
        ]);
        expect(body.messages[2].reasoning).toBe(
          service.reasoningField === "reasoning" ? "Prepare the echo." : undefined,
        );
        expect(body.messages[2].reasoning_content).toBe(
          service.reasoningField === "reasoning_content" ? "Prepare the echo." : undefined,
        );
        return answer({ model: service.model, messages: false });
      }
      return body.tools?.length
        ? toolCall({ model: service.model, messages: false, reasoningField: service.reasoningField })
        : answer({ model: service.model, messages: false });
    });
    const h = await setup(fetcher);
    const connections = [];
    for (const service of hosted) connections.push({ service, id: await h.save(service) });
    const settings = h.settings.get().settings.providers.custom;
    expect(settings).toHaveLength(4);
    const slots = settings.map((config) => resolveCuratedConnection(config, h.service.presets).slot);
    expect(new Set(slots).size).toBe(4);
    for (const service of hosted) {
      expect(JSON.stringify(settings)).not.toContain(secret(service));
      expect(JSON.stringify(await h.service.list())).not.toContain(secret(service));
    }
    for (const [index, { service, id }] of connections.entries()) {
      const other = connections[(index + 1) % connections.length]!;
      const count = fetcher.mock.calls.length;
      expect(await h.gateway.discoverPreset({ preset: selection(service), savedId: other.id })).toMatchObject(
        {
          status: "failed",
          error: { code: "DENIED" },
        },
      );
      expect(fetcher).toHaveBeenCalledTimes(count);
      const models = await h.gateway.models(id);
      expect(models.models[0]).toMatchObject({
        id: service.model,
        reference: `${id}/${service.model}`,
        input: service.input,
        inputVerified: true,
        supportsTools: true,
      });
      const initial = prompt(id, service.model);
      const first = (await collect(h.gateway.api.stream(initial))).at(-1);
      expect(first).toMatchObject({
        type: "done",
        message: {
          content: expect.arrayContaining([
            { type: "toolCall", id: "call_echo", name: "echo", arguments: { text: "OK" } },
          ]),
        },
      });
      if (first?.type !== "done") throw Error("Missing tool call");
      const thinking = first.message.content.filter(({ type }) => type === "thinking");
      expect(thinking).toHaveLength(service.reasoningField === null ? 0 : 1);
      const followUp = await collect(
        h.gateway.api.stream({
          ...initial,
          messages: [
            ...initial.messages,
            first.message,
            {
              role: "toolResult",
              toolCallId: "call_echo",
              toolName: "echo",
              timestamp: 0,
              content: [{ type: "text", text: "OK" }],
              isError: false,
            },
          ],
        }),
      );
      const textDeltas = followUp.filter((event) => event.type === "text");
      expect(textDeltas.map(({ delta }) => delta).join("")).toBe("Echo received.");
      expect(textDeltas.at(-1)?.sourceDeltas).toBe(2);
      expect(followUp.at(-1)?.type).toBe("done");
      expect((await h.gateway.test(id)).steps.map(({ status }) => status)).toEqual([
        "pass",
        "pass",
        "pass",
        "pass",
      ]);
    }
  });

  it("reads Fireworks pages and trusts only typed capabilities for serverless chat", async () => {
    const fetcher = vi.fn((request: Request) => {
      expectRoute(request, hosted[0]);
      const params = new URL(request.url).searchParams;
      expect(params.get("pageSize")).toBe("200");
      if (!params.has("pageToken"))
        return Response.json({ ...hosted[0].catalog, nextPageToken: "next+/?&fixture" });
      expect([...params]).toEqual([
        ["pageSize", "200"],
        ["pageToken", "next+/?&fixture"],
      ]);
      return Response.json({
        models: [
          {
            name: fireworksUnknown,
            supportsServerless: true,
            conversationConfig: { style: "custom" },
            supportsTools: false,
            supportsImageInput: false,
            contextLength: 65536,
            displayName: "Fixture Chat",
          },
          {
            name: "accounts/fireworks/models/sparse",
            supportsServerless: true,
            conversationConfig: { style: "custom" },
            supportsTools: "true",
            supportsImageInput: null,
            contextLength: -10,
          },
        ],
      });
    });
    const h = await setup(fetcher);
    const service = hosted[0];
    const id = await h.save(service);
    const result = await h.gateway.models(id);
    expect(result.models.map(({ id }) => id)).toEqual([
      fireworksId,
      fireworksUnknown,
      "accounts/fireworks/models/sparse",
    ]);
    expect(result.models[1]).toMatchObject({
      reference: `${id}/${fireworksUnknown}`,
      name: "Fixture Chat",
      input: ["text"],
      inputVerified: true,
      supportsTools: false,
      contextWindow: 65536,
      contextVerified: true,
    });
    expect(result.models[2]).toMatchObject({ input: ["text"], inputVerified: false, contextVerified: false });
    expect(result.models[2]?.supportsTools).toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("normalizes Together arrays and list envelopes and keeps undocumented capabilities unknown", async () => {
    const service = hosted[1];
    let body: unknown = service.catalog;
    const h = await setup(() => Response.json(body));
    const input = { preset: selection(service), apiKey: secret(service) };
    const result = await h.gateway.discoverPreset(input);
    expect(result).toMatchObject({
      status: "discovered",
      models: [togetherId, "Together/Custom-Chat", "Qwen/Qwen3.5-9B"],
      profiles: [
        { name: "GPT-OSS published", contextWindow: 120000 },
        { name: "Together/Custom-Chat" },
        { name: "Qwen/Qwen3.5-9B" },
      ],
    });
    body = { object: "list", data: service.catalog };
    expect(await h.gateway.discoverPreset(input)).toEqual(result);
    const id = await h.save(service);
    const models = await h.gateway.models(id);
    expect(models.models[0]).toMatchObject({
      contextWindow: 120000,
      supportsTools: true,
      inputVerified: true,
    });
    expect(models.models[1]).toMatchObject({ inputVerified: false, contextVerified: false });
    expect(models.models[1]?.supportsTools).toBeUndefined();
    expect(models.models[2]).toMatchObject({
      id: "Qwen/Qwen3.5-9B",
      input: ["text", "image"],
      inputVerified: true,
      supportsTools: true,
    });
  });

  it("uses Groq live limits and documents exact image models without advertising audio or inactive rows", async () => {
    const service = hosted[2];
    const h = await setup(() => Response.json(service.catalog));
    const id = await h.save(service);
    const { models } = await h.gateway.models(id);
    expect(models.map(({ id }) => id)).toEqual([
      groqId,
      "qwen/qwen3.8-27b",
      "Owner/Future-Groq",
      "openai/gpt-oss-20b",
      "openai/gpt-oss-safeguard-20b",
    ]);
    expect(models[0]).toMatchObject({
      contextWindow: 120000,
      maxOutputTokens: 8192,
      providerMaxOutputTokens: 8192,
    });
    expect(models[1]).toMatchObject({ input: ["text", "image"], inputVerified: true, supportsTools: true });
    expect(models[2]).toMatchObject({ inputVerified: false, maxOutputTokens: 2048 });
    expect(models[2]?.supportsTools).toBeUndefined();
    for (const model of models.slice(3))
      expect(model).toMatchObject({ input: ["text"], inputVerified: true, supportsTools: true });
  });

  it("leaves undocumented Cerebras model capabilities unknown", async () => {
    const service = hosted[3];
    const h = await setup(() => Response.json(service.catalog));
    const id = await h.save(service);
    const { models } = await h.gateway.models(id);
    expect(models.map(({ id }) => id)).toEqual([cerebrasId, "org/Dedicated-Chat"]);
    expect(models[0]).toMatchObject({ contextVerified: false, contextWindow: 32768, maxOutputTokens: 4096 });
    expect(models[1]).toMatchObject({ inputVerified: false, contextVerified: false });
    expect(models[1]?.supportsTools).toBeUndefined();
  });

  it.each(hosted)("keeps a manual $id model available after unsupported discovery", async (service) => {
    const manual = "accounts/fixture/deployments/Custom-Chat";
    let unavailable = false;
    const emptyCatalog = service.id === "fireworks" ? { models: [] } : { data: [] };
    const h = await setup(async (request) => {
      expectRoute(request, service);
      if (request.method === "GET")
        return unavailable ? new Response(null, { status: 404 }) : Response.json(emptyCatalog);
      expect(await request.json()).toMatchObject({ model: manual });
      return answer({ model: manual, messages: false });
    });
    const id = await h.save(service, manual);
    expect(await h.gateway.discoverPreset({ preset: selection(service), savedId: id })).toEqual({
      status: "manual",
      reason: "empty",
    });
    unavailable = true;
    expect(await h.gateway.discoverPreset({ preset: selection(service), savedId: id })).toEqual({
      status: "manual",
      reason: "unavailable",
    });
    expect((await h.gateway.models(id)).models[0]).toMatchObject({ id: manual, inputVerified: false });
    expect((await collect(h.gateway.api.stream(prompt(id, manual)))).at(-1)?.type).toBe("done");
  });

  it.each(hosted)("reports malformed, authentication and rate failures for $id", async (service) => {
    let response = () => Response.json({ wrong: [] });
    const h = await setup((request) => {
      expectRoute(request, service);
      return response();
    });
    const id = await h.save(service);
    const discover = () => h.gateway.discoverPreset({ preset: selection(service), savedId: id });
    expect(await discover()).toMatchObject({ status: "failed", error: { code: "PROVIDER" } });
    for (const [status, messageKey] of [
      [401, "provider.auth"],
      [403, "provider.auth"],
      [429, "provider.rateLimit"],
    ] as const) {
      response = () =>
        Response.json(
          { error: { message: `Service rejected ${secret(service)}` } },
          { status, headers: { "retry-after": "15" } },
        );
      const error = {
        code: "PROVIDER",
        messageKey,
        ...(status === 429 ? { params: { retryAfter: "15" } } : {}),
      };
      expect(await discover()).toMatchObject({ status: "failed", error });
      const streamed = (await collect(h.gateway.api.stream(prompt(id, service.model)))).at(-1);
      expect(streamed).toMatchObject({ type: "error", aborted: false, error });
      expect(JSON.stringify(streamed)).not.toContain(secret(service));
    }
  });

  it("keeps manual hosted tools unverified when only a stored flag is present", async () => {
    const service = hosted[3];
    const model = "org/Manual";
    const h = await setup(() => Response.json(service.catalog));
    const id = await h.save(service, model);
    const { providers } = h.settings.get().settings;
    await h.settings.update({
      providers: {
        ...providers,
        custom: providers.custom.map((connection) => ({ ...connection, supportsTools: true })),
      },
    });
    const catalog = await h.gateway.models(id);
    expect(catalog.models[0]).toMatchObject({ id: model, inputVerified: false });
    expect(catalog.models[0]?.supportsTools).toBeUndefined();
  });

  it("rejects repeated Fireworks page tokens", async () => {
    const service = hosted[0];
    const fetcher = vi.fn(() => Response.json({ models: [], nextPageToken: "again" }));
    const h = await setup(fetcher);
    expect(
      await h.gateway.discoverPreset({ preset: selection(service), apiKey: secret(service) }),
    ).toMatchObject({
      status: "failed",
      error: { code: "PROVIDER" },
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(hosted)("cancels $id discovery and inference at the in-flight transport", async (service) => {
    const signals: AbortSignal[] = [];
    const methods: string[] = [];
    let blockTransport = false;
    const h = await setup((request) => {
      expectRoute(request, service);
      if (!blockTransport && request.method === "GET") return Response.json(service.catalog);
      methods.push(request.method);
      signals.push(request.signal);
      return new Promise((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      });
    });
    const id = await h.save(service);
    await h.gateway.models(id);
    blockTransport = true;
    const discovery = h.gateway.discoverPreset({ preset: selection(service), savedId: id });
    await vi.waitFor(() => expect(signals).toHaveLength(1));
    await h.gateway.close();
    expect(await discovery).toMatchObject({ status: "failed", error: { code: "DENIED" } });
    const controller = new AbortController();
    const stream = collect(h.gateway.api.stream(prompt(id, service.model, controller.signal)));
    await vi.waitFor(() => expect(signals).toHaveLength(2));
    controller.abort();
    expect((await stream).at(-1)).toMatchObject({ type: "error", aborted: true });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
    expect(methods).toEqual(["GET", "POST"]);
  });
});
