import { existsSync } from "node:fs";
import { type AppEvent, type Channel, defaultSettings, type Request, type Response } from "@vera/shared";
import { beforeAll, expect, expectTypeOf, it, vi } from "vitest";

let createBridge: typeof import("./bridge.js").createBridge;
beforeAll(async () => {
  expect(existsSync(new URL("./bridge.ts", import.meta.url)), "typed preload bridge exists").toBe(true);
  ({ createBridge } = await import("./bridge.js"));
});
const info = {
  name: "VERA",
  version: "1.2.3",
  platform: "linux",
  arch: "x64",
  portable: false,
  locale: "en",
};
function fixture() {
  const listeners = new Set<(event: unknown, payload: unknown) => void>();
  const transport = {
    invoke: vi.fn(async () => ({ ok: true, value: info })),
    on: vi.fn((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((_channel: string, listener: (event: unknown, payload: unknown) => void) => {
      listeners.delete(listener);
    }),
  };
  return { transport, listeners, bridge: createBridge(transport) };
}
it("infers registry types and returns validated metadata", async () => {
  expectTypeOf<Channel>().toEqualTypeOf<
    | "providers.models"
    | "providers.test"
    | "providers.list"
    | "providers.save"
    | "providers.remove"
    | "app.info"
    | "app.settings.get"
    | "app.settings.update"
    | "app.chooseFolder"
    | "workbench.create"
    | "workbench.open"
    | "workbench.close"
    | "workbench.recent"
    | "workbench.config.get"
    | "workbench.config.update"
    | "workbench.pinned.get"
    | "workbench.pinned.update"
    | "workbench.files"
  >();
  expectTypeOf<Response<"app.info">>().toEqualTypeOf<typeof info>();
  expectTypeOf<Request<"app.info">>().toEqualTypeOf<Record<string, never>>();
  const { bridge, transport } = fixture();
  expect(await bridge.invoke("app.info", {})).toEqual(info);
  expect(transport.invoke).toHaveBeenCalledWith("vera:invoke", "app.info", {});
});
it("transports settings snapshots and rejects secret/immutable patches before IPC", async () => {
  const { bridge, transport } = fixture();
  const snapshot = { settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19"), readOnly: true };
  transport.invoke.mockResolvedValueOnce({ ok: true, value: snapshot } as never);
  expect(await bridge.invoke("app.settings.get", {})).toEqual(snapshot);
  await expect(
    bridge.invoke("app.settings.update", { installationId: "immutable" } as never),
  ).rejects.toMatchObject({ code: "INVALID" });
  await expect(
    bridge.invoke("app.settings.update", { providers: { apiKey: "secret" } } as never),
  ).rejects.toMatchObject({ code: "INVALID" });
  expect(transport.invoke).toHaveBeenCalledTimes(1);
});
it("rejects invalid input before transport and preserves a VeraError result", async () => {
  const { bridge, transport } = fixture();
  await expect(
    // @ts-expect-error Extra properties are excluded by the channel request schema.
    bridge.invoke("app.info", { extra: true }),
  ).rejects.toMatchObject({ code: "INVALID" });
  // @ts-expect-error An unregistered channel is rejected at compile time and at runtime.
  await expect(bridge.invoke("unknown", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
  expect(transport.invoke).not.toHaveBeenCalled();
  transport.invoke.mockResolvedValueOnce({
    ok: false,
    error: { code: "BUSY", messageKey: "errors.BUSY" },
  } as never);
  await expect(bridge.invoke("app.info", {})).rejects.toEqual({ code: "BUSY", messageKey: "errors.BUSY" });
});
it("maps broken result/transport to INTERNAL without exposing native exception text", async () => {
  const { bridge, transport } = fixture();
  transport.invoke.mockResolvedValueOnce({ ok: true, value: { ...info, version: "" } });
  await expect(bridge.invoke("app.info", {})).rejects.toEqual({
    code: "INTERNAL",
    messageKey: "errors.INTERNAL",
  });
  transport.invoke.mockRejectedValueOnce(new Error("private-token"));
  await expect(bridge.invoke("app.info", {})).rejects.toEqual({
    code: "INTERNAL",
    messageKey: "errors.INTERNAL",
  });
  transport.invoke.mockResolvedValueOnce({ ok: false, error: { code: "FAKE", messageKey: "raw" } } as never);
  await expect(bridge.invoke("app.info", {})).rejects.toMatchObject({ code: "INTERNAL" });
});
it("delivers only app event data, validates envelopes and cleans independent subscriptions", () => {
  const { bridge, transport, listeners } = fixture();
  const on = vi.fn<(event: AppEvent) => void>();
  const second = vi.fn();
  const stop = bridge.subscribe("app", on);
  const stopSecond = bridge.subscribe("app", second);
  const envelope = { topic: "app", id: "app", event: { type: "settings.changed" } };
  const emit = (payload: unknown) => {
    for (const listener of listeners) listener({ sender: "must not leak" }, payload);
  };
  emit(envelope);
  expect(on).toHaveBeenCalledExactlyOnceWith({ type: "settings.changed" });
  emit({ ...envelope, topic: "session" });
  emit({ ...envelope, id: "foreign" });
  emit({ ...envelope, seq: -1 });
  emit({ ...envelope, event: { type: "unknown" } });
  expect(on).toHaveBeenCalledTimes(1);
  stop();
  stop();
  emit(envelope);
  expect(on).toHaveBeenCalledTimes(1);
  expect(second).toHaveBeenCalledTimes(2);
  expect(transport.removeListener).toHaveBeenCalledTimes(1);
  stopSecond();
  expect(listeners.size).toBe(0);
});
it("workbench subscriptions filter id/schema and validate config/pinned/completion channel boundaries", async () => {
  const { bridge, transport, listeners } = fixture();
  const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  const on = vi.fn();
  const stop = bridge.subscribe("workbench", id, on);
  for (const payload of [
    { topic: "workbench", id, event: { type: "closed" } },
    { topic: "workbench", id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0D", event: { type: "closed" } },
    { topic: "workbench", id, event: { type: "bad" } },
  ])
    for (const listener of listeners) listener({}, payload);
  expect(on).toHaveBeenCalledExactlyOnceWith({ type: "closed" });
  stop();
  expect(listeners.size).toBe(0);
  transport.invoke.mockResolvedValueOnce({ ok: true, value: { folder: "/bench" } } as never);
  expect(await bridge.invoke("app.chooseFolder", {})).toEqual({ folder: "/bench" });
  transport.invoke.mockResolvedValueOnce({ ok: true, value: ["docs/pinout.csv"] } as never);
  expect(await bridge.invoke("workbench.files", { query: "pin" })).toEqual(["docs/pinout.csv"]);
  await expect(
    bridge.invoke("workbench.config.update", { patch: { id: "bad" } } as never),
  ).rejects.toMatchObject({ code: "INVALID" });
});
