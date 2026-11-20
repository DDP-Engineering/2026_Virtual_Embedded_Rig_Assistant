import { type CuratedDiscovery, curatedModelIdSchema } from "@vera/shared";
import { z } from "zod";

type CatalogProfiles = NonNullable<Extract<CuratedDiscovery, { status: "discovered" }>["profiles"]>;

const tokens = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const deepSeekList = z.object({
  data: z
    .array(
      z.object({
        id: curatedModelIdSchema,
        name: z.string().trim().min(1).max(240).optional(),
        context_window: tokens.optional(),
        max_output_tokens: tokens.optional(),
        input_modalities: z.array(z.string().max(32)).max(16).optional(),
        effort: z.object({ supported_levels: z.array(z.string().max(32)).max(16) }).optional(),
      }),
    )
    .max(10000),
});
const moonshotList = z.object({
  data: z
    .array(
      z.object({
        id: curatedModelIdSchema,
        context_length: tokens.optional(),
        supports_image_in: z.boolean().optional(),
        supports_reasoning: z.boolean().optional(),
      }),
    )
    .max(10000),
});

/** Project documented fields that VERA can use from the authenticated catalog. */
export function parseDirectCatalog(body: unknown, metadata: "deepseek" | "moonshot"): CatalogProfiles {
  if (metadata === "moonshot") {
    return moonshotList.parse(body).data.map((model) => ({
      id: model.id,
      name: model.id,
      ...(model.context_length === undefined ? {} : { contextWindow: model.context_length }),
      ...(model.supports_image_in === undefined
        ? {}
        : { input: model.supports_image_in ? ["text", "image"] : ["text"] }),
      ...(model.supports_reasoning === undefined ? {} : { reasoning: model.supports_reasoning }),
      ...(model.supports_reasoning === false ? { reasoningOptions: [] } : {}),
    }));
  }
  return deepSeekList.parse(body).data.map((model) => {
    const efforts = model.effort?.supported_levels.filter(
      (level) => level === "low" || level === "high" || level === "max",
    );
    return {
      id: model.id,
      name: model.name ?? model.id,
      ...(model.context_window === undefined ? {} : { contextWindow: model.context_window }),
      ...(model.max_output_tokens === undefined ? {} : { maxOutputTokens: model.max_output_tokens }),
      ...(model.input_modalities?.includes("text")
        ? { input: model.input_modalities.includes("image") ? ["text", "image"] : ["text"] }
        : {}),
      ...(efforts?.length ? { reasoningOptions: [...new Set(efforts)] } : {}),
    };
  });
}
