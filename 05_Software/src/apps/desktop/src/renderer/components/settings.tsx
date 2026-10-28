import { type AppInfo, type SettingsPatch, type SettingsSnapshot, typographyDefaults } from "@vera/shared";
import {
  Bell,
  Database,
  Info,
  Keyboard,
  Languages,
  Palette,
  RefreshCw,
  Server,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { ErrorMessage } from "./error-message.js";
import { Metadata } from "./metadata.js";
import { Providers } from "./providers.js";
import { UpdatesPanel } from "./updates.js";

export function useSettingsSections() {
  const { t } = useTranslation();
  return [
    { id: "providers", icon: Server, label: t("settings.providers") },
    { id: "appearance", icon: Palette, label: t("settings.appearance") },
    { id: "language", icon: Languages, label: t("settings.language") },
    { id: "notifications", icon: Bell, label: t("settings.notifications") },
    { id: "shortcuts", icon: Keyboard, label: t("settings.shortcuts") },
    { id: "storage", icon: Database, label: t("settings.storage") },
    { id: "configuration", icon: SlidersHorizontal, label: t("settings.configuration") },
    { id: "updates", icon: RefreshCw, label: t("settings.updates") },
    { id: "data", icon: Shield, label: t("settings.data") },
    { id: "about", icon: Info, label: t("settings.about") },
  ];
}

export function Settings({
  section = "appearance",
  snapshot,
  info,
  saving,
  error,
  update,
}: {
  section?: string;
  snapshot: SettingsSnapshot;
  info: AppInfo | undefined;
  saving: boolean;
  error: unknown;
  update: (patch: SettingsPatch) => void;
}) {
  const { t } = useTranslation();
  const sections = useSettingsSections();
  const disabled = snapshot.readOnly || saving;
  const chatFontSize = snapshot.settings.chatFontSize ?? typographyDefaults.chatFontSize;
  const codeFontSize = snapshot.settings.codeFontSize ?? typographyDefaults.codeFontSize;
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
    <div
      className="settings-page"
      role="tabpanel"
      id="settings-panel"
      aria-labelledby={`settings-tab-${section}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tab panel keyboard focus, including empty pages.
      tabIndex={0}
    >
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
      <div hidden={section !== "providers"}>
        <Providers readOnly={snapshot.readOnly} />
      </div>
      <section
        hidden={section !== "appearance"}
        className="surface"
        id="section-appearance"
        data-settings-section="appearance"
      >
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
        <fieldset disabled={disabled} className="typography-control">
          <legend>{t("appearance.textSize")}</legend>
          <label className="sr-only" htmlFor="interface-font-size">
            {t("appearance.textSize")}
          </label>
          <select
            id="interface-font-size"
            value={snapshot.settings.textScale}
            onChange={(event) =>
              update({ textScale: Number(event.target.value) as SettingsPatch["textScale"] })
            }
          >
            {sizes.map(({ scale, label }) => (
              <option key={scale} value={scale}>
                {label}
              </option>
            ))}
          </select>
        </fieldset>
        <p className="muted">{t("appearance.description")}</p>
        <p className="typography-interface-preview">{t("appearance.interfacePreview")}</p>
        <fieldset disabled={disabled} className="typography-control">
          <legend>{t("appearance.chatSize")}</legend>
          <label className="sr-only" htmlFor="chat-font-size">
            {t("appearance.chatSize")}
          </label>
          <select
            id="chat-font-size"
            value={chatFontSize}
            onChange={(event) =>
              update({ chatFontSize: Number(event.target.value) as SettingsPatch["chatFontSize"] })
            }
          >
            {sizes.map(({ size, label }) => (
              <option key={size} value={size}>
                {label}
              </option>
            ))}
          </select>
          <p className="muted">{t("appearance.chatDescription")}</p>
          <p className="typography-chat-preview">{t("appearance.chatPreview")}</p>
        </fieldset>
        <fieldset disabled={disabled} className="typography-control">
          <legend>{t("appearance.codeSize")}</legend>
          <label className="sr-only" htmlFor="code-font-size">
            {t("appearance.codeSize")}
          </label>
          <select
            id="code-font-size"
            value={codeFontSize}
            onChange={(event) =>
              update({ codeFontSize: Number(event.target.value) as SettingsPatch["codeFontSize"] })
            }
          >
            {sizes.map(({ size, label }) => (
              <option key={size} value={size}>
                {label}
              </option>
            ))}
          </select>
          <p className="muted">{t("appearance.codeDescription")}</p>
          <pre className="typography-code-preview">
            <code>{t("appearance.codePreview")}</code>
          </pre>
        </fieldset>
        <button
          type="button"
          disabled={disabled}
          data-action="reset-typography"
          onClick={() => update({ textScale: 1, ...typographyDefaults })}
        >
          {t("appearance.resetSizes")}
        </button>
      </section>
      <section
        hidden={section !== "language"}
        className="surface"
        id="section-language"
        data-settings-section="language"
      >
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
      <div hidden={section !== "updates"}>
        <UpdatesPanel preferences={snapshot.settings.updates} disabled={disabled} update={update} />
      </div>
      {sections
        .filter(
          ({ id }) => id !== "providers" && id !== "appearance" && id !== "language" && id !== "updates",
        )
        .map(({ id, label }) => (
          <section
            hidden={section !== id}
            className="surface"
            key={id}
            id={`section-${id}`}
            data-settings-section={id}
          >
            <h2 tabIndex={-1}>{label}</h2>
            {id !== "about" && <p className="muted">{t("settings.placeholder")}</p>}
            {id === "about" && info && <Metadata info={info} />}
          </section>
        ))}
    </div>
  );
}
