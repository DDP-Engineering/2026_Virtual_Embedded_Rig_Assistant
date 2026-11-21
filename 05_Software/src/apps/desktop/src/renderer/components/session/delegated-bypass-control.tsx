import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";

export function DelegatedBypassControl({
  sessionId,
  workbenchId,
  authorized,
  changed,
}: {
  sessionId: string;
  workbenchId: string;
  authorized: boolean;
  changed: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  const warning = useId();
  useEffect(() => {
    if (!confirming) return;
    const node = dialog.current;
    const opener = trigger.current;
    node?.showModal();
    node?.querySelector("button")?.focus();
    return () => {
      node?.close();
      opener?.focus();
    };
  }, [confirming]);

  async function save(allow: boolean) {
    setPending(true);
    setError(undefined);
    try {
      await api.invoke("session.delegation.bypass.set", {
        sessionId,
        workbenchId,
        authorized: allow,
        ...(allow && { acknowledged: true as const }),
      });
      setConfirming(false);
      changed();
    } catch (error) {
      setError(error);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        disabled={pending}
        onClick={() => {
          setError(undefined);
          if (authorized) void save(false);
          else setConfirming(true);
        }}
      >
        {authorized ? t("delegation.revokeBypass") : t("delegation.allowBypass")}
      </button>
      {!confirming && error !== undefined && <ErrorMessage error={error} />}
      {confirming && (
        <dialog
          ref={dialog}
          className="pinned-dialog"
          aria-labelledby={title}
          aria-describedby={warning}
          onCancel={(event) => {
            event.preventDefault();
            if (!pending) setConfirming(false);
          }}
        >
          <h3 id={title}>{t("delegation.allowBypass")}</h3>
          <p id={warning}>{t("delegation.bypassWarning")}</p>
          {error !== undefined && <ErrorMessage error={error} />}
          <footer className="workbench-actions">
            <button type="button" disabled={pending} onClick={() => setConfirming(false)}>
              {t("workbench.cancel")}
            </button>
            <button type="button" className="primary" disabled={pending} onClick={() => void save(true)}>
              {t("delegation.confirmBypass")}
            </button>
          </footer>
        </dialog>
      )}
    </>
  );
}
