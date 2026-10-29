import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SessionSummary, WorkbenchSnapshot } from "@vera/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

export function Workbench({
  settingsReadOnly,
  active,
  changed,
  sessionPending = false,
  sessions,
  edit,
  selectSession,
  sessionsError,
  retrySessions,
}: {
  settingsReadOnly: boolean;
  active: WorkbenchSnapshot | undefined;
  changed: (active?: WorkbenchSnapshot, configOnly?: boolean) => void;
  sessionPending?: boolean;
  sessions?: SessionSummary[] | undefined;
  edit?: () => void;
  selectSession?: (id: string) => void;
  sessionsError?: unknown;
  retrySessions?: () => void;
}) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const [folder, setFolder] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const activeId = active?.config.id;
  const recent = useQuery({
    queryKey: ["workbench.recent"],
    queryFn: () => api.invoke("workbench.recent", {}),
  });
  useEffect(
    () =>
      api.subscribe("app", () => {
        void client.invalidateQueries({ queryKey: ["workbench.recent"] });
      }),
    [client],
  );
  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    const off = api.subscribe("workbench", activeId, (event) => {
      if (cancelled) return;
      if (event.type === "closed") {
        changed();
      } else if (event.type === "config.changed") {
        changed({ ...active, config: event.config, warnings: event.warnings }, true);
      }
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [activeId, active, changed]);
  async function perform(action: () => Promise<void>) {
    if (pending || sessionPending) return;
    setPending(true);
    setError(undefined);
    try {
      await action();
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  async function open(path: string) {
    const snapshot = await api.invoke("workbench.open", { folder: path });
    changed(snapshot);
    await recent.refetch();
  }
  const warningLabels = {
    UNKNOWN_KEY: t("workbench.unknownKey"),
    UNKNOWN_NAME: t("workbench.unknownName"),
    NETWORK_SHARE_UNSUPPORTED: t("workbench.networkShare"),
    LOCK_GUARD_BUSY: t("workbench.lockGuard"),
  };
  return (
    <>
      {error !== undefined && <ErrorMessage error={error} />}
      {pending && <p role="status">{t("workbench.working")}</p>}
      {active ? (
        <section className="surface" data-workbench="active">
          <h3>{active.config.name}</h3>
          {active.config.description && <p>{active.config.description}</p>}
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
          <dl className="workbench-config-summary" data-workbench-overview>
            <dt>{t("overview.folder")}</dt>
            <dd className="path-text">{active.folder}</dd>
            <dt>{t("overview.model")}</dt>
            <dd>{active.config.agent.model ?? t("overview.appDefault")}</dd>
            <dt>{t("overview.permissions")}</dt>
            <dd>
              {active.config.agent.permission_mode === "ask"
                ? t("approval.ask")
                : active.config.agent.permission_mode === "read-only"
                  ? t("approval.readOnly")
                  : t("approval.autoEdit")}
            </dd>
            <dt>{t("overview.include")}</dt>
            <dd>{active.config.docs.include.join(", ") || "—"}</dd>
            <dt>{t("overview.exclude")}</dt>
            <dd>{active.config.docs.exclude.join(", ") || "—"}</dd>
            <dt>{t("projects.embeddingModel")}</dt>
            <dd>{active.config.embeddings.model}</dd>
            <dt>{t("projects.chunkSize")}</dt>
            <dd>{active.config.embeddings.chunkSize}</dd>
            <dt>{t("projects.overlap")}</dt>
            <dd>{active.config.embeddings.overlap}</dd>
          </dl>
          <div className="workbench-actions">
            {edit && (
              <button
                type="button"
                data-action="edit-workbench-overview"
                disabled={pending || sessionPending}
                onClick={edit}
              >
                {t("projects.edit")}
              </button>
            )}
          </div>
          <section className="workbench-session-summary">
            <h3>
              {t("overview.sessions")}
              {sessions ? ` (${sessions.length})` : ""}
            </h3>
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
              <table>
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
                        <button type="button" onClick={() => selectSession?.(session.id)}>
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
      ) : (
        <div className="welcome-grid">
          <section className="surface">
            <h3>{t("welcome.create")}</h3>
            <form
              className="workbench-form"
              onSubmit={(event) => {
                event.preventDefault();
                if (folder)
                  void perform(async () => {
                    const snapshot = await api.invoke("workbench.create", { folder, name });
                    changed(snapshot);
                    await recent.refetch();
                  });
              }}
            >
              <label htmlFor="workbench-name">{t("workbench.name")}</label>
              <input
                id="workbench-name"
                maxLength={80}
                required
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={pending}
              />
              <button
                type="button"
                data-action="choose-create"
                disabled={pending}
                onClick={() =>
                  void perform(async () => {
                    const result = await api.invoke("app.chooseFolder", {});
                    if (result.folder) setFolder(result.folder);
                  })
                }
              >
                {t("workbench.chooseFolder")}
              </button>
              {folder && (
                <p className="path-text" data-selected-folder>
                  {folder}
                </p>
              )}
              <button
                type="submit"
                data-action="create-workbench"
                disabled={pending || !folder || !name.trim()}
              >
                {t("welcome.create")}
              </button>
            </form>
          </section>
          <section className="surface">
            <h3>{t("welcome.open")}</h3>
            <p className="muted">{t("workbench.openDescription")}</p>
            <button
              type="button"
              data-action="open-workbench"
              disabled={pending}
              onClick={() =>
                void perform(async () => {
                  const result = await api.invoke("app.chooseFolder", {});
                  if (result.folder) await open(result.folder);
                })
              }
            >
              {t("workbench.openFolder")}
            </button>
          </section>
        </div>
      )}
      {!active && (
        <section className="surface">
          <h3>{t("welcome.recent")}</h3>
          {recent.isPending && <p role="status">{t("workbench.working")}</p>}
          {recent.isError && (
            <>
              <ErrorMessage error={recent.error} />
              <button type="button" onClick={() => void recent.refetch()}>
                {t("settings.retry")}
              </button>
            </>
          )}
          {recent.data?.length === 0 && <p className="muted">{t("workbench.noRecent")}</p>}
          <ul className="recent-workbenches">
            {recent.data?.map((entry) => (
              <li key={entry.folder} data-recent={entry.missing ? "missing" : "present"}>
                <div>
                  <strong>{entry.name}</strong>
                  <p className="path-text">{entry.folder}</p>
                  {entry.missing && <p>{t("workbench.missing")}</p>}
                </div>
                <div className="workbench-actions">
                  <button
                    type="button"
                    data-action="open-recent"
                    aria-label={t("workbench.openNamed", { name: entry.name })}
                    disabled={pending || entry.missing}
                    onClick={() => void perform(() => open(entry.folder))}
                  >
                    {t("workbench.openRecent")}
                  </button>
                  <button
                    type="button"
                    data-action="remove-recent"
                    aria-label={t("workbench.removeNamed", { name: entry.name })}
                    disabled={pending || settingsReadOnly}
                    onClick={() =>
                      void perform(async () => {
                        await api.invoke("workbench.recent", { remove: entry.folder });
                        await recent.refetch();
                      })
                    }
                  >
                    {t("workbench.remove")}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
