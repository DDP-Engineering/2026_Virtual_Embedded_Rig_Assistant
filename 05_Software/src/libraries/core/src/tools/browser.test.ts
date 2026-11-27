import { resolveAdvanced } from "@vera/shared";
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

it("shortens a browser snapshot without changing its citation or link references", async () => {
  const limit = 8000;
  const url = `https://example.com/page?q=${"a".repeat(4000)}#section`;
  const snapshotId = "86e53436-6f65-4480-9baa-c66e5ec2ba55";
  const links = Array.from({ length: 24 }, (_, index) => ({
    ref: `${snapshotId}:${index + 1}`,
    label: "Reference label ".repeat(9).trim(),
  }));
  const text = "Readable text. ".repeat(265).trim();
  const ctx: ToolContext = {
    ...createToolContext("."),
    advanced: (key) => resolveAdvanced(key, { app: { toolResultChars: limit } }).value,
    browser: {
      available: () => true,
      execute: async () => ({
        tabId: "2299cb15-06a8-432c-968a-1eb7e296eb5f",
        url,
        title: "Reference page",
        text,
        snapshotId,
        links,
        truncated: false,
        contentTrust: "untrusted-web-content",
      }),
    },
  };
  const out = await new ToolRegistry().execute(ctx, "browser_snapshot", {}, new AbortController().signal);
  expect(out).toMatchObject({ truncated: true, isError: false });
  expect(out.text.length).toBeLessThanOrEqual(limit);
  const snapshot = JSON.parse(out.text);
  expect(snapshot).toMatchObject({ url, snapshotId, contentTrust: "untrusted-web-content" });
  expect(snapshot.text).toContain("Readable text.");
  expect(snapshot.links.length).toBeGreaterThan(0);
  expect(snapshot.links).toEqual(links.slice(0, snapshot.links.length));
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
