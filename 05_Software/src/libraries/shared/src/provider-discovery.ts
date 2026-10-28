import { z } from "zod";

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export const reasoningOptionSchema = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
export const discoveredModelSchema = z.strictObject({
  id: z.string().min(1).max(200).regex(/^\S+$/),
  name: z.string().min(1).max(240),
  maxContextWindow: positive.optional(),
  loadedContextWindow: positive.optional(),
  supportsTools: z.boolean().optional(),
  reasoningOptions: z.array(reasoningOptionSchema).max(16),
  reasoningDefault: reasoningOptionSchema.optional(),
});
export const modelProfileSchema = discoveredModelSchema
  .extend({
    contextWindow: positive,
    maxOutputTokens: positive,
    reasoning: reasoningOptionSchema.optional(),
    temperature: z.number().min(0).max(2).optional(),
  })
  .refine((v) => v.reasoning === undefined || v.reasoningOptions.includes(v.reasoning))
  .refine((v) => v.contextWindow - v.maxOutputTokens - Math.max(1024, Math.ceil(v.contextWindow * 0.05)) > 0)
  .refine((v) => v.contextWindow <= (v.loadedContextWindow ?? v.maxContextWindow ?? Number.MAX_SAFE_INTEGER));
export const providerDiscoveryRequestSchema = z.strictObject({
  endpoint: z
    .string()
    .trim()
    .min(1)
    .max(2048)
    .pipe(z.url({ protocol: /^https?$/ }))
    .refine((value) => /^https?:\/\/[^/?#@\\]+(?:\/(?:v1\/?)?)?$/.test(value)),

  apiKey: z.string().max(16384).optional(),
  savedId: z
    .string()
    .regex(/^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(87)
    .optional(),
});
export const providerDiscoverySchema = z.strictObject({
  baseUrl: z.string().url(),
  models: z.array(discoveredModelSchema).max(10000),
});
export type DiscoveredModel = z.infer<typeof discoveredModelSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ProviderDiscoveryRequest = z.infer<typeof providerDiscoveryRequestSchema>;
export type ProviderDiscovery = z.infer<typeof providerDiscoverySchema>;
