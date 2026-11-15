import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  CatalogPack,
  CatalogPlugin,
  PluginCatalogReview,
  PluginIssue,
  PluginProgramStatus,
  PluginReview,
  PluginSummary,
} from "@vera/shared";
import { configurationNeeds, pluginPlatform } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";
import {
  CatalogItem,
  CatalogSettings,
  CatalogUpdateCheck,
  catalogKey,
  installOrder,
  PluginDiscoveryFacts,
} from "./plugin-catalog.js";
import { type ConfigurationView, PluginConfiguration } from "./plugin-configuration.js";
import { PluginContents, useRiskLabels } from "./plugin-contents.js";
import { automaticProgram, RequiredPlugins, VendorGuide } from "./plugin-dependencies.js";
import {
  catalogLibraryItems,
  clearedLibraryFilters,
  combinedLibraryItems,
  initialLibraryState,
  installedKey,
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
  MaturityBadge,
  PluginLibraryControls,
  PluginLibraryPagination,
  pluginActivityLabels,
} from "./plugin-library-controls.js";
import { PackChooser, type PackPlan, PackReview, packPlan } from "./plugin-packs.js";
import { configurationCheck, dependencyCheck, PluginStatus } from "./plugin-status.js";

/** One plugin of Install with dependencies: its program statuses once installed, or the failure. */
interface InstallResult {
  id: string;
  name: string;
  busy: boolean;
  statuses?: PluginProgramStatus[];
  error?: unknown;
}
/** The open workbench, when there is one: plugins are enabled per workbench. */
export interface PluginsWorkbench {
  id: string;
  name: string;
  readOnly: boolean;
}
function useLabels() {
  const { t } = useTranslation();
  const risk = useRiskLabels();
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
            <dd>
              {manifest.version} <MaturityBadge version={manifest.version} />
            </dd>
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
          <PluginContents manifest={manifest} composition={review.composition} />
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
          <li
            key={status.name}
            data-program={status.name}
            data-state={status.state}
            data-automatic={automaticProgram(status)}
          >
            <div className="plugin-program-heading">
              <code>{status.name}</code>
              <strong>{labels.state[status.state]}</strong>
              {status.version && <span>{status.version}</span>}
              {status.range && <span className="muted">{t("plugins.range", { range: status.range })}</span>}
            </div>
            {status.path ? (
              <p className="muted" data-program-path>
                {t("plugins.dependencies.foundAt", { path: status.path })}
              </p>
            ) : (
              automaticProgram(status) && <p className="muted">{t("plugins.dependencies.programFolder")}</p>
            )}
            {status.problem && <p className="plugin-problem">{labels.problem[status.problem]}</p>}
            {(status.kind === "find" || status.external) && (
              <p className="muted">{t("plugins.externalManaged")}</p>
            )}
            {status.hint && <VendorGuide guide={status.hint} link={status.link} />}
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
  installedIds,
  configuration,
  openWorkbench,
}: {
  plugin: PluginSummary;
  /** Opens the open workbench's editor, or the folder chooser when none is open. */
  openWorkbench?: (() => void) | undefined;
  /** The declared parameters' states, when the manifest declares any. */
  configuration?: ConfigurationView | undefined;
  /** The ids of the installed plugins, for the plugins this one requires. */
  installedIds: ReadonlySet<string>;
  discovery?: CatalogPlugin | undefined;
  reviewScoped: () => void;
  workbench: PluginsWorkbench | undefined;
  changed: () => Promise<void>;
  checking?: boolean;
  update?: { entry: CatalogPlugin; start: () => void; busy: boolean } | undefined;
}) {
  const { t, i18n } = useTranslation();
  const labels = useLabels(),
    client = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [configure, setConfigure] = useState(false);
  const configurationRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!configure || !expanded) return;
    setConfigure(false);
    configurationRef.current?.focus();
    configurationRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [configure, expanded]);
  const [busy, setBusy] = useState<
    "check" | "provision" | "reinstall" | "archive" | "uninstall" | "promote" | "export"
  >();
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
  const needs = configuration?.needs ?? [];
  const readiness = programReadiness(plugin, programs.data, programs.isError, needs);
  const settings = healthy ? plugin.manifest?.settings : undefined;
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
          (status.state === "unavailable" && ["version", "range", "sha256"].includes(status.problem ?? "")) ||
          status.downloadAvailable),
    );
  // Re-install replaces the copies VERA manages; vendor programs and unsupported ones have none.
  const reinstallable =
    !programs.isError &&
    programs.data?.some(
      (status) => automaticProgram(status) && status.problem !== "platform" && status.problem !== "uv",
    );
  const summary =
    checking || busy === "check"
      ? t("plugins.checking")
      : busy === "provision" || busy === "archive" || busy === "reinstall"
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
  async function dependencyAction(kind: "check" | "provision" | "reinstall" | "archive", program?: string) {
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
              : kind === "reinstall"
                ? api.invoke("plugins.reinstall", request)
                : api.invoke("plugins.provision", request),
        });
      }
      if (alive.current) setCheckedAt(new Date().toLocaleTimeString(i18n.language));
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
          {plugin.version && <MaturityBadge version={plugin.version} />}
        </button>
        {plugin.tier && (
          <span className="risk-badge" data-tier={plugin.tier}>
            {labels.tier[plugin.tier]}
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
      {healthy && (
        <PluginStatus
          readiness={readiness}
          programs={summary}
          dependencies={dependencyCheck(
            programs.data,
            programs.isError,
            (plugin.manifest?.requires ?? []).filter((id) => !installedIds.has(id)),
          )}
          configuration={configurationCheck(settings, configuration)}
          declared={Boolean(settings && Object.keys(settings).length)}
          configure={() => {
            setExpanded(true);
            setConfigure(true);
          }}
          enabled={plugin.enabled}
          workbench={workbench?.name}
          openWorkbench={openWorkbench}
          dependencyActions={
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
              <button
                type="button"
                data-action="plugin-reinstall"
                disabled={working || !reinstallable}
                title={!programs.data ? t("plugins.checkFirst") : t("plugins.reinstallHint")}
                onClick={() => void dependencyAction("reinstall")}
              >
                {busy === "reinstall" ? t("plugins.reinstalling") : t("plugins.reinstall")}
              </button>
            </>
          }
        />
      )}
      {programs.isError && <ErrorMessage error={programs.error} />}
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="plugin-actions">
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
          {healthy && plugin.manifest && (
            <RequiredPlugins ids={plugin.manifest.requires} installed={installedIds} />
          )}
          {healthy && programs.data && (
            <Programs
              statuses={programs.data}
              archive={(program) => void dependencyAction("archive", program)}
              busy={working}
            />
          )}
          {checkedAt && <p className="muted">{t("plugins.lastChecked", { time: checkedAt })}</p>}
          {settings && configuration && Object.keys(settings).length > 0 && (
            <div ref={configurationRef} tabIndex={-1}>
              <PluginConfiguration
                settings={settings}
                view={configuration}
                workbench={workbench !== undefined}
              />
            </div>
          )}
          {healthy && plugin.manifest && (
            <PluginContents manifest={plugin.manifest} composition={plugin.composition} />
          )}
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
export function Plugins({
  workbench,
  openWorkbench,
}: {
  workbench?: PluginsWorkbench | undefined;
  /** The Use check's Open workbench: the open workbench's editor, or the folder chooser when none is open. */
  openWorkbench?: (() => void) | undefined;
}) {
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
  /**
   * The catalog install in progress: the plugins it installed, whether their programs follow, whether one pack review
   * already covered every plugin (no review screen per plugin) and the plugin that failed.
   */
  const run = useRef<{
    programs: boolean;
    installed: string[];
    reviewed: boolean;
    failed?: { id: string; error: unknown };
  }>(undefined);
  /** Install a pack: choosing the pack and its groups, then its one review. */
  const [pack, setPack] = useState<{ review?: { pack: CatalogPack; plan: PackPlan } }>();
  /** Install with dependencies: each installed plugin's program statuses, or why they are unknown. */
  const [installResults, setInstallResults] = useState<InstallResult[]>();
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
  // The host's plugin platform for the catalog cards' platform warning; unknown until app.info loads.
  const info = useQuery({ queryKey: ["app.info"], queryFn: () => api.getAppInfo() });
  const platform = info.data ? pluginPlatform(info.data.platform, info.data.arch) : undefined;
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
   * at once, as does every plugin of a reviewed pack. The first failure stops the queue and shows its error; with
   * Install with dependencies the plugins installed before it still get their programs.
   */
  async function reviewCatalog(ids: readonly string[]) {
    setError(undefined);
    setBusy(true);
    let rest = [...ids];
    try {
      while (rest.length) {
        const [id = "", ...after] = rest;
        const reviewed = await api.invoke("plugins.catalogReview", { id });
        if (reviewed.required && !run.current?.reviewed) {
          setQueue(after);
          setReview({ review: reviewed.review, catalog: reviewed });
          return;
        }
        await api.invoke("plugins.catalogInstall", { id, sha256: reviewed.review.sha256 });
        run.current?.installed.push(id);
        void changed();
        rest = after;
      }
      setQueue([]);
      await installPrograms();
    } catch (failure) {
      setQueue([]);
      const current = run.current;
      if (current?.programs) {
        current.failed = { id: rest[0] ?? "", error: failure };
        await installPrograms();
      } else {
        setError(failure);
        run.current = undefined;
      }
    } finally {
      setBusy(false);
    }
  }
  function startCatalog(ids: readonly string[], programs: boolean, reviewed = false) {
    run.current = { programs, installed: [], reviewed };
    void reviewCatalog(ids);
  }
  const programsRequest = (id: string) => ({ id, ...(workbench ? { workbenchId: workbench.id } : {}) });
  /** After Install with dependencies: installs the programs of each plugin it installed, one at a time. */
  async function installPrograms() {
    const current = run.current;
    run.current = undefined;
    if (!current?.programs || (!current.installed.length && !current.failed)) return;
    // The page stays busy until every program install ends, so two runs never share the result block.
    setBusy(true);
    const names = new Map((catalog.data?.plugins ?? []).map((entry) => [entry.id, entry.name]));
    let rows: InstallResult[] = current.installed.map((id) => ({
      id,
      name: names.get(id) ?? id,
      busy: true,
    }));
    const { failed } = current;
    if (failed)
      rows.push({ id: failed.id, name: names.get(failed.id) ?? failed.id, busy: false, error: failed.error });
    setInstallResults(rows);
    for (const id of current.installed) {
      let row: InstallResult = { id, name: names.get(id) ?? id, busy: false };
      try {
        row = { ...row, statuses: await api.invoke("plugins.provision", programsRequest(id)) };
      } catch (failure) {
        row = { ...row, error: failure };
      }
      rows = rows.map((item) => (item.id === id ? row : item));
      if (live.current) setInstallResults(rows);
    }
    if (live.current) setBusy(false);
    void changed();
  }
  async function checkAgain(id: string) {
    const update = (patch: Partial<InstallResult>) =>
      setInstallResults((current) => current?.map((item) => (item.id === id ? { ...item, ...patch } : item)));
    update({ busy: true, error: undefined });
    try {
      update({ busy: false, statuses: await api.invoke("plugins.check", programsRequest(id)) });
    } catch (failure) {
      update({ busy: false, error: failure });
    }
  }
  // One configuration query for every listed plugin that declares parameters (REQ-FUNC-cbdb46ac); re-asked when the
  // page opens, after a credential form changes and on Check again.
  const declared = (list.data ?? []).flatMap((plugin) => {
    const settings = plugin.issues.length ? undefined : plugin.manifest?.settings;
    return settings && Object.keys(settings).length ? [{ key: installedKey(plugin), settings, plugin }] : [];
  });
  const configuration = useQuery({
    queryKey: ["plugin-configuration", workbench?.id ?? null, declared.map((entry) => entry.key)],
    queryFn: () =>
      api.invoke("plugins.configuration", {
        ...(workbench ? { workbenchId: workbench.id } : {}),
        plugins: declared.map(({ key, settings }) => ({ key, settings })),
      }),
    enabled: declared.length > 0,
    staleTime: 0,
  });
  const configured = new Map(
    declared.map(({ key, settings, plugin }) => {
      const states = configuration.data?.plugins.find((entry) => entry.key === key)?.settings;
      const view: ConfigurationView = {
        states,
        needs: configurationNeeds(settings, states),
        fetching: configuration.isFetching,
        error: configuration.error ?? undefined,
        check: () => void configuration.refetch(),
      };
      return [plugin, view] as const;
    }),
  );
  const installedIds = new Set((list.data ?? []).map((plugin) => plugin.id));
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
    (plugin) => configured.get(plugin)?.needs ?? [],
  );
  const availableItems = catalogLibraryItems(catalog.data?.plugins ?? []);
  const scope = combinedLibraryItems(availableItems, installedItems);
  const basic = scope.filter((item) => matchesLibraryFilters(item, library, pluginActivityLabels(t)));
  const results = sortLibraryItems(
    basic.filter((item) => matchesLibraryStatus(item, library.status)),
    library.sort,
    i18n.language,
  );
  const page = Math.min(library.page, Math.max(1, Math.ceil(results.length / library.pageSize)));
  const hasSnapshot = list.data !== undefined && !catalog.isPending;
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
      {pack && catalog.data ? (
        pack.review ? (
          <PackReview
            pack={pack.review.pack}
            plan={pack.review.plan}
            platform={platform}
            installed={installedIds}
            cancel={() => setPack(undefined)}
            install={() => {
              const ids = pack.review?.plan.install.map((item) => item.entry.id) ?? [];
              setPack(undefined);
              startCatalog(ids, true, true);
            }}
          />
        ) : (
          <PackChooser
            packs={catalog.data.packs}
            cancel={() => setPack(undefined)}
            review={(chosen, groups) => {
              if (catalog.data)
                setPack({ review: { pack: chosen, plan: packPlan(catalog.data, chosen, groups, platform) } });
            }}
          />
        )
      ) : review ? (
        <Review
          review={review.review}
          catalog={review.catalog}
          scoped={review.scoped}
          cancel={() => {
            setReview(undefined);
            setQueue([]);
            run.current = undefined;
          }}
          installed={() => {
            void client.resetQueries({ queryKey: ["plugin-programs"] });
            client.removeQueries({ queryKey: ["plugin-programs"] });
            if (!review.catalog && !review.scoped) changeLibrary({ status: "installed" });
            if (review.catalog) run.current?.installed.push(review.catalog.id);
            setReview(undefined);
            void changed();
            if (queue.length) void reviewCatalog(queue);
            else void installPrograms();
          }}
        />
      ) : (
        <>
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
              {(catalog.data?.packs.length ?? 0) > 0 && (
                <button type="button" data-action="pack-open" disabled={busy} onClick={() => setPack({})}>
                  {t("plugins.packs.open")}
                </button>
              )}
              <button
                type="button"
                data-action="plugin-check-all"
                disabled={checkingAll !== undefined || !list.data?.some((plugin) => !plugin.issues.length)}
                onClick={() => void checkAll()}
              >
                {checkingAll ? t("plugins.checkingAll") : t("plugins.checkAll")}
              </button>
              <div className="workbench-actions plugin-refresh-actions">
                <button
                  type="button"
                  data-action="plugin-refresh"
                  disabled={busy}
                  onClick={() => void changed()}
                >
                  {t("plugins.refresh")}
                </button>
                <CatalogUpdateCheck />
              </div>
            </div>
            <CatalogSettings catalog={catalog} />
          </section>
          {error !== undefined && <ErrorMessage error={error} />}
          {installResults && (
            <section
              className="plugin-expanded"
              data-install-results
              role="status"
              aria-label={t("plugins.installResult.title")}
            >
              <strong>{t("plugins.installResult.title")}</strong>
              {installResults.map((row) => (
                <div key={row.id} className="plugin-card" data-install-result={row.id}>
                  <p className="plugin-heading">
                    <strong>{row.name}</strong>
                    {row.busy && <span className="muted">{t("plugins.installingPrograms")}</span>}
                  </p>
                  {row.error !== undefined && <ErrorMessage error={row.error} />}
                  {row.statuses && <Programs statuses={row.statuses} />}
                  {row.statuses?.some((status) => status.state !== "ready") && (
                    <p className="muted">{t("plugins.installResult.manual")}</p>
                  )}
                  <div className="workbench-actions">
                    <button
                      type="button"
                      data-action="install-result-check"
                      disabled={row.busy}
                      onClick={() => void checkAgain(row.id)}
                    >
                      {t("plugins.installResult.checkAgain")}
                    </button>
                  </div>
                </div>
              ))}
              <div className="workbench-actions">
                <button
                  type="button"
                  data-action="install-result-close"
                  onClick={() => setInstallResults(undefined)}
                >
                  {t("plugins.installResult.close")}
                </button>
              </div>
            </section>
          )}
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
          <div className="library-split">
            <div className="library-side">
              <PluginLibraryControls
                state={library}
                change={changeLibrary}
                items={scope}
                basic={basic}
                total={scope.length}
                count={results.length}
              />
            </div>
            <div className="library-main">
              {list.isPending && <p role="status">{t("home.loading")}</p>}
              {list.isError && <ErrorMessage error={list.error} />}
              {results.length === 0 && (
                <div className="plugin-library-empty">
                  <p>
                    {library.status === "installed" && !installedItems.length
                      ? t("plugins.none")
                      : t("plugins.library.noMatches")}
                  </p>
                  <button
                    type="button"
                    data-action="library-clear"
                    onClick={() => changeLibrary(clearedLibraryFilters)}
                  >
                    {t("plugins.library.clear")}
                  </button>
                  {library.status === "installed" && !installedItems.length && (
                    <button type="button" onClick={() => changeLibrary({ status: "all" })}>
                      {t("plugins.library.browse")}
                    </button>
                  )}
                </div>
              )}
              <div id="plugin-library-panel">
                <ul className="plugin-list">
                  {results.slice((page - 1) * library.pageSize, page * library.pageSize).map((item) => {
                    const view = catalog.data;
                    if (item.catalog && view && !item.plugin)
                      return (
                        <CatalogItem
                          key={item.key}
                          plugin={item.catalog}
                          platform={platform}
                          installed={installedIds}
                          busy={busy}
                          install={(id, programs) =>
                            startCatalog(item.catalog?.update ? [id] : installOrder(view, [id]), programs)
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
                        installedIds={installedIds}
                        configuration={configured.get(plugin)}
                        workbench={workbench}
                        openWorkbench={openWorkbench}
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
                        update={entry && { entry, busy, start: () => startCatalog([plugin.id], false) }}
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
            </div>
          </div>
        </>
      )}
    </section>
  );
}
