import type { CuratedProviderPreset, HostedCatalogMetadata } from "./provider-presets.js";

const services = [
  {
    id: "fireworks",
    label: "Fireworks AI",
    inference: "https://api.fireworks.ai/inference/v1",
    catalog: "https://api.fireworks.ai/v1/accounts/fireworks/models",
    models: [
      {
        id: "accounts/fireworks/models/glm-5p3-flash",
        name: "GLM 5.3 Flash",
        contextWindow: 1_048_573,
        maxOutputTokens: 131_072,
        input: ["text", "image"],
        supportsTools: true,
        reasoning: true,
      },
    ],
  },
  {
    id: "together",
    label: "Together AI",
    inference: "https://api.together.ai/v1",
    catalog: "https://api.together.ai/v1/models",
    models: [
      {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B",
        contextWindow: 131_072,
        input: ["text"],
        supportsTools: true,
        reasoning: true,
      },
      {
        id: "Qwen/Qwen3.5-9B",
        name: "Qwen3.5 9B",
        contextWindow: 262_144,
        input: ["text", "image"],
        supportsTools: true,
        reasoning: true,
      },
      {
        id: "meta-models/Muse-Glimmer-30B",
        name: "Muse Glimmer 30B",
        contextWindow: 131_072,
        input: ["text", "image"],
        supportsTools: true,
      },
    ],
  },
  {
    id: "groq",
    label: "Groq",
    inference: "https://api.groq.com/openai/v1",
    catalog: "https://api.groq.com/openai/v1/models",
    models: [
      {
        id: "llama-3.3-70b-versatile",
        name: "Llama 3.3 70B",
        contextWindow: 131_072,
        maxOutputTokens: 32_768,
        input: ["text"],
        supportsTools: true,
        reasoning: false,
      },
      {
        id: "llama-3.1-8b-instant",
        name: "Llama 3.1 8B",
        contextWindow: 131_072,
        input: ["text"],
        supportsTools: true,
        reasoning: false,
      },
      {
        id: "openai/gpt-oss-120b",
        name: "GPT-OSS 120B",
        contextWindow: 131_072,
        maxOutputTokens: 65_536,
        input: ["text"],
        supportsTools: true,
        reasoning: true,
      },
      {
        id: "openai/gpt-oss-20b",
        name: "GPT-OSS 20B",
        contextWindow: 131_072,
        maxOutputTokens: 65_536,
        input: ["text"],
        supportsTools: true,
        reasoning: true,
      },
      {
        id: "openai/gpt-oss-safeguard-20b",
        name: "GPT-OSS Safeguard 20B",
        input: ["text"],
        supportsTools: true,
        reasoning: true,
      },
      {
        id: "qwen/qwen3.8-27b",
        name: "Qwen 3.8 27B",
        contextWindow: 131_072,
        maxOutputTokens: 16_384,
        input: ["text", "image"],
        supportsTools: true,
        reasoning: true,
      },
    ],
  },
  {
    id: "cerebras",
    label: "Cerebras",
    inference: "https://api.cerebras.ai/v1",
    catalog: "https://api.cerebras.ai/v1/models",
    models: [
      {
        id: "gpt-oss-120b",
        name: "GPT-OSS 120B",
        input: ["text"],
        supportsTools: true,
        reasoning: true,
      },
      {
        id: "qwen-3.8-27b",
        name: "Qwen 3.8 27B",
        input: ["text", "image"],
        supportsTools: true,
        reasoning: true,
      },
    ],
  },
] as const satisfies readonly {
  id: HostedCatalogMetadata;
  label: string;
  inference: string;
  catalog: string;
  models: NonNullable<CuratedProviderPreset["bindings"][number]["models"]>;
}[];

export const hostedProviderPresets: readonly CuratedProviderPreset[] = services.map(
  ({ id, label, inference, catalog, models }) => ({
    id,
    label,
    protocol: "openai-completions",
    authentication: "bearer",
    bindings: [
      { id: "global", inference, catalog: { kind: "openai-models", url: catalog, metadata: id }, models },
    ],
  }),
);
