import { useQuery } from "@tanstack/react-query";
import type { PluginSummary } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { Issues } from "./plugins.js";

/** Selection edits only the configuration draft; its owner saves or cancels it. */
export function WorkbenchPlugins({
  workbenchId,
  enabled,
  toggle,
}: {
  workbenchId?: string | undefined;
  enabled: readonly string[];
  toggle: (id: string, selected: boolean) => void;
}) {
  const { t } = useTranslation();
  const query = useQuery({
    queryKey: ["plugins", workbenchId ?? null],
    queryFn: () => api.invoke("plugins.list", workbenchId ? { workbenchId } : {}),
    staleTime: 0,
  });
  const entries: PluginSummary[] = query.data
    ? [
        ...query.data,
        ...enabled
          .filter((id) => !query.data.some((plugin) => plugin.id === id))
          .map((id) => ({ id, issues: [{ code: "unavailable" as const }], enabled: true })),
      ]
    : [];
  return (
    <div className="workbench-tools" data-workbench-plugins>
      <p className="muted">{t("plugins.selectionHint")}</p>
      {query.isPending && <p role="status">{t("home.loading")}</p>}
      {query.isError && (
        <>
          <ErrorMessage error={query.error} />
          <button type="button" onClick={() => void query.refetch()}>
            {t("settings.retry")}
          </button>
        </>
      )}
      {query.data && entries.length === 0 && <p>{t("plugins.none")}</p>}
      <ul>
        {entries.map((plugin) => {
          const selected = enabled.includes(plugin.id);
          return (
            <li key={plugin.id} data-workbench-plugin={plugin.id}>
              <label className="workbench-tool-option">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={!selected && plugin.issues.length > 0}
                  onChange={(event) => toggle(plugin.id, event.currentTarget.checked)}
                />
                <span>
                  <strong>{plugin.name ?? plugin.id}</strong>
                  {plugin.version && <span className="muted"> {plugin.version}</span>}
                  <span className="risk-badge">
                    {plugin.issues.length ? t("plugins.state.unavailable") : t("plugins.installed")}
                  </span>
                </span>
              </label>
              {plugin.description && (
                <details className="workbench-plugin-description">
                  <summary>{t("plugins.description")}</summary>
                  <p>{plugin.description}</p>
                </details>
              )}
              {plugin.issues.length > 0 && <Issues issues={plugin.issues} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
