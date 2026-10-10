import type { AppInfo, SettingsPatch, SettingsSnapshot } from "@vera/shared";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "./error-message.js";
import { Metadata } from "./metadata.js";

export function useSettingsSections() {
  const { t } = useTranslation();
  return [
    { id: "providers", label: t("settings.providers") },
    { id: "appearance", label: t("settings.appearance") },
    { id: "language", label: t("settings.language") },
    { id: "updates", label: t("settings.updates") },
    { id: "data", label: t("settings.data") },
    { id: "about", label: t("settings.about") },
  ];
}

export function Settings({
  snapshot,
  info,
  saving,
  error,
  update,
}: {
  snapshot: SettingsSnapshot;
  info: AppInfo | undefined;
  saving: boolean;
  error: unknown;
  update: (patch: SettingsPatch) => void;
}) {
  const { t } = useTranslation();
  const sections = useSettingsSections();
  const disabled = snapshot.readOnly || saving;
  const themes = [
    { value: "light", label: t("appearance.light") },
    { value: "dark", label: t("appearance.dark") },
    { value: "system", label: t("appearance.system") },
  ] as const;
  return (
    <div className="settings-page">
      {snapshot.readOnly && (
        <p role="status" data-i18n="settings.readOnly">
          {t("settings.readOnly")}
        </p>
      )}
      {saving && (
        <p role="status" data-i18n="settings.saving">
          {t("settings.saving")}
        </p>
      )}
      {Boolean(error) && <ErrorMessage error={error} />}
      <section className="surface" id="section-appearance" data-settings-section="appearance">
        <h2 data-i18n="settings.appearance" tabIndex={-1}>
          {t("settings.appearance")}
        </h2>
        <fieldset disabled={disabled}>
          <legend>{t("appearance.theme")}</legend>
          <div className="theme-options">
            {themes.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                data-theme-option={value}
                aria-pressed={snapshot.settings.theme === value}
                onClick={() => update({ theme: value })}
              >
                <span className={`theme-preview preview-${value}`} aria-hidden="true">
                  <span />
                  <span />
                </span>
                {label}
              </button>
            ))}
          </div>
        </fieldset>
        <fieldset disabled={disabled}>
          <legend>{t("appearance.textSize")}</legend>
          <div className="scale-options">
            {([0.875, 1, 1.125, 1.25, 1.5] as const).map((scale) => (
              <button
                type="button"
                key={scale}
                data-scale={scale}
                aria-pressed={snapshot.settings.textScale === scale}
                onClick={() => update({ textScale: scale })}
              >
                {t("appearance.percent", { percent: scale * 100 })}
              </button>
            ))}
          </div>
        </fieldset>
        <p className="muted">{t("appearance.description")}</p>
        <code>{t("appearance.codePreview")}</code>
      </section>
      <section className="surface" id="section-language" data-settings-section="language">
        <h2 tabIndex={-1}>{t("settings.language")}</h2>
        <div className="language-field">
          <label htmlFor="language">{t("language.label")}</label>
          <select
            id="language"
            disabled={disabled}
            value={snapshot.settings.language}
            onChange={(event) => update({ language: event.target.value as SettingsPatch["language"] })}
          >
            <option value="system">{t("language.system")}</option>
            <option value="en">{t("language.en")}</option>
            <option value="ro">{t("language.ro")}</option>
            <option value="de">{t("language.de")}</option>
          </select>
        </div>
        <p className="muted">{t("language.description")}</p>
      </section>
      {sections
        .filter(({ id }) => id !== "appearance" && id !== "language")
        .map(({ id, label }) => (
          <section className="surface" key={id} id={`section-${id}`} data-settings-section={id}>
            <h2 tabIndex={-1}>{label}</h2>
            <p className="muted">{t("settings.placeholder")}</p>
            {id === "about" && info && <Metadata info={info} />}
          </section>
        ))}
    </div>
  );
}
