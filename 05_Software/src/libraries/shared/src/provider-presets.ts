import { z } from "zod";
import { veraErrorSchema } from "./errors.js";
import type { reasoningOptionSchema } from "./provider-discovery.js";

const presetId = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(48);
export const presetBindingSchema = z.strictObject({ id: presetId, binding: presetId });
const normalizedHttpsUrl = z.url({ protocol: /^https$/, normalize: true });
export const curatedInferenceSchema = z
  .string()
  .max(2048)
  .regex(/^https:\/\/[^/?#@\\]+(?:\/[^?#\\]*)?$/)
  .refine((value) => {
    const normalized = normalizedHttpsUrl.safeParse(value);
    return normalized.success && value === normalized.data.replace(/\/$/, "");
  });

export type PresetBinding = z.infer<typeof presetBindingSchema>;
export interface CuratedModel {
  readonly id: string;
  readonly name: string;
  readonly input?: readonly ("text" | "image")[];
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  readonly supportsTools?: boolean;
  readonly reasoningOptions?: readonly z.infer<typeof reasoningOptionSchema>[];
}
export interface ProviderBinding {
  readonly id: string;
  readonly label?: string;
  readonly inference: string;
  readonly catalog: { readonly kind: "manual" } | { readonly kind: "openai-models"; readonly url: string };
  readonly models?: readonly CuratedModel[];
}
export interface CuratedProviderPreset {
  readonly id: string;
  readonly label: string;
  readonly protocol: "openai-completions";
  readonly authentication: "bearer";
  readonly bindings: readonly ProviderBinding[];
}

/** Curated network services enter this list after their VERA acceptance. */
export const curatedProviderPresets: readonly CuratedProviderPreset[] = [];

export const providerChoices = {
  lmstudio: { label: "LM Studio" },
  ollama: { label: "Ollama", baseUrl: "http://localhost:11434/v1" },
  other: { baseUrl: "" },
} as const;

export const curatedModelIdSchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\s\p{Cc}]+$/u);
export const curatedDiscoveryRequestSchema = z.strictObject({
  preset: presetBindingSchema,
  apiKey: z.string().max(16384).optional(),
  savedId: z
    .string()
    .regex(/^custom:[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .max(87)
    .optional(),
});
export const curatedDiscoverySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("discovered"),
    models: z.array(curatedModelIdSchema).min(1).max(10000),
  }),
  z.strictObject({ status: z.literal("manual"), reason: z.enum(["configured", "unavailable", "empty"]) }),
  z.strictObject({ status: z.literal("failed"), error: veraErrorSchema }),
]);

export type CuratedDiscoveryRequest = z.infer<typeof curatedDiscoveryRequestSchema>;
export type CuratedDiscovery = z.infer<typeof curatedDiscoverySchema>;
