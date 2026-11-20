import type { Model } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";

const deepSeekModels = deepseekProvider().getModels();
const moonshotModels = moonshotaiProvider().getModels();
const kimiModels = kimiCodingProvider().getModels();

export function directCompletionsCompatibility(preset: string, model: string) {
  if (preset !== "deepseek" && preset !== "moonshot-ai") return;
  const models = preset === "deepseek" ? deepSeekModels : moonshotModels;
  const pinned = models.find(({ id }) => id === model) as Model<"openai-completions"> | undefined;
  return {
    ...pinned?.compat,
    // VERA applies explicit effort below the adapter and leaves the server default intact.
    supportsReasoningEffort: false,
    maxTokensField: preset === "deepseek" ? ("max_tokens" as const) : ("max_completion_tokens" as const),
  };
}

export function kimiMessagesCompatibility(model: string) {
  const pinned = kimiModels.find(({ id }) => id === model) as Model<"anthropic-messages"> | undefined;
  return pinned?.compat ?? {};
}
