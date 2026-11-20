import { type LlmEvent, type LlmRequest, resolveCuratedConnection } from "@vera/core";
import { customSettingsSchema } from "@vera/shared";
import { describe, expect, it, vi } from "vitest";
import { answer, toolCall } from "./direct-provider-streams.test-support.js";
import { ProviderGateway } from "./provider-gateway.js";
import { providerSettingsHarness } from "./provider-settings.test-support.js";

const workspace = "llm-fixture353";
const studioModel = "qwen3.7-flash";
const mimoModel = "mimo-v2.6-flash";
const studio = "alibaba-model-studio";
const coding = "alibaba-coding-plan";
const mimoApi = "xiaomi-mimo-api";
const mimoPlan = "xiaomi-mimo-token-plan";
const qwenStandard = "https://maas.qwencloudapi.com/compatible-mode/v1";
const qwenPlan = "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1";
function studioBinding(region: string, workspaceId = workspace) {
  const host = `https://${workspaceId}.${region}.maas.aliyuncs.com`;
  return {
    preset: { id: studio, binding: region, workspaceId },
    baseUrl: `${host}/compatible-mode/v1`,
    model: studioModel,
    key: `sk-studio-fixture-${region}-${workspaceId}`,
    catalog: region === "us-east-1" ? null : `${host}/api/v1/models?page_size=100&capabilities=TG`,
  };
}

const codingPlan = {
  preset: { id: coding, binding: "singapore" },
  baseUrl: "https://coding-intl.dashscope.aliyuncs.com/v1",
  model: "qwen3.7-plus",
  key: "sk-sp-fixture-coding",
  catalog: null,
};
const mimo = {
  preset: { id: mimoApi, binding: "global" },
  baseUrl: "https://api.xiaomimimo.com/v1",
  model: mimoModel,
  key: "sk-fixture-mimo-api",
  catalog: "https://api.xiaomimimo.com/v1/models",
};
const offerings = [
  ...["ap-southeast-1", "cn-beijing", "cn-hongkong", "eu-central-1", "ap-northeast-1", "us-east-1"].map(
    (region) => studioBinding(region),
  ),
  codingPlan,
  mimo,
  ...[
    { binding: "china", host: "cn", prefix: "tp" },
    { binding: "singapore", host: "sgp", prefix: "ttp" },
    { binding: "europe", host: "ams", prefix: "tp" },
  ].map(({ binding, host, prefix }) => ({
    preset: { id: mimoPlan, binding },
    baseUrl: `https://token-plan-${host}.xiaomimimo.com/v1`,
    model: mimoModel,
    key: `${prefix}-fixture-token-${binding}`,
    catalog: null,
  })),
];
type Offering = (typeof offerings)[number];
const config = ({ preset, baseUrl, model }: Offering, name = `${preset.id}-${preset.binding}`) => ({
  preset,
  baseUrl,
  model,
  name,
});
const tool = {
  name: "echo",
  description: "Echo text",
  parameters: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
};
const responseTarget = { model: mimoModel, messages: false };
const studioCatalog = (model: string) =>
  Response.json({
    success: true,
    output: {
      models: [
        { model, capabilities: ["TG"] },
        { model: "fixture/specialized-chat", capabilities: ["TG"] },
        { model: "fixture-image-generator", capabilities: ["IG"] },
      ],
    },
  });
const mimoCatalog = () => Response.json({ data: [{ id: mimoModel }, { id: "mimo-v2.5-tts" }] });

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
    (input, init) => Promise.resolve(fetcher(new Request(input, init))),
  );
  async function save(offering: Offering, name?: string) {
    const input = config(offering, name);
    await h.service.save({ provider: "custom", config: input, apiKey: offering.key });
    const connection = (await h.service.list()).custom.find(({ name }) => name === input.name);
    if (!connection) throw Error("Missing saved connection");
    return connection.id as `custom:${string}`;
  }
  return { ...h, gateway, save };
}

