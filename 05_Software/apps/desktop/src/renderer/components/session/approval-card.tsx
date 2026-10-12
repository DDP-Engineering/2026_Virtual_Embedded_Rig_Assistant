import type { SessionState } from "@vera/shared";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../../api/index.js";
import { ErrorMessage } from "../error-message.js";
import { DiffViewer } from "./diff-viewer.js";

export function ApprovalCard({
  approval,
  sessionId,
  disabled,
}: {
  approval: SessionState["approvals"][number];
  sessionId?: string | undefined;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<unknown>();
  const locked = disabled || pending || !!approval.decision || !sessionId;
  async function decide(decision: "approved" | "denied", switchToAutoEdit = false) {
    if (locked || !sessionId) return;
    setPending(true);
    setError(undefined);
    try {
      await api.invoke("session.approval.decide", {
        sessionId,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision,
        ...(switchToAutoEdit ? { switchToAutoEdit } : {}),
      });
    } catch (failure) {
      setError(failure);
    } finally {
      setPending(false);
    }
  }
  return (
    <fieldset
      className="approval-card"
      data-approval-card={approval.approvalId}
      aria-label={t("approval.card")}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The whole approval group receives the documented A/D shortcuts with visible focus.
      tabIndex={0}
      onKeyDown={(event) => {
        if (
          locked ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.repeat ||
          event.nativeEvent.isComposing
        )
          return;
        const key = event.key.toLowerCase();
        if (key === "a" || key === "d") {
          event.preventDefault();
          void decide(key === "a" ? "approved" : "denied");
        }
      }}
    >
      <h4>
        {approval.tool} · {approval.path}
      </h4>
      <p>{t("approval.bytes", { count: approval.bytes })}</p>
      <p className="sr-only">{t("approval.diff")}</p>
      <DiffViewer diff={approval.diff} identity={approval.approvalId} />
      {error !== undefined && <ErrorMessage error={error} />}
      {approval.decision ? (
        <p role="status">
          {approval.decision === "approved"
            ? t("approval.approved")
            : approval.decision === "denied"
              ? t("approval.denied")
              : t("approval.aborted")}{" "}
          · {approval.by === "mode" ? t("approval.byMode") : t("approval.byUser")}
        </p>
      ) : (
        <>
          <div className="workbench-actions">
            <button type="button" disabled={locked} onClick={() => void decide("approved")}>
              {t("approval.approve")}
            </button>
            <button type="button" disabled={locked} onClick={() => void decide("denied")}>
              {t("approval.deny")}
            </button>
            <button type="button" disabled={locked} onClick={() => void decide("approved", true)}>
              {t("approval.switch")}
            </button>
          </div>
          <p className="muted">{t("approval.keys")}</p>
        </>
      )}
    </fieldset>
  );
}
