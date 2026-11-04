import { useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CatalogPlugin,
  PluginCatalogReview,
  PluginIssue,
  PluginProgram,
  PluginProgramStatus,
  PluginReview,
  PluginRisk,
  PluginSummary,
} from "@vera/shared";
import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import { CatalogSection, catalogKey } from "./plugin-catalog.js";

/** The open workbench, when there is one: plugins are enabled per workbench. */
export interface PluginsWorkbench {
  id: string;
  name: string;
  readOnly: boolean;
}

function useLabels() {
  const { t } = useTranslation();
  const risk: Record<PluginRisk, string> = {
    safe: t("approval.risk.safe"),
    "device-read": t("approval.risk.deviceRead"),
    "device-write": t("approval.risk.deviceWrite"),
    irreversible: t("approval.risk.irreversible"),
    blocked: t("approval.risk.blocked"),
  };
  const issue = (item: PluginIssue): string => {
    switch (item.code) {
      case "manifest":
        return t("plugins.issue.manifest");
      case "yaml":
        return item.line === undefined
          ? t("plugins.issue.yaml")
          : t("plugins.issue.yamlLine", { line: item.line });
      case "field":
        return t("plugins.issue.field", { issue: item.issue ?? "" });
      case "id":
        return t("plugins.issue.id");
      case "record":
        return t("plugins.issue.record");
      case "untrusted":
        return t("plugins.issue.untrusted");
      case "collision":
        return t("plugins.issue.collision");
      case "changed":
        return t("plugins.issue.changed");
      default:
        return t("plugins.issue.unavailable");
    }
  };
  const tier = {
    official: t("plugins.tier.official"),
    community: t("plugins.tier.community"),
    local: t("plugins.tier.local"),
    trial: t("plugins.tier.trial"),
  };
  const state = {
    ready: t("plugins.state.ready"),
    missing: t("plugins.state.missing"),
    unavailable: t("plugins.state.unavailable"),
  };
  const problem: Record<NonNullable<PluginProgramStatus["problem"]>, string> = {
    notFound: t("plugins.problem.notFound"),
    install: t("plugins.problem.install"),
    download: t("plugins.problem.download"),
    sha256: t("plugins.problem.sha256"),
    archive: t("plugins.problem.archive"),
    platform: t("plugins.problem.platform"),
    uv: t("plugins.problem.uv"),
    version: t("plugins.problem.version"),
    range: t("plugins.problem.range"),
  };
  return { risk, issue, tier, state, problem };
}

