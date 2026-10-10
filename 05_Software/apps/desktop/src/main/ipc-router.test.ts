import { existsSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const info = {
  name: "VERA",
  version: "0.0.0",
  platform: "win32",
  arch: "x64",
  portable: false,
  locale: "en-US",
};
let createInvokeRouter: typeof import("./ipc-router.js").createInvokeRouter;
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
      handlers: { "app.info": handler },
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
      handlers: { "app.info": handler },
      log,
    });
    expect(await deadRouter({ sender: destroyed, senderFrame: frame }, "app.info", {})).toMatchObject({
      ok: false,
      error: { code: "DENIED" },
    });
    expect(handler).not.toHaveBeenCalled();
  });
  it("denies when no live app window exists and allows the exact dev renderer", async () => {
    const missing = createInvokeRouter({ target: () => undefined, handlers: { "app.info": handler }, log });
    expect(await missing(event, "app.info", {})).toMatchObject({ ok: false, error: { code: "DENIED" } });
    frame.url = "http://127.0.0.1:5173/";
    const dev = createInvokeRouter({
      target: () => ({ webContents: contents, url: frame.url }),
      handlers: { "app.info": handler },
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
      handlers: { "app.info": handler },
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
