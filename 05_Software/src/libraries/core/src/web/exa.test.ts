// REQ-FUNC-39dc23b2 REQ-FUNC-a0ed7785 REQ-REL-ee363d68 REQ-SEC-6cf2d0e1
import { expect, it, vi } from "vitest";
import * as api from "../index.js";

function mcp(
  reply: (name: string, args: Record<string, unknown>, signal: AbortSignal) => unknown,
  key?: string,
) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const fetch = vi.fn<typeof globalThis.fetch>(async (input, init) => {
    const request = new Request(input, init);
    expect(request.url).toBe("https://mcp.exa.ai/mcp");
    expect(request.redirect).toBe("error");
    expect(request.headers.has("authorization")).toBe(false);
    expect(request.headers.get("x-api-key")).toBe(key ?? null);
    if (request.method === "GET") return new Response(null, { status: 405 });
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    const body = (await request.json()) as {
      id?: number;
      method: string;
      params: {
        capabilities: unknown;
        protocolVersion: string;
        name: string;
        arguments: Record<string, unknown>;
      };
    };
    if (body.id === undefined) return new Response(null, { status: 202 });
    let result: unknown;
    if (body.method === "initialize") {
      expect(body.params.capabilities).toEqual({});
      result = {
        protocolVersion: body.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "fixture", version: "1" },
      };
    } else if (body.method === "tools/list") result = { tools: [] };
    else {
      calls.push({ name: body.params.name, args: body.params.arguments });
      result = await reply(body.params.name, body.params.arguments, request.signal);
      if (result instanceof Response) return result;
    }
    return Response.json({ jsonrpc: "2.0", id: body.id, result });
  });
  return { calls, fetch };
}
const text = (value: string) => ({ content: [{ type: "text", text: value }] });
const source =
  "Title: Reliable source\nURL: https://example.com/docs\nPublished: N/A\nAuthor: N/A\nHighlights:\nUseful facts.";

it("sends an explicit API key only in the fixed-endpoint header", async () => {
  const key = "exa-header-fixture-key-012345";
  const fixture = mcp(() => text(source), key);
  const result = await new api.ExaWebProvider({ fetch: fixture.fetch, apiKey: key }).search(
    { query: "public topic" },
    new AbortController().signal,
  );
  expect(JSON.stringify(result)).not.toContain(key);
  expect(JSON.stringify(fixture.calls)).not.toContain(key);
});

it("searches anonymously and normalizes Exa source blocks with bounded content", async () => {
  expect(api.ExaWebProvider).toBeTypeOf("function");
  const fixture = mcp(() =>
    text(`${source}\n\n---\n\nTitle: Second\nURL: https://example.org/\nHighlights:\n${"x".repeat(9000)}`),
  );
  const provider = new api.ExaWebProvider({
    fetch: fixture.fetch,
    now: () => new Date("2026-10-30T12:00:00Z"),
  });
  const result = await provider.search({ query: "general topic", limit: 2 }, new AbortController().signal);
  expect(fixture.calls).toEqual([
    {
      name: "web_search_exa",
      args: { query: "general topic", objective: expect.any(String), numResults: 2 },
    },
  ]);
  expect(result).toMatchObject({
    provider: "exa",
    retrievedAt: "2026-10-30T12:00:00.000Z",
    truncated: true,
    sources: [
      { title: "Reliable source", url: "https://example.com/docs", content: "Useful facts." },
      { title: "Second" },
    ],
  });
  expect(result.sources[1]!.content.length).toBeLessThanOrEqual(3500);
});

it("reads one public page through MCP and supports a different provider behind the same tools", async () => {
  expect(api.ExaWebProvider).toBeTypeOf("function");
  const fixture = mcp(() => text("# Example\nURL: https://example.com/\n\nPublic page."));
  const provider = new api.ExaWebProvider({ fetch: fixture.fetch });
  const result = await provider.read(
    { url: "https://example.com/", maxCharacters: 1000 },
    new AbortController().signal,
  );
  expect(fixture.calls[0]).toEqual({
    name: "web_fetch_exa",
    args: { urls: ["https://example.com/"], maxCharacters: 1000 },
  });
  expect(result.sources[0]).toMatchObject({ url: "https://example.com/", content: "Public page." });
  const ctx = api.createToolContext("unused");
  ctx.web = { search: vi.fn().mockResolvedValue(result), read: vi.fn().mockResolvedValue(result) };
  const registry = new api.ToolRegistry();
  expect(
    (await registry.execute(ctx, "web_search", { query: "topic" }, new AbortController().signal)).isError,
  ).toBe(false);
  expect(ctx.web.search).toHaveBeenCalledOnce();
  await registry.execute(ctx, "web_search", { query: "topic" }, new AbortController().signal, ["web_search"]);
  expect(ctx.web.search).toHaveBeenCalledOnce();
});

