import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ProgramRunInfo, programCommandLine } from "@vera/shared";
import { CalendarDays, FolderOpen, MessageSquare, Puzzle, Timer } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { useDocumentViewer } from "./documents/viewer-context.js";
import { ErrorMessage } from "./error-message.js";

/** The Runs list refreshes this often while the tab is shown. */
const REFRESH_MS = 1000;

function useStateLabels() {
  const { t } = useTranslation();
  return {
    running: t("runs.state.running"),
    exited: t("runs.state.exited"),
    stopped: t("runs.state.stopped"),
    timedOut: t("runs.state.timedOut"),
    interrupted: t("runs.state.interrupted"),
  } satisfies Record<ProgramRunInfo["state"], string>;
}
const commandLine = (run: ProgramRunInfo) =>
  run.command?.text ?? programCommandLine(run.program ?? "?", run.args);

function LogDialog({
  workbenchId,
  run,
  close,
}: {
  workbenchId: string;
  run: ProgramRunInfo;
  close: () => void;
}) {
  const { t } = useTranslation();
  const title = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const log = useQuery({
    queryKey: ["run-log", workbenchId, run.id],
    queryFn: () => api.invoke("runs.log", { workbenchId, id: run.id }),
    staleTime: 0,
    refetchInterval: (query) => (query.state.data?.running === false ? false : REFRESH_MS),
  });
  useEffect(() => {
    // Focus can return only once the modal is closed: everything behind an open modal is inert.
    const origin = document.activeElement as HTMLElement | null;
    const node = dialog.current;
    node?.showModal();
    return () => {
      node?.close();
      if (origin?.isConnected) origin.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog run-log-dialog"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <h2 id={title}>{t("runs.logTitle")}</h2>
      <code className="approval-command">{commandLine(run)}</code>
      {log.isPending && <p role="status">{t("home.loading")}</p>}
      {log.isError && <ErrorMessage error={log.error} />}
      {log.data?.truncated && <p className="muted">{t("runs.truncated")}</p>}
      {log.data && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrolling log must be reachable by keyboard.
        <pre className="run-log" data-run-log tabIndex={0}>
          {log.data.text}
        </pre>
      )}
      <div className="workbench-actions">
        <button type="button" data-action="run-log-close" onClick={close}>
          {t("runs.close")}
        </button>
      </div>
    </dialog>
  );
}

function RunRow({
  workbenchId,
  run,
  session,
  open,
}: {
  workbenchId: string;
  run: ProgramRunInfo;
  session: string;
  open: (run: ProgramRunInfo) => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const states = useStateLabels();
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<unknown>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (run.state !== "running") return;
    const timer = setInterval(() => setNow(Date.now()), REFRESH_MS);
    return () => clearInterval(timer);
  }, [run.state]);
  const log = useQuery({
    queryKey: ["run-log", workbenchId, run.id, run.state],
    queryFn: () => api.invoke("runs.log", { workbenchId, id: run.id }),
    enabled: !!run.command,
    staleTime: 0,
    refetchInterval: run.state === "running" ? REFRESH_MS : false,
  });
  const output = useRef<HTMLPreElement>(null);
  const text = log.data?.text.slice(-12000);
  useEffect(() => {
    if (text !== undefined && output.current) output.current.scrollTop = output.current.scrollHeight;
  }, [text]);
  const duration = run.durationMs ?? Math.max(0, now - Date.parse(run.startedAt));
  const seconds = (duration / 1000).toFixed(3);
  const durationLabel = t("runs.duration", { seconds });
  const startedAt = new Date(run.startedAt).toLocaleString(i18n.language);
  async function stop() {
    setStopping(true);
    setError(undefined);
    try {
      await api.invoke("runs.stop", { workbenchId, id: run.id });
      await client.invalidateQueries({ queryKey: ["runs", workbenchId] });
    } catch (failure) {
      setError(failure);
    } finally {
      setStopping(false);
    }
  }
  return (
    <li data-run={run.id} data-state={run.state}>
      <code className="run-command" title={commandLine(run)}>
        {commandLine(run)}
      </code>
      <div className="run-summary">
        <strong className="run-state">{states[run.state]}</strong>
        {(run.durationMs !== undefined || run.state === "running") && (
          <span className="run-duration" data-run-duration title={durationLabel}>
            <Timer className="run-icon" aria-hidden="true" />
            <span className="sr-only">{durationLabel}</span>
            <span aria-hidden="true">{t("runs.durationValue", { seconds })}</span>
          </span>
        )}
        {run.exitCode !== undefined && run.exitCode !== null && (
          <span className="run-exit" data-failed={run.exitCode !== 0}>
            {t("runs.exitCode", { code: run.exitCode })}
          </span>
        )}
      </div>
      <div className="run-metadata">
        <div className="run-meta" title={t("runs.session", { title: session })}>
          <MessageSquare className="run-icon" aria-hidden="true" />
          <span className="run-meta-value" data-run-session>
            <span className="sr-only">{t("runs.session", { title: "" })}</span>
            {session}
          </span>
        </div>
        <div className="run-meta">
          <CalendarDays className="run-icon" aria-hidden="true" />
          <time className="run-meta-value" dateTime={run.startedAt} title={startedAt}>
            <span className="sr-only">{t("runs.filterDate")}: </span>
            {startedAt}
          </time>
          {run.background && <span className="run-mode">{t("runs.background")}</span>}
        </div>
        {run.plugin && !run.command && (
          <div className="run-meta" title={t("runs.plugin", { plugin: run.plugin })}>
            <Puzzle className="run-icon" aria-hidden="true" />
            <span className="run-meta-value">{t("runs.plugin", { plugin: run.plugin })}</span>
          </div>
        )}
        {run.command && (
          <div className="run-meta" title={t("runs.folder", { folder: run.command.cwd })}>
            <FolderOpen className="run-icon" aria-hidden="true" />
            <code className="run-meta-value" data-run-cwd>
              <span className="sr-only">{t("runs.folder", { folder: "" })}</span>
              {run.command.cwd}
            </code>
          </div>
        )}
      </div>
      {run.error && (
        <p className="run-error">
          {run.error === "STOP_UNCONFIRMED" ? t("runs.stopUnconfirmed") : run.error}
        </p>
      )}
      {run.command && log.isError && <ErrorMessage error={log.error} />}
      {run.command && text?.trim() && (
        // biome-ignore lint/a11y/noNoninteractiveTabindex: the live log supports keyboard scrolling.
        <pre ref={output} className="run-log run-live-output" data-run-output tabIndex={0}>
          {text}
        </pre>
      )}
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="workbench-actions run-actions">
        <button type="button" data-action="run-log" onClick={() => open(run)}>
          {t("runs.openLog")}
        </button>
        {run.state === "running" && (
          <button type="button" data-action="run-stop" disabled={stopping} onClick={() => void stop()}>
            {t("runs.stop")}
          </button>
        )}
      </div>
    </li>
  );
}

