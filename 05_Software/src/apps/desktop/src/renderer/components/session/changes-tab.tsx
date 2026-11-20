// REQ-UX-18000003 REQ-REL-18000004 REQ-REL-18000006 REQ-SEC-18000005
import { useQuery } from "@tanstack/react-query";
import { veraError } from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionView } from "../../hooks/session-view.js";
import { ErrorMessage } from "../error-message.js";
import { Pager, usePaged } from "../pager.js";
import { DiffViewer } from "./diff-viewer.js";

/** The file list's share of the tab height; each pane keeps at least a quarter. */
const SPLIT_MIN = 25;
const SPLIT_MAX = 75;
const SPLIT_STEP = 5;
/** Kept across tab switches and sessions while the app runs. */
let lastSplit = 50;
const clampSplit = (value: number) => Math.round(Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value)));

export function ChangesTab({ workbenchId, sessionId }: { workbenchId: string; sessionId: string }) {
  return <ChangesView key={`${workbenchId}/${sessionId}`} workbenchId={workbenchId} sessionId={sessionId} />;
}
function ChangesView({ workbenchId, sessionId }: { workbenchId: string; sessionId: string }) {
  const { t, i18n } = useTranslation();
  const { view, error, retry } = useSessionView(sessionId);
  const [selected, setSelected] = useState<number>();
  const [revealError, setRevealError] = useState<unknown>();
  const [revealing, setRevealing] = useState(false);
  const [split, setSplitState] = useState(lastSplit);
  const setSplit = (value: number) => {
    lastSplit = clampSplit(value);
    setSplitState(lastSplit);
  };
  const tab = useRef<HTMLElement>(null);
  const dragging = useRef(false);
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
  const { rows, pager } = usePaged(list.data ?? []);
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
    <section className="changes-tab" ref={tab} aria-label={t("panel.changes")}>
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
          <div className="changes-files" style={{ flexBasis: `${split}%` }}>
            <ol className="changes-list" aria-label={t("changes.history")}>
              {rows.map((change) => (
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
                    {/* Counts and time share one line to keep each entry short. */}
                    <span className="changes-meta">
                      <span className="changes-counts">
                        <span className="diff-added">+{change.added}</span>{" "}
                        <span className="diff-removed">−{change.removed}</span>
                      </span>
                      <time dateTime={change.createdAt}>
                        {new Date(change.createdAt).toLocaleString(i18n.language)}
                      </time>
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            <Pager {...pager} />
          </div>
          <hr
            tabIndex={0}
            className="changes-splitter"
            data-changes-splitter
            aria-label={t("changes.resize")}
            aria-orientation="horizontal"
            aria-valuemin={SPLIT_MIN}
            aria-valuemax={SPLIT_MAX}
            aria-valuenow={split}
            onPointerDown={(event) => {
              event.currentTarget.focus();
              event.currentTarget.setPointerCapture(event.pointerId);
              dragging.current = true;
            }}
            onPointerMove={(event) => {
              const box = tab.current?.getBoundingClientRect();
              if (!dragging.current || !box || box.height <= 0) return;
              setSplit(((event.clientY - box.top) / box.height) * 100);
            }}
            onPointerUp={() => {
              dragging.current = false;
            }}
            onPointerCancel={() => {
              dragging.current = false;
            }}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowUp"
                  ? split - SPLIT_STEP
                  : event.key === "ArrowDown"
                    ? split + SPLIT_STEP
                    : event.key === "Home"
                      ? SPLIT_MIN
                      : event.key === "End"
                        ? SPLIT_MAX
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              setSplit(next);
            }}
          />
          <div className="changes-detail">
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
          </div>
        </>
      )}
    </section>
  );
}
