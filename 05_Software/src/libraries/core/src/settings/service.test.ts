import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
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
  it("persists independent notification patches against the latest settings across reload", async () => {
    const h = harness();
    await h.service.load();
    expect(h.service.get().settings).toMatchObject({
      notifications: { turnCompletion: "background", approvalRequests: true, questionRequests: true },
    });
    await Promise.all([
      h.service.update({ notifications: { questionRequests: false } }),
      h.service.update({ notifications: { approvalRequests: false } }),
      h.service.update({ notifications: { turnCompletion: "always" } }),
    ]);
    const stored = h.files.get("/data/settings.json");
    const reload = harness(stored);
    await reload.service.load();
    expect(reload.service.get().settings).toMatchObject({
      schemaVersion: 1,
      notifications: { turnCompletion: "always", approvalRequests: false, questionRequests: false },
    });
    await expect(
      h.service.update({ notifications: { questionRequests: "false" } } as never),
    ).rejects.toMatchObject({ code: "INVALID" });
    expect(h.files.get("/data/settings.json")).toBe(stored);
  });
  it.each([undefined, {}, { mask: {} }, { mask: { display: true } }])(
    "keeps omitted and empty privacy shapes unchanged for no-op patches: %j",
    async (privacy) => {
      const { defaultSettings } = await import("@vera/shared");
      const stored = JSON.stringify({
        ...defaultSettings("00000000-0000-4000-8000-000000000001"),
        privacy,
      });
      const h = harness(stored);
      await h.service.load();
      const before = h.service.get();
      await h.service.update({});
      await h.service.update({ privacy: undefined, theme: "system" });
      expect(h.service.get()).toEqual(before);
      expect(h.files.get("/data/settings.json")).toBe(stored);
      expect(h.fileAccess.writeAtomic).not.toHaveBeenCalled();
      expect(h.changed).not.toHaveBeenCalled();
    },
  );
  it("saves partial masking settings and reopens without dropping other preferences", async () => {
    const h = harness();
    await h.service.load();
    await h.service.update({ shell: "/bin/bash", theme: "dark", plugins: { channel: "pre-release" } });
    const before = h.service.get().settings;
    await h.service.update({ privacy: { mask: { display: true, runs: true } } });
    await h.service.update({ privacy: { mask: { agent: false } } });
    await h.service.update({ language: "fr" });
    const reload = harness(h.files.get("/data/settings.json"));
    await reload.service.load();
    expect(reload.service.get().settings).toEqual({
      ...before,
      language: "fr",
      privacy: {
        mask: { display: true, runs: true, agent: false, exports: true },
      },
    });
    const stored = h.files.get("/data/settings.json");
    await expect(h.service.update({ privacy: { mask: { typo: true } } } as never)).rejects.toMatchObject({
      code: "INVALID",
    });
    expect(h.files.get("/data/settings.json")).toBe(stored);
    const invalid = harness(JSON.stringify({ ...before, privacy: { mask: { display: "on" } } }));
    await expect(invalid.service.load()).rejects.toMatchObject({ code: "INVALID" });
  });
  it("persists and resets the shell selection at format version one", async () => {
    const h = harness();
    await h.service.load();
    await h.service.update({ shell: "/bin/bash" });
    const reload = harness(h.files.get("/data/settings.json"));
    await reload.service.load();
    expect(reload.service.get().settings).toMatchObject({ schemaVersion: 1, shell: "/bin/bash" });
    await reload.service.update({ shell: "" });
    expect(reload.service.get().settings.shell).toBe("");
    await expect(reload.service.update({ shell: "bad\0shell" })).rejects.toMatchObject({ code: "INVALID" });
  });
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
  it("stores a custom model reference and rejects an invalid one", async () => {
    const h = harness();
    await h.service.load();
    await h.service.update({ defaultModel: "custom:local/org/model" });
    expect(h.service.get().settings.defaultModel).toBe("custom:local/org/model");
    await expect(h.service.update({ defaultModel: "invalid" })).rejects.toMatchObject({ code: "INVALID" });
  });
  it("first run creates full defaults and a new installation UUID", async () => {
    const a = harness();
    const b = harness();
    await Promise.all([a.service.load(), b.service.load()]);
    const first = a.service.get();
    expect(first.settings).toEqual({
      schemaVersion: 1,
      privacy: { mask: { display: false, runs: false, agent: true, exports: true } },
      installationId: expect.stringMatching(/^[0-9a-f-]{36}$/),
      webAccess: { enabled: true, provider: "exa", authentication: "anonymous" },
      language: "system",
      theme: "system",
      textScale: 1,
      chatFontSize: 14,
      codeFontSize: 14,
      defaultModel: null,
      providers: { openai: {}, custom: [] },
      updates: { mode: "notify", channel: "latest" },
      notifications: { turnCompletion: "background", approvalRequests: true, questionRequests: true },
      recentWorkbenches: [],
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
  it("undefined patch values mean omission and failed observers do not undo committed saves", async () => {
    const h = harness();
    await h.service.load();
    await h.service.update({ theme: undefined, advanced: undefined });
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
      h.service.update({ language: "de", advanced: { toolCallsPerTurn: 30 } }),
    ]);
    expect(h.service.get().settings).toMatchObject({
      theme: "dark",
      language: "de",
      advanced: { toolCallsPerTurn: 30 },
    });
    // REQ-DATA-96ef3dd6: the stored file carries the app value across a reload.
    expect(JSON.parse(h.files.get("/data/settings.json") ?? "").advanced).toEqual({ toolCallsPerTurn: 30 });
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
    { advanced: { toolCallsPerTurn: 0 } },
    { advanced: { toolCallsPerTurn: 1.5 } },
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
  it("retries the load after a failed read", async () => {
    const h = harness();
    h.fileAccess.read.mockRejectedValueOnce(Object.assign(new Error("busy"), { code: "EBUSY" }));
    await expect(h.service.load()).rejects.toThrow("busy");
    await h.service.load();
    expect(h.service.get().settings.schemaVersion).toBe(1);
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
  it("refuses stored settings outside the current format and leaves them untouched", async () => {
    const defaults = (await import("@vera/shared")).defaultSettings("00000000-0000-4000-8000-000000000001");
    const { webAccess: _webAccess, ...withoutWebAccess } = defaults;
    // Version 1 is the only format during development; other versions are invalid data (AGENTS.md).
    for (const raw of [
      "invalid-json",
      JSON.stringify({ ...defaults, schemaVersion: 0 }),
      JSON.stringify({ ...defaults, schemaVersion: 4 }),
      JSON.stringify({ ...defaults, schemaVersion: 99 }),
      JSON.stringify({ ...defaults, extension: { kept: true } }),
      JSON.stringify({ ...defaults, theme: "bad" }),
      JSON.stringify(withoutWebAccess),
    ]) {
      const h = harness(raw);
      await expect(h.service.load(), raw).rejects.toMatchObject({ code: "INVALID" });
      expect(h.files.get("/data/settings.json")).toBe(raw);
      expect(h.fileAccess.writeAtomic).not.toHaveBeenCalled();
    }
  });
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
