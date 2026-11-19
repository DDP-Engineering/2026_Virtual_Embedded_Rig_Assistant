import type { DelegatedTurnStatus, SessionSummary } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { Pager, usePaged } from "../pager.js";

export function DelegationLinks({
  sessions,
  parent,
  child,
  open,
}: {
  sessions: readonly SessionSummary[];
  parent: SessionSummary | undefined;
  child: SessionSummary["delegation"];
  open: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { rows, pager } = usePaged(sessions);
  if (!parent && !sessions.length) return null;
  const statusLabels = {
    running: t("delegation.status.running"),
    awaiting_approval: t("delegation.status.awaiting_approval"),
    completed: t("delegation.status.completed"),
    stopped: t("delegation.status.stopped"),
    error: t("delegation.status.error"),
    limit: t("delegation.status.limit"),
    interrupted: t("delegation.status.interrupted"),
  } satisfies Record<DelegatedTurnStatus, string>;
  return (
    <nav className="session-delegations" aria-label={t("delegation.title")} data-session-delegations>
      {parent && child && (
        <div className="delegation-row">
          <button type="button" className="markdown-link" onClick={() => open(parent.id)}>
            {t("delegation.parent", { title: parent.title || t("chat.untitled") })}
          </button>
          <span role="status">{t("delegation.outcome", { status: statusLabels[child.status] })}</span>
        </div>
      )}
      {sessions.length > 0 && (
        <>
          <h3>{t("delegation.title")}</h3>
          <ul>
            {rows.map((row) => (
              <li className="delegation-row" key={row.id}>
                <button type="button" className="markdown-link" onClick={() => open(row.id)}>
                  {row.title || t("chat.untitled")}
                </button>
                {row.delegation && <span role="status">{statusLabels[row.delegation.status]}</span>}
              </li>
            ))}
          </ul>
          <Pager {...pager} />
        </>
      )}
    </nav>
  );
}
