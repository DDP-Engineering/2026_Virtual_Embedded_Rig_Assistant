// REQ-UX-e07790cb REQ-UX-e5d617d7 REQ-UX-69b54580
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type { PluginSummary } from "@vera/shared";
import { useEffect, useId, useState } from "react";
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
  type ProgramReadiness,
  pluginProgramsKey,
  sortLibraryItems,
} from "./plugin-library.js";
import {
  PluginLibraryControls,
  PluginLibraryPagination,
  pluginActivityLabels,
} from "./plugin-library-controls.js";
import { Issues } from "./plugins.js";
import {
  type CapabilityControls,
  WorkbenchPluginCapabilities,
  WorkbenchSharedCapabilities,
} from "./workbench-capabilities.js";
import { WorkbenchPluginSetup } from "./workbench-plugin-setup.js";

/** Selection edits only the configuration draft; its owner saves or cancels it. */
export function WorkbenchPlugins(
  props: Omit<CapabilityControls, "locked"> & {
    workbenchId?: string | undefined;
    enabled: readonly string[];
    toggle: (id: string, selected: boolean) => void;
    readOnly?: boolean | undefined;
    disabled?: boolean | undefined;
    browsePlugins?: (() => void) | undefined;
  },
) {
  return <WorkbenchPluginLibrary key={props.workbenchId ?? "new"} {...props} />;
}
function WorkbenchPluginLibrary({
  workbenchId,
  enabled,
  toggle,
  readOnly = false,
  disabled = false,
  browsePlugins,
  disabledTools,
  toggleTool,
}: Omit<CapabilityControls, "locked"> & {
  workbenchId?: string | undefined;
  enabled: readonly string[];
  toggle: (id: string, selected: boolean) => void;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  browsePlugins?: (() => void) | undefined;
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
  const installed = query.data ?? [];
  const installedIds = new Set(installed.map(({ id }) => id));
  const entries: PluginSummary[] = query.data
    ? [
        ...installed,
        ...enabled
          .filter((id) => !installedIds.has(id))
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
  const emptyState = query.isSuccess && installed.length === 0 && (
    <div className="plugin-library-empty">
      <p>{t("plugins.none")}</p>
      {browsePlugins && (
        <button type="button" onClick={browsePlugins}>
          {t("plugins.library.browse")}
        </button>
      )}
    </div>
  );
  if (emptyState && entries.length === 0) {
    return <div data-workbench-plugins>{emptyState}</div>;
  }
  return (
    <div className="workbench-tools library-split" data-workbench-plugins>
      <div className="library-side">
        <p className="library-summary" data-workbench-selection-count>
          {t("plugins.selectedCount", { count: enabled.length })}
        </p>
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
      </div>
      <div className="library-main">
        {emptyState}
        {query.data && entries.length > 0 && !results.length && <p>{t("plugins.library.noMatches")}</p>}
        <ul className="plugin-library-list">
          {results.slice((page - 1) * state.pageSize, page * state.pageSize).map((item) => {
            const plugin = item.plugin;
            if (!plugin) return null;
            return (
              <WorkbenchPluginCard
                key={item.key}
                plugin={plugin}
                selected={enabled.includes(plugin.id)}
                installed={installedIds.has(plugin.id)}
                readiness={item.readiness}
                workbenchId={workbenchId}
                toggle={toggle}
                disabledTools={disabledTools}
                toggleTool={toggleTool}
                locked={readOnly || disabled}
              />
            );
          })}
        </ul>
        {query.data && (
          <WorkbenchSharedCapabilities
            plugins={installed}
            enabled={enabled}
            disabledTools={disabledTools}
            toggleTool={toggleTool}
            locked={readOnly || disabled}
          />
        )}
        <PluginLibraryPagination
          page={page}
          pageSize={state.pageSize}
          count={results.length}
          change={change}
        />
      </div>
    </div>
  );
}

function WorkbenchPluginCard({
  plugin,
  selected,
  installed,
  readiness,
  workbenchId,
  toggle,
  ...controls
}: CapabilityControls & {
  plugin: PluginSummary;
  selected: boolean;
  installed: boolean;
  readiness: ProgramReadiness;
  workbenchId: string | undefined;
  toggle: (id: string, selected: boolean) => void;
}) {
  const { t } = useTranslation();
  const nameId = useId();
  const buttonId = useId();
  const detailsId = useId();
  const [expanded, setExpanded] = useState(false);
  const hasPrograms = !plugin.manifest || Object.keys(plugin.manifest.programs).length > 0;
  const required = plugin.manifest?.requires ?? [];
  const status = {
    unchecked: t("plugins.notChecked"),
    ready: t("plugins.state.ready"),
    needs: t("plugins.library.needsConfiguration"),
    unavailable: t("plugins.library.readinessUnavailable"),
  }[readiness];
  const tier = {
    official: t("plugins.tier.official"),
    community: t("plugins.tier.community"),
    local: t("plugins.tier.local"),
    trial: t("plugins.tier.trial"),
  };
  return (
    <li className="plugin-card workbench-plugin-card" data-workbench-plugin={plugin.id}>
      <div className="workbench-plugin-row">
        <label className="workbench-plugin-selection">
          <input
            type="checkbox"
            data-workbench-plugin-toggle
            checked={selected}
            disabled={controls.locked || (!selected && plugin.issues.length > 0)}
            onChange={(event) => toggle(plugin.id, event.currentTarget.checked)}
          />
          <strong id={nameId}>{plugin.name ?? plugin.id}</strong>
        </label>
        {(readiness === "needs" || readiness === "unavailable") && (
          <span className="muted" data-readiness={readiness}>
            {status}
          </span>
        )}
        <button
          type="button"
          id={buttonId}
          data-action="workbench-plugin-details"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-labelledby={`${buttonId} ${nameId}`}
          onClick={() => setExpanded((value) => !value)}
        >
          {t("plugins.library.details")}
        </button>
      </div>
      <div id={detailsId} className="workbench-plugin-details" hidden={!expanded}>
        {(plugin.version || plugin.tier) && (
          <div className="plugin-heading">
            {plugin.version && (
              <span className="muted">
                {t("plugins.version")} {plugin.version}
              </span>
            )}
            {plugin.tier && <span className="risk-badge">{tier[plugin.tier]}</span>}
          </div>
        )}
        {plugin.description && <p>{plugin.description}</p>}
        {plugin.source === "workbench" && <p className="muted">{t("plugins.workbenchSource")}</p>}
        {required.length > 0 && (
          <dl className="plugin-facts">
            <dt>{t("plugins.requires")}</dt>
            <dd>{required.join(", ")}</dd>
          </dl>
        )}
        {plugin.issues.length > 0 && <Issues issues={plugin.issues} />}
        {installed && <WorkbenchPluginCapabilities plugin={plugin} selected={selected} {...controls} />}
        {!plugin.issues.length && hasPrograms && (
          <WorkbenchPluginSetup
            plugin={plugin}
            workbenchId={workbenchId}
            locked={controls.locked}
            executionAllowed={!controls.disabledTools.includes("run_program")}
            readiness={readiness}
            status={status}
          />
        )}
      </div>
    </li>
  );
}
