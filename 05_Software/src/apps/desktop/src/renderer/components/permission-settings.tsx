import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

const policyKey = ["app.settings.delegatedFullAccess"];

export function PermissionSettings({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const policy = useQuery({
    queryKey: policyKey,
    queryFn: () => api.invoke("app.settings.delegatedFullAccess.get", {}),
  });
  const enabled = policy.data?.enabled === true;
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const toggle = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const warning = useId();
  useEffect(() => {
    if (!confirming) return;
    const node = dialog.current;
    node?.showModal();
    node?.querySelector("button")?.focus();
    return () => {
      node?.close();
      toggle.current?.focus();
    };
  }, [confirming]);

  async function save(enable: boolean) {
    setPending(true);
    setError(undefined);
    try {
      const confirmed = await api.invoke(
        "app.settings.delegatedFullAccess.set",
        enable ? { enabled: true, acknowledged: true } : { enabled: false },
      );
      await client.cancelQueries({ queryKey: policyKey });
      client.setQueryData(policyKey, confirmed);
      setConfirming(false);
    } catch (cause) {
      setError(cause);
    } finally {
      setPending(false);
    }
  }

  function cancel() {
    setConfirming(false);
    setError(undefined);
  }

  return (
    <section className="surface" data-settings-section="permissions">
      <h2 tabIndex={-1}>{t("settings.permissions")}</h2>
      <label className="flex items-center gap-2">
        <input
          id="delegated-full-access"
          ref={toggle}
          type="checkbox"
          role="switch"
          checked={enabled}
          aria-checked={enabled}
          disabled={disabled || pending || !policy.data}
          onChange={(event) => {
            if (event.currentTarget.checked) setConfirming(true);
            else void save(false);
          }}
        />
        {t("settings.delegatedFullAccess")}
      </label>
      {policy.isError && (
        <>
          <ErrorMessage error={policy.error} />
          <button type="button" onClick={() => void policy.refetch()}>
            {t("settings.retry")}
          </button>
        </>
      )}
      {!confirming && error !== undefined && <ErrorMessage error={error} />}
      {confirming && (
        <dialog
          ref={dialog}
          className="pinned-dialog"
          aria-labelledby={title}
          aria-describedby={warning}
          onCancel={(event) => {
            event.preventDefault();
            if (!pending) cancel();
          }}
        >
          <h3 id={title}>{t("settings.delegatedFullAccess")}</h3>
          <p id={warning}>{t("settings.delegatedFullAccessWarning")}</p>
          {error !== undefined && <ErrorMessage error={error} />}
          <footer className="workbench-actions">
            <button type="button" disabled={pending} onClick={cancel}>
              {t("workbench.cancel")}
            </button>
            <button type="button" className="primary" disabled={pending} onClick={() => void save(true)}>
              {t("settings.enableDelegatedFullAccess")}
            </button>
          </footer>
        </dialog>
      )}
    </section>
  );
}
