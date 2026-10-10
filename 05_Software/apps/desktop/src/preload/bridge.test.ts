import { existsSync } from "node:fs";
import type { AppEvent, Channel, Request, Response } from "@vera/shared";
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
  expectTypeOf<Channel>().toEqualTypeOf<"app.info">();
  expectTypeOf<Response<"app.info">>().toEqualTypeOf<typeof info>();
  expectTypeOf<Request<"app.info">>().toEqualTypeOf<Record<string, never>>();
  const { bridge, transport } = fixture();
  expect(await bridge.invoke("app.info", {})).toEqual(info);
  expect(transport.invoke).toHaveBeenCalledWith("vera:invoke", "app.info", {});
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
