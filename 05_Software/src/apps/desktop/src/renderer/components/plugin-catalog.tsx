import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query";
import { type CatalogPlugin, catalogUrl, type PluginCatalogView, type SettingsSnapshot } from "@vera/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

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

function CatalogItem({
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

/**
 * The catalog: where it comes from, the URL setting, packs as checkable groups (defaults checked) and
 * every catalog plugin with its tier and installed state. `install` reviews the given ids in order.
 */
export function CatalogSection({
  catalog,
  busy,
  install,
}: {
  catalog: UseQueryResult<PluginCatalogView>;
  busy: boolean;
  install: (ids: string[]) => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const title = useId();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<unknown>();
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const view = catalog.data;
  const names = new Map(view?.plugins.map((plugin) => [plugin.id, plugin.name]));
  const selected = view
    ? installOrder(
        view,
        view.packs.flatMap((pack) =>
          pack.groups.flatMap((group) =>
            (choices[`${pack.id}/${group.name}`] ?? group.default) ? group.plugins : [],
          ),
        ),
      )
    : [];
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
    <section className="plugin-catalog" aria-labelledby={title} data-plugin-catalog>
      <h3 id={title}>{t("plugins.catalog.title")}</h3>
      {catalog.isPending && <p role="status">{t("home.loading")}</p>}
      {catalog.isError && <ErrorMessage error={catalog.error} />}
      {view && (
        <p className="muted" data-catalog-source={view.source}>
          {view.source === "remote"
            ? t("plugins.catalog.remote", { url: view.url ?? "" })
            : view.source === "bundled"
              ? t("plugins.catalog.bundled")
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
      <div className="workbench-actions">
        <button type="button" data-action="catalog-check" disabled={checking} onClick={() => void check()}>
          {checking ? t("plugins.catalog.checking") : t("plugins.catalog.check")}
        </button>
      </div>
      {error !== undefined && <ErrorMessage error={error} />}
      <CatalogUrl changed={() => void client.invalidateQueries({ queryKey: catalogKey })} />
      {view && view.packs.length > 0 && (
        <>
          <h4>{t("plugins.catalog.packs")}</h4>
          {view.packs.map((pack) => (
            <fieldset className="catalog-pack" key={pack.id} data-pack={pack.id}>
              <legend>{pack.name}</legend>
              {pack.groups.map((group) => {
                const key = `${pack.id}/${group.name}`;
                return (
                  <label className="catalog-group" key={key} data-group={group.name}>
                    <input
                      type="checkbox"
                      checked={choices[key] ?? group.default}
                      onChange={(event) => setChoices({ ...choices, [key]: event.target.checked })}
                    />
                    <span>
                      <strong>{group.name}</strong>{" "}
                      <span className="muted">
                        {group.plugins.map((id) => names.get(id) ?? id).join(", ")}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ))}
          <div className="workbench-actions">
            <button
              type="button"
              data-action="catalog-install-selected"
              disabled={busy || selected.length === 0}
              onClick={() => install(selected)}
            >
              {t("plugins.catalog.installSelected")}
            </button>
          </div>
        </>
      )}
      {view && view.plugins.length > 0 && (
        <>
          <h4>{t("plugins.catalog.plugins")}</h4>
          <ul className="plugin-list">
            {view.plugins.map((plugin) => (
              <CatalogItem
                key={plugin.id}
                plugin={plugin}
                busy={busy}
                install={(id) => install(plugin.update ? [id] : installOrder(view, [id]))}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
