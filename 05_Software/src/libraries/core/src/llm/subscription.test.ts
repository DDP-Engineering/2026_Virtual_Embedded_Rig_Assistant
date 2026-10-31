import { defaultSettings } from "@vera/shared";
import { describe, expect, it } from "vitest";
import type { Credential, CredentialStore } from "../ports.js";
import { createCollections, createPiAiGateway } from "./providers.js";
import { scrub } from "./scrub.js";

function store() {
  const entries = new Map<string, Credential>();
  const credentials: CredentialStore = {
    read: async (id) => entries.get(id),
    list: async () => [...entries].map(([providerId, c]) => ({ providerId, type: c.type })),
    modify: async (id, fn) => {
      const c = await fn(entries.get(id));
      if (c) entries.set(id, c);
      return entries.get(id);
    },
    delete: async (id) => {
      entries.delete(id);
    },
  };
  return { credentials, entries };
}
describe("ChatGPT subscription collection", () => {
  it("streams with subscription auth only and redacts access/refresh across deltas and failures", async () => {
    const h = store();
    const access = "fictional-WP21-access-private",
      refresh = "fictional-WP21-refresh-private";
    h.entries.set("chatgpt", { type: "oauth", access, refresh, expires: Date.now() + 600000 });
    h.entries.set("openai", { type: "api_key", key: "fictional-api-not-used" });
    const settings = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
    let captured: Headers | undefined;
    const item = {
      type: "message",
      id: "msg-fake",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: access + refresh + " OK", annotations: [] }],
    };
    const events = [
      { type: "response.created", response: { id: "resp-fake" } },
      { type: "response.output_item.added", output_index: 0, item: { ...item, content: [] } },
      { type: "response.output_text.delta", output_index: 0, delta: access.slice(0, 11) },
      { type: "response.output_text.delta", output_index: 0, delta: access.slice(11) + refresh + " OK" },
      { type: "response.output_item.done", output_index: 0, item },
      {
        type: "response.completed",
        response: {
          id: "resp-fake",
          status: "completed",
          output: [item],
          usage: { input_tokens: 3, output_tokens: 4, total_tokens: 7 },
        },
      },
    ];
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input) === "https://api.openai.com/v1/models")
        return Response.json({
          models: [
            {
              slug: "gpt-4.1",
              display_name: "GPT-4.1",
              visibility: "list",
              context_window: 1047576,
              supported_reasoning_levels: [],
            },
          ],
        });
      captured = new Headers(init?.headers);
      return new Response(events.map((e) => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
        headers: { "content-type": "text/event-stream" },
      });
    };
    const g = createPiAiGateway({
      settings: () => settings,
      credentials: h.credentials,
      scrub: (t) => scrub(t, [access, refresh]),
      knownSecrets: () => [access, refresh],
      now: () => 0,
      fetch: fetcher,
    });
    const output = [];
    for await (const e of g.stream({
      model: "chatgpt/gpt-4.1",
      system: "test",
      messages: [{ role: "user", content: "hi", timestamp: 0 }],
      tools: [],
      signal: new AbortController().signal,
    }))
      output.push(e);
    expect(captured?.get("authorization")).toBe(`Bearer ${access}`);
    expect(output.at(-1)?.type).toBe("done");
    expect(JSON.stringify(output)).not.toContain(access);
    expect(JSON.stringify(output)).not.toContain(refresh);
    expect(JSON.stringify(output)).toContain("OK");
    const failed = createPiAiGateway({
      settings: () => settings,
      credentials: h.credentials,
      scrub: (t) => scrub(t, [access, refresh]),
      now: () => 0,
      fetch: async () =>
        new Response(JSON.stringify({ error: { message: access + refresh } }), {
          status: 401,
          headers: { "content-type": "application/json" },
        }),
    });
    const errors = [];
    for await (const e of failed.stream({
      model: "chatgpt/gpt-4.1",
      system: "test",
      messages: [],
      tools: [],
      signal: new AbortController().signal,
    }))
      errors.push(e);
    expect(JSON.stringify(errors)).not.toContain(access);
    expect(JSON.stringify(errors)).not.toContain(refresh);
    expect(errors.at(-1)).toMatchObject({ type: "error", error: { code: "PROVIDER" } });
  });
  it("does not fall back to API or ambient credentials when subscription is absent", async () => {
    const h = store();
    h.entries.set("openai", { type: "api_key", key: "fake-api" });
    const collections = createCollections(h.credentials);
    expect(await collections.subscription.getAuth("openai")).toBeUndefined();
    const g = createPiAiGateway({
      settings: () => defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
      credentials: h.credentials,
      scrub: (t) => t,
      now: () => 0,
    });
    await expect(g.models("chatgpt")).rejects.toMatchObject({ code: "PROVIDER" });
  });
  it("registers OpenAI in a separate subscription with chatgpt slot", async () => {
    const h = store();
    h.entries.set("openai", { type: "api_key", key: "fake-api" });
    h.entries.set("chatgpt", {
      type: "oauth",
      access: "fake-access",
      refresh: "fake-refresh",
      expires: Date.now() + 600000,
    });
    const c = createCollections(h.credentials);
    expect(c.subscription.getModels("openai").length).toBeGreaterThan(0);
    expect((await c.api.getAuth("openai"))?.auth.apiKey).toBe("fake-api");
    expect((await c.subscription.getAuth("openai"))?.auth.apiKey).toBe("fake-access");
  });
  it("catalogs subscription references and resolves fresh budgets", async () => {
    const h = store();
    h.entries.set("chatgpt", {
      type: "oauth",
      access: "fake-access",
      refresh: "fake-refresh",
      expires: Date.now() + 600000,
    });
    const settings = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
    const g = createPiAiGateway({
      settings: () => settings,
      credentials: h.credentials,
      scrub: (t) => t,
      now: () => 0,
      fetch: async () =>
        Response.json({
          models: [
            {
              slug: "gpt-4.1",
              display_name: "GPT-4.1",
              visibility: "list",
              context_window: 1047576,
              supported_reasoning_levels: [],
            },
          ],
        }),
    });
    const catalog = await g.models("chatgpt");
    expect(catalog.models.length).toBeGreaterThan(0);
    const m = catalog.models[0];
    if (!m) throw Error("Missing model");
    expect(m.reference).toBe(`chatgpt/${m.id}`);
    expect(g.capabilities(m.reference).inputBudget).toBe(m.inputBudget);
  });
});