type SessionFilter = "current" | "all" | string;
type DateFilter = "any" | "today" | "week";
type SortOrder = "newest" | "oldest" | "plugin" | "session" | "state";
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Commands and plugin program runs of the open workbench, with their logs and Stop.
 * Filters by session (the current one by default), plugin, state and date, and sorts by any of them.
 */
export function RunsTab({
  workbenchId,
  sessions = [],
  currentSessionId,
}: {
  workbenchId: string;
  sessions?: { id: string; title?: string | undefined }[] | undefined;
  currentSessionId?: string | undefined;
}) {
  const { t } = useTranslation();
  const states = useStateLabels();
  const openDocument = useDocumentViewer();
  const [viewing, setViewing] = useState<string>();
  const [sessionFilter, setSessionFilter] = useState<SessionFilter>("current");
  const [pluginFilter, setPluginFilter] = useState("all");
  const [stateFilter, setStateFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("any");
  const [sort, setSort] = useState<SortOrder>("newest");
  const runs = useQuery({
    queryKey: ["runs", workbenchId],
    queryFn: () => api.invoke("runs.list", { workbenchId }),
    staleTime: 0,
    refetchInterval: REFRESH_MS,
  });
  const titles = new Map(sessions.map((session) => [session.id, session.title || t("chat.untitled")]));
  const titleOf = (id: string) => titles.get(id) ?? t("runs.unknownSession");
  const all = runs.data?.runs ?? [];
  const viewedRun = all.find((run) => run.id === viewing);
  const plugins = [
    ...new Set(
      all
        .filter((run) => !run.command)
        .map((run) => run.plugin)
        .filter((plugin) => plugin !== undefined),
    ),
  ].sort();
  // "Current session" falls back to all sessions when no conversation is open.
  const session =
    sessionFilter === "current" ? currentSessionId : sessionFilter === "all" ? undefined : sessionFilter;
  const since =
    dateFilter === "today"
      ? new Date().setHours(0, 0, 0, 0)
      : dateFilter === "week"
        ? Date.now() - 7 * DAY_MS
        : 0;
  const shown = all
    .filter((run) => session === undefined || run.sessionId === session)
    .filter((run) => pluginFilter === "all" || (!run.command && run.plugin === pluginFilter))
    .filter((run) => stateFilter === "all" || run.state === stateFilter)
    .filter((run) => Date.parse(run.startedAt) >= since)
    .sort((a, b) => {
      const time = Date.parse(b.startedAt) - Date.parse(a.startedAt);
      if (sort === "oldest") return -time;
      if (sort === "plugin") return (a.plugin ?? "").localeCompare(b.plugin ?? "") || time;
      if (sort === "session") return titleOf(a.sessionId).localeCompare(titleOf(b.sessionId)) || time;
      if (sort === "state") return states[a.state].localeCompare(states[b.state]) || time;
      return time;
    });
  return (
    <section className="runs-tab" aria-label={t("panel.runs")}>
      <div className="runs-filters" data-runs-filters>
        <label>
          {t("runs.filterSession")}
          <select
            data-runs-filter="session"
            value={sessionFilter}
            onChange={(event) => setSessionFilter(event.target.value)}
          >
            {currentSessionId && <option value="current">{t("runs.currentSession")}</option>}
            <option value="all">{t("runs.allSessions")}</option>
            {sessions.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title || t("chat.untitled")}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("runs.filterPlugin")}
          <select
            data-runs-filter="plugin"
            value={pluginFilter}
            onChange={(event) => setPluginFilter(event.target.value)}
          >
            <option value="all">{t("runs.allPlugins")}</option>
            {plugins.map((plugin) => (
              <option key={plugin} value={plugin}>
                {plugin}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("runs.filterState")}
          <select
            data-runs-filter="state"
            value={stateFilter}
            onChange={(event) => setStateFilter(event.target.value)}
          >
            <option value="all">{t("runs.allStates")}</option>
            {Object.entries(states).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("runs.filterDate")}
          <select
            data-runs-filter="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value as DateFilter)}
          >
            <option value="any">{t("runs.anyTime")}</option>
            <option value="today">{t("runs.today")}</option>
            <option value="week">{t("runs.lastWeek")}</option>
          </select>
        </label>
        <label>
          {t("runs.sort")}
          <select data-runs-sort value={sort} onChange={(event) => setSort(event.target.value as SortOrder)}>
            <option value="newest">{t("runs.newest")}</option>
            <option value="oldest">{t("runs.oldest")}</option>
            <option value="plugin">{t("runs.byPlugin")}</option>
            <option value="session">{t("runs.bySession")}</option>
            <option value="state">{t("runs.byState")}</option>
          </select>
        </label>
      </div>
      {runs.isPending && <p role="status">{t("home.loading")}</p>}
      {runs.isError && <ErrorMessage error={runs.error} />}
      {runs.data?.runs.length === 0 && <p className="muted">{t("runs.none")}</p>}
      {all.length > 0 && shown.length === 0 && <p className="muted">{t("runs.noMatch")}</p>}
      <ul className="runs-list">
        {shown.map((run) => (
          <RunRow
            key={run.id}
            workbenchId={workbenchId}
            run={run}
            session={titleOf(run.sessionId)}
            open={(run) =>
              run.state !== "running" && openDocument ? openDocument({ runId: run.id }) : setViewing(run.id)
            }
          />
        ))}
      </ul>
      {viewedRun && (
        <LogDialog workbenchId={workbenchId} run={viewedRun} close={() => setViewing(undefined)} />
      )}
    </section>
  );
}
