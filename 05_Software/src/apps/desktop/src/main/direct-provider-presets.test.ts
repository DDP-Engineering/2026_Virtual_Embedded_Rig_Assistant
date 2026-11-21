import type { LlmEvent, LlmRequest } from "@vera/core";
import { describe, expect, it, vi } from "vitest";
import { answer, toolCall } from "./direct-provider-streams.test-support.js";
import { ProviderGateway } from "./provider-gateway.js";
import { providerSettingsHarness } from "./provider-settings.test-support.js";

const services = [
  {
    id: "deepseek",
    name: "DeepSeek",
    base: "https://api.deepseek.com",
    catalog: true,
    messages: false,
    model: "deepseek-flash",
    output: 393216,
    key: "fixture-deepseek-private",
  },
  {
    id: "moonshot-ai",
    name: "Moonshot AI",
    base: "https://api.moonshot.ai/v1",
    catalog: true,
    messages: false,
    model: "kimi-k3",
    output: 1048576,
    key: "fixture-moonshot-private",
  },
  {
    id: "kimi-coding",
    name: "Kimi For Coding",
    base: "https://api.kimi.ai/coding",
    catalog: false,
    messages: true,
    model: "kimi-for-coding",
    output: 32768,
    key: "fixture-kimi-coding-private-sk-ant-oat",
  },
] as const;
type Service = (typeof services)[number];
const selection = (service: Service) => ({ id: service.id, binding: "default" });
const saveConfig = (service: Service) => ({
  name: service.name,
  baseUrl: service.base,
  model: service.model,
  preset: selection(service),
});
const extra = (service: Service) => `extra-${service.id}`;
const richModel = {
  deepseek: {
    id: "deepseek-rich",
    name: "DeepSeek rich",
    context_window: 196608,
    max_output_tokens: 32768,
    input_modalities: ["text", "image"],
    effort: { supported_levels: ["low", "max"] },
  },
  "moonshot-ai": {
    id: "kimi-k3.1-pro",
    context_length: 1048576,
    supports_image_in: true,
    supports_video_in: true,
    supports_reasoning: true,
  },
};
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

async function setup(fetcher: (request: Request) => Promise<Response> | Response) {
  const h = providerSettingsHarness();
  await h.settings.load();
  for (const service of services)
    await h.service.save({ provider: "custom", config: saveConfig(service), apiKey: service.key });
  const gateway = new ProviderGateway(
    h.settings,
    h.credentials,
    h.service,
    { now: () => new Date(0), sleep: async () => {} },
    undefined,
    undefined,
    (input, init) => Promise.resolve(fetcher(new Request(input, init))),
  );
  const connections = (await h.service.list()).custom;
  const connection = (service: Service) => connections.find(({ name }) => name === service.name)!;
  return { ...h, gateway, connection };
}

function checkRoute(request: Request, service: Service) {
  expect(request.redirect).toBe("error");
  if (request.method === "GET") {
    expect(service.catalog).toBe(true);
    expect(request.url).toBe(`${service.base}/models`);
  } else {
    expect(request.method).toBe("POST");
    expect(request.url).toBe(
      service.base + (service.messages ? "/v1/messages?beta=true" : "/chat/completions"),
    );
  }
  expect(request.headers.get("authorization")).toBe(service.messages ? null : `Bearer ${service.key}`);
  expect(request.headers.get("x-api-key")).toBe(service.messages ? service.key : null);
  if (service.messages) expect(request.headers.get("user-agent")).toBe("VERA");
}

async function collect(stream: AsyncIterable<LlmEvent>) {
  const result: LlmEvent[] = [];
  for await (const event of stream) result.push(event);
  return result;
}

