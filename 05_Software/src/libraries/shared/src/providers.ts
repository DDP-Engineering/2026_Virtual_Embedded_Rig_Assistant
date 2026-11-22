import { z } from "zod";
import { veraErrorSchema } from "./errors.js";
import { modelProfileSchema, reasoningOptionSchema } from "./provider-discovery.js";
import {
  curatedInferenceSchema,
  curatedModelIdSchema,
  presetBindingSchema,
  validWorkspaceId,
} from "./provider-presets.js";

export const customProviderIdSchema = z
  .string()
  .regex(/^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(87);
export const providerIdSchema = z.union([z.literal("openai"), customProviderIdSchema]);
export const modelReferenceSchema = z
  .string()
  .min(3)
  .max(288)
  .regex(/^(?:openai|chatgpt|replay|custom:[a-z0-9]+(?:-[a-z0-9]+)*)\/[^\s]+$/);
export const modelCapabilitiesSchema = z.strictObject({
  input: z
    .array(z.enum(["text", "image"]))
    .min(1)
    .max(2),
  contextWindow: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  maxOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  providerMaxOutputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  maxInputTokens: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  safetyMargin: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  inputBudget: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  supportsTools: z.boolean().optional(),
  reasoningOptions: z.array(reasoningOptionSchema).max(16).optional(),
  inputVerified: z.boolean().optional(),
  contextVerified: z.boolean().optional(),
});
export function acceptsImages(model: { input: readonly ("text" | "image")[] }): boolean {
  return model.input.includes("image");
}
export const gatewayProviderIdSchema = z.union([providerIdSchema, z.literal("chatgpt"), z.literal("replay")]);
export const providerModelsRequestSchema = z.strictObject({ id: gatewayProviderIdSchema });
export const providerTestRequestSchema = z.strictObject({
  id: gatewayProviderIdSchema,
  model: z.string().trim().min(1).max(200).optional(),
});
export const providerCatalogSchema = z.strictObject({
  reachability: z.enum(["pass", "skipped"]),
  models: z
    .array(
      modelCapabilitiesSchema.extend({
        id: z.string().min(1).max(200),
        name: z.string().min(1),
        reference: modelReferenceSchema,
        providerName: z.string().min(1).max(240).optional(),
        curated: z.literal(true).optional(),
      }),
    )
    .max(10001),
});
export const providerTestStepSchema = z.strictObject({
  step: z.enum(["reachability", "authentication", "tools", "streaming"]),
  status: z.enum(["pass", "fail", "skipped"]),
  error: veraErrorSchema.optional(),
});
export const providerTestResultSchema = z
  .strictObject({ steps: z.array(providerTestStepSchema).length(4) })
  .refine((v) => v.steps.map((s) => s.step).join(",") === "reachability,authentication,tools,streaming");
export type ModelCapabilities = z.infer<typeof modelCapabilitiesSchema>;
export type ProviderCatalog = z.infer<typeof providerCatalogSchema>;
export type ProviderTestStep = z.infer<typeof providerTestStepSchema>;
export type ProviderTestResult = z.infer<typeof providerTestResultSchema>;
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
export const providerTokenDefaults = { contextWindow: 32768, maxOutputTokens: 4096 } as const;
/** Exact model IDs of one provider: unique, without whitespace, at most 10000. */
const modelIdList = z
  .array(z.string().min(1).max(200).regex(/^\S+$/))
  .max(10000)
  .refine((ids) => new Set(ids).size === ids.length);
const configFields = {
  name,
  baseUrl: z.union([baseUrl, curatedInferenceSchema]),
  preset: presetBindingSchema.optional(),
  model,
  contextWindow: positive.default(providerTokenDefaults.contextWindow),
  maxOutputTokens: positive.default(providerTokenDefaults.maxOutputTokens),
  /** How long VERA waits for the first response and between stream events; 300 s when unset. */
  responseTimeoutSeconds: z.number().int().min(10).max(3600).optional(),
  supportsTools: z.boolean().optional(),
  protocol: z.literal("lmstudio").optional(),
  models: z.array(modelProfileSchema).max(10000).optional(),
  imageModels: modelIdList.optional(),
  /** The models this connection offers in VERA's model choices; absent offers its whole catalog. */
  enabledModels: modelIdList.optional(),
};
function budget(value: {
  contextWindow: number;
  maxOutputTokens: number;
  protocol?: "lmstudio" | undefined;
  models?: { id: string }[] | undefined;
  model?: string | undefined;
}): boolean {
  return (
    value.contextWindow - value.maxOutputTokens - Math.max(1024, Math.ceil(value.contextWindow * 0.05)) > 0 &&
    (value.protocol !== "lmstudio" || !!value.models?.some((m) => m.id === value.model)) &&
    (!value.models || new Set(value.models.map((m) => m.id)).size === value.models.length)
  );
}

function providerConfig(value: z.output<z.ZodObject<typeof configFields>>): boolean {
  if (value.preset) {
    return (
      curatedInferenceSchema.safeParse(value.baseUrl).success &&
      curatedModelIdSchema.safeParse(value.model).success &&
      !value.protocol &&
      !value.models &&
      !value.imageModels
    );
  }
  return baseUrl.safeParse(value.baseUrl).success;
}
const curatedSlug = /^preset-[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export const customConfigSchema = z
  .strictObject(configFields)
  .refine((value) => (!!value.preset || budget(value)) && providerConfig(value));
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
export const openaiSettingsSchema = z
  .strictObject({ model: model.optional(), enabledModels: modelIdList.optional() })
  .refine(noSecretFields);
/** The ChatGPT subscription signs in elsewhere; settings keep only the models it offers. */
export const chatgptSettingsSchema = z.strictObject({ enabledModels: modelIdList.optional() });
export const customSettingsSchema = z
  .strictObject({
    ...configFields,
    preset: presetBindingSchema
      .extend({ workspaceId: z.string().refine(validWorkspaceId).optional() })
      .optional(),
    slug: z
      .string()
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .max(80),
  })
  .refine(budget)
  .refine(providerConfig)
  .refine((value) => curatedSlug.test(value.slug) === !!value.preset)
  .refine(noSecretFields);
export const providerSettingsSchema = z
  .strictObject({
    openai: openaiSettingsSchema,
    chatgpt: chatgptSettingsSchema.optional(),
    custom: z.array(customSettingsSchema).max(100),
  })
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
  openai: z.strictObject({
    id: z.literal("openai"),
    model: model.optional(),
    enabledModels: modelIdList.optional(),
    ...metadata,
  }),
  chatgpt: z.strictObject({ id: z.literal("chatgpt"), enabledModels: modelIdList.optional() }),
  custom: z.array(
    z.strictObject({ ...configFields, slug: z.string(), id: customProviderIdSchema, ...metadata }),
  ),
  secureStorage: z.boolean(),
});
export const providerSaveResultSchema = z.strictObject({ status: z.enum(["saved", "consent-required"]) });
export const providerRemoveSchema = z.strictObject({ id: providerIdSchema });
/** One write of the model ticks of several providers; `null` removes a list, so the whole catalog is offered. */
export const providerModelsEnableSchema = z.strictObject({
  providers: z
    .array(
      z.strictObject({
        id: z.union([z.literal("chatgpt"), providerIdSchema]),
        models: modelIdList.nullable(),
      }),
    )
    .min(1)
    .max(102),
});
export type ProviderModelsEnable = z.infer<typeof providerModelsEnableSchema>;
export type ProviderList = z.infer<typeof providerListSchema>;
export type ProviderSave = z.input<typeof providerSaveSchema>;
export type ProviderRemove = z.infer<typeof providerRemoveSchema>;
