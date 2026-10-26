import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ConsentDialog } from "./consent-dialog.js";
import { ErrorMessage } from "./error-message.js";

export function Chatgpt({ disabled }: { disabled: boolean }) {
  const { t, i18n } = useTranslation();
  const client = useQueryClient();
  const status = useQuery({
    queryKey: ["chatgpt.status"],
    queryFn: () => api.invoke("providers.chatgpt.status", {}),
    refetchInterval: 1000,
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const [code, setCode] = useState("");
  const prefix = useId();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const state = status.data;
  useEffect(() => {
    // The prompt identity/state change invalidates the sensitive local draft.
    if (state?.state !== "manual" || state?.promptId) setCode("");
  }, [state?.promptId, state?.state]);
  useEffect(() => {
    if (state?.connected !== undefined) {
      void client.invalidateQueries({ queryKey: ["chatgpt.models"] });
      void client.invalidateQueries({ queryKey: ["app.settings"] });
    }
  }, [state?.connected, client]);
  async function run(operation: () => Promise<unknown>) {
    setPending(true);
    setError(undefined);
    try {
      await operation();
      await status.refetch();
    } catch (e) {
      if (alive.current) setError(e);
    } finally {
      if (alive.current) setPending(false);
    }
  }
  const busy = disabled || pending;
  const waiting = state?.state === "pending" || state?.state === "manual";
  return (
    <div data-provider="chatgpt" className="provider-card">
      <h3>{t("chatgpt.title")}</h3>
      <p className="muted">{t("chatgpt.description")}</p>
      {(error !== undefined || status.isError || state?.error) && (
        <ErrorMessage error={error ?? status.error ?? state?.error} />
      )}
      <p role="status">
        {state?.connected
          ? t("chatgpt.connected")
          : waiting
            ? t("chatgpt.waiting")
            : t("chatgpt.disconnected")}
      </p>
      {state?.expiresAt && (
        <p>
          {t("chatgpt.expires", {
            time: new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(
              new Date(state.expiresAt),
            ),
          })}
        </p>
      )}
      <div className="workbench-actions">
        {!waiting && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(() => api.invoke("providers.chatgpt.login", {}))}
          >
            {t("chatgpt.signIn")}
          </button>
        )}
        {waiting && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              setCode("");
              void run(() => api.invoke("providers.chatgpt.cancel", {}));
            }}
          >
            {t("providers.cancel")}
          </button>
        )}
        {state?.connected && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              setCode("");
              void run(() => api.invoke("providers.chatgpt.logout", {}));
            }}
          >
            {t("chatgpt.signOut")}
          </button>
        )}
        {status.isError && (
          <button type="button" onClick={() => void status.refetch()}>
            {t("settings.retry")}
          </button>
        )}
      </div>
      {state?.state === "manual" && (
        <form
          className="workbench-form"
          onSubmit={(e) => {
            e.preventDefault();
            const draft = code;
            setCode("");
            const promptId = state.promptId;
            if (promptId)
              void run(() => api.invoke("providers.chatgpt.login", { promptId, manualCode: draft }));
          }}
        >
          <label htmlFor={`${prefix}-code`}>{t("chatgpt.manual")}</label>
          <input
            id={`${prefix}-code`}
            type="password"
            autoComplete="off"
            spellCheck={false}
            maxLength={16384}
            value={code}
            disabled={busy}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" disabled={busy || !code.trim()}>
            {t("chatgpt.submit")}
          </button>
        </form>
      )}
      {state?.state === "consent-required" && (
        <ConsentDialog
          pending={pending}
          choice={(consent) => run(() => api.invoke("providers.chatgpt.login", { storageConsent: consent }))}
          cancel={() => void run(() => api.invoke("providers.chatgpt.cancel", {}))}
        />
      )}
    </div>
  );
}
