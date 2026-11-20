import { z } from "zod";
import { veraErrorSchema } from "./errors.js";
import { reasoningOptionSchema } from "./provider-discovery.js";

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
export type CuratedModel = {
  readonly id: string;
  readonly name: string;
  readonly input?: readonly ("text" | "image")[] | undefined;
  readonly contextWindow?: number | undefined;
  readonly maxInputTokens?: number | undefined;
  readonly maxOutputTokens?: number | undefined;
  readonly outputBudget?: number | undefined;
  readonly supportsTools?: boolean | undefined;
  readonly reasoning?: boolean | undefined;
  readonly reasoningOptions?: readonly z.infer<typeof reasoningOptionSchema>[] | undefined;
};
export type QwenCloudPlan = "standard" | "token-plan";
export interface ProviderBinding {
  readonly qwenCloud?: QwenCloudPlan;
  readonly id: string;
  readonly label?: string;
  readonly inference: string;
  readonly catalog:
    | { readonly kind: "manual" }
    | {
        readonly kind: "openai-models";
        readonly url: string;
        readonly opencode?: "console" | "go";
        readonly metadata?: "deepseek" | "moonshot";
      };
  readonly models?: readonly CuratedModel[];
}
export type CuratedProviderPreset = {
  readonly id: string;
  readonly label: string;
  readonly bindings: readonly ProviderBinding[];
} & (
  | { readonly protocol: "openai-completions"; readonly authentication: "bearer" }
  | { readonly protocol: "anthropic-messages"; readonly authentication: "x-api-key" }
);

// Both QwenCloud plans document these exact chat IDs in Singapore.
const qwenCloudModels: readonly CuratedModel[] = [
  {
    id: "qwen3.8-flash",
    name: "Qwen3.8 Flash",
    input: ["text", "image"],
    contextWindow: 1_000_000,
    maxOutputTokens: 131_072,
    supportsTools: true,
    reasoningOptions: ["off", "on"],
  },
  {
    id: "qwen3.7-max",
    name: "Qwen3.7 Max",
    input: ["text"],
    contextWindow: 1_000_000,
    maxOutputTokens: 65_536,
    supportsTools: true,
    reasoningOptions: ["off", "on"],
  },
];

const deepSeekBase = "https://api.deepseek.com";
const moonshotBase = "https://api.moonshot.ai/v1";

const deepSeekModel = {
  contextWindow: 1_048_576,
  maxOutputTokens: 393_216,
  supportsTools: true,
  reasoningOptions: ["off", "low", "high", "max"],
} as const;
const kimiEfforts = ["low", "high", "max"] as const;

const qwenCloudBase = "https://maas.qwencloudapi.com/compatible-mode/v1";
const qwenCloudTokenBase = "https://token-plan.maas.qwencloudapi.com/compatible-mode/v1";

/** Curated network services enter this list after their VERA acceptance. */
export const curatedProviderPresets: readonly CuratedProviderPreset[] = [
  {
    id: "opencode-console",
    label: "OpenCode Console",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "default",
        inference: "https://opencode.ai/inference/openai/v1",
        catalog: {
          kind: "openai-models",
          url: "https://opencode.ai/inference/v1/models",
          opencode: "console",
        },
      },
    ],
  },
  {
    id: "opencode-go",
    label: "OpenCode Go",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "default",
        inference: "https://opencode.ai/inference/go/openai/v1",
        catalog: { kind: "openai-models", url: "https://opencode.ai/inference/go/v1/models", opencode: "go" },
      },
    ],
  },
  {
    id: "qwencloud-standard",
    label: "QwenCloud Standard",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "default",
        qwenCloud: "standard",
        inference: qwenCloudBase,
        catalog: { kind: "openai-models", url: `${qwenCloudBase}/models` },
        models: qwenCloudModels,
      },
    ],
  },
  {
    id: "qwencloud-token-plan",
    label: "QwenCloud Token Plan",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "default",
        qwenCloud: "token-plan",
        inference: qwenCloudTokenBase,
        catalog: { kind: "openai-models", url: `${qwenCloudTokenBase}/models` },
        models: qwenCloudModels,
      },
    ],
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "default",
        inference: deepSeekBase,
        catalog: { kind: "openai-models", url: `${deepSeekBase}/models`, metadata: "deepseek" },
        models: [
          { ...deepSeekModel, id: "deepseek-flash", name: "DeepSeek V4.1 Flash", input: ["text", "image"] },
          { ...deepSeekModel, id: "deepseek-v4-pro", name: "DeepSeek V4 Pro", input: ["text"] },
        ],
      },
    ],
  },
  {
    id: "moonshot-ai",
    label: "Moonshot AI",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "default",
        inference: moonshotBase,
        catalog: { kind: "openai-models", url: `${moonshotBase}/models`, metadata: "moonshot" },
        models: [
          {
            id: "kimi-k3",
            name: "Kimi K3",
            input: ["text", "image"],
            contextWindow: 1_048_576,
            maxOutputTokens: 1_048_576,
            outputBudget: 16_384,
            supportsTools: true,
            reasoningOptions: kimiEfforts,
          },
        ],
      },
    ],
  },
  {
    id: "kimi-coding",
    label: "Kimi For Coding",
    protocol: "anthropic-messages",
    authentication: "x-api-key",
    bindings: [
      {
        id: "default",
        inference: "https://api.kimi.ai/coding",
        catalog: { kind: "manual" },
        models: [
          {
            id: "kimi-for-coding",
            name: "Kimi K2.8 Preview",
            input: ["text", "image"],
            contextWindow: 1_048_576,
            maxOutputTokens: 32_768,
            supportsTools: true,
            reasoningOptions: kimiEfforts,
          },
          {
            id: "k3-256k",
            name: "Kimi K3 256K",
            input: ["text", "image"],
            contextWindow: 262_144,
            maxOutputTokens: 131_072,
            supportsTools: true,
            reasoningOptions: kimiEfforts,
          },
        ],
      },
    ],
  },
];

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
const tokenCount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const curatedCatalogProfile = z.strictObject({
  id: curatedModelIdSchema,
  name: z.string().min(1).max(240),
  input: z
    .array(z.enum(["text", "image"]))
    .min(1)
    .max(2)
    .optional(),
  contextWindow: tokenCount.optional(),
  maxInputTokens: tokenCount.optional(),
  maxOutputTokens: tokenCount.optional(),
  supportsTools: z.boolean().optional(),
  reasoning: z.boolean().optional(),
  reasoningOptions: z.array(reasoningOptionSchema).max(16).optional(),
});
export const curatedDiscoverySchema = z.discriminatedUnion("status", [
  z.strictObject({
    status: z.literal("discovered"),
    models: z.array(curatedModelIdSchema).min(1).max(10000),
    profiles: z.array(curatedCatalogProfile).max(10000).optional(),
  }),
  z.strictObject({ status: z.literal("manual"), reason: z.enum(["configured", "unavailable", "empty"]) }),
  z.strictObject({ status: z.literal("failed"), error: veraErrorSchema }),
]);

export type CuratedDiscoveryRequest = z.infer<typeof curatedDiscoveryRequestSchema>;
export type CuratedDiscovery = z.infer<typeof curatedDiscoverySchema>;
