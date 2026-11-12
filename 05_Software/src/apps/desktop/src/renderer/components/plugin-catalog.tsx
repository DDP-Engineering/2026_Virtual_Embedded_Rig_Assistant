import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CatalogPlugin, catalogUrl, type PluginCatalogView, type SettingsSnapshot } from "@vera/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { isNewCatalogEntry } from "./plugin-library.js";
import { pluginActivityLabels } from "./plugin-library-controls.js";

/** Under the `plugins` prefix, so every plugin change also reloads the catalog's installed states. */
export const catalogKey = ["plugins", "catalog"] as const;
const settingsKey = ["app.settings"];

/**
 * The plugins of `ids` that are not installed, each after the catalog plugins it requires (also when
 * they were not selected), in selection order.
 */
export function installOrder(view: PluginCatalogView, ids: readonly string[]): string[] {
  const byId = new Map(view.plugins.map((plugin) => [plugin.id, plugin]));
  const order: string[] = [];
  const visit = (id: string, path: Set<string>) => {
    const plugin = byId.get(id);
    if (!plugin || plugin.installed || order.includes(id) || path.has(id)) return;
    path.add(id);
    for (const required of plugin.requires) visit(required, path);
    order.push(id);
  };
  for (const id of ids) visit(id, new Set());
  return order;
}

/** The catalog folder URL setting; Use default removes it, keeping the package index and proxy. */
function CatalogUrl({ changed }: { changed: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const field = useId();
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => api.invoke("app.settings.get", {}),
  });
  const current = settings.data?.settings.plugins;
  const [draft, setDraft] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  const value = draft ?? current?.catalog ?? "";
  // The patch replaces the whole plugins object: it is built only from settings that have loaded.
  const locked = busy || !settings.isSuccess;
  async function save(catalog: string | undefined) {
    if (!settings.isSuccess) return;
    setError(undefined);
    if (catalog !== undefined && !catalogUrl(catalog)) {
      setInvalid(true);
      return;
    }
    setInvalid(false);
    setBusy(true);
    const { catalog: _previous, ...rest } = current ?? {};
    try {
      const snapshot: SettingsSnapshot = await api.invoke("app.settings.update", {
        plugins: catalog === undefined ? rest : { ...rest, catalog },
      });
      client.setQueryData(settingsKey, snapshot);
      setDraft(undefined);
      changed();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="catalog-url"
      onSubmit={(event) => {
        event.preventDefault();
        const text = value.trim();
        void save(text ? text : undefined);
      }}
    >
      <label htmlFor={field}>{t("plugins.catalog.url")}</label>
      <input
        id={field}
        type="url"
        data-catalog-url
        value={value}
        placeholder={t("plugins.catalog.urlPlaceholder")}
        aria-invalid={invalid}
        onChange={(event) => setDraft(event.target.value)}
      />
      <p className="muted">{t("plugins.catalog.urlHint")}</p>
      {invalid && <p role="alert">{t("plugins.catalog.urlInvalid")}</p>}
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="workbench-actions">
        <button type="submit" data-action="catalog-url-save" disabled={locked}>
          {t("plugins.catalog.save")}
        </button>
        <button
          type="button"
          data-action="catalog-url-default"
          disabled={locked || current?.catalog === undefined}
          onClick={() => void save(undefined)}
        >
          {t("plugins.catalog.useDefault")}
        </button>
      </div>
    </form>
  );
}

