// REQ-UX-09ed27ff REQ-FUNC-6014ce37
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionState } from "@vera/shared";
import { Brain } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";

export function ReasoningPicker({
  sessionId,
  state,
  disabled,
  catalogVersion,
}: {
  sessionId: string;
  state: SessionState;
  disabled: boolean;
  catalogVersion: number;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<unknown>();
  const workbench = useQuery({
    queryKey: ["workbench.active"],
    queryFn: () => api.invoke("workbench.config.get", {}),
  });
  const settings = useQuery({ queryKey: ["app.settings"], queryFn: () => api.getSettings() });
  const configured =
    state.modelRef ?? workbench.data?.config.agent.model ?? settings.data?.settings.defaultModel;
  const key = ["session.reasoning", sessionId, configured, settings.dataUpdatedAt, catalogVersion];
  const metadata = useQuery({
    queryKey: key,
    enabled: !!configured && !saving,
    queryFn: () => api.invoke("session.reasoning.get", { sessionId }),
  });
  const { refetch } = metadata;
  const observed = useRef(state.reasoning);
  useEffect(() => {
    if (observed.current === state.reasoning) return;
    observed.current = state.reasoning;
    if (configured) void refetch();
  }, [state.reasoning, configured, refetch]);
  const names: Record<string, string> = {
    off: t("discovery.off"),
    on: t("discovery.on"),
    low: t("discovery.low"),
    medium: t("discovery.medium"),
    high: t("discovery.high"),
    xhigh: t("discovery.xhigh"),
    none: t("chat.reasoningNone"),
    minimal: t("chat.reasoningMinimal"),
    max: t("chat.reasoningMax"),
    ultra: t("chat.reasoningUltra"),
  };
  if (metadata.error) return <ErrorMessage error={metadata.error} />;
  const details = metadata.data;
  if (!details?.options.length) return null;
  return (
    <>
      <label className="composer-reasoning" title={t("chat.reasoningLevel")}>
        <Brain aria-hidden="true" />
        <span className="sr-only">{t("chat.reasoningLevel")}</span>
        <select
          data-reasoning-picker
          value={details.selected ?? ""}
          disabled={disabled || saving}
          onChange={(event) => {
            const reasoning = event.currentTarget.value || null;
            const modelRef = details.modelRef;
            setSaving(true);
            setFailure(undefined);
            void (async () => {
              try {
                await client.cancelQueries({ queryKey: key, exact: true });
                const value = await api.invoke("session.reasoning.set", { sessionId, modelRef, reasoning });
                client.setQueryData(key, value);
              } catch (error) {
                setFailure(error);
              } finally {
                setSaving(false);
              }
            })();
          }}
        >
          <option value="">{t("chat.reasoningDefault")}</option>
          {details.options.map((value) => (
            <option key={value} value={value}>
              {names[value] ?? value}
            </option>
          ))}
        </select>
      </label>
      {failure !== undefined && <ErrorMessage error={failure} />}
    </>
  );
}
