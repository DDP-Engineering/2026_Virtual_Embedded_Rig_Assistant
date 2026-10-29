import { expect, test } from "vitest";
import { defaultSettings, mergeSettings, settingsPatchSchema, settingsSchema } from "./settings.js";

test("shortcut deletion and reassignment survive settings serialization and replacement reset", () => {
  const initial = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  const patch = settingsPatchSchema.parse({
    keyboardShortcuts: { newSession: [], settings: ["Mod+Shift+P"] },
  });
  const saved = settingsSchema.parse(JSON.parse(JSON.stringify(mergeSettings(initial, patch))));
  expect(saved.keyboardShortcuts).toEqual(patch.keyboardShortcuts);
  expect(mergeSettings(saved, { keyboardShortcuts: {} }).keyboardShortcuts).toEqual({});
});

test("invalid keys, native editing combinations, duplicate/default conflicts and unknown commands are rejected", () => {
  for (const keyboardShortcuts of [
    { settings: ["Mod+C"] },
    { settings: ["Alt+P"] },
    { unknown: [] },
    { settings: ["Mod+N"] },
    { newSession: ["Mod+P", "Mod+P"] },
  ])
    expect(settingsPatchSchema.safeParse({ keyboardShortcuts }).success).toBe(false);
  expect(
    settingsPatchSchema.safeParse({ keyboardShortcuts: { newSession: [], settings: ["Mod+N"] } }).success,
  ).toBe(true);
});
