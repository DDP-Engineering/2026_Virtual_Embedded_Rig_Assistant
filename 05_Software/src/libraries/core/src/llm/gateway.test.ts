import { once } from "node:events";
import { existsSync } from "node:fs";
import { createServer, type RequestListener, type Server } from "node:http";
import { defaultSettings } from "@vera/shared";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { CredentialStore } from "../ports.js";
import type { LlmEvent, LlmGateway } from "./gateway.js";
import { scrub } from "./scrub.js";

let createPiAiGateway: typeof import("./providers.js")["createPiAiGateway"];
let resolveModelReference: typeof import("./gateway.js")["resolveModelReference"];
let testConnection: typeof import("./connection.js")["testConnection"];
beforeAll(async () => {
  expect(existsSync(new URL("./providers.ts", import.meta.url)), "configured model gateway exists").toBe(
    true,
  );
  ({ createPiAiGateway } = await import("./providers.js"));
  ({ resolveModelReference } = await import("./gateway.js"));
  ({ testConnection } = await import("./connection.js"));
});
const secret = "fictional-credential-private-123456";
const credentials: CredentialStore = {
  read: async () => ({ type: "api_key", key: secret }),
  list: async () => [],
  modify: async (_id, fn) => fn(undefined),
  delete: async () => {},
};
let servers: Server[] = [];
afterEach(async () => {
  for (const server of servers) {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
  }
  servers = [];
});
async function endpoint(handler: RequestListener) {
  const server = createServer(handler);
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("address");
  return { server, url: `http://127.0.0.1:${address.port}/v1` };
}
function setup(url: string) {
  const settings = defaultSettings("00000000-0000-4000-8000-000000000001");
  settings.providers.custom = [
    {
      slug: "local",
      name: "Local",
      baseUrl: url,
      model: "org/model",
      contextWindow: 32768,
      maxOutputTokens: 4096,
    },
  ];
  const gateway = createPiAiGateway({
    settings: () => settings,
    credentials,
    scrub: (s) => scrub(s, [secret]),
    now: () => 0,
  });
  return { settings, gateway };
}
async function events(
  gateway: LlmGateway,
  output?: number,
  reasoning?: string,
  model = "custom:local/org/model",
) {
  const results: LlmEvent[] = [];
  for await (const event of gateway.stream({
    model,
    ...(reasoning !== undefined ? { reasoning } : {}),
    system: "system",
    messages: [{ role: "user", content: "hi", timestamp: 0 }],
    tools: [],
    signal: new AbortController().signal,
    ...(output ? { maxOutputTokens: output } : {}),
  }))
    results.push(event);
  return results;
}
describe("model gateway", () => {
  it.each(["stop", secret])("scrubs all assistant metadata on terminal reason %s", async (finish) => {
    const retained = "fictional-retained-key-do-not-return";
    const { url } = await endpoint((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: secret, model: retained, choices: [{ index: 0, delta: { content: "OK", reasoning_details: [{ type: "reasoning.encrypted", data: retained, id: secret }] }, finish_reason: finish }] })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
    const { settings } = setup(url);
    const gateway = createPiAiGateway({
      settings: () => settings,
      credentials,
      now: () => 0,
      knownSecrets: () => [secret, retained],
      scrub: (s) => scrub(s, [secret, retained]),
    });
    const out = await events(gateway);
    expect(JSON.stringify(out)).not.toContain(secret);
    expect(JSON.stringify(out)).not.toContain(retained);
    const last = out.at(-1);
    expect(last?.type).toBe(finish === "stop" ? "done" : "error");
    if (last?.type === "done" || last?.type === "error") {
      const message = last.type === "done" ? last.message : last.partial;
      expect(message).toMatchObject({
        role: "assistant",
        responseId: "[REDACTED]",
        responseModel: "[REDACTED]",
      });
      expect(message?.content.find((c) => c.type === "thinking")).toHaveProperty("thinkingSignature");
    }
  });
  it.each([200, 500])("uses host Clock for terminal assistant messages on HTTP %i", async (status) => {
    const { url } = await endpoint((_req, res) => {
      if (status === 500)
        return void res
          .writeHead(500, { "content-type": "application/json" })
          .end(JSON.stringify({ error: { message: "unavailable" } }));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(
        `data: ${JSON.stringify({ id: "clock", choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }] })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
    const last = (await events(setup(url).gateway)).at(-1);
    if (last?.type !== "done" && last?.type !== "error") throw Error("terminal response");
    expect(last.type === "done" ? last.message.timestamp : last.partial?.timestamp).toBe(0);
  });
  it("scrubs host and injected gateway failures in connection results", async () => {
    const { gateway } = setup("http://127.0.0.1:1/v1");
    const failing: LlmGateway = {
      ...gateway,
      models: async () => {
        throw new Error(secret);
      },
      capabilities: () => {
        throw new Error(secret);
      },
    };
    const result = await testConnection(
      failing,
      "custom:local",
      undefined,
      undefined,
      () => 0,
      (s) => scrub(s, [secret]),
    );
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.steps).toHaveLength(4);
  });
  it("lists the static OpenAI catalog before auth without network and ignores ambient keys", async () => {
    const { gateway } = setup("http://127.0.0.1:1/v1");
    expect((await gateway.models("openai")).models.length).toBeGreaterThan(0);
    const cols = gateway.collections;
    expect(cols.api.getModels("openai").length).toBeGreaterThan(0);
  });
  it("scrubs secrets spanning text deltas and preserves final usage", async () => {
    const { url } = await endpoint((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" });
      for (const text of [secret.slice(0, 12), secret.slice(12), " safe"])
        res.write(
          `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "org/model", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n`,
        );
      res.write(
        `data: ${JSON.stringify({ id: "x", object: "chat.completion.chunk", created: 0, model: "org/model", choices: [{ index: 0, delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 } })}\n\n`,
      );
      res.end("data: [DONE]\n\n");
    });
    const out = await events(setup(url).gateway);
    const text = out
      .filter((e) => e.type === "text")
      .map((e) => (e.type === "text" ? e.delta : ""))
      .join("");
    expect(text).not.toContain(secret);
    expect(text).toContain("[REDACTED]");
    expect(out.at(-1)).toMatchObject({ type: "done", message: { usage: { input: 5, output: 6 } } });
  });
  it("resolves exact session then workbench then app references, keeping model slashes", () => {
    expect(resolveModelReference("custom:a/org/model", "openai/b", "openai/c")).toBe("custom:a/org/model");
    expect(resolveModelReference(null, "openai/b", "openai/c")).toBe("openai/b");
    expect(resolveModelReference(undefined, null, "openai/c")).toBe("openai/c");
    expect(() => resolveModelReference(null, null, null)).toThrow();
    expect(() => resolveModelReference("invalid", null, "openai/c")).toThrow();
  });
  it("keeps subscription OAuth-only and exposes fresh bounded capabilities before streaming", () => {
    const { settings, gateway } = setup("http://127.0.0.1:1/v1");
    expect(gateway.collections.subscription.getProviders().map((p) => p.id)).toEqual(["openai"]);
    expect(Object.keys(gateway.collections.subscription.getProviders()[0]?.auth ?? {})).toEqual(["oauth"]);
    expect(gateway.collections.api.getProviders().map((p) => p.id)).toEqual(["openai", "custom:local"]);
    expect(gateway.capabilities("custom:local/org/model")).toMatchObject({
      contextWindow: 32768,
      maxOutputTokens: 4096,
      inputBudget: 27033,
      safetyMargin: 1639,
    });
    expect(gateway.capabilities("custom:local/org/model", 99999).maxOutputTokens).toBe(4096);
    const custom = settings.providers.custom[0];
    if (!custom) throw Error("custom configuration");
    custom.contextWindow = 8192;
    custom.maxOutputTokens = 2048;
    expect(gateway.capabilities("custom:local/org/model")).toMatchObject({
      contextWindow: 8192,
      inputBudget: 5120,
    });
    custom.contextWindow = 1000;
    expect(() => gateway.capabilities("custom:local/org/model")).toThrow();
  });
  it("lists actual custom IDs with configured budgets and retains configured model", async () => {
    const { url } = await endpoint((_req, res) =>
      res
        .writeHead(200, { "content-type": "application/json" })
        .end(JSON.stringify({ data: [{ id: "found" }] })),
    );
    const { gateway } = setup(url);
    const catalog = await gateway.models("custom:local");
    expect(catalog.reachability).toBe("pass");
    expect(catalog.models.map((m) => m.id)).toEqual(["org/model", "found"]);
    expect(catalog.models[1]).toMatchObject({ contextWindow: 32768, maxOutputTokens: 4096 });
  });
  it.each(["bad model", "bad\nmodel"])(
    "rejects malformed discovered ID %j at the core catalog boundary",
    async (id) => {
      const { url } = await endpoint((req, res) => {
        if (req.url?.endsWith("/models"))
          return void res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ data: [{ id }] }));
        res
          .writeHead(401, { "content-type": "application/json" })
          .end(JSON.stringify({ error: { message: "denied" } }));
      });
      const { gateway } = setup(url);
      await expect(gateway.models("custom:local")).rejects.toMatchObject({ code: "PROVIDER" });
      const result = await testConnection(gateway, "custom:local");
      expect(result.steps).toHaveLength(4);
      expect(result.steps[0]).toMatchObject({
        step: "reachability",
        status: "fail",
        error: { code: "PROVIDER" },
      });
    },
  );
  it("skips unsupported listing and runs conservative scripted tool/stream requests through pi-ai", async () => {
    const payloads: Record<string, unknown>[] = [];
    const { url } = await endpoint((req, res) => {
      if (req.url?.endsWith("/models")) return void res.writeHead(404).end();
      let data = "";
      req.on("data", (b) => (data += b));
      req.on("end", () => {
        const body = JSON.parse(data);
        payloads.push(body);
        res.writeHead(200, { "content-type": "text/event-stream" });
        const send = (delta: unknown, finish: unknown = null) =>
          res.write(
            `data: ${JSON.stringify({ id: "script", object: "chat.completion.chunk", created: 0, model: "org/model", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
          );
        if (body.tools) {
          send({
            tool_calls: [
              {
                index: 0,
                id: "call_echo",
                type: "function",
                function: { name: "echo", arguments: '{"text":"OK"}' },
              },
            ],
          });
          send({}, "tool_calls");
        } else {
          send({ content: "O" });
          send({ content: "K" });
          send({}, "stop");
        }
        res.end("data: [DONE]\n\n");
      });
    });
    const { gateway } = setup(url);
    const result = await testConnection(gateway, "custom:local");
    expect(result.steps.map((s) => [s.step, s.status])).toEqual([
      ["reachability", "skipped"],
      ["authentication", "pass"],
      ["tools", "pass"],
      ["streaming", "pass"],
    ]);
    expect(payloads.length).toBe(3);
    for (const body of payloads) {
      expect(body).not.toHaveProperty("store");
      expect(body).not.toHaveProperty("reasoning_effort");
      expect(JSON.stringify(body)).not.toContain('"developer"');
    }
  });
  it.each([true, false])(
    "probes streaming beyond a single-token OK and still rejects coalesced text (chunked=%s)",
    async (chunked) => {
      const { url } = await endpoint((req, res) => {
        if (req.method === "GET")
          return void res
            .writeHead(200, { "content-type": "application/json" })
            .end(JSON.stringify({ data: [{ id: "org/model" }] }));
        let data = "";
        req.on("data", (part) => {
          data += part;
        });
        req.on("end", () => {
          const body = JSON.parse(data);
          res.writeHead(200, { "content-type": "text/event-stream" });
          const send = (delta: unknown, finish: string | null = null) =>
            res.write(
              `data: ${JSON.stringify({ id: "short-ok", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`,
            );
          if (body.tools) {
            send({
              tool_calls: [
                {
                  index: 0,
                  id: "echo",
                  type: "function",
                  function: { name: "echo", arguments: '{"text":"OK"}' },
                },
              ],
            });
            send({}, "tool_calls");
          } else {
            const short = body.messages.at(-1)?.content === "Reply with OK.";
            const words = short
              ? ["OK"]
              : ["This ", "connection ", "supports ", "incremental ", "streaming."];
            for (const content of chunked ? words : [words.join("")]) send({ content });
            send({}, "stop");
          }
          res.end("data: [DONE]\n\n");
        });
      });
      const result = await testConnection(setup(url).gateway, "custom:local");
      expect(result.steps.map((s) => s.status)).toEqual(["pass", "pass", "pass", chunked ? "pass" : "fail"]);
    },
  );
  it.each([
    [401, "auth"],
    [403, "auth"],
    [429, "rate_limit"],
    [400, "context"],
    [500, "provider"],
  ])("maps HTTP %i safely with retry-after and no automatic retry", async (status, reason) => {
    let calls = 0;
    const { url } = await endpoint((_req, res) => {
      calls++;
      res.writeHead(status, { "content-type": "application/json", "retry-after": "7" }).end(
        JSON.stringify({
          error: {
            message: `${status === 400 ? "maximum context length exceeded" : "rejected"} ${secret}`,
          },
        }),
      );
    });
    const result = await events(setup(url).gateway);
    const last = result.at(-1);
    expect(last).toMatchObject({ type: "error", error: { code: "PROVIDER", params: { reason } } });
    if (status === 429) expect(last).toMatchObject({ error: { params: { retryAfter: "7" } } });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(calls).toBe(1);
  });
  it("maps refused connection OFFLINE and rejects unknown providers/models without network", async () => {
    const { url, server } = await endpoint((_req, res) => res.end());
    await new Promise<void>((r) => server.close(() => r()));
    servers = [];
    expect((await events(setup(url).gateway)).at(-1)).toMatchObject({
      type: "error",
      error: { code: "OFFLINE" },
    });
    const gateway = setup(url).gateway;
    expect(() => gateway.capabilities("chatgpt/model")).toThrow();
    expect(() => gateway.capabilities("openai/invented-model")).toThrow();
  });
});

it("uses per-model discovered context and optional LM Studio generation parameters", async () => {
  const payloads: Record<string, unknown>[] = [];
  const { url } = await endpoint((req, res) => {
    let raw = "";
    req.on("data", (part) => {
      raw += part;
    });
    req.on("end", () => {
      payloads.push(JSON.parse(raw));
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.end(
        `data: ${JSON.stringify({ id: "test", model: "org/model", choices: [{ index: 0, delta: { content: "OK" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`,
      );
    });
  });
  const { settings, gateway } = setup(url);
  const local = settings.providers.custom[0];
  if (!local) throw Error("Missing local provider");
  local.protocol = "lmstudio";
  local.models = [
    {
      id: "org/model",
      name: "First",
      maxContextWindow: 262144,
      loadedContextWindow: 65536,
      contextWindow: 65536,
      maxOutputTokens: 4096,
      reasoningOptions: ["off", "on", "xhigh"],
      reasoningDefault: "xhigh",
      reasoning: "off",
      temperature: 0,
    },
    { id: "other", name: "Second", contextWindow: 32768, maxOutputTokens: 2048, reasoningOptions: [] },
  ];
  expect(gateway.capabilities("custom:local/org/model").reasoningOptions).toEqual(["off", "on", "xhigh"]);
  expect(gateway.capabilities("custom:local/org/model").contextWindow).toBe(65536);
  expect(gateway.capabilities("custom:local/other").contextWindow).toBe(32768);
  expect((await gateway.models("custom:local")).models.map((m) => m.contextWindow)).toEqual([65536, 32768]);
  await events(gateway);
  expect(payloads[0]).toMatchObject({ temperature: 0, reasoning_effort: "none" });
  const profile = local.models[0];
  if (!profile) throw Error("Missing model");
  profile.reasoning = "on";
  await events(gateway);
  expect(payloads[1]).toMatchObject({ reasoning_effort: "xhigh" });
  delete profile.reasoning;
  delete profile.temperature;
  await events(gateway);
  expect(payloads[2]).not.toHaveProperty("temperature");
  expect(payloads[2]).not.toHaveProperty("reasoning_effort");
  profile.reasoning = "off";
  await events(gateway, undefined, "xhigh");
  expect(payloads[3]).toMatchObject({ reasoning_effort: "xhigh" });
  await events(gateway, undefined, "invented");
  expect(payloads).toHaveLength(4);
  expect((await gateway.models("custom:local")).models[0]?.reasoningOptions).toEqual(["off", "on", "xhigh"]);
});

it("loads ChatGPT models and native reasoning from the account catalog, including future models", async () => {
  const settings = defaultSettings("00000000-0000-4000-8000-000000000001");
  let access = "fictional-oauth-a",
    loads = 0;
  let deny = false;
  const payloads: Record<string, unknown>[] = [];
  const gateway = createPiAiGateway({
    settings: () => settings,
    now: () => 0,
    scrub: (s) => s,
    credentials: {
      ...credentials,
      read: async () => ({
        type: "oauth",
        access,
        refresh: "fictional-refresh",
        expires: Date.now() + 3600000,
      }),
    },
    fetch: async (input, init) => {
      const url = String(input);
      if (url.startsWith("https://chatgpt.com/backend-api/codex/models?client_version=")) {
        loads++;
        if (deny) return Response.json({}, { status: 401 });
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${access}`);
        return Response.json({
          models: [
            {
              slug: "future-reasoner",
              display_name: "Future reasoner",
              visibility: "list",
              context_window: 128000,
              supported_reasoning_levels: [
                { effort: "ultra", description: "Codex client orchestration" },
                { effort: access.endsWith("a") ? "future_effort" : "low", description: "From server" },
              ],
              default_reasoning_level: "future_effort",
            },
          ],
        });
      }
      expect(url).toBe("https://api.openai.com/v1/responses");
      payloads.push(JSON.parse(String(init?.body)));
      return Response.json({ error: { message: "fixture" } }, { status: 500 });
    },
  });
  expect((await gateway.models("chatgpt")).models.map((m) => m.id)).toEqual(["future-reasoner"]);
  expect(gateway.selectedModel("chatgpt")).toBe("future-reasoner");
  expect(gateway.capabilities("chatgpt/future-reasoner").reasoningOptions).toEqual(["future_effort"]);
  await gateway.models("chatgpt");
  expect(loads).toBe(1);
  await events(gateway, undefined, "future_effort", "chatgpt/future-reasoner");
  expect(payloads.at(-1)).toMatchObject({ reasoning: { effort: "future_effort" } });
  await events(gateway, undefined, undefined, "chatgpt/future-reasoner");
  expect(payloads.at(-1)).not.toHaveProperty("reasoning.effort");
  access = "fictional-oauth-b";
  await gateway.models("chatgpt");
  expect(loads).toBe(2);
  expect(gateway.capabilities("chatgpt/future-reasoner").reasoningOptions).toEqual(["low"]);
  access = "fictional-oauth-c";
  deny = true;
  await expect(gateway.models("chatgpt")).rejects.toBeDefined();
  expect(() => gateway.capabilities("chatgpt/future-reasoner")).toThrow();
});

it("isolates cancellation of callers sharing ChatGPT catalog discovery", async () => {
  let finish!: (response: Response) => void,
    started!: () => void,
    loads = 0;
  const ready = new Promise<void>((r) => {
    started = r;
  });
  const gateway = createPiAiGateway({
    settings: () => defaultSettings("00000000-0000-4000-8000-000000000001"),
    now: () => 0,
    scrub: (s) => s,
    credentials: {
      ...credentials,
      read: async () => ({
        type: "oauth",
        access: "fictional-oauth",
        refresh: "fictional-refresh",
        accountId: "account_fixture",
        expires: Date.now() + 3600000,
      }),
    },
    fetch: async (url, init) => {
      expect(String(url)).toBe("https://chatgpt.com/backend-api/codex/models?client_version=0.162.1");
      expect(new Headers(init?.headers).get("ChatGPT-Account-ID")).toBe("account_fixture");
      loads++;
      started();
      return new Promise<Response>((resolve) => {
        finish = resolve;
      });
    },
  });
  const controller = new AbortController();
  const result = Promise.allSettled([
    gateway.models("chatgpt", controller.signal),
    gateway.models("chatgpt"),
  ]);
  await ready;
  await new Promise<void>((r) => setTimeout(r, 0));
  controller.abort();
  finish(
    Response.json({
      models: [
        {
          slug: "future",
          display_name: "Future",
          visibility: "list",
          context_window: 32000,
          supported_reasoning_levels: [{ effort: "high" }],
        },
      ],
    }),
  );
  const [first, second] = await result;
  expect(first?.status).toBe("rejected");
  expect(second?.status).toBe("fulfilled");
  expect(loads).toBe(1);
});
