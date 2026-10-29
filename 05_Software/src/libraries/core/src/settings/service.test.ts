import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { beforeAll, describe, expect, it, vi } from "vitest";

let SettingsService: typeof import("./service.js").SettingsService;
beforeAll(async () => {
  expect(existsSync(new URL("./service.ts", import.meta.url)), "settings persistence service exists").toBe(
    true,
  );
  ({ SettingsService } = await import("./service.js"));
});

function harness(stored?: string) {
  const files = new Map<string, string>();
  if (stored !== undefined) files.set("/data/settings.json", stored);
  const fileAccess = {
    read: vi.fn(async (path: string) => files.get(path)),
    writeAtomic: vi.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    backup: vi.fn(async (path: string, content: string) => {
      if (files.has(path)) return false;
      files.set(path, content);
      return true;
    }),
  };
  const changed = vi.fn();
  const service = new SettingsService({
    files: fileAccess,
    paths: { userData: "/data", settings: "/data/settings.json", logs: "/data/logs" },
    uuid: randomUUID,
    changed,
  });
  return { service, fileAccess, files, changed };
}

describe("application settings persistence", () => {
  it.each([0, 1, 2, 3])(
    "upgrades frozen settings v%i with exact exclusive backup, preserved preferences and repeatable reload",
    async (version) => {
      const raw = readFileSync(
        new URL(`../../../../../tests/fixtures/settings/version-${version}.json`, import.meta.url),
        "utf8",
      );
      const previous = JSON.parse(raw);
      const h = harness(raw);
      h.files.set(`/data/settings.json.bak-${version}`, "existing recovery copy");
      await h.service.load();
      expect(h.files.get(`/data/settings.json.bak-${version}`)).toBe("existing recovery copy");
      expect(h.files.get(`/data/settings.json.bak-${version + 1}`)).toBe(raw);
      expect(h.fileAccess.backup.mock.invocationCallOrder.at(-1)).toBeLessThan(
        h.fileAccess.writeAtomic.mock.invocationCallOrder[0]!,
      );
      expect(h.service.get().settings).toMatchObject({
        schemaVersion: 4,
        installationId: previous.installationId,
        language: previous.language,
        theme: previous.theme,
        textScale: previous.textScale,
      });
      if (version >= 2)
        expect(h.service.get().settings.recentWorkbenches).toEqual(previous.recentWorkbenches);
      if (version === 3) expect(h.service.get().settings.providers).toEqual(previous.providers);
      const reload = harness(h.files.get("/data/settings.json"));
      await reload.service.load();
      expect(reload.service.get()).toEqual(h.service.get());
      expect(reload.fileAccess.writeAtomic).not.toHaveBeenCalled();
      expect(reload.fileAccess.backup).not.toHaveBeenCalled();
    },
  );
  it.each([0, 1, 2, 3])(
    "preserves frozen settings v%i when migration backup or save fails",
    async (version) => {
      const raw = readFileSync(
        new URL(`../../../../../tests/fixtures/settings/version-${version}.json`, import.meta.url),
        "utf8",
      );
      const backupFailure = harness(raw);
      backupFailure.fileAccess.backup.mockRejectedValueOnce(new Error("backup failure"));
      await expect(backupFailure.service.load()).rejects.toThrow("backup failure");
      expect(backupFailure.files.get("/data/settings.json")).toBe(raw);
      expect(backupFailure.fileAccess.writeAtomic).not.toHaveBeenCalled();
      const saveFailure = harness(raw);
      saveFailure.fileAccess.writeAtomic.mockRejectedValueOnce(new Error("save failure"));
      await expect(saveFailure.service.load()).rejects.toThrow("save failure");
      expect(saveFailure.files.get("/data/settings.json")).toBe(raw);
      expect(saveFailure.files.get(`/data/settings.json.bak-${version}`)).toBe(raw);
      expect(() => saveFailure.service.get()).toThrow();
    },
  );
  it("conditionally updates the app model against the serialized current state", async () => {
    const h = harness();
    await h.service.load();
    const other = h.service.update({ defaultModel: "openai/kept" });
    const subscription = h.service.update(
      { defaultModel: "chatgpt/new" },
      (current) => current.settings.defaultModel === null,
    );
    await Promise.all([other, subscription]);
    expect(h.service.get().settings.defaultModel).toBe("openai/kept");
    const changed = h.service.update({ defaultModel: "openai/changed" });
    const signout = h.service.update(
      { defaultModel: null },
      (current) => !!current.settings.defaultModel?.startsWith("chatgpt/"),
    );
    await Promise.all([changed, signout]);
    expect(h.service.get().settings.defaultModel).toBe("openai/changed");
  });
  it("migrates schema3 model references to4 with exact backup, provider/identity/extensions and newer protection", async () => {
    const defaults = (await import("@vera/shared")).defaultSettings("00000000-0000-4000-8000-000000000001");
    const raw = JSON.stringify({ ...defaults, schemaVersion: 3, extension: { kept: true } });
    const h = harness(raw);
    await h.service.load();
    expect(h.service.get().settings.schemaVersion).toBe(4);
    expect(h.files.get("/data/settings.json.bak-3")).toBe(raw);
    expect(h.service.get().settings).toMatchObject({
      installationId: defaults.installationId,
      extension: { kept: true },
      providers: defaults.providers,
    });
    await h.service.update({ defaultModel: "custom:local/org/model" });
    expect(h.service.get().settings.defaultModel).toBe("custom:local/org/model");
    await expect(h.service.update({ defaultModel: "invalid" })).rejects.toMatchObject({ code: "INVALID" });
    const future = JSON.stringify({ ...defaults, schemaVersion: 5 });
    const next = harness(future);
    await next.service.load();
    expect(next.service.get().readOnly).toBe(true);
    expect(next.files.get("/data/settings.json")).toBe(future);
  });
  it("migrates schema2 provider defaults to schema4 with original-byte backup and retained extensions", async () => {
    const raw = JSON.stringify({
      schemaVersion: 2,
      installationId: "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
      language: "en",
      theme: "dark",
      textScale: 1,
      defaultModel: null,
      providers: {},
      updates: { mode: "notify", channel: "latest", future: 9 },
      recentWorkbenches: [],
      limits: { maxToolCallsPerTurn: 50 },
      extension: { kept: true },
    });
    const h = harness(raw);
    await h.service.load();
    expect(h.service.get().settings).toMatchObject({
      schemaVersion: 4,
      providers: { openai: {}, custom: [] },
      extension: { kept: true },
      updates: { future: 9 },
    });
    expect(h.files.get("/data/settings.json.bak-2")).toBe(raw);
    await h.service.update({ theme: "light" });
    const reload = harness(h.files.get("/data/settings.json"));
    await reload.service.load();
    expect(reload.service.get()).toEqual(h.service.get());
  });
  it("migrates schema1 to typed recent schema2 with backup, stable UUID and retained unknown settings", async () => {
    const raw = readFileSync(
      new URL("../../../../../tests/fixtures/settings/version-1.json", import.meta.url),
      "utf8",
    );
    const h = harness(raw);
    await h.service.load();
    expect(h.service.get().settings).toMatchObject({
      schemaVersion: 4,
      installationId: "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
      extension: { enabled: true },
      updates: { future: 9 },
    });
    expect(h.files.get("/data/settings.json.bak-1")).toBe(raw);
    await h.service.update({ theme: "dark" });
    expect(JSON.parse(h.files.get("/data/settings.json") ?? "")).toMatchObject({
      schemaVersion: 4,
      extension: { enabled: true },
      updates: { future: 9 },
    });
    const reload = harness(h.files.get("/data/settings.json"));
    await reload.service.load();
    expect(reload.service.get()).toEqual(h.service.get());
  });
  it("first run creates full defaults and a new installation UUID", async () => {
    const a = harness();
    const b = harness();
    await Promise.all([a.service.load(), b.service.load()]);
    const first = a.service.get();
    expect(first.readOnly).toBe(false);
    expect(first.settings).toEqual({
      schemaVersion: 4,
      installationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      language: "system",
      theme: "system",
      textScale: 1,
      chatFontSize: 14,
      codeFontSize: 14,
      defaultModel: null,
      providers: { openai: {}, custom: [] },
      updates: { mode: "notify", channel: "latest" },
      recentWorkbenches: [],
      limits: { maxToolCallsPerTurn: 50 },
    });
    expect(first.settings.installationId).not.toBe(b.service.get().settings.installationId);
    const persisted = a.files.get("/data/settings.json");
    expect(JSON.parse(persisted ?? "")).toEqual(first.settings);
    const reload = harness(persisted);
    await reload.service.load();
    expect(reload.service.get()).toEqual(first);
    expect(reload.fileAccess.writeAtomic).not.toHaveBeenCalled();
    expect(a.changed).not.toHaveBeenCalled();
  });
  it("migrates the version-zero fixture and preserves original bytes in a backup", async () => {
    const raw = readFileSync(
      new URL("../../../../../tests/fixtures/settings/version-0.json", import.meta.url),
      "utf8",
    );
    const h = harness(raw);
    h.files.set("/data/settings.json.bak-0", "previous backup");
    await h.service.load();
    expect(h.files.get("/data/settings.json.bak-0")).toBe("previous backup");
    expect(h.files.get("/data/settings.json.bak-1")).toBe(raw);
    expect(h.service.get().settings).toMatchObject({
      schemaVersion: 4,
      installationId: "a70d0929-51ad-4b56-a846-b290818c6fce",
      theme: "dark",
      language: "ro",
      textScale: 1.125,
      limits: { maxToolCallsPerTurn: 50 },
    });
    expect(h.fileAccess.backup.mock.invocationCallOrder[0]).toBeLessThan(
      h.fileAccess.writeAtomic.mock.invocationCallOrder[0] ?? 0,
    );
  });
  it("a newer schema exposes defaults read-only and never changes source bytes", async () => {
    const raw = '{ "schemaVersion": 99, "future": "unrecognized" }';
    const h = harness(raw);
    await h.service.load();
    expect(h.service.get()).toMatchObject({
      readOnly: true,
      settings: { theme: "system", schemaVersion: 4 },
    });
    await expect(h.service.update({ theme: "dark" })).rejects.toMatchObject({ code: "DENIED" });
    expect(h.files.get("/data/settings.json")).toBe(raw);
    expect(h.fileAccess.writeAtomic).not.toHaveBeenCalled();
    expect(h.fileAccess.backup).not.toHaveBeenCalled();
  });
  it("version-zero nested preferences receive missing defaults and invalid nested data is preserved", async () => {
    const h = harness('{"schemaVersion":0,"updates":{},"limits":{}}');
    await h.service.load();
    expect(h.service.get().settings.updates).toEqual({ mode: "notify", channel: "latest" });
    expect(h.service.get().settings.limits).toEqual({ maxToolCallsPerTurn: 50 });
    expect(h.service.get().settings.installationId).toMatch(/^[0-9a-f-]{36}$/);
    const invalid = harness('{"schemaVersion":0,"updates":null}');
    await expect(invalid.service.load()).rejects.toMatchObject({ code: "INVALID" });
    expect(invalid.fileAccess.backup).not.toHaveBeenCalled();
  });
  it("undefined patch values mean omission and failed observers do not undo committed saves", async () => {
    const h = harness();
    await h.service.load();
    await h.service.update({ theme: undefined, limits: { maxToolCallsPerTurn: undefined } });
    expect(h.changed).not.toHaveBeenCalled();
    h.changed.mockImplementation(() => {
      throw new Error("observer failed");
    });
    await expect(h.service.update({ theme: "dark" })).resolves.toMatchObject({ settings: { theme: "dark" } });
  });
  it("serializes concurrent patches, emits only committed state and returns detached snapshots", async () => {
    const h = harness();
    await h.service.load();
    h.changed.mockImplementation(() => {
      expect(JSON.parse(h.files.get("/data/settings.json") ?? "")).toEqual(h.service.get().settings);
    });
    await Promise.all([
      h.service.update({ theme: "dark" }),
      h.service.update({ language: "de", limits: { maxToolCallsPerTurn: 3 } }),
    ]);
    expect(h.service.get().settings).toMatchObject({
      theme: "dark",
      language: "de",
      limits: { maxToolCallsPerTurn: 3 },
    });
    expect(h.changed).toHaveBeenCalledTimes(2);
    const detached = h.service.get();
    detached.settings.theme = "light";
    expect(h.service.get().settings.theme).toBe("dark");
    const writes = h.fileAccess.writeAtomic.mock.calls.length;
    await h.service.update({});
    await h.service.update({ theme: "dark" });
    expect(h.fileAccess.writeAtomic).toHaveBeenCalledTimes(writes);
    expect(h.changed).toHaveBeenCalledTimes(2);
  });
  it.each([
    { installationId: "changed" },
    { schemaVersion: 0 },
    { theme: "invalid" },
    { textScale: 2 },
    { providers: { apiKey: "secret" } },
    { limits: { maxToolCallsPerTurn: 0 } },
    { limits: { maxToolCallsPerTurn: 1.5 } },
    { updates: { token: "secret" } },
    null,
    [],
  ])("rejects invalid partial update %j before persistence", async (patch) => {
    const h = harness();
    await h.service.load();
    h.fileAccess.writeAtomic.mockClear();
    await expect(h.service.update(patch as never)).rejects.toMatchObject({ code: "INVALID" });
    expect(h.fileAccess.writeAtomic).not.toHaveBeenCalled();
    expect(h.changed).not.toHaveBeenCalled();
  });
  it("failed save preserves memory and events and does not poison the queue", async () => {
    const h = harness();
    await h.service.load();
    const old = h.files.get("/data/settings.json");
    h.fileAccess.writeAtomic.mockRejectedValueOnce(new Error("write failure"));
    await expect(h.service.update({ theme: "dark" })).rejects.toThrow("write failure");
    expect(h.files.get("/data/settings.json")).toBe(old);
    expect(h.service.get().settings.theme).toBe("system");
    expect(h.changed).not.toHaveBeenCalled();
    await h.service.update({ language: "en" });
    expect(h.service.get().settings).toMatchObject({ theme: "system", language: "en" });
  });
  it("a failed migration backup preserves the source and prevents migrated writes", async () => {
    const raw = '{"schemaVersion":0,"theme":"dark"}';
    const h = harness(raw);
    h.fileAccess.backup.mockRejectedValueOnce(new Error("backup failure"));
    await expect(h.service.load()).rejects.toThrow("backup failure");
    expect(h.files.get("/data/settings.json")).toBe(raw);
    expect(h.fileAccess.writeAtomic).not.toHaveBeenCalled();
    expect(() => h.service.get()).toThrow();
  });
  it("load is shared and shutdown drains accepted updates while denying new work", async () => {
    const h = harness();
    await Promise.all([h.service.load(), h.service.load()]);
    expect(h.fileAccess.writeAtomic).toHaveBeenCalledTimes(1);
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    h.fileAccess.writeAtomic.mockImplementationOnce(async (path, content) => {
      await gate;
      h.files.set(path, content);
    });
    const update = h.service.update({ theme: "dark" });
    const closed = h.service.close();
    await expect(h.service.update({ theme: "light" })).rejects.toMatchObject({ code: "DENIED" });
    release();
    await Promise.all([update, closed]);
    expect(h.service.get().settings.theme).toBe("dark");
  });
  it.each(["invalid-json", '{"schemaVersion":-1}', '{"schemaVersion":0,"theme":"bad"}'])(
    "preserves malformed stored data %s",
    async (raw) => {
      const h = harness(raw);
      await expect(h.service.load()).rejects.toMatchObject({ code: "INVALID" });
      expect(h.files.get("/data/settings.json")).toBe(raw);
      expect(h.fileAccess.backup).not.toHaveBeenCalled();
      expect(h.fileAccess.writeAtomic).not.toHaveBeenCalled();
    },
  );
});

