import { useQuery } from "@tanstack/react-query";
import type { ProviderCatalog } from "@vera/shared";
import type { TFunction } from "i18next";
import { api } from "../api/index.js";

export type CatalogModel = ProviderCatalog["models"][number];

/** A provider's ticked models, in catalog order; a provider with no list offers its whole catalog. */
export function offeredModels(models: readonly CatalogModel[], enabled: readonly string[] | undefined) {
  return enabled ? models.filter((model) => enabled.includes(model.id)) : [...models];
}

/** Both model selectors use one catalog and refresh when connection settings change. */
export function useModelCatalog() {
  const providers = useQuery({
    queryKey: ["providers.list"],
    queryFn: () => api.invoke("providers.list", {}),
  });
  const subscription = useQuery({
    queryKey: ["chatgpt.status"],
    queryFn: () => api.invoke("providers.chatgpt.status", {}),
    staleTime: 0,
    refetchInterval: ({ state: { data } }) =>
      data?.state === "pending" || data?.state === "manual" ? 1000 : false,
  });
  const subscriptionModels = useQuery({
    queryKey: ["chatgpt.models"],
    enabled: subscription.data?.connected === true,
    queryFn: () => api.invoke("providers.models", { id: "chatgpt" }),
  });
  const sources = [
    ...(providers.data?.openai.configured ? [providers.data.openai] : []),
    ...(providers.data?.custom.filter((p) => p.configured) ?? []),
  ];
  // Ticks are not part of the key: saving them filters the cached catalogs instead of fetching them again.
  const catalogKey = sources.map(({ enabledModels: _ticks, ...source }) => source);
  const catalog = useQuery({
    queryKey: ["chat.models", catalogKey],
    enabled: !!providers.data,
    queryFn: async () => {
      const results = await Promise.allSettled(
        sources.map(({ id }) => api.invoke("providers.models", { id })),
      );
      return results.flatMap((c, index) =>
        c.status === "fulfilled" ? [{ id: sources[index]?.id, models: c.value.models }] : [],
      );
    },
  });
  const ticks = new Map(sources.map(({ id, enabledModels }) => [id, enabledModels]));
  const models = [
    ...(catalog.data ?? []).flatMap(({ id, models }) =>
      offeredModels(models, id ? ticks.get(id) : undefined),
    ),
    ...(subscription.data?.connected
      ? offeredModels(subscriptionModels.data?.models ?? [], providers.data?.chatgpt.enabledModels)
      : []),
  ];
  const connections = providers.data?.custom ?? [];
  return { providers, subscription, subscriptionModels, catalog, models, connections };
}

export function modelOptionLabel(
  model: CatalogModel,
  connections: readonly { id: string; name: string }[],
  t: TFunction,
  locale: string,
): string {
  const provider = model.reference.split("/", 1)[0];
  const service =
    model.providerName ??
    (provider === "openai"
      ? t("providers.openai")
      : provider === "chatgpt"
        ? t("chatgpt.title")
        : (connections.find(({ id }) => id === provider)?.name ?? provider));
  const tokens = model.contextWindow.toLocaleString(locale);
  const context =
    model.contextVerified === false
      ? t("providers.modelContextConfigured", { tokens })
      : t("providers.modelContext", { tokens });
  return [
    `${service} / ${model.id}`,
    context,
    model.inputVerified === false
      ? t("providers.inputUnverified")
      : model.input.includes("image")
        ? t("providers.inputImages")
        : t("providers.inputText"),
    model.supportsTools === undefined
      ? t("providers.toolsUnverified")
      : model.supportsTools
        ? t("providers.steps.tools")
        : t("providers.toolsUnavailable"),
    ...(model.reasoningOptions?.length
      ? [t("providers.modelReasoning")]
      : model.curated && !model.reasoningOptions
        ? [t("providers.reasoningUnverified")]
        : []),
  ].join(" · ");
}
