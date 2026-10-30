import { z } from "zod";

export const webAuthenticationSchema = z.enum(["anonymous", "api-key"]);
export const webAccessDefaults = { enabled: true, provider: "exa", authentication: "anonymous" } as const;
export const webAccessSettingsSchema = z.strictObject({
  enabled: z.boolean(),
  provider: z.literal("exa"),
  authentication: webAuthenticationSchema,
});
export const webApiKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(4096)
  .regex(/^[!-~]+$/);
export const webAccessSaveSchema = webAccessSettingsSchema
  .extend({ apiKey: webApiKeySchema.optional(), storageConsent: z.boolean().optional() })
  .refine((value) => value.authentication === "api-key" || value.apiKey === undefined);
export const webAccessSaveResultSchema = z.strictObject({ status: z.enum(["saved", "consent-required"]) });
export const webAccessSnapshotSchema = z.strictObject({
  preferences: webAccessSettingsSchema,
  keyConfigured: z.boolean(),
  storage: z.enum(["encrypted", "unprotected", "memory"]).nullable(),
  secureStorage: z.boolean(),
  readOnly: z.boolean(),
});
export const webAccessTestSchema = z
  .strictObject({
    testId: z.uuid(),
    authentication: webAuthenticationSchema,
    apiKey: webApiKeySchema.optional(),
  })
  .refine((value) => value.authentication === "api-key" || value.apiKey === undefined);
export const webAccessCancelSchema = z.strictObject({ testId: z.uuid() });
export const webAccessTestResultSchema = z.strictObject({
  testId: z.uuid(),
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
