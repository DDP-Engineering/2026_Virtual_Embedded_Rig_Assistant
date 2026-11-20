import {
  type CuratedDiscovery,
  type CuratedModel,
  curatedModelIdSchema,
  type HostedCatalogMetadata,
} from "@vera/shared";
import { z } from "zod";

type CatalogProfiles = NonNullable<Extract<CuratedDiscovery, { status: "discovered" }>["profiles"]>;

const label = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .regex(/^[^\p{Cc}]+$/u)
  .optional()
  .catch(undefined);
const tokens = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional().catch(undefined);
const flag = z.boolean().optional().catch(undefined);
const idRow = z.object({ id: curatedModelIdSchema });
const fireworksPage = z.object({
  models: z
    .array(
      z.object({
        name: curatedModelIdSchema.regex(/^accounts\/fireworks\/models\/[^/]+$/),
        displayName: label,
        contextLength: tokens,
        supportsTools: flag,
        supportsImageInput: flag,
        supportsServerless: flag,
        state: z.string().optional().catch(undefined),
        conversationConfig: z.object({ style: label, template: label }).optional().catch(undefined),
      }),
    )
    .max(200),
  nextPageToken: z.string().max(4096).optional(),
});

export function parseFireworksPage(body: unknown, documented: readonly CuratedModel[] = []) {
  const { models, nextPageToken } = fireworksPage.parse(body);
  const profiles: CatalogProfiles = [];
  for (const model of models) {
    if (
      model.supportsServerless !== true ||
      (model.state !== undefined && model.state !== "READY") ||
      !(
        model.supportsTools ||
        model.conversationConfig?.style ||
        model.conversationConfig?.template ||
        documented.some(({ id }) => id === model.name)
      )
    )
      continue;
    profiles.push({
      id: model.name,
      name: model.displayName ?? model.name,
      ...(model.contextLength === undefined ? {} : { contextWindow: model.contextLength }),
      ...(model.supportsTools === undefined ? {} : { supportsTools: model.supportsTools }),
      ...(model.supportsImageInput === undefined
        ? {}
        : { input: model.supportsImageInput ? ["text", "image"] : ["text"] }),
    });
  }
  return { profiles, nextPageToken };
}

const togetherRows = z
  .array(
    idRow.extend({
      type: z.string().nullish(),
      display_name: label,
      context_length: tokens,
    }),
  )
  .max(10000);
const togetherList = z.union([togetherRows, z.object({ data: togetherRows })]);
const groqList = z.object({
  data: z
    .array(
      idRow.extend({
        active: z.boolean().nullish(),
        context_window: tokens,
        max_completion_tokens: tokens,
      }),
    )
    .max(10000),
});
const cerebrasList = z.object({ data: z.array(idRow).max(10000) });

const groqOtherModels = new Set([
  "canopylabs/orpheus-arabic-saudi",
  "canopylabs/orpheus-v1-english",
  "distil-whisper-large-v3-en",
  "llama-guard-3-8b",
  "meta-llama/llama-guard-4-12b",
  "meta-llama/llama-prompt-guard-2-22m",
  "meta-llama/llama-prompt-guard-2-86m",
  "whisper-large-v3",
  "whisper-large-v3-turbo",
]);

/** Project only fields the service publishes for this listing. */
export function parseHostedCatalog(
  body: unknown,
  metadata: Exclude<HostedCatalogMetadata, "fireworks">,
): CatalogProfiles {
  switch (metadata) {
    case "together": {
      const list = togetherList.parse(body);
      return (Array.isArray(list) ? list : list.data)
        .filter(({ type }) => type == null || type === "chat")
        .map(({ id, display_name, context_length }) => ({
          id,
          name: display_name ?? id,
          ...(context_length === undefined ? {} : { contextWindow: context_length }),
        }));
    }
    case "groq":
      return groqList
        .parse(body)
        .data.filter(({ id, active }) => active !== false && !groqOtherModels.has(id))
        .map(({ id, context_window, max_completion_tokens }) => ({
          id,
          name: id,
          ...(context_window === undefined ? {} : { contextWindow: context_window }),
          ...(max_completion_tokens === undefined ? {} : { maxOutputTokens: max_completion_tokens }),
        }));
    case "cerebras":
      return cerebrasList.parse(body).data.map(({ id }) => ({ id, name: id }));
  }
}
