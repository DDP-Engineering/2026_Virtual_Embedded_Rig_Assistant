import type { AppInfo, SettingsPatch, SettingsSnapshot } from "@vera/shared";
import {
  Bell,
  Globe,
  Info,
  Keyboard,
  Mic,
  Palette,
  RefreshCw,
  Server,
  Shield,
  SlidersHorizontal,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { About } from "./about.js";
import { AdvancedSettingsPanel } from "./advanced-settings-panel.js";
import { AppearanceSettings } from "./appearance-settings.js";
import { CommandSettings } from "./command-settings.js";
import { DictationSettings } from "./dictation-settings.js";
import { ErrorMessage } from "./error-message.js";
import { ShortcutsSettings } from "./keyboard-shortcuts.js";
import { PrivacySettings } from "./privacy-settings.js";
import { Providers } from "./providers.js";
import { UpdatesPanel } from "./updates.js";
import { WebAccessPanel } from "./web-access.js";

/** Settings pages with their own panel; every other page shows the generic section below. */
const OWN_PANELS = new Set([
  "providers",
  "web",
  "appearance",
  "updates",
  "shortcuts",
  "commands",
  "data",
  "dictation",
  "advanced",
]);

export function useSettingsSections() {
  const { t } = useTranslation();
  return [
    { id: "providers", icon: Server, label: t("settings.providers") },
    { id: "web", icon: Globe, label: t("settings.webAccess") },
    { id: "appearance", icon: Palette, label: t("settings.appearance") },
    { id: "commands", icon: Server, label: t("settings.commands") },
    { id: "notifications", icon: Bell, label: t("settings.notifications") },
    { id: "dictation", icon: Mic, label: t("settings.dictation") },
    { id: "shortcuts", icon: Keyboard, label: t("settings.shortcuts") },
    { id: "updates", icon: RefreshCw, label: t("settings.updates") },
    { id: "data", icon: Shield, label: t("settings.data") },
    { id: "advanced", icon: SlidersHorizontal, label: t("settings.advanced") },
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
  dirtyChanged,
}: {
  section?: string;
  snapshot: SettingsSnapshot;
  info: AppInfo | undefined;
  saving: boolean;
  error: unknown;
  update: (patch: SettingsPatch) => void;
  /** Whether the open page has unsaved changes, for the leave guard (REQ-UX-6a1c936e). */
  dirtyChanged?: (dirty: boolean) => void;
}) {
  const { t } = useTranslation();
  const sections = useSettingsSections();
  const disabled = saving;
  // Each editable page keeps its own draft and is rendered only while selected, so a discarded draft
  // leaves with its page (REQ-UX-032aab57).
  return (
    <div
      className="settings-page"
      role="tabpanel"
      id="settings-panel"
      aria-labelledby={`settings-tab-${section}`}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: WAI-ARIA tab panel keyboard focus, including empty pages.
      tabIndex={0}
    >
      {saving && (
        <p role="status" data-i18n="settings.saving">
          {t("settings.saving")}
        </p>
      )}
      {Boolean(error) && <ErrorMessage error={error} />}
      {/* Rendered only while selected, like every editable page; its dialog is modal, so no editor is left open. */}
      {section === "providers" && <Providers dirtyChanged={dirtyChanged} />}
      {section === "dictation" && (
        <DictationSettings
          mode={snapshot.settings.dictationRecordingMode}
          bindings={snapshot.settings.keyboardShortcuts}
          saving={saving}
          update={update}
        />
      )}
      {section === "web" && <WebAccessPanel dirtyChanged={dirtyChanged} />}
      {section === "commands" && (
        <CommandSettings
          shell={snapshot.settings.shell}
          saving={saving}
          update={update}
          dirtyChanged={dirtyChanged}
        />
      )}
      {section === "data" && (
        <PrivacySettings
          privacy={snapshot.settings.privacy}
          saving={saving}
          update={update}
          dirtyChanged={dirtyChanged}
        />
      )}
      {section === "appearance" && (
        <AppearanceSettings
          settings={snapshot.settings}
          disabled={disabled}
          update={update}
          dirtyChanged={dirtyChanged}
        />
      )}
      {section === "updates" && (
        <UpdatesPanel
          preferences={snapshot.settings.updates}
          disabled={disabled}
          update={update}
          dirtyChanged={dirtyChanged}
        />
      )}
      {section === "advanced" && (
        <AdvancedSettingsPanel
          settings={snapshot.settings}
          disabled={disabled}
          update={update}
          dirtyChanged={dirtyChanged}
        />
      )}
      {section === "shortcuts" && (
        <ShortcutsSettings
          bindings={snapshot.settings.keyboardShortcuts}
          disabled={disabled}
          save={(keyboardShortcuts) => update({ keyboardShortcuts })}
          dirtyChanged={dirtyChanged}
        />
      )}
      {sections
        .filter(({ id }) => !OWN_PANELS.has(id))
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
            {id === "about" && info && <About info={info} />}
          </section>
        ))}
    </div>
  );
}
