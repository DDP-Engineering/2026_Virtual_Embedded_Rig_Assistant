import { existsSync } from "node:fs";
import { defaultSettings } from "@vera/shared";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const info = {
  name: "VERA",
  version: "0.0.0",
  platform: "win32",
  arch: "x64",
  portable: false,
  testBuild: false,
  signing: "unsigned" as const,
  locale: "en-US",
};
let createInvokeRouter: typeof import("./ipc-router.js").createInvokeRouter;
const unused = () => {
  throw { code: "NOT_FOUND", messageKey: "errors.NOT_FOUND" };
};
const workbenchHandlers = {
  "window.menu": unused,
  "update.get": unused,
  "update.check": unused,
  "update.download": unused,
  "update.restart": unused,
  "update.openRelease": unused,
  "skills.list": unused,
  "skills.open": unused,
  "skills.create": unused,
  "skills.save": unused,
  "skills.toggle": unused,
  "plugins.list": unused,
  "plugins.install": unused,
  "plugins.promote": unused,
  "plugins.export": unused,
  "plugins.uninstall": unused,
  "plugins.toggle": unused,
  "plugins.programs": unused,
  "plugins.provision": unused,
  "plugins.choose": unused,
  "plugins.review": unused,
  "plugins.catalog": unused,
  "plugins.catalogReview": unused,
  "plugins.catalogInstall": unused,
  "runs.list": unused,
  "runs.log": unused,
  "runs.stop": unused,
  "docs.list": unused,
  "downloads.list": unused,
  "downloads.open": unused,
  "downloads.reveal": unused,
  "docs.volume": unused,
  "docs.tree": unused,
  "docs.find": unused,
  "docs.read": unused,
  "docs.stat": unused,
  "docs.openers": unused,
  "docs.openWith": unused,
  "docs.reveal": unused,
  "docs.copyPath": unused,
  "docs.systemApps": unused,
  "docs.openSystemApp": unused,
  "docs.search": unused,
  "docs.open": unused,
  "docs.reindex": unused,
  "indexer.status": unused,
  "indexer.restart": unused,
  "app.openExternal": unused,
  "providers.chatgpt.login": unused,
  "providers.chatgpt.status": unused,
  "web.access.get": unused,
  "web.access.save": unused,
  "web.access.removeKey": unused,
  "web.access.test": unused,
  "web.access.cancel": unused,
  "providers.chatgpt.cancel": unused,
  "providers.chatgpt.logout": unused,

  "artifacts.list": unused,
  "artifacts.open": unused,
  "artifacts.reveal": unused,
  "artifacts.export": unused,
  "changes.list": unused,
  "changes.get": unused,
  "app.revealPath": unused,
  "app.openPath": unused,
  "session.approval.decide": unused,
  "session.list": unused,
  "session.search": unused,
  "session.export": unused,
  "session.create": unused,
  "session.revision": unused,
  "session.get": unused,
  "session.rename": unused,
  "session.archive.set": unused,
  "session.move": unused,
  "session.delete": unused,
  "session.send": unused,
  "session.stop": unused,
  "session.model.set": unused,
  "session.reasoning.get": unused,
  "session.reasoning.set": unused,
  "session.mode.set": unused,
  "providers.discover": unused,
  "providers.models": unused,
  "providers.test": unused,
  "providers.list": unused,
  "providers.save": unused,
  "providers.remove": unused,
  "app.chooseFolder": unused,
  "workbench.inspect": unused,
  "workbench.scanDocs": unused,
  "workbench.previewDocs": unused,
  "workbench.relativeFolder": unused,
  "workbench.create": unused,
  "workbench.open": unused,
  "workbench.close": unused,
  "workbench.recent": unused,
  "workbench.config.get": unused,
  "workbench.config.update": unused,
  "workbench.pinned.get": unused,
  "workbench.pinned.update": unused,
  "workbench.files": unused,
};
beforeAll(async () => {
  expect(existsSync(new URL("./ipc-router.ts", import.meta.url)), "validated IPC router exists").toBe(true);
  ({ createInvokeRouter } = await import("./ipc-router.js"));
});