it.each([
  "http://127.0.0.1/a",
  "http://192.168.1.2/",
  "http://[::1]/",
  "http://[::ffff:127.0.0.1]/",
  "http://localhost/",
  "https://router.local/",
  "https://user:pass@example.com/",
  "file:///secret",
  "https://singlehost/",
])("rejects nonpublic URL %s before provider contact", async (url) => {
  expect(api.ExaWebProvider).toBeTypeOf("function");
  const fixture = mcp(() => text(source));
  await expect(
    new api.ExaWebProvider({ fetch: fixture.fetch }).read({ url }, new AbortController().signal),
  ).rejects.toThrow(/public HTTP/);
  expect(fixture.fetch).not.toHaveBeenCalled();
});

it.each([402, 429, 401, 503])(
  "handles HTTP %s without exposing remote details and can retry",
  async (status) => {
    expect(api.ExaWebProvider).toBeTypeOf("function");
    let fail = true;
    const fixture = mcp(() => (fail ? new Response("sensitive remote details", { status }) : text(source)));
    const provider = new api.ExaWebProvider({ fetch: fixture.fetch });
    const error = await provider
      .search({ query: "topic" }, new AbortController().signal)
      .catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String(error)).not.toContain("sensitive");
    expect(String(error)).toMatch(
      status === 402 || status === 429 ? /limit/i : status === 401 ? /authentication/i : /unavailable/i,
    );
    fail = false;
    expect((await provider.search({ query: "retry" }, new AbortController().signal)).sources).toHaveLength(1);
  },
);

it("bounds oversized and malformed responses and provider tool failures", async () => {
  expect(api.ExaWebProvider).toBeTypeOf("function");
  for (const response of [
    new Response("x".repeat(1048577), { headers: { "Content-Type": "text/event-stream" } }),
    text("unparseable"),
    { ...text("remote error"), isError: true },
  ]) {
    const fixture = mcp(() => response);
    await expect(
      new api.ExaWebProvider({ fetch: fixture.fetch }).search(
        { query: "topic" },
        new AbortController().signal,
      ),
    ).rejects.toThrow(/response|unavailable|could not complete/i);
  }
});

it("settles cancellation and a total deadline without retaining in-flight transport", async () => {
  expect(api.ExaWebProvider).toBeTypeOf("function");
  const aborted = vi.fn();
  const fixture = mcp(
    (_name, _args, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => {
            aborted();
            reject(signal.reason);
          },
          { once: true },
        );
      }),
  );
  const provider = new api.ExaWebProvider({ fetch: fixture.fetch, timeoutMs: 80 });
  await expect(provider.search({ query: "deadline" }, new AbortController().signal)).rejects.toThrow(
    /timed out/i,
  );
  const controller = new AbortController();
  const pending = provider.search({ query: "cancel" }, controller.signal);
  await vi.waitFor(() => expect(fixture.calls).toHaveLength(2));
  controller.abort();
  await expect(pending).rejects.toThrow(/cancel/i);
  expect(aborted).toHaveBeenCalledTimes(2);
});

it("cancels initialization before any tool call and rejects redirects", async () => {
  const controller = new AbortController();
  const stalled = vi.fn<typeof fetch>(
    (_input, init) =>
      new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => reject(init!.signal!.reason), { once: true });
      }),
  );
  const pending = new api.ExaWebProvider({ fetch: stalled }).search({ query: "topic" }, controller.signal);
  await vi.waitFor(() => expect(stalled).toHaveBeenCalledOnce());
  controller.abort();
  await expect(pending).rejects.toThrow(/cancel/i);
  const redirect = vi.fn<typeof fetch>(async (_input, init) => {
    expect(init?.redirect).toBe("error");
    return new Response(null, { status: 302, headers: { location: "https://other.example/" } });
  });
  await expect(
    new api.ExaWebProvider({ fetch: redirect }).search({ query: "topic" }, new AbortController().signal),
  ).rejects.toThrow(/unavailable/);
  expect(redirect).toHaveBeenCalledOnce();
});
