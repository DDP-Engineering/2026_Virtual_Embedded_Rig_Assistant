import type { AppInfo } from "@vera/shared";
import { app } from "electron";
import { isPortable } from "./data-locations.js";

export function getAppInfo(portable = isPortable(process.execPath)): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    portable,
    locale: app.getLocale(),
  };
}
