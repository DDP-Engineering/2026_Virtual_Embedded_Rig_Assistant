import { z } from "zod";

export const customProviderIdSchema = z
  .string()
  .regex(/^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(87);
export const providerIdSchema = z.union([z.literal("openai"), customProviderIdSchema]);
const name = z.string().trim().min(1).max(80);
const model = z.string().trim().min(1).max(200);
const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const baseUrl = z
  .string()
  .trim()
  .max(2048)
  .pipe(z.url({ protocol: /^https?$/ }))
  .refine((text) => /^https?:\/\/[^/?#@\\]+\/(?:[^?#]*\/)?v1\/?$/.test(text));
export function providerSlug(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
const configFields = {
  name,
  baseUrl,
  model,
  contextWindow: positive.default(32768),
  maxOutputTokens: positive.default(4096),
  supportsTools: z.boolean().optional(),
};
function budget(value: { contextWindow: number; maxOutputTokens: number }): boolean {
  return (
    value.contextWindow - value.maxOutputTokens - Math.max(1024, Math.ceil(value.contextWindow * 0.05)) > 0
  );
}
export const customConfigSchema = z.strictObject(configFields).refine(budget);
function noSecretFields(value: unknown): boolean {
  if (Array.isArray(value)) return value.every(noSecretFields);
  if (value && typeof value === "object")
    return Object.entries(value).every(
      ([key, item]) =>
        !/^(api[-_]?key|key|token|access|refresh|password|authorization|credentials?|secret)$/i.test(key) &&
        noSecretFields(item),
    );
  return true;
}
export const openaiSettingsSchema = z.looseObject({ model: model.optional() }).refine(noSecretFields);
export const customSettingsSchema = z
  .looseObject({
    ...configFields,
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
  })
  .refine(budget)
  .refine(noSecretFields);
export const providerSettingsSchema = z
  .looseObject({ openai: openaiSettingsSchema, custom: z.array(customSettingsSchema).max(100) })
  .refine(noSecretFields)
  .refine(
    (value) =>
      new Set(value.custom.map((c) => c.name.toLowerCase())).size === value.custom.length &&
      new Set(value.custom.map((c) => c.slug)).size === value.custom.length,
  );
const credentialInput = { apiKey: z.string().max(16384).optional(), storageConsent: z.boolean().optional() };
export const providerSaveSchema = z.discriminatedUnion("provider", [
  z.strictObject({
    provider: z.literal("openai"),
    model: z.string().trim().max(200).optional(),
    ...credentialInput,
  }),
  z.strictObject({
    provider: z.literal("custom"),
    id: customProviderIdSchema.optional(),
    config: customConfigSchema,
    ...credentialInput,
  }),
]);
const metadata = {
  configured: z.boolean(),
  hint: z
    .string()
    .max(15)
    .regex(/^[\s\S]{3}…[\s\S]{4}$/u)
    .nullable(),
  storage: z.enum(["encrypted", "unprotected", "memory"]).nullable(),
};
export const providerListSchema = z.strictObject({
  openai: z.strictObject({ id: z.literal("openai"), model: model.optional(), ...metadata }),
  custom: z.array(
    z.strictObject({ ...configFields, slug: z.string(), id: customProviderIdSchema, ...metadata }),
  ),
  secureStorage: z.boolean(),
  readOnly: z.boolean(),
});
export const providerSaveResultSchema = z.strictObject({ status: z.enum(["saved", "consent-required"]) });
export const providerRemoveSchema = z.strictObject({ id: providerIdSchema });
export type ProviderList = z.infer<typeof providerListSchema>;
export type ProviderSave = z.input<typeof providerSaveSchema>;
export type ProviderRemove = z.infer<typeof providerRemoveSchema>;
