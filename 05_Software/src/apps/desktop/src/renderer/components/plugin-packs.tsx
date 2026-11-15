// REQ-UX-5d984350 REQ-FUNC-0817ec80 REQ-UX-21440e02
import {
  type CatalogPack,
  type CatalogPlugin,
  type PluginCatalogView,
  type PluginPlatform,
  pluginText,
} from "@vera/shared";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { installOrder } from "./plugin-catalog.js";
import { CatalogDependencies } from "./plugin-dependencies.js";
import { MaturityBadge } from "./plugin-library-controls.js";

/** A pack plugin left out of the install: another platform, not in the catalog, or it requires such a plugin. */
export interface PackSkipped {
  id: string;
  name: string;
  reason: "platform" | "catalog" | "requires";
  /** The supported platforms, or the plugin it requires. */
  detail?: string;
}
export interface PackPlan {
  /** In install order: the checked groups' plugins after the catalog plugins they require. */
  install: { entry: CatalogPlugin; requiredBy?: string | undefined }[];
  installed: CatalogPlugin[];
  skipped: PackSkipped[];
}

/** What installing the checked groups of a pack does on this platform (unknown platform: no platform skip). */
export function packPlan(
  view: PluginCatalogView,
  pack: CatalogPack,
  groups: ReadonlySet<string>,
  platform: PluginPlatform | undefined,
): PackPlan {
  const byId = new Map(view.plugins.map((plugin) => [plugin.id, plugin]));
  const selected = [
    ...new Set(pack.groups.filter((group) => groups.has(group.name)).flatMap((group) => group.plugins)),
  ];
  const skipped: PackSkipped[] = selected
    .filter((id) => !byId.has(id))
    .map((id) => ({ id, name: id, reason: "catalog" }));
  const left = new Set(skipped.map((item) => item.id));
  const install: PackPlan["install"] = [];
  for (const id of installOrder(view, selected)) {
    const entry = byId.get(id) as CatalogPlugin;
    // Required plugins come first in the order, so a skipped one is known before its dependents.
    const blocked = entry.requires.find((required) => left.has(required));
    if (platform !== undefined && !entry.platforms.includes(platform))
      skipped.push({ id, name: entry.name, reason: "platform", detail: entry.platforms.join(", ") });
    else if (blocked) skipped.push({ id, name: entry.name, reason: "requires", detail: blocked });
    else {
      install.push({ entry });
      continue;
    }
    left.add(id);
  }
  // A required plugin is listed before the plugin that needs it, so its requirer is named afterwards.
  for (const item of install)
    if (!selected.includes(item.entry.id))
      item.requiredBy = install.find((other) => other.entry.requires.includes(item.entry.id))?.entry.id;
  return {
    install,
    installed: selected.flatMap((id) => {
      const entry = byId.get(id);
      return entry?.installed ? [entry] : [];
    }),
    skipped,
  };
}

/** Install a pack: the catalog's packs and the chosen pack's groups, the default groups checked. */
export function PackChooser({
  packs,
  review,
  cancel,
}: {
  packs: readonly CatalogPack[];
  review: (pack: CatalogPack, groups: ReadonlySet<string>) => void;
  cancel: () => void;
}) {
  const { t } = useTranslation();
  const field = useId();
  const defaults = (pack: CatalogPack | undefined) =>
    new Set(pack?.groups.filter((group) => group.default).map((group) => group.name));
  const [id, setId] = useState(packs[0]?.id ?? "");
  const pack = packs.find((item) => item.id === id);
  const [groups, setGroups] = useState(() => defaults(pack));
  return (
    <section className="plugin-review" data-pack-chooser aria-label={t("plugins.packs.title")}>
      <h3>{t("plugins.packs.title")}</h3>
      <p className="muted">{t("plugins.packs.intro")}</p>
      <label htmlFor={field}>{t("plugins.packs.pack")}</label>
      <select
        id={field}
        data-pack-select
        value={id}
        onChange={(event) => {
          setId(event.target.value);
          setGroups(defaults(packs.find((item) => item.id === event.target.value)));
        }}
      >
        {packs.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name}
          </option>
        ))}
      </select>
      <fieldset>
        <legend>{t("plugins.packs.groups")}</legend>
        {pack?.groups.map((group) => (
          <label key={group.name} className="plugin-pack-group" data-pack-group={group.name}>
            <input
              type="checkbox"
              checked={groups.has(group.name)}
              onChange={(event) => {
                const next = new Set(groups);
                if (event.target.checked) next.add(group.name);
                else next.delete(group.name);
                setGroups(next);
              }}
            />
            {group.name} <span className="muted">({group.plugins.join(", ")})</span>
          </label>
        ))}
      </fieldset>
      <div className="workbench-actions">
        <button
          type="button"
          data-action="pack-review"
          disabled={!pack || !groups.size}
          onClick={() => pack && review(pack, groups)}
        >
          {t("plugins.packs.review")}
        </button>
        <button type="button" data-action="pack-cancel" onClick={cancel}>
          {t("plugins.cancel")}
        </button>
      </div>
    </section>
  );
}

