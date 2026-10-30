import { z } from "zod";

export const webProviderIds = ["exa", "tavily", "brave"] as const;
export const webProviderIdSchema = z.enum(webProviderIds);
export type WebProviderId = z.infer<typeof webProviderIdSchema>;
export const webProviders = {
  exa: { name: "Exa", anonymous: true, read: true },
  tavily: { name: "Tavily", anonymous: true, read: true },
  brave: { name: "Brave Search", anonymous: false, read: false },
} as const;
const validAuthentication = (value: { provider: WebProviderId; authentication: string }) =>
  value.authentication === "api-key" || webProviders[value.provider].anonymous;
export const webCredentialMetadataSchema = z.strictObject({
  keyConfigured: z.boolean(),
  storage: z.enum(["encrypted", "unprotected", "memory"]).nullable(),
});
export const webAuthenticationSchema = z.enum(["anonymous", "api-key"]);
export const webAccessDefaults = { enabled: true, provider: "exa", authentication: "anonymous" } as const;
export const webAccessSettingsSchema = z
  .strictObject({
    enabled: z.boolean(),
    provider: webProviderIdSchema,
    authentication: webAuthenticationSchema,
  })
  .refine(validAuthentication);
export const webApiKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .regex(/^[!-~]+$/);
export const webAccessSaveSchema = webAccessSettingsSchema
  .safeExtend({ apiKey: webApiKeySchema.optional(), storageConsent: z.boolean().optional() })
  .refine((value) => value.authentication === "api-key" || value.apiKey === undefined);
export const webAccessSaveResultSchema = z.strictObject({ status: z.enum(["saved", "consent-required"]) });
export const webAccessSnapshotSchema = z.strictObject({
  preferences: webAccessSettingsSchema,
  keys: z.record(webProviderIdSchema, webCredentialMetadataSchema),
  secureStorage: z.boolean(),
  readOnly: z.boolean(),
});
export const webAccessTestSchema = z
  .strictObject({
    testId: z.uuid(),
    provider: webProviderIdSchema,
    authentication: webAuthenticationSchema,
    apiKey: webApiKeySchema.optional(),
  })
  .refine(validAuthentication)
  .refine((value) => value.authentication === "api-key" || value.apiKey === undefined);
export const webAccessProviderSchema = z.strictObject({ provider: webProviderIdSchema });
export const webAccessCancelSchema = z.strictObject({ testId: z.uuid() });
export const webAccessTestResultSchema = z.strictObject({
  testId: z.uuid(),
  provider: webProviderIdSchema,
  authentication: webAuthenticationSchema,
  status: z.enum(["pass", "fail", "disabled", "key-required", "cancelled"]),
  checkedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
});
export type WebAccessSettings = z.infer<typeof webAccessSettingsSchema>;
export type WebAccessSave = z.infer<typeof webAccessSaveSchema>;
export type WebAccessSnapshot = z.infer<typeof webAccessSnapshotSchema>;
export type WebAccessTest = z.infer<typeof webAccessTestSchema>;
export type WebAccessTestResult = z.infer<typeof webAccessTestResultSchema>;
