// REQ-UX-4bea0001 REQ-REL-4bea0006 REQ-REL-4bea0004
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionEvents } from "../../hooks/use-session-events.js";
import { ErrorMessage } from "../error-message.js";
import { Composer } from "./composer.js";
import { Transcript } from "./transcript.js";
import { UsageMeter } from "./usage-meter.js";

export function SessionWorkspace({
  id,
  changed,
  readOnly,
}: {
  id?: string | undefined;
  changed: () => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const { view, error, retry } = useSessionEvents(id, changed);
  const [failure, setFailure] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const stopDialog = useRef<HTMLDialogElement>(null);
  const stopOrigin = useRef<HTMLElement | null>(null);
  async function send(text: string) {
    if (!id || !text.trim() || pending || readOnly || view?.state.status === "awaiting_approval")
      return false;
    setPending(true);
    setFailure(undefined);
    try {
      await api.invoke("session.send", { sessionId: id, text });
      changed();
      return true;
    } catch (e) {
      setFailure(e);
      return false;
    } finally {
      setPending(false);
    }
  }
  async function stop() {
    if (!id || pending || readOnly) return;
    setPending(true);
    setFailure(undefined);
    try {
      await api.invoke("session.stop", { sessionId: id });
      changed();
    } catch (e) {
      setFailure(e);
    } finally {
      setPending(false);
    }
  }
  useEffect(() => {
    function key(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setSearching(true);
      }
      if (
        event.key === "Escape" &&
        !event.defaultPrevented &&
        view?.state.activeTurnId &&
        !stopDialog.current?.open
      ) {
        event.preventDefault();
        stopOrigin.current = document.activeElement as HTMLElement;
        stopDialog.current?.showModal();
        stopDialog.current?.querySelector("button")?.focus();
      }
    }
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [view?.state.activeTurnId]);
  useEffect(() => {
    if (searching) searchInput.current?.focus();
  }, [searching]);
  if (!id) return <p>{t("chat.select")}</p>;
  return (
    <section className="session-workspace" aria-label={t("chat.conversation")}>
      {error !== undefined && (
        <>
          <ErrorMessage error={error} />
          <button type="button" onClick={retry}>
            {t("settings.retry")}
          </button>
        </>
      )}
      {!view && error === undefined && <p role="status">{t("home.loading")}</p>}
      {searching && (
        <div className="transcript-search">
          <label>
            {t("chat.search")}
            <input ref={searchInput} value={search} onChange={(e) => setSearch(e.target.value)} />
          </label>
          <button
            type="button"
            onClick={() => {
              setSearching(false);
              setSearch("");
            }}
          >
            {t("panel.close")}
          </button>
        </div>
      )}
      {view && (
        <Transcript
          state={view.state}
          reasoning={view.reasoning}
          updates={view.updates}
          retry={() => {
            const last = [...view.state.items].reverse().find((i) => i.kind === "user");
            if (last?.kind === "user") void send(last.text);
          }}
          search={search}
          sessionId={id}
          disabled={readOnly}
        />
      )}
      {failure !== undefined && <ErrorMessage error={failure} />}
      {view && (
        <Composer
          state={view.state}
          disabled={readOnly || pending}
          send={send}
          stop={() => void stop()}
          setMode={async (mode) => {
            setPending(true);
            setFailure(undefined);
            try {
              await api.invoke("session.mode.set", { sessionId: id, mode });
              changed();
            } catch (e) {
              setFailure(e);
            } finally {
              setPending(false);
            }
          }}
          setModel={async (modelRef) => {
            setPending(true);
            setFailure(undefined);
            try {
              await api.invoke("session.model.set", { sessionId: id, modelRef });
              changed();
            } catch (e) {
              setFailure(e);
            } finally {
              setPending(false);
            }
          }}
        />
      )}
      {view && <UsageMeter state={view.state} />}
      <dialog
        ref={stopDialog}
        className="pinned-dialog"
        aria-labelledby="stop-title"
        onCancel={() => stopOrigin.current?.focus()}
      >
        <h3 id="stop-title">{t("chat.stopConfirm")}</h3>
        <div className="workbench-actions">
          <button
            type="button"
            onClick={() => {
              stopDialog.current?.close();
              stopOrigin.current?.focus();
            }}
          >
            {t("workbench.cancel")}
          </button>
          <button
            type="button"
            onClick={() => {
              stopDialog.current?.close();
              void stop();
            }}
          >
            {t("chat.stop")}
          </button>
        </div>
      </dialog>
    </section>
  );
}
