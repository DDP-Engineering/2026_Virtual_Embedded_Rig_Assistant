import { z } from "zod";
import { veraErrorSchema } from "./errors.js";
import { hostedProviderPresets } from "./hosted-provider-presets.js";
import { reasoningOptionSchema } from "./provider-discovery.js";

const presetId = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(48);
export const presetBindingSchema = z.strictObject({
  id: presetId,
  binding: presetId,
  workspaceId: z.string().max(2048).optional(),
});
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
export type ProviderRegion =
  | "global"
  | "china"
  | "singapore"
  | "europe"
  | "beijing"
  | "hongKong"
  | "frankfurt"
  | "tokyo"
  | "virginia";
export type ProviderKeyScope = "model-studio" | "alibaba-coding" | "mimo-api" | "mimo-token";
export const isMiMoKeyScope = (scope: ProviderKeyScope | undefined) =>
  scope === "mimo-api" || scope === "mimo-token";

// Only a single namespace label from the workspace console is allowed into a host.
export const validWorkspaceId = (id: string) => /^llm-[a-z0-9]{1,59}$/.test(id);

export function bindProviderWorkspace(
  binding: ProviderBinding,
  workspaceId: string | undefined,
): ProviderBinding | undefined {
  if (!binding.workspace) return workspaceId === undefined ? binding : undefined;
  if (!workspaceId || !validWorkspaceId(workspaceId)) return;
  const apply = (url: string) => url.replace("{workspace}", workspaceId);
  return {
    ...binding,
    inference: apply(binding.inference),
    catalog:
      binding.catalog.kind === "manual"
        ? binding.catalog
        : { ...binding.catalog, url: apply(binding.catalog.url) },
  };
}

export function samePresetBinding(left: PresetBinding | undefined, right: PresetBinding | undefined) {
  return (
    left?.id === right?.id && left?.binding === right?.binding && left?.workspaceId === right?.workspaceId
  );
}

export type HostedCatalogMetadata = "fireworks" | "together" | "groq" | "cerebras";

export function isHostedCatalog(catalog: ProviderBinding["catalog"] | undefined): boolean {
  if (catalog?.kind !== "openai-models") return false;
  const { metadata } = catalog;
  return (
    metadata === "fireworks" || metadata === "together" || metadata === "groq" || metadata === "cerebras"
  );
}

