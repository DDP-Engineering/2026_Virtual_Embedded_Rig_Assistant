import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  type CatalogChannel,
  type CatalogPlugin,
  catalogUrl,
  type PluginCatalogView,
  type PluginPlatform,
  pluginText,
  type SettingsSnapshot,
} from "@vera/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { CatalogDependencies } from "./plugin-dependencies.js";
import { isNewCatalogEntry } from "./plugin-library.js";
import { MaturityBadge, pluginActivityLabels } from "./plugin-library-controls.js";

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

/** The remote catalog's release channel; saving it keeps the other plugin settings and reloads the catalog. */
function CatalogChannelSetting({ changed }: { changed: () => void }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const field = useId();
  const settings = useQuery({
    queryKey: settingsKey,
    queryFn: () => api.invoke("app.settings.get", {}),
  });
  const current = settings.data?.settings.plugins;
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);
  async function save(channel: CatalogChannel) {
    if (!settings.isSuccess) return;
    setError(undefined);
    setBusy(true);
    try {
      const snapshot: SettingsSnapshot = await api.invoke("app.settings.update", {
        plugins: { ...current, channel },
      });
      client.setQueryData(settingsKey, snapshot);
      changed();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="catalog-channel">
      <label htmlFor={field}>{t("plugins.catalog.channel")}</label>
      <select
        id={field}
        data-catalog-channel
        value={current?.channel ?? "stable"}
        // The patch replaces the whole plugins object: it is built only from settings that have loaded.
        disabled={busy || !settings.isSuccess}
        onChange={(event) => void save(event.target.value as CatalogChannel)}
      >
        <option value="stable">{t("plugins.catalog.channels.stable")}</option>
        <option value="pre-release">{t("plugins.catalog.channels.pre-release")}</option>
      </select>
      <p className="muted">{t("plugins.catalog.channelHint")}</p>
      {error !== undefined && <ErrorMessage error={error} />}
    </div>
  );
}
/** Why the catalog section does not show the configured remote catalog. */
function CatalogProblem({ problem }: { problem: NonNullable<PluginCatalogView["problem"]> }) {
  const { t } = useTranslation();
  const text =
    problem === "invalid"
      ? t("plugins.catalog.problemInvalid")
      : problem === "unsigned"
        ? t("plugins.catalog.problemUnsigned")
        : problem === "untrusted"
          ? t("plugins.catalog.problemUntrusted")
          : t("plugins.catalog.problemUnreachable");
  return (
    <p role="status" data-catalog-problem={problem}>
      {text}
    </p>
  );
}

/**
 * A catalog plugin before installing it: name, version, type and summary, with a warning when the host
 * platform is known and not supported, and one when a rule can write to or permanently change a device.
 */
export function CatalogItem({
  plugin,
  platform,
  installed,
  busy,
  install,
}: {
  plugin: CatalogPlugin;
  /** The host's plugin platform; undefined while unknown, which shows no platform warning. */
  platform?: PluginPlatform | undefined;
  /** The ids of the installed plugins, for the required plugins in the details. */
  installed: ReadonlySet<string>;
  busy: boolean;
  /** `programs`: Install with dependencies also installs the programs of every installed plugin. */
  install: (id: string, programs: boolean) => void;
}) {
  const { t, i18n } = useTranslation();
  const unsupported = platform !== undefined && !plugin.platforms.includes(platform);
  const risky = plugin.risk === "device-write" || plugin.risk === "irreversible";
  return (
    <li className="plugin-card" data-catalog-plugin={plugin.id}>
      <p className="plugin-heading">
        <strong>{plugin.name}</strong>
        {isNewCatalogEntry(plugin.addedAt) && (
          <span className="risk-badge">{t("plugins.library.newBadge")}</span>
        )}
        <span>{plugin.version}</span>
        <MaturityBadge version={plugin.version} />
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
      <p>{pluginText(plugin, i18n.language).summary}</p>
      {unsupported && (
        <p role="note" data-catalog-warning="platform">
          {t("plugins.catalog.platformWarning", { platforms: plugin.platforms.join(", ") })}
        </p>
      )}
      {risky && (
        <p role="note" data-catalog-warning="risk" data-risk={plugin.risk}>
          {plugin.risk === "irreversible"
            ? t("plugins.catalog.riskWarning.irreversible")
            : t("plugins.catalog.riskWarning.device-write")}
        </p>
      )}
      {plugin.installed && (
        <p className="muted" data-installed>
          {t("plugins.catalog.installed", { version: plugin.installed.version ?? "?" })}
        </p>
      )}
      <details>
        <summary>{t("plugins.library.details")}</summary>
        <PluginDiscoveryFacts entry={plugin} />
        <CatalogDependencies entry={plugin} platform={platform} installed={installed} />
      </details>
      <div className="workbench-actions">
        {!plugin.installed && (
          <>
            <button
              type="button"
              data-action="catalog-install"
              disabled={busy}
              onClick={() => install(plugin.id, false)}
            >
              {t("plugins.catalog.installAction")}
            </button>
            <button
              type="button"
              data-action="catalog-install-all"
              disabled={busy}
              onClick={() => install(plugin.id, true)}
            >
              {t("plugins.catalog.installWithDependencies")}
            </button>
          </>
        )}
        {plugin.update && (
          <button
            type="button"
            data-action="catalog-update"
            disabled={busy}
            onClick={() => install(plugin.id, false)}
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

/** Source settings stay above the library; packs are installed through Install a pack (plugin-packs.tsx). */
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
      {view?.problem && <CatalogProblem problem={view.problem} />}
      <details className="plugin-catalog-settings">
        <summary>{t("plugins.library.catalogSettings")}</summary>
        <CatalogUrl changed={() => void client.invalidateQueries({ queryKey: catalogKey })} />
        <CatalogChannelSetting changed={() => void client.invalidateQueries({ queryKey: catalogKey })} />
      </details>
    </section>
  );
}
