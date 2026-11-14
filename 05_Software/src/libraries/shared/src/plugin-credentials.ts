import { z } from "zod";

/**
 * Plugin credentials stored by the host and handed only to approved runs of an official plugin (spec
 * REQ-DATA-96d18686 section 1): MQTT broker logins (scope mqtt) and Wokwi CI tokens (scope wokwi). The renderer sees
 * references and storage, never a username, password or token.
 */

/** The credential scopes a plugin program may declare. */
export const pluginCredentialScopeSchema = z.enum(["mqtt", "wokwi"]);
export type PluginCredentialScope = z.infer<typeof pluginCredentialScopeSchema>;
/** 1-64 lowercase letters, digits and dashes, a letter or digit at both ends. */
export const credentialReferenceSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, "Use 1-64 lowercase letters, digits and dashes.");
/** The CredentialStore id of a plugin credential. */
export function pluginCredentialId(scope: PluginCredentialScope, ref: string): string {
  return `${scope}:${ref}`;
}
const noControl = (value: string) => !/\p{Cc}/u.test(value);
export const mqttCredentialSaveSchema = z.strictObject({
  ref: credentialReferenceSchema,
  username: z.string().max(256).refine(noControl, "No control characters.").optional(),
  password: z.string().min(1).max(1024).refine(noControl, "No control characters."),
  storageConsent: z.boolean().optional(),
});
export type MqttCredentialSave = z.infer<typeof mqttCredentialSaveSchema>;
/** A Wokwi CI token under a reference; it has no username. */
export const wokwiCredentialSaveSchema = z.strictObject({
  ref: credentialReferenceSchema,
  token: z.string().min(1).max(1024).refine(noControl, "No control characters."),
  storageConsent: z.boolean().optional(),
});
export type WokwiCredentialSave = z.infer<typeof wokwiCredentialSaveSchema>;
export const pluginCredentialSaveResultSchema = z.strictObject({
  status: z.enum(["saved", "consent-required"]),
});
export const pluginCredentialRemoveSchema = z.strictObject({ ref: credentialReferenceSchema });
export const pluginCredentialListSchema = z.strictObject({
  credentials: z
    .array(
      z.strictObject({
        ref: credentialReferenceSchema,
        storage: z.enum(["encrypted", "unprotected", "memory"]).nullable(),
      }),
    )
    .max(64),
  secureStorage: z.boolean(),
});
export type PluginCredentialList = z.infer<typeof pluginCredentialListSchema>;
/** At most this many credentials of one scope are stored. */
export const PLUGIN_CREDENTIALS_MAX = 64;
