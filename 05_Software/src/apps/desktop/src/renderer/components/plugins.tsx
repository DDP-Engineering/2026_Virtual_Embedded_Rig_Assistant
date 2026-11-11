import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import {
  CatalogItem,
  CatalogSettings,
  catalogKey,
  installOrder,
  PluginDiscoveryFacts,
} from "./plugin-catalog.js";
import {
  catalogLibraryItems,
  initialLibraryState,
  installedLibraryItems,
  type LibraryState,
  libraryStateKey,
  matchesLibraryFilters,
  matchesLibraryStatus,
  pluginProgramsKey,
  programReadiness,
  sortLibraryItems,
} from "./plugin-library.js";
import {
  PluginLibraryControls,
  PluginLibraryPagination,
  pluginActivityLabels,
} from "./plugin-library-controls.js";
import { ExternalSourceLink } from "./session/external-source-link.js";
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
export function Programs({
  statuses,
  archive,
  busy,
}: {
  statuses: readonly PluginProgramStatus[];
  archive?: (name: string) => void;
  busy?: boolean;
}) {
  const { t } = useTranslation();
  const labels = useLabels();
  if (!statuses.length) return <p className="muted">{t("plugins.noPrograms")}</p>;
  return (
    <>
      <ul className="plugin-programs" aria-label={t("plugins.programs")}>
        {statuses.map((status) => (
          <li key={status.name} data-program={status.name} data-state={status.state}>
            <div className="plugin-program-heading">
              <code>{status.name}</code>
              <strong>{labels.state[status.state]}</strong>
              {status.version && <span>{status.version}</span>}
              {status.range && <span className="muted">{t("plugins.range", { range: status.range })}</span>}
            </div>
            {status.problem && <p className="plugin-problem">{labels.problem[status.problem]}</p>}
            {(status.kind === "find" || status.external) && (
              <p className="muted">{t("plugins.externalManaged")}</p>
            )}
            {status.hint && <p>{status.link ? status.hint.replace(status.link, "").trim() : status.hint}</p>}
            {status.link && (
              <ExternalSourceLink href={status.link}>{t("plugins.vendorGuide")}</ExternalSourceLink>
            )}
            {status.detail && (
              <details className="plugin-technical">
                <summary>{t("plugins.technicalDetails")}</summary>
                <pre>{status.detail}</pre>
              </details>
            )}
            {archive && status.kind === "download" && status.problem !== "platform" && (
              <button
                type="button"
                data-action="plugin-install-archive"
                disabled={busy}
                onClick={() => archive(status.name)}
              >
                {t("plugins.installArchive")}
              </button>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
function PluginCard({
  plugin,
  workbench,
  changed,
  update,
  reviewScoped,
  checking = false,
  discovery,
}: {
  plugin: PluginSummary;
  discovery?: CatalogPlugin | undefined;
  reviewScoped: () => void;
  workbench: PluginsWorkbench | undefined;
  changed: () => Promise<void>;
  checking?: boolean;
  update?: { entry: CatalogPlugin; start: () => void; busy: boolean } | undefined;
}) {
  const { t } = useTranslation();
  const labels = useLabels(),
    client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState<"check" | "provision" | "archive" | "uninstall" | "promote" | "export">();
  const [exported, setExported] = useState<string>();
  const [error, setError] = useState<unknown>();
  const [checkedAt, setCheckedAt] = useState<string>();
  const detailsId = useId();
  const operation = useRef(0),
    alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      operation.current++;
    };
  }, []);
  const healthy = plugin.issues.length === 0;
  const queryKey = pluginProgramsKey(workbench?.id, plugin);
  const request = { id: plugin.id, ...(workbench ? { workbenchId: workbench.id } : {}) };
  const programs = useQuery({
    queryKey,
    queryFn: () => api.invoke("plugins.programs", request),
    // Disabled observers consume only explicit user check/install observations.
    enabled: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const readiness = programReadiness(plugin, programs.data, programs.isError);
  const name = plugin.name ?? plugin.id,
    working = busy !== undefined || checking;
  const ready = programs.data?.filter((status) => status.state === "ready").length ?? 0;
  const allReady = !programs.isError && programs.data !== undefined && ready === programs.data.length;
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
  const summary =
    checking || busy === "check"
      ? t("plugins.checking")
      : busy === "provision" || busy === "archive"
        ? t("plugins.installingPrograms")
        : programs.isFetching
          ? t("plugins.checking")
          : programs.data
            ? programs.data.length
              ? t("plugins.dependencySummary", { ready, total: programs.data.length })
              : t("plugins.noPrograms")
            : t("plugins.notChecked");
  async function perform(kind: NonNullable<typeof busy>, action: () => Promise<void>) {
    const generation = ++operation.current;
    setBusy(kind);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      if (alive.current && operation.current === generation) setError(failure);
    } finally {
      if (alive.current && operation.current === generation) setBusy(undefined);
    }
  }
  async function dependencyAction(kind: "check" | "provision" | "archive", program?: string) {
    await perform(kind, async () => {
      await client.cancelQueries({ queryKey, exact: true });
      if (kind === "archive") {
        const statuses = await api.invoke("plugins.installArchive", {
          ...request,
          program: program as string,
          sha256: plugin.sha256 ?? "",
        });
        if (!statuses) return;
        client.setQueryData(queryKey, statuses);
      } else {
        await client.fetchQuery({
          queryKey,
          staleTime: 0,
          retry: false,
          queryFn: () =>
            kind === "check"
              ? api.invoke("plugins.check", request)
              : api.invoke("plugins.provision", request),
        });
      }
      if (alive.current) setCheckedAt(new Date().toLocaleTimeString());
    });
  }
  return (
    <li className="plugin-card" data-plugin={plugin.id}>
      <div className="plugin-card-header">
        <button
          type="button"
          className="plugin-expand"
          data-action="plugin-expand"
          aria-expanded={expanded}
          aria-controls={detailsId}
          aria-label={expanded ? t("plugins.collapse", { name }) : t("plugins.expand", { name })}
          onClick={() => setExpanded((value) => !value)}
        >
          <span aria-hidden="true">{expanded ? "\u2212" : "+"}</span>
          <strong>{name}</strong>
          {plugin.version && <span>{plugin.version}</span>}
        </button>
        {plugin.tier && (
          <span className="risk-badge" data-tier={plugin.tier}>
            {labels.tier[plugin.tier]}
          </span>
        )}
        {healthy && (
          <span
            className="plugin-dependency-summary"
            role="status"
            data-dependency-summary
            data-ready={allReady}
            data-readiness={readiness}
          >
            {readiness === "unavailable" && `${t("plugins.library.readinessUnavailable")} · `}
            {readiness === "needs" && `${t("plugins.library.needsConfiguration")} · `}
            {summary}
          </span>
        )}
      </div>
      {plugin.description && <p className="plugin-row-description">{plugin.description}</p>}
      {!healthy && (
        <div role="alert" data-plugin-issues>
          <p>{t("plugins.broken")}</p>
          <Issues issues={plugin.issues} />
        </div>
      )}
      {update && (
        <p role="status" data-plugin-update>
          {t("plugins.catalog.updateAvailable", { version: update.entry.version })}
        </p>
      )}
      {healthy && programs.data?.some((status) => status.state !== "ready") && !expanded && (
        <p className="plugin-problem">{t("plugins.dependenciesNeedAttention")}</p>
      )}
      {programs.isError && <ErrorMessage error={programs.error} />}
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="plugin-actions">
        {healthy && (
          <>
            <button
              type="button"
              data-action="plugin-check"
              disabled={working}
              onClick={() => void dependencyAction("check")}
            >
              {checking || busy === "check" ? t("plugins.checking") : t("plugins.checkDependencies")}
            </button>
            <button
              type="button"
              data-action="plugin-provision"
              disabled={working || !installable}
              title={
                !programs.data
                  ? t("plugins.checkFirst")
                  : !installable && !allReady
                    ? t("plugins.externalManaged")
                    : undefined
              }
              onClick={() => void dependencyAction("provision")}
            >
              {busy === "provision"
                ? t("plugins.installingPrograms")
                : allReady && !installable
                  ? t("plugins.installed")
                  : t("plugins.installDependencies")}
            </button>
          </>
        )}
        {plugin.source === "workbench" && workbench && (
          <button type="button" data-action="plugin-scoped-review" disabled={working} onClick={reviewScoped}>
            {t("plugins.reviewScoped")}
          </button>
        )}
        {update && (
          <button
            type="button"
            data-action="plugin-update"
            disabled={working || update.busy}
            onClick={update.start}
          >
            {t("plugins.catalog.update", { version: update.entry.version })}
          </button>
        )}
        <details className="plugin-more">
          <summary>{t("plugins.moreActions")}</summary>
          <div>
            {healthy && plugin.tier === "trial" && plugin.sha256 && (
              <button
                type="button"
                data-action="plugin-promote"
                disabled={working}
                onClick={() => {
                  if (window.confirm(t("plugins.promoteConfirm", { name })))
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
                disabled={working}
                onClick={() =>
                  void perform("export", async () => {
                    const result = await api.invoke("plugins.export", {
                      id: plugin.id,
                      sha256: plugin.sha256 ?? "",
                    });
                    if (result.path && alive.current) setExported(result.path);
                  })
                }
              >
                {t("plugins.export")}
              </button>
            )}
            {plugin.source !== "workbench" && (
              <button
                type="button"
                data-action="plugin-uninstall"
                disabled={working}
                onClick={() => {
                  if (window.confirm(t("plugins.uninstallConfirm", { name })))
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
        </details>
      </div>
      {expanded && (
        <div id={detailsId} className="plugin-expanded">
          <p className="muted">
            <code>{plugin.id}</code>
            {plugin.ecosystem && <span> · {plugin.ecosystem}</span>}
          </p>
          <PluginDiscoveryFacts entry={discovery} />
          {plugin.source === "workbench" && <p data-plugin-scope>{t("plugins.workbenchSource")}</p>}
          {healthy && programs.data && (
            <Programs
              statuses={programs.data}
              archive={(program) => void dependencyAction("archive", program)}
              busy={working}
            />
          )}
          {checkedAt && <p className="muted">{t("plugins.lastChecked", { time: checkedAt })}</p>}
        </div>
      )}
      {exported && <p role="status">{t("plugins.exported", { path: exported })}</p>}
    </li>
  );
}
/**
 * Global discovery and package management, with explicit dependency setup and reviewed imports.
 * Workbench activation belongs to the separate workbench settings draft.
 */
export function Plugins({ workbench }: { workbench?: PluginsWorkbench | undefined }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [library, setLibrary] = useState<LibraryState>(() => {
    // This UI-only cache entry lives for the application session, including long navigation away.
    client.setQueryDefaults(libraryStateKey, { gcTime: Infinity });
    return client.getQueryData<LibraryState>(libraryStateKey) ?? { ...initialLibraryState };
  });
  useEffect(() => {
    client.setQueryData(libraryStateKey, library);
  }, [client, library]);
  const changeLibrary = (patch: Partial<LibraryState>) =>
    setLibrary((current) => ({ ...current, ...patch, page: patch.page ?? 1 }));
  const [checkResults, setCheckResults] = useState<{
    completed: number;
    failures: { id: string; error: unknown }[];
  }>();
  const [review, setReview] = useState<{
    review: PluginReview;
    catalog?: PluginCatalogReview;
    scoped?: { workbenchId: string; id: string };
  }>();
  /** Required catalog plugins still to review after the one on screen. */
  const [queue, setQueue] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [checkingAll, setCheckingAll] = useState<string>();
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
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
  async function checkAll() {
    setError(undefined);
    const result = { completed: 0, failures: [] as { id: string; error: unknown }[] };
    setCheckResults(result);
    try {
      for (const plugin of list.data ?? []) {
        if (!live.current) break;
        if (plugin.issues.length) continue;
        setCheckingAll(plugin.id);
        const key = pluginProgramsKey(workbench?.id, plugin);
        try {
          await client.cancelQueries({ queryKey: key, exact: true });
          await client.fetchQuery({
            queryKey: key,
            staleTime: 0,
            retry: false,
            queryFn: () =>
              api.invoke("plugins.check", {
                id: plugin.id,
                ...(workbench ? { workbenchId: workbench.id } : {}),
              }),
          });
        } catch (failure) {
          result.failures.push({ id: plugin.id, error: failure });
        }
        result.completed++;
        if (live.current) setCheckResults({ completed: result.completed, failures: [...result.failures] });
      }
    } finally {
      if (live.current) setCheckingAll(undefined);
    }
  }
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
  const observations = useQueries({
    queries: (list.data ?? []).map((plugin) => ({
      queryKey: pluginProgramsKey(workbench?.id, plugin),
      queryFn: () =>
        api.invoke("plugins.programs", {
          id: plugin.id,
          ...(workbench ? { workbenchId: workbench.id } : {}),
        }),
      enabled: false,
      staleTime: Infinity,
    })),
  });
  const observed = new Map((list.data ?? []).map((plugin, index) => [plugin, observations[index]]));
  const installedItems = installedLibraryItems(
    list.data ?? [],
    catalog.data?.plugins ?? [],
    (plugin) => observed.get(plugin)?.data,
    (plugin) => observed.get(plugin)?.isError ?? false,
  );
  const availableItems = catalogLibraryItems(catalog.data?.plugins ?? []);
  const scope = library.tab === "available" ? availableItems : installedItems;
  const basic = scope.filter((item) => matchesLibraryFilters(item, library, pluginActivityLabels(t)));
  const results = sortLibraryItems(
    basic.filter((item) => matchesLibraryStatus(item, library.status)),
    library.sort,
    i18n.language,
  );
  const page = Math.min(library.page, Math.max(1, Math.ceil(results.length / library.pageSize)));
  const hasSnapshot =
    library.tab === "available" ? catalog.data !== undefined : list.data !== undefined && !catalog.isPending;
  useEffect(() => {
    if (hasSnapshot && page !== library.page) setLibrary((current) => ({ ...current, page }));
  }, [hasSnapshot, page, library.page]);
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
            void client.resetQueries({ queryKey: ["plugin-programs"] });
            client.removeQueries({ queryKey: ["plugin-programs"] });
            if (!review.catalog && !review.scoped) changeLibrary({ tab: "installed", status: "all" });
            setReview(undefined);
            void changed();
            if (queue.length) void reviewCatalog(queue);
          }}
        />
      ) : (
        <>
          <p className="muted">{t("plugins.intro")}</p>
          <section className="plugin-toolbar" aria-label={t("plugins.managementActions")}>
            <div className="workbench-actions">
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
              <button
                type="button"
                data-action="plugin-check-all"
                disabled={checkingAll !== undefined || !list.data?.some((plugin) => !plugin.issues.length)}
                onClick={() => void checkAll()}
              >
                {checkingAll ? t("plugins.checkingAll") : t("plugins.checkAll")}
              </button>
              <button
                type="button"
                data-action="plugin-refresh"
                disabled={busy}
                onClick={() => void changed()}
              >
                {t("plugins.refresh")}
              </button>
            </div>
            <CatalogSettings catalog={catalog} />
          </section>
          {error !== undefined && <ErrorMessage error={error} />}
          {checkResults && (
            <div data-check-all-result role="status">
              <p>
                {t("plugins.library.checkedSummary", {
                  count: checkResults.completed,
                  failed: checkResults.failures.length,
                })}
              </p>
              {checkResults.failures.map((failure) => (
                <div key={failure.id}>
                  <strong>{failure.id}</strong>
                  <ErrorMessage error={failure.error} />
                </div>
              ))}
            </div>
          )}
          <p className="muted">{t("plugins.configPointer")}</p>
          <div
            className="plugin-library-tabs"
            data-library-tabs
            role="tablist"
            aria-label={t("plugins.library.tabs")}
            onKeyDown={(event) => {
              const keys = ["ArrowLeft", "ArrowRight", "Home", "End"];
              if (!keys.includes(event.key)) return;
              event.preventDefault();
              const tab =
                event.key === "Home"
                  ? "available"
                  : event.key === "End"
                    ? "installed"
                    : library.tab === "available"
                      ? "installed"
                      : "available";
              changeLibrary({
                tab,
                status: "all",
                tier: tab === "available" && ["local", "trial"].includes(library.tier) ? "" : library.tier,
              });
              event.currentTarget.querySelector<HTMLButtonElement>(`[data-library-tab="${tab}"]`)?.focus();
            }}
          >
            {(["available", "installed"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                id={`plugin-library-${tab}`}
                role="tab"
                data-library-tab={tab}
                aria-selected={library.tab === tab}
                tabIndex={library.tab === tab ? 0 : -1}
                aria-controls="plugin-library-panel"
                onClick={() =>
                  changeLibrary({
                    tab,
                    status: "all",
                    tier:
                      tab === "available" && ["local", "trial"].includes(library.tier) ? "" : library.tier,
                  })
                }
              >
                {tab === "available" ? t("plugins.library.available") : t("plugins.library.installed")}{" "}
                <span>{tab === "available" ? availableItems.length : installedItems.length}</span>
              </button>
            ))}
          </div>
          <PluginLibraryControls
            state={library}
            change={changeLibrary}
            items={[...availableItems, ...installedItems]}
            basic={basic}
            total={scope.length}
            count={results.length}
          />
          {list.isPending && library.tab === "installed" && <p role="status">{t("home.loading")}</p>}
          {list.isError && <ErrorMessage error={list.error} />}
          {results.length === 0 && (
            <div className="plugin-library-empty">
              <p>
                {library.tab === "installed" && !installedItems.length
                  ? t("plugins.none")
                  : t("plugins.library.noMatches")}
              </p>
              <button
                type="button"
                data-action="library-clear"
                onClick={() =>
                  changeLibrary({ search: "", ecosystem: "", activity: "", tier: "", status: "all" })
                }
              >
                {t("plugins.library.clear")}
              </button>
              {library.tab === "installed" && !installedItems.length && (
                <button type="button" onClick={() => changeLibrary({ tab: "available", status: "all" })}>
                  {t("plugins.library.browse")}
                </button>
              )}
            </div>
          )}
          <div role="tabpanel" id="plugin-library-panel" aria-labelledby={`plugin-library-${library.tab}`}>
            <ul className="plugin-list">
              {results.slice((page - 1) * library.pageSize, page * library.pageSize).map((item) => {
                const view = catalog.data;
                if (item.catalog && view && library.tab === "available")
                  return (
                    <CatalogItem
                      key={item.key}
                      plugin={item.catalog}
                      busy={busy}
                      install={(id) =>
                        void reviewCatalog(item.catalog?.update ? [id] : installOrder(view, [id]))
                      }
                    />
                  );
                const plugin = item.plugin;
                if (!plugin) return null;
                const entry = item.update ? updates.get(plugin.id) : undefined;
                return (
                  <PluginCard
                    key={item.key}
                    discovery={item.catalog}
                    checking={checkingAll === plugin.id}
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
          </div>
          <PluginLibraryPagination
            page={page}
            pageSize={library.pageSize}
            count={results.length}
            change={changeLibrary}
          />
        </>
      )}
    </section>
  );
}
