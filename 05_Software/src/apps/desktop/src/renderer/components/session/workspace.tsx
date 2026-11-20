// REQ-UX-4bea0001 REQ-REL-4bea0006 REQ-REL-4bea0004

import type { ChatDetail, DictationRecordingMode, SessionSummary } from "@vera/shared";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionView } from "../../hooks/session-view.js";
import { globalShortcutBlocked, ShortcutContext, shortcutCommand } from "../../lib/shortcuts.js";
import { CHAT, useDocumentTabs } from "../documents/viewer-context.js";
import { ErrorMessage } from "../error-message.js";
import { BrowserControls } from "./browser-controls.js";
import { Composer } from "./composer.js";
import { DelegationLinks } from "./delegation-links.js";
import { SessionInspector } from "./session-inspector.js";
import { Transcript } from "./transcript.js";
import { searchMatch } from "./transcript-projection.js";
import { ContextIndicator } from "./usage-meter.js";

export function SessionWorkspace({
  id,
  dictationMode,
  workbenchId,
  changed,
  readOnly,
  browserEnabled = false,
  archived = false,
  detail = "normal",
  delegation,
  delegationParent,
  delegationChildren = [],
  selectLinkedSession,
  focusTranscript = false,
  transcriptOpened,
  composerFocusRequest = 0,
  composerFocused,
}: {
  id?: string | undefined;
  dictationMode?: DictationRecordingMode | undefined;
  workbenchId: string;
  changed: () => void;
  readOnly: boolean;
  browserEnabled?: boolean;
  archived?: boolean;
  detail?: ChatDetail;
  delegation?: SessionSummary["delegation"];
  delegationParent?: SessionSummary | undefined;
  delegationChildren?: readonly SessionSummary[] | undefined;
  selectLinkedSession?: (id: string) => void;
  focusTranscript?: boolean;
  transcriptOpened?: (id: string) => void;
  composerFocusRequest?: number;
  /** Called once a focus request is taken, so the app drops it and never replays it. */
  composerFocused?: () => void;
}) {
  const { t } = useTranslation();
  const bindings = useContext(ShortcutContext);
  const { view, error, retry } = useSessionView(id, changed);
  const [failure, setFailure] = useState<unknown>();
  const [pending, setPending] = useState(false);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [inspector, setInspector] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastComposerFocus = useRef(0);
  const composerReady = !!view && !readOnly && !pending;
  // Behind a document tab (TASK-79f6ffd3) the conversation is hidden: a composer focus request
  // (Attach as context) shows the Chat tab first; window shortcuts wait until it is shown.
  const tabs = useDocumentTabs();
  const shown = !tabs || tabs.active === CHAT;
  const selectTab = tabs?.select;
  const pendingTranscriptFocus = useRef(false);
  useEffect(() => {
    if (!id || !focusTranscript) return;
    pendingTranscriptFocus.current = true;
    selectTab?.(CHAT);
    transcriptOpened?.(id);
  }, [id, focusTranscript, selectTab, transcriptOpened]);
  const snapshotReady = !!view;
  useEffect(() => {
    void focusTranscript;
    if (!pendingTranscriptFocus.current || !snapshotReady || !shown) return;
    heading.current?.focus();
    pendingTranscriptFocus.current = false;
  }, [focusTranscript, snapshotReady, shown]);
  // A request is taken once: it shows the Chat tab once and focuses the composer when it can.
  const pendingFocus = useRef(false);
  useEffect(() => {
    if (!composerFocusRequest || composerFocusRequest === lastComposerFocus.current) return;
    lastComposerFocus.current = composerFocusRequest;
    pendingFocus.current = true;
    composerFocused?.();
    if (!shown) tabs?.select(CHAT);
  }, [composerFocusRequest, composerFocused, shown, tabs]);
  useEffect(() => {
    void composerFocusRequest;
    if (!pendingFocus.current || !shown || !composerReady) return;
    const input = workspace.current?.querySelector<HTMLTextAreaElement>("#chat-message:not(:disabled)");
    if (input) {
      input.focus();
      pendingFocus.current = false;
    }
  }, [composerFocusRequest, composerReady, shown]);
  function closeSearch() {
    setSearching(false);
    setSearch("");
    workspace.current?.querySelector<HTMLElement>("[data-transcript]")?.focus();
  }
  const stopDialog = useRef<HTMLDialogElement>(null);
  const stopOrigin = useRef<HTMLElement | null>(null);
  async function send(text: string, images?: string[]) {
    if (
      !id ||
      (!text.trim() && !images?.length) ||
      pending ||
      readOnly ||
      view?.state.status === "awaiting_approval"
    )
      return false;
    setPending(true);
    setFailure(undefined);
    try {
      await api.invoke("session.send", { sessionId: id, text, ...(images?.length && { images }) });
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
      if (!shown) return;
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
  }, [bindings, view?.state.activeTurnId, readOnly, pending, shown]);
  useEffect(() => {
    if (searching) searchInput.current?.focus();
  }, [searching]);
  if (!id) return <p>{t("chat.select")}</p>;
  return (
    <section ref={workspace} className="session-workspace" aria-label={t("chat.conversation")}>
      {readOnly && <p role="status">{t("documents.readOnly")}</p>}
      <header className="session-heading">
        <h2 ref={heading} tabIndex={-1}>
          {view?.state.title || t("chat.untitled")}
        </h2>
      </header>
      {view && shown && browserEnabled && !readOnly && !archived && (
        <BrowserControls
          key={`browser/${workbenchId}/${id}`}
          sessionId={id}
          workbenchId={workbenchId}
          stop={() => void stop()}
          stopPending={pending}
          turnActive={!!view.state.activeTurnId}
        />
      )}
      {selectLinkedSession && (
        <DelegationLinks
          parent={delegationParent}
          child={delegation}
          sessions={delegationChildren}
          open={selectLinkedSession}
        />
      )}
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
                    view?.state.items.filter((item) => searchMatch(item, search.toLocaleLowerCase()))
                      .length ?? 0,
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
          workbenchId={workbenchId}
          detail={detail}
          state={view.state}
          reasoning={view.reasoning}
          updates={view.updates}
          retry={() => {
            const last = [...view.state.items].reverse().find((i) => i.kind === "user");
            if (last?.kind === "user") void send(last.text, last.images);
          }}
          search={search}
          sessionId={id}
          disabled={readOnly || archived}
        />
      )}
      {failure !== undefined && <ErrorMessage error={failure} />}
      {view && (
        <Composer
          key={`${workbenchId}/${id}`}
          sessionId={id}
          dictationMode={dictationMode}
          chatVisible={shown}
          workbenchId={workbenchId}
          state={view.state}
          inspectorControls={<ContextIndicator state={view.state} open={() => setInspector(true)} />}
          disabled={readOnly || pending}
          archived={archived}
          permissionLocked={!!delegation}
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
      {view && inspector && <SessionInspector state={view.state} close={() => setInspector(false)} />}

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
