import { useQuery, useQueryClient } from "@tanstack/react-query";
import { type ProgramRunInfo, programCommandLine } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
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
const commandLine = (run: ProgramRunInfo) => programCommandLine(run.program ?? "?", run.args);

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
  open,
}: {
  workbenchId: string;
  run: ProgramRunInfo;
  open: (run: ProgramRunInfo) => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const states = useStateLabels();
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<unknown>();
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
      <code className="run-command">{commandLine(run)}</code>
      <p className="muted">
        {run.plugin && <span>{t("runs.plugin", { plugin: run.plugin })} · </span>}
        <time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString(i18n.language)}</time>
        {run.background && <span> · {t("runs.background")}</span>}
      </p>
      <p className="run-state">
        <strong>{states[run.state]}</strong>
        {run.exitCode !== undefined && run.exitCode !== null && (
          <span> · {t("runs.exitCode", { code: run.exitCode })}</span>
        )}
        {run.error && <span> · {run.error}</span>}
      </p>
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="workbench-actions">
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

/** Plugin program runs of the open workbench: running and recent, with their logs and Stop. */
export function RunsTab({ workbenchId }: { workbenchId: string }) {
  const { t } = useTranslation();
  const [viewing, setViewing] = useState<ProgramRunInfo>();
  const runs = useQuery({
    queryKey: ["runs", workbenchId],
    queryFn: () => api.invoke("runs.list", { workbenchId }),
    staleTime: 0,
    refetchInterval: REFRESH_MS,
  });
  return (
    <section className="runs-tab" aria-label={t("panel.runs")}>
      {runs.isPending && <p role="status">{t("home.loading")}</p>}
      {runs.isError && <ErrorMessage error={runs.error} />}
      {runs.data?.runs.length === 0 && <p className="muted">{t("runs.none")}</p>}
      <ul className="runs-list">
        {runs.data?.runs.map((run) => (
          <RunRow key={run.id} workbenchId={workbenchId} run={run} open={setViewing} />
        ))}
      </ul>
      {viewing && <LogDialog workbenchId={workbenchId} run={viewing} close={() => setViewing(undefined)} />}
    </section>
  );
}
