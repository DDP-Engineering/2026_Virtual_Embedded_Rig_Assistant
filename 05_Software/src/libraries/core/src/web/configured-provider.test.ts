import { expect, it, vi } from "vitest";
import * as api from "../index.js";

const result = { provider: "fixture", retrievedAt: "2026-10-30T12:00:00Z", sources: [], truncated: false };
function harness() {
  let config = {
    enabled: true,
    provider: "exa" as const,
    authentication: "anonymous" as "anonymous" | "api-key",
  };
  let key: string | undefined = "private-fixture-key";
  const search = vi.fn().mockResolvedValue(result),
    read = vi.fn().mockResolvedValue(result);
  const getKey = vi.fn(async () => key);
  const create = vi.fn(() => ({ search, read }));
  expect(api.ConfiguredWebProvider).toBeTypeOf("function");
  const provider = new api.ConfiguredWebProvider({ config: () => config, getKey, create });
  return {
    provider,
    search,
    read,
    create,
    getKey,
    set: (patch: Partial<typeof config>) => {
      config = { ...config, ...patch };
    },
    clearKey: () => {
      key = undefined;
    },
  };
}

it("gates both web methods globally and anonymous mode ignores saved keys", async () => {
  const h = harness();
  const signal = new AbortController().signal;
  await h.provider.search({ query: "topic" }, signal);
  expect(h.getKey).not.toHaveBeenCalled();
  expect(h.create).toHaveBeenCalledExactlyOnceWith(undefined);
  h.set({ enabled: false });
  await expect(h.provider.search({ query: "blocked" }, signal)).rejects.toThrow(/disabled/i);
  await expect(h.provider.read({ url: "https://example.com" }, signal)).rejects.toThrow(/disabled/i);
  expect(h.create).toHaveBeenCalledTimes(1);
});

it("uses selected stored or draft keys and never silently falls back to anonymous", async () => {
  const h = harness(),
    signal = new AbortController().signal;
  h.set({ authentication: "api-key" });
  await h.provider.search({ query: "topic" }, signal);
  expect(h.create).toHaveBeenLastCalledWith("private-fixture-key");
  await h.provider.test({ authentication: "api-key", apiKey: "temporary-key" }, signal);
  expect(h.create).toHaveBeenLastCalledWith("temporary-key");
  await h.provider.test({ authentication: "anonymous" }, signal);
  expect(h.create).toHaveBeenLastCalledWith(undefined);
  h.clearKey();
  await expect(h.provider.search({ query: "missing" }, signal)).rejects.toThrow(/key.*required/i);
});

it("revokes active calls and calls still resolving a credential, then permits new authorized work", async () => {
  const h = harness();
  h.search.mockImplementation(
    (_args, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  const pending = h.provider.search({ query: "pending" }, new AbortController().signal);
  await vi.waitFor(() => expect(h.search).toHaveBeenCalledOnce());
  h.provider.revoke();
  await expect(pending).rejects.toThrow();
  h.search.mockResolvedValue(result);
  h.set({ authentication: "api-key" });
  let release!: (key: string) => void;
  h.getKey.mockImplementation(
    () =>
      new Promise((resolve) => {
        release = resolve;
      }),
  );
  const late = h.provider.search({ query: "late" }, new AbortController().signal);
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  h.provider.revoke();
  release("old-key");
  await expect(late).rejects.toThrow();
  expect(h.create).toHaveBeenCalledOnce();
  h.getKey.mockResolvedValue("new-key");
  await h.provider.search({ query: "new" }, new AbortController().signal);
  await h.provider.close();
  await expect(
    h.provider.read({ url: "https://example.com" }, new AbortController().signal),
  ).rejects.toThrow();
});
