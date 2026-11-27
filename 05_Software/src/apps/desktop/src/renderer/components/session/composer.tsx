// REQ-UX-4bea0003 REQ-REL-4bea0004 REQ-UX-f8ec3a43 REQ-FUNC-47287974
// REQ-UX-72b09d3a REQ-UX-c3961c76 REQ-UX-9427b929 REQ-FUNC-4436607c
import {
  COMPOSER_IMAGE_ACCEPT,
  type DictationRecordingMode,
  defaultDictationRecordingMode,
  rasterExtension,
  type SessionState,
  WORKBENCH_IMAGE_DRAG,
} from "@vera/shared";
import { ArrowUp, ImagePlus, Square, X } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { insertDictation } from "../../dictation/draft-insertion.js";
import { useComposerDictation } from "../../dictation/use-composer-dictation.js";
import { useAppAdvanced } from "../../hooks/app-advanced.js";
import { useImageModelWarning } from "../../hooks/image-model-warning.js";
import { withMentions } from "../../lib/attachments.js";
import { ErrorMessage } from "../error-message.js";
import { chatModelGroups, useModelCatalog } from "../model-catalog.js";
import { PermissionPicker } from "../permission-picker.js";
import { useAttachments } from "./attachments.js";
import { DictationButton, DictationStatus } from "./dictation-button.js";
import { ImageAttachmentChip } from "./image-attachment-chip.js";
import { ReasoningPicker } from "./reasoning-picker.js";

/**
 * Typed text per session, for the life of the window: the composer unmounts when the user opens another
 * session, Settings, Help or Plugins, and a long prompt must still be there on the way back.
 */
type Draft = { text: string; revision: number };
const drafts = new Map<string, Draft>();
const draftUpdates = new EventTarget();

export type ComposerState = Pick<SessionState, "mode" | "modelRef" | "status" | "activeTurnId" | "reasoning">;

