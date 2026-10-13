import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { SettingsPatch, UpdateChannel, UpdateMode, UpdateSnapshot } from "@vera/shared";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../api/index.js";
import { ErrorMessage } from "./error-message.js";

const updateKey = ["update"];
function useUpdates() {
  const client = useQueryClient();
  const state = useQuery({ queryKey: updateKey, queryFn: () => api.invoke("update.get", {}), retry: false });
  useEffect(
    () =>
      api.subscribe("app", (event) => {
        if (event.type === "update.changed") client.setQueryData(updateKey, event.snapshot);
      }),
    [client],
  );
  const action = useMutation({
    mutationFn: (run: () => Promise<UpdateSnapshot>) => run(),
    onSuccess: (value) => client.setQueryData(updateKey, value),
  });
  return { state, action };
}
export function UpdateBanner() {
  const { t } = useTranslation(),
    { state, action } = useUpdates();
  const phase = state.data?.phase;
  if (phase !== "ready" && phase !== "deferred") return null;
  return (
    <div className="update-banner" data-update-banner role="status">
      <span>{phase === "deferred" ? t("updates.deferred") : t("updates.ready")}</span>
      <button
        type="button"
        data-i18n="updates.restart"
        disabled={action.isPending || phase === "deferred"}
        onClick={() => action.mutate(() => api.invoke("update.restart", {}))}
      >
        {t("updates.restart")}
      </button>
      {action.isError && <ErrorMessage error={action.error} />}
    </div>
  );
}
function ReleaseConfirmation({
  version,
  link,
  pending,
  accept,
  cancel,
}: {
  version: string;
  link: string;
  pending: boolean;
  accept: () => void;
  cancel: () => void;
}) {
  const { t } = useTranslation(),
    ref = useRef<HTMLDialogElement>(null),
    title = useId();
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      className="pinned-dialog"
      ref={ref}
      aria-labelledby={title}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) cancel();
      }}
    >
      <h3 id={title}>{t("updates.confirmTitle", { version })}</h3>
      <p>{t("updates.confirmText")}</p>
      <p className="update-link">{link}</p>
      <div className="workbench-actions">
        <button type="button" disabled={pending} onClick={accept} data-i18n="updates.confirm">
          {t("updates.confirm")}
        </button>
        <button type="button" disabled={pending} onClick={cancel}>
          {t("updates.cancel")}
        </button>
      </div>
    </dialog>
  );
}
export function UpdatesPanel({
  preferences,
  disabled,
  update,
}: {
  preferences: { mode: UpdateMode; channel: UpdateChannel };
  disabled: boolean;
  update: (patch: SettingsPatch) => void;
}) {
  const { t } = useTranslation(),
    { state, action } = useUpdates();
  const [confirm, setConfirm] = useState(false);
  const snapshot = state.data,
    offer = snapshot?.offer;
  const labels = {
    idle: t("updates.idle"),
    checking: t("updates.checking"),
    current: t("updates.current"),
    available: t("updates.available", { version: offer?.version }),
    downloading: t("updates.downloading"),
    ready: t("updates.ready"),
    deferred: t("updates.deferred"),
    error: t("updates.failed"),
  };
  const errors = {
    NETWORK: t("updates.network"),
    INTEGRITY: t("updates.integrity"),
    UNCONFIGURED: t("updates.unconfigured"),
    INSTALL: t("updates.installFailed"),
  };
  const busy = action.isPending || snapshot?.phase === "checking" || snapshot?.phase === "downloading";
  return (
    <section className="surface" id="section-updates" data-settings-section="updates">
      <h2 tabIndex={-1}>{t("settings.updates")}</h2>
      <label htmlFor="update-mode">{t("updates.mode")}</label>
      <select
        id="update-mode"
        disabled={disabled}
        value={preferences.mode}
        onChange={(e) => update({ updates: { mode: e.target.value as UpdateMode } })}
      >
        <option value="off">{t("updates.off")}</option>
        <option value="notify">{t("updates.notify")}</option>
        <option value="download">{t("updates.automatic")}</option>
      </select>
      <label htmlFor="update-channel">{t("updates.channel")}</label>
      <select
        id="update-channel"
        disabled={disabled}
        value={preferences.channel}
        onChange={(e) => update({ updates: { channel: e.target.value as UpdateChannel } })}
      >
        <option value="latest">{t("updates.latest")}</option>
        <option value="beta">{t("updates.beta")}</option>
      </select>
      <p className="muted">{t("updates.schedule")}</p>
      {snapshot?.distribution === "portable" && <p>{t("updates.portable")}</p>}
      {snapshot?.distribution === "managed" && <p>{t("updates.managed")}</p>}
      <button
        type="button"
        data-i18n="updates.check"
        disabled={busy || !snapshot}
        onClick={() => action.mutate(() => api.invoke("update.check", {}))}
      >
        {t("updates.check")}
      </button>
      {state.isError && <ErrorMessage error={state.error} />}
      {action.isError && <ErrorMessage error={action.error} />}
      {snapshot && (
        <p role="status">{snapshot.errorCode ? errors[snapshot.errorCode] : labels[snapshot.phase]}</p>
      )}
      {snapshot?.phase === "downloading" && (
        <progress max={100} value={snapshot.progress ?? 0} aria-label={t("updates.downloading")} />
      )}
      {offer && (
        <>
          <h3>{t("updates.notes")}</h3>
          <pre className="update-notes">{offer.notes || t("updates.noNotes")}</pre>
          {snapshot?.distribution === "installed" && snapshot.phase === "available" && (
            <button
              type="button"
              disabled={busy}
              data-i18n="updates.download"
              onClick={() => action.mutate(() => api.invoke("update.download", { confirmed: true }))}
            >
              {t("updates.download")}
            </button>
          )}
          {snapshot?.distribution === "portable" && offer.link && (
            <button
              type="button"
              data-i18n="updates.openRelease"
              disabled={busy}
              onClick={() => setConfirm(true)}
            >
              {t("updates.openRelease")}
            </button>
          )}
          {confirm && snapshot?.distribution === "portable" && offer.link && (
            <ReleaseConfirmation
              version={offer.version}
              link={offer.link}
              pending={action.isPending}
              accept={() =>
                action.mutate(async () => {
                  const result = await api.invoke("update.openRelease", {
                    confirmed: true,
                    version: offer.version,
                  });
                  setConfirm(false);
                  return result;
                })
              }
              cancel={() => setConfirm(false)}
            />
          )}
        </>
      )}
    </section>
  );
}
