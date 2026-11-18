import { expect, it } from "vitest";
import { appEventSchema, settingsChangedEvent } from "./events.js";
import { defaultSettings, mergeSettings } from "./settings.js";

it("marks a settings change as masking-neutral only when nothing but presentation settings differ", () => {
  const current = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  const neutral = { type: "settings.changed", masking: false };
  const reload = { type: "settings.changed" };
  expect(settingsChangedEvent(current, mergeSettings(current, { theme: "dark", language: "de" }))).toEqual(
    neutral,
  );
  expect(appEventSchema.parse(neutral)).toEqual(neutral);
  // Masking, providers and every setting not known to be presentation-only keep the reload.
  const patches: Parameters<typeof mergeSettings>[1][] = [
    { privacy: { mask: { display: false } } },
    { theme: "dark", privacy: { mask: { runs: true } } },
    { providers: { openai: { model: "gpt-5" }, custom: [] } },
    { shell: "bash" },
  ];
  for (const patch of patches)
    expect(settingsChangedEvent(current, mergeSettings(current, patch))).toEqual(reload);
  expect(settingsChangedEvent(undefined, current)).toEqual(reload);
  expect(settingsChangedEvent(current, current)).toEqual(reload);
  expect(appEventSchema.safeParse({ type: "settings.changed", masking: true }).success).toBe(false);
});
