import { nvidiaProvider } from "@earendil-works/pi-ai/providers/nvidia";
import { curatedModelIdSchema } from "@vera/shared";
import { z } from "zod";

const idRow = z.object({ id: curatedModelIdSchema });
const tokens = z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional().catch(undefined);
const flag = z.boolean().optional().catch(undefined);
const words = z.array(z.string()).optional().catch(undefined);
const hfCatalog = z.object({
  data: z
    .array(
      idRow.extend({
        architecture: z.object({ input_modalities: words }).optional().catch(undefined),
        providers: z
          .array(
            z.object({
              status: z.enum(["live", "error"]).optional().catch(undefined),
              context_length: tokens,
              supports_tools: flag,
            }),
          )
          .optional(),
      }),
    )
    .max(10000),
});
const nvidiaCatalog = z.object({
  data: z
    .array(
      idRow.extend({
        model_type: z.string().optional(),
        context_window: tokens,
        supports_tools: flag,
        supports_thinking: flag,
      }),
    )
    .max(10000),
});
const vercelCatalog = z.object({
  data: z
    .array(
      idRow.extend({
        type: z.string().optional(),
        name: z
          .string()
          .trim()
          .min(1)
          .max(240)
          .regex(/^[^\p{Cc}]+$/u)
          .optional()
          .catch(undefined),
        context_window: tokens,
        max_tokens: tokens,
        modalities: z.object({ input: words }).optional().catch(undefined),
        tags: words,
        supported_parameters: words,
      }),
    )
    .max(10000),
});

const nvidiaChat = new Map(
  nvidiaProvider()
    .getModels()
    .map((model) => [model.id, model]),
);

function supportedInputs(modalities: readonly string[] | undefined): { input?: ("text" | "image")[] } {
  if (!modalities?.includes("text")) return {};
  return { input: modalities.includes("image") ? ["text", "image"] : ["text"] };
}

export function parseHuggingFaceCatalog(body: unknown) {
  return hfCatalog.parse(body).data.flatMap(({ id, architecture, providers }) => {
    const available = providers?.filter(({ status }) => status !== "error") ?? [];
    if (providers?.length && !available.length) return [];

    // A route with unknown status can change which tool and context guarantees apply.
    const live = available.every(({ status }) => status === "live") ? available : [];
    const supportsTools = live[0]?.supports_tools;
    const contextLimits = live.flatMap(({ context_length }) => context_length ?? []);
    return [
      {
        id,
        name: id,
        ...supportedInputs(architecture?.input_modalities),
        ...(live.length && contextLimits.length === live.length
          ? { contextWindow: Math.min(...contextLimits) }
          : {}),
        ...(supportsTools !== undefined && live.every((route) => route.supports_tools === supportsTools)
          ? { supportsTools }
          : {}),
      },
    ];
  });
}

export function parseNvidiaCatalog(body: unknown) {
  return nvidiaCatalog
    .parse(body)
    .data.flatMap(({ id, model_type, context_window, supports_tools, supports_thinking }) => {
      const known = nvidiaChat.get(id);
      if (model_type !== undefined ? !["llm", "vlm"].includes(model_type) : !known) return [];
      const contextWindow = context_window ?? known?.contextWindow;
      const reasoning = supports_thinking ?? known?.reasoning;
      // The NIM API reference lists tool calls for this exact hosted ID.
      const supportsTools = supports_tools ?? (id === "meta/muse-glimmer-30b" ? true : undefined);
      return [
        {
          id,
          name: known?.name ?? id,
          ...supportedInputs(model_type === "vlm" ? ["text", "image"] : known?.input),
          ...(contextWindow === undefined ? {} : { contextWindow }),
          ...(known ? { maxOutputTokens: known.maxTokens } : {}),
          ...(reasoning === undefined ? {} : { reasoning }),
          ...(supportsTools === undefined ? {} : { supportsTools }),
        },
      ];
    });
}

export function parseVercelCatalog(body: unknown) {
  return vercelCatalog
    .parse(body)
    .data.filter(({ type }) => type === "language")
    .map(({ id, name, context_window, max_tokens, modalities, tags, supported_parameters }) => ({
      id,
      name: name ?? id,
      ...supportedInputs(modalities?.input),
      ...(context_window === undefined ? {} : { contextWindow: context_window }),
      ...(max_tokens === undefined ? {} : { maxOutputTokens: max_tokens }),
      ...(tags?.includes("tool-use") || supported_parameters?.includes("tools")
        ? { supportsTools: true }
        : {}),
      ...(tags?.includes("reasoning") ? { reasoning: true } : {}),
    }));
}
