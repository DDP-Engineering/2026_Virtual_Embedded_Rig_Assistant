import type { AppInfo } from "@vera/shared";

declare const __VERA_VERSION__: string;
export const mockAppInfo: AppInfo = {
  name: "VERA",
  version: __VERA_VERSION__,
  platform: "linux",
  arch: "x64",
  portable: false,
  locale: "en",
};
