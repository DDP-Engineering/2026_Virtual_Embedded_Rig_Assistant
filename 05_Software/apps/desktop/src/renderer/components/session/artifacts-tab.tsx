// REQ-UX-76d958ce REQ-REL-da260a86
import { useQuery } from "@tanstack/react-query";
import { veraError } from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionEvents } from "../../hooks/use-session-events.js";
import { ArtifactBody } from "../documents/viewer-context.js";
import { ErrorMessage } from "../error-message.js";

function unchanged() {}
export function ArtifactsTab(props: { workbenchId: string; sessionId: string }) {
  return <ArtifactsView key={`${props.workbenchId}/${props.sessionId}`} {...props} />;
}
function ArtifactsView({ workbenchId, sessionId }: { workbenchId: string; sessionId: string }) {
  const { t, i18n } = useTranslation();
  const { view, error, retry } = useSessionEvents(sessionId, unchanged);
  const [selected, setSelected] = useState<string>();
  const [action, setAction] = useState<string>();
  const [actionError, setActionError] = useState<unknown>();
  const [exported, setExported] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const revision = JSON.stringify(view?.state.artifacts);
  const list = useQuery({
    queryKey: ["artifacts.list", workbenchId, sessionId, revision],
    queryFn: () => api.invoke("artifacts.list", { sessionId }),
    enabled: !!view,
  });
  const id = list.data?.some((a) => a.artifactId === selected) ? selected : list.data?.[0]?.artifactId;
  const detail = useQuery({
    queryKey: ["artifacts.open", workbenchId, sessionId, id, revision],
    queryFn: async () => {
      if (!id) throw veraError("NOT_FOUND");
      const a = await api.invoke("artifacts.open", { artifactId: id });
      if (a.sessionId !== sessionId || a.artifactId !== id) throw veraError("NOT_FOUND");
      return a;
    },
    enabled: !!id,
  });
  async function perform(kind: "artifacts.export" | "artifacts.reveal") {
    if (!id || action) return;
    const origin = id;
    setAction(kind);
    setActionError(undefined);
    setExported(false);
    try {
      const result = await api.invoke(kind, { artifactId: origin });
      if (alive.current && kind === "artifacts.export" && "exported" in result) setExported(result.exported);
    } catch (failure) {
      if (alive.current) setActionError(failure);
    } finally {
      if (alive.current) setAction(undefined);
    }
  }
  return (
    <section className="artifacts-tab" aria-label={t("panel.artifacts")}>
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
        <p className="muted">{t("artifacts.empty")}</p>
      ) : (
        <>
          <ol className="artifacts-list" aria-label={t("artifacts.history")}>
            {list.data.map((a) => (
              <li key={a.artifactId}>
                <button
                  type="button"
                  data-artifact={a.artifactId}
                  aria-pressed={id === a.artifactId}
                  disabled={!!action}
                  onClick={() => {
                    setSelected(a.artifactId);
                    setActionError(undefined);
                    setExported(false);
                  }}
                >
                  <span>{a.name}</span>
                  <span>{t("artifacts.bytes", { count: a.bytes })}</span>
                  <time dateTime={a.createdAt}>{new Date(a.createdAt).toLocaleString(i18n.language)}</time>
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
              <h3>{detail.data.name}</h3>
              {detail.data.description && <p>{detail.data.description}</p>}
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable artifact content receives keyboard scrolling. */}
              <section className="artifact-viewer" tabIndex={0} aria-label={t("artifacts.viewer")}>
                <ArtifactBody content={detail.data.content} mime={detail.data.mime} />
              </section>
              <div className="artifact-actions">
                <button type="button" disabled={!!action} onClick={() => void perform("artifacts.export")}>
                  {t("artifacts.export")}
                </button>
                <button type="button" disabled={!!action} onClick={() => void perform("artifacts.reveal")}>
                  {t("artifacts.reveal")}
                </button>
              </div>
              {exported && <p role="status">{t("artifacts.exported")}</p>}
              {actionError !== undefined && <ErrorMessage error={actionError} />}
            </>
          )}
        </>
      )}
    </section>
  );
}
