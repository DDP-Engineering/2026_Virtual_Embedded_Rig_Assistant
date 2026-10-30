// REQ-UX-33b9d601 REQ-UX-bb147586
import { type UseQueryResult, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type PermissionMode, permissionModeSchema, type SettingsSnapshot } from "@vera/shared";
import { TriangleAlert, X } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

export function PermissionPicker({
  mode,
  disabled,
  change,
  label,
}: {
  mode: PermissionMode;
  disabled: boolean;
  change: (mode: PermissionMode) => void | Promise<void>;
  label?: string;
}) {
  const { t } = useTranslation();
  const [warning, setWarning] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const picker = useRef<HTMLSelectElement>(null);
  const alive = useRef(false);
  const preferences = useQuery({ queryKey: ["app.settings"], queryFn: () => api.getSettings() });
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  async function choose(next: PermissionMode) {
    if (disabled || pending) return;
    setPending(true);
    setError(undefined);
    try {
      await change(next);
      if (alive.current && next === "bypass" && preferences.data?.settings.suppressBypassWarning !== true)
        setWarning(true);
    } catch (failure) {
      if (alive.current) setError(failure);
    } finally {
      if (alive.current) setPending(false);
    }
  }
  return (
    <>
      <label className="permission-field">
        <span className={label ? undefined : "sr-only"}>{label ?? t("approval.mode")}</span>
        <select
          ref={picker}
          data-permission-picker
          aria-label={label ?? t("approval.mode")}
          className={mode === "bypass" ? "bypass-selected" : undefined}
          value={mode}
          disabled={disabled || pending}
          onChange={(event) => void choose(permissionModeSchema.parse(event.target.value))}
        >
          <option value="read-only">{t("approval.readOnly")}</option>
          <option value="ask">{t("approval.ask")}</option>
          <option value="auto-edit">{t("approval.autoEdit")}</option>
          <option value="bypass">⚠ {t("bypass.option")}</option>
        </select>
      </label>
      {error !== undefined && <ErrorMessage error={error} />}
      {warning &&
        createPortal(
          <BypassWarning
            opener={picker}
            preferences={preferences}
            close={() => {
              setWarning(false);
            }}
          />,
          document.body,
        )}
    </>
  );
}

function BypassWarning({
  opener,
  preferences,
  close,
}: {
  opener: RefObject<HTMLSelectElement | null>;
  preferences: UseQueryResult<SettingsSnapshot, Error>;
  close: () => void;
}) {
  const { t } = useTranslation();
  const client = useQueryClient();
  const title = useId(),
    description = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const [remember, setRemember] = useState(false);
  const save = useMutation({
    mutationFn: () => api.updateSettings({ suppressBypassWarning: true }),
    onSuccess: (snapshot) => client.setQueryData(["app.settings"], snapshot),
  });
  useEffect(() => {
    const node = dialog.current;
    node?.showModal();
    node?.querySelector<HTMLButtonElement>('[data-action="close-bypass-warning"]')?.focus();
    return () => {
      node?.close();
      if (opener.current?.isConnected) opener.current.focus();
    };
  }, [opener]);
  async function dismiss() {
    if (save.isPending) return;
    if (remember) {
      try {
        await save.mutateAsync();
      } catch {
        return;
      }
    }
    close();
  }
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog bypass-warning"
      aria-labelledby={title}
      aria-describedby={description}
      aria-busy={save.isPending}
      onCancel={(event) => {
        event.preventDefault();
        void dismiss();
      }}
    >
      <header>
        <h2 id={title}>
          <TriangleAlert aria-hidden="true" />
          {t("bypass.title")}
        </h2>
        <button
          type="button"
          data-action="dismiss-bypass-warning"
          aria-label={t("panel.close")}
          disabled={save.isPending}
          onClick={() => void dismiss()}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      <p id={description}>{t("bypass.warning")}</p>
      <label className="bypass-remember">
        <input
          type="checkbox"
          data-hide-bypass-warning
          checked={remember}
          disabled={!preferences.data || preferences.data.readOnly || save.isPending}
          onChange={(event) => setRemember(event.target.checked)}
        />
        <span>{t("bypass.dontShowAgain")}</span>
      </label>
      {preferences.isError && (
        <>
          <ErrorMessage error={preferences.error} />
          <button type="button" onClick={() => void preferences.refetch()}>
            {t("settings.retry")}
          </button>
        </>
      )}
      {save.isError && <ErrorMessage error={save.error} />}
      <footer>
        <button
          type="button"
          data-action="close-bypass-warning"
          disabled={save.isPending}
          onClick={() => void dismiss()}
        >
          {t("panel.close")}
        </button>
      </footer>
    </dialog>
  );
}
