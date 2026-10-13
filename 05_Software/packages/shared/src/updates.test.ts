import { expect, it } from "vitest";
import { appEventSchema } from "./events.js";
import { channels } from "./ipc.js";
import { defaultSettings, mergeSettings, settingsPatchSchema } from "./settings.js";

it("persists all update modes/channels with extension data and strict patches", () => {
  const current = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  for (const mode of ["off", "notify", "download"] as const)
    for (const channel of ["latest", "beta"] as const) {
      expect(settingsPatchSchema.safeParse({ updates: { mode, channel } }).success).toBe(true);
      expect(mergeSettings(current, { updates: { mode, channel } } as never).updates).toMatchObject({
        mode,
        channel,
      });
    }
  expect(settingsPatchSchema.safeParse({ updates: { url: "https://foreign.invalid" } }).success).toBe(false);
  expect(settingsPatchSchema.safeParse({ updates: { mode: "silent-install" } }).success).toBe(false);
});

it("exposes strict update actions and typed available events", () => {
  for (const name of [
    "update.get",
    "update.check",
    "update.download",
    "update.restart",
    "update.openRelease",
  ]) {
    expect(Object.hasOwn(channels, name), name).toBe(true);
  }
  expect(
    appEventSchema.safeParse({ type: "update.available", version: "0.0.1", notes: "Notes" }).success,
  ).toBe(true);
});
