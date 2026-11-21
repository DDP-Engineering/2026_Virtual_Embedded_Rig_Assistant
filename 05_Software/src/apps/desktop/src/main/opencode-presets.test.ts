import type { LlmEvent, LlmRequest } from "@vera/core";
import type { ProviderSave } from "@vera/shared";
import { describe, expect, it, vi } from "vitest";
import { ProviderGateway } from "./provider-gateway.js";
import { providerSettingsHarness } from "./provider-settings.test-support.js";

const plans = [
  {
    id: "opencode-console",
    label: "OpenCode Console",
    route: "/inference",
    key: "fixture-console-key",
    model: "glm-5.3",
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    route: "/inference/go",
    key: "fixture-go-key",
    model: "deepseek-v4-pro",
  },
] as const;

function setupRequest(plan: (typeof plans)[number]): Extract<ProviderSave, { provider: "custom" }> {
  return {
    provider: "custom",
    config: {
      name: plan.label,
      baseUrl: `https://opencode.ai${plan.route}/openai/v1`,
      model: plan.model,
      preset: { id: plan.id, binding: "default" },
    },
    apiKey: plan.key,
  };
}

async function configured(fetcher: typeof fetch) {
  const h = providerSettingsHarness();
  await h.settings.load();
  for (const plan of plans) await h.service.save(setupRequest(plan));
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

function catalog(plan: (typeof plans)[number]) {
  return Response.json({
    object: "list",
    data: [
      {
        id: plan.model,
        name: `${plan.label} model`,
        type: "chat",
        limit: { context: 100000, input: 72000, output: 16000 },
        modalities: { input: ["text", "image/png", "application/pdf"] },
        capabilities: { tools: { supported: true }, reasoning: { supported: true, effort: ["high"] } },
        api: { "chat-completions": { base_url: "https://ignored.invalid" } },
        cost: { text: { input: { price: 1 }, output: { price: 2 } } },
      },
      { id: "org/sparse" },
      { id: "text-embedding-3-small", type: "embedding", limit: { context: 8192, output: 0 } },
      { id: "gpt-image-2.5-sunburst", type: "image", limit: { context: 0, output: 0 } },
      { id: "kimi-k3", type: "chat", limit: { context: 262144, output: 262144 } },
      ...(plan.id === "opencode-console"
        ? [{ id: "big-pickle", type: "chat", cost: { text: { input: { price: 0 }, output: { price: 0 } } } }]
        : []),
    ],
  });
}

function streamResponse(deltas: object[], stop: string) {
  const data = deltas.map(
    (delta, index) =>
      `data: ${JSON.stringify({
        id: "fixture",
        choices: [{ index: 0, delta, finish_reason: index === deltas.length - 1 ? stop : null }],
      })}\n\n`,
  );
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

async function events(stream: AsyncIterable<LlmEvent>) {
  const result: LlmEvent[] = [];
  for await (const event of stream) result.push(event);
  return result;
}

describe("OpenCode presets through the production provider gateway", () => {
  it("reads each eligible catalog with its saved key and exposes model metadata and plan identity", async () => {
    const seen: string[] = [];
    const h = await configured(async (input, init) => {
      const request = new Request(input, init);
      const plan = plans.find(({ route }) => request.url === `https://opencode.ai${route}/v1/models`);
      expect(plan).toBeDefined();
      if (!plan) throw Error("unexpected catalog URL");
      expect(request.headers.get("authorization")).toBe(`Bearer ${plan.key}`);
      expect(request.redirect).toBe("error");
      seen.push(plan.id);
      return catalog(plan);
    });
    for (const [index, plan] of plans.entries()) {
      const connection = h.connections[index]!;
      const other = h.connections[1 - index]!;
      const preset = setupRequest(plan).config.preset!;
      expect(await h.gateway.discoverPreset({ preset, savedId: other.id })).toMatchObject({
        status: "failed",
        error: { code: "DENIED" },
      });
      expect(await h.gateway.discoverPreset({ preset, savedId: connection.id })).toMatchObject({
        status: "discovered",
        models: [plan.model, "org/sparse", "kimi-k3"],
      });
      await h.service.save({
        ...setupRequest(plan),
        id: connection.id,
        apiKey: undefined,
        config: { ...setupRequest(plan).config, name: `Renamed ${plan.id}` },
      });
      expect(await h.gateway.models(connection.id)).toMatchObject({
        models: [
          {
            id: plan.model,
            name: `${plan.label} model`,
            providerName: `${plan.label} · Renamed ${plan.id}`,
            contextWindow: 100000,
            maxOutputTokens: 4096,
            providerMaxOutputTokens: 16000,
            maxInputTokens: 72000,
            inputBudget: 72000,
            inputVerified: true,
            input: ["text", "image"],
            supportsTools: true,
            reasoningOptions: ["high"],
          },
          { id: "org/sparse", contextVerified: false, inputVerified: false },
          {
            id: "kimi-k3",
            contextWindow: 262144,
            maxOutputTokens: 4096,
            providerMaxOutputTokens: 262144,
            inputBudget: 244940,
          },
        ],
      });
      const sparse = h.gateway.api.capabilities(`${connection.id}/org/sparse`);
      expect(sparse).not.toHaveProperty("supportsTools");
      expect(sparse).not.toHaveProperty("reasoningOptions");
    }
    expect(seen).toEqual([plans[0].id, plans[0].id, plans[1].id, plans[1].id]);
  });

  it.each(plans)("streams, continues a tool call and recovers after cancellation on $label", async (plan) => {
    const posts: { body: Record<string, unknown>; session: string | null }[] = [];
    const hanging = deferred<AbortSignal>();
    const h = await configured(async (input, init) => {
      const request = new Request(input, init);
      expect(request.headers.get("authorization")).toBe(`Bearer ${plan.key}`);
      expect(request.redirect).toBe("error");
      if (request.method === "GET") {
        expect(request.url).toBe(`https://opencode.ai${plan.route}/v1/models`);
        return catalog(plan);
      }
      expect(request.url).toBe(`https://opencode.ai${plan.route}/openai/v1/chat/completions`);
      expect(request.headers.get("user-agent")).toBe("VERA");
      const body = (await request.json()) as Record<string, unknown>;
      expect(body.model).toBe(plan.model);
      posts.push({ body, session: request.headers.get("x-opencode-session") });
      if (posts.length === 1)
        return streamResponse(
          [
            { reasoning_content: "Prepare the tool call." },
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
      if (posts.length === 3) {
        hanging.resolve(request.signal);
        return new Promise((_resolve, reject) => {
          request.signal.addEventListener("abort", () => reject(request.signal.reason), { once: true });
        });
      }
      return streamResponse([{ content: "Echo " }, { content: "received." }], "stop");
    });
    const connection = h.connections[plans.indexOf(plan)]!;
    const signal = new AbortController();
    const request: LlmRequest = {
      model: `${connection.id}/${plan.model}`,
      system: "Echo a message",
      messages: [{ role: "user", content: "Echo OK", timestamp: 0 }],
      sessionId: "ses_fixture",
      tools: [
        {
          name: "echo",
          description: "Echo",
          parameters: { type: "object", properties: { text: { type: "string" } } },
        },
      ],
      signal: signal.signal,
      reasoning: "high",
    };
    const first = await events(h.gateway.api.stream(request));
    expect(first.some(({ type }) => type === "tool")).toBe(true);
    const terminal = first.at(-1);
    if (terminal?.type !== "done") throw Error("expected a completed assistant tool call");
    expect(terminal.message.content).toContainEqual({
      type: "toolCall",
      id: "call_echo",
      name: "echo",
      arguments: { text: "OK" },
    });
    const continued = await events(
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
    expect(posts[0]?.body).toMatchObject({ stream: true, reasoning_effort: "high" });
    expect(posts[1]?.body.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "assistant",
          reasoning_content: "Prepare the tool call.",
          tool_calls: [expect.objectContaining({ id: "call_echo" })],
        }),
        expect.objectContaining({ role: "tool", tool_call_id: "call_echo", content: "OK" }),
      ]),
    );
    const stopped = new AbortController();
    const inFlight = events(h.gateway.api.stream({ ...request, signal: stopped.signal }));
    const transportSignal = await hanging.promise;
    stopped.abort();
    expect((await inFlight).at(-1)).toMatchObject({ type: "error", aborted: true });
    expect(transportSignal.aborted).toBe(true);
    expect((await events(h.gateway.api.stream(request))).at(-1)).toMatchObject({ type: "done" });
    expect(posts.map(({ session }) => session)).toEqual(Array(4).fill("ses_fixture"));
  });

  it("keeps refreshed model choices scoped when a key changes during catalog loading", async () => {
    const oldRequest = deferred<void>();
    const oldResult = deferred<Response>();
    const rotatedKey = "fixture-rotated-key";
    const h = await configured(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe("https://opencode.ai/inference/v1/models");
      if (request.headers.get("authorization") === `Bearer ${plans[0].key}`) {
        oldRequest.resolve();
        return oldResult.promise;
      }
      expect(request.headers.get("authorization")).toBe(`Bearer ${rotatedKey}`);
      return Response.json({ data: [{ id: "org/new-only" }] });
    });
    const connection = h.connections[0]!;
    const pending = h.gateway.models(connection.id);
    await oldRequest.promise;
    await h.service.save({ ...setupRequest(plans[0]), id: connection.id, apiKey: rotatedKey });
    expect((await h.gateway.models(connection.id)).models.map(({ id }) => id)).toEqual([
      plans[0].model,
      "org/new-only",
    ]);
    oldResult.resolve(catalog(plans[0]));
    await pending;
    expect(() => h.gateway.api.capabilities(`${connection.id}/org/sparse`)).toThrow();
    expect(h.gateway.api.capabilities(`${connection.id}/org/new-only`)).toMatchObject({
      inputVerified: false,
    });
  });

  it("does not dispatch with a superseded key after waiting for catalog metadata", async () => {
    const entered = deferred<void>();
    const result = deferred<Response>();
    const transport = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "GET") {
        entered.resolve();
        return result.promise;
      }
      return streamResponse([{ content: "Unexpected reply" }], "stop");
    });
    const h = await configured(transport);
    const plan = plans[0];
    const connection = h.connections[0]!;
    const pending = events(
      h.gateway.api.stream({
        model: `${connection.id}/${plan.model}`,
        system: "",
        messages: [],
        tools: [],
        signal: new AbortController().signal,
      }),
    );
    await entered.promise;
    await h.service.save({ ...setupRequest(plan), id: connection.id, apiKey: "fixture-replacement-key" });
    result.resolve(catalog(plan));
    expect((await pending).at(-1)).toMatchObject({ type: "error", error: { code: "CONFLICT" } });
    expect(transport).toHaveBeenCalledTimes(1);
  });

  it.each(plans)("keeps authentication, eligibility, billing and throttle errors on $label", async (plan) => {
    const borrowedKey = plans[1 - plans.indexOf(plan)]!.key;
    let status = 401;
    let problem = { type: "AuthError", message: "Invalid API key" };
    const h = await configured(
      vi.fn<typeof fetch>(async (input, init) => {
        const request = new Request(input, init);
        expect(request.url).toBe(
          `https://opencode.ai${plan.route}${request.method === "GET" ? "/v1/models" : "/openai/v1/chat/completions"}`,
        );
        expect(request.headers.get("authorization")).toBe(`Bearer ${borrowedKey}`);
        expect(request.redirect).toBe("error");
        if (request.method === "POST") {
          const body = await request.json();
          expect(body.model).toBe("different-plan-model");
          expect(request.headers.get("x-opencode-session")).toBeTruthy();
        }
        return Response.json({ type: "error", error: problem }, { status, headers: { "retry-after": "12" } });
      }),
    );
    const connection = h.connections[plans.indexOf(plan)]!;
    const save = setupRequest(plan);
    await h.service.save({
      ...save,
      id: connection.id,
      apiKey: borrowedKey,
      config: { ...save.config, model: "different-plan-model" },
    });
    const discovery = () => h.gateway.discoverPreset({ preset: save.config.preset!, savedId: connection.id });
    expect(await discovery()).toMatchObject({ status: "failed", error: { messageKey: "provider.auth" } });
    const request = {
      model: `${connection.id}/different-plan-model`,
      system: "",
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    };
    const infer = async () => (await events(h.gateway.api.stream(request))).at(-1);
    expect(await infer()).toMatchObject({ type: "error", error: { messageKey: "provider.auth" } });
    status = 403;
    problem = { type: "PermissionError", message: "Models Read permission required" };
    expect(await discovery()).toMatchObject({
      status: "failed",
      error: { messageKey: "provider.openCodeCatalog" },
    });
    problem = { type: "SubscriptionError", message: "No active subscription" };
    expect(await infer()).toMatchObject({ type: "error", error: { messageKey: "provider.openCodePlan" } });
    status = 404;
    problem = { type: "ModelError", message: "Model is not available on this plan" };
    expect(await infer()).toMatchObject({ type: "error", error: { messageKey: "provider.openCodePlan" } });
    status = 429;
    problem = { type: "SubscriptionUsageLimitError", message: "Plan usage limit reached" };
    expect(await infer()).toMatchObject({ type: "error", error: { messageKey: "provider.openCodeBudget" } });
    problem = { type: "UpstreamError", message: "Upstream request failed: Policy budget exceeded" };
    expect(await infer()).toMatchObject({ type: "error", error: { messageKey: "provider.openCodeBudget" } });
    status = 402;
    problem = { type: "BalanceError", message: "Insufficient balance" };
    expect(await infer()).toMatchObject({ type: "error", error: { messageKey: "provider.openCodeBudget" } });
    status = 429;
    problem = { type: "RateLimitError", message: "Rate limit exceeded" };
    expect(await infer()).toMatchObject({
      type: "error",
      error: {
        messageKey: "provider.rateLimit",
        params: { retryAfter: "12" },
      },
    });
  });
});
