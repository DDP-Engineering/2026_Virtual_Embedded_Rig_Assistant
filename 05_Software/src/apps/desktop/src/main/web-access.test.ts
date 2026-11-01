import { existsSync } from "node:fs";
import { SettingsService } from "@vera/core";
import { beforeAll, expect, it, vi } from "vitest";
import { CredentialFile } from "./credentials.js";

let WebAccessService: typeof import("./web-access.js").WebAccessService;
beforeAll(async () => {
  expect(existsSync(new URL("./web-access.ts", import.meta.url))).toBe(true);
  ({ WebAccessService } = await import("./web-access.js"));
});
const key = "exa-private-test-key-12345";
const preferences = { enabled: true, provider: "exa" as const, authentication: "anonymous" as const };
const result = { provider: "fixture", retrievedAt: "2026-10-30T12:00:00Z", sources: [], truncated: false };
async function harness(secure = true) {
  const disk = new Map<string, string>();
  const files = {
    read: vi.fn(async (p: string) => disk.get(p)),
    writeAtomic: vi.fn(async (p: string, value: string) => {
      disk.set(p, value);
    }),
  };
  const settings = new SettingsService({
    files,
    paths: { userData: "/data", settings: "/data/settings.json", logs: "/data/logs" },
    uuid: () => "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
    changed: vi.fn(),
  });
  await settings.load();
  const credentials = new CredentialFile({
    file: "/data/credentials.json",
    files,
    platform: "win32",
    crypto: {
      isEncryptionAvailable: () => secure,
      getSelectedStorageBackend: () => "unknown",
      encryptString: (value) => Buffer.from(Buffer.from(value).map((b) => b ^ 90)),
      decryptString: (value) => Buffer.from(value.map((b) => b ^ 90)).toString(),
    },
    logger: { log: vi.fn(), registerSecret: vi.fn(() => () => {}), flush: vi.fn(async () => {}) },
  });
  const search = vi.fn().mockResolvedValue(result),
    create = vi.fn(() => ({ search, read: vi.fn().mockResolvedValue(result) }));
  const service = new WebAccessService({
    settings,
    credentials,
    create,
    changed: vi.fn(),
    now: () => new Date("2026-10-30T12:00:00Z"),
  });
  return { service, settings, credentials, files, disk, search, create };
}
it("saves preferences/key separately, masks metadata and anonymous never sends the stored key", async () => {
  const h = await harness();
  await h.service.save({ ...preferences, authentication: "api-key", apiKey: key });
  expect(JSON.stringify(h.settings.get())).not.toContain(key);
  expect(h.disk.get("/data/credentials.json")).not.toContain(key);
  expect(await h.service.get()).toMatchObject({
    preferences: { authentication: "api-key" },
    keys: { exa: { keyConfigured: true, storage: "encrypted" } },
  });
  await h.service.provider.search({ query: "key mode" }, new AbortController().signal);
  expect(h.create).toHaveBeenLastCalledWith("exa", key);
  await h.service.save(preferences);
  await h.service.provider.search({ query: "anonymous" }, new AbortController().signal);
  expect(h.create).toHaveBeenLastCalledWith("exa", undefined);
  expect((await h.service.get()).keys.exa.keyConfigured).toBe(true);
});
it("requires weak-storage consent, supports memory choice and rolls back a failed preferences write", async () => {
  const h = await harness(false);
  expect(await h.service.save({ ...preferences, authentication: "api-key", apiKey: key })).toEqual({
    status: "consent-required",
  });
  expect((await h.service.get()).keys.exa.keyConfigured).toBe(false);
  await h.service.save({ ...preferences, authentication: "api-key", apiKey: key, storageConsent: false });
  expect((await h.service.get()).keys.exa.storage).toBe("memory");
  h.files.writeAtomic.mockImplementation(async (p, value) => {
    if (p.endsWith("settings.json")) throw Error("write failed");
    h.disk.set(p, value);
  });
  await expect(
    h.service.save({
      ...preferences,
      apiKey: "replacement",
      authentication: "api-key",
      enabled: false,
      storageConsent: false,
    }),
  ).rejects.toMatchObject({ code: "INTERNAL" });
  expect(h.settings.get().settings.webAccess.enabled).toBe(true);
  expect((await h.credentials.read("web:exa"))?.type).toBe("api_key");
  expect(await h.credentials.read("web:exa")).toMatchObject({ key });
});
it("tests drafts without saving and removes a saved key while selecting anonymous", async () => {
  const h = await harness();
  const before = [...h.disk];
  const tested = await h.service.test({
    provider: "exa",
    testId: "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
    authentication: "api-key",
    apiKey: key,
  });
  expect(tested.status).toBe("pass");
  expect([...h.disk]).toEqual(before);
  expect((await h.service.get()).keys.exa.keyConfigured).toBe(false);
  expect(JSON.stringify(tested)).not.toContain(key);
  await h.service.save({ ...preferences, authentication: "api-key", apiKey: key });
  await h.service.removeKey({ provider: "exa" });
  expect(await h.service.get()).toMatchObject({
    keys: { exa: { keyConfigured: false } },
    preferences: { authentication: "anonymous" },
  });
});
it("global disable blocks tests and agent calls and test close cancels only the matching attempt", async () => {
  const h = await harness();
  await h.service.save({ ...preferences, enabled: false });
  expect(
    (
      await h.service.test({
        provider: "exa",
        testId: "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
        authentication: "anonymous",
      })
    ).status,
  ).toBe("disabled");
  expect(h.search).not.toHaveBeenCalled();
  await h.service.save(preferences);
  h.search.mockImplementation(
    (_args, signal: AbortSignal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      }),
  );
  const request = {
    provider: "exa" as const,
    testId: "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
    authentication: "anonymous" as const,
  };
  const pending = h.service.test(request);
  await vi.waitFor(() => expect(h.search).toHaveBeenCalledOnce());
  h.service.cancelTest({ testId: request.testId });
  expect((await pending).status).toBe("cancelled");
  await h.service.close();
});

