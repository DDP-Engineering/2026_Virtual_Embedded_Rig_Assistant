import { z } from "zod";
import { shortcutOverridesSchema } from "./keyboard-shortcuts.js";
import { modelReferenceSchema, providerSettingsSchema } from "./providers.js";
import { updateChannelSchema, updateModeSchema } from "./updates.js";
import { workbenchIdSchema } from "./workbench.js";

export const recentWorkbenchSchema = z.looseObject({
  folder: z.string().min(1),
  id: workbenchIdSchema,
  name: z.string().min(1).max(80),
  lastOpened: z.iso.datetime(),
  pinned: z.boolean().optional(),
});
export const recentWorkbenchStateSchema = recentWorkbenchSchema.extend({ missing: z.boolean() });
export type RecentWorkbench = z.infer<typeof recentWorkbenchSchema>;
export type RecentWorkbenchState = z.infer<typeof recentWorkbenchStateSchema>;

/** Optional font-size overrides select these built-in sizes when unset. */
export const typographyDefaults = { chatFontSize: 14, codeFontSize: 14 } as const;
const fontSizeSchema = z.union([
  z.literal(10),
  z.literal(12),
  z.literal(14),
  z.literal(16),
  z.literal(20),
  z.literal(24),
]);
const mutable = {
  suppressBypassWarning: z.boolean().optional(),
  keyboardShortcuts: shortcutOverridesSchema.optional(),
  language: z.enum(["system", "en", "ro", "de"]),
  theme: z.enum(["system", "light", "dark"]),
  textScale: z.union([
    z.literal(0.75),
    z.literal(0.875),
    z.literal(1),
    z.literal(1.125),
    z.literal(1.25),
    z.literal(1.5),
  ]),
  chatFontSize: fontSizeSchema.optional(),
  codeFontSize: fontSizeSchema.optional(),
  defaultModel: modelReferenceSchema.nullable(),
  providers: providerSettingsSchema,
  updates: z.looseObject({ mode: updateModeSchema, channel: updateChannelSchema }),
  recentWorkbenches: z.array(recentWorkbenchSchema),
  limits: z.looseObject({ maxToolCallsPerTurn: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
};

export const settingsSchema = z.looseObject({
  schemaVersion: z.literal(4),
  installationId: z.uuid(),
  ...mutable,
});
export const settingsPatchSchema = z.strictObject({
  suppressBypassWarning: mutable.suppressBypassWarning,
  keyboardShortcuts: mutable.keyboardShortcuts,
  language: mutable.language.optional(),
  theme: mutable.theme.optional(),
  textScale: mutable.textScale.optional(),
  chatFontSize: mutable.chatFontSize,
  codeFontSize: mutable.codeFontSize,
  defaultModel: mutable.defaultModel.optional(),
  recentWorkbenches: mutable.recentWorkbenches.optional(),
  updates: z
    .strictObject({
      mode: mutable.updates.shape.mode.optional(),
      channel: mutable.updates.shape.channel.optional(),
    })
    .optional(),
  limits: z
    .strictObject({ maxToolCallsPerTurn: mutable.limits.shape.maxToolCallsPerTurn.optional() })
    .optional(),
});
export const settingsSnapshotSchema = z.strictObject({ settings: settingsSchema, readOnly: z.boolean() });
export const settingsV3Schema = settingsSchema.extend({
  schemaVersion: z.literal(3),
  defaultModel: z.null(),
});
export const settingsV1Schema = settingsSchema.extend({
  schemaVersion: z.literal(1),
  defaultModel: z.null(),
  providers: z.strictObject({}),
  recentWorkbenches: z.array(z.never()),
});
export const settingsV2Schema = settingsSchema.extend({
  schemaVersion: z.literal(2),
  defaultModel: z.null(),
  providers: z.strictObject({}),
});
export const settingsV0Schema = z.looseObject({
  ...settingsPatchSchema.shape,
  schemaVersion: z.literal(0),
  defaultModel: z.null().optional(),
  providers: z.strictObject({}).optional(),
  installationId: z.uuid().optional(),
  recentWorkbenches: z.array(z.never()).optional(),
  updates: mutable.updates.partial().optional(),
  limits: mutable.limits.partial().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
/** Internal service patch; provider writes enter through their dedicated IPC boundary. */
export const settingsServicePatchSchema = settingsPatchSchema.extend({
  providers: providerSettingsSchema.optional(),
});
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type SettingsServicePatch = z.infer<typeof settingsServicePatchSchema>;
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;
/** Patches contain only JSON settings values; undefined has omission semantics. */
export function mergeSettings(current: Settings, patch: SettingsServicePatch): Settings {
  const clean: SettingsServicePatch = JSON.parse(JSON.stringify(patch));
  return settingsSchema.parse({
    ...current,
    ...clean,
    updates: { ...current.updates, ...clean.updates },
    limits: { ...current.limits, ...clean.limits },
  });
}
export function defaultSettings(installationId: string): Settings {
  return {
    schemaVersion: 4,
    installationId,
    suppressBypassWarning: false,
    language: "system",
    theme: "system",
    textScale: 1,
    ...typographyDefaults,
    defaultModel: null,
    providers: { openai: {}, custom: [] },
    updates: { mode: "notify", channel: "latest" },
    recentWorkbenches: [],
    limits: { maxToolCallsPerTurn: 50 },
  };
}
