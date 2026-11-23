// REQ-UX-032aab57 REQ-UX-58a693f3 REQ-UX-4a040003 REQ-UX-4a040004
import { type Settings, type SettingsPatch, typographyDefaults } from "@vera/shared";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { setAppearancePreview } from "../hooks/appearance-preview.js";
import { SettingsPageHeader, useSettingsDraft } from "./settings-page-header.js";

/** Settings > Appearance: a draft previewed on screen at once, written only by Save. */
export function AppearanceSettings({
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
  const saved = {
    language: settings.language,
    theme: settings.theme,
    textScale: settings.textScale,
    chatFontSize: settings.chatFontSize ?? typographyDefaults.chatFontSize,
    codeFontSize: settings.codeFontSize ?? typographyDefaults.codeFontSize,
  };
  const { draft, edits, dirty, set, reset } = useSettingsDraft(saved, dirtyChanged);
  useEffect(() => setAppearancePreview(edits), [edits]);
  useEffect(() => () => setAppearancePreview(undefined), []);
  const sizes = [
    { label: t("appearance.extraSmall"), scale: 0.75, size: 10 },
    { label: t("appearance.small"), scale: 0.875, size: 12 },
    { label: t("appearance.normal"), scale: 1, size: 14 },
    { label: t("appearance.large"), scale: 1.125, size: 16 },
    { label: t("appearance.extraLarge"), scale: 1.25, size: 20 },
    { label: t("appearance.largest"), scale: 1.5, size: 24 },
  ] as const;
  const themes = [
    { value: "light", label: t("appearance.light") },
    { value: "dark", label: t("appearance.dark") },
    { value: "system", label: t("appearance.system") },
  ] as const;
  return (
    <section className="surface" id="section-appearance" data-settings-section="appearance">
      <SettingsPageHeader
        title={t("settings.appearance")}
        i18n="settings.appearance"
        dirty={dirty}
        saving={disabled}
        onCancel={reset}
        onSave={() => update(edits as SettingsPatch)}
      />
      <div className="appearance-language-row">
        <div className="language-field">
          <label htmlFor="language">{t("language.label")}</label>
          <select
            id="language"
            disabled={disabled}
            value={draft.language}
            onChange={(event) => set({ language: event.target.value as Settings["language"] })}
          >
            <option value="system">{t("language.system")}</option>
            <option value="en">{t("language.en")}</option>
            <option value="ro">{t("language.ro")}</option>
            <option value="de">{t("language.de")}</option>
            <option value="fr">{t("language.fr")}</option>
          </select>
        </div>
        <button
          type="button"
          disabled={disabled}
          data-action="reset-typography"
          className="typography-reset"
          onClick={() => set({ textScale: 1, ...typographyDefaults })}
        >
          {t("appearance.resetSizes")}
        </button>
      </div>
      <fieldset disabled={disabled}>
        <legend>{t("appearance.theme")}</legend>
        <div className="theme-options">
          {themes.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              data-theme-option={value}
              aria-pressed={draft.theme === value}
              onClick={() => set({ theme: value })}
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
      <div className="typography-grid">
        <fieldset disabled={disabled} className="typography-control">
          <legend>{t("appearance.textSize")}</legend>
          <label className="sr-only" htmlFor="interface-font-size">
            {t("appearance.textSize")}
          </label>
          <select
            id="interface-font-size"
            value={draft.textScale}
            onChange={(event) => set({ textScale: Number(event.target.value) as Settings["textScale"] })}
          >
            {sizes.map(({ scale, label }) => (
              <option key={scale} value={scale}>
                {label}
              </option>
            ))}
          </select>
          <p className="typography-interface-preview">{t("appearance.interfacePreview")}</p>
        </fieldset>
        <fieldset disabled={disabled} className="typography-control">
          <legend>{t("appearance.chatSize")}</legend>
          <label className="sr-only" htmlFor="chat-font-size">
            {t("appearance.chatSize")}
          </label>
          <select
            id="chat-font-size"
            value={draft.chatFontSize}
            onChange={(event) =>
              set({ chatFontSize: Number(event.target.value) as NonNullable<Settings["chatFontSize"]> })
            }
          >
            {sizes.map(({ size, label }) => (
              <option key={size} value={size}>
                {label}
              </option>
            ))}
          </select>
          <p className="typography-chat-preview">{t("appearance.chatPreview")}</p>
        </fieldset>
        <fieldset disabled={disabled} className="typography-control">
          <legend>{t("appearance.codeSize")}</legend>
          <label className="sr-only" htmlFor="code-font-size">
            {t("appearance.codeSize")}
          </label>
          <select
            id="code-font-size"
            value={draft.codeFontSize}
            onChange={(event) =>
              set({ codeFontSize: Number(event.target.value) as NonNullable<Settings["codeFontSize"]> })
            }
          >
            {sizes.map(({ size, label }) => (
              <option key={size} value={size}>
                {label}
              </option>
            ))}
          </select>
          <pre className="typography-code-preview">
            <code>{t("appearance.codePreview")}</code>
          </pre>
        </fieldset>
      </div>
    </section>
  );
}