describe("Direct provider presets through the production provider gateway", () => {
  it("lists separate models with exact verified profiles and denies a substituted binding", async () => {
    const fetcher = vi.fn((request: Request) => {
      const service = services.find(({ base }) => `${base}/models` === request.url)!;
      checkRoute(request, service);
      if (!service.catalog) throw Error("Unexpected Kimi Code catalog request");
      return Response.json({ data: [{ id: service.model }, { id: extra(service) }, richModel[service.id]] });
    });
    const h = await setup(fetcher);
    for (const [index, service] of services.entries()) {
      const connection = h.connection(service);
      const other = h.connection(services[(index + 1) % services.length]!);
      expect(await h.gateway.discoverPreset({ preset: selection(service), savedId: other.id })).toMatchObject(
        {
          status: "failed",
          error: { code: "DENIED" },
        },
      );
      await expect(
        h.service.save({
          provider: "custom",
          id: connection.id as `custom:${string}`,
          config: { ...saveConfig(service), baseUrl: other.baseUrl },
        }),
      ).rejects.toMatchObject({ code: "DENIED" });
      const discovery = await h.gateway.discoverPreset({
        preset: selection(service),
        savedId: connection.id,
      });
      expect(discovery).toMatchObject(
        service.catalog
          ? {
              status: "discovered",
              models: [service.model, extra(service), richModel[service.id].id],
              profiles: expect.arrayContaining([
                expect.objectContaining({ id: richModel[service.id].id, input: ["text", "image"] }),
              ]),
            }
          : { status: "manual", reason: "configured" },
      );
      const { models } = await h.gateway.models(connection.id);
      expect(models[0]).toMatchObject({
        id: service.model,
        providerName: service.name,
        input: ["text", "image"],
        contextVerified: true,
        inputVerified: true,
        contextWindow: 1048576,
        providerMaxOutputTokens: service.output,
        supportsTools: true,
        reasoningOptions: service.id === "deepseek" ? ["off", "low", "high", "max"] : ["low", "high", "max"],
      });
      expect(models[0]!.inputBudget).toBeGreaterThan(0);
      if (service.catalog) {
        const sparse = models.find(({ id }) => id === extra(service));
        expect(models.some(({ id }) => id === extra(services[(index + 1) % services.length]!))).toBe(false);
        expect(sparse).toMatchObject({ inputVerified: false, contextVerified: false });
        expect(sparse?.supportsTools).toBeUndefined();
        expect(sparse?.reasoningOptions).toBeUndefined();
        await expect(h.gateway.api.prepareModel?.(sparse!.reference)).resolves.toBeUndefined();
        const rich = models.find(({ id }) => id === richModel[service.id].id);
        expect(rich).toMatchObject({
          input: ["text", "image"],
          inputVerified: true,
          contextVerified: true,
          contextWindow: service.id === "deepseek" ? 196608 : 1048576,
        });
        expect(rich?.supportsTools).toBeUndefined();
        expect(rich?.providerMaxOutputTokens).toBe(service.id === "deepseek" ? 32768 : undefined);
        expect(rich?.reasoningOptions).toEqual(service.id === "deepseek" ? ["low", "max"] : undefined);
        await h.gateway.api.prepareModel?.(rich!.reference);
        expect(h.gateway.api.capabilities(rich!.reference)).toMatchObject({
          input: rich!.input,
          contextWindow: rich!.contextWindow,
        });
      }
    }
    const deepSeek = h.connection(services[0]).id;
    expect((await h.gateway.models(deepSeek)).models.some(({ id }) => id === "deepseek-v4-pro")).toBe(false);
    await expect(h.gateway.api.prepareModel?.(`${deepSeek}/deepseek-v4-pro`)).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    const kimi = (await h.gateway.models(h.connection(services[2]).id)).models;
    expect(kimi.find(({ id }) => id === "k3-256k")).toMatchObject({
      input: ["text", "image"],
      contextWindow: 262144,
      providerMaxOutputTokens: 131072,
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("distinguishes Moonshot reasoning being unsupported from missing metadata", async () => {
    const service = services[1];
    const h = await setup((request) => {
      checkRoute(request, service);
      return Response.json({
        data: [{ id: "moonshot-no-reasoning", supports_reasoning: false }, { id: "moonshot-sparse" }],
      });
    });
    const { models } = await h.gateway.models(h.connection(service).id);
    expect(models.find(({ id }) => id === "moonshot-no-reasoning")?.reasoningOptions).toEqual([]);
    expect(models.find(({ id }) => id === "moonshot-sparse")?.reasoningOptions).toBeUndefined();
  });

  it("keeps the saved model and offers documented DeepSeek models when its catalog is unavailable", async () => {
    const service = services[0];
    let status = 404;
    const h = await setup((request) => {
      checkRoute(request, service);
      return Response.json(status === 200 ? { data: [] } : {}, { status });
    });
    const { id } = h.connection(service);
    const probe = () => h.gateway.api.models(id, undefined, true);
    const unavailable = await probe();
    expect(unavailable.reachability).toBe("skipped");
    expect(unavailable.models.find(({ id }) => id === "deepseek-v4-pro")).toMatchObject({
      input: ["text"],
      contextWindow: 1048576,
      providerMaxOutputTokens: 393216,
    });
    status = 200;
    expect((await probe()).models.map(({ id }) => id)).toEqual([service.model]);
  });

  it("keeps manually entered Kimi model capabilities unverified after a fallback probe", async () => {
    const service = services[2];
    const fallback = { messages: true, model: "kimi-for-coding" };
    const h = await setup(async (request) => {
      checkRoute(request, service);
      const body = await request.json();
      expect(body.model).toBe("mistyped-kimi");
      return body.tools ? toolCall(fallback) : answer(fallback);
    });
    const { id } = h.connection(service);
    await h.service.save({
      provider: "custom",
      id: id as `custom:${string}`,
      config: { ...saveConfig(service), model: "mistyped-kimi" },
    });
    const { steps } = await h.gateway.test(id);
    expect(steps.find(({ step }) => step === "tools")?.status).toBe("pass");
    const { models } = await h.gateway.models(id);
    expect(models.find(({ id }) => id === "mistyped-kimi")?.supportsTools).toBeUndefined();
  });

  it.each(services)("round-trips reasoning and tools then aborts and recovers on $name", async (service) => {
    const requests: Record<string, unknown>[] = [];
    let started!: (signal: AbortSignal) => void;
    const held = new Promise<AbortSignal>((resolve) => {
      started = resolve;
    });
    const h = await setup(async (request) => {
      checkRoute(request, service);
      if (request.method === "GET") return Response.json({ data: [{ id: service.model }] });
      requests.push(await request.json());
      if (requests.length === 1) return toolCall(service);
      if (requests.length === 3) {
        started(request.signal);
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        });
      }
      return answer(service);
    });
    const request: LlmRequest = {
      model: `${h.connection(service).id}/${service.model}`,
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
      reasoning: "high",
      signal: new AbortController().signal,
      maxOutputTokens: 4096,
    };
    const first = await collect(h.gateway.api.stream(request));
    expect(first.filter(({ type }) => type === "error")).toEqual([]);
    const done = first.find((event) => event.type === "done");
    expect(done?.message.content).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "thinking", thinking: "Prepare the echo." }),
        expect.objectContaining({
          type: "toolCall",
          id: "call_echo",
          name: "echo",
          arguments: { text: "OK" },
        }),
      ]),
    );
    const second = await collect(
      h.gateway.api.stream({
        ...request,
        messages: [
          ...request.messages,
          done!.message,
          {
            role: "toolResult",
            toolCallId: "call_echo",
            toolName: "echo",
            isError: false,
            timestamp: 0,
            content: [{ type: "text", text: "OK" }],
          },
        ],
      }),
    );
    const text = second.filter((event) => event.type === "text");
    expect(text.map(({ delta }) => delta).join("")).toBe("Echo received.");
    expect(text.at(-1)?.sourceDeltas).toBe(2);
    const [, continued] = requests;
    if (service.messages) {
      expect(continued).toMatchObject({
        max_tokens: 4096,
        thinking: { type: "adaptive" },
        output_config: { effort: "high" },
        messages: [
          { role: "user", content: [{ type: "text" }, { type: "image", source: { type: "base64" } }] },
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "Prepare the echo.", signature: "" },
              { type: "tool_use", id: "call_echo", name: "echo", input: { text: "OK" } },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "call_echo", content: "OK" }],
          },
        ],
      });
    } else {
      expect(continued).toMatchObject({
        reasoning_effort: "high",
        ...(service.id === "deepseek"
          ? { thinking: { type: "enabled" }, max_tokens: 4096 }
          : { max_completion_tokens: 4096 }),
        messages: [
          { role: "system" },
          { role: "user", content: [{ type: "text" }, { type: "image_url" }] },
          { role: "assistant", reasoning_content: "Prepare the echo.", tool_calls: [{ id: "call_echo" }] },
          { role: "tool", tool_call_id: "call_echo", content: "OK" },
        ],
      });
    }
    const controller = new AbortController();
    const pending = collect(h.gateway.api.stream({ ...request, signal: controller.signal }));
    const transportSignal = await Promise.race([
      held,
      pending.then(() => {
        throw Error("Inference ended before transport started");
      }),
    ]);
    controller.abort();
    expect(await pending).toContainEqual(expect.objectContaining({ type: "error", aborted: true }));
    expect(transportSignal.aborted).toBe(true);
    expect(await collect(h.gateway.api.stream({ ...request, reasoning: null }))).toContainEqual(
      expect.objectContaining({ type: "done" }),
    );
    expect(requests[3]).not.toHaveProperty("reasoning_effort");
    expect(requests[3]).not.toHaveProperty("output_config");
    if (service.id === "deepseek") expect(requests[3]).not.toHaveProperty("thinking");
  });

  it.each(services)("tests and diagnoses rejected API keys on $name", async (service) => {
    let rejectKey = false;
    const fetcher = vi.fn(async (request: Request) => {
      checkRoute(request, service);
      if (request.method === "GET") return Response.json({ data: [{ id: service.model }] });
      if (rejectKey) return Response.json({ error: { message: service.key } }, { status: 401 });
      const body = await request.json();
      if (service.id === "deepseek") {
        expect(body).toMatchObject({ max_tokens: 256, thinking: { type: "disabled" } });
        expect(body).not.toHaveProperty("reasoning_effort");
      } else if (service.messages) {
        expect(body).toMatchObject({ max_tokens: 4096, output_config: { effort: "low" } });
      } else {
        expect(body).toMatchObject({ max_completion_tokens: 4096, reasoning_effort: "low" });
      }
      return body.tools ? toolCall(service) : answer(service);
    });
    const h = await setup(fetcher);
    const { id } = h.connection(service);
    const reachability = service.catalog ? "pass" : "skipped";
    expect((await h.gateway.test(id)).steps.map(({ status }) => status)).toEqual([
      reachability,
      "pass",
      "pass",
      "pass",
    ]);
    rejectKey = true;
    fetcher.mockClear();
    const { steps } = await h.gateway.test(id);
    expect(steps).toMatchObject([
      { step: "reachability", status: reachability },
      { step: "authentication", status: "fail", error: { code: "PROVIDER", messageKey: "provider.auth" } },
      { step: "tools", status: "skipped" },
      { step: "streaming", status: "skipped" },
    ]);
    expect(JSON.stringify(steps)).not.toContain(service.key);
    expect(fetcher).toHaveBeenCalledTimes(service.catalog ? 2 : 1);
  });
});
