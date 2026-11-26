// REQ-UX-032aab57
import type { Settings, SettingsPatch } from "@vera/shared";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { DelegatedAccessSetting } from "./delegated-access-setting.js";
import { NotificationControls } from "./notification-controls.js";
import { appMaskingValues, PrivacyControls } from "./privacy-controls.js";
import { SettingsPageHeader, useSettingsDraft } from "./settings-page-header.js";

export function PrivacySettings({
  privacy,
  notifications,
  saving,
  update,
  dirtyChanged,
}: {
  privacy: Settings["privacy"];
  notifications: Settings["notifications"];
  saving: boolean;
  update: (patch: SettingsPatch) => void;
  dirtyChanged?: ((dirty: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const masking = useSettingsDraft(appMaskingValues(privacy));
  const alerts = useSettingsDraft(notifications);
  const dirty = masking.dirty || alerts.dirty;
  useEffect(() => dirtyChanged?.(dirty), [dirty, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);
  return (
    <section className="surface" data-settings-section="data">
      <SettingsPageHeader
        title={t("settings.data")}
        i18n="settings.data"
        dirty={dirty}
        saving={saving}
        onCancel={() => {
          masking.reset();
          alerts.reset();
        }}
        onSave={() =>
          update({
            ...(masking.dirty ? { privacy: { mask: masking.edits } } : {}),
            ...(alerts.dirty ? { notifications: alerts.edits } : {}),
          })
        }
      />
      <PrivacyControls
        values={masking.draft}
        disabled={saving}
        change={(area, value) => {
          if (typeof value === "boolean") masking.set({ [area]: value });
        }}
      />
      <DelegatedAccessSetting disabled={saving} />
      <NotificationControls preferences={alerts.draft} disabled={saving} change={alerts.set} />
    </section>
  );
}
