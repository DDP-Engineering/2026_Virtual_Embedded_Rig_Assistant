import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import type { AppInfo } from "@vera/shared";
import { app } from "electron";

export function getAppInfo(): AppInfo {
  return {
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    portable: existsSync(join(dirname(process.execPath), "vera.portable")),
    locale: app.getLocale(),
  };
}
