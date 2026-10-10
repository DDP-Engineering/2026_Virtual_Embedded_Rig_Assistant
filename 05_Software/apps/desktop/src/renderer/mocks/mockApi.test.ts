import type { Request } from "@vera/shared";
import { beforeAll, expect, it, vi } from "vitest";

let createMockApi: typeof import("./mockApi.js").createMockApi;
beforeAll(async () => {
  const files = import.meta.glob("./mockApi.ts");
  expect(Object.keys(files), "in-memory mock boundary exists").toContain("./mockApi.ts");
  ({ createMockApi } = await import("./mockApi.js"));
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
