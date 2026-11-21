// REQ-UX-4bea0001 REQ-REL-4bea0006 REQ-REL-4bea0004 REQ-UX-f20cb322

import {
  type ChatDetail,
  type DictationRecordingMode,
  type SessionSummary,
  veraErrorSchema,
} from "@vera/shared";
import { useContext, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionView } from "../../hooks/session-view.js";
import { useTurnCapacity } from "../../hooks/use-turn-capacity.js";
import { globalShortcutBlocked, ShortcutContext, shortcutCommand } from "../../lib/shortcuts.js";
import { CHAT, useDocumentTabs } from "../documents/viewer-context.js";
import { ErrorMessage } from "../error-message.js";
import { BrowserControls } from "./browser-controls.js";
import { Composer, type ComposerState } from "./composer.js";
import { DelegatedBypassControl } from "./delegated-bypass-control.js";
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
  delegatedBypassLaunch,
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
  delegatedBypassLaunch?: boolean | undefined;
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
  const { view, error, retry } = useSessionView(id, changed, workbenchId);
  const [failure, setFailure] = useState<unknown>();
  const turns = useTurnCapacity();
  // A send refused at the turn limit shows the limit until capacity frees, then that a turn can start.
  const turnSlotFree =
    veraErrorSchema.safeParse(failure).data?.code === "TURN_LIMIT" &&
    !!turns.capacity &&
    turns.capacity.active < turns.capacity.limit;
  const [pending, setPending] = useState(false);
  const [feedbackRestored, setFeedbackRestored] = useState(false);
  const restoring = useRef(false);
  const scopeGeneration = useRef(0);
  useEffect(() => {
    void id;
    void workbenchId; // Also invalidate coincident session IDs in a replacement workbench.
    scopeGeneration.current++;
    restoring.current = false;
    setPending(false);
    setFailure(undefined);
    setFeedbackRestored(false);
    return () => {
      scopeGeneration.current++;
    };
  }, [id, workbenchId]);
  const [search, setSearch] = useState("");
  const [searching, setSearching] = useState(false);
  const [inspector, setInspector] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const workspace = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const lastComposerFocus = useRef(0);
  const composerView = useRef<
    { id: string; workbenchId: string; state: ComposerState; reviewing: boolean } | undefined
  >(undefined);
  if (view && id) {
    const { mode, modelRef, status, activeTurnId, reasoning } = view.state;
    // Retain control metadata, never disclosed history, while a privacy refresh hides the view.
    composerView.current = {
      id,
      workbenchId,
      state: { mode, modelRef, status, activeTurnId, reasoning },
      reviewing: view.state.planReviews.some((review) => review.turnId === activeTurnId),
    };
  }
  const controls =
    composerView.current?.id === id && composerView.current?.workbenchId === workbenchId
      ? composerView.current
      : undefined;
  const activeReview = controls?.reviewing ?? false;
  const activeTurnId = controls?.state.activeTurnId;
  const composerReady = !!view && !readOnly && !pending && !activeReview;
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
      !view ||
      (!text.trim() && !images?.length) ||
      pending ||
      restoring.current ||
      readOnly ||
      activeReview ||
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
      // At the Concurrent turns limit the message stays unsent in the composer (REQ-UX-f20cb322).
      const refusal = veraErrorSchema.safeParse(e);
      if (refusal.success && refusal.data.code === "TURN_LIMIT")
        turns.refused(Number(refusal.data.params?.limit) || 1);
      setFailure(e);
      return false;
    } finally {
      setPending(false);
    }
  }
  async function retryRequest() {
    if (!id || !view || pending || restoring.current || readOnly || archived || activeReview) return;
    const last = view.state.items.findLast((item) => item.kind === "user");
    if (last?.kind !== "user") return;
    if (!last.reviewId) {
      void send(last.text, last.images);
      return;
    }
    const generation = scopeGeneration.current;
    restoring.current = true;
    setPending(true);
    setFailure(undefined);
    setFeedbackRestored(false);
    try {
      await api.invoke("session.plan.review.restore", {
        workbenchId,
        sessionId: id,
        expectedFeedbackRevision: view.state.planFeedbackRevision,
        reviewId: last.reviewId,
      });
      if (generation !== scopeGeneration.current) return;
      retry();
      changed();
      setFeedbackRestored(true);
    } catch (error) {
      if (generation !== scopeGeneration.current) return;
      setFailure(error);
      if (veraErrorSchema.safeParse(error).data?.code === "CONFLICT") retry();
    } finally {
      if (generation === scopeGeneration.current) {
        restoring.current = false;
        setPending(false);
      }
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
        activeTurnId &&
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
  }, [bindings, activeTurnId, readOnly, pending, shown]);
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
        {id &&
          view &&
          !delegation &&
          !readOnly &&
          !archived &&
          (view.state.mode === "bypass" || delegatedBypassLaunch) && (
            <DelegatedBypassControl
              key={id}
              sessionId={id}
              workbenchId={workbenchId}
              authorized={delegatedBypassLaunch === true}
              changed={changed}
            />
          )}
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
          retry={() => void retryRequest()}
          search={search}
          sessionId={id}
          disabled={readOnly || archived}
        />
      )}
      {failure !== undefined && !turnSlotFree && <ErrorMessage error={failure} />}
      {turnSlotFree && (
        <p role="status" data-i18n="chat.turnSlotFree">
          {t("chat.turnSlotFree")}
        </p>
      )}
      {feedbackRestored && <p role="status">{t("plan.feedbackRestored")}</p>}
      {controls && (
        <Composer
          key={`${workbenchId}/${id}`}
          sessionId={id}
          dictationMode={dictationMode}
          chatVisible={shown}
          workbenchId={workbenchId}
          state={controls.state}
          inspectorControls={
            view ? <ContextIndicator state={view.state} open={() => setInspector(true)} /> : undefined
          }
          disabled={readOnly || pending}
          sendDisabled={!view || activeReview}
          archived={archived}
          send={send}
          stop={() => void stop()}
          setMode={async (mode) => {
            setPending(true);
            setFailure(undefined);
            try {
              await api.invoke("session.mode.set", {
                sessionId: id,
                mode,
                ...(mode === "bypass" && { acknowledged: true as const }),
              });
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
