import { z } from "zod";
import { shortcutOverridesSchema } from "./keyboard-shortcuts.js";
import { catalogUrlSchema } from "./plugin-catalog.js";
import { urlParts } from "./plugins.js";
import { modelReferenceSchema, providerSettingsSchema } from "./providers.js";
import { sessionIdSchema } from "./session.js";
import { updateChannelSchema, updateModeSchema } from "./updates.js";
import { webAccessDefaults, webAccessSettingsSchema } from "./web-access.js";
import { workbenchIdSchema } from "./workbench.js";

export const recentWorkbenchSchema = z.strictObject({
  folder: z.string().min(1),
  id: workbenchIdSchema,
  name: z.string().min(1).max(80),
  lastOpened: z.iso.datetime(),
  pinned: z.boolean().optional(),
});
export const recentWorkbenchStateSchema = recentWorkbenchSchema.extend({ missing: z.boolean() });
export type RecentWorkbench = z.infer<typeof recentWorkbenchSchema>;
export type RecentWorkbenchState = z.infer<typeof recentWorkbenchStateSchema>;

/** An http(s) URL without user name or password; credentials never sit in settings.json. */
const plainUrl = z
  .url({ protocol: /^https?$/ })
  .max(2048)
  .refine((value) => !urlParts(value)?.authority.includes("@"), "Use a URL without credentials.");
/** Package index and proxy that uv uses to install plugin programs, and the plugin catalog folder. */
export const pluginSettingsSchema = z.strictObject({
  index: plainUrl.optional(),
  proxy: plainUrl.optional(),
  catalog: catalogUrlSchema.optional(),
});
export type PluginSettings = z.infer<typeof pluginSettingsSchema>;

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
  webAccess: webAccessSettingsSchema,
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
  updates: z.strictObject({ mode: updateModeSchema, channel: updateChannelSchema }),
  recentWorkbenches: z.array(recentWorkbenchSchema),
  /** Session ids per workbench in the order the user arranged them (TASK-c99ca08c). */
  sessionOrder: z.record(workbenchIdSchema, z.array(sessionIdSchema)).optional(),
  limits: z.strictObject({ maxToolCallsPerTurn: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
  plugins: pluginSettingsSchema.optional(),
};

/** The settings format; its version stays 1 during development (AGENTS.md). */
export const settingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
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
  plugins: mutable.plugins,
});
export const settingsSnapshotSchema = z.strictObject({ settings: settingsSchema });
export type Settings = z.infer<typeof settingsSchema>;
/** Internal service patch; provider writes enter through their dedicated IPC boundary. */
export const settingsServicePatchSchema = settingsPatchSchema.extend({
  webAccess: webAccessSettingsSchema.optional(),
  providers: providerSettingsSchema.optional(),
  sessionOrder: mutable.sessionOrder,
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
    schemaVersion: 1,
    installationId,
    suppressBypassWarning: false,
    webAccess: { ...webAccessDefaults },
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
