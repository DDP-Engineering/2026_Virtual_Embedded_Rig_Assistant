import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";

/**
 * The conversation models VERA can use: the ChatGPT subscription's models when signed in, plus those of
 * every configured API or local provider. Same queries as the composer, so the cache is shared.
 */
function useModelReferences(): string[] {
  const providers = useQuery({
    queryKey: ["providers.list"],
    queryFn: () => api.invoke("providers.list", {}),
  });
  const subscription = useQuery({
    queryKey: ["chatgpt.status"],
    queryFn: () => api.invoke("providers.chatgpt.status", {}),
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
        ...(providers.data?.openai.configured ? ["openai" as const] : []),
        ...(providers.data?.custom.map((p) => p.id) ?? []),
      ];
      const results = await Promise.all(ids.map((id) => api.invoke("providers.models", { id })));
      return results.flatMap((c) => c.models);
    },
  });
  const references = [
    ...(subscription.data?.connected ? (subscriptionModels.data?.models ?? []) : []),
    ...(catalog.data ?? []),
  ].map((model) => model.reference);
  return [...new Set(references)];
}

/**
 * A conversation model for a workbench: empty means the application default; the known models are
 * offered as suggestions, and any other reference can still be typed.
 */
export function ModelSelect({
  id,
  value,
  change,
  disabled,
}: {
  id: string;
  value: string | null;
  change: (model: string | null) => void;
  disabled?: boolean | undefined;
}) {
  const { t } = useTranslation();
  const references = useModelReferences();
  return (
    <>
      <input
        id={id}
        data-project-model
        list={`${id}-options`}
        placeholder={t("overview.appDefault")}
        value={value ?? ""}
        disabled={disabled}
        onChange={(event) => change(event.target.value.trim() || null)}
      />
      <datalist id={`${id}-options`}>
        {references.map((reference) => (
          <option key={reference} value={reference} />
        ))}
      </datalist>
    </>
  );
}