export function CatalogItem({
  plugin,
  busy,
  install,
}: {
  plugin: CatalogPlugin;
  busy: boolean;
  install: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <li className="plugin-card" data-catalog-plugin={plugin.id}>
      <p className="plugin-heading">
        <strong>{plugin.name}</strong>
        {isNewCatalogEntry(plugin.addedAt) && (
          <span className="risk-badge">{t("plugins.library.newBadge")}</span>
        )}
        <span>{plugin.version}</span>
        <span className="risk-badge" data-tier={plugin.tier}>
          {plugin.tier === "official" ? t("plugins.tier.official") : t("plugins.tier.community")}
        </span>
      </p>
      <p className="muted">
        <code>{plugin.id}</code>
        <span> · {plugin.ecosystem}</span>
        {plugin.requires.length > 0 && (
          <span>
            {" "}
            · {t("plugins.requires")}: {plugin.requires.join(", ")}
          </span>
        )}
      </p>
      <p>{plugin.description}</p>
      {plugin.installed && (
        <p className="muted" data-installed>
          {t("plugins.catalog.installed", { version: plugin.installed.version ?? "?" })}
        </p>
      )}
      <details>
        <summary>{t("plugins.library.details")}</summary>
        <PluginDiscoveryFacts entry={plugin} />
      </details>
      <div className="workbench-actions">
        {!plugin.installed && (
          <button
            type="button"
            data-action="catalog-install"
            disabled={busy}
            onClick={() => install(plugin.id)}
          >
            {t("plugins.catalog.installAction")}
          </button>
        )}
        {plugin.update && (
          <button
            type="button"
            data-action="catalog-update"
            disabled={busy}
            onClick={() => install(plugin.id)}
          >
            {t("plugins.catalog.update", { version: plugin.version })}
          </button>
        )}
      </div>
    </li>
  );
}

/** Publication facts are distinct from installation/check times, including unknown dates. */
export function PluginDiscoveryFacts({ entry }: { entry?: CatalogPlugin | undefined }) {
  const { t } = useTranslation();
  const activities = pluginActivityLabels(t);
  return (
    <dl className="plugin-facts plugin-discovery">
      <dt>{t("plugins.library.activity")}</dt>
      <dd>
        {entry?.activities.length
          ? entry.activities.map((value) => activities[value]).join(", ")
          : t("plugins.library.unclassified")}
      </dd>
      <dt>{t("plugins.library.addedAt")}</dt>
      <dd>{entry?.addedAt ?? t("plugins.library.dateUnavailable")}</dd>
      <dt>{t("plugins.library.updatedAt")}</dt>
      <dd>{entry?.updatedAt ?? t("plugins.library.dateUnavailable")}</dd>
    </dl>
  );
}

/** Explicit refresh action shares the global management toolbar. */
export function CatalogUpdateCheck() {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>();
  async function check() {
    setChecking(true);
    setError(undefined);
    try {
      client.setQueryData(catalogKey, await api.invoke("plugins.catalog", { refresh: true }));
    } catch (failure) {
      setError(failure);
    } finally {
      setChecking(false);
    }
  }
  return (
    <>
      <button type="button" data-action="catalog-check" disabled={checking} onClick={() => void check()}>
        {checking ? t("plugins.catalog.checking") : t("plugins.catalog.check")}
      </button>
      {error !== undefined && <ErrorMessage error={error} />}
    </>
  );
}

/** Source settings stay above the library; pack definitions are not selection UI. */
export function CatalogSettings({ catalog }: { catalog: UseQueryResult<PluginCatalogView> }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const view = catalog.data;
  return (
    <section className="plugin-catalog" data-plugin-catalog aria-label={t("plugins.catalog.title")}>
      {catalog.isPending && <p role="status">{t("home.loading")}</p>}
      {catalog.isError && <ErrorMessage error={catalog.error} />}
      {view && view.source !== "bundled" && (
        <p className="muted" data-catalog-source={view.source}>
          {view.source === "remote"
            ? t("plugins.catalog.remote", { url: view.url ?? "" })
            : t("plugins.catalog.none")}
        </p>
      )}
      {view?.problem && (
        <p role="status" data-catalog-problem={view.problem}>
          {view.problem === "invalid"
            ? t("plugins.catalog.problemInvalid")
            : t("plugins.catalog.problemUnreachable")}
        </p>
      )}
      <details className="plugin-catalog-settings">
        <summary>{t("plugins.library.catalogSettings")}</summary>
        <CatalogUrl changed={() => void client.invalidateQueries({ queryKey: catalogKey })} />
      </details>
    </section>
  );
}
