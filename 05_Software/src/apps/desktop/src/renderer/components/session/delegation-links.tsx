import type { DelegatedTurnStatus, SessionSummary } from "@vera/shared";
import { useTranslation } from "react-i18next";

/** Readable delegated turn outcomes, shared by the child chat and its sidebar row. */
export function useDelegatedStatusLabels(): Record<DelegatedTurnStatus, string> {
  const { t } = useTranslation();
  return {
    running: t("delegation.status.running"),
    awaiting_approval: t("delegation.status.awaiting_approval"),
    completed: t("delegation.status.completed"),
    stopped: t("delegation.status.stopped"),
    error: t("delegation.status.error"),
    limit: t("delegation.status.limit"),
    interrupted: t("delegation.status.interrupted"),
  };
}

/** A child chat's latest delegated turn outcome; the parent is the row above it in the sidebar tree. */
export function DelegatedTurnOutcome({ child }: { child: SessionSummary["delegation"] }) {
  const { t } = useTranslation();
  const statusLabels = useDelegatedStatusLabels();
  if (!child) return null;
  return (
    <div className="session-delegations" data-session-delegations>
      <span role="status" data-delegated-turn={child.turnId}>
        {t("delegation.outcome", { status: statusLabels[child.status] })}
      </span>
    </div>
  );
}
