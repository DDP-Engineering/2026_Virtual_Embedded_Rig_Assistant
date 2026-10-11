import { z } from "zod";
import { workbenchIdSchema } from "./workbench.js";

export const recentWorkbenchSchema = z.looseObject({
  folder: z.string().min(1),
  id: workbenchIdSchema,
  name: z.string().min(1).max(80),
  lastOpened: z.iso.datetime(),
});
export const recentWorkbenchStateSchema = recentWorkbenchSchema.extend({ missing: z.boolean() });
export type RecentWorkbench = z.infer<typeof recentWorkbenchSchema>;
export type RecentWorkbenchState = z.infer<typeof recentWorkbenchStateSchema>;

const mutable = {
  language: z.enum(["system", "en", "ro", "de"]),
  theme: z.enum(["system", "light", "dark"]),
  textScale: z.union([z.literal(0.875), z.literal(1), z.literal(1.125), z.literal(1.25), z.literal(1.5)]),
  defaultModel: z.null(),
  providers: z.strictObject({}),
  updates: z.looseObject({ mode: z.literal("notify"), channel: z.literal("latest") }),
  recentWorkbenches: z.array(recentWorkbenchSchema).max(10),
  limits: z.looseObject({ maxToolCallsPerTurn: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }),
};

export const settingsSchema = z.looseObject({
  schemaVersion: z.literal(2),
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
export const settingsV1Schema = settingsSchema.extend({
  schemaVersion: z.literal(1),
  recentWorkbenches: z.array(z.never()),
});
export const settingsV0Schema = z.looseObject({
  ...settingsPatchSchema.shape,
  schemaVersion: z.literal(0),
  installationId: z.uuid().optional(),
  recentWorkbenches: z.array(z.never()).optional(),
  updates: mutable.updates.partial().optional(),
  limits: mutable.limits.partial().optional(),
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
    schemaVersion: 2,
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