/** The one review of a pack: every plugin to install with its dependencies and risk, and what is left out. */
export function PackReview({
  pack,
  plan,
  platform,
  installed,
  install,
  cancel,
}: {
  pack: CatalogPack;
  plan: PackPlan;
  platform?: PluginPlatform | undefined;
  installed: ReadonlySet<string>;
  install: () => void;
  cancel: () => void;
}) {
  const { t, i18n } = useTranslation();
  const title = useId();
  const names = new Map(plan.install.map((item) => [item.entry.id, item.entry.name]));
  const reason = (item: PackSkipped) =>
    item.reason === "platform"
      ? t("plugins.catalog.platformWarning", { platforms: item.detail })
      : item.reason === "requires"
        ? t("plugins.packs.skippedRequires", { id: item.detail })
        : t("plugins.packs.skippedCatalog");
  return (
    <section className="plugin-review" aria-labelledby={title} data-pack-review>
      <h3 id={title}>{t("plugins.packs.reviewTitle", { name: pack.name })}</h3>
      <p className="muted">{t("plugins.packs.reviewIntro")}</p>
      {plan.install.length ? (
        <ul className="plugin-list">
          {plan.install.map(({ entry, requiredBy }) => (
            <li key={entry.id} className="plugin-card" data-pack-plugin={entry.id}>
              <p className="plugin-heading">
                <strong>{entry.name}</strong>
                <span>{entry.version}</span>
                <MaturityBadge version={entry.version} />
                <span className="risk-badge" data-tier={entry.tier}>
                  {entry.tier === "official" ? t("plugins.tier.official") : t("plugins.tier.community")}
                </span>
              </p>
              <p className="muted">
                <code>{entry.id}</code>
                {requiredBy && (
                  <span>
                    {" "}
                    · {t("plugins.packs.requiredBy", { name: names.get(requiredBy) ?? requiredBy })}
                  </span>
                )}
              </p>
              <p>{pluginText(entry, i18n.language).summary}</p>
              {(entry.risk === "device-write" || entry.risk === "irreversible") && (
                <p role="note" data-catalog-warning="risk" data-risk={entry.risk}>
                  {entry.risk === "irreversible"
                    ? t("plugins.catalog.riskWarning.irreversible")
                    : t("plugins.catalog.riskWarning.device-write")}
                </p>
              )}
              <CatalogDependencies entry={entry} platform={platform} installed={installed} />
            </li>
          ))}
        </ul>
      ) : (
        <p>{t("plugins.packs.nothing")}</p>
      )}
      {plan.skipped.length > 0 && (
        <div role="alert">
          <strong>{t("plugins.packs.skipped")}</strong>
          <ul>
            {plan.skipped.map((item) => (
              <li key={item.id} data-pack-skipped={item.id} data-reason={item.reason}>
                <code>{item.id}</code> {item.name !== item.id && item.name} · {reason(item)}
              </li>
            ))}
          </ul>
        </div>
      )}
      {plan.installed.length > 0 && (
        <p className="muted" data-pack-installed>
          {t("plugins.packs.alreadyInstalled", {
            names: plan.installed.map((entry) => entry.name).join(", "),
          })}
        </p>
      )}
      <div className="workbench-actions">
        <button type="button" data-action="pack-install" disabled={!plan.install.length} onClick={install}>
          {t("plugins.packs.install", { count: plan.install.length })}
        </button>
        <button type="button" data-action="pack-review-cancel" onClick={cancel}>
          {t("plugins.cancel")}
        </button>
      </div>
    </section>
  );
}
