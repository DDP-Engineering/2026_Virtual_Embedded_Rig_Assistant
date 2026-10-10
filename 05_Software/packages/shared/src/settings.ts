import { z } from "zod";

const mutable = {
  language: z.enum(["system", "en", "ro", "de"]),
  theme: z.enum(["system", "light", "dark"]),
  textScale: z.union([z.literal(0.875), z.literal(1), z.literal(1.125), z.literal(1.25), z.literal(1.5)]),
  defaultModel: z.null(),
  providers: z.strictObject({}),
  updates: z.strictObject({ mode: z.literal("notify"), channel: z.literal("latest") }),
  recentWorkbenches: z.array(z.never()),
  limits: z.strictObject({ maxToolCallsPerTurn: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
};

export const settingsSchema = z.strictObject({
  schemaVersion: z.literal(1),
  installationId: z.uuid(),
  ...mutable,
});
export const settingsPatchSchema = z.strictObject({
  language: mutable.language.optional(),
  theme: mutable.theme.optional(),
  textScale: mutable.textScale.optional(),
  defaultModel: mutable.defaultModel.optional(),
  providers: mutable.providers.optional(),
  recentWorkbenches: mutable.recentWorkbenches.optional(),
  updates: mutable.updates.partial().optional(),
  limits: mutable.limits.partial().optional(),
});
export const settingsSnapshotSchema = z.strictObject({ settings: settingsSchema, readOnly: z.boolean() });
export const settingsV0Schema = settingsPatchSchema.extend({
  schemaVersion: z.literal(0),
  installationId: z.uuid().optional(),
});
export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;
export type SettingsSnapshot = z.infer<typeof settingsSnapshotSchema>;
/** Patches contain only JSON settings values; undefined has omission semantics. */
export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const clean: SettingsPatch = JSON.parse(JSON.stringify(patch));
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
    language: "system",
    theme: "system",
    textScale: 1,
    defaultModel: null,
    providers: {},
    updates: { mode: "notify", channel: "latest" },
    recentWorkbenches: [],
    limits: { maxToolCallsPerTurn: 50 },
  };
}