export interface ProviderBinding {
  readonly workspace?: true;
  readonly region?: ProviderRegion;
  readonly keyScope?: ProviderKeyScope;
  readonly qwenCloud?: QwenCloudPlan;
  readonly id: string;
  readonly label?: string;
  readonly inference: string;
  readonly apiKeyPrefix?: string;
  readonly catalog:
    | { readonly kind: "manual" }
    | { readonly kind: "alibaba-models"; readonly url: string }
    | {
        readonly kind: "openai-models";
        readonly url: string;
        readonly opencode?: "console" | "go";
        readonly metadata?: "deepseek" | "moonshot" | HostedCatalogMetadata;
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

const miniMaxBase = "https://api.minimax.io/anthropic";
const miniMaxModel = {
  input: ["text", "image"],
  contextWindow: 1_000_000,
  maxOutputTokens: 524_288,
  outputBudget: 131_072,
  supportsTools: true,
} as const;
const miniMaxFlash = {
  ...miniMaxModel,
  id: "MiniMax-M3.1-Flash",
  name: "MiniMax M3.1 Flash",
  reasoningOptions: ["low", "medium", "high", "xhigh", "max"],
} as const;

const glmModel = {
  contextWindow: 1_000_000,
  maxOutputTokens: 131_072,
  supportsTools: true,
  reasoningOptions: ["low", "high", "max"],
} as const;
const glmModels: readonly CuratedModel[] = [
  { ...glmModel, id: "glm-5.3", name: "GLM-5.3", input: ["text"] },
  { ...glmModel, id: "glm-5.3-flash", name: "GLM-5.3-Flash", input: ["text", "image"] },
];

const qwenStudioProfile = {
  input: ["text", "image"],
  contextWindow: 1_000_000,
  maxOutputTokens: 131_072,
  supportsTools: true,
  reasoningOptions: ["off", "on"],
} as const;

const studioRegions = [
  ["ap-southeast-1", "singapore"],
  ["cn-beijing", "beijing"],
  ["cn-hongkong", "hongKong"],
  ["eu-central-1", "frankfurt"],
  ["ap-northeast-1", "tokyo"],
  ["us-east-1", "virginia"],
] as const;

const mimoChatProfile = {
  input: ["text", "image"],
  contextWindow: 1_048_576,
  maxOutputTokens: 131_072,
  supportsTools: true,
  reasoningOptions: ["off", "on"],
} as const;

const mimoChatModels = [
  { id: "mimo-v2.6-flash", name: "MiMo V2.6 Flash" },
  { id: "mimo-v2.6-pro", name: "MiMo V2.6 Pro" },
].map((model) => ({ ...mimoChatProfile, ...model }));

const regionalPresets: readonly CuratedProviderPreset[] = [
  {
    id: "alibaba-model-studio",
    label: "Alibaba Cloud Model Studio",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: studioRegions.map(([id, region]) => {
      const base = `https://{workspace}.${id}.maas.aliyuncs.com`;
      return {
        id,
        region,
        workspace: true,
        keyScope: "model-studio",
        inference: `${base}/compatible-mode/v1`,
        catalog:
          id === "us-east-1" ? { kind: "manual" } : { kind: "alibaba-models", url: `${base}/api/v1/models` },
        models: [{ ...qwenStudioProfile, id: "qwen3.7-flash", name: "Qwen3.7 Flash" }],
      };
    }),
  },
  {
    id: "alibaba-coding-plan",
    label: "Alibaba Cloud Coding Plan",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "singapore",
        region: "singapore",
        keyScope: "alibaba-coding",
        inference: "https://coding-intl.dashscope.aliyuncs.com/v1",
        catalog: { kind: "manual" },
        models: [
          {
            ...qwenStudioProfile,
            id: "qwen3.7-plus",
            name: "Qwen3.7 Plus",
            maxOutputTokens: undefined,
            outputBudget: 65_536,
            reasoningOptions: ["on"],
          },
        ],
      },
    ],
  },
  {
    id: "xiaomi-mimo-api",
    label: "Xiaomi MiMo API",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "global",
        region: "global",
        keyScope: "mimo-api",
        inference: "https://api.xiaomimimo.com/v1",
        catalog: { kind: "openai-models", url: "https://api.xiaomimimo.com/v1/models" },
        models: [
          ...mimoChatModels,
          {
            ...mimoChatProfile,
            id: "mimo-v2.6-pro-ultraspeed",
            name: "MiMo V2.6 Pro UltraSpeed",
          },
        ],
      },
    ],
  },
  {
    id: "xiaomi-mimo-token-plan",
    label: "Xiaomi MiMo Token Plan",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: (
      [
        ["china", "cn"],
        ["singapore", "sgp"],
        ["europe", "ams"],
      ] as const
    ).map(([region, endpoint]) => ({
      id: region,
      region,
      keyScope: "mimo-token",
      inference: `https://token-plan-${endpoint}.xiaomimimo.com/v1`,
      catalog: { kind: "manual" },
      models: mimoChatModels,
    })),
  },
];

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
  {
    id: "minimax-api",
    label: "MiniMax API",
    protocol: "anthropic-messages",
    authentication: "x-api-key",
    bindings: [
      {
        id: "international",
        inference: miniMaxBase,
        catalog: { kind: "manual" },
        apiKeyPrefix: "sk-api-",
        models: [
          miniMaxFlash,
          { ...miniMaxModel, id: "MiniMax-M3", name: "MiniMax M3", reasoningOptions: ["off", "on"] },
        ],
      },
    ],
  },
  {
    id: "minimax-m-plan",
    label: "MiniMax M Plan",
    protocol: "anthropic-messages",
    authentication: "x-api-key",
    bindings: [
      {
        id: "international",
        inference: miniMaxBase,
        catalog: { kind: "manual" },
        apiKeyPrefix: "sk-cp-",
        models: [miniMaxFlash],
      },
    ],
  },
  {
    id: "zai-api",
    label: "Z.AI API",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "international",
        inference: "https://api.z.ai/api/paas/v4",
        catalog: { kind: "manual" },
        models: glmModels,
      },
    ],
  },
  {
    id: "zai-coding-plan",
    label: "Z.AI GLM Coding Plan",
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      {
        id: "international",
        inference: "https://api.z.ai/api/coding/paas/v4",
        catalog: { kind: "manual" },
        models: glmModels,
      },
    ],
  },
  ...regionalPresets,
  ...hostedProviderPresets,
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
