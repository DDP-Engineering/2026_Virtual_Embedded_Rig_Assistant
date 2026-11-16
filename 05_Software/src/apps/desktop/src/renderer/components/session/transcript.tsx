// REQ-UX-4bea0002 REQ-UX-4bea0005 REQ-UX-2bbfd052 REQ-REL-47308c01 REQ-REL-c8ac2ecc
import type { ChatDetail, SessionState } from "@vera/shared";
import {
  memo,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { DownloadCard } from "../documents/downloads.js";
import { useDocumentViewer } from "../documents/viewer-context.js";
import { ErrorMessage } from "../error-message.js";
import { HelpContext, helpCitationKey } from "../help.js";
import { ApprovalCard } from "./approval-card.js";
import { BookmarkButton } from "./bookmark-button.js";
import { argsText, ToolOutput } from "./bounded-text.js";
import { Disclosure } from "./disclosure.js";
import { Markdown } from "./markdown.js";
import { PromptUsage } from "./prompt-usage.js";
import { contentOffset, scrollTarget } from "./transcript-navigation.js";
import { type NavigatorMessage, TranscriptNavigator } from "./transcript-navigator.js";
import { searchMatch, streamingBlocks, type ToolItem, transcriptRows } from "./transcript-projection.js";
import { TranscriptScroll } from "./transcript-scroll.js";
import { useBookmarks } from "./use-bookmarks.js";

/** PERF-07: rows of the first commit, newest first; older rows are prepended in idle chunks. */
const INITIAL_ROWS = 40;
const CHUNK_ROWS = 100;
const IDLE_TIMEOUT_MS = 250;
/** Runs `callback` when the renderer is idle; returns the cancel function. */
function whenIdle(callback: () => void): () => void {
  // Chromium has requestIdleCallback on every platform; the timer serves test environments without it.
  if (typeof requestIdleCallback !== "function") {
    const timer = setTimeout(callback, 0);
    return () => clearTimeout(timer);
  }
  const handle = requestIdleCallback(callback, { timeout: IDLE_TIMEOUT_MS });
  return () => cancelIdleCallback(handle);
}
export function Transcript({
  state,
  reasoning,
  updates,
  retry,
  search,
  sessionId,
  disabled = false,
  detail = "normal",
}: {
  detail?: ChatDetail;
  state: SessionState;
  reasoning: Record<string, string>;
  updates: Record<string, string>;
  retry: () => void;
  search: string;
  sessionId?: string | undefined;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const bookmarks = useBookmarks(sessionId, state.bookmarkedMessageIds, disabled || !sessionId);
  const scroll = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const transcriptId = useId();
  const following = useRef(true);
  /** scrollTop of the last marker jump; auto-follow stays off until the user returns to the end elsewhere. */
  const suspended = useRef<number | null>(null);
  const [anchors] = useState(() => new Map<string, HTMLElement>());
  const [highlight, setHighlight] = useState<{ sessionId: string | undefined; id: string } | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const shownSession = useRef(sessionId);
  /** Scroll range at the last commit or scroll event. */
  const settledMax = useRef(0);
  /** Index of the oldest mounted row; null until the first rows arrive. */
  const [start, setStart] = useState<number | null>(null);
  /** The reader reached the top of the mounted rows: after mounting the rest, show the first message. */
  const toTop = useRef(false);
  // App keys the workspace by session, so this only guards a Transcript reused for another session.
  useLayoutEffect(() => {
    if (shownSession.current === sessionId) return;
    shownSession.current = sessionId;
    clearTimeout(highlightTimer.current);
    suspended.current = null;
    setHighlight(null);
    setStart(null);
  }, [sessionId]);
  const rows = useMemo(() => transcriptRows(state, detail), [state, detail]);
  // A search outlines matches in every row, so it mounts them all. Fewer rows (another chat detail)
  // still show the newest ones.
  const first = search
    ? 0
    : Math.min(start ?? Number.POSITIVE_INFINITY, Math.max(0, rows.length - INITIAL_ROWS));
  const shown = useMemo(() => (first ? rows.slice(first) : rows), [rows, first]);
  const hasRows = rows.length > 0;
  useEffect(() => {
    // Pin the window once rows exist, so rows that arrive later never unmount older ones.
    if (search || (start === null && hasRows)) {
      if (start !== first) setStart(first);
      return;
    }
    if (!start) return;
    // A transition keeps input and streaming responsive while a chunk renders.
    return whenIdle(() => startTransition(() => setStart(Math.max(0, first - CHUNK_ROWS))));
  }, [search, start, first, hasRows]);
  const shownFirst = useRef(first);
  // Runs only for commits that change the content (live events arrive at most once per frame), not
  // for highlight or search commits, so streaming forces no extra layout.
  useLayoutEffect(() => {
    void [state, reasoning, updates, detail];
    const node = scroll.current;
    if (!node) return;
    // Rows prepended above a reader who scrolled up keep their place by Chromium's scroll anchoring.
    const prepended = shownFirst.current !== first;
    shownFirst.current = first;
    if (toTop.current) {
      toTop.current = false;
      node.scrollTop = 0;
    } else if (
      // A scroll event is dispatched on the next frame, after this commit may have added content: a
      // position at the end of the previous range still follows, unless a marker jump suspended it.
      suspended.current === null &&
      (following.current || (!prepended && node.scrollTop >= settledMax.current - 80))
    ) {
      following.current = true;
      node.scrollTop = node.scrollHeight;
    }
    settledMax.current = node.scrollHeight - node.clientHeight;
  }, [state, reasoning, updates, detail, first]);
  useEffect(() => () => clearTimeout(highlightTimer.current), []);
  const navigate = (id: string) => {
    const node = scroll.current;
    const element = anchors.get(id);
    if (!node || !element?.isConnected) return false;
    following.current = false;
    node.scrollTop = scrollTarget(contentOffset(node)(element), node.scrollHeight, node.clientHeight);
    suspended.current = node.scrollTop;
    clearTimeout(highlightTimer.current);
    setHighlight({ sessionId, id });
    highlightTimer.current = setTimeout(() => setHighlight(null), 1500);
    return true;
  };
  // Stable for memoized rows: the workspace passes a new retry function on every render.
  const retryRef = useRef(retry);
  retryRef.current = retry;
  const onRetry = useCallback(() => retryRef.current(), []);
  const latestError = useMemo(() => state.items.findLast((i) => i.kind === "error")?.id, [state.items]);
  const userMessages = useMemo(() => {
    const messages = new Map<string, NavigatorMessage>();
    for (const item of state.items)
      if (item.kind === "user")
        messages.set(item.id, { id: item.id, text: item.text, pending: !!item.pending });
      else if (item.kind === "assistant" && item.text)
        for (const id of item.replyToMessageIds ?? []) {
          const user = messages.get(id);
          if (user && !user.pending && user.reply === undefined) user.reply = item.text;
        }
    return [...messages.values()];
  }, [state.items]);
  const approvalsByCall = useMemo(() => {
    const byCall = new Map<string, Approval[]>();
    for (const approval of state.approvals)
      byCall.set(approval.callId, [...(byCall.get(approval.callId) ?? []), approval]);
    return byCall;
  }, [state.approvals]);
  const needle = search.toLocaleLowerCase();
  // One label at most: only when the latest turn was stopped or interrupted.
  const latestTurn = state.turns.at(-1);
  const stopped =
    !state.activeTurnId &&
    latestTurn !== undefined &&
    (latestTurn.stopReason === "aborted" || state.interrupted.includes(latestTurn.turnId));
  return (
    <>
      {bookmarks.error !== undefined && <ErrorMessage error={bookmarks.error} />}
      <div className="transcript-frame" data-chat-detail={detail}>
        <TranscriptScroll viewport={scroll} content={content} controls={transcriptId} />
        <TranscriptNavigator
          key={sessionId ?? ""}
          viewport={scroll}
          content={content}
          anchors={anchors}
          messages={userMessages}
          live={!!state.activeTurnId}
          controls={transcriptId}
          onNavigate={navigate}
          bookmarked={bookmarks.has}
          bookmarkDisabled={(id) => disabled || !sessionId || bookmarks.busy(id)}
          onBookmark={bookmarks.toggle}
        />
        <div
          className="transcript"
          ref={scroll}
          id={transcriptId}
          data-transcript
          role="log"
          aria-label={t("chat.transcript")}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable transcript receives keyboard scrolling and a visible focus ring.
          tabIndex={0}
          onScroll={(e) => {
            const node = e.currentTarget;
            const atEnd = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
            settledMax.current = node.scrollHeight - node.clientHeight;
            // Within a screen of the oldest mounted row (scrolling, Home, the rail): mount the rest now,
            // as a transition so input stays responsive while it renders.
            if (first > 0 && !atEnd && node.scrollTop < node.clientHeight) {
              toTop.current = node.scrollTop < 1;
              startTransition(() => setStart(0));
            }
            if (suspended.current !== null && (!atEnd || Math.abs(node.scrollTop - suspended.current) < 2))
              return;
            suspended.current = null;
            following.current = atEnd;
          }}
        >
          <div className="transcript-content" ref={content}>
            {!state.items.length && <p className="muted">{t("chat.empty")}</p>}
            {detail === "verbose" &&
              Object.entries(reasoning).map(([id, text]) => (
                <Disclosure className="reasoning" key={id} title={t("chat.reasoning")}>
                  <pre>{text}</pre>
                </Disclosure>
              ))}
            {shown.map((row) => {
              if (row.kind === "group")
                return (
                  <ToolGroupRow
                    key={`group/${row.id}`}
                    tools={row.tools}
                    updates={updates}
                    sessionId={sessionId}
                  />
                );
              const item = row.item;
              const key = `${item.kind}/${item.id}`;
              if (item.kind === "tool")
                return (
                  <ToolRow
                    key={key}
                    item={item}
                    detail={detail}
                    update={updates[item.id]}
                    approvals={approvalsByCall.get(item.id) ?? NO_APPROVALS}
                    sessionId={sessionId}
                    disabled={disabled}
                  />
                );
              if (item.kind === "error")
                return (
                  <ErrorRow
                    key={key}
                    item={item}
                    canRetry={item.id === latestError && !state.activeTurnId && item.retryable}
                    retry={onRetry}
                  />
                );
              return (
                <MessageRow
                  key={key}
                  item={item}
                  match={searchMatch(item, needle)}
                  highlighted={
                    item.kind === "user" && highlight?.sessionId === sessionId && highlight?.id === item.id
                  }
                  sessionId={sessionId}
                  anchors={anchors}
                  detail={detail}
                  bookmarked={bookmarks.has(item.id)}
                  bookmarkDisabled={disabled || !sessionId || bookmarks.busy(item.id)}
                  onBookmark={bookmarks.toggle}
                />
              );
            })}
            {stopped && (
              <p className="muted" data-chat-stopped role="status">
                {t("chatDetail.stopped")}
              </p>
            )}
            {detail === "minimal" && state.activeTurnId && state.status === "running" && (
              <p className="muted" data-chat-working role="status">
                {t("chat.working")}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
type Item = SessionState["items"][number];
type Approval = SessionState["approvals"][number];
const NO_APPROVALS: Approval[] = [];
/*
 * Transcript rows are memoized on shallow props (PERF-03). With PERF-02 a live event gives a new
 * object only to the item it touches, so an unchanged row is skipped on every later render.
 */
const MessageRow = memo(function MessageRow({
  item,
  match,
  highlighted,
  sessionId,
  anchors,
  detail,
  bookmarked,
  bookmarkDisabled,
  onBookmark,
}: {
  item: Extract<Item, { kind: "user" | "assistant" }>;
  match: boolean;
  highlighted: boolean;
  sessionId: string | undefined;
  anchors: Map<string, HTMLElement>;
  detail: ChatDetail;
  bookmarked: boolean;
  bookmarkDisabled: boolean;
  onBookmark: (id: string, value: boolean) => void;
}) {
  const { t } = useTranslation();
  const openDocument = useDocumentViewer();
  const openHelp = useContext(HelpContext);
  const { kind, id } = item;
  const anchor = useCallback(
    (node: HTMLElement | null) => {
      if (!node) return;
      anchors.set(id, node);
      return () => {
        if (anchors.get(id) === node) anchors.delete(id);
      };
    },
    [anchors, id],
  );
  const onCitation = useMemo(
    () =>
      kind === "assistant" && sessionId
        ? (ref: string) => {
            // Help citations open the cited page in Help (REQ-UX-a318156e); others open the document viewer.
            const help = helpCitationKey(ref);
            if (help !== undefined && openHelp) openHelp(help);
            else openDocument?.({ sessionId, messageId: id, ref });
          }
        : undefined,
    [kind, id, sessionId, openDocument, openHelp],
  );
  return (
    <article
      ref={kind === "user" ? anchor : undefined}
      data-message-kind={kind}
      data-nav-highlight={highlighted ? "" : undefined}
      className={`transcript-item ${kind}`}
      data-search-match={match ? "true" : undefined}
    >
      {match && <span className="sr-only">{t("chat.searchMatch")}</span>}
      {item.kind === "user" ? (
        <>
          <strong>{t("chat.you")}</strong>
          <BookmarkButton
            bookmarked={bookmarked}
            disabled={bookmarkDisabled}
            onToggle={() => onBookmark(id, !bookmarked)}
          />
          {item.pending && (
            <span role="status" data-message-pending>
              {t("chat.pending")}
            </span>
          )}
          <Markdown text={item.text} />
          {/* Per-question statistics only at the Verbose detail level. */}
          {detail === "verbose" && item.usage && <PromptUsage usage={item.usage} />}
        </>
      ) : (
        <>
          <strong>VERA</strong>
          {item.streaming ? (
            // Only the growing last block is parsed again per frame; message.done renders it whole.
            streamingBlocks(item.text).map((block, index) => <Markdown key={String(index)} text={block} />)
          ) : (
            <Markdown text={item.text} citations={item.citations} onCitation={onCitation} />
          )}
          {item.streaming && <span role="status">{t("chat.streaming")}</span>}
        </>
      )}
    </article>
  );
});
const ToolRow = memo(function ToolRow({
  item,
  detail,
  update,
  approvals,
  sessionId,
  disabled,
}: {
  item: ToolItem;
  detail: ChatDetail;
  update: string | undefined;
  approvals: Approval[];
  sessionId: string | undefined;
  disabled: boolean;
}) {
  return (
    <article data-message-kind="tool" className="transcript-item tool">
      {(detail === "verbose" || item.status === "error") && (
        <ToolDetails item={item} update={update} sessionId={sessionId} />
      )}
      {item.name === "web_download" && item.status === "ok" && (
        <DownloadCard result={item.preview ?? item.summary ?? ""} />
      )}
      {approvals.map((approval) => (
        <ApprovalCard
          key={approval.approvalId}
          approval={approval}
          sessionId={sessionId}
          disabled={disabled}
        />
      ))}
    </article>
  );
});
const ErrorRow = memo(function ErrorRow({
  item,
  canRetry,
  retry,
}: {
  item: Extract<Item, { kind: "error" }>;
  canRetry: boolean;
  retry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <article data-message-kind="error" className="transcript-item error">
      <ErrorMessage error={{ code: item.code, messageKey: item.messageKey }} />
      {item.code === "CONTEXT_LIMIT" && <p role="alert">{t("chat.contextAdvice")}</p>}
      {canRetry && (
        <button type="button" onClick={retry}>
          {t("settings.retry")}
        </button>
      )}
    </article>
  );
});
/** A Normal-detail group of routine tools; its details mount only when opened. */
function ToolGroupRow({
  tools,
  updates,
  sessionId,
}: {
  tools: ToolItem[];
  updates: Record<string, string>;
  sessionId: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <div className="transcript-item tool" data-tool-group>
      <Disclosure
        title={
          <>
            {t("chatDetail.operations", { count: tools.length })}
            {tools.some((tool) => tool.status === "running")
              ? ` · ${t("chat.running")}`
              : ` · ${t("chat.toolOk")}`}
          </>
        }
      >
        {tools.map((item) => (
          <ToolDetails key={item.id} item={item} update={updates[item.id]} sessionId={sessionId} />
        ))}
      </Disclosure>
    </div>
  );
}
/** Shared by full tool rows and expandable Normal activity groups. */
const ToolDetails = memo(function ToolDetails({
  item,
  update,
  sessionId,
}: {
  item: ToolItem;
  update: string | undefined;
  sessionId: string | undefined;
}) {
  const { t } = useTranslation();
  return (
    <Disclosure
      tool={item.name}
      title={
        <>
          <span aria-hidden="true">⌕ </span>
          <strong>{item.name}</strong>{" "}
          <span>
            {item.status === "running"
              ? t("chat.running")
              : item.status === "ok"
                ? t("chat.toolOk")
                : t("chat.error")}
          </span>{" "}
          {item.name === "web_download" && item.status === "ok"
            ? t("downloads.saved")
            : (item.summary || argsText(item, false)).slice(0, 100)}{" "}
          {item.durationMs !== undefined && `${item.durationMs} ms`}
        </>
      }
    >
      <ToolOutput item={item} update={update} sessionId={sessionId} />
    </Disclosure>
  );
});
