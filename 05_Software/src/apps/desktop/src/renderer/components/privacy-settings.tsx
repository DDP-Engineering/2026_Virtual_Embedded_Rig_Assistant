import { type MaskingArea, maskingDefaults, type Settings, type SettingsPatch } from "@vera/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { appMaskingValues, PrivacyControls } from "./privacy-controls.js";

export function PrivacySettings({
  privacy,
  saving,
  update,
}: {
  privacy: Settings["privacy"];
  saving: boolean;
  update: (patch: SettingsPatch) => void;
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
  return (
    <section className="surface" data-settings-section="data">
      <header className="workbench-actions">
        <h2>{t("settings.data")}</h2>
        <button type="button" data-privacy-cancel disabled={saving || !dirty} onClick={() => setEdits({})}>
          {t("workbench.cancel")}
        </button>
        <button
          type="button"
          className="primary"
          data-privacy-save
          disabled={saving || !dirty}
          onClick={() => update({ privacy: { mask: edits } })}
        >
          {t("workbench.save")}
        </button>
      </header>
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
