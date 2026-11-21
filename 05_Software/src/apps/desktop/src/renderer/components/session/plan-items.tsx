import type { TodoItem } from "@vera/shared";
import { Circle, CircleCheck, CircleDot } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

/** Shared readable task list; historical callers omit the live action slot. */
export function PlanItems({
  items,
  actions,
}: {
  items: readonly TodoItem[];
  actions?: (index: number) => ReactNode;
}) {
  const { t } = useTranslation();
  const occurrences = new Map<string, number>();
  return (
    <ol className="plan-list" aria-label={t("panel.plan")} aria-live="polite" aria-relevant="all">
      {items.map((item, index) => {
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
          <li key={`${identity}/${occurrence}`} data-todo-status={item.status} data-plan-step={index}>
            <Icon role="img" aria-label={label} />
            <div>
              <span className="plan-text">{item.text}</span>
              <span className="plan-status" aria-hidden="true">
                {label}
              </span>
              {actions?.(index)}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
