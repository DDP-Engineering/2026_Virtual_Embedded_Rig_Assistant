import type { SessionSummary, WorkbenchSnapshot } from "@vera/shared";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

export function Workbench({
  active,
  changed,
  closed,
  sessionPending = false,
  sessions,
  edit,
  selectSession,
  sessionsError,
  retrySessions,
}: {
  active: WorkbenchSnapshot | undefined;
  changed: (active?: WorkbenchSnapshot, configOnly?: boolean) => void;
  /** The workbench closed, from here or elsewhere; a page the user opened meanwhile stays. */
  closed: () => void;
  sessionPending?: boolean;
  sessions?: SessionSummary[] | undefined;
  edit?: () => void;
  selectSession?: (id: string) => void;
  sessionsError?: unknown;
  retrySessions?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const activeId = active?.config.id;
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const off = api.subscribe("workbench", activeId, (event) => {
      if (cancelled) return;
      if (event.type === "closed") {
        closed();
      } else if (event.type === "config.changed") {
        changed({ ...active, config: event.config, warnings: event.warnings }, true);
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [activeId, active, changed, closed]);
  const number = new Intl.NumberFormat(i18n.resolvedLanguage ?? i18n.language);
  const warningLabels = {
    UNKNOWN_KEY: t("workbench.unknownKey"),
    UNKNOWN_NAME: t("workbench.unknownName"),
    NETWORK_SHARE_UNSUPPORTED: t("workbench.networkShare"),
    LOCK_GUARD_BUSY: t("workbench.lockGuard"),
  };
  return (
    <>
      {active && (
        <section className="surface workbench-overview" data-workbench="active">
          <header className="overview-header">
            <div className="overview-title">
              <h3>{active.config.name}</h3>
              <p className="path-text overview-folder">{active.folder}</p>
              {active.config.description && <p>{active.config.description}</p>}
            </div>
            {edit && (
              <button
                type="button"
                data-action="edit-workbench-overview"
                disabled={sessionPending}
                onClick={edit}
              >
                {t("projects.edit")}
              </button>
            )}
          </header>
          {active.readOnly && <p role="status">{t("workbench.readOnly")}</p>}
          {active.warnings.length > 0 && (
            <ul className="workbench-warnings">
              {active.warnings.map((warning, index) => (
                <li key={`${warning.code}:${warning.path ?? index}`}>
                  {warningLabels[warning.code]} {warning.path}
                </li>
              ))}
            </ul>
          )}
          <div className="overview-groups" data-workbench-overview>
            <div className="overview-card">
              <h4>{t("overview.agentGroup")}</h4>
              <dl>
                <div className="overview-row">
                  <dt>{t("overview.model")}</dt>
                  <dd>{active.config.agent.model ?? t("overview.appDefault")}</dd>
                </div>
                <div className="overview-row">
                  <dt>{t("overview.permissions")}</dt>
                  <dd>
                    {active.config.agent.permission_mode === "ask"
                      ? t("approval.ask")
                      : active.config.agent.permission_mode === "read-only"
                        ? t("approval.readOnly")
                        : t("approval.autoEdit")}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="overview-card">
              <h4>{t("overview.indexGroup")}</h4>
              <dl>
                <div className="overview-row">
                  <dt>{t("overview.include")}</dt>
                  <dd className="path-text">{active.config.docs.include.join(", ") || "—"}</dd>
                </div>
                <div className="overview-row">
                  <dt>{t("overview.exclude")}</dt>
                  <dd className="path-text">{active.config.docs.exclude.join(", ") || "—"}</dd>
                </div>
                <div className="overview-row">
                  <dt>{t("projects.embeddingModel")}</dt>
                  <dd>{active.config.embeddings.model}</dd>
                </div>
                <div className="overview-row">
                  <dt>{t("projects.chunkSize")}</dt>
                  <dd>{number.format(active.config.embeddings.chunkSize)}</dd>
                </div>
                <div className="overview-row">
                  <dt>{t("projects.overlap")}</dt>
                  <dd>{number.format(active.config.embeddings.overlap)}</dd>
                </div>
              </dl>
            </div>
          </div>
          <section className="overview-card workbench-session-summary">
            <h4>
              {t("overview.sessions")}
              {sessions ? ` (${sessions.length})` : ""}
            </h4>
            {!sessions && !sessionsError && <p role="status">{t("home.loading")}</p>}
            {sessionsError != null && (
              <>
                <ErrorMessage error={sessionsError} />
                <button type="button" onClick={retrySessions}>
                  {t("settings.retry")}
                </button>
              </>
            )}
            {sessions?.length === 0 && <p>{t("overview.noSessions")}</p>}
            {!!sessions?.length && (
              <table className="overview-sessions">
                <thead>
                  <tr>
                    <th>{t("overview.session")}</th>
                    <th>{t("overview.created")}</th>
                    <th>{t("overview.updated")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessions.map((session) => (
                    <tr key={session.id} data-overview-session={session.id}>
                      <td>
                        <button
                          type="button"
                          className="overview-session-link"
                          onClick={() => selectSession?.(session.id)}
                        >
                          {session.title || t("chat.untitled")}
                        </button>
                      </td>
                      <td>
                        <time dateTime={session.createdAt}>
                          {new Date(session.createdAt).toLocaleString(i18n.resolvedLanguage ?? "en")}
                        </time>
                      </td>
                      <td>
                        <time dateTime={session.updatedAt}>
                          {new Date(session.updatedAt).toLocaleString(i18n.resolvedLanguage ?? "en")}
                        </time>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </section>
      )}
    </>
  );
}
