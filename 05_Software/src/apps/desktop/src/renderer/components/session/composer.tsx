// REQ-UX-4bea0003 REQ-REL-4bea0004
import { useQuery } from "@tanstack/react-query";
import { permissionModeSchema, type SessionState } from "@vera/shared";
import { ArrowUp, Square } from "lucide-react";
import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";

export function Composer({
  state,
  disabled,
  send,
  stop,
  setModel,
  setMode,
  inspectorControls,
}: {
  inspectorControls?: ReactNode;
  state: SessionState;
  disabled: boolean;
  send: (text: string) => Promise<boolean>;
  stop: () => void;
  setModel: (reference: string | null) => Promise<void>;
  setMode: (mode: SessionState["mode"]) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  const [token, setToken] = useState<{ start: number; end: number; query: string }>();
  const [matches, setMatches] = useState<string[]>([]);
  const [selected, setSelected] = useState(0);
  const [completionError, setCompletionError] = useState<unknown>();
  const input = useRef<HTMLTextAreaElement>(null);
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
  const locked = disabled || state.status === "awaiting_approval";
  const providers = useQuery({
    queryKey: ["providers.list"],
    queryFn: () => api.invoke("providers.list", {}),
  });
  const subscription = useQuery({
    queryKey: ["chatgpt.status"],
    queryFn: () => api.invoke("providers.chatgpt.status", {}),
    refetchInterval: 1000,
  });
  const subscriptionModels = useQuery({
    queryKey: ["chatgpt.models"],
    enabled: subscription.data?.connected === true,
    queryFn: () => api.invoke("providers.models", { id: "chatgpt" }),
  });
  const catalog = useQuery({
    queryKey: ["chat.models", providers.data],
    enabled: !!providers.data,
    queryFn: async () => {
      const ids = [
        ...(providers.data?.openai.configured ? ["openai" as const] : []),
        ...(providers.data?.custom.map((p) => p.id) ?? []),
      ];
      const results = await Promise.all(ids.map((id) => api.invoke("providers.models", { id })));
      return results.flatMap((c) => c.models);
    },
  });
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
    setText(value);
    setToken(undefined);
    setMatches([]);
    requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.setSelectionRange(caret, caret);
    });
  }
  async function submit() {
    if (locked || !text.trim() || submitting.current) return;
    submitting.current = true;
    const draft = text;
    try {
      if (await send(draft)) {
        setText((current) => (current === draft ? "" : current));
        setToken(undefined);
        input.current?.focus();
      }
    } finally {
      submitting.current = false;
    }
  }
  return (
    <div className="composer">
      <form
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
            setText(e.target.value);
            detect(e.target.value, e.target.selectionStart);
          }}
          onClick={(e) => detect(text, e.currentTarget.selectionStart)}
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
              {state.modelRef &&
                !catalog.data?.some((m) => m.reference === state.modelRef) &&
                !(
                  subscription.data?.connected &&
                  subscriptionModels.data?.models.some((m) => m.reference === state.modelRef)
                ) && <option value={state.modelRef}>{state.modelRef}</option>}
              {catalog.data?.map((m) => (
                <option key={m.reference} value={m.reference}>
                  {m.reference}
                </option>
              ))}
              {subscription.data?.connected &&
                subscriptionModels.data?.models.map((m) => (
                  <option key={m.reference} value={m.reference}>
                    {m.reference}
                  </option>
                ))}
            </select>
          </label>
          <label>
            <span className="sr-only">{t("approval.mode")}</span>
            <select
              aria-label={t("approval.mode")}
              value={state.mode}
              disabled={disabled}
              onChange={(e) => void setMode(permissionModeSchema.parse(e.target.value))}
            >
              <option value="read-only">{t("approval.readOnly")}</option>
              <option value="ask">{t("approval.ask")}</option>
              <option value="auto-edit">{t("approval.autoEdit")}</option>
            </select>
          </label>
          <div className="composer-tools">
            {inspectorControls}
            <button
              className="send-control"
              type="submit"
              data-action="send-message"
              disabled={locked || !text.trim()}
            >
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
      <p className="muted composer-hint">{running ? t("chat.working") : t("chat.enterHint")}</p>
    </div>
  );
}
