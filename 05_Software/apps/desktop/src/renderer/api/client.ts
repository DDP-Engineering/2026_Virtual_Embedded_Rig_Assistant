import type { AppInfo, VeraBridge } from "@vera/shared";

/** The UI's single data boundary, adapted from BenchPilot's client interface. */
export interface VeraApi extends VeraBridge {
  getAppInfo(): Promise<AppInfo>;
}
