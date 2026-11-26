import type { NotificationPreferences } from "@vera/shared";
import { useId } from "react";
import { useTranslation } from "react-i18next";

export function NotificationControls({
  preferences,
  disabled,
  change,
}: {
  preferences: NotificationPreferences;
  disabled: boolean;
  change: (patch: Partial<NotificationPreferences>) => void;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  return (
    <section className="data-settings-group" aria-labelledby={titleId}>
      <h3 id={titleId}>{t("settings.notifications")}</h3>
      <label htmlFor="notification-turn-completion">{t("settings.notificationTurnCompletion")}</label>
      <select
        id="notification-turn-completion"
        value={preferences.turnCompletion}
        disabled={disabled}
        onChange={(event) =>
          change({ turnCompletion: event.currentTarget.value as NotificationPreferences["turnCompletion"] })
        }
      >
        <option value="never">{t("settings.notificationNever")}</option>
        <option value="background">{t("settings.notificationBackground")}</option>
        <option value="always">{t("settings.notificationAlways")}</option>
      </select>
      <label className="flex items-center gap-2">
        <input
          id="notification-approval-requests"
          type="checkbox"
          role="switch"
          checked={preferences.approvalRequests}
          aria-checked={preferences.approvalRequests}
          disabled={disabled}
          onChange={(event) => change({ approvalRequests: event.currentTarget.checked })}
        />
        {t("settings.notificationApprovalRequests")}
      </label>
      <label className="flex items-center gap-2">
        <input
          id="notification-question-requests"
          type="checkbox"
          role="switch"
          checked={preferences.questionRequests}
          aria-checked={preferences.questionRequests}
          disabled={disabled}
          onChange={(event) => change({ questionRequests: event.currentTarget.checked })}
        />
        {t("settings.notificationQuestionRequests")}
      </label>
    </section>
  );
}
