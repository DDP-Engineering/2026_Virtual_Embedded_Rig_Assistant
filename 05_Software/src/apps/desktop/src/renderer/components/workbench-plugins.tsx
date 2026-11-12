// REQ-UX-e07790cb REQ-UX-e5d617d7 REQ-UX-69b54580
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginSummary } from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { catalogKey } from "./plugin-catalog.js";
import {
  initialLibraryState,
  installedLibraryItems,
  type LibraryState,
  matchesLibraryFilters,
  matchesLibraryStatus,
  pluginProgramsKey,
  sortLibraryItems,
} from "./plugin-library.js";
import {
  PluginLibraryControls,
  PluginLibraryPagination,
  pluginActivityLabels,
} from "./plugin-library-controls.js";
import { Issues, Programs } from "./plugins.js";

/** Selection edits only the configuration draft; its owner saves or cancels it. */
export function WorkbenchPlugins(props: {
  workbenchId?: string | undefined;
  enabled: readonly string[];
  toggle: (id: string, selected: boolean) => void;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  return <WorkbenchPluginLibrary key={props.workbenchId ?? "new"} {...props} />;
}
function WorkbenchPluginLibrary({
  workbenchId,
  enabled,
  toggle,
  readOnly = false,
  disabled = false,
}: {
  workbenchId?: string | undefined;
  enabled: readonly string[];
  toggle: (id: string, selected: boolean) => void;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [stateKey] = useState(() => ["ui", "workbench-plugins", workbenchId ?? "new"] as const);
  const [state, setState] = useState<LibraryState>(() => {
    client.setQueryDefaults(stateKey, { gcTime: Infinity });
    return (
      client.getQueryData<LibraryState>(stateKey) ?? {
        ...initialLibraryState,
        sort: "name",
      }
    );
  });
  useEffect(() => {
    client.setQueryData(stateKey, state);
  }, [client, stateKey, state]);
  const change = (patch: Partial<LibraryState>) => setState((current) => ({ ...current, page: 1, ...patch }));
  const query = useQuery({
    queryKey: ["plugins", workbenchId ?? null],
    queryFn: () => api.invoke("plugins.list", workbenchId ? { workbenchId } : {}),
    staleTime: 0,
  });
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => api.invoke("plugins.catalog", { refresh: false }),
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
  const observations = useQueries({
    queries: entries.map((plugin) => ({
      queryKey: pluginProgramsKey(workbenchId, plugin),
      queryFn: () =>
        api.invoke("plugins.programs", { id: plugin.id, ...(workbenchId ? { workbenchId } : {}) }),
      enabled: false,
      staleTime: Infinity,
    })),
  });
  const items = installedLibraryItems(
    entries,
    catalog.data?.plugins ?? [],
    (plugin) => observations[entries.indexOf(plugin)]?.data,
    (plugin) => observations[entries.indexOf(plugin)]?.isError ?? false,
  ).map((item) => ({ ...item, selected: enabled.includes(item.id) }));
  const basic = items.filter((item) => matchesLibraryFilters(item, state, pluginActivityLabels(t)));
  const results = sortLibraryItems(
    basic.filter((item) => matchesLibraryStatus(item, state.status)),
    state.sort,
    i18n.language,
  );
  const page = Math.min(state.page, Math.max(1, Math.ceil(results.length / state.pageSize)));
  useEffect(() => {
    if (query.data && !catalog.isPending && page !== state.page)
      setState((current) => ({ ...current, page }));
  }, [query.data, catalog.isPending, page, state.page]);
  const readiness = {
    unchecked: t("plugins.notChecked"),
    ready: t("plugins.state.ready"),
    needs: t("plugins.library.needsConfiguration"),
    unavailable: t("plugins.library.readinessUnavailable"),
  };
  const tierLabels = {
    official: t("plugins.tier.official"),
    community: t("plugins.tier.community"),
    local: t("plugins.tier.local"),
    trial: t("plugins.tier.trial"),
  };
  return (
    <div className="workbench-tools" data-workbench-plugins>
      <p className="muted">{t("plugins.selectionHint")}</p>
      <p data-workbench-selection-count>{t("plugins.selectedCount", { count: enabled.length })}</p>
      {query.isPending && <p role="status">{t("home.loading")}</p>}
      {query.isError && (
        <>
          <ErrorMessage error={query.error} />
          <button type="button" onClick={() => void query.refetch()}>
            {t("settings.retry")}
          </button>
        </>
      )}
      {catalog.isError && <ErrorMessage error={catalog.error} />}
      <PluginLibraryControls
        state={state}
        change={change}
        items={items}
        basic={basic}
        total={items.length}
        count={results.length}
        statusOptions={[
          ["all", t("plugins.library.all")],
          ["enabled", t("plugins.enabledSelection")],
          ["needs", t("plugins.library.needsConfiguration")],
        ]}
      />
      {query.data && entries.length === 0 && <p>{t("plugins.none")}</p>}
      {query.data && entries.length > 0 && !results.length && <p>{t("plugins.library.noMatches")}</p>}
      <ul className="plugin-library-list">
        {results.slice((page - 1) * state.pageSize, page * state.pageSize).map((item) => {
          const plugin = item.plugin;
          if (!plugin) return null;
          const selected = enabled.includes(plugin.id);
          return (
            <li className="plugin-card" key={item.key} data-workbench-plugin={plugin.id}>
              <label className="workbench-tool-option">
                <input
                  type="checkbox"
                  checked={selected}
                  disabled={readOnly || disabled || (!selected && plugin.issues.length > 0)}
                  onChange={(event) => {
                    if (!readOnly && !disabled) toggle(plugin.id, event.currentTarget.checked);
                  }}
                />
                <span>
                  <strong>{plugin.name ?? plugin.id}</strong>
                  {plugin.version && <span className="muted"> {plugin.version}</span>}
                  {plugin.tier && <span className="risk-badge">{tierLabels[plugin.tier]}</span>}
                </span>
              </label>
              <p className="muted" data-readiness={item.readiness}>
                {readiness[item.readiness]}
              </p>
              {plugin.source === "workbench" && <p className="muted">{t("plugins.workbenchSource")}</p>}
              {plugin.description && (
                <details className="workbench-plugin-description">
                  <summary>{t("plugins.description")}</summary>
                  <p>{plugin.description}</p>
                </details>
              )}
              {plugin.issues.length ? (
                <Issues issues={plugin.issues} />
              ) : (
                <WorkbenchPluginSetup
                  plugin={plugin}
                  workbenchId={workbenchId}
                  locked={readOnly || disabled}
                />
              )}
            </li>
          );
        })}
      </ul>
      <PluginLibraryPagination page={page} pageSize={state.pageSize} count={results.length} change={change} />
    </div>
  );
}

function WorkbenchPluginSetup({
  plugin,
  workbenchId,
  locked,
}: {
  plugin: PluginSummary;
  workbenchId: string | undefined;
  locked: boolean;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const queryKey = pluginProgramsKey(workbenchId, plugin);
  const request = { id: plugin.id, ...(workbenchId ? { workbenchId } : {}) };
  const programs = useQuery({
    queryKey,
    queryFn: () => api.invoke("plugins.programs", request),
    enabled: false,
    staleTime: Infinity,
  });
  const installable =
    !programs.isError &&
    programs.data?.some(
      (status) =>
        status.kind !== "find" &&
        (!status.external || status.downloadAvailable) &&
        status.problem !== "platform" &&
        status.problem !== "uv" &&
        (status.state === "missing" ||
          (status.state === "unavailable" && ["version", "range"].includes(status.problem ?? "")) ||
          status.downloadAvailable),
    );
  async function act(kind: "check" | "provision" | "archive", program?: string) {
    if (locked || busy) return;
    setBusy(true);
    setError(undefined);
    try {
      await client.cancelQueries({ queryKey, exact: true });
      if (kind === "archive") {
        const statuses = await api.invoke("plugins.installArchive", {
          ...request,
          program: program ?? "",
          sha256: plugin.sha256 ?? "",
        });
        if (statuses) client.setQueryData(queryKey, statuses);
      } else
        await client.fetchQuery({
          queryKey,
          staleTime: 0,
          retry: false,
          queryFn: () =>
            kind === "check"
              ? api.invoke("plugins.check", request)
              : api.invoke("plugins.provision", request),
        });
    } catch (failure) {
      if (live.current) setError(failure);
    } finally {
      if (live.current) setBusy(false);
    }
  }
  return (
    <details data-workbench-configuration>
      <summary>{t("plugins.configure")}</summary>
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="plugin-card-actions">
        <button
          type="button"
          data-action="plugin-check"
          disabled={locked || busy}
          onClick={() => void act("check")}
        >
          {busy ? t("plugins.checking") : t("plugins.checkDependencies")}
        </button>
        <button
          type="button"
          data-action="plugin-provision"
          disabled={locked || busy || !installable}
          onClick={() => void act("provision")}
        >
          {t("plugins.installDependencies")}
        </button>
      </div>
      {programs.data ? (
        <Programs
          statuses={programs.data}
          busy={busy}
          {...(!locked ? { archive: (name: string) => void act("archive", name) } : {})}
        />
      ) : (
        <p>{t("plugins.checkFirst")}</p>
      )}
    </details>
  );
}
