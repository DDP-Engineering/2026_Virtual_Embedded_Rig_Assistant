import type { Model } from "@earendil-works/pi-ai";
import { opencodeProvider } from "@earendil-works/pi-ai/providers/opencode";
import { opencodeGoProvider } from "@earendil-works/pi-ai/providers/opencode-go";
import { curatedModelIdSchema, reasoningOptionSchema } from "@vera/shared";
import { z } from "zod";

export type OpenCodePlan = "console" | "go";

const openCodeModels = {
  console: opencodeProvider().getModels(),
  go: opencodeGoProvider().getModels(),
};
export function openCodeCompatibility(plan: OpenCodePlan, id: string) {
  const pinned = openCodeModels[plan].find((model) => model.id === id && model.api === "openai-completions");
  const compat =
    pinned?.api === "openai-completions" ? (pinned as Model<"openai-completions">).compat : undefined;
  return {
    supportsStore: false,
    supportsDeveloperRole: false,
    supportsReasoningEffort: false,
    maxTokensField: compat?.maxTokensField ?? ("max_tokens" as const),
    ...(compat?.requiresReasoningContentOnAssistantMessages
      ? { requiresReasoningContentOnAssistantMessages: true }
      : {}),
  };
}

const tokenCount = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const price = z.object({ price: z.number().nonnegative() });
const identity = z.looseObject({ id: curatedModelIdSchema, type: z.string().optional() });
const catalog = z.object({ data: z.array(identity).max(10000) });
const chatModel = z.object({
  name: z.string().min(1).max(240).optional(),
  limit: z
    .object({
      context: tokenCount.optional(),
      input: tokenCount.optional(),
      output: tokenCount.optional(),
    })
    .optional(),
  modalities: z.object({ input: z.array(z.string()).max(128).optional() }).optional(),
  capabilities: z
    .object({
      tools: z.object({ supported: z.boolean() }).optional(),
      reasoning: z
        .object({
          supported: z.boolean(),
          effort: z.array(reasoningOptionSchema).max(16).optional(),
        })
        .optional(),
    })
    .optional(),
  api: z.record(z.string(), z.unknown()).optional(),
  cost: z
    .object({
      text: z.object({ input: price.optional(), output: price.optional() }).optional(),
    })
    .optional(),
});

/** Project supported VERA metadata without trusting any endpoint in a model entry. */
export function parseOpenCodeCatalog(value: unknown, plan: OpenCodePlan) {
  return catalog.parse(value).data.flatMap((record) => {
    if (record.type !== undefined && record.type !== "chat") return [];
    const { id } = record;
    const entry = chatModel.parse(record);
    const { limit, modalities, capabilities, cost } = entry;
    if (
      plan === "console" &&
      ((cost?.text?.input?.price === 0 && cost.text.output?.price === 0) ||
        id === "big-pickle" ||
        id.endsWith("-free"))
    )
      return [];
    const input: ("text" | "image")[] | undefined = modalities?.input?.includes("text")
      ? modalities.input.some((item) => item === "image" || item.startsWith("image/"))
        ? ["text", "image"]
        : ["text"]
      : undefined;
    const reasoning = capabilities?.reasoning;
    const reasoningOptions =
      reasoning?.supported === false
        ? []
        : entry.api && Object.hasOwn(entry.api, "chat-completions") && reasoning?.effort
          ? [...new Set(reasoning.effort)]
          : undefined;
    return [
      {
        id,
        name: entry.name ?? id,
        ...(limit?.context === undefined ? {} : { contextWindow: limit.context }),
        ...(limit?.input === undefined ? {} : { maxInputTokens: limit.input }),
        ...(limit?.output === undefined ? {} : { maxOutputTokens: limit.output }),
        ...(input ? { input } : {}),
        ...(capabilities?.tools ? { supportsTools: capabilities.tools.supported } : {}),
        ...(reasoningOptions ? { reasoningOptions } : {}),
      },
    ];
  });
}
