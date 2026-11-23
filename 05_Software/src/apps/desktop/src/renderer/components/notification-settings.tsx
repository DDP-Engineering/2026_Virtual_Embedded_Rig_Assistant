import type { NotificationPreferences, SettingsPatch } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { SettingsPageHeader, useSettingsDraft } from "./settings-page-header.js";

export function NotificationSettings({
  preferences,
  saving,
  update,
  dirtyChanged,
}: {
  preferences: NotificationPreferences;
  saving: boolean;
  update: (patch: SettingsPatch) => void;
  dirtyChanged?: ((dirty: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const { draft, edits, dirty, set, reset } = useSettingsDraft(preferences, dirtyChanged);
  return (
    <section className="surface" id="section-notifications" data-settings-section="notifications">
      <SettingsPageHeader
        title={t("settings.notifications")}
        i18n="settings.notifications"
        dirty={dirty}
        saving={saving}
        onCancel={reset}
        onSave={() => update({ notifications: edits })}
      />
      <label htmlFor="notification-turn-completion">{t("settings.notificationTurnCompletion")}</label>
      <select
        id="notification-turn-completion"
        value={draft.turnCompletion}
        disabled={saving}
        onChange={(event) =>
          set({ turnCompletion: event.currentTarget.value as NotificationPreferences["turnCompletion"] })
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
          checked={draft.approvalRequests}
          aria-checked={draft.approvalRequests}
          disabled={saving}
          onChange={(event) => set({ approvalRequests: event.currentTarget.checked })}
        />
        {t("settings.notificationApprovalRequests")}
      </label>
      <label className="flex items-center gap-2">
        <input
          id="notification-question-requests"
          type="checkbox"
          role="switch"
          checked={draft.questionRequests}
          aria-checked={draft.questionRequests}
          disabled={saving}
          onChange={(event) => set({ questionRequests: event.currentTarget.checked })}
        />
        {t("settings.notificationQuestionRequests")}
      </label>
    </section>
  );
}
