import { z } from "zod";

/**
 * MQTT broker credentials stored by the host and handed only to approved runs of an official plugin
 * (spec REQ-DATA-96d18686 section 1). The renderer sees references and storage, never a username or password.
 */

/** The credential scopes a plugin program may declare. */
export const pluginCredentialScopeSchema = z.enum(["mqtt"]);
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
export const mqttCredentialSaveResultSchema = z.strictObject({
  status: z.enum(["saved", "consent-required"]),
});
export const mqttCredentialRemoveSchema = z.strictObject({ ref: credentialReferenceSchema });
export const mqttCredentialListSchema = z.strictObject({
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
export type MqttCredentialList = z.infer<typeof mqttCredentialListSchema>;
/** At most this many MQTT credentials are stored. */
export const MQTT_CREDENTIALS_MAX = 64;