export function Issues({ issues }: { issues: readonly PluginIssue[] }) {
  const labels = useLabels();
  return (
    <ul className="plugin-issues">
      {issues.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: issues have no identity and never reorder.
        <li key={index} data-issue={item.code}>
          {labels.issue(item)}
          {item.path && (
            <>
              {" "}
              <code>{item.path}</code>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

/** Where a program comes from, as the review screen lists it. */
function InstallSource({ program }: { program: PluginProgram }) {
  const { t } = useTranslation();
  const { install } = program;
  if ("pip" in install) return <span>{t("plugins.source.pip", { requirement: install.pip })}</span>;
  if ("script" in install) return <span>{t("plugins.source.script", { path: install.script })}</span>;
  return (
    <>
      {"find" in install && (
        <>
          <span>{t("plugins.source.find")}</span>{" "}
          <code>{[...(install.find.windows ?? []), ...(install.find.linux ?? [])].join(", ")}</code>
          {install.hint && <span className="muted"> {install.hint}</span>}
        </>
      )}
      {"download" in install && install.download && (
        <ul>
          {Object.entries(install.download).map(([platform, entry]) => (
            <li key={platform}>
              {t("plugins.source.download", { platform })} <code>{entry?.url}</code>{" "}
              <span className="plugin-sha">SHA-256 {entry?.sha256}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function Review({
  review,
  catalog,
  scoped,
  installed,
  cancel,
}: {
  review: PluginReview;
  /** A catalog package: installed through the catalog with its tier. */
  catalog?: PluginCatalogReview | undefined;
  scoped?: { workbenchId: string; id: string } | undefined;
  installed: () => void;
  cancel: () => void;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const title = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const { manifest } = review;
  async function install() {
    setBusy(true);
    setError(undefined);
    try {
      if (scoped) await api.invoke("plugins.scopedTrust", { ...scoped, sha256: review.sha256 });
      else if (catalog) await api.invoke("plugins.catalogInstall", { id: catalog.id, sha256: review.sha256 });
      else await api.invoke("plugins.install", { path: review.path, sha256: review.sha256 });
      installed();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="plugin-review" aria-labelledby={title} data-plugin-review>
      <h3 id={title}>{t("plugins.reviewTitle", { name: manifest?.name ?? review.path })}</h3>
      <p className="muted">{t("plugins.reviewIntro")}</p>
      {scoped && <p>{t("plugins.scopedTrustIntro")}</p>}
      <p className="plugin-sha">
        SHA-256 <code>{review.sha256}</code>
      </p>
      {catalog && (
        <p data-catalog-review>
          {t("plugins.catalog.reviewFrom", {
            tier: catalog.tier === "official" ? labels.tier.official : labels.tier.community,
            version: catalog.version,
          })}
          {review.installed && <> {t("plugins.catalog.reviewChanges")}</>}
        </p>
      )}
      {review.installed && (
        <p role="status">{t("plugins.replaces", { version: review.installed.version ?? "?" })}</p>
      )}
      {review.issues.length > 0 && (
        <div role="alert">
          <p>{t("plugins.reviewIssues")}</p>
          <Issues issues={review.issues} />
        </div>
      )}
      <dl className="plugin-facts">
        {manifest && (
          <>
            <dt>{t("plugins.id")}</dt>
            <dd>
              <code>{manifest.id}</code>
            </dd>
            <dt>{t("plugins.version")}</dt>
            <dd>{manifest.version}</dd>
            <dt>{t("plugins.platforms")}</dt>
            <dd>{manifest.platforms.join(", ")}</dd>
            <dt>{t("plugins.requires")}</dt>
            <dd>{manifest.requires.length ? manifest.requires.join(", ") : t("plugins.nothing")}</dd>
          </>
        )}
        <dt>{t("plugins.source.label")}</dt>
        <dd>
          <code>{review.path}</code>
        </dd>
      </dl>
      {manifest && (
        <>
          <p>{manifest.description}</p>
          <h4>{t("plugins.programs")}</h4>
          {Object.keys(manifest.programs).length === 0 && <p>{t("plugins.noPrograms")}</p>}
          <ul className="plugin-review-list">
            {Object.entries(manifest.programs).map(([name, program]) => (
              <li key={name} data-program={name}>
                <code>{name}</code> <InstallSource program={program} />
                {program.version.range && (
                  <span className="muted"> {t("plugins.range", { range: program.version.range })}</span>
                )}
              </li>
            ))}
          </ul>
          <h4>{t("plugins.rules")}</h4>
          {manifest.rules.length === 0 && <p>{t("plugins.noRules")}</p>}
          <ul className="plugin-review-list">
            {manifest.rules.map((rule, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: rules keep manifest order and may repeat.
              <li key={index} data-rule={rule.risk}>
                <code>{rule.match}</code>{" "}
                <span className="risk-badge" data-risk={rule.risk}>
                  {labels.risk[rule.risk]}
                </span>
                {rule.note && <span> {rule.note}</span>}
                {rule.timeout !== undefined && (
                  <span className="muted"> {t("plugins.timeout", { seconds: rule.timeout })}</span>
                )}
              </li>
            ))}
          </ul>
          {manifest.docs.length > 0 && (
            <>
              <h4>{t("plugins.docs")}</h4>
              <ul className="plugin-review-list">
                {manifest.docs.map((doc) => (
                  <li key={doc}>
                    <code>{doc}</code>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="workbench-actions">
        <button
          type="button"
          data-action="plugin-install"
          disabled={busy || review.issues.length > 0 || !manifest}
          onClick={() => void install()}
        >
          {scoped ? t("plugins.trust") : t("plugins.install")}
        </button>
        <button type="button" data-action="plugin-review-cancel" disabled={busy} onClick={cancel}>
          {t("plugins.cancel")}
        </button>
      </div>
    </section>
  );
}

function Programs({ statuses }: { statuses: readonly PluginProgramStatus[] }) {
  const { t } = useTranslation();
  const labels = useLabels();
  if (statuses.length === 0) return <p className="muted">{t("plugins.noPrograms")}</p>;
  return (
    <ul className="plugin-programs" aria-label={t("plugins.programs")}>
      {statuses.map((status) => (
        <li key={status.name} data-program={status.name} data-state={status.state}>
          <code>{status.name}</code> <strong>{labels.state[status.state]}</strong>
          {status.version && <span> {status.version}</span>}
          {status.range && <span className="muted"> {t("plugins.range", { range: status.range })}</span>}
          {status.problem && <span> {labels.problem[status.problem]}</span>}
          {status.detail && <span className="muted"> {status.detail}</span>}
          {status.hint && <span> {status.hint}</span>}
          {status.link && (
            <>
              {" "}
              <code>{status.link}</code>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function PluginCard({
  plugin,
  workbench,
  changed,
  update,
  reviewScoped,
}: {
  plugin: PluginSummary;
  reviewScoped: () => void;
  workbench: PluginsWorkbench | undefined;
  changed: () => Promise<void>;
  /** The catalog entry when it offers a higher version, and the action that reviews it. */
  update?: { entry: CatalogPlugin; start: () => void; busy: boolean } | undefined;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  const client = useQueryClient();
  const [busy, setBusy] = useState<"provision" | "uninstall" | "promote" | "export">();
  const [exported, setExported] = useState<string>();
  const [error, setError] = useState<unknown>();
  const healthy = plugin.issues.length === 0;
  const programs = useQuery({
    queryKey: ["plugin-programs", workbench?.id ?? null, plugin.id, plugin.sha256],
    queryFn: () =>
      api.invoke("plugins.programs", { id: plugin.id, ...(workbench ? { workbenchId: workbench.id } : {}) }),
    enabled: healthy,
    staleTime: 0,
  });
  const name = plugin.name ?? plugin.id;
  async function perform(kind: NonNullable<typeof busy>, action: () => Promise<unknown>) {
    setBusy(kind);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(undefined);
    }
  }
  return (
    <li className="plugin-card" data-plugin={plugin.id}>
      <p className="plugin-heading">
        <strong>{name}</strong>
        {plugin.version && <span> {plugin.version}</span>}
        {plugin.tier && (
          <span className="risk-badge" data-tier={plugin.tier}>
            {labels.tier[plugin.tier]}
          </span>
        )}
      </p>
      <p className="muted">
        <code>{plugin.id}</code>
        {plugin.ecosystem && <span> · {plugin.ecosystem}</span>}
      </p>
      {plugin.description && <p>{plugin.description}</p>}
      {plugin.source === "workbench" && <p data-plugin-scope>{t("plugins.workbenchSource")}</p>}
      {update && (
        <p role="status" data-plugin-update>
          {t("plugins.catalog.updateAvailable", { version: update.entry.version })}
        </p>
      )}
      {!healthy && (
        <div role="alert" data-plugin-issues>
          <p>{t("plugins.broken")}</p>
          <Issues issues={plugin.issues} />
        </div>
      )}
      {healthy && programs.isPending && <p role="status">{t("home.loading")}</p>}
      {healthy && programs.isError && <ErrorMessage error={programs.error} />}
      {healthy && programs.data && <Programs statuses={programs.data} />}
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="workbench-actions">
        {plugin.source === "workbench" && workbench && (
          <button
            type="button"
            data-action="plugin-scoped-review"
            disabled={busy !== undefined}
            onClick={reviewScoped}
          >
            {t("plugins.reviewScoped")}
          </button>
        )}
        {healthy && plugin.tier === "trial" && plugin.sha256 && (
          <button
            type="button"
            data-action="plugin-promote"
            disabled={busy !== undefined}
            onClick={() => {
              if (!window.confirm(t("plugins.promoteConfirm", { name }))) return;
              void perform("promote", async () => {
                await api.invoke("plugins.promote", { id: plugin.id, sha256: plugin.sha256 ?? "" });
                await changed();
              });
            }}
          >
            {t("plugins.promote")}
          </button>
        )}
        {healthy && plugin.sha256 && plugin.source !== "workbench" && (
          <button
            type="button"
            data-action="plugin-export"
            disabled={busy !== undefined}
            onClick={() =>
              void perform("export", async () => {
                const result = await api.invoke("plugins.export", {
                  id: plugin.id,
                  sha256: plugin.sha256 ?? "",
                });
                if (result.path) setExported(result.path);
              })
            }
          >
            {t("plugins.export")}
          </button>
        )}
        {update && (
          <button
            type="button"
            data-action="plugin-update"
            disabled={busy !== undefined || update.busy}
            onClick={update.start}
          >
            {t("plugins.catalog.update", { version: update.entry.version })}
          </button>
        )}
        {healthy && programs.data?.some((status) => status.state !== "ready" || status.downloadAvailable) && (
          <button
            type="button"
            data-action="plugin-provision"
            disabled={busy !== undefined}
            onClick={() =>
              void perform("provision", async () => {
                const statuses = await api.invoke("plugins.provision", {
                  id: plugin.id,
                  ...(workbench ? { workbenchId: workbench.id } : {}),
                });
                client.setQueryData(
                  ["plugin-programs", workbench?.id ?? null, plugin.id, plugin.sha256],
                  statuses,
                );
              })
            }
          >
            {busy === "provision" ? t("plugins.installingPrograms") : t("plugins.installPrograms")}
          </button>
        )}
        {plugin.source !== "workbench" && (
          <button
            type="button"
            data-action="plugin-uninstall"
            disabled={busy !== undefined}
            onClick={() => {
              if (!window.confirm(t("plugins.uninstallConfirm", { name }))) return;
              void perform("uninstall", async () => {
                await api.invoke("plugins.uninstall", { id: plugin.id });
                await changed();
              });
            }}
          >
            {t("plugins.uninstall")}
          </button>
        )}
      </div>
      {exported && <p role="status">{t("plugins.exported", { path: exported })}</p>}
    </li>
  );
}

/**
 * The plugin manager: installed plugins with their programs and issues, install from a folder or zip
 * through the review screen, program installs, uninstall and the switch for the open workbench.
 */
export function Plugins({ workbench }: { workbench?: PluginsWorkbench | undefined }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const [review, setReview] = useState<{
    review: PluginReview;
    catalog?: PluginCatalogReview;
    scoped?: { workbenchId: string; id: string };
  }>();
  /** Catalog plugins still to review after the one on screen (Install selected). */
  const [queue, setQueue] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const list = useQuery({
    queryKey: ["plugins", workbench?.id ?? null],
    queryFn: () => api.invoke("plugins.list", workbench ? { workbenchId: workbench.id } : {}),
    // Listing re-checks every plugin's files, so the page shows what is on disk whenever it opens.
    staleTime: 0,
  });
  // The last catalog read (an update check, or the first opening); Check for updates reads it again.
  const catalog = useQuery({
    queryKey: catalogKey,
    queryFn: () => api.invoke("plugins.catalog", { refresh: false }),
    staleTime: 0,
  });
  useEffect(
    () =>
      api.subscribe("app", (event) => {
        if (event.type === "plugins.catalog") void client.invalidateQueries({ queryKey: catalogKey });
      }),
    [client],
  );
  const changed = () => client.invalidateQueries({ queryKey: ["plugins"] });
  /**
   * Reviews catalog plugins one after another: a review that is required stops on the review screen
   * (Install continues the queue, Cancel drops it); an update that changes no program or rule installs
   * at once. The first failure stops the queue and shows its error.
   */
  async function reviewCatalog(ids: readonly string[]) {
    setError(undefined);
    setBusy(true);
    let rest = [...ids];
    try {
      while (rest.length) {
        const [id = "", ...after] = rest;
        const reviewed = await api.invoke("plugins.catalogReview", { id });
        if (reviewed.required) {
          setQueue(after);
          setReview({ review: reviewed.review, catalog: reviewed });
          return;
        }
        await api.invoke("plugins.catalogInstall", { id, sha256: reviewed.review.sha256 });
        void changed();
        rest = after;
      }
      setQueue([]);
    } catch (failure) {
      setError(failure);
      setQueue([]);
    } finally {
      setBusy(false);
    }
  }
  const updates = new Map(
    (catalog.data?.plugins ?? []).filter((entry) => entry.update).map((entry) => [entry.id, entry]),
  );
  async function choose(kind: "folder" | "zip") {
    setBusy(true);
    setError(undefined);
    try {
      const { path } = await api.invoke("plugins.choose", { kind });
      if (path) setReview({ review: await api.invoke("plugins.review", { path }) });
    } catch (failure) {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="surface plugins-page" data-plugins>
      {review ? (
        <Review
          review={review.review}
          catalog={review.catalog}
          scoped={review.scoped}
          cancel={() => {
            setReview(undefined);
            setQueue([]);
          }}
          installed={() => {
            setReview(undefined);
            void changed();
            if (queue.length) void reviewCatalog(queue);
          }}
        />
      ) : (
        <>
          <p className="muted">{t("plugins.intro")}</p>
          <div className="workbench-actions">
            <button type="button" data-action="plugin-refresh" disabled={busy} onClick={() => void changed()}>
              {t("plugins.refresh")}
            </button>
            <button
              type="button"
              data-action="plugin-install-folder"
              disabled={busy}
              onClick={() => void choose("folder")}
            >
              {t("plugins.installFolder")}
            </button>
            <button
              type="button"
              data-action="plugin-install-zip"
              disabled={busy}
              onClick={() => void choose("zip")}
            >
              {t("plugins.installZip")}
            </button>
          </div>
          {error !== undefined && <ErrorMessage error={error} />}
          <p className="muted">{t("plugins.configPointer")}</p>
          {list.isPending && <p role="status">{t("home.loading")}</p>}
          {list.isError && <ErrorMessage error={list.error} />}
          {list.data?.length === 0 && <p>{t("plugins.none")}</p>}
          <ul className="plugin-list">
            {list.data?.map((plugin) => {
              const entry = plugin.source === "workbench" ? undefined : updates.get(plugin.id);
              return (
                <PluginCard
                  key={plugin.id}
                  plugin={plugin}
                  workbench={workbench}
                  changed={changed}
                  reviewScoped={() => {
                    if (!workbench) return;
                    setBusy(true);
                    setError(undefined);
                    const scoped = { workbenchId: workbench.id, id: plugin.id };
                    void api
                      .invoke("plugins.scopedReview", scoped)
                      .then((review) => setReview({ review, scoped }))
                      .catch(setError)
                      .finally(() => setBusy(false));
                  }}
                  update={entry && { entry, busy, start: () => void reviewCatalog([plugin.id]) }}
                />
              );
            })}
          </ul>
          <CatalogSection catalog={catalog} busy={busy} install={(ids) => void reviewCatalog(ids)} />
        </>
      )}
    </section>
  );
}
