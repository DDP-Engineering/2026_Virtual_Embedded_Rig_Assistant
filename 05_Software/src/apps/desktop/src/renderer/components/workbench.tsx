import { useQuery } from "@tanstack/react-query";
import { type SessionSummary, veraError, type WorkbenchSnapshot } from "@vera/shared";
import { RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { WorkbenchIndexDetails } from "./documents/workbench-index-details.js";
import { ErrorMessage } from "./error-message.js";
import { Pager, usePaged } from "./pager.js";
import { WorkbenchFolders } from "./workbench-folders.js";

/** Bytes in the largest unit (binary steps) with a localized unit name: "840 kB", "2.4 MB". */
export function formatBytes(bytes: number | undefined, language: string): string {
  if (bytes === undefined) return "—";
  const units = ["byte", "kilobyte", "megabyte", "gigabyte"] as const;
  let value = bytes,
    unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return new Intl.NumberFormat(language, {
    style: "unit",
    unit: units[unit],
    unitDisplay: "short",
    maximumFractionDigits: value < 10 && unit > 0 ? 1 : 0,
  }).format(value);
}
export function Workbench({
  active,
  changed,
  closed,
  sessionPending = false,
  showIndexDetails = true,
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
  showIndexDetails?: boolean;
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
  const language = i18n.resolvedLanguage ?? i18n.language;
  const number = new Intl.NumberFormat(language);
  const { rows: sessionRows, pager: sessionPager } = usePaged(sessions ?? []);
  // Refetched whenever a session of the list changes, so sizes follow new activity.
  const revision = (sessions ?? []).map((session) => session.updatedAt).join();
  const sizes = useQuery({
    queryKey: ["session.sizes", activeId, revision],
    queryFn: () => api.invoke("session.sizes", { workbenchId: activeId as string }),
    enabled: !!activeId && !!sessions?.length,
  });
  const storage = useQuery({
    queryKey: ["workbench.storage", activeId],
    enabled: !!activeId,
    refetchOnMount: "always",
    retry: false,
    queryFn: async () => {
      const result = await api.invoke("workbench.storage", { workbenchId: activeId as string });
      if (result.workbenchId !== activeId) throw veraError("CONFLICT");
      return result;
    },
  });
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
          <WorkbenchFolders
            key={`${active.config.id}:${JSON.stringify(active.config.additional_folders)}`}
            workbenchId={active.config.id}
            live
          />
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
              <div className="overview-index-heading">
                <h4>{t("overview.indexGroup")}</h4>
                {showIndexDetails && (
                  <WorkbenchIndexDetails
                    key={active.indexLease}
                    workbenchId={active.config.id}
                    indexLease={active.indexLease}
                    readOnly={active.readOnly}
                  />
                )}
              </div>
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
                <div className="overview-row">
                  <dt>{t("overview.storageSize")}</dt>
                  <dd className="overview-storage" aria-busy={storage.isFetching}>
                    <span data-workbench-storage aria-live="polite">
                      {formatBytes(storage.data?.bytes, language)}
                    </span>
                    <button
                      type="button"
                      aria-label={t("overview.refreshStorage")}
                      title={t("overview.refreshStorage")}
                      disabled={storage.isFetching}
                      onClick={() => void storage.refetch()}
                    >
                      <RefreshCw aria-hidden="true" />
                    </button>
                  </dd>
                </div>
              </dl>
              {storage.isError && <ErrorMessage error={storage.error} />}
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
                    <th>{t("overview.size")}</th>
                  </tr>
                </thead>
                <tbody>
                  {sessionRows.map((session) => (
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
                      <td data-session-size>{formatBytes(sizes.data?.[session.id], language)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <Pager {...sessionPager} />
          </section>
        </section>
      )}
    </>
  );
}