it("persists independent interface, conversation and code sizes without changing unrelated preferences", async () => {
  const h = harness();
  await h.service.load();
  const before = h.service.get().settings;
  await h.service.update({ textScale: 0.875, chatFontSize: 12, codeFontSize: 24 });
  const next = h.service.get().settings;
  expect(next).toEqual({ ...before, textScale: 0.875, chatFontSize: 12, codeFontSize: 24 });
  const reload = harness(h.files.get("/data/settings.json"));
  await reload.service.load();
  expect(reload.service.get().settings).toEqual(next);
  for (const patch of [
    { chatFontSize: 9 },
    { codeFontSize: 33 },
    { chatFontSize: 14.5 },
    { codeFontSize: "large" },
    { codeFontSize: 22 },
    { textScale: 0.5 },
  ]) {
    await expect(reload.service.update(patch as never)).rejects.toMatchObject({ code: "INVALID" });
  }
  expect(reload.service.get().settings).toEqual(next);
});

it("persists shortcut removal/reassignment and defaults reset across real SettingsService loads", async () => {
  const h = harness();
  await h.service.load();
  await h.service.update({ keyboardShortcuts: { newSession: [], settings: ["Mod+N"] } });
  const reload = harness(h.files.get("/data/settings.json"));
  await reload.service.load();
  expect(reload.service.get().settings.keyboardShortcuts).toEqual({ newSession: [], settings: ["Mod+N"] });
  await reload.service.update({ keyboardShortcuts: {} });
  const reset = harness(reload.files.get("/data/settings.json"));
  await reset.service.load();
  expect(reset.service.get().settings.keyboardShortcuts).toEqual({});
});
