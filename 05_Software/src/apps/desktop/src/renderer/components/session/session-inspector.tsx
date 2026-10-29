import type { SessionState } from "@vera/shared";
import { Bot, MessageSquare, Wrench, X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "../error-message.js";
import { ContextTab } from "./context-tab.js";
import { Disclosure } from "./disclosure.js";
import { Markdown } from "./markdown.js";
import { UsageMeter } from "./usage-meter.js";

export function ActivityLog({
  state,
  reasoning,
  updates,
}: {
  state: SessionState;
  reasoning: Record<string, string>;
  updates: Record<string, string>;
}) {
  const { t } = useTranslation();
  return (
    <div className="agent-activity" data-agent-activity>
      <p className="muted">{t("chat.activityInfo")}</p>
      {!state.items.length && <p>{t("chat.activityEmpty")}</p>}
      <ol>
        {state.items.map((item) => (
          <li key={`${item.kind}/${item.id}`} data-activity-kind={item.kind}>
            {item.kind === "user" && (
              <Disclosure
                title={
                  <>
                    <MessageSquare aria-hidden="true" />
                    {t("chat.activityPrompt")}
                    <span className="activity-preview">{item.text.slice(0, 100)}</span>
                  </>
                }
              >
                {item.pending && <p role="status">{t("chat.pending")}</p>}
                <pre>{item.text}</pre>
              </Disclosure>
            )}
            {item.kind === "assistant" && (
              <Disclosure
                title={
                  <>
                    <Bot aria-hidden="true" />
                    {t("chat.activityReply")}
                    <span className="activity-preview">{item.text.slice(0, 100)}</span>
                    {item.streaming && <span>{t("chat.streaming")}</span>}
                  </>
                }
              >
                <Markdown text={item.text} />
              </Disclosure>
            )}
            {item.kind === "tool" && (
              <Disclosure
                title={
                  <>
                    <Wrench aria-hidden="true" />
                    {item.name}
                    <span>
                      {item.status === "running"
                        ? t("chat.running")
                        : item.status === "ok"
                          ? t("chat.toolOk")
                          : t("chat.error")}
                    </span>
                  </>
                }
              >
                <h4>{t("chat.arguments")}</h4>
                <pre>{JSON.stringify(item.args, null, 2)}</pre>
                <h4>{t("chat.preview")}</h4>
                <pre>{item.preview ?? updates[item.id] ?? item.summary ?? t("chat.noPreview")}</pre>
                {item.durationMs !== undefined && <p>{item.durationMs} ms</p>}
              </Disclosure>
            )}
            {item.kind === "error" && (
              <ErrorMessage error={{ code: item.code, messageKey: item.messageKey }} />
            )}
          </li>
        ))}
      </ol>
      {Object.entries(reasoning).map(([id, text]) => (
        <Disclosure key={id} title={t("chat.reasoning")}>
          <pre>{text}</pre>
        </Disclosure>
      ))}
    </div>
  );
}

export function SessionInspector({
  mode,
  state,
  workbenchId,
  reasoning,
  updates,
  close,
}: {
  mode: "context" | "activity";
  state: SessionState;
  workbenchId: string;
  reasoning: Record<string, string>;
  updates: Record<string, string>;
  close: () => void;
}) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useEffect(() => {
    const origin = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    element?.showModal();
    return () => {
      element?.close();
      if (origin?.isConnected) origin.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog session-inspector"
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
    >
      <header>
        <h2 id={title}>{mode === "context" ? t("chat.contextWindow") : t("chat.activity")}</h2>
        <button type="button" aria-label={t("panel.close")} onClick={close}>
          <X aria-hidden="true" />
        </button>
      </header>
      <div className="session-inspector-body">
        {mode === "context" ? (
          <>
            <p className="muted">{t("chat.contextInfo")}</p>
            <UsageMeter state={state} />
            <ContextTab workbenchId={workbenchId} readOnly />
          </>
        ) : (
          <ActivityLog state={state} reasoning={reasoning} updates={updates} />
        )}
      </div>
      <footer>
        <button type="button" data-action="close-inspector" onClick={close}>
          {t("panel.close")}
        </button>
      </footer>
    </dialog>
  );
}
