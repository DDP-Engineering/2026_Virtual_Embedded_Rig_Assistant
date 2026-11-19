import { useTranslation } from "react-i18next";
import { PlanFeedback } from "./plan-feedback.js";

export { PlanItems } from "./plan-items.js";

export function PlanTab({
  workbenchId,
  sessionId,
  readOnly = false,
  archived = false,
}: {
  workbenchId: string;
  sessionId: string;
  readOnly?: boolean;
  archived?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <section className="plan-tab" aria-label={t("panel.plan")}>
      <PlanFeedback
        key={`${workbenchId}/${sessionId}`}
        workbenchId={workbenchId}
        sessionId={sessionId}
        readOnly={readOnly}
        archived={archived}
      />
    </section>
  );
}
