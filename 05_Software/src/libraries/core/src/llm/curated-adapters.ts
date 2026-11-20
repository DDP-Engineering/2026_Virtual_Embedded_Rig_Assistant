import type { Model } from "@earendil-works/pi-ai";
import { deepseekProvider } from "@earendil-works/pi-ai/providers/deepseek";
import { kimiCodingProvider } from "@earendil-works/pi-ai/providers/kimi-coding";
import { moonshotaiProvider } from "@earendil-works/pi-ai/providers/moonshotai";
import { zaiProvider } from "@earendil-works/pi-ai/providers/zai";

const deepSeekModels = deepseekProvider().getModels();
const moonshotModels = moonshotaiProvider().getModels();
const kimiModels = kimiCodingProvider().getModels();
const zaiModels = zaiProvider().getModels();

export const isMiniMaxPreset = (preset: string | undefined) =>
  preset === "minimax-api" || preset === "minimax-m-plan";

export const isZaiPreset = (preset: string | undefined) =>
  preset === "zai-api" || preset === "zai-coding-plan";

export function zaiCompletionsCompatibility(model: string) {
  const pinned = zaiModels.find(({ id }) => id === model) as Model<"openai-completions"> | undefined;
  return pinned?.compat;
}

export function miniMaxThinking(model: string, reasoning: string) {
  if (model === "MiniMax-M3") return { thinking: { type: reasoning === "on" ? "adaptive" : "disabled" } };
  return { output_config: { effort: reasoning } };
}

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