export function Composer({
  state,
  disabled,
  draftDisabled = false,
  sendDisabled: sendingLocked = false,
  archived = false,
  send,
  stop,
  setModel,
  setMode,
  inspectorControls,
  dictationMode = defaultDictationRecordingMode,
  chatVisible = true,
  sessionId,
  workbenchId,
}: {
  inspectorControls?: ReactNode;
  dictationMode?: DictationRecordingMode | undefined;
  chatVisible?: boolean;
  sessionId?: string;
  workbenchId?: string;
  state: ComposerState;
  disabled: boolean;
  draftDisabled?: boolean;
  sendDisabled?: boolean;
  archived?: boolean;
  send: (text: string, images?: string[]) => Promise<boolean>;
  stop: () => void;
  setModel: (reference: string | null) => Promise<void>;
  setMode: (mode: SessionState["mode"]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const draftKey = sessionId && workbenchId ? `${workbenchId}/${sessionId}` : undefined;
  const draft = useRef((draftKey ? drafts.get(draftKey) : undefined) ?? { text: "", revision: 0 });
  const [text, setText] = useState(draft.current.text);
  const shownKey = useRef(draftKey);
  const updateDraft = useCallback((value: string) => {
    if (draft.current.text === value) return;
    draft.current = { text: value, revision: draft.current.revision + 1 };
    setText(value);
    if (!shownKey.current) return;
    if (value) drafts.set(shownKey.current, draft.current);
    else drafts.delete(shownKey.current);
    draftUpdates.dispatchEvent(new Event(shownKey.current));
  }, []);
  // A composer remounted during send must observe that draft's eventual acknowledgement.
  useLayoutEffect(() => {
    const sync = () => {
      const saved = draftKey ? drafts.get(draftKey) : undefined;
      if (shownKey.current === draftKey && (saved ? draft.current === saved : !draft.current.text)) return;
      shownKey.current = draftKey;
      draft.current = saved ?? { text: "", revision: draft.current.revision + 1 };
      setText(draft.current.text);
    };
    sync();
    if (!draftKey) return;
    draftUpdates.addEventListener(draftKey, sync);
    return () => draftUpdates.removeEventListener(draftKey, sync);
  }, [draftKey]);
  const [token, setToken] = useState<{ start: number; end: number; query: string }>();
  const [matches, setMatches] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [completionError, setCompletionError] = useState<unknown>();
  const [reasoningNotice, setReasoningNotice] = useState<HTMLDivElement | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const selection = useRef<{ revision: number; caret: number }>(undefined);
  useLayoutEffect(() => {
    const pending = selection.current;
    selection.current = undefined;
    if (pending && draft.current.revision === pending.revision && input.current?.value === text)
      input.current?.setSelectionRange(pending.caret, pending.caret);
  }, [text]);
  // Docs tree entries attached to this session's next message, sent as @path mentions.
  const attachments = useAttachments();
  const attached = sessionId ? (attachments?.list(sessionId) ?? []) : [];
  const imageDraft = sessionId && workbenchId ? attachments?.imageDraft?.(workbenchId, sessionId) : undefined;
  const images = imageDraft?.images ?? [];
  const maxImages = useAppAdvanced("imagesPerMessage");
  const tooManyImages = images.length > maxImages;
  useLayoutEffect(() => {
    const element = input.current;
    if (!element || element.value !== text) return;
    const resize = () => {
      element.style.height = "auto";
      element.style.height = `${element.scrollHeight}px`;
    };
    resize();
    let width = element.clientWidth;
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (element.clientWidth !== width) {
              width = element.clientWidth;
              resize();
            }
          });
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [text]);
  const running = !!state.activeTurnId;
  const submitting = useRef(false);
  const locked = disabled || archived || draftDisabled;
  const sendingBlocked = locked || sendingLocked || state.status === "awaiting_approval";
  // Reopening an editable session restores focus if the host temporarily disabled the composer.
  const refocus = useRef(false);
  useEffect(() => {
    if (locked || !refocus.current) return;
    refocus.current = false;
    if (!document.activeElement || document.activeElement === document.body) input.current?.focus();
  }, [locked]);
  const imageLocked = locked || archived || !sessionId || !workbenchId || !attachments?.addImages;
  const dictationEnabled = chatVisible && !locked && !archived;
  const readDraft = useCallback(
    () => ({ revision: draft.current.revision, caret: input.current?.selectionEnd ?? null }),
    [],
  );
  const insert = useCallback(
    (start: ReturnType<typeof readDraft>, transcript: string) => {
      const current = draft.current;
      const next = insertDictation(
        current.text,
        current.revision === start.revision ? start.caret : null,
        transcript,
      );
      if (next.text === current.text) return;
      selection.current = { revision: current.revision + 1, caret: next.caret };
      updateDraft(next.text);
      setToken(undefined);
      setMatches([]);
    },
    [updateDraft],
  );
  const dictation = useComposerDictation({
    sessionId,
    enabled: dictationEnabled,
    mode: dictationMode,
    readDraft,
    insert,
  });
  function addImages(files: readonly (File | string)[]) {
    if (!imageLocked && sessionId && workbenchId && !submitting.current)
      void attachments?.addImages?.(workbenchId, sessionId, files);
  }
  const { providers, subscription, subscriptionModels, catalog, models, connections } = useModelCatalog();
  const { imageModelPending, warnTextOnly } = useImageModelWarning(
    workbenchId,
    sessionId,
    state.modelRef,
    images.length > 0,
    [
      providers.dataUpdatedAt,
      catalog.dataUpdatedAt,
      subscription.dataUpdatedAt,
      subscriptionModels.dataUpdatedAt,
    ],
  );
  const sendDisabled =
    sendingBlocked ||
    imageDraft?.pending ||
    imageModelPending ||
    tooManyImages ||
    (!text.trim() && !attached.length && !images.length);
  useEffect(() => {
    let cancelled = false;
    setMatches([]);
    setCompletionError(undefined);
    setSelected(0);
    if (token && !locked)
      void api
        .invoke("workbench.files", { query: token.query })
        .then((paths) => {
          if (!cancelled) setMatches(paths);
        })
        .catch((e) => {
          if (!cancelled) setCompletionError(e);
        });
    return () => {
      cancelled = true;
    };
  }, [token, locked]);
  function detect(value: string, caret: number) {
    const match = /(?:^|\s)@([^\s@]*)$/.exec(value.slice(0, caret));
    setToken(
      match ? { start: caret - (match[1]?.length ?? 0) - 1, end: caret, query: match[1] ?? "" } : undefined,
    );
  }
  function choose(path: string) {
    if (!token) return;
    const value = `${text.slice(0, token.start)}${path} ${text.slice(token.end)}`;
    const caret = token.start + path.length + 1;
    updateDraft(value);
    setToken(undefined);
    setMatches([]);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  }
  async function submit() {
    if (sendDisabled || submitting.current) return;
    if (sessionId && workbenchId && attachments?.imageDraft?.(workbenchId, sessionId).pending) return;
    submitting.current = true;
    dictation.cancel();
    refocus.current = document.activeElement === input.current;
    const submitted = draft.current;
    const sent = [...attached];
    const sentImages = images.map(({ path }) => path);
    try {
      const message = withMentions(submitted.text, sent);
      if (await (sentImages.length ? send(message, sentImages) : send(message))) {
        if (draftKey && drafts.get(draftKey) === submitted) {
          drafts.delete(draftKey);
          draftUpdates.dispatchEvent(new Event(draftKey));
        } else if (!draftKey && draft.current === submitted) updateDraft("");
        if (sessionId && sent.length) attachments?.clear(sessionId, sent);
        if (sessionId && workbenchId && sentImages.length)
          attachments?.clearImages?.(workbenchId, sessionId, sentImages);
        setToken(undefined);
        input.current?.focus();
      }
    } finally {
      submitting.current = false;
      // Never disabled meanwhile, so focus was never lost.
      if (!input.current?.disabled) refocus.current = false;
    }
  }
  return (
    <div className="composer">
      {sessionId && (attached.length > 0 || images.length > 0) && (
        <ul className="composer-attachments" aria-label={t("chat.attachments")}>
          {images.map((image) => (
            <ImageAttachmentChip
              key={image.path}
              image={image}
              remove={() => {
                if (workbenchId) attachments?.clearImages?.(workbenchId, sessionId, [image.path]);
                input.current?.focus();
              }}
            />
          ))}
          {attached.map((path) => (
            <li key={path} className="attachment-chip" data-attachment={path} title={path}>
              <span>{path.split("/").at(-1)}</span>
              <button
                type="button"
                aria-label={t("chat.removeAttachment", { path })}
                onClick={() => {
                  attachments?.remove(sessionId, path);
                  // The chip and its button go away; focus stays in the composer.
                  input.current?.focus();
                }}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      {warnTextOnly && (
        <p className="composer-image-warning" role="status">
          {t("chat.imagesTextOnly")}
        </p>
      )}
      {imageDraft?.error !== undefined && <ErrorMessage error={imageDraft.error} />}
      {(tooManyImages || (imageDraft?.full && images.length >= maxImages)) && (
        <p role="alert">{t("chat.imagesLimit", { count: maxImages })}</p>
      )}
      <div ref={setReasoningNotice} className="composer-reasoning-notice" />
      <form
        onDragOver={(event) => {
          if (event.dataTransfer.types.some((type) => type === WORKBENCH_IMAGE_DRAG || type === "Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = imageLocked || imageDraft?.pending ? "none" : "copy";
          }
        }}
        onDrop={(event) => {
          if (event.dataTransfer.types.includes(WORKBENCH_IMAGE_DRAG)) {
            event.preventDefault();
            const path = event.dataTransfer.getData(WORKBENCH_IMAGE_DRAG);
            const owner = `${workbenchId}/`;
            if (workbenchId && path.startsWith(owner)) addImages([path.slice(owner.length)]);
            return;
          }
          const files = Array.from(event.dataTransfer.files);
          if (!files.length) return;
          event.preventDefault();
          addImages(files);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="sr-only" htmlFor="chat-message">
          {t("chat.message")}
        </label>
        <textarea
          id="chat-message"
          ref={input}
          rows={1}
          placeholder={t("chat.messagePlaceholder")}
          aria-label={t("chat.message")}
          aria-autocomplete="list"
          aria-controls={matches.length ? "path-completions" : undefined}
          aria-activedescendant={matches.length ? `path-option-${selected}` : undefined}
          value={text}
          disabled={locked}
          onChange={(e) => {
            updateDraft(e.target.value);
            detect(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => detect(text, e.currentTarget.selectionStart)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData.files).filter(
              (file) => file.type.startsWith("image/") || rasterExtension(file.name),
            );
            if (!files.length) return;
            event.preventDefault();
            addImages(files);
          }}
          onKeyUp={(e) => {
            if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key))
              detect(text, e.currentTarget.selectionStart);
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (matches.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
              e.preventDefault();
              setSelected((n) => (n + (e.key === "ArrowDown" ? 1 : matches.length - 1)) % matches.length);
            } else if (matches.length && (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey))) {
              e.preventDefault();
              const path = matches[selected];
              if (path) choose(path);
            } else if (e.key === "Escape" && token) {
              e.preventDefault();
              e.stopPropagation();
              setToken(undefined);
              setMatches([]);
            } else if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void submit();
            }
          }}
        />
        {matches.length > 0 && (
          <div id="path-completions" role="listbox" aria-label={t("chat.paths")} className="path-completions">
            {matches.map((path, index) => (
              <div
                id={`path-option-${index}`}
                role="option"
                aria-selected={selected === index}
                key={path}
                tabIndex={-1}
              >
                <button
                  type="button"
                  tabIndex={-1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(path)}
                >
                  {path}
                </button>
              </div>
            ))}
          </div>
        )}
        {completionError !== undefined && <ErrorMessage error={completionError} />}
        <div className="composer-controls">
          <label>
            <span className="sr-only">{t("chat.model")}</span>
            <select
              aria-label={t("chat.model")}
              data-model-picker
              disabled={locked || running}
              value={state.modelRef ?? ""}
              onChange={(e) => void setModel(e.target.value || null)}
            >
              <option value="">{t("chat.defaultModelShort")}</option>
              {state.modelRef && !models.some((m) => m.reference === state.modelRef) && (
                <option value={state.modelRef}>{state.modelRef}</option>
              )}
              {chatModelGroups(models, connections, t).map(({ id, label, options }) => (
                <optgroup key={id} label={label}>
                  {options.map(({ reference, label }) => (
                    <option key={reference} value={reference}>
                      {label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          {sessionId && (
            <ReasoningPicker
              sessionId={sessionId}
              state={state}
              disabled={disabled}
              catalogVersion={subscriptionModels.dataUpdatedAt + providers.dataUpdatedAt}
              noticeHost={reasoningNotice}
            />
          )}
          <PermissionPicker
            mode={state.mode}
            disabled={disabled}
            change={setMode}
            workbenchId={workbenchId}
          />
          <div className="composer-tools">
            {inspectorControls}
            {sessionId && (
              <DictationButton dictation={dictation} disabled={!dictationEnabled} mode={dictationMode} />
            )}
            {sessionId && workbenchId && attachments?.addImages && (
              <>
                <input
                  ref={picker}
                  type="file"
                  accept={COMPOSER_IMAGE_ACCEPT}
                  multiple
                  hidden
                  onChange={(event) => {
                    const files = Array.from(event.currentTarget.files ?? []);
                    event.currentTarget.value = "";
                    addImages(files);
                    input.current?.focus();
                  }}
                />
                <button
                  type="button"
                  disabled={imageLocked || imageDraft?.pending}
                  onClick={() => picker.current?.click()}
                  title={t("chat.attachImage")}
                  aria-label={t("chat.attachImage")}
                >
                  <ImagePlus aria-hidden="true" />
                </button>
              </>
            )}
            <button className="send-control" type="submit" data-action="send-message" disabled={sendDisabled}>
              <ArrowUp aria-hidden="true" />
              <span className="sr-only">{t("chat.send")}</span>
            </button>
            {running && (
              <button type="button" data-action="stop-session" disabled={disabled} onClick={stop}>
                <Square aria-hidden="true" />
                <span className="sr-only">{t("chat.stop")}</span>
              </button>
            )}
          </div>
        </div>
      </form>
      {(providers.isError || catalog.isError) && (
        <>
          <ErrorMessage error={providers.error ?? catalog.error} />
          <button
            type="button"
            onClick={() => {
              void providers.refetch();
              void catalog.refetch();
            }}
          >
            {t("settings.retry")}
          </button>
        </>
      )}
      <DictationStatus dictation={dictation} running={running} />
    </div>
  );
}
