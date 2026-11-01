import { defaultSettings, providerDiscoveryRequestSchema } from "@vera/shared";
import { expect, it, vi } from "vitest";
import { discoverProvider } from "./provider-discovery.js";

const body = {
  models: [
    {
      type: "llm",
      key: "qwen/test",
      display_name: "Qwen test",
      max_context_length: 262144,
      loaded_instances: [{ config: { context_length: 65536 } }],
      capabilities: {
        trained_for_tool_use: true,
        reasoning: { allowed_options: ["off", "on", "low", "xhigh"], default: "xhigh" },
      },
    },
    {
      type: "embedding",
      key: "embedding",
      display_name: "Embedding",
      max_context_length: 512,
      loaded_instances: [],
    },
  ],
};
function host() {
  const settings = defaultSettings("00000000-0000-4000-8000-000000000001");
  const credentials = {
    registerSecret: vi.fn(),
    read: vi.fn(async () => ({ type: "api_key" as const, key: "private-key" })),
    containsSecret: vi.fn((value: unknown) => JSON.stringify(value).includes("private-key")),
  };
  const fetch = vi.fn(async () => Response.json(body));
  return { settings: { get: () => ({ settings }) }, credentials, fetch };
}
it("discovers current LM Studio metadata without inference, persisting keys or returning embeddings", async () => {
  const h = host();
  const result = await discoverProvider({ endpoint: "http://127.0.0.1:1234", apiKey: "private-key" }, h);
  expect(h.fetch).toHaveBeenCalledWith(
    "http://127.0.0.1:1234/api/v1/models",
    expect.objectContaining({ redirect: "error", headers: { Authorization: "Bearer private-key" } }),
  );
  expect(h.credentials.registerSecret).toHaveBeenCalledWith("private-key");
  expect(result.baseUrl).toBe("http://127.0.0.1:1234/v1");
  expect(result.models).toHaveLength(1);
  expect(result.models[0]).toMatchObject({
    id: "qwen/test",
    maxContextWindow: 262144,
    loadedContextWindow: 65536,
    reasoningOptions: ["off", "on", "low", "xhigh"],
  });
  expect(JSON.stringify(result)).not.toContain("private-key");
});
it("never forwards a saved key to a changed endpoint", async () => {
  const h = host();
  h.settings.get().settings.providers.custom.push({
    name: "Local",
    slug: "local",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "qwen/test",
    contextWindow: 65536,
    maxOutputTokens: 4096,
  });
  await expect(
    discoverProvider({ endpoint: "http://127.0.0.1:4321", savedId: "custom:local" }, h),
  ).rejects.toMatchObject({ code: "DENIED" });
  expect(h.credentials.read).not.toHaveBeenCalled();
  expect(h.fetch).not.toHaveBeenCalled();
  await discoverProvider({ endpoint: "http://127.0.0.1:1234/v1", savedId: "custom:local" }, h);
  expect(h.credentials.read).toHaveBeenCalledWith("custom:local");
});
it.each([
  [401, "DENIED"],
  [404, "NOT_FOUND"],
  [500, "PROVIDER"],
])("reports HTTP %i without leaking response bodies", async (status, code) => {
  const h = host();
  h.fetch.mockImplementation(async () => new Response("private-key", { status: Number(status) }));
  await expect(discoverProvider({ endpoint: "http://localhost:1234" }, h)).rejects.toMatchObject({ code });
});
it("rejects invalid/oversized responses and endpoints with credentials, queries or unrelated paths", async () => {
  for (const endpoint of [
    "http://user:password@localhost:1234",
    "http://localhost:1234/?key=secret",
    "http://localhost:1234/api",
    "file:///models",
  ])
    expect(providerDiscoveryRequestSchema.safeParse({ endpoint }).success).toBe(false);
  for (const response of [
    Response.json({ models: [{ ...body.models[0], key: "private-key" }] }),
    new Response("x".repeat(2 * 1024 * 1024 + 1)),
    Response.json({ models: "wrong" }),
  ]) {
    const h = host();
    h.fetch.mockImplementation(async () => response);
    await expect(discoverProvider({ endpoint: "http://localhost:1234" }, h)).rejects.toBeDefined();
  }
});
