import { existsSync } from "node:fs";
import { beforeAll, expect, it, vi } from "vitest";

let Tavily: typeof import("./tavily.js").TavilyWebProvider;
let Brave: typeof import("./brave.js").BraveWebProvider;
beforeAll(async () => {
  expect(existsSync(new URL("./tavily.ts", import.meta.url)), "Tavily adapter exists").toBe(true);
  ({ TavilyWebProvider: Tavily } = await import("./tavily.js"));
  ({ BraveWebProvider: Brave } = await import("./brave.js"));
});
const signal = () => new AbortController().signal;
const reply = (body: unknown) => new Response(JSON.stringify(body));
it("Tavily keyless search/extract normalize public sources and bound content", async () => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(
      reply({
        results: [
          { title: "Board", url: "https://example.com/board", content: "x".repeat(4000) },
          { title: "private", url: "http://127.0.0.1/", content: "private" },
        ],
      }),
    )
    .mockResolvedValueOnce(
      reply({ results: [{ url: "https://example.com/board", raw_content: "y".repeat(100) }] }),
    );
  const p = new Tavily({ fetch: f });
  expect(await p.search({ query: "board", limit: 1 }, signal())).toMatchObject({
    provider: "tavily",
    sources: [{ title: "Board", content: "x".repeat(3500) }],
    truncated: true,
  });
  const [url, init] = f.mock.calls[0]!;
  expect(String(url)).toBe("https://api.tavily.com/search");
  expect(new Headers(init.headers).get("X-Tavily-Access-Mode")).toBe("keyless");
  expect(new Headers(init.headers).has("authorization")).toBe(false);
  expect(init.redirect).toBe("error");
  expect(await p.read({ url: "https://example.com/board", maxCharacters: 80 }, signal())).toMatchObject({
    sources: [{ content: "y".repeat(80) }],
    truncated: true,
  });
});
it("Tavily key never enters URL/body and private reads are rejected before egress", async () => {
  const f = vi
    .fn()
    .mockResolvedValue(reply({ results: [{ title: "ok", url: "https://example.com", content: "public" }] }));
  const p = new Tavily({ apiKey: "owned-private-key", fetch: f });
  await p.search({ query: "topic" }, signal());
  const [url, init] = f.mock.calls[0]!;
  expect(new Headers(init.headers).get("authorization")).toBe("Bearer owned-private-key");
  expect(new Headers(init.headers).has("X-Tavily-Access-Mode")).toBe(false);
  expect(String(url) + init.body).not.toContain("owned-private-key");
  await expect(p.read({ url: "http://192.168.1.13/" }, signal())).rejects.toThrow();
  expect(f).toHaveBeenCalledOnce();
});
it("Tavily extracts the page without its fragment and cites the original section", async () => {
  const page = "https://example.com/guide?q=%23";
  const url = `${page}#pins`;
  const f = vi
    .fn()
    .mockResolvedValueOnce(reply({ results: [{ url: page, raw_content: "Pin table" }] }))
    .mockResolvedValueOnce(
      reply({ results: [{ url: "https://example.com/other#pins", raw_content: "Other" }] }),
    );
  const provider = new Tavily({ fetch: f });
  expect(await provider.read({ url }, signal())).toMatchObject({
    sources: [{ url, content: "Pin table" }],
  });
  expect(JSON.parse(f.mock.calls[0]?.[1]?.body)).toMatchObject({ urls: [page] });
  await expect(provider.read({ url }, signal())).rejects.toThrow(/could not extract the requested page/);
});
it("Tavily reads a long document in windows, although its whole text is above 1 MiB", async () => {
  const text = `${"p".repeat(1_500_000)}END`;
  const f = vi.fn(async () => reply({ results: [{ url: "https://example.com/rm.pdf", raw_content: text }] }));
  const provider = new Tavily({ fetch: f });
  const first = await provider.read({ url: "https://example.com/rm.pdf", maxCharacters: 2000 }, signal());
  expect(first).toMatchObject({ truncated: true, nextOffset: 2000, totalCharacters: 1_500_003 });
  expect(first.sources[0]?.content).toHaveLength(2000);
  const last = await provider.read(
    { url: "https://example.com/rm.pdf", maxCharacters: 2000, offset: 1_499_990 },
    signal(),
  );
  expect(last.sources[0]?.content).toBe(`${"p".repeat(10)}END`);
  expect(last.truncated).toBe(false);
  expect(last).not.toHaveProperty("nextOffset");
  // A search reply keeps the 1 MiB limit.
  f.mockResolvedValueOnce(new Response(new Uint8Array(1048577)));
  await expect(provider.search({ query: "topic" }, signal())).rejects.toThrow(/size limit/);
});
it("Brave normalizes search snippets and rejects unsupported reading and long queries locally", async () => {
  const f = vi.fn().mockResolvedValue(
    reply({
      web: {
        results: [
          {
            title: "Board",
            url: "https://example.com",
            description: "specification",
            extra_snippets: ["additional"],
          },
        ],
      },
    }),
  );
  const p = new Brave({ apiKey: "owned-brave-key", fetch: f });
  expect(await p.search({ query: "board" }, signal())).toMatchObject({
    provider: "brave",
    sources: [{ content: "specification\nadditional" }],
  });
  const [url, init] = f.mock.calls[0]!;
  expect(new URL(String(url)).origin).toBe("https://api.search.brave.com");
  expect(new Headers(init.headers).get("X-Subscription-Token")).toBe("owned-brave-key");
  expect(String(url)).not.toContain("owned-brave-key");
  await expect(p.read({ url: "https://example.com" }, signal())).rejects.toThrow(/not support.*reading/i);
  await expect(p.search({ query: "x".repeat(401) }, signal())).rejects.toThrow(/400/);
  expect(f).toHaveBeenCalledOnce();
});
it.each([401, 429, 500, 302])("rejects HTTP%s safely then recovers", async (status) => {
  const f = vi
    .fn()
    .mockResolvedValueOnce(new Response("sensitive-provider-detail", { status }))
    .mockResolvedValueOnce(reply({ results: [{ url: "https://example.com", title: "ok", content: "ok" }] }));
  const p = new Tavily({ fetch: f });
  await expect(p.search({ query: "topic" }, signal())).rejects.not.toThrow(/sensitive-provider-detail/);
  expect((await p.search({ query: "topic" }, signal())).sources).toHaveLength(1);
});
it("names an API key as the way past the limit of access without one", async () => {
  const limited = () => vi.fn().mockResolvedValue(new Response(null, { status: 429 }));
  await expect(new Tavily({ fetch: limited() }).search({ query: "topic" }, signal())).rejects.toThrow(
    /without an API key.*add an API key/,
  );
  await expect(
    new Tavily({ fetch: limited(), apiKey: "owned-private-key" }).search({ query: "topic" }, signal()),
  ).rejects.toThrow(/account quota/);
});
it("rejects oversized/malformed/private-only replies and cancels hanging body reads", async () => {
  for (const response of [
    new Response(new Uint8Array(1048577)),
    new Response("{}", { headers: { "content-length": "1048577" } }),
    new Response("not json"),
    reply({ results: [{ url: "http://localhost", title: "bad", content: "bad" }] }),
  ]) {
    await expect(
      new Tavily({ fetch: vi.fn().mockResolvedValue(response) }).search({ query: "topic" }, signal()),
    ).rejects.toThrow();
  }
  const cancel = vi.fn();
  const stream = new ReadableStream({ cancel });
  await expect(
    new Tavily({ fetch: vi.fn().mockResolvedValue(new Response(stream)), timeoutMs: 20 }).search(
      { query: "topic" },
      signal(),
    ),
  ).rejects.toThrow(/timed out/i);
  expect(cancel).toHaveBeenCalled();
});

it("caller abort prevents egress and cancels a pending body", async () => {
  const f = vi.fn();
  const caller = new AbortController();
  caller.abort();
  await expect(new Tavily({ fetch: f }).search({ query: "board" }, caller.signal)).rejects.toThrow(
    /cancelled/,
  );
  expect(f).not.toHaveBeenCalled();
  const cancel = vi.fn();
  const active = new AbortController();
  const pending = new Tavily({
    fetch: vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))),
  }).search({ query: "board" }, active.signal);
  await vi.waitFor(() => expect(active.signal.aborted).toBe(false));
  active.abort();
  await expect(pending).rejects.toThrow(/cancelled/);
  expect(cancel).toHaveBeenCalled();
});
