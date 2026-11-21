// REQ-UX-fcd1ad10 REQ-UX-9ea9184f REQ-UX-032aab57
import {
  type AdvancedKey,
  advancedDraftValid,
  advancedEditPatch,
  advancedKeys,
  advancedSettings,
  type Settings,
  type SettingsPatch,
} from "@vera/shared";
import { useTranslation } from "react-i18next";
import { AdvancedField, advancedFieldValue } from "./advanced-field.js";
import { SettingsPageHeader, useSettingsDraft } from "./settings-page-header.js";

/** Settings > Advanced: the Show advanced settings switch and the application values, saved with Save. */
export function AdvancedSettingsPanel({
  settings,
  disabled,
  update,
  dirtyChanged,
}: {
  settings: Settings;
  disabled: boolean;
  update: (patch: SettingsPatch) => void;
  dirtyChanged?: ((dirty: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const saved = { showAdvanced: settings.showAdvanced === true, advanced: settings.advanced ?? {} };
  const { draft, dirty, set, reset } = useSettingsDraft(saved, dirtyChanged);
  const patch = advancedEditPatch(saved.advanced, draft.advanced, "app");
  const keys = advancedKeys.filter((key) =>
    (advancedSettings[key].scopes as readonly string[]).includes("app"),
  );
  return (
    <section className="surface advanced-settings" data-settings-section="advanced">
      <SettingsPageHeader
        title={t("settings.advanced")}
        i18n="settings.advanced"
        dirty={dirty}
        valid={advancedDraftValid(patch)}
        saving={disabled}
        onCancel={reset}
        onSave={() =>
          update({
            ...(draft.showAdvanced !== saved.showAdvanced ? { showAdvanced: draft.showAdvanced } : {}),
            ...(Object.keys(patch).length ? { advanced: patch } : {}),
          })
        }
      />
      <label className="advanced-switch">
        <input
          type="checkbox"
          data-show-advanced
          checked={draft.showAdvanced}
          disabled={disabled}
          onChange={(event) => set({ showAdvanced: event.target.checked })}
        />
        <span>{t("advanced.show")}</span>
      </label>
      {draft.showAdvanced &&
        keys.map((key: AdvancedKey) => {
          return (
            <AdvancedField
              key={key}
              setting={key}
              value={advancedFieldValue(key, draft.advanced[key])}
              inherited={{ value: advancedSettings[key].default, source: "default" }}
              disabled={disabled}
              onChange={(next) => {
                const advanced: Record<string, unknown> = { ...draft.advanced };
                if (next === null) delete advanced[key];
                else advanced[key] = next;
                set({ advanced });
              }}
            />
          );
        })}
    </section>
  );
}
