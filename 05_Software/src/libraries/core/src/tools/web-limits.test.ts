// REQ-FUNC-b1a2db33 REQ-FUNC-9455436f REQ-FUNC-5e129df5
import { defaultSettings } from "@vera/shared";
import { expect, it, vi } from "vitest";
import * as api from "../index.js";
import type { WebProvider, WebResult } from "../web/provider.js";
import { webReadTool, webSearchTool } from "./web.js";

const result: WebResult = {
  provider: "fixture",
  sources: [],
  truncated: false,
  retrievedAt: "2026-11-21T00:00:00.000Z",
};
function context(limits: Record<string, number>) {
  const web = {
    search: vi.fn(async (_request: unknown) => result),
    read: vi.fn(async (_request: unknown) => result),
  };
  const ctx = {
    ...api.createToolContext("unused"),
    web: web as unknown as WebProvider,
    advanced: ((key: string) => limits[key]) as never,
  };
  return { ctx, web };
}
const signal = () => new AbortController().signal;

it("sends the session's Web search results when no limit is given and caps a larger one", async () => {
  const { ctx, web } = context({ webSearchResults: 3 });
  await webSearchTool.execute(ctx, { query: "ldo" }, signal());
  await webSearchTool.execute(ctx, { query: "ldo", limit: 8 }, signal());
  await webSearchTool.execute(ctx, { query: "ldo", limit: 2 }, signal());
  expect(web.search.mock.calls.map(([request]) => (request as { limit: number }).limit)).toEqual([3, 3, 2]);
});

it("sends the session's Web read size when none is given and caps a larger one", async () => {
  const { ctx, web } = context({ webReadChars: 4000 });
  const url = "https://example.com/datasheet";
  await webReadTool.execute(ctx, { url }, signal());
  await webReadTool.execute(ctx, { url, maxCharacters: 16000 }, signal());
  await webReadTool.execute(ctx, { url, maxCharacters: 2000 }, signal());
  expect(
    web.read.mock.calls.map(([request]) => (request as { maxCharacters: number }).maxCharacters),
  ).toEqual([4000, 4000, 2000]);
});

it("applies raised web limits through the tool registry when the model gives no value", async () => {
  const { ctx, web } = context({ webSearchResults: 8, webReadChars: 16000 });
  const registry = new api.ToolRegistry();
  expect(await registry.execute(ctx, "web_search", { query: "ldo" }, signal())).toMatchObject({
    isError: false,
  });
  expect(
    await registry.execute(ctx, "web_read", { url: "https://example.com/datasheet" }, signal()),
  ).toMatchObject({ isError: false });
  expect(web.search).toHaveBeenCalledWith(expect.objectContaining({ limit: 8 }), expect.anything());
  expect(web.read).toHaveBeenCalledWith(expect.objectContaining({ maxCharacters: 16000 }), expect.anything());
});

it("creates the web provider client with the host's Web request timeout", async () => {
  const settings = defaultSettings("00000000-0000-4000-8000-000000000001").webAccess;
  let timeout = 90_000;
  const create = vi.fn((_provider: string, _key: string | undefined, _options?: { timeoutMs?: number }) => ({
    search: async () => result,
    read: async () => result,
  }));
  const provider = new api.ConfiguredWebProvider({
    config: () => ({ ...settings, enabled: true, provider: "exa", authentication: "anonymous" }),
    getKey: async () => undefined,
    create: create as never,
    timeoutMs: () => timeout,
  });
  await provider.search({ query: "ldo", limit: 1 }, signal());
  timeout = 20_000;
  await provider.read({ url: "https://example.com/", maxCharacters: 1000 }, signal());
  expect(create.mock.calls.map((call) => call[2])).toEqual([{ timeoutMs: 90_000 }, { timeoutMs: 20_000 }]);
});

it("shortens search excerpts before removing citations", async () => {
  const { ctx, web } = context({ webSearchResults: 8, toolResultChars: 8000 });
  const sources = Array.from({ length: 8 }, (_, index) => ({
    title: `Result ${index}`,
    url: `https://example.com/page-${index}`,
    content: "Search excerpt. ".repeat(200),
  }));
  web.search.mockResolvedValueOnce({ ...result, sources });
  const output = await new api.ToolRegistry().execute(
    ctx,
    "web_search",
    { query: "public manual" },
    signal(),
  );
  expect(output).toMatchObject({ isError: false, truncated: true });
  expect(output.text.length).toBeLessThanOrEqual(8000);
  const read = JSON.parse(output.text) as WebResult;
  expect(read.sources).toEqual(
    sources.map(({ url, title }) => ({ url, title, content: expect.stringMatching(/^Search excerpt/) })),
  );
});

it("keeps the source and a readable prefix when JSON escaping pushes a page over the cap", async () => {
  const { ctx, web } = context({ webReadChars: 12000, toolResultChars: 8000 });
  const source = {
    title: "Manual",
    url: "https://example.com/manual#specs",
    content: '"\\\n😀'.repeat(1600),
  };
  web.read.mockResolvedValueOnce({ ...result, sources: [source] });
  const output = await new api.ToolRegistry().execute(ctx, "web_read", { url: source.url }, signal());
  expect(output).toMatchObject({ isError: false, truncated: true });
  expect(output.text.length).toBeLessThanOrEqual(8000);
  const read = JSON.parse(output.text) as WebResult;
  expect(read.sources).toMatchObject([{ url: source.url, title: source.title, content: expect.any(String) }]);
  const excerpt = read.sources[0]?.content ?? "";
  expect(excerpt.length).toBeGreaterThan(0);
  expect(excerpt.length).toBeLessThan(source.content.length);
  expect(source.content.startsWith(excerpt)).toBe(true);
  expect(excerpt).not.toMatch(/[\uD800-\uDBFF]$/);
  // The page ended in this window, yet the shortened result still says where the kept text stops.
  expect(read.nextOffset).toBe(excerpt.length);
});

it("passes the offset to the provider and continues a shortened window from the text it kept", async () => {
  const { ctx, web } = context({ webReadChars: 12000, toolResultChars: 8000 });
  const url = "https://example.com/reference.pdf";
  const window = { ...result, sources: [{ title: "Reference", url, content: "r".repeat(12000) }] };
  web.read.mockResolvedValueOnce({ ...window, truncated: true, nextOffset: 52000, totalCharacters: 900000 });
  const output = await new api.ToolRegistry().execute(ctx, "web_read", { url, offset: 40000 }, signal());
  expect(web.read).toHaveBeenCalledWith(expect.objectContaining({ offset: 40000 }), expect.anything());
  const read = JSON.parse(output.text) as WebResult & { offset: number };
  const kept = read.sources[0]?.content.length ?? 0;
  expect(kept).toBeLessThan(12000);
  expect(read).toMatchObject({ offset: 40000, nextOffset: 40000 + kept, totalCharacters: 900000 });
  // A window that fits keeps the provider's position.
  const whole = { ...window, sources: [{ title: "Reference", url, content: "r".repeat(2000) }] };
  web.read.mockResolvedValueOnce({ ...whole, truncated: true, nextOffset: 2000, totalCharacters: 900000 });
  const fits = await new api.ToolRegistry().execute(ctx, "web_read", { url, maxCharacters: 2000 }, signal());
  expect(JSON.parse(fits.text)).toMatchObject({ nextOffset: 2000, totalCharacters: 900000 });
  expect(JSON.parse(fits.text)).not.toHaveProperty("offset");
});
