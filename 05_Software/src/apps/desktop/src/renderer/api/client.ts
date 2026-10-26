import type { AppInfo, SettingsPatch, SettingsSnapshot, VeraBridge } from "@vera/shared";

/** The UI's single data boundary, adapted from BenchPilot's client interface. */
export interface VeraApi extends VeraBridge {
  getAppInfo(): Promise<AppInfo>;
  getSettings(): Promise<SettingsSnapshot>;
  updateSettings(patch: SettingsPatch): Promise<SettingsSnapshot>;
}
