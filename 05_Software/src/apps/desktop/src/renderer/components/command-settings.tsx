import { type SettingsPatch, settingsPatchSchema } from "@vera/shared";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

export function CommandSettings({
  shell,
  saving,
  update,
}: {
  shell: string | undefined;
  saving: boolean;
  update: (patch: SettingsPatch) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(shell ?? "");
  useEffect(() => setValue(shell ?? ""), [shell]);
  const dirty = value !== (shell ?? "");
  return (
    <section className="surface" data-settings-section="commands">
      <div className="workbench-actions">
        <h2>{t("settings.commands")}</h2>
        <button type="button" disabled={saving || !dirty} onClick={() => setValue(shell ?? "")}>
          {t("workbench.cancel")}
        </button>
        <button
          type="button"
          disabled={saving || !dirty || !settingsPatchSchema.safeParse({ shell: value }).success}
          onClick={() => update({ shell: value.trim() })}
        >
          {t("workbench.save")}
        </button>
      </div>
      <label htmlFor="command-shell">{t("settings.commandShell")}</label>
      <input
        id="command-shell"
        value={value}
        disabled={saving}
        maxLength={4096}
        placeholder={t("settings.automaticShell")}
        onChange={(event) => setValue(event.target.value)}
      />
    </section>
  );
}
