import { existsSync } from "node:fs";
import { SettingsService } from "@vera/core";
import { channels, defaultSettings } from "@vera/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { CredentialFile } from "./credentials.js";
import { createInvokeRouter } from "./ipc-router.js";

let ProviderSettings: typeof import("./provider-settings.js").ProviderSettings;
beforeAll(async () => {
  expect(
    existsSync(new URL("./provider-settings.ts", import.meta.url)),
    "safe provider settings service exists",
  ).toBe(true);
  ({ ProviderSettings } = await import("./provider-settings.js"));
});
const key = "fake-private-WP08-do-not-echo-8Zx4";
function harness(secure = true) {
  const disk = new Map<string, string>();
  const changed = vi.fn();
  const files = {
    read: vi.fn(async (p: string) => disk.get(p)),
    writeAtomic: vi.fn(async (p: string, v: string) => {
      disk.set(p, v);
    }),
  };
  const settings = new SettingsService({
    files,
    paths: { userData: "/data", settings: "/data/settings.json", logs: "/data/logs" },
    uuid: () => "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
    changed,
  });
  const credentials = new CredentialFile({
    file: "/data/credentials.json",
    files,
    platform: "win32",
    crypto: {
      isEncryptionAvailable: () => secure,
      getSelectedStorageBackend: () => "unknown",
      encryptString: (text) => Buffer.from(Buffer.from(text).map((b) => b ^ 0x5a)),
      decryptString: (bytes) => Buffer.from(bytes.map((b) => b ^ 0x5a)).toString(),
    },
    logger: { log: vi.fn(), registerSecret: vi.fn(() => () => {}), flush: vi.fn(async () => {}) },
  });
  const service = new ProviderSettings(settings, credentials);
  return {
    disk,
    files,
    settings,
    credentials,
    service,
    changed,
    setSecure: (value: boolean) => {
      secure = value;
    },
  };
}
const custom = { name: "Local model", baseUrl: "http://localhost:11434/v1", model: "fake-model" };
describe("safe provider settings", () => {
  it("clears an optional OpenAI model independently and removes the key while retaining the model", async () => {
    const h = harness();
    await h.settings.load();
    await h.service.save({ provider: "openai", apiKey: key, model: "chosen-model" });
    await h.service.save({ provider: "openai", model: "" });
    expect((await h.service.list()).openai.model).toBeUndefined();
    expect((await h.service.list()).openai.configured).toBe(true);
    await h.service.save({ provider: "openai", model: "kept-model" });
    await h.service.remove({ id: "openai" });
    expect((await h.service.list()).openai).toMatchObject({
      model: "kept-model",
      configured: false,
      hint: null,
    });
  });
  it("fully hides a short key equal to the hint separator", async () => {
    const h = harness();
    await h.settings.load();
    await h.service.save({ provider: "openai", apiKey: "…" });
    expect((await h.service.list()).openai.hint).toBeNull();
  });
  it("hides hints that reconstruct a complete current or replaced credential", async () => {
    const h = harness();
    await h.settings.load();
    const collision = "abc…defg";
    await h.service.save({ provider: "openai", apiKey: collision });
    expect((await h.service.list()).openai).toMatchObject({ configured: true, hint: null });
    expect(JSON.stringify(await h.service.list())).not.toContain(collision);
    await h.service.save({ provider: "custom", config: custom, apiKey: "abc…defg" });
    expect((await h.service.list()).custom[0]?.hint).toBeNull();
    await h.service.save({ provider: "openai", apiKey: "abc-interior-defg" });
    expect((await h.service.list()).openai.hint).toBeNull();
    await h.service.save({
      provider: "custom",
      id: "custom:local-model",
      config: custom,
      apiKey: "abc-other-defg",
    });
    expect((await h.service.list()).custom[0]?.hint).toBeNull();
    expect(JSON.stringify(await h.service.list())).not.toContain(collision);
  });
  it("lists only public metadata and strictly bounded hints including short keys", async () => {
    const h = harness();
    await h.settings.load();
    expect(await h.service.save({ provider: "openai", apiKey: key, model: "fake-openai-model" })).toEqual({
      status: "saved",
    });
    const list = await h.service.list();
    expect(list.openai).toMatchObject({
      configured: true,
      hint: "fak…8Zx4",
      model: "fake-openai-model",
      storage: "encrypted",
    });
    expect(JSON.stringify(list)).not.toContain(key);
    expect(JSON.stringify(h.settings.get())).not.toContain(key);
    for (let length = 1; length <= 7; length++) {
      const short = "X".repeat(length);
      await h.service.save({ provider: "openai", apiKey: short });
      expect((await h.service.list()).openai.hint).toBeNull();
    }
    await h.service.save({ provider: "openai", apiKey: "12345678" });
    expect((await h.service.list()).openai.hint).toBe("123…5678");
  });
  it("accepts short keys that overlap structural fields or longer public words while masking hints", async () => {
    const h = harness();
    await h.settings.load();
    for (const apiKey of ["a", "1", "api", "model", "openai"]) {
      await h.service.save({ provider: "openai", apiKey, model: "ordinary model name" });
      expect((await h.service.list()).openai.hint).toBeNull();
    }
  });
  it("adds/edits/removes keyless and keyed endpoints, defaults and stable slug, keeping stored options", async () => {
    const h = harness();
    await h.settings.load();
    await h.service.save({ provider: "custom", config: custom, apiKey: key });
    expect((await h.service.list()).custom[0]).toMatchObject({
      id: "custom:local-model",
      slug: "local-model",
      contextWindow: 32768,
      maxOutputTokens: 4096,
      configured: true,
    });
    const state = h.settings.get().settings;
    state.providers.custom[0] = { ...state.providers.custom[0], supportsTools: true } as never;
    // A stored option the edit form does not send survives an edit.
    h.disk.set("/data/settings.json", JSON.stringify(state));
    const reload = new SettingsService({
      files: h.files,
      paths: { userData: "/data", settings: "/data/settings.json", logs: "/data/logs" },
      uuid: () => state.installationId,
      changed: h.changed,
    });
    await reload.load();
    const service = new ProviderSettings(reload, h.credentials);
    await service.save({
      provider: "custom",
      id: "custom:local-model",
      config: { ...custom, name: "Renamed local", model: "new-model" },
    });
    expect(reload.get().settings.providers.custom[0]).toMatchObject({
      slug: "local-model",
      name: "Renamed local",
      supportsTools: true,
    });
    expect((await service.list()).custom[0]?.hint).toBe("fak…8Zx4");
    await service.save({ provider: "custom", config: { ...custom, name: "Second" } });
    expect((await service.list()).custom[1]).toMatchObject({ configured: true, hint: null, storage: null });
    await service.save({ provider: "custom", id: "custom:local-model", config: custom, apiKey: "" });
    expect((await service.list()).custom[0]?.hint).toBeNull();
    await service.remove({ id: "custom:local-model" });
    expect((await service.list()).custom).toHaveLength(1);
    expect(await h.credentials.read("custom:local-model")).toBeUndefined();
    await service.remove({ id: "openai" });
    expect((await service.list()).openai).toMatchObject({ configured: false, hint: null });
  });
  it("requires consent before weak saves and never echoes submitted secrets", async () => {
    const h = harness(false);
    await h.settings.load();
    expect(await h.service.save({ provider: "openai", apiKey: key })).toEqual({ status: "consent-required" });
    expect(await h.credentials.read("openai")).toBeUndefined();
    expect(h.credentials.scrub(`error ${key}`)).toBe("error [REDACTED]");
    expect(await h.service.save({ provider: "openai", apiKey: key, storageConsent: false })).toEqual({
      status: "saved",
    });
    expect((await h.service.list()).openai).toMatchObject({ configured: true, storage: "memory" });
    expect(h.disk.has("/data/credentials.json")).toBe(false);
  });
  it("rejects collisions, malformed URL/budget and secret-bearing metadata before mutation", async () => {
    const h = harness();
    await h.settings.load();
    await h.service.save({ provider: "custom", config: custom });
    const raw = h.disk.get("/data/settings.json");
    for (const config of [
      { ...custom, name: "LOCAL MODEL" },
      { ...custom, name: "Local-model" },
      { ...custom, name: "Second", baseUrl: "https://user:password@example.invalid/v1" },
      { ...custom, name: "Second", baseUrl: "https://example.invalid/v1?token=fake" },
      { ...custom, name: "Second", contextWindow: 100, maxOutputTokens: 99 },
      { ...custom, name: "Second", contextWindow: 1.5 },
      { ...custom, name: "Second", model: key },
    ]) {
      await expect(
        h.service.save({ provider: "custom", config, apiKey: key } as never),
      ).rejects.toMatchObject({ code: expect.stringMatching(/INVALID|CONFLICT/) });
      expect(h.disk.get("/data/settings.json")).toBe(raw);
    }
    await expect(h.service.remove({ id: "custom:missing" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("rolls back credential when settings fail and recovers the queue", async () => {
    const h = harness();
    await h.settings.load();
    await h.service.save({ provider: "openai", apiKey: key, model: "old" });
    h.files.writeAtomic
      .mockImplementationOnce(async (p, v) => {
        h.disk.set(p, v);
      })
      .mockRejectedValueOnce(new Error("fake-next-key-private"));
    await expect(
      h.service.save({ provider: "openai", apiKey: "fake-next-key-private", model: "changed" }),
    ).rejects.toMatchObject({ code: "INTERNAL" });
    expect(await h.credentials.read("openai")).toEqual({ type: "api_key", key });
    expect(h.settings.get().settings.providers.openai.model).toBe("old");
    await h.service.save({ provider: "openai", model: "recovered" });
    expect(h.settings.get().settings.providers.openai.model).toBe("recovered");
  });
  it.each([true, false])(
    "rollback preserves original storage after crypto availability flips secure=%s",
    async (initial) => {
      for (const operation of ["save", "remove"] as const) {
        const h = harness(initial);
        await h.settings.load();
        const id = "custom:local-model";
        await h.service.save({
          provider: "custom",
          config: { ...custom, model: "old" },
          apiKey: key,
          storageConsent: false,
        });
        const before = h.disk.get("/data/credentials.json");
        const priorEntry = before ? JSON.parse(before).entries[id] : undefined;
        h.setSecure(!initial);
        h.files.writeAtomic.mockImplementation(async (path, text) => {
          if (path.endsWith("settings.json")) throw new Error("settings fixture failure");
          h.disk.set(path, text);
        });
        await expect(
          operation === "save"
            ? h.service.save({
                provider: "custom",
                id,
                config: { ...custom, model: "changed" },
                apiKey: "fake-replacement-private",
                storageConsent: false,
              })
            : h.service.remove({ id }),
        ).rejects.toMatchObject({ code: "INTERNAL" });
        expect(await h.credentials.read(id)).toEqual({ type: "api_key", key });
        expect(h.credentials.storage(id)).toBe(initial ? "encrypted" : "memory");
        const after = h.disk.get("/data/credentials.json");
        expect(after ? JSON.parse(after).entries[id] : undefined).toEqual(priorEntry);
        if (initial) expect(after).toBe(before);
        expect(h.settings.get().settings.providers.custom[0]?.model).toBe("old");
      }
    },
  );
  it("strict IPC provider boundaries reject extra secrets and sanitize known error params", async () => {
    const h = harness();
    await h.settings.load();
    await h.service.save({ provider: "openai", apiKey: key });
    expect(
      channels["providers.save"].request.safeParse({ provider: "openai", apiKey: key, extra: true }).success,
    ).toBe(false);
    expect(
      channels["providers.list"].response.safeParse({ ...(await h.service.list()), apiKey: key }).success,
    ).toBe(false);
    const frame = { url: "vera://app/index.html" };
    const sender = { mainFrame: frame, isDestroyed: () => false };
    const unused = () => ({});
    const handlers = Object.fromEntries(Object.keys(channels).map((name) => [name, unused]));
    const router = createInvokeRouter({
      target: () => ({ webContents: sender, url: frame.url }),
      handlers: {
        ...handlers,
        "providers.list": () => h.service.list(),
        "providers.save": () => {
          throw { code: "PROVIDER", messageKey: "errors.PROVIDER", params: { detail: `failure ${key}` } };
        },
      } as never,
      log: vi.fn(),
      sanitize: (value) => h.credentials.sanitize(value),
    });
    const response = await router({ sender, senderFrame: frame }, "providers.save", {
      provider: "openai",
      apiKey: key,
    });
    expect(JSON.stringify(response)).not.toContain(key);
    expect(response).toMatchObject({ ok: false, error: { params: { detail: "failure [REDACTED]" } } });
    expect(defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19").providers).toEqual({
      openai: {},
      custom: [],
    });
  });
});
