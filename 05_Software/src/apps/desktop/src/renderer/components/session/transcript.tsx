// REQ-UX-4bea0002 REQ-UX-4bea0005 REQ-UX-2bbfd052 REQ-REL-47308c01 REQ-REL-c8ac2ecc
import type { ChatDetail, SessionState } from "@vera/shared";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { DownloadCard } from "../documents/downloads.js";
import { useDocumentViewer } from "../documents/viewer-context.js";
import { ErrorMessage } from "../error-message.js";
import { ApprovalCard } from "./approval-card.js";
import { Disclosure } from "./disclosure.js";
import { Markdown } from "./markdown.js";
import { contentOffset, scrollTarget } from "./transcript-navigation.js";
import { type NavigatorMessage, TranscriptNavigator } from "./transcript-navigator.js";
import { type ToolItem, transcriptRows } from "./transcript-projection.js";
import { TranscriptScroll } from "./transcript-scroll.js";
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
  const openDocument = useDocumentViewer();
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
  // App keys the workspace by session, so this only guards a Transcript reused for another session.
  useLayoutEffect(() => {
    if (shownSession.current === sessionId) return;
    shownSession.current = sessionId;
    clearTimeout(highlightTimer.current);
    suspended.current = null;
    setHighlight(null);
  }, [sessionId]);
  useLayoutEffect(() => {
    const node = scroll.current;
    if (!node) return;
    // A scroll event is dispatched on the next frame, after this commit may have added content: a
    // position at the end of the previous range still follows, unless a marker jump suspended it.
    if (suspended.current === null && (following.current || node.scrollTop >= settledMax.current - 80)) {
      following.current = true;
      node.scrollTop = node.scrollHeight;
    }
    settledMax.current = node.scrollHeight - node.clientHeight;
  });
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
  const latestError = [...state.items].reverse().find((i) => i.kind === "error")?.id;
  const rows = transcriptRows(state, detail);
  const userMessages = rows.flatMap((row): NavigatorMessage[] =>
    row.kind !== "group" && row.item.kind === "user"
      ? [{ id: row.item.id, text: row.item.text, pending: !!row.item.pending }]
      : [],
  );
  const stopped = new Set([
    ...state.interrupted,
    ...state.turns.filter((turn) => turn.stopReason === "aborted").map((turn) => turn.turnId),
  ]);
  return (
    <div className="transcript-frame" data-chat-detail={detail}>
      <TranscriptScroll viewport={scroll} content={content} controls={transcriptId} />
      <TranscriptNavigator
        key={sessionId ?? ""}
        viewport={scroll}
        content={content}
        anchors={anchors}
        messages={userMessages}
        controls={transcriptId}
        onNavigate={navigate}
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
          {rows.map((row) => {
            if (row.kind === "group")
              return (
                <div key={`group/${row.id}`} className="transcript-item tool" data-tool-group>
                  <Disclosure
                    title={
                      <>
                        {t("chatDetail.operations", { count: row.tools.length })}
                        {row.tools.some((tool) => tool.status === "running")
                          ? ` · ${t("chat.running")}`
                          : ` · ${t("chat.toolOk")}`}
                      </>
                    }
                  >
                    {row.tools.map((item) => (
                      <ToolDetails key={item.id} item={item} updates={updates} />
                    ))}
                  </Disclosure>
                </div>
              );
            const item = row.item;
            return (
              <article
                key={`${item.kind}/${item.id}`}
                ref={
                  item.kind === "user"
                    ? (node) => {
                        if (!node) return;
                        anchors.set(item.id, node);
                        return () => {
                          if (anchors.get(item.id) === node) anchors.delete(item.id);
                        };
                      }
                    : undefined
                }
                data-message-kind={item.kind}
                data-nav-highlight={
                  highlight?.sessionId === sessionId && highlight?.id === item.id && item.kind === "user"
                    ? ""
                    : undefined
                }
                className={`transcript-item ${item.kind}`}
                data-search-match={
                  search &&
                  (item.kind === "user" || item.kind === "assistant") &&
                  item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())
                    ? "true"
                    : undefined
                }
              >
                {search &&
                  (item.kind === "user" || item.kind === "assistant") &&
                  item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase()) && (
                    <span className="sr-only">{t("chat.searchMatch")}</span>
                  )}
                {item.kind === "user" && (
                  <>
                    <strong>{t("chat.you")}</strong>
                    {item.pending && (
                      <span role="status" data-message-pending>
                        {t("chat.pending")}
                      </span>
                    )}
                    <Markdown text={item.text} />
                  </>
                )}
                {item.kind === "assistant" && (
                  <>
                    <strong>VERA</strong>
                    <Markdown
                      text={item.text}
                      citations={item.citations}
                      onCitation={
                        sessionId
                          ? (ref) => openDocument?.({ sessionId, messageId: item.id, ref })
                          : undefined
                      }
                    />
                    {item.streaming && <span role="status">{t("chat.streaming")}</span>}
                  </>
                )}
                {item.kind === "tool" && (
                  <>
                    {(detail === "verbose" || item.status === "error") && (
                      <ToolDetails item={item} updates={updates} />
                    )}
                    {item.name === "web_download" && item.status === "ok" && (
                      <DownloadCard result={item.preview ?? item.summary ?? ""} />
                    )}
                    {state.approvals
                      .filter((a) => a.callId === item.id)
                      .map((approval) => (
                        <ApprovalCard
                          key={approval.approvalId}
                          approval={approval}
                          sessionId={sessionId}
                          disabled={disabled}
                        />
                      ))}
                  </>
                )}
                {item.kind === "error" && (
                  <>
                    <ErrorMessage error={{ code: item.code, messageKey: item.messageKey }} />
                    {item.code === "CONTEXT_LIMIT" && <p role="alert">{t("chat.contextAdvice")}</p>}
                    {item.id === latestError && !state.activeTurnId && item.retryable && (
                      <button type="button" onClick={retry}>
                        {t("settings.retry")}
                      </button>
                    )}
                  </>
                )}
              </article>
            );
          })}
          {Array.from(stopped).map((id) => (
            <p key={id} className="muted" data-chat-stopped role="status">
              {t("chatDetail.stopped")}
            </p>
          ))}
          {detail === "minimal" && state.activeTurnId && state.status === "running" && (
            <p className="muted" data-chat-working role="status">
              {t("chat.working")}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
/** Shared by full tool rows and expandable Normal activity groups. */
function ToolDetails({ item, updates }: { item: ToolItem; updates: Record<string, string> }) {
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
            : (item.summary || JSON.stringify(item.args)).slice(0, 100)}{" "}
          {item.durationMs !== undefined && `${item.durationMs} ms`}
        </>
      }
    >
      <h4>{t("chat.arguments")}</h4>
      <pre>{JSON.stringify(item.args, null, 2)}</pre>
      <h4>{t("chat.preview")}</h4>
      <pre>{item.preview ?? updates[item.id] ?? item.summary ?? t("chat.noPreview")}</pre>
    </Disclosure>
  );
}