describe("validated invoke router", () => {
  const frame = { url: "vera://app/index.html" };
  const contents = { mainFrame: frame, isDestroyed: () => false };
  const event = { sender: contents, senderFrame: frame };
  let handler = vi.fn(async () => info);
  let log = vi.fn();
  const router = () =>
    createInvokeRouter({
      target: () => ({ webContents: contents, url: "vera://app/index.html" }),
      handlers: {
        ...workbenchHandlers,
        "app.info": handler,
        "app.settings.get": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
        "app.settings.update": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
      },
      log,
    });
  beforeEach(() => {
    handler = vi.fn(async () => info);
    log = vi.fn();
    frame.url = "vera://app/index.html";
  });
  it("dispatches a registered channel with validated metadata", async () => {
    expect(await router()(event, "app.info", {})).toEqual({ ok: true, value: info });
    expect(handler).toHaveBeenCalledWith({});
    expect(log).not.toHaveBeenCalled();
  });
  it("dispatches settings patches only after strict validation and validates the snapshot", async () => {
    const snapshot = { settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19") };
    const update = vi.fn(async () => ({
      ...snapshot,
      settings: { ...snapshot.settings, theme: "dark" as const },
    }));
    const invoke = createInvokeRouter({
      target: () => ({ webContents: contents, url: frame.url }),
      handlers: {
        ...workbenchHandlers,
        "app.info": handler,
        "app.settings.get": () => snapshot,
        "app.settings.update": update,
      },
      log,
    });
    expect(await invoke(event, "app.settings.get", {})).toEqual({ ok: true, value: snapshot });
    expect(await invoke(event, "app.settings.update", { theme: "dark" })).toMatchObject({
      ok: true,
      value: { settings: { theme: "dark" } },
    });
    expect(update).toHaveBeenCalledExactlyOnceWith({ theme: "dark" });
    for (const patch of [{ schemaVersion: 2 }, { providers: { apiKey: "secret" } }, { theme: "unknown" }])
      expect(await invoke(event, "app.settings.update", patch)).toMatchObject({
        ok: false,
        error: { code: "INVALID" },
      });
    expect(update).toHaveBeenCalledTimes(1);
    update.mockResolvedValueOnce({ ...snapshot, settings: { ...snapshot.settings, theme: "bad" } } as never);
    expect(await invoke(event, "app.settings.update", {})).toMatchObject({
      ok: false,
      error: { code: "INTERNAL" },
    });
    expect(log).toHaveBeenCalledWith({ channel: "app.settings.update", reason: "response" });
  });
  it.each(["missing", "__proto__", "constructor", "toString"])(
    "rejects unknown channel %s",
    async (channel) => {
      expect(await router()(event, channel, {})).toEqual({
        ok: false,
        error: { code: "NOT_FOUND", messageKey: "errors.NOT_FOUND" },
      });
      expect(handler).not.toHaveBeenCalled();
    },
  );
  it.each([null, undefined, [], { extra: true }, "bad"])("rejects invalid request %j", async (request) => {
    expect(await router()(event, "app.info", request)).toEqual({
      ok: false,
      error: { code: "INVALID", messageKey: "errors.INVALID" },
    });
    expect(handler).not.toHaveBeenCalled();
  });
  it("denies foreign contents, child/null frames, wrong URL and destroyed contents before dispatch", async () => {
    const invoke = router();
    const foreign = { mainFrame: frame, isDestroyed: () => false };
    for (const rejected of [
      { sender: foreign, senderFrame: frame },
      { sender: contents, senderFrame: { url: frame.url } },
      { sender: contents, senderFrame: null },
    ]) {
      expect(await invoke(rejected, "app.info", {})).toMatchObject({ ok: false, error: { code: "DENIED" } });
    }
    frame.url = "https://foreign.invalid/";
    expect(await invoke(event, "app.info", {})).toMatchObject({ ok: false, error: { code: "DENIED" } });
    frame.url = "vera://app/index.html";
    const destroyed = { mainFrame: frame, isDestroyed: () => true };
    const deadRouter = createInvokeRouter({
      target: () => ({ webContents: destroyed, url: frame.url }),
      handlers: {
        ...workbenchHandlers,
        "app.info": handler,
        "app.settings.get": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
        "app.settings.update": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
      },
      log,
    });
    expect(await deadRouter({ sender: destroyed, senderFrame: frame }, "app.info", {})).toMatchObject({
      ok: false,
      error: { code: "DENIED" },
    });
    expect(handler).not.toHaveBeenCalled();
  });
  it("denies when no live app window exists and allows the exact dev renderer", async () => {
    const missing = createInvokeRouter({
      target: () => undefined,
      handlers: {
        ...workbenchHandlers,
        "app.info": handler,
        "app.settings.get": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
        "app.settings.update": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
      },
      log,
    });
    expect(await missing(event, "app.info", {})).toMatchObject({ ok: false, error: { code: "DENIED" } });
    frame.url = "http://127.0.0.1:5173/";
    const dev = createInvokeRouter({
      target: () => ({ webContents: contents, url: frame.url }),
      handlers: {
        ...workbenchHandlers,
        "app.info": handler,
        "app.settings.get": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
        "app.settings.update": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
      },
      log,
    });
    expect(await dev(event, "app.info", {})).toMatchObject({ ok: true });
  });
  it("denies a detached native frame whose URL inspection throws", async () => {
    const detached = {
      get url(): string {
        throw new Error("Frame has been disposed");
      },
    };
    const detachedContents = { mainFrame: detached, isDestroyed: () => false };
    const invoke = createInvokeRouter({
      target: () => ({ webContents: detachedContents, url: "vera://app/index.html" }),
      handlers: {
        ...workbenchHandlers,
        "app.info": handler,
        "app.settings.get": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
        "app.settings.update": () => ({
          settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"),
        }),
      },
      log,
    });
    await expect(
      invoke({ sender: detachedContents, senderFrame: detached }, "app.info", {}),
    ).resolves.toMatchObject({ ok: false, error: { code: "DENIED" } });
    expect(handler).not.toHaveBeenCalled();
  });
  it("maps an invalid response to logged INTERNAL and remains usable", async () => {
    handler.mockResolvedValueOnce({ ...info, version: "" });
    expect(await router()(event, "app.info", {})).toEqual({
      ok: false,
      error: { code: "INTERNAL", messageKey: "errors.INTERNAL" },
    });
    expect(log).toHaveBeenCalledWith({ channel: "app.info", reason: "response" });
    expect(await router()(event, "app.info", {})).toMatchObject({ ok: true });
  });
  it("rejects missing fields in a handler response", async () => {
    handler.mockResolvedValueOnce({ name: "VERA" } as never);
    expect(await router()(event, "app.info", {})).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(log).toHaveBeenCalledWith({ channel: "app.info", reason: "response" });
  });
  it("maps unknown throws safely, preserves declared VeraError and guards a failing logger", async () => {
    handler.mockRejectedValueOnce(new Error("secret-token"));
    expect(await router()(event, "app.info", {})).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
    const known = { code: "BUSY", messageKey: "errors.BUSY", params: { count: 2 } };
    handler.mockRejectedValueOnce(known);
    expect(await router()(event, "app.info", {})).toEqual({ ok: false, error: known });
    log.mockImplementation(() => {
      throw new Error("logger failure");
    });
    handler.mockRejectedValueOnce(new Error("unknown"));
    expect(await router()(event, "app.info", {})).toMatchObject({ ok: false, error: { code: "INTERNAL" } });
  });
});
