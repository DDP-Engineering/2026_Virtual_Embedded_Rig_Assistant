import { z } from "zod";

/**
 * The parameters a plugin declares in plugin.yaml `settings` (format 1, spec REQ-DATA-af8807e1) and their state on
 * this computer (REQ-FUNC-cbdb46ac). A state names stored references or supplier ids, never a secret value.
 */

/** 1-64 lowercase letters, digits and dashes, a letter or digit at both ends. */
export const pluginSettingNameSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/);
/** The credential scopes a secret parameter names: the stores behind MQTT credentials, Wokwi tokens and parts search. */
export const pluginSettingScopeSchema = z.enum(["mqtt", "wokwi", "parts"]);
export type PluginSettingScope = z.infer<typeof pluginSettingScopeSchema>;
const oneLine = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((value) => !/\p{Cc}/u.test(value), "Use one line without control characters.");
const segment = /^(?:\*|[A-Za-z0-9_-][A-Za-z0-9._-]*)$/;
/** A workbench-relative POSIX path; a `*` segment stands for any one folder (or file) name. */
export const workbenchSettingPathSchema = z
  .string()
  .max(256)
  .refine((path) => {
    const segments = path.split("/");
    return (
      segments.length <= 8 && segments.every((part) => segment.test(part) && part !== "." && part !== "..")
    );
  }, "Use a workbench-relative path of names or * separated by /.");
const description = oneLine(512);
export const pluginSettingSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("secret"), scope: pluginSettingScopeSchema, description }),
  z.strictObject({
    kind: z.literal("workbench-file"),
    path: workbenchSettingPathSchema,
    /** lab-resources: validated as lab/resources.json; json: parsed only; absent: presence only. */
    format: z.enum(["lab-resources", "json"]).optional(),
    /** An optional file never marks the plugin Needs configuration while it is absent. */
    optional: z.boolean().optional(),
    description,
  }),
  z.strictObject({ kind: z.literal("value"), value: oneLine(256), description }),
]);
export type PluginSetting = z.infer<typeof pluginSettingSchema>;
export const pluginParametersSchema = z
  .record(pluginSettingNameSchema, pluginSettingSchema)
  .refine((value) => Object.keys(value).length <= 32, "Declare at most 32 parameters.");
export type PluginParameters = z.infer<typeof pluginParametersSchema>;

export const pluginSettingStateSchema = z.strictObject({
  name: pluginSettingNameSchema,
  kind: z.enum(["secret", "workbench-file", "value"]),
  /**
   * secret: stored or missing; workbench-file: present (and valid), missing, invalid, or unchecked without an open
   * workbench; value: value.
   */
  state: z.enum(["stored", "missing", "present", "invalid", "unchecked", "value"]),
  /** A stored secret's references (MQTT, Wokwi) or supplier ids (parts); never a secret. */
  refs: z.array(z.string().max(64)).max(64).optional(),
  /** The workbench files a path matched. */
  paths: z.array(z.string().max(1024)).max(64).optional(),
  /** Why a workbench file is invalid. */
  problem: z.string().max(1024).optional(),
});
export type PluginSettingState = z.infer<typeof pluginSettingStateSchema>;
export const pluginConfigurationRequestSchema = z.strictObject({
  workbenchId: z.string().min(1).max(256).optional(),
  plugins: z
    .array(z.strictObject({ key: z.string().min(1).max(512), settings: pluginParametersSchema }))
    .max(128),
});
export const pluginConfigurationSchema = z.strictObject({
  plugins: z
    .array(
      z.strictObject({
        key: z.string().min(1).max(512),
        settings: z.array(pluginSettingStateSchema).max(32),
      }),
    )
    .max(128),
});
export type PluginConfiguration = z.infer<typeof pluginConfigurationSchema>;

/**
 * The parameters that mark a plugin Needs configuration (REQ-UX-05e0ed17): a missing secret, a missing workbench file
 * that is not optional and an invalid workbench file, in declaration order.
 */
export function configurationNeeds(
  settings: PluginParameters,
  states: readonly PluginSettingState[] | undefined,
): string[] {
  if (!states) return [];
  const byName = new Map(states.map((state) => [state.name, state]));
  return Object.entries(settings)
    .filter(([name, setting]) => {
      const state = byName.get(name)?.state;
      if (state === "invalid") return true;
      if (state !== "missing") return false;
      return setting.kind !== "workbench-file" || !setting.optional;
    })
    .map(([name]) => name);
}
