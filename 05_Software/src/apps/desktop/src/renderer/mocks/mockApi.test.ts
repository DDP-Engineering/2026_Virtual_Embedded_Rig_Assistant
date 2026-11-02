import type { Request } from "@vera/shared";
import { beforeAll, expect, it, vi } from "vitest";

let createMockApi: typeof import("./mockApi.js").createMockApi;
it.each(["exa", "tavily", "brave"] as const)(
  "browser web test identifies %s without saving a draft key",
  async (provider) => {
    const { api } = createMockApi();
    const request = {
      testId: "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
      provider,
      authentication: "api-key" as const,
      apiKey: "owned-browser-test-key",
    };
    expect(await api.invoke("web.access.test", request)).toMatchObject({ provider, status: "pass" });
    expect((await api.invoke("web.access.get", {})).keys[provider].keyConfigured).toBe(false);
  },
);
it("ordinary workbench create/open preserves user notes without creating an example", async () => {
  const { api } = createMockApi();
  const folder = "/mock/user-project";
  const workbench = await api.invoke("workbench.create", { folder, name: "My project" });
  expect(workbench.folder).toBe(folder);
  expect(workbench.config.name).toBe("My project");
  await api.invoke("workbench.pinned.update", { content: "my project notes" });
  await api.invoke("workbench.close", {});
  await api.invoke("workbench.open", { folder });
  expect((await api.invoke("workbench.pinned.get", {})).content).toBe("my project notes");
});
it("mock skills create/edit/toggle isolate workbenches and reject stale or read-only mutations", async () => {
  const { api } = createMockApi();
  const wb = await api.invoke("workbench.create", { folder: "C:/mock/skills", name: "Skills" });
  const target = { workbenchId: wb.config.id, source: "workbench" as const, name: "reader" };
  const created = await api.invoke("skills.create", target);
  expect((await api.invoke("skills.list", { workbenchId: wb.config.id }))[0]).toMatchObject({
    name: "reader",
    enabled: true,
  });
  await api.invoke("skills.save", { ...target, content: "invalid", sha256: created.sha256 });
  await expect(
    api.invoke("skills.save", { ...target, content: "stale", sha256: created.sha256 }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect((await api.invoke("skills.list", { workbenchId: wb.config.id }))[0]?.error).toBeTruthy();
  await api.invoke("skills.toggle", { workbenchId: wb.config.id, name: "reader", enabled: false });
  expect((await api.invoke("skills.list", { workbenchId: wb.config.id }))[0]?.enabled).toBe(false);
  await api.invoke("workbench.create", { folder: "C:/mock/other-skills", name: "Other" });
  await expect(api.invoke("skills.open", target)).rejects.toMatchObject({ code: "CONFLICT" });
  const readOnly = createMockApi(undefined, "read-only").api;
  const recent = await readOnly.invoke("workbench.recent", {});
  const locked = await readOnly.invoke("workbench.open", { folder: recent[0]?.folder ?? "" });
  const lockedTarget = { workbenchId: locked.config.id, source: "user" as const, name: "reader" };
  expect(await readOnly.invoke("skills.list", { workbenchId: locked.config.id })).toEqual([]);
  await expect(readOnly.invoke("skills.create", lockedTarget)).rejects.toMatchObject({ code: "DENIED" });
  await expect(
    readOnly.invoke("skills.toggle", { workbenchId: locked.config.id, name: "reader", enabled: false }),
  ).rejects.toMatchObject({ code: "DENIED" });
});
// REQ-FUNC-9dd7413b
it("mock plugins install, list per workbench, toggle and uninstall in memory", async () => {
  const { api } = createMockApi();
  const a = await api.invoke("workbench.create", { folder: "C:/mock/plugins-a", name: "A" });
  const installed = await api.invoke("plugins.install", { path: "C:/plugins/esp32-esptool.zip" });
  expect(installed).toMatchObject({ id: "esp32-esptool", issues: [], source: "zip", tier: "local" });
  await api.invoke("plugins.toggle", { workbenchId: a.config.id, id: "esp32-esptool", enabled: true });
  expect(await api.invoke("plugins.list", { workbenchId: a.config.id })).toMatchObject([
    { id: "esp32-esptool", enabled: true },
  ]);
  const b = await api.invoke("workbench.create", { folder: "C:/mock/plugins-b", name: "B" });
  expect(await api.invoke("plugins.list", { workbenchId: b.config.id })).toMatchObject([
    { id: "esp32-esptool", enabled: false },
  ]);
  await expect(
    api.invoke("plugins.toggle", { workbenchId: a.config.id, id: "esp32-esptool", enabled: true }),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  await api.invoke("plugins.uninstall", { id: "esp32-esptool" });
  expect(await api.invoke("plugins.list", {})).toEqual([]);
  await expect(api.invoke("plugins.uninstall", { id: "esp32-esptool" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
});
// REQ-FUNC-13ef1c0c, REQ-FUNC-86daf060
it("mock plugins list and install their programs", async () => {
  const { api } = createMockApi();
  await api.invoke("plugins.install", { path: "C:/plugins/esp32-esptool.zip" });
  expect(await api.invoke("plugins.programs", { id: "esp32-esptool" })).toEqual([
    { name: "esp32-esptool", kind: "pip", state: "missing" },
  ]);
  expect(await api.invoke("plugins.provision", { id: "esp32-esptool" })).toEqual([
    { name: "esp32-esptool", kind: "pip", state: "ready", version: "1.0.0" },
  ]);
  expect(await api.invoke("plugins.programs", { id: "esp32-esptool" })).toMatchObject([{ state: "ready" }]);
  await expect(api.invoke("plugins.programs", { id: "other" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  await expect(api.invoke("plugins.provision", { id: "other" })).rejects.toMatchObject({ code: "NOT_FOUND" });
});
it("mock reindex obeys active-workbench ownership and strict empty request", async () => {
  const { api } = createMockApi();
  await expect(api.invoke("docs.reindex", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  await api.invoke("workbench.create", { folder: "C:/mock/ingest", name: "Ingest" });
  expect(await api.invoke("docs.reindex", {})).toEqual({});
  await expect(api.invoke("docs.reindex", { path: "bad" } as never)).rejects.toMatchObject({
    code: "INVALID",
  });
  const readOnly = createMockApi(undefined, "read-only").api;
  const recent = await readOnly.invoke("workbench.recent", {});
  await readOnly.invoke("workbench.open", { folder: recent[0]?.folder ?? "" });
  await expect(readOnly.invoke("docs.reindex", {})).rejects.toMatchObject({ code: "DENIED" });
});
it("mock OpenAI catalog is offline before auth and honors explicit model selection", async () => {
  const fixtureCredential = "fake-mock-key-private-123";
  const { api } = createMockApi();
  const before = await api.invoke("providers.models", { id: "openai" });
  expect(before.reachability).toBe("skipped");
  expect(before.models.length).toBeGreaterThan(0);
  const model = before.models[0]?.id;
  if (!model) throw Error("fixture model");
  await api.invoke("providers.save", { provider: "openai", apiKey: fixtureCredential });
  expect(await api.invoke("providers.models", { id: "openai" })).toEqual(before);
  const known = await api.invoke("providers.test", { id: "openai", model });
  expect(known.steps.map((s) => s.status)).toEqual(["pass", "pass", "pass", "pass"]);
  const missing = await api.invoke("providers.test", { id: "openai", model: "unknown-fixture" });
  expect(missing.steps.map((s) => s.status)).toEqual(["pass", "fail", "skipped", "skipped"]);
  expect(missing.steps[1]?.error?.code).toBe("NOT_FOUND");
});
it("mock custom override validates references and does not persist capability on another model", async () => {
  const { api } = createMockApi();
  await api.invoke("providers.save", {
    provider: "custom",
    config: { name: "Fixture", baseUrl: "http://localhost:11434/v1", model: "configured" },
  });
  const on = vi.fn();
  api.subscribe("app", on);
  await api.invoke("providers.test", { id: "custom:fixture", model: "alternate" });
  expect(on).not.toHaveBeenCalled();
  expect((await api.invoke("providers.list", {})).custom[0]?.supportsTools).toBeUndefined();
  const invalid = await api.invoke("providers.test", { id: "custom:fixture", model: "bad model" });
  expect(invalid.steps[1]).toMatchObject({ status: "fail", error: { code: "INVALID" } });
});
it("mock catalogs and connection results preserve four-step contract including failed tools", async () => {
  const { api } = createMockApi();
  await api.invoke("providers.save", {
    provider: "custom",
    config: {
      name: "No tools",
      baseUrl: "http://127.0.0.1:11434/v1",
      model: "mock/model",
      supportsTools: false,
    },
  });
  const catalog = await api.invoke("providers.models", { id: "custom:no-tools" });
  expect(catalog.models[0]).toMatchObject({ reference: "custom:no-tools/mock/model", contextWindow: 32768 });
  const test = await api.invoke("providers.test", { id: "custom:no-tools" });
  expect(test.steps.map((s) => s.status)).toEqual(["pass", "pass", "fail", "pass"]);
  await expect(api.invoke("providers.models", { id: "custom:missing" })).rejects.toMatchObject({
    code: "NOT_FOUND",
  });
  const failed = await api.invoke("providers.test", { id: "openai" });
  expect(failed.steps.map((s) => s.status)).toEqual(["fail", "fail", "skipped", "skipped"]);
});
beforeAll(async () => {
  const files = import.meta.glob("./mockApi.ts");
  expect(Object.keys(files), "in-memory mock boundary exists").toContain("./mockApi.ts");
  ({ createMockApi } = await import("./mockApi.js"));
});
it("mock provider metadata hides a full credential equal to the formatted hint", async () => {
  const { api } = createMockApi();
  const apiKey = "abc…defg";
  await api.invoke("providers.save", { provider: "openai", apiKey });
  await api.invoke("providers.save", {
    provider: "custom",
    apiKey,
    config: { name: "Fixture", baseUrl: "http://localhost:11434/v1", model: "fake" },
  });
  const providers = await api.invoke("providers.list", {});
  expect(providers.openai).toMatchObject({ configured: true, hint: null });
  expect(providers.custom[0]).toMatchObject({ configured: true, hint: null });
  expect(JSON.stringify(providers)).not.toContain(apiKey);
  expect(JSON.stringify(await api.getSettings())).not.toContain(apiKey);
});
it("mock settings use the same validated shape, immutable id and post-update events", async () => {
  const { api } = createMockApi();
  const get = () => api.invoke("app.settings.get", {});
  const initial = await get();
  expect(initial).toEqual({ settings: expect.objectContaining({ schemaVersion: 1, theme: "system" }) });
  const on = vi.fn();
  const stop = api.subscribe("app", on);
  await api.invoke("app.settings.update", { theme: "dark" });
  expect(await get()).toMatchObject({
    settings: { theme: "dark", installationId: initial.settings.installationId },
  });
  expect(on).toHaveBeenCalledExactlyOnceWith({ type: "settings.changed" });
  await api.invoke("app.settings.update", {});
  expect(on).toHaveBeenCalledTimes(1);
  await expect(
    api.invoke("app.settings.update", { providers: { token: "secret" } } as never),
  ).rejects.toMatchObject({ code: "INVALID" });
  const snapshot = await get();
  snapshot.settings.theme = "light";
  expect((await get()).settings.theme).toBe("dark");
  stop();
});
it("validates mock invoke and owns independent app subscription lifecycle", async () => {
  const info = {
    name: "VERA",
    version: "0.0.0",
    platform: "linux",
    arch: "x64",
    portable: false,
    testBuild: false,
    signing: "unsigned" as const,
    locale: "en",
  };
  const { api, emitAppEvent } = createMockApi(info);
  expect(await api.getAppInfo()).toEqual(info);
  expect(await api.invoke("app.info", {})).toEqual(info);
  await expect(
    api.invoke("app.info", { extra: true } as unknown as Request<"app.info">),
  ).rejects.toMatchObject({ code: "INVALID" });
  const on = vi.fn();
  const stop = api.subscribe("app", on);
  emitAppEvent({ type: "settings.changed" });
  expect(on).toHaveBeenCalledExactlyOnceWith({ type: "settings.changed" });
  stop();
  stop();
  emitAppEvent({ type: "settings.changed" });
  expect(on).toHaveBeenCalledTimes(1);
  const invalidFixture = createMockApi({ ...info, version: "" });
  await expect(invalidFixture.api.getAppInfo()).rejects.toMatchObject({ code: "INTERNAL" });
});
it("mock workbench create/config/pinned/recents use validated contracts and scoped events", async () => {
  const { api } = createMockApi();
  expect(await api.invoke("app.chooseFolder", {})).toEqual({ folder: "/mock/new-board" });
  const snapshot = await api.invoke("workbench.create", { folder: "/mock/new-board", name: "Board" });
  const on = vi.fn();
  const stop = api.subscribe("workbench", snapshot.config.id, on);
  await api.invoke("workbench.config.update", { patch: { name: "Renamed" } });
  expect(on).toHaveBeenCalledWith(expect.objectContaining({ type: "config.changed" }));
  expect(await api.invoke("workbench.pinned.update", { content: "Context" })).toEqual({
    content: "Context",
    oversized: false,
  });
  await api.invoke("workbench.close", {});
  expect(on).toHaveBeenCalledWith({ type: "closed" });
  stop();
  expect(await api.invoke("workbench.recent", {})).toEqual([
    expect.objectContaining({ folder: "/mock/new-board", missing: false }),
  ]);
  await api.invoke("workbench.open", { folder: "/mock/new-board" });
  expect((await api.invoke("workbench.config.get", {})).config.name).toBe("Renamed");
  expect(await api.invoke("workbench.recent", { remove: "/mock/new-board" })).toEqual([]);
});
it("mock read-only/missing/warnings fixtures expose UI states and deny saves", async () => {
  const { api } = createMockApi(undefined, "read-only");
  const recent = await api.invoke("workbench.recent", {});
  expect(recent[0]?.missing).toBe(false);
  const snapshot = await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  expect(snapshot.readOnly).toBe(true);
  await expect(api.invoke("workbench.pinned.update", { content: "bad" })).rejects.toMatchObject({
    code: "DENIED",
  });
  await expect(api.invoke("workbench.config.update", { patch: { name: "bad" } })).rejects.toMatchObject({
    code: "DENIED",
  });
  expect((await createMockApi(undefined, "missing").api.invoke("workbench.recent", {}))[0]?.missing).toBe(
    true,
  );
  const warnings = await createMockApi(undefined, "warnings").api.invoke("workbench.open", {
    folder: "/mock/demo-board",
  });
  expect(warnings.warnings).toContainEqual({ code: "NETWORK_SHARE_UNSUPPORTED" });
});
