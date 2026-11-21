import { useQuery } from "@tanstack/react-query";
import type { ProviderCatalog } from "@vera/shared";
import type { TFunction } from "i18next";
import { api } from "../api/index.js";

export type CatalogModel = ProviderCatalog["models"][number];

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
  const catalog = useQuery({
    queryKey: ["chat.models", providers.data],
    enabled: !!providers.data,
    queryFn: async () => {
      const ids = [
        ...(providers.data?.openai.configured ? ["openai"] : []),
        ...(providers.data?.custom.filter((p) => p.configured).map((p) => p.id) ?? []),
      ];
      const results = await Promise.allSettled(ids.map((id) => api.invoke("providers.models", { id })));
      return results.flatMap((c) => (c.status === "fulfilled" ? c.value.models : []));
    },
  });
  const models = [
    ...(catalog.data ?? []),
    ...(subscription.data?.connected ? (subscriptionModels.data?.models ?? []) : []),
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
