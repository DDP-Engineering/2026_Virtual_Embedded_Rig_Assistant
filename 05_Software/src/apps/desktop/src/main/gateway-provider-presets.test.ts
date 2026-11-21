import { type LlmEvent, type LlmRequest, resolveCuratedConnection } from "@vera/core";
import { describe, expect, it, vi } from "vitest";
import { answer, toolCall } from "./direct-provider-streams.test-support.js";
import { ProviderGateway } from "./provider-gateway.js";
import { providerSettingsHarness } from "./provider-settings.test-support.js";

const hfModel = "deepseek-ai/DeepSeek-V4.1-Flash";
const nimModel = "meta/muse-glimmer-30b";
const previewNim = "moonshotai/kimi-k3.1-pro";
const sparseHf = "fixture-org/Sparse-Route-Chat";
const vercelModel = "anthropic/claude-sonnet-4.6";
const services = [
  {
    id: "huggingface",
    label: "Hugging Face Inference Providers",
    base: "https://router.huggingface.co/v1",
    model: hfModel,
    alternate: "fixture-org/Mixed-Route-Chat",
    gated: "fixture-org/Gated-Chat:novita",
    reasoningField: "reasoning_content",
    profile: { contextWindow: 32768 },
    catalogs: [
      {
        id: hfModel,
        architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
        providers: [
          { provider: "novita", status: "live", supports_tools: true, context_length: 32768 },
          { provider: "baseten", status: "live", supports_tools: true, context_length: 65536 },
          { provider: "together", status: "error", supports_tools: false, context_length: 4096 },
        ],
      },
      {
        id: "fixture-org/Mixed-Route-Chat",
        providers: [
          { provider: "baseten", status: "live", supports_tools: true, context_length: 65536 },
          { provider: "novita", status: "live", supports_tools: false },
        ],
      },
      {
        id: sparseHf,
        providers: [
          { provider: "baseten", status: "live", supports_tools: true, context_length: 65536 },
          { provider: "novita" },
        ],
      },
      { id: "org/Offline", providers: [{ provider: "novita", status: "error" }] },
    ],
  },
  {
    id: "nvidia",
    label: "NVIDIA NIM",
    base: "https://integrate.api.nvidia.com/v1",
    model: nimModel,
    alternate: "google/gemma-3-12b-it",
    gated: "fixture-org/Account-NIM",
    reasoningField: "reasoning_content",
    profile: { contextWindow: 131072, providerMaxOutputTokens: 131072 },
    catalogs: [
      { id: nimModel },
      { id: "google/gemma-3-12b-it" },
      {
        id: previewNim,
        model_type: "vlm",
        context_window: 1048576,
        supports_tools: true,
        supports_thinking: true,
      },
      { id: "nvidia/embed-qa-4" },
      { id: "fixture-org/unclassified" },
    ],
  },
  {
    id: "vercel-ai-gateway",
    label: "Vercel AI Gateway",
    base: "https://ai-gateway.vercel.sh/v1",
    model: vercelModel,
    alternate: "team/Private-Route",
    gated: "team/Protected-Alias",
    reasoningField: "reasoning",
    profile: { contextWindow: 200000, providerMaxOutputTokens: 64000 },
    catalogs: [
      {
        id: vercelModel,
        type: "language",
        name: "Claude Sonnet 4.6",
        context_window: 200000,
        max_tokens: 64000,
        tags: ["reasoning", "tool-use"],
        modalities: { input: ["text", "image", "pdf"], output: ["text"] },
      },
      { id: "team/Private-Route", type: "language", name: "Team route" },
      { id: "openai/text-embedding-3-small", type: "embedding" },
    ],
  },
] as const;

type Service = (typeof services)[number];
const selection = ({ id }: Service) => ({ id, binding: "global" });
const fixtureKey = ({ id }: Service) => `fixture-key-for-${id}-355`;
const echo = {
  name: "echo",
  description: "Echo text",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};
