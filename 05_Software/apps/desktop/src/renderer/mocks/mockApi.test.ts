import type { Request } from "@vera/shared";
import { beforeAll, expect, it, vi } from "vitest";

let createMockApi: typeof import("./mockApi.js").createMockApi;
beforeAll(async () => {
  const files = import.meta.glob("./mockApi.ts");
  expect(Object.keys(files), "in-memory mock boundary exists").toContain("./mockApi.ts");
  ({ createMockApi } = await import("./mockApi.js"));
});
it("mock settings use the same validated shape, immutable id and post-update events", async () => {
  const { api } = createMockApi();
  const get = () => api.invoke("app.settings.get", {});
  const initial = await get();
  expect(initial).toMatchObject({ readOnly: false, settings: { schemaVersion: 1, theme: "system" } });
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
