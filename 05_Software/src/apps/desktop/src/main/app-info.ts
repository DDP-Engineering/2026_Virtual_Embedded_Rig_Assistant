import type { AppInfo } from "@vera/shared";
import { app } from "electron";
import { isPortable } from "./data-locations.js";

declare const __VERA_TEST__: boolean;
declare const __VERA_SIGNED__: boolean;

export function getAppInfo(portable = isPortable(process.execPath)): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    portable,
    locale: app.getLocale(),
    testBuild: __VERA_TEST__,
    signing: process.platform === "win32" ? (__VERA_SIGNED__ ? "signed" : "unsigned") : "not-applicable",
  };
}
