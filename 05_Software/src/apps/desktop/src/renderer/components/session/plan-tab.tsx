// REQ-UX-8d3039aa
import type { TodoItem } from "@vera/shared";
import { Circle, CircleCheck, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionView } from "../../hooks/session-view.js";
import { ErrorMessage } from "../error-message.js";

export function PlanTab({ workbenchId, sessionId }: { workbenchId: string; sessionId: string }) {
  return <PlanView key={`${workbenchId}/${sessionId}`} workbenchId={workbenchId} sessionId={sessionId} />;
}
function PlanView({ sessionId, workbenchId }: { sessionId: string; workbenchId: string }) {
  const { t } = useTranslation();
  const { view, error, retry } = useSessionView(sessionId, undefined, workbenchId);
  return (
    <section className="plan-tab" aria-label={t("panel.plan")}>
      {error !== undefined ? (
        <>
          <ErrorMessage error={error} />
          <button type="button" onClick={retry}>
            {t("settings.retry")}
          </button>
        </>
      ) : !view ? (
        <p role="status">{t("home.loading")}</p>
      ) : view.state.todos.length === 0 ? (
        <p className="muted">{t("plan.empty")}</p>
      ) : (
        <PlanItems items={view.state.todos} />
      )}
    </section>
  );
}

/** The same readable task list in the Plan tab and in a historical plan-update tool result. */
export function PlanItems({ items }: { items: readonly TodoItem[] }) {
  const { t } = useTranslation();
  const occurrences = new Map<string, number>();
  return (
    <ol className="plan-list" aria-label={t("panel.plan")} aria-live="polite" aria-relevant="all">
      {items.map((item) => {
        // IDs are optional and may repeat; keep identical rows separately keyed.
        const identity = JSON.stringify(item);
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        const Icon =
          item.status === "done" ? CircleCheck : item.status === "in_progress" ? CircleDot : Circle;
        const label =
          item.status === "done"
            ? t("plan.done")
            : item.status === "in_progress"
              ? t("plan.inProgress")
              : t("plan.pending");
        return (
          <li key={`${identity}/${occurrence}`} data-todo-status={item.status}>
            <Icon role="img" aria-label={label} />
            <div>
              <span className="plan-text">{item.text}</span>
              <span className="plan-status" aria-hidden="true">
                {label}
              </span>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
