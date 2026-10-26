// REQ-UX-8d3039aa
import { Circle, CircleCheck, CircleDot } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useSessionEvents } from "../../hooks/use-session-events.js";
import { ErrorMessage } from "../error-message.js";

function unchanged() {}
export function PlanTab({ workbenchId, sessionId }: { workbenchId: string; sessionId: string }) {
  return <PlanView key={`${workbenchId}/${sessionId}`} sessionId={sessionId} />;
}
function PlanView({ sessionId }: { sessionId: string }) {
  const { t } = useTranslation();
  const { view, error, retry } = useSessionEvents(sessionId, unchanged);
  const occurrences = new Map<string, number>();
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
        <ol className="plan-list" aria-label={t("panel.plan")} aria-live="polite" aria-relevant="all">
          {view.state.todos.map((item) => {
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
      )}
    </section>
  );
}
