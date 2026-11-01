import { type AppEvent, defaultSettings, type VeraBridge } from "@vera/shared";
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
  testBuild: false,
  signing: "unsigned" as const,
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
      if (typeof on === "function") callback = on;
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
it("API settings conveniences validate snapshots and partial updates", async () => {
  const snapshot = { settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19") };
  const invoke = vi.fn(async () => snapshot);
  const api = createIpcApi({ invoke: invoke as VeraBridge["invoke"], subscribe: vi.fn() });
  expect(await api.getSettings()).toEqual(snapshot);
  expect(await api.updateSettings({ theme: "dark" })).toEqual(snapshot);
  expect(invoke).toHaveBeenLastCalledWith("app.settings.update", { theme: "dark" });
  invoke.mockResolvedValueOnce({ settings: { ...snapshot.settings, schemaVersion: 4 } } as never);
  await expect(api.getSettings()).rejects.toMatchObject({ code: "INTERNAL" });
  await expect(api.updateSettings({ theme: "invalid" } as never)).rejects.toMatchObject({ code: "INVALID" });
});
