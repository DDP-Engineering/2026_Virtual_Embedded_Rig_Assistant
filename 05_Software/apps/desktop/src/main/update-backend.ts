import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { UpdateChannel, UpdateOffer, UpdateSnapshot } from "@vera/shared";
import { app } from "electron";
import { AppImageUpdater, type AppUpdater, DebUpdater, NsisUpdater } from "electron-updater";
import { compare, gt, prerelease, valid } from "semver";
import { parse } from "yaml";
import type { UpdateBackend } from "./updates.js";

type Updater = Pick<
  AppUpdater,
  | "checkForUpdates"
  | "downloadUpdate"
  | "on"
  | "off"
  | "autoDownload"
  | "autoInstallOnAppQuit"
  | "allowDowngrade"
  | "allowPrerelease"
  | "channel"
  | "disableWebInstaller"
  | "logger"
  | "quitAndInstall"
>;
export function nativeUpdaterClass(platform: string, distribution: UpdateSnapshot["distribution"]) {
  if (platform === "win32") return NsisUpdater;
  return distribution === "installed" ? AppImageUpdater : DebUpdater;
}

export function publisherConfigured(raw: string): boolean {
  if (raw.length > 16384) return false;
  const data = parse(raw) as { publisherName?: unknown } | null;
  const value = data?.publisherName;
  return typeof value === "string"
    ? value.trim().length > 0
    : Array.isArray(value) && value.length > 0 && value.every((p) => typeof p === "string" && p.trim());
}

/** Separate providers retain the selected version's metadata for verified download. */
export class ElectronUpdateBackend implements UpdateBackend {
  private readonly updaters: Record<UpdateChannel, Updater>;
  private selected: Updater | undefined;
  constructor(
    private readonly options: {
      url: string;
      version: string;
      distribution: UpdateSnapshot["distribution"];
      platform: string;
      signed: boolean;
      resources: string;
      create?: (channel: UpdateChannel) => Updater;
      log?: (kind: "info" | "warn" | "error", event: string) => void;
    },
  ) {
    const create = (channel: UpdateChannel): Updater => {
      const updater =
        options.create?.(channel) ??
        new (nativeUpdaterClass(options.platform, options.distribution))({
          provider: "generic",
          url: options.url,
          channel,
        });
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.channel = channel;
      updater.allowPrerelease = channel === "beta";
      // channel setter implicitly enables downgrades; restore the invariant after setting it.
      updater.allowDowngrade = false;
      updater.disableWebInstaller = true;
      updater.logger = {
        info: () => options.log?.("info", "update.backend.info"),
        warn: () => options.log?.("warn", "update.backend.warn"),
        error: () => options.log?.("error", "update.backend.error"),
      };
      return updater;
    };
    this.updaters = { latest: create("latest"), beta: create("beta") };
  }
  async check(channel: UpdateChannel): Promise<UpdateOffer | null> {
    this.selected = undefined;
    const offers: { updater: Updater; offer: UpdateOffer }[] = [];
    let failure: unknown;
    for (const name of channel === "beta" ? (["latest", "beta"] as const) : (["latest"] as const)) {
      const updater = this.updaters[name];
      try {
        const result = await updater.checkForUpdates();
        const info = result?.updateInfo;
        if (
          !result?.isUpdateAvailable ||
          !info ||
          !valid(info.version) ||
          !gt(info.version, this.options.version) ||
          (channel === "latest" && prerelease(info.version))
        )
          continue;
        if (
          !info.files.length ||
          info.files.some((file) => !file.sha512 || !/^[A-Za-z0-9+/]{86}==$/.test(file.sha512))
        ) {
          throw Object.assign(Error("SHA512 metadata required"), { code: "ERR_UPDATER_MISSING_SHA512" });
        }
        const notes =
          typeof info.releaseNotes === "string"
            ? info.releaseNotes
            : Array.isArray(info.releaseNotes)
              ? info.releaseNotes.map((v) => `${v.version}\n${v.note ?? ""}`).join("\n\n")
              : "";
        const file = info.files.find((f) =>
          this.options.platform === "win32"
            ? f.url.toLowerCase().endsWith(".exe")
            : f.url.toLowerCase().endsWith(".appimage"),
        );
        const link = file ? new URL(file.url, this.options.url) : null;
        const base = new URL(this.options.url);
        const safeLink =
          link &&
          link.origin === base.origin &&
          !link.username &&
          !link.password &&
          link.pathname.startsWith(base.pathname)
            ? link.href
            : null;
        offers.push({
          updater,
          offer: { version: info.version.slice(0, 128), notes: notes.slice(0, 65536), link: safeLink },
        });
      } catch (error) {
        failure = error;
      }
    }
    offers.sort((a, b) => compare(b.offer.version, a.offer.version));
    const chosen = offers[0];
    if (!chosen && failure) throw failure;
    this.selected = chosen?.updater;
    return chosen?.offer ?? null;
  }
  async download(progress: (percent: number) => void): Promise<void> {
    if (this.options.distribution !== "installed" || !this.selected) throw Error("Update unavailable");
    if (this.options.signed && this.options.platform === "win32") {
      const raw = await readFile(join(this.options.resources, "app-update.yml"), "utf8");
      if (!publisherConfigured(raw))
        throw Object.assign(Error("Publisher missing"), { code: "ERR_UPDATER_INVALID_SIGNATURE" });
    }
    const selected = this.selected;
    const on = (value: { percent: number }) => progress(value.percent);
    selected.on("download-progress", on);
    try {
      // electron-updater checks the metadata SHA512 and configured Windows publisher.
      const files = await selected.downloadUpdate();
      if (!files.length) throw Error("Update download incomplete");
    } finally {
      selected.off("download-progress", on);
    }
  }
  install(restart: boolean): void {
    if (this.options.distribution !== "installed" || !this.selected) throw Error("Update unavailable");
    this.selected.quitAndInstall(true, restart);
  }
}

export function updateDistribution(portable: boolean): UpdateSnapshot["distribution"] {
  if (portable) return "portable";
  return process.platform === "linux" && !process.env.APPIMAGE ? "managed" : "installed";
}
export function desktopUpdateBackend(
  url: string,
  portable: boolean,
  signed: boolean,
  log: (kind: "info" | "warn" | "error", event: string) => void,
): ElectronUpdateBackend {
  return new ElectronUpdateBackend({
    url,
    distribution: updateDistribution(portable),
    version: app.getVersion(),
    platform: process.platform,
    signed,
    resources: process.resourcesPath,
    log,
  });
}
