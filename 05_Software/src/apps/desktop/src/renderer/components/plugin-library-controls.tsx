// REQ-UX-28a74094 REQ-UX-41da0f4f REQ-UX-85399085 REQ-UX-2697c05c
import { CATALOG_ACTIVITIES, type CatalogActivity } from "@vera/shared";
import type { TFunction } from "i18next";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import {
  type LibraryItem,
  type LibraryState,
  type LibraryStatus,
  matchesLibraryStatus,
} from "./plugin-library.js";

export function pluginActivityLabels(t: TFunction): Record<CatalogActivity, string> {
  return {
    communication: t("plugins.library.activities.communication"),
    flash: t("plugins.library.activities.flash"),
    build: t("plugins.library.activities.build"),
    debug: t("plugins.library.activities.debug"),
    "firmware-analysis": t("plugins.library.activities.firmwareAnalysis"),
    measurement: t("plugins.library.activities.measurement"),
    security: t("plugins.library.activities.security"),
    "version-control": t("plugins.library.activities.versionControl"),
    testing: t("plugins.library.activities.testing"),
  };
}
export function PluginLibraryControls({
  state,
  change,
  items,
  basic,
  total,
  count,
}: {
  state: LibraryState;
  change: (patch: Partial<LibraryState>) => void;
  items: readonly LibraryItem[];
  basic: readonly LibraryItem[];
  total: number;
  count: number;
}) {
  const { t } = useTranslation();
  const id = useId();
  const activities = pluginActivityLabels(t);
  const ecosystems = [...new Set(items.map((item) => item.ecosystem).filter(Boolean))].sort();
  const tiers =
    state.tab === "available" ? ["official", "community"] : ["official", "community", "local", "trial"];
  const tierLabels: Record<string, string> = {
    official: t("plugins.tier.official"),
    community: t("plugins.tier.community"),
    local: t("plugins.tier.local"),
    trial: t("plugins.tier.trial"),
  };
  const statuses: [LibraryStatus, string][] =
    state.tab === "available"
      ? [
          ["all", t("plugins.library.all")],
          ["missing", t("plugins.library.notInstalled")],
          ["installed", t("plugins.library.installed")],
          ["new", t("plugins.library.newInCatalog")],
          ["updates", t("plugins.library.updates")],
        ]
      : [
          ["all", t("plugins.library.all")],
          ["needs", t("plugins.library.needsConfiguration")],
          ["updates", t("plugins.library.updates")],
        ];
  const active = state.search || state.ecosystem || state.activity || state.tier || state.status !== "all";
  return (
    <div className="plugin-library-controls">
      <div className="plugin-library-search-row">
        <label htmlFor={`${id}-search`}>
          {t("plugins.library.search")}
          <input
            id={`${id}-search`}
            type="search"
            data-library-search
            value={state.search}
            placeholder={t("plugins.library.searchHint")}
            onChange={(event) => change({ search: event.target.value })}
          />
        </label>
        <label htmlFor={`${id}-sort`}>
          {t("plugins.library.sort")}
          <select
            id={`${id}-sort`}
            data-library-sort
            value={state.sort}
            onChange={(event) => change({ sort: event.target.value as LibraryState["sort"] })}
          >
            <option value="added">{t("plugins.library.recentlyAdded")}</option>
            <option value="updated">{t("plugins.library.recentlyUpdated")}</option>
            <option value="name">{t("plugins.library.nameOrder")}</option>
          </select>
        </label>
      </div>
      <div className="plugin-library-filter-row">
        <label htmlFor={`${id}-ecosystem`}>
          {t("plugins.library.ecosystem")}
          <select
            id={`${id}-ecosystem`}
            data-library-ecosystem
            value={state.ecosystem}
            onChange={(event) => change({ ecosystem: event.target.value })}
          >
            <option value="">{t("plugins.library.allEcosystems")}</option>
            {ecosystems.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-activity`}>
          {t("plugins.library.activity")}
          <select
            id={`${id}-activity`}
            data-library-activity
            value={state.activity}
            onChange={(event) => change({ activity: event.target.value })}
          >
            <option value="">{t("plugins.library.allActivities")}</option>
            {CATALOG_ACTIVITIES.map((value) => (
              <option key={value} value={value}>
                {activities[value]}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-tier`}>
          {t("plugins.library.provenance")}
          <select
            id={`${id}-tier`}
            data-library-tier
            value={state.tier}
            onChange={(event) => change({ tier: event.target.value })}
          >
            <option value="">{t("plugins.library.allSources")}</option>
            {tiers.map((value) => (
              <option key={value} value={value}>
                {tierLabels[value]}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset className="plugin-library-statuses">
        <legend className="sr-only">{t("plugins.library.filterState")}</legend>
        {statuses.map(([value, label]) => (
          <button
            type="button"
            key={value}
            data-library-status={value}
            aria-pressed={state.status === value}
            onClick={() => change({ status: value })}
          >
            {label} <span>{basic.filter((item) => matchesLibraryStatus(item, value)).length}</span>
          </button>
        ))}
      </fieldset>
      <div className="plugin-library-results">
        <p data-library-results role="status">
          {t("plugins.library.results", { count, total })}
        </p>
        {active && (
          <button
            type="button"
            data-action="library-clear"
            onClick={() => change({ search: "", ecosystem: "", activity: "", tier: "", status: "all" })}
          >
            {t("plugins.library.clear")}
          </button>
        )}
        <label htmlFor={`${id}-size`}>
          {t("plugins.library.pageSize")}
          <select
            id={`${id}-size`}
            data-library-page-size
            value={state.pageSize}
            onChange={(event) => change({ pageSize: Number(event.target.value) as LibraryState["pageSize"] })}
          >
            {[6, 12, 24].map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

export function PluginLibraryPagination({
  page,
  pageSize,
  count,
  change,
}: {
  page: number;
  pageSize: number;
  count: number;
  change: (patch: Partial<LibraryState>) => void;
}) {
  const { t } = useTranslation();
  const pages = Math.max(1, Math.ceil(count / pageSize));
  return (
    <div className="plugin-library-pagination">
      <span data-library-range>
        {t("plugins.library.range", {
          first: count ? (page - 1) * pageSize + 1 : 0,
          last: Math.min(page * pageSize, count),
          count,
        })}
      </span>
      <div>
        <button
          type="button"
          data-action="library-previous"
          disabled={page <= 1}
          onClick={() => change({ page: page - 1 })}
        >
          {t("plugins.library.previous")}
        </button>
        <span>{t("plugins.library.page", { page, pages })}</span>
        <button
          type="button"
          data-action="library-next"
          disabled={page >= pages}
          onClick={() => change({ page: page + 1 })}
        >
          {t("plugins.library.next")}
        </button>
      </div>
    </div>
  );
}
