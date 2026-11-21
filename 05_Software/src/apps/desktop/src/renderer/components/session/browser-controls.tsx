import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { browserFailureText } from "../../lib/browser-failure.js";
import { ErrorMessage } from "../error-message.js";
import "../browser-controls.css";

type Action = "grant" | "show" | "close";

export function BrowserControls({
  workbenchId,
  sessionId,
  turnActive,
  stop,
  stopPending,
}: {
  workbenchId: string;
  sessionId: string;
  turnActive: boolean;
  stop: () => void;
  stopPending: boolean;
}) {
  const { t } = useTranslation();
  const title = useId();
  const [origin, setOrigin] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const owner = { workbenchId, sessionId };
  const query = useQuery({
    queryKey: ["browser.session.get", workbenchId, sessionId],
    queryFn: () => api.invoke("browser.session.get", owner),
    refetchInterval: 500,
    refetchIntervalInBackground: true,
    gcTime: 0,
    retry: false,
    networkMode: "always",
  });

  // Invoke grants during the input event so preload can verify the live user gesture.
  async function act(action: Action) {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      if (action === "grant") {
        await api.invoke("browser.session.grant", { ...owner, origin });
        setOrigin("");
      } else {
        await api.invoke(action === "show" ? "browser.session.show" : "browser.session.close", owner);
      }
    } catch (failure) {
      setError(failure);
    } finally {
      await query.refetch();
      setPending(false);
    }
  }

  const state = query.error ? undefined : query.data;
  if (!state?.enabled && !query.error) return null;
  const actionError = error ?? query.error;
  const status = state?.busy
    ? t("browser.activity.busy")
    : state?.open
      ? t("browser.activity.open")
      : t("browser.activity.idle");

  return (
    <section className="chat-browser" aria-labelledby={title}>
      <div className="chat-browser-heading">
        <h3 id={title}>{t("browser.title")}</h3>
        <span role="status">{status}</span>
      </div>
      {state?.currentUrl && (
        <p className="chat-browser-location">
          <span>{t("browser.location")}</span>
          <bdi>{state.currentUrl}</bdi>
        </p>
      )}
      {state?.failure && (
        <p role="alert" data-browser-failure={state.failure}>
          {browserFailureText(t, state.failure)}
        </p>
      )}
      {actionError && <ErrorMessage error={actionError} />}
      {state?.canGrant && (
        <form className="chat-browser-grant" onSubmit={(event) => event.preventDefault()}>
          <label>
            {t("browser.origin")}
            <input
              value={origin}
              maxLength={4096}
              onChange={(event) => setOrigin(event.target.value)}
              autoComplete="off"
              spellCheck={false}
            />
          </label>
          <button
            type="submit"
            disabled={!origin.trim() || pending}
            onClick={(event) => {
              event.preventDefault();
              void act("grant");
            }}
          >
            {t("browser.grant")}
          </button>
        </form>
      )}
      {state && state.origins.length > 0 && (
        <ul aria-label={t("browser.origins")}>
          {state.origins.map((value) => (
            <li key={value}>
              <bdi>{value}</bdi>
            </li>
          ))}
        </ul>
      )}
      <div className="workbench-actions">
        {state?.currentUrl && (
          <button type="button" disabled={pending} onClick={() => void act("show")}>
            {t("browser.show")}
          </button>
        )}
        {turnActive && (state?.busy || state?.open) && (
          <button type="button" disabled={stopPending} onClick={stop}>
            {t("browser.stop")}
          </button>
        )}
        {!!state?.origins.length && (
          <button type="button" disabled={pending} onClick={() => void act("close")}>
            {t("browser.revoke")}
          </button>
        )}
        {state?.open && (
          <button type="button" disabled={pending} onClick={() => void act("close")}>
            {t("browser.close")}
          </button>
        )}
      </div>
    </section>
  );
}