async function collect(stream: AsyncIterable<LlmEvent>) {
  const events: LlmEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
const requestFor = (id: string, offering: Offering): LlmRequest => ({
  model: `${id}/${offering.model}`,
  system: "Complete the request.",
  messages: [{ role: "user", timestamp: 0, content: [{ type: "text", text: "Echo OK." }] }],
  tools: [tool],
  signal: new AbortController().signal,
  maxOutputTokens: 4096,
});
function assertRequest(request: Request, url: string, key: string, method: "GET" | "POST") {
  expect(request.url).toBe(url);
  expect(request.method).toBe(method);
  expect(request.redirect).toBe("error");
  expect(request.headers.get("authorization")).toBe(`Bearer ${key}`);
}

describe("Alibaba Cloud and Xiaomi MiMo scoped providers", () => {
  it.each(offerings)("continues and tests $preset.id in $preset.binding", async (offering) => {
    const bodies: Record<string, unknown>[] = [];
    let catalogCalls = 0;
    const fetcher = vi.fn(async (request: Request) => {
      if (offering.catalog && request.method === "GET") {
        assertRequest(request, offering.catalog, offering.key, "GET");
        catalogCalls++;
        return offering.preset.id === studio ? studioCatalog(offering.model) : mimoCatalog();
      }
      assertRequest(request, `${offering.baseUrl}/chat/completions`, offering.key, "POST");
      const body = await request.json();
      if (offering === codingPlan && (body.enable_thinking !== true || body.max_tokens !== 4096))
        return Response.json(
          { error: { code: "InvalidParameter", message: "Thinking must be enabled" } },
          {
            status: 400,
          },
        );
      bodies.push(body);
      return body.tools && !body.messages.some(({ role }: { role: string }) => role === "tool")
        ? toolCall(responseTarget)
        : answer(responseTarget);
    });
    const h = await setup(fetcher);
    const id = await h.save(offering);
    const first = { ...requestFor(id, offering), reasoning: "on" as const };
    const events = await collect(h.gateway.api.stream(first));
    const result = events.find((event) => event.type === "done");
    expect(result?.message.content).toEqual([
      expect.objectContaining({ type: "thinking", thinking: "Prepare the echo." }),
      expect.objectContaining({ type: "toolCall", id: "call_echo", name: "echo", arguments: { text: "OK" } }),
    ]);
    if (!result) throw Error("Missing the assistant tool call");
    const next = await collect(
      h.gateway.api.stream({
        ...first,
        messages: [
          ...first.messages,
          result.message,
          {
            role: "toolResult",
            toolCallId: "call_echo",
            toolName: "echo",
            content: [{ type: "text", text: "OK" }],
            timestamp: 0,
            isError: false,
          },
        ],
      }),
    );
    const deltas = next.filter((event) => event.type === "text");
    expect(deltas.map(({ delta }) => delta).join("")).toBe("Echo received.");
    expect(deltas.at(-1)?.sourceDeltas).toBe(2);
    expect(next.at(-1)?.type).toBe("done");
    expect(bodies).toHaveLength(2);
    const xiaomi = offering.preset.id === mimoApi || offering.preset.id === mimoPlan;
    expect(bodies[1]).toMatchObject({
      model: offering.model,
      stream: true,
      ...(xiaomi
        ? { thinking: { type: "enabled" }, max_completion_tokens: 4096 }
        : {
            enable_thinking: true,
            max_tokens: 4096,
          }),
      messages: [
        { role: "system" },
        { role: "user" },
        {
          role: "assistant",
          reasoning_content: "Prepare the echo.",
          tool_calls: [{ id: "call_echo", function: { name: "echo", arguments: '{"text":"OK"}' } }],
        },
        { role: "tool", tool_call_id: "call_echo", content: "OK" },
      ],
    });
    expect(catalogCalls).toBe(offering.catalog ? 1 : 0);
    expect((await h.gateway.test(id)).steps.map(({ status }) => status)).toEqual([
      offering.catalog ? "pass" : "skipped",
      "pass",
      "pass",
      "pass",
    ]);
    if (offering === codingPlan) {
      expect((await h.gateway.models(id)).models[0]).toMatchObject({
        reasoningOptions: ["on"],
        maxOutputTokens: 65_536,
        contextWindow: 1_000_000,
      });
      const unsupported = await collect(h.gateway.api.stream({ ...first, reasoning: "off" }));
      expect(unsupported.at(-1)).toMatchObject({ type: "error", error: { code: "INVALID" } });
    }
    expect(catalogCalls).toBe(offering.catalog ? 2 : 0);
    expect(fetcher).toHaveBeenCalledTimes(offering.catalog ? 7 : 5);
    await h.gateway.close();
  });

  it("locks routes, workspaces and saved slots before catalog or inference", async () => {
    const fetcher = vi.fn(() => {
      throw Error("Unexpected network request");
    });
    const h = await setup(fetcher);
    const singapore = studioBinding("ap-southeast-1");
    const otherWorkspace = studioBinding("ap-southeast-1", "llm-secondfixture");
    const id = await h.save(singapore);
    await h.save(otherWorkspace, "Second workspace");
    for (const offering of offerings.slice(1)) await h.save(offering);
    const slots = await h.credentials.list();
    expect(new Set(slots.map(({ providerId }) => providerId)).size).toBe(offerings.length + 1);
    const stored = h.settings.get().settings.providers.custom.find(({ slug }) => `custom:${slug}` === id);
    if (!stored) throw Error("Expected saved connection");
    const original = resolveCuratedConnection(stored, h.service.presets);
    const alternate = resolveCuratedConnection({ ...stored, ...config(otherWorkspace) }, h.service.presets);
    expect(alternate.slot).not.toBe(original.slot);
    expect(await h.credentials.read(alternate.slot)).toBeUndefined();
    for (const invalid of [
      "",
      "token-plan",
      "trial",
      "llm-",
      "llm-x.evil",
      "llm-x@evil",
      "llm-X",
      "llm-x%2e",
      "llm-x/y",
      "llm-x\n",
      `llm-${"x".repeat(60)}`,
    ]) {
      const preset = { ...singapore.preset, workspaceId: invalid };
      expect(customSettingsSchema.safeParse({ ...stored, preset }).success).toBe(false);
      expect(await h.gateway.discoverPreset({ preset, savedId: id })).toMatchObject({
        status: "failed",
        error: { messageKey: "provider.workspaceInvalid" },
      });
      await expect(
        h.service.save({
          provider: "custom",
          config: { ...config(singapore, "Invalid"), preset },
          apiKey: singapore.key,
        }),
      ).rejects.toMatchObject({ messageKey: "provider.workspaceInvalid" });
    }
    const { workspaceId: _workspace, ...missing } = singapore.preset;
    expect(await h.gateway.discoverPreset({ preset: missing, apiKey: singapore.key })).toMatchObject({
      status: "failed",
      error: { messageKey: "provider.workspaceInvalid" },
    });
    for (const offering of [otherWorkspace, studioBinding("cn-hongkong"), codingPlan, mimo]) {
      expect(await h.gateway.discoverPreset({ preset: offering.preset, savedId: id })).toMatchObject({
        status: "failed",
        error: { code: "DENIED" },
      });
      await expect(
        h.service.save({ provider: "custom", id, config: config(offering) }),
      ).rejects.toMatchObject({ code: "DENIED" });
    }
    expect(
      await h.gateway.discoverPreset({ preset: { ...singapore.preset, binding: "eu-fake-1" } }),
    ).toMatchObject({ status: "failed", error: { messageKey: "provider.serviceBindingInvalid" } });
    for (const baseUrl of [qwenStandard, qwenPlan, otherWorkspace.baseUrl, codingPlan.baseUrl]) {
      await expect(
        h.service.save({
          provider: "custom",
          config: { ...config(singapore, "Wrong route"), baseUrl },
          apiKey: singapore.key,
        }),
      ).rejects.toMatchObject({ code: "DENIED" });
    }
    for (const qwen of ["qwencloud-standard", "qwencloud-token-plan"]) {
      await expect(
        h.service.save({
          provider: "custom",
          config: {
            ...config(singapore, qwen),
            preset: { id: qwen, binding: "default" },
          },
          apiKey: singapore.key,
        }),
      ).rejects.toMatchObject({ code: "DENIED" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("reports a missing workspace independently on the catalog and inference routes", async () => {
    const catalogWorkspace = studioBinding("ap-southeast-1", "llm-missing353");
    const inferenceWorkspace = studioBinding("us-east-1", "llm-missing353");
    if (!catalogWorkspace.catalog) throw Error("Expected a documented catalog");
    const catalogUrl = catalogWorkspace.catalog;
    const fetcher = vi.fn((request: Request) => {
      if (request.method === "GET") {
        assertRequest(request, catalogUrl, catalogWorkspace.key, "GET");
        return Response.json({ code: "WorkSpaceNotFound", message: catalogWorkspace.key }, { status: 404 });
      }
      assertRequest(
        request,
        `${inferenceWorkspace.baseUrl}/chat/completions`,
        inferenceWorkspace.key,
        "POST",
      );
      return Response.json(
        { error: { code: "WorkSpaceNotFound", message: inferenceWorkspace.key } },
        {
          status: 404,
        },
      );
    });
    const h = await setup(fetcher);
    const catalogId = await h.save(catalogWorkspace);
    const inferenceId = await h.save(inferenceWorkspace);
    const error = { code: "PROVIDER", messageKey: "provider.workspaceUnavailable" };
    const discovery = await h.gateway.discoverPreset({ preset: catalogWorkspace.preset, savedId: catalogId });
    expect(discovery).toMatchObject({ status: "failed", error });
    expect(JSON.stringify(discovery)).not.toContain(catalogWorkspace.key);
    for (const [id, offering] of [
      [catalogId, catalogWorkspace],
      [inferenceId, inferenceWorkspace],
    ] as const) {
      const result = await collect(h.gateway.api.stream(requestFor(id, offering)));
      expect(result.at(-1)).toMatchObject({ type: "error", error });
      expect(JSON.stringify(result)).not.toContain(offering.key);
    }
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(fetcher.mock.calls.map(([request]) => request.method)).toEqual(["GET", "GET", "POST"]);
  });

  it("keeps discovered and manual choices in the selected catalog", async () => {
    const alibaba = studioBinding("ap-southeast-1");
    const h = await setup((request) => {
      if (request.url === alibaba.catalog) return studioCatalog(alibaba.model);
      if (request.url === mimo.catalog) return mimoCatalog();
      throw Error("Unexpected network request");
    });
    const alibabaId = await h.save(alibaba);
    const mimoId = await h.save(mimo);
    const manual = { ...codingPlan, model: "private-chat" };
    const manualId = await h.save(manual);
    expect(await h.gateway.discoverPreset({ preset: alibaba.preset, savedId: alibabaId })).toMatchObject({
      status: "discovered",
      models: [studioModel, "fixture/specialized-chat"],
    });
    const alibabaModels = (await h.gateway.models(alibabaId)).models;
    expect(alibabaModels.map(({ id }) => id)).toEqual([studioModel, "fixture/specialized-chat"]);
    expect(alibabaModels[0]).toMatchObject({
      input: ["text", "image"],
      supportsTools: true,
      reasoningOptions: ["off", "on"],
    });
    expect(alibabaModels[1]).toMatchObject({ inputVerified: false, contextVerified: false });
    expect((await h.gateway.models(mimoId)).models.map(({ id }) => id)).toEqual([mimoModel]);
    await expect(h.gateway.api.prepareModel?.(`${mimoId}/fixture/specialized-chat`)).rejects.toMatchObject({
      messageKey: "provider.scopedModelUnavailable",
    });
    expect(await h.gateway.discoverPreset({ preset: manual.preset, savedId: manualId })).toEqual({
      status: "manual",
      reason: "configured",
    });
    const manualEntry = (await h.gateway.models(manualId)).models[0];
    expect(manualEntry).toMatchObject({ id: "private-chat", inputVerified: false, contextVerified: false });
    expect(manualEntry?.supportsTools).toBeUndefined();
  });

  it("rejects the wrong key classes and maps service failures without alternate requests", async () => {
    const token = offerings.at(-1);
    if (!token) throw Error("Expected Xiaomi plan");
    const alibaba = studioBinding("ap-southeast-1");
    const requests: Request[] = [];
    let behavior: "auth" | "model" | "redirect" = "auth";
    const h = await setup((request) => {
      requests.push(request);
      if (behavior === "model")
        return Response.json({ error: { code: "ModelNotFound", message: token.key } }, { status: 404 });
      if (behavior === "redirect") return Response.redirect(qwenPlan, 307);
      return Response.json({ error: { message: token.key } }, { status: 401 });
    });
    for (const [offering, wrong] of [
      [mimo, token],
      [token, mimo],
      [alibaba, codingPlan],
      [codingPlan, alibaba],
    ] as const) {
      const expected = { code: "PROVIDER", messageKey: "provider.serviceBindingAuth" };
      await expect(h.save({ ...offering, key: wrong.key })).rejects.toMatchObject(expected);
      expect(await h.gateway.discoverPreset({ preset: offering.preset, apiKey: wrong.key })).toMatchObject({
        status: "failed",
        error: expected,
      });
    }
    expect(requests).toHaveLength(0);
    const id = await h.save(token);
    const request = requestFor(id, token);
    for (const [mode, messageKey] of [
      ["auth", "provider.serviceBindingAuth"],
      ["model", "provider.scopedModelUnavailable"],
    ] as const) {
      behavior = mode;
      const events = await collect(h.gateway.api.stream(request));
      expect(events.at(-1)).toMatchObject({ type: "error", error: { messageKey } });
      expect(JSON.stringify(events)).not.toContain(token.key);
    }
    behavior = "redirect";
    expect((await collect(h.gateway.api.stream(request))).at(-1)?.type).toBe("error");
    expect(requests).toHaveLength(3);
    for (const sent of requests) assertRequest(sent, `${token.baseUrl}/chat/completions`, token.key, "POST");
    const storedToken = h.settings.get().settings.providers.custom[0];
    if (!storedToken) throw Error("Missing settings fixture");
    const { slot } = resolveCuratedConnection(storedToken, h.service.presets);
    await h.credentials.modify(slot, async () => ({ type: "api_key", key: mimo.key }));
    expect((await collect(h.gateway.api.stream(request))).at(-1)).toMatchObject({
      type: "error",
      error: { messageKey: "provider.serviceBindingAuth" },
    });
    expect(requests).toHaveLength(3);
  });

  it.each(offerings)("cancels $preset.id in $preset.binding without retry", async (offering) => {
    let markStarted!: (signal: AbortSignal) => void;
    const started = new Promise<AbortSignal>((resolve) => {
      markStarted = resolve;
    });
    const fetcher = vi.fn((request: Request) => {
      if (offering.catalog && request.method === "GET")
        return offering.preset.id === studio ? studioCatalog(offering.model) : mimoCatalog();
      assertRequest(request, `${offering.baseUrl}/chat/completions`, offering.key, "POST");
      markStarted(request.signal);
      return new Promise<Response>((_resolve, reject) => {
        request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
      });
    });
    const h = await setup(fetcher);
    const id = await h.save(offering);
    const controller = new AbortController();
    const pending = collect(h.gateway.api.stream({ ...requestFor(id, offering), signal: controller.signal }));
    const inFlight = await Promise.race([
      started,
      pending.then(() => {
        throw Error("Transport did not start");
      }),
    ]);
    controller.abort();
    expect((await pending).at(-1)).toMatchObject({ type: "error", aborted: true });
    expect(inFlight.aborted).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(offering.catalog ? 2 : 1);
  });
});
