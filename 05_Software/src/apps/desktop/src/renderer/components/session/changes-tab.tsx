// REQ-UX-18000003 REQ-REL-18000004 REQ-REL-18000006
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionView } from "../../hooks/session-view.js";
import { documentKey, useDocumentTabs, useDocumentViewer } from "../documents/viewer-context.js";
import { ErrorMessage } from "../error-message.js";
import { Pager, usePaged } from "../pager.js";

export function ChangesTab({ workbenchId, sessionId }: { workbenchId: string; sessionId: string }) {
  return <ChangesView key={`${workbenchId}/${sessionId}`} workbenchId={workbenchId} sessionId={sessionId} />;
}

function ChangesView({ workbenchId, sessionId }: { workbenchId: string; sessionId: string }) {
  const { t, i18n } = useTranslation();
  const { view, error, retry } = useSessionView(sessionId);
  const open = useDocumentViewer();
  const active = useDocumentTabs()?.active;
  // Replay from the snapshot sequence before the first list read, so live edits refresh it.
  const revision = view?.state.changes.map((c) => c.changeId).join(",");
  const list = useQuery({
    queryKey: ["changes.list", workbenchId, sessionId, revision],
    queryFn: () => api.invoke("changes.list", { sessionId }),
    enabled: !!view,
  });
  const { rows, pager } = usePaged(list.data ?? []);
  return (
    <section className="changes-tab" aria-label={t("panel.changes")}>
      {error !== undefined || list.isError ? (
        <>
          <ErrorMessage error={error ?? list.error} />
          <button type="button" onClick={() => (error !== undefined ? retry() : void list.refetch())}>
            {t("settings.retry")}
          </button>
        </>
      ) : !view || list.isPending ? (
        <p role="status">{t("home.loading")}</p>
      ) : list.data.length === 0 ? (
        <p className="muted">{t("changes.empty")}</p>
      ) : (
        <>
          <ol className="changes-list" aria-label={t("changes.history")}>
            {rows.map(({ changeId, path, added, removed, createdAt }) => {
              const target = { sessionChange: { sessionId, changeId, path } };
              return (
                <li key={changeId}>
                  <button
                    type="button"
                    data-change={changeId}
                    aria-pressed={active === documentKey(target)}
                    onClick={() => open?.(target)}
                  >
                    <span>{path}</span>
                    <span className="changes-meta">
                      <span className="changes-counts">
                        <span className="diff-added">+{added}</span>{" "}
                        <span className="diff-removed">−{removed}</span>
                      </span>
                      <time dateTime={createdAt}>{new Date(createdAt).toLocaleString(i18n.language)}</time>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <Pager {...pager} />
        </>
      )}
    </section>
  );
}
