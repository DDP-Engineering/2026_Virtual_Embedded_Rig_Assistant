// REQ-UX-4bea0002 REQ-UX-4bea0005
import type { SessionState } from "@vera/shared";
import { useLayoutEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useDocumentViewer } from "../documents/viewer-context.js";
import { ErrorMessage } from "../error-message.js";
import { ApprovalCard } from "./approval-card.js";
import { Disclosure } from "./disclosure.js";
import { Markdown } from "./markdown.js";

export function Transcript({
  state,
  reasoning,
  updates,
  retry,
  search,
  sessionId,
  disabled = false,
}: {
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
  const following = useRef(true);
  useLayoutEffect(() => {
    if (following.current && scroll.current) scroll.current.scrollTop = scroll.current.scrollHeight;
  });
  const latestError = [...state.items].reverse().find((i) => i.kind === "error")?.id;
  return (
    <div
      className="transcript"
      ref={scroll}
      data-transcript
      role="log"
      aria-label={t("chat.transcript")}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: Scrollable transcript receives keyboard scrolling and a visible focus ring.
      tabIndex={0}
      onScroll={(e) => {
        const node = e.currentTarget;
        following.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}
    >
      {!state.items.length && <p className="muted">{t("chat.empty")}</p>}
      {Object.entries(reasoning).map(([id, text]) => (
        <Disclosure className="reasoning" key={id} title={t("chat.reasoning")}>
          <pre>{text}</pre>
        </Disclosure>
      ))}
      {state.items.map((item) => (
        <article
          key={`${item.kind}/${item.id}`}
          data-message-kind={item.kind}
          className={`transcript-item ${item.kind}`}
          data-search-match={
            search &&
            (item.kind === "user" || item.kind === "assistant") &&
            item.text.toLocaleLowerCase().includes(search.toLocaleLowerCase())
              ? "true"
              : undefined
          }
        >
          {item.kind === "user" && (
            <>
              <strong>{t("chat.you")}</strong>
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
                  sessionId ? (ref) => openDocument?.({ sessionId, messageId: item.id, ref }) : undefined
                }
              />
              {item.streaming && <span role="status">{t("chat.streaming")}</span>}
            </>
          )}
          {item.kind === "tool" && (
            <>
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
                    {(item.summary || JSON.stringify(item.args)).slice(0, 100)}{" "}
                    {item.durationMs !== undefined && `${item.durationMs} ms`}
                  </>
                }
              >
                <h4>{t("chat.arguments")}</h4>
                <pre>{JSON.stringify(item.args, null, 2)}</pre>
                <h4>{t("chat.preview")}</h4>
                <pre>{item.preview ?? updates[item.id] ?? item.summary ?? t("chat.noPreview")}</pre>
              </Disclosure>
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
      ))}
    </div>
  );
}
