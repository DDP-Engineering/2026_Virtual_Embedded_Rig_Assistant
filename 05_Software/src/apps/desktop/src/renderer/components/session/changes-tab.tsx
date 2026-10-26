// REQ-UX-18000003 REQ-REL-18000004 REQ-REL-18000006 REQ-SEC-18000005
import { useQuery } from "@tanstack/react-query";
import { veraError } from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionEvents } from "../../hooks/use-session-events.js";
import { ErrorMessage } from "../error-message.js";
import { DiffViewer } from "./diff-viewer.js";

function unchanged() {}
export function ChangesTab({ workbenchId, sessionId }: { workbenchId: string; sessionId: string }) {
  return <ChangesView key={`${workbenchId}/${sessionId}`} workbenchId={workbenchId} sessionId={sessionId} />;
}
function ChangesView({ workbenchId, sessionId }: { workbenchId: string; sessionId: string }) {
  const { t } = useTranslation();
  const { view, error, retry } = useSessionEvents(sessionId, unchanged);
  const [selected, setSelected] = useState<number>();
  const [revealError, setRevealError] = useState<unknown>();
  const [revealing, setRevealing] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // A new key catches a record arriving while the first list is still pending.
  // The hook attaches replay from the snapshot sequence before enabling this query.
  const revision = view?.state.changes.map((c) => c.changeId).join(",");
  const list = useQuery({
    queryKey: ["changes.list", workbenchId, sessionId, revision],
    queryFn: () => api.invoke("changes.list", { sessionId }),
    enabled: !!view,
  });
  const selectedId = list.data?.some((c) => c.changeId === selected) ? selected : list.data?.[0]?.changeId;
  const detail = useQuery({
    queryKey: ["changes.get", workbenchId, sessionId, selectedId],
    queryFn: async () => {
      if (selectedId === undefined) throw veraError("NOT_FOUND");
      const value = await api.invoke("changes.get", { changeId: selectedId });
      if (value.sessionId !== sessionId || value.changeId !== selectedId) throw veraError("NOT_FOUND");
      return value;
    },
    enabled: selectedId !== undefined,
  });
  async function reveal() {
    const value = detail.data;
    if (!value || revealing) return;
    setRevealError(undefined);
    setRevealing(true);
    try {
      await api.invoke("app.revealPath", { path: value.path });
    } catch (failure) {
      if (alive.current) setRevealError(failure);
    } finally {
      if (alive.current) setRevealing(false);
    }
  }
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
            {list.data.map((change) => (
              <li key={change.changeId}>
                <button
                  type="button"
                  data-change={change.changeId}
                  aria-pressed={selectedId === change.changeId}
                  onClick={() => {
                    setSelected(change.changeId);
                    setRevealError(undefined);
                  }}
                >
                  <span>{change.path}</span>
                  <span className="changes-counts">
                    <span className="diff-added">+{change.added}</span>{" "}
                    <span className="diff-removed">−{change.removed}</span>
                  </span>
                  <time dateTime={change.createdAt}>{new Date(change.createdAt).toLocaleString()}</time>
                </button>
              </li>
            ))}
          </ol>
          {detail.isError ? (
            <>
              <ErrorMessage error={detail.error} />
              <button type="button" onClick={() => void detail.refetch()}>
                {t("settings.retry")}
              </button>
            </>
          ) : detail.isPending ? (
            <p role="status">{t("home.loading")}</p>
          ) : (
            <>
              <h3>{detail.data.path}</h3>
              <p className="sr-only">{t("approval.diff")}</p>
              <DiffViewer diff={detail.data.diff} identity={`change-${detail.data.changeId}`} />
              <button type="button" disabled={revealing} onClick={() => void reveal()}>
                {t("changes.reveal")}
              </button>
              {revealError !== undefined && <ErrorMessage error={revealError} />}
            </>
          )}
        </>
      )}
    </section>
  );
}
