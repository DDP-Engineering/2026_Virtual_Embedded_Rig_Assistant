import type { AppEvent, VeraBridge } from "@vera/shared";
import { afterAll, beforeAll, expect, it, vi } from "vitest";

let createIpcApi: typeof import("./ipc.js").createIpcApi;
beforeAll(async () => {
  vi.stubGlobal("window", {});
  ({ createIpcApi } = await import("./ipc.js"));
});
afterAll(() => vi.unstubAllGlobals());
const info = {
  name: "VERA",
  version: "1.2.3",
  platform: "linux",
  arch: "x64",
  portable: false,
  locale: "en",
};
it("validates an injected bridge response and translates transport failure to a safe error", async () => {
  const invoke = vi.fn(async () => info);
  const subscribe = vi.fn();
  const api = createIpcApi({ invoke: invoke as VeraBridge["invoke"], subscribe });
  expect(await api.getAppInfo()).toEqual(info);
  invoke.mockResolvedValueOnce({ ...info, version: "" });
  await expect(api.getAppInfo()).rejects.toMatchObject({ code: "INTERNAL" });
  invoke.mockRejectedValueOnce(new Error("secret"));
  await expect(api.getAppInfo()).rejects.toEqual({ code: "INTERNAL", messageKey: "errors.INTERNAL" });
  invoke.mockRejectedValueOnce({ code: "BUSY", messageKey: "errors.BUSY" });
  await expect(api.getAppInfo()).rejects.toEqual({ code: "BUSY", messageKey: "errors.BUSY" });
  await expect(createIpcApi(undefined).getAppInfo()).rejects.toMatchObject({ code: "INTERNAL" });
});
it("filters invalid bridge events and returns its cleanup", () => {
  const stop = vi.fn();
  let callback: (event: AppEvent) => void = () => {};
  const bridge: VeraBridge = {
    invoke: async () => {
      throw new Error("unused");
    },
    subscribe: (_topic, on) => {
      callback = on;
      return stop;
    },
  };
  const on = vi.fn();
  const cleanup = createIpcApi(bridge).subscribe("app", on);
  callback({ type: "unknown" } as never);
  callback({ type: "settings.changed" });
  expect(on).toHaveBeenCalledExactlyOnceWith({ type: "settings.changed" });
  cleanup();
  expect(stop).toHaveBeenCalledTimes(1);
});
