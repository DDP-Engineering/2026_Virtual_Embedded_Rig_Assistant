// REQ-UX-4bea0001 REQ-REL-4bea0006 REQ-REL-4bea0004

import { Activity } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionEvents } from "../../hooks/use-session-events.js";
import { globalShortcutBlocked, ShortcutContext, shortcutCommand } from "../../lib/shortcuts.js";
import { ErrorMessage } from "../error-message.js";
import { Composer } from "./composer.js";
import { SessionInspector } from "./session-inspector.js";
import { Transcript } from "./transcript.js";
import { ContextIndicator } from "./usage-meter.js";

export function SessionWorkspace({
  id,
  workbenchId,
  changed,
  readOnly,
}: {
  id?: string | undefined;
  workbenchId: string;
  changed: () => void;
  readOnly: boolean;
}) {
  const { t } = useTranslation();
  const bindings = useContext(ShortcutContext);
  const { view, error, retry } = useSessionEvents(id, changed);
  const [failure, setFailure] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [inspector, setInspector] = useState<"context" | "activity">();
  const searchInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLElement>(null);
  function closeSearch() {
    setSearching(false);
    setSearch("");
    workspace.current?.querySelector<HTMLElement>("[data-transcript]")?.focus();
  }
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
      const command = shortcutCommand(event, bindings);
      if (command === "focusComposer" || command === "focusModel") {
        const target = workspace.current?.querySelector<HTMLElement>(
          command === "focusComposer" ? "#chat-message:not(:disabled)" : "[data-model-picker]:not(:disabled)",
        );
        if (target) {
          event.preventDefault();
          target.focus();
        }
        return;
      }
      if (command === "find") {
        event.preventDefault();
        setSearching(true);
        searchInput.current?.focus();
      }
      if (globalShortcutBlocked(event)) return;
      if (
        event.key === "Escape" &&
        !event.ctrlKey &&
        !event.metaKey &&
        !readOnly &&
        !pending &&
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
  }, [bindings, view?.state.activeTurnId, readOnly, pending]);
  useEffect(() => {
    if (searching) searchInput.current?.focus();
  }, [searching]);
  if (!id) return <p>{t("chat.select")}</p>;
  return (
    <section ref={workspace} className="session-workspace" aria-label={t("chat.conversation")}>
      {readOnly && <p role="status">{t("documents.readOnly")}</p>}
      <header className="session-heading">
        <h2>{view?.state.title || t("chat.untitled")}</h2>
      </header>
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
            <input
              ref={searchInput}
              type="search"
              aria-describedby="transcript-search-status"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  e.stopPropagation();
                  closeSearch();
                }
              }}
            />
          </label>
          <p id="transcript-search-status" role="status">
            {search
              ? t("chat.searchMatches", {
                  count:
                    view?.state.items.filter(
                      (item) =>
                        (item.kind === "user" || item.kind === "assistant") &&
                        item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()),
                    ).length ?? 0,
                })
              : t("chat.searchHint")}
          </p>
          <button type="button" onClick={closeSearch}>
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
          sessionId={id}
          state={view.state}
          inspectorControls={
            <>
              <ContextIndicator state={view.state} open={() => setInspector("context")} />
              <button
                type="button"
                data-action="show-activity"
                aria-label={t("chat.activity")}
                title={t("chat.activity")}
                aria-haspopup="dialog"
                onClick={() => setInspector("activity")}
              >
                <Activity aria-hidden="true" />
              </button>
            </>
          }
          disabled={readOnly || pending}
          send={send}
          stop={() => void stop()}
          setMode={async (mode) => {
            setPending(true);
            setFailure(undefined);
            try {
              await api.invoke("session.mode.set", { sessionId: id, mode });
              changed();
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
      {view && inspector && (
        <SessionInspector
          mode={inspector}
          state={view.state}
          workbenchId={workbenchId}
          reasoning={view.reasoning}
          updates={view.updates}
          close={() => setInspector(undefined)}
        />
      )}

      <dialog
        ref={stopDialog}
        className="pinned-dialog"
        aria-labelledby="stop-title"
        onClose={() => {
          if (stopOrigin.current?.isConnected) stopOrigin.current.focus();
          else workspace.current?.querySelector<HTMLElement>("[data-transcript]")?.focus();
        }}
      >
        <h3 id="stop-title">{t("chat.stopConfirm")}</h3>
        <div className="workbench-actions">
          <button
            type="button"
            onClick={() => {
              stopDialog.current?.close();
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
