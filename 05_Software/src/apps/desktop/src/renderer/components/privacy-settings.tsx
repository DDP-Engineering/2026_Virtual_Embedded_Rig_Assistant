// REQ-UX-032aab57
import { type MaskingArea, maskingDefaults, type Settings, type SettingsPatch } from "@vera/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { appMaskingValues, PrivacyControls } from "./privacy-controls.js";
import { SettingsPageHeader } from "./settings-page-header.js";

export function PrivacySettings({
  privacy,
  saving,
  update,
  dirtyChanged,
}: {
  privacy: Settings["privacy"];
  saving: boolean;
  update: (patch: SettingsPatch) => void;
  dirtyChanged?: ((dirty: boolean) => void) | undefined;
}) {
  const { t } = useTranslation();
  const [edits, setEdits] = useState<Partial<Record<MaskingArea, boolean>>>({});
  const confirmed = appMaskingValues(privacy);
  useEffect(() => {
    setEdits((current) =>
      Object.fromEntries(
        Object.entries(current).filter(
          ([area, value]) =>
            value !== (privacy?.mask?.[area as MaskingArea] ?? maskingDefaults[area as MaskingArea]),
        ),
      ),
    );
  }, [privacy]);
  const dirty = Object.keys(edits).length > 0;
  useEffect(() => dirtyChanged?.(dirty), [dirty, dirtyChanged]);
  useEffect(() => () => dirtyChanged?.(false), [dirtyChanged]);
  return (
    <section className="surface" data-settings-section="data">
      <SettingsPageHeader
        title={t("settings.data")}
        i18n="settings.data"
        dirty={dirty}
        saving={saving}
        onCancel={() => setEdits({})}
        onSave={() => update({ privacy: { mask: edits } })}
      />
      <PrivacyControls
        values={appMaskingValues({ mask: { ...confirmed, ...edits } })}
        disabled={saving}
        change={(area, value) => {
          if (typeof value !== "boolean") return;
          setEdits((current) => {
            const next = { ...current, [area]: value };
            if (value === confirmed[area]) delete next[area];
            return next;
          });
        }}
      />
    </section>
  );
}