it("keeps three provider keys isolated through switching, draft tests and removal", async () => {
  const h = await harness();
  for (const provider of ["exa", "tavily", "brave"] as const)
    await h.service.save({
      ...preferences,
      provider,
      authentication: "api-key",
      apiKey: `owned-${provider}-key`,
    });
  const snapshot = await h.service.get();
  expect(snapshot.keys).toMatchObject({
    exa: { keyConfigured: true },
    tavily: { keyConfigured: true },
    brave: { keyConfigured: true },
  });
  await h.service.provider.search({ query: "board" }, new AbortController().signal);
  expect(h.create).toHaveBeenLastCalledWith("brave", "owned-brave-key");
  const before = [...h.disk];
  await h.service.test({
    provider: "tavily",
    authentication: "api-key",
    apiKey: "draft-only-tavily",
    testId: crypto.randomUUID(),
  });
  expect(h.create).toHaveBeenLastCalledWith("tavily", "draft-only-tavily");
  expect([...h.disk]).toEqual(before);
  await h.service.removeKey({ provider: "tavily" });
  expect(h.settings.get().settings.webAccess.provider).toBe("brave");
  expect((await h.service.get()).keys.exa.keyConfigured).toBe(true);
  await h.service.removeKey({ provider: "brave" });
  expect(h.settings.get().settings.webAccess).toMatchObject({
    provider: "brave",
    enabled: false,
    authentication: "api-key",
  });
});

it("rolls back a failed provider switch without changing other credential slots", async () => {
  const h = await harness();
  await h.service.save({ ...preferences, authentication: "api-key", apiKey: key });
  h.files.writeAtomic.mockImplementation(async (p, value) => {
    if (p.endsWith("settings.json")) throw Error("owned failure");
    h.disk.set(p, value);
  });
  await expect(
    h.service.save({
      ...preferences,
      provider: "tavily",
      authentication: "api-key",
      apiKey: "owned-tavily-replacement",
    }),
  ).rejects.toMatchObject({ code: "INTERNAL" });
  expect(h.settings.get().settings.webAccess).toMatchObject({ provider: "exa", authentication: "api-key" });
  expect(await h.credentials.read("web:exa")).toMatchObject({ key });
  expect(await h.credentials.read("web:tavily")).toBeUndefined();
});
