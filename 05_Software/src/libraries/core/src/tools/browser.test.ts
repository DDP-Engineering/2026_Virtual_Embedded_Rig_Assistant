import { expect, it, vi } from "vitest";
import { createToolContext, type ToolContext } from "./context.js";
import { ToolRegistry } from "./registry.js";

it("binds browser tools only for an authorized session and rechecks live tool permission", async () => {
  let granted = false;
  let disabled = false;
  const execute = vi.fn(async () => ({ url: "https://example.com/" }));
  const ctx = Object.assign(createToolContext("."), {
    browser: { available: () => granted && !disabled, execute },
  }) as ToolContext;
  const registry = new ToolRegistry();
  const signal = new AbortController().signal;
  expect(registry.bind(ctx).some(({ name }) => name.startsWith("browser_"))).toBe(false);
  granted = true;
  const open = registry.bind(ctx).find(({ name }) => name === "browser_open");
  expect(open).toBeDefined();
  await expect(open?.execute({ url: "https://example.com/" }, signal)).resolves.toContain(
    "https://example.com/",
  );
  expect(execute).toHaveBeenCalledTimes(1);
  disabled = true;
  expect(open?.available?.()).toBe(false);
  await expect(open?.execute({ url: "https://example.com/" }, signal)).rejects.toThrow("unavailable");
  expect(execute).toHaveBeenCalledTimes(1);
});

it("keeps search, static reading and managed downloads available after browser close", async () => {
  let granted = true;
  const source = { title: "Public source", url: "https://example.com/", content: "Independent tool" };
  const webResult = {
    provider: "fixture",
    retrievedAt: "2026-11-20T00:00:00Z",
    sources: [source],
    truncated: false,
  };
  const ctx: ToolContext = {
    ...createToolContext("."),
    web: { search: vi.fn(async () => webResult), read: vi.fn(async () => webResult) },
    browser: {
      available: () => granted,
      async execute() {
        granted = false;
        return { closed: true };
      },
    },
  };
  const registry = new ToolRegistry();
  const signal = new AbortController().signal;
  const close = registry.bind(ctx).find((tool) => tool.name === "browser_close");
  await expect(close?.execute({}, signal)).resolves.toBe('{"closed":true}');
  expect(close?.publish?.({}, '{"closed":true}')).toBe('{"closed":true}');
  expect(registry.bind(ctx).map((tool) => tool.name)).toContain("web_download");
  await expect(registry.execute(ctx, "web_search", { query: "source" }, signal)).resolves.toMatchObject({
    isError: false,
    text: expect.stringContaining(source.url),
  });
  await expect(registry.execute(ctx, "web_read", { url: source.url }, signal)).resolves.toMatchObject({
    isError: false,
    text: expect.stringContaining(source.content),
  });
});
