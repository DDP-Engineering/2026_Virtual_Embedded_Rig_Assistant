// REQ-UX-fcd1ad10 REQ-UX-9ea9184f REQ-DATA-96ef3dd6 REQ-UX-8663749f
import { useQuery } from "@tanstack/react-query";
import {
  type AdvancedKey,
  advancedDraftValid,
  advancedEditPatch,
  advancedKeys,
  advancedSettings,
  resolveAdvanced,
} from "@vera/shared";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { useSessionView } from "../../hooks/session-view.js";
import { useSettingsSnapshot } from "../../hooks/use-preferences.js";
import { AdvancedField, advancedFieldValue } from "../advanced-field.js";
import { ErrorMessage } from "../error-message.js";

/** The session's Advanced values over the workbench and application ones, recorded only on Save. */
export function SessionAdvancedDialog({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const dialog = useRef<HTMLDialogElement>(null);
  const { view } = useSessionView(sessionId);
  const app = useSettingsSnapshot().data?.settings.advanced;
  const workbench = useQuery({
    queryKey: ["workbench.active"],
    queryFn: () => api.invoke("workbench.config.get", {}),
  }).data?.config.advanced;
  const saved = view?.state.advanced ?? {};
  const [draft, setDraft] = useState<Record<string, unknown> | undefined>();
  const values = draft ?? saved;
  const patch = advancedEditPatch(saved, values, "session");
  const [error, setError] = useState<unknown>();
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    dialog.current?.showModal();
  }, []);
  const keys = advancedKeys.filter((key) =>
    (advancedSettings[key].scopes as readonly string[]).includes("session"),
  );
  // Archived sessions and read-only workbenches refuse a change (DENIED), shown as an error.
  const locked = !view || saving;
  const dirty = Object.keys(patch).length > 0;
  const state = view?.state;
  // Compact now waits for the turn and any summary in progress (REQ-UX-692b8471).
  const running =
    !state ||
    state.activeTurnId !== null ||
    state.status === "running" ||
    state.status === "awaiting_approval" ||
    state.usage.compactionStatus === "running";
  const [compacting, setCompacting] = useState(false);
  const [compacted, setCompacted] = useState<"none" | "completed" | "unavailable" | "failed">();
  const outcomes = {
    none: t("advanced.compacted.none"),
    completed: t("advanced.compacted.completed"),
    unavailable: t("advanced.compacted.unavailable"),
    failed: t("advanced.compacted.failed"),
  };
  const compact = async () => {
    setError(undefined);
    setCompacted(undefined);
    setCompacting(true);
    try {
      setCompacted((await api.invoke("session.compact", { sessionId })).status);
    } catch (failure) {
      setError(failure);
    } finally {
      setCompacting(false);
    }
  };
  const save = async () => {
    setError(undefined);
    setSaving(true);
    try {
      for (const [key, value] of Object.entries(patch))
        await api.invoke("session.advanced.set", { sessionId, key, value: value ?? null });
      onClose();
    } catch (failure) {
      setError(failure);
    } finally {
      setSaving(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="pinned-dialog session-advanced"
      aria-labelledby="session-advanced-title"
      data-session-advanced
      onCancel={(event) => {
        event.preventDefault();
        // A save in progress finishes first: closing then would still record the remaining keys.
        if (!saving) onClose();
      }}
    >
      <h3 id="session-advanced-title">{t("advanced.sessionTitle")}</h3>
      <div className="session-compact">
        <button
          type="button"
          data-action="compact-session"
          title={t("advanced.compactAbout")}
          disabled={locked || running || compacting}
          onClick={() => void compact()}
        >
          {t("advanced.compactNow")}
        </button>
        {compacting ? (
          <span role="status">{t("advanced.compacting")}</span>
        ) : (
          compacted && (
            <span role="status" data-compact-status={compacted}>
              {outcomes[compacted]}
            </span>
          )
        )}
      </div>
      {keys.map((key: AdvancedKey) => {
        const inherited = resolveAdvanced(key, { workbench, app });
        return (
          <AdvancedField
            key={key}
            setting={key}
            value={advancedFieldValue(key, values[key])}
            inherited={{ value: inherited.value, source: inherited.source }}
            disabled={locked || compacting}
            onChange={(next) =>
              setDraft((current) => {
                const updated: Record<string, unknown> = { ...(current ?? saved) };
                if (next === null) delete updated[key];
                else updated[key] = next;
                return updated;
              })
            }
          />
        );
      })}
      {error !== undefined && <ErrorMessage error={error} />}
      <div className="workbench-actions">
        <button type="button" data-action="close-session-advanced" disabled={saving} onClick={onClose}>
          {t("workbench.cancel")}
        </button>
        <button
          type="button"
          className="primary"
          data-action="save-session-advanced"
          disabled={locked || compacting || !dirty || !advancedDraftValid(patch)}
          onClick={() => void save()}
        >
          {t("workbench.save")}
        </button>
      </div>
    </dialog>
  );
}
