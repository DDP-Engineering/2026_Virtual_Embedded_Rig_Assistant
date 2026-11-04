// REQ-FUNC-68b75ba4: account catalog owns model IDs and native reasoning levels.
import type { Model } from "@earendil-works/pi-ai";
import { modelReferenceSchema, reasoningOptionSchema } from "@vera/shared";
import { z } from "zod";

const entry = z.object({
  slug: z
    .string()
    .min(1)
    .max(200)
    .refine((id) => modelReferenceSchema.safeParse(`chatgpt/${id}`).success),
  display_name: z.string().min(1).max(200),
  visibility: z.string(),
  context_window: z.number().int().positive().safe(),
  supported_reasoning_levels: z
    .array(z.object({ effort: reasoningOptionSchema }))
    .max(16)
    .optional(),
  input_modalities: z.array(z.string()).max(16).optional(),
});
const catalog = z.object({ models: z.array(entry).max(1000) });
export function parseChatGptCatalog(value: unknown, known: (id: string) => Model<string> | undefined) {
  const models = new Map<string, { model: Model<"openai-responses">; reasoningOptions: string[] }>();
  for (const item of catalog.parse(value).models) {
    if (item.visibility !== "list") continue;
    const previous = known(item.slug);
    // Codex Ultra orchestrates subagents; public Responses does not accept it as effort.
    const options = [
      ...new Set(
        item.supported_reasoning_levels?.map((r) => r.effort).filter((effort) => effort !== "ultra") ?? [],
      ),
    ];
    const input = item.input_modalities?.filter(
      (m): m is "text" | "image" => m === "text" || m === "image",
    ) ?? ["text"];
    models.set(item.slug, {
      reasoningOptions: options,
      model: {
        id: item.slug,
        name: item.display_name,
        api: "openai-responses",
        provider: "openai",
        baseUrl: "https://api.openai.com/v1",
        reasoning: options.length > 0,
        // Default must let the server choose, rather than the SDK inserting effort=none.
        thinkingLevelMap: { off: null },
        // Responses defaults omitted strict to true and makes every parameter required.
        // Tell pi this endpoint supports the flag so it explicitly sends strict:false,
        // preserving the optional fields of VERA's zod tool contracts.
        compat: { supportsStrictMode: true },
        input: input.length ? input : ["text"],
        contextWindow: item.context_window,
        maxTokens: previous?.maxTokens ?? 16384,
        cost: previous?.cost ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      },
    });
  }
  return models;
}