const prompt = (model: string, signal = new AbortController().signal): LlmRequest => ({
  model,
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

async function setup(fetcher: (request: Request) => Response | Promise<Response>) {
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
    const config = { name: service.label, preset: selection(service), baseUrl: service.base, model };
    expect(await h.service.save({ provider: "custom", config, apiKey: fixtureKey(service) })).toEqual({
      status: "saved",
    });
    const connection = (await h.service.list()).custom.find(({ name }) => name === service.label);
    if (!connection) throw Error("Missing saved connection");
    return connection.id;
  }
  return { ...h, save, gateway };
}

function expectRoute(request: Request, service: Service) {
  expect(request.url).toBe(`${service.base}/${request.method === "GET" ? "models" : "chat/completions"}`);
  expect(request.redirect).toBe("error");
  expect(request.headers.get("authorization")).toBe(`Bearer ${fixtureKey(service)}`);
}

describe("Hugging Face, NVIDIA NIM and Vercel AI Gateway presets", () => {
  it("isolates three keys and streams an initial tool call and completed continuation per service", async () => {
    const fetcher = vi.fn(async (request: Request) => {
      const service = services.find(({ base }) => request.url.startsWith(`${base}/`));
      if (!service) throw Error("Unexpected binding");
      expectRoute(request, service);
      if (request.method === "GET") return Response.json({ data: service.catalogs });
      const body = await request.json();
      const { model, messages, tools } = body;
      const probe = messages[0].content === "Connection test.";
      expect(body).toMatchObject({ stream: true, max_tokens: probe ? 4096 : 512 });
      expect(body.max_completion_tokens).toBeUndefined();
      const target = { model, messages: false, reasoningField: service.reasoningField };
      if (model === service.alternate) return answer(target);
      expect(model).toBe(service.model);
      if (messages.at(-1)?.role === "tool") {
        expect(messages).toMatchObject([
          { role: "system" },
          { role: "user" },
          {
            role: "assistant",
            [service.reasoningField]: "Prepare the echo.",
            tool_calls: [{ id: "call_echo", function: { name: "echo", arguments: '{"text":"OK"}' } }],
          },
          { role: "tool", tool_call_id: "call_echo", content: "OK" },
        ]);
        return answer(target);
      }
      return tools?.length ? toolCall(target) : answer(target);
    });
    const h = await setup(fetcher);
    const connections = await Promise.all(
      services.map(async (service) => ({ service, id: await h.save(service) })),
    );
    const custom = h.settings.get().settings.providers.custom;
    expect(
      new Set(custom.map((config) => resolveCuratedConnection(config, h.service.presets).slot)).size,
    ).toBe(3);
    for (const [index, { service, id }] of connections.entries()) {
      const wrong = connections[(index + 1) % connections.length]!;
      const calls = fetcher.mock.calls.length;
      expect(await h.gateway.discoverPreset({ preset: selection(service), savedId: wrong.id })).toMatchObject(
        {
          status: "failed",
          error: { code: "DENIED" },
        },
      );
      expect(fetcher).toHaveBeenCalledTimes(calls);
      expect(h.disk.get("/data/settings.json")).not.toContain(fixtureKey(service));
      expect(h.disk.get("/data/credentials.json")).not.toContain(fixtureKey(service));
      expect(JSON.stringify(await h.service.list())).not.toContain(fixtureKey(service));
      const discovery = await h.gateway.discoverPreset({ preset: selection(service), savedId: id });
      expect(discovery).toMatchObject({
        status: "discovered",
        models: [
          service.model,
          service.alternate,
          ...(service.id === "nvidia" ? [previewNim] : service.id === "huggingface" ? [sparseHf] : []),
        ],
      });
      if (service.id === "vercel-ai-gateway") {
        expect(discovery).toMatchObject({
          profiles: [expect.objectContaining({ reasoning: true }), expect.any(Object)],
        });
      }
      const { models } = await h.gateway.models(id);
      const reference = `${id}/${service.model}`;
      expect(models[0]).toMatchObject({
        id: service.model,
        reference,
        providerName: service.label,
        input: ["text", "image"],
        inputVerified: true,
        contextVerified: true,
        supportsTools: true,
        ...service.profile,
      });
      const knownNvidia = service.id === "nvidia";
      expect(models[1]).toMatchObject({
        id: service.alternate,
        inputVerified: knownNvidia,
        contextVerified: knownNvidia,
      });
      expect(models[1]?.supportsTools).toBeUndefined();
      if (service.id === "nvidia") {
        expect(models[2]).toMatchObject({
          id: previewNim,
          input: ["text", "image"],
          inputVerified: true,
          contextWindow: 1048576,
          supportsTools: true,
        });
        expect(discovery).toMatchObject({
          profiles: expect.arrayContaining([expect.objectContaining({ id: previewNim, reasoning: true })]),
        });
      }
      if (service.id === "huggingface") {
        expect(models[2]).toMatchObject({ id: sparseHf, contextVerified: false });
        expect(models[2]?.supportsTools).toBeUndefined();
      }
      const initial = prompt(reference);
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
              content: [{ type: "text", text: "OK" }],
              isError: false,
              timestamp: 0,
            },
          ],
        }),
      );
      expect(followUp).toContainEqual(
        expect.objectContaining({ type: "text", delta: "Echo received.", sourceDeltas: 2 }),
      );
      expect(followUp.at(-1)).toMatchObject({
        type: "done",
        message: { content: [{ type: "text", text: "Echo received." }] },
      });
      const alternate = await collect(h.gateway.api.stream(prompt(`${id}/${service.alternate}`)));
      expect(alternate.at(-1)?.type).toBe("done");
      expect(h.gateway.api.selectedModel(id)).toBe(service.model);
      expect((await h.gateway.test(id)).steps.map(({ status }) => status)).toEqual([
        "pass",
        "pass",
        "pass",
        "pass",
      ]);
    }
  });

  it.each(services)(
    "keeps $id's explicit gated ID through empty, unavailable and invalid discovery",
    async (service) => {
      let catalog = () => Response.json({ data: service.catalogs });
      let denied = false;
      const fetcher = vi.fn(async (request: Request) => {
        expectRoute(request, service);
        if (request.method === "GET") return catalog();
        expect(await request.json()).toMatchObject({ model: service.gated });
        return denied
          ? Response.json(
              { error: { message: `Model unavailable for ${fixtureKey(service)}` } },
              { status: 404 },
            )
          : answer({ model: service.gated, messages: false });
      });
      const h = await setup(fetcher);
      const id = await h.save(service, service.gated);
      const discover = () => h.gateway.discoverPreset({ preset: selection(service), savedId: id });
      const reference = `${id}/${service.gated}`;
      expect(JSON.parse(h.disk.get("/data/settings.json") ?? "{}")).toMatchObject({
        schemaVersion: 1,
        providers: { custom: [{ model: service.gated, preset: selection(service) }] },
      });
      const refresh = () => h.gateway.api.models(id, undefined, true);
      expect((await refresh()).models.map(({ id }) => id)).toContain(service.alternate);
      catalog = () => Response.json({ data: service.catalogs.filter(({ id }) => id !== service.alternate) });
      expect((await refresh()).models.map(({ id }) => id)).not.toContain(service.alternate);
      const posts = () => fetcher.mock.calls.filter(([r]) => r.method === "POST").length;
      const missing = await collect(h.gateway.api.stream(prompt(`${id}/${service.alternate}`)));
      expect(missing.at(-1)).toMatchObject({ type: "error", error: { code: "NOT_FOUND" } });
      expect(posts()).toBe(0);

      catalog = () => Response.json({ data: [] });
      expect(await discover()).toEqual({ status: "manual", reason: "empty" });
      catalog = () => new Response(null, { status: 404 });
      expect(await discover()).toEqual({ status: "manual", reason: "unavailable" });
      expect((await refresh()).models).toEqual([
        expect.objectContaining({ reference, inputVerified: false }),
      ]);
      expect((await collect(h.gateway.api.stream(prompt(reference)))).at(-1)?.type).toBe("done");

      catalog = () => Response.json({ data: [{ id: "invalid with spaces" }] });
      expect(await discover()).toMatchObject({ status: "failed", error: { code: "PROVIDER" } });
      await expect(refresh()).rejects.toMatchObject({ code: "PROVIDER" });
      expect((await collect(h.gateway.api.stream(prompt(reference)))).at(-1)?.type).toBe("done");
      const before = posts();
      denied = true;
      const rejected = (await collect(h.gateway.api.stream(prompt(reference)))).at(-1);
      expect(rejected).toMatchObject({ type: "error", aborted: false, error: { code: "PROVIDER" } });
      expect(JSON.stringify(rejected)).not.toContain(fixtureKey(service));
      expect(posts()).toBe(before + 1);
      expect(h.gateway.api.selectedModel(id)).toBe(service.gated);
    },
  );

  it.each(services)("aborts the active $id streaming request", async (service) => {
    const controller = new AbortController();
    let upstream: AbortSignal | undefined;
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const h = await setup(async (request) => {
      expectRoute(request, service);
      if (request.method === "GET") return Response.json({ data: service.catalogs });
      upstream = request.signal;
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        started();
      });
    });
    const id = await h.save(service);
    const result = collect(h.gateway.api.stream(prompt(`${id}/${service.model}`, controller.signal)));
    await ready;
    controller.abort();
    expect((await result).at(-1)).toMatchObject({ type: "error", aborted: true });
    expect(upstream?.aborted).toBe(true);
  });
});
