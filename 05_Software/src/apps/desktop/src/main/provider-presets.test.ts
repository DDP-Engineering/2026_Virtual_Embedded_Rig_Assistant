import { createPiAiGateway, type LlmEvent, SettingsService, testConnection } from "@vera/core";
import { curatedProviderPresets, type ProviderSave } from "@vera/shared";
import { describe, expect, it, vi } from "vitest";
import { ProviderGateway } from "./provider-gateway.js";
import { ProviderSettings } from "./provider-settings.js";
import { providerSettingsHarness as harness } from "./provider-settings.test-support.js";

async function collectEvents(stream: AsyncIterable<LlmEvent>): Promise<LlmEvent[]> {
  const events: LlmEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

const plans = ["standard", "plus"].map((id) => ({
  id: `fixture-${id}`,
  label: `Fixture ${id}`,
  protocol: "openai-completions" as const,
  authentication: "bearer" as const,
  bindings: [
    {
      id: "global",
      inference: `https://fixture.invalid/${id}/inference`,
      catalog: { kind: "openai-models" as const, url: `https://fixture.invalid/${id}/catalog` },
      models: [
        {
          id: "org/verified",
          name: "Verified",
          input: ["text", "image"] as const,
          supportsTools: true,
          reasoningOptions: ["low"],
          contextWindow: 64000,
          maxOutputTokens: 8000,
        },
        { id: "org/partial", name: "Partial profile", contextWindow: 8192 },
      ],
    },
  ],
}));
const standardKey = "fake-standard-2026-private";
const plusKey = "fake-plus-2026-private";
function draft(index = 0): Extract<ProviderSave, { provider: "custom" }> {
  const plan = plans[index]!;
  return {
    provider: "custom",
    config: {
      name: plan.label,
      baseUrl: plan.bindings[0]!.inference,
      model: "org/manual/model",
      preset: { id: plan.id, binding: "global" },
    },
    apiKey: index === 0 ? standardKey : plusKey,
  };
}
async function curatedHarness() {
  const h = harness(true, plans);
  await h.settings.load();
  for (const index of [0, 1]) await h.service.save(draft(index));
  const [first, second] = (await h.service.list()).custom;
  if (!first || !second) throw Error("expected two saved connections");
  return { ...h, first, second };
}
const sse = (text: string) =>
  new Response(
    `data: ${JSON.stringify({ id: "fixture", choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\n` +
      'data: {"id":"fixture","choices":[{"index":0,"delta":{"content":" OK"},"finish_reason":"stop"}]}\n\n' +
      "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  );
describe("curated provider setup", () => {
  it("preserves independent identities across rename and reload, and never reassigns removed references", async () => {
    const h = await curatedHarness();
    const request = { ...draft(), apiKey: undefined };
    await h.service.save({
      ...request,
      id: h.first.id,
      config: { ...request.config, name: "Renamed plan" },
    });
    expect(await h.service.list()).toMatchObject({
      custom: [
        { id: h.first.id, name: "Renamed plan", configured: true },
        { id: h.second.id, configured: true },
      ],
    });
    const persisted = JSON.parse(h.disk.get("/data/settings.json") ?? "{}");
    expect(persisted).toMatchObject({ schemaVersion: 1 });
    expect(JSON.stringify(persisted)).not.toContain(standardKey);
    expect(JSON.stringify(await h.service.list())).not.toContain(plusKey);
    const reload = new SettingsService({
      files: h.files,
      paths: { userData: "/data", settings: "/data/settings.json", logs: "/data/logs" },
      uuid: () => persisted.installationId,
      changed: h.changed,
    });
    await reload.load();
    const restarted = new ProviderSettings(reload, h.credentials, plans);
    expect((await restarted.list()).custom.map((c) => c.id)).toEqual([h.first.id, h.second.id]);
    await restarted.remove({ id: h.first.id });
    await restarted.save(draft());
    expect((await restarted.list()).custom.map((c) => c.id)).toEqual([
      h.second.id,
      expect.not.stringMatching(h.first.id),
    ]);
  });

  it("has a typed discovery workflow and refuses borrowed IDs, redirects and echoed secrets", async () => {
    const h = await curatedHarness();
    let response = () => Response.json({ data: [{ id: "org/slash/model" }] });
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const req = new Request(input, init);
      expect(req.url).toBe(plans[0]!.bindings[0]!.catalog.url);
      expect(req.headers.get("authorization") === `Bearer ${standardKey}`).toBe(true);
      expect(req.redirect).toBe("error");
      return response();
    });
    const gateway = new ProviderGateway(
      h.settings,
      h.credentials,
      h.service,
      { now: () => new Date(0), sleep: async () => {} },
      undefined,
      undefined,
      fetcher,
    );
    const preset = draft().config.preset!;
    const request = { preset, savedId: h.first.id };
    expect(await gateway.discoverPreset({ preset, savedId: h.second.id })).toMatchObject({
      status: "failed",
      error: { code: "DENIED" },
    });
    expect(fetcher).not.toHaveBeenCalled();
    expect(await gateway.discoverPreset(request)).toEqual({
      status: "discovered",
      models: ["org/slash/model"],
    });
    response = () => new Response(null, { status: 404 });
    expect(await gateway.discoverPreset(request)).toEqual({ status: "manual", reason: "unavailable" });
    response = () => new Response(plusKey, { status: 401 });
    expect(await gateway.discoverPreset(request)).toMatchObject({
      status: "failed",
      error: { messageKey: "provider.auth", params: { message: "" } },
    });
    response = () => Response.redirect("https://fixture.invalid/plus/catalog", 307);
    expect(await gateway.discoverPreset(request)).toMatchObject({ status: "failed" });
    response = () => Response.json({ data: [{ id: plusKey }] });
    expect(await gateway.discoverPreset(request)).toEqual({
      status: "failed",
      error: { code: "INVALID", messageKey: "errors.INVALID" },
    });
    response = () => Response.json({ data: [{ id: "invalid id" }] });
    expect(await gateway.discoverPreset(request)).toMatchObject({
      status: "failed",
      error: { code: "PROVIDER" },
    });
    expect(await gateway.discoverPreset({ preset, apiKey: standardKey })).toMatchObject({ status: "failed" });
    await gateway.close();
  });

  it("forwards cancellation for discovery and inference", async () => {
    const h = await curatedHarness();
    const signals: AbortSignal[] = [];
    const entered = vi.fn();
    const fetcher: typeof fetch = (_input, init) => {
      const signal = init?.signal;
      if (!signal) throw Error("missing signal");
      signals.push(signal);
      entered();
      return new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    };
    const gateway = new ProviderGateway(
      h.settings,
      h.credentials,
      h.service,
      { now: () => new Date(0), sleep: async () => {} },
      undefined,
      undefined,
      fetcher,
    );
    const discovery = gateway.discoverPreset({ preset: draft().config.preset!, savedId: h.first.id });
    await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(1));
    await gateway.close();
    expect(await discovery).toMatchObject({ status: "failed", error: { code: "DENIED" } });

    const abort = new AbortController();
    const stream = gateway.api.stream({
      model: `${h.first.id}/${h.first.model}`,
      system: "fixture",
      messages: [{ role: "user", content: "OK", timestamp: 0 }],
      tools: [],
      signal: abort.signal,
    });
    const firstEvent = stream[Symbol.asyncIterator]().next();
    await vi.waitFor(() => expect(entered).toHaveBeenCalledTimes(2));
    abort.abort();
    expect(await firstEvent).toMatchObject({ value: { type: "error", aborted: true } });
    expect(signals.every((signal) => signal.aborted)).toBe(true);
  });

  it("probes the saved model, records successful tools, and keeps failed authentication typed", async () => {
    const h = await curatedHarness();
    let failAuth = false;
    const receivedModels: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      const req = new Request(input, init);
      if (failAuth) return new Response(standardKey, { status: 401 });
      if (req.method === "GET") return Response.json({ data: [{ id: h.first.model }] });
      const body = (await req.json()) as { model: string; tools?: unknown[] };
      receivedModels.push(body.model);
      if (!body.tools?.length) return sse("OK");
      const event = {
        id: "fixture",
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "echo-fixture",
                  type: "function",
                  function: {
                    name: "echo",
                    arguments: '{"text":"OK"}',
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
          },
        ],
      };
      return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const gateway = new ProviderGateway(
      h.settings,
      h.credentials,
      h.service,
      { now: () => new Date(0), sleep: async () => {} },
      undefined,
      undefined,
      fetcher,
    );
    expect(gateway.modelReference(null, `${h.first.id}/${h.first.model}`)).toBe(
      `${h.first.id}/${h.first.model}`,
    );
    const active = gateway.modelReference(`${h.second.id}/org/verified`, `${h.first.id}/${h.first.model}`);
    expect(gateway.api.capabilities(active)).toMatchObject({ contextWindow: 64000, supportsTools: true });
    expect((await gateway.test(h.first.id)).steps.map((step) => step.status)).toEqual([
      "pass",
      "pass",
      "pass",
      "pass",
    ]);
    expect(receivedModels).toEqual(Array(3).fill(h.first.model));
    expect((await h.service.list()).custom[0]?.supportsTools).toBe(true);
    failAuth = true;
    const denied = await gateway.test(h.first.id);
    expect(denied.steps.map((step) => step.status)).toEqual(["fail", "fail", "skipped", "skipped"]);
    expect(denied.steps[1]?.error?.messageKey).toBe("provider.auth");
    expect(JSON.stringify(denied).includes(standardKey)).toBe(false);
    expect((await h.service.list()).custom[0]?.supportsTools).toBe(true);
  });

  it("rejects an unregistered route before reading a key and refuses inference redirects", async () => {
    const h = await curatedHarness();
    const settings = h.settings.get().settings;
    const ref = `${h.first.id}/${h.first.model}`;
    const read = vi.spyOn(h.credentials, "read");
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      const req = new Request(input, init);
      expect(req.redirect).toBe("error");
      expect(new URL(req.url).pathname).toBe("/standard/inference/chat/completions");
      return Response.redirect("https://fixture.invalid/plus/inference/chat/completions", 307);
    });
    const gateway = createPiAiGateway({
      settings: () => settings,
      credentials: h.credentials,
      presets: plans,
      scrub: (text) => h.credentials.scrub(text),
      now: () => 0,
      fetch: fetcher,
    });
    const run = async () => {
      return collectEvents(
        gateway.stream({
          model: ref,
          system: "fixture",
          tools: [],
          messages: [],
          signal: new AbortController().signal,
        }),
      );
    };
    const config = settings.providers.custom[0]!;
    const original = config.baseUrl;
    config.baseUrl = plans[1]!.bindings[0]!.inference;
    expect(await run()).toMatchObject([{ type: "error", error: { code: "DENIED" } }]);
    expect(read).not.toHaveBeenCalled();
    expect(fetcher).not.toHaveBeenCalled();
    config.baseUrl = original;
    expect((await run()).at(-1)).toMatchObject({ type: "error" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const defaultGateway = createPiAiGateway({
      settings: () => settings,
      credentials: h.credentials,
      scrub: (text) => h.credentials.scrub(text),
      now: () => 0,
    });
    expect(curatedProviderPresets.some(({ id }) => id.startsWith("fixture-"))).toBe(false);
    expect(() => defaultGateway.capabilities(ref)).toThrow();
  });

  it("masks short scoped keys in text and tool deltas across chunk boundaries", async () => {
    const h = await curatedHarness();
    const request = draft();
    const shortKey = "Q7!z";
    await h.service.save({ ...request, id: h.first.id, apiKey: shortKey });
    let includeTool = true;
    const chunks = [
      { delta: { content: "Echo Q7" }, finish_reason: null },
      { delta: { content: "!z." }, finish_reason: null },
      {
        delta: {
          tool_calls: [
            {
              index: 0,
              id: "echo-fixture",
              type: "function",
              function: {
                name: "echo",
                arguments: '{"text":"Q7',
              },
            },
          ],
        },
        finish_reason: null,
      },
      {
        delta: { tool_calls: [{ index: 0, function: { arguments: '!z"}' } }] },
        finish_reason: "tool_calls",
      },
    ];
    const gateway = createPiAiGateway({
      settings: () => h.settings.get().settings,
      credentials: h.credentials,
      presets: plans,
      scrub: (value) => h.credentials.scrub(value),
      knownSecrets: () => h.credentials.knownSecrets(),
      now: () => 0,
      fetch: async () =>
        new Response(
          `${(includeTool
            ? chunks
            : chunks.slice(0, 2).map((chunk, index) => ({
                ...chunk,
                finish_reason: index === 1 ? "stop" : null,
              }))
          )
            .map(
              (chunk) =>
                `data: ${JSON.stringify({
                  id: "fixture",
                  choices: [{ index: 0, ...chunk }],
                })}\n\n`,
            )
            .join("")}data: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        ),
    });
    const run = () =>
      collectEvents(
        gateway.stream({
          model: `${h.first.id}/${h.first.model}`,
          system: "fixture",
          messages: [{ role: "user", content: "OK", timestamp: 0 }],
          tools: [],
          signal: new AbortController().signal,
        }),
      );
    const events = await run();
    const text = events.flatMap((e) => (e.type === "text" ? [e.delta] : [])).join("");
    const tool = events.flatMap((e) => (e.type === "tool" ? [e.delta] : [])).join("");
    expect(text.includes(shortKey)).toBe(false);
    expect(tool.includes(shortKey)).toBe(false);
    expect(text).toBe("Echo [REDACTED].");
    expect(tool).toBe('{"text":"[REDACTED]"}');
    expect(events.at(-1)).toMatchObject({ type: "error", error: { code: "INVALID" } });
    expect(JSON.stringify(events).includes(shortKey)).toBe(false);

    includeTool = false;
    expect((await run()).at(-1)).toMatchObject({
      type: "done",
      message: { content: [expect.objectContaining({ type: "text", text: "Echo [REDACTED]." })] },
    });
  });

  it.each([
    { scenario: "ordinary Boolean argument", key: "e", argument: true, allowed: true },
    { scenario: "numeric credential echo", key: "4192", argument: 4192, allowed: false },
    { scenario: "Boolean credential echo", key: "true", argument: true, allowed: false },
    { scenario: "null credential echo", key: "null", argument: null, allowed: false },
  ])("protects terminal tool calls with a $scenario", async ({ key, argument, allowed }) => {
    const h = await curatedHarness();
    await h.service.save({ ...draft(), id: h.first.id, apiKey: key });
    const event = {
      id: "fixture",
      choices: [
        {
          index: 0,
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "abc",
                type: "function",
                function: {
                  name: "foo",
                  arguments: JSON.stringify({ x: argument }),
                },
              },
            ],
          },
          finish_reason: "tool_calls",
        },
      ],
    };
    const gateway = createPiAiGateway({
      settings: () => h.settings.get().settings,
      credentials: h.credentials,
      presets: plans,
      scrub: (value) => h.credentials.scrub(value),
      now: () => 0,
      fetch: async () =>
        new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`, {
          headers: { "content-type": "text/event-stream" },
        }),
    });
    const events = await collectEvents(
      gateway.stream({
        model: `${h.first.id}/${h.first.model}`,
        system: "fixture",
        messages: [{ role: "user", content: "OK", timestamp: 0 }],
        tools: [{ name: "foo", description: "fixture", parameters: { type: "object" } }],
        signal: new AbortController().signal,
      }),
    );
    if (allowed) {
      expect(events.at(-1)).toMatchObject({
        type: "done",
        message: { content: [{ type: "toolCall", id: "abc", name: "foo", arguments: { x: argument } }] },
      });
    } else {
      expect(events.at(-1)?.type).toBe("error");
      expect(events.at(-1)).toEqual({
        type: "error",
        error: { code: "INVALID", messageKey: "errors.INVALID" },
        aborted: false,
      });
      expect(
        events
          .flatMap((e) => (e.type === "tool" ? [e.delta] : []))
          .join("")
          .includes(key),
      ).toBe(false);
    }
  });

  it("validates the saved profile's effective limits and budgets unrelated profiles independently", async () => {
    const h = await curatedHarness();
    const request = draft();
    const edited = { ...request, id: h.first.id, apiKey: undefined };
    await h.service.save({ ...edited, config: { ...edited.config, maxOutputTokens: 16000 } });
    const gateway = createPiAiGateway({
      settings: () => h.settings.get().settings,
      credentials: h.credentials,
      presets: plans,
      scrub: (value) => h.credentials.scrub(value),
      now: () => 0,
    });
    const partial = `${h.first.id}/org/partial`;
    const manual = `${h.first.id}/${h.first.model}`;
    const before = h.disk.get("/data/settings.json");
    await expect(
      h.service.save({
        ...edited,
        config: { ...edited.config, model: "org/partial", maxOutputTokens: 16000 },
      }),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(h.disk.get("/data/settings.json")).toBe(before);
    expect(gateway.capabilities(manual).maxOutputTokens).toBe(16000);
    const { models } = await gateway.models(h.first.id);
    expect(models).toContainEqual(
      expect.objectContaining({
        reference: partial,
        contextVerified: true,
        contextWindow: 8192,
        maxOutputTokens: 4096,
      }),
    );
    await expect(
      h.service.save({
        ...edited,
        config: { ...edited.config, model: "org/partial", contextWindow: 8192, maxOutputTokens: 2048 },
      }),
    ).resolves.toEqual({ status: "saved" });
    expect(gateway.capabilities(partial)).toMatchObject({ contextWindow: 8192, maxOutputTokens: 2048 });
  });

  it("uses each plan's registered catalog and inference route and classifies model metadata", async () => {
    const h = await curatedHarness();
    const request = { ...draft(1), apiKey: undefined };
    await expect(h.service.save({ ...request, id: h.first.id })).rejects.toMatchObject({ code: "DENIED" });
    await expect(
      h.service.save({
        ...request,
        id: h.second.id,
        config: { ...request.config, baseUrl: "https://fixture.invalid/plus/unregistered" },
      }),
    ).rejects.toMatchObject({ code: "DENIED" });
    const captured: Array<{ path: string; auth: boolean; redirect?: RequestRedirect }> = [];
    const gateway = createPiAiGateway({
      settings: () => h.settings.get().settings,
      credentials: h.credentials,
      presets: plans,
      scrub: (value) => h.credentials.scrub(value),
      now: () => 0,
      fetch: async (input, init) => {
        const req = new Request(input, init);
        const path = new URL(req.url).pathname;
        const expected = path.startsWith("/standard/") ? standardKey : plusKey;
        captured.push({
          path,
          auth: req.headers.get("Authorization") === `Bearer ${expected}`,
          redirect: req.redirect,
        });
        if (req.method === "GET") return Response.json({ data: [{ id: "org/model/remote" }] });
        return sse(expected);
      },
    });
    for (const provider of [h.first, h.second]) {
      const result = await testConnection(gateway, provider.id);
      expect(result.steps.map((s) => s.status)).toEqual(["pass", "pass", "fail", "pass"]);
      const { models } = await gateway.models(provider.id);
      expect(models).toContainEqual(
        expect.objectContaining({
          reference: `${provider.id}/org/manual/model`,
          providerName: provider === h.first ? "Fixture standard" : "Fixture plus",
          inputVerified: false,
        }),
      );
      expect(models).toContainEqual(
        expect.objectContaining({
          reference: `${provider.id}/org/verified`,
          input: ["text", "image"],
          contextWindow: 64000,
          supportsTools: true,
          reasoningOptions: ["low"],
        }),
      );
    }
    expect(captured.map(({ path }) => path)).toEqual([
      "/standard/catalog",
      ...Array(3).fill("/standard/inference/chat/completions"),
      "/plus/catalog",
      ...Array(3).fill("/plus/inference/chat/completions"),
    ]);
    expect(captured.every((entry) => entry.auth && entry.redirect === "error")).toBe(true);
  });
});
