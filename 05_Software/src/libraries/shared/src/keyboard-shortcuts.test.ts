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

// REQ-UX-17662553
test("bookmark commands have valid distinct defaults and editable serialized bindings", async () => {
  const { commandBindings, shortcutOverridesSchema } = await import("./keyboard-shortcuts.js");
  expect(commandBindings("nextBookmark")).toEqual(["Mod+Alt+N"]);
  expect(commandBindings("previousBookmark")).toEqual(["Mod+Alt+P"]);
  expect(shortcutOverridesSchema.safeParse({}).success).toBe(true);
  expect(shortcutOverridesSchema.safeParse({ settings: ["Mod+Alt+N"] }).success).toBe(false);
  const initial = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  const keyboardShortcuts = { nextBookmark: ["Mod+Shift+U"], previousBookmark: [] };
  const saved = settingsSchema.parse(
    JSON.parse(JSON.stringify(mergeSettings(initial, settingsPatchSchema.parse({ keyboardShortcuts })))),
  );
  expect(commandBindings("nextBookmark", saved.keyboardShortcuts)).toEqual(["Mod+Shift+U"]);
  expect(commandBindings("previousBookmark", saved.keyboardShortcuts)).toEqual([]);
  expect(commandBindings("nextBookmark", {})).toEqual(["Mod+Alt+N"]);
});

test("dictation mode and an unassigned or conflict-free shortcut use the existing settings contract", () => {
  const initial = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  const patch = settingsPatchSchema.safeParse({
    dictationRecordingMode: "toggle",
    keyboardShortcuts: { dictate: ["Mod+Shift+U"] },
  });
  expect(patch.success).toBe(true);
  if (!patch.success) return;
  const saved = settingsSchema.parse(JSON.parse(JSON.stringify(mergeSettings(initial, patch.data))));
  expect(saved).toMatchObject({
    dictationRecordingMode: "toggle",
    keyboardShortcuts: { dictate: ["Mod+Shift+U"] },
  });
  expect(settingsPatchSchema.safeParse({ dictationRecordingMode: "hold" }).success).toBe(true);
  expect(settingsPatchSchema.safeParse({ dictationRecordingMode: "unknown" }).success).toBe(false);
  for (const binding of ["Mod+N", "Mod+C"])
    expect(settingsPatchSchema.safeParse({ keyboardShortcuts: { dictate: [binding] } }).success).toBe(false);
});
