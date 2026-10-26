import { EventEmitter } from "node:events";
import type { UpdateChannel } from "@vera/shared";
import { AppImageUpdater, DebUpdater } from "electron-updater";
import { expect, it, vi } from "vitest";
import * as backendModule from "./update-backend.js";
import { ElectronUpdateBackend, publisherConfigured } from "./update-backend.js";

vi.mock("electron", () => ({ app: { getVersion: () => "1.0.0", isPackaged: true } }));
class FakeUpdater extends EventEmitter {
  sha512: string | undefined = Buffer.alloc(64).toString("base64");
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowDowngrade = true;
  allowPrerelease = false;
  channel: string | null = null;
  disableWebInstaller = false;
  logger = null;
  downloadUpdate = vi.fn(async () => ["verified.exe"]);
  quitAndInstall = vi.fn();
  constructor(
    readonly version: string,
    readonly available = true,
  ) {
    super();
  }
  async checkForUpdates() {
    return {
      isUpdateAvailable: this.available,
      updateInfo: {
        version: this.version,
        files: [{ url: "update.exe", sha512: this.sha512, sha2: "a".repeat(64) }],
        releaseDate: "2026-10-13",
        releaseNotes: "Notes",
      },
    };
  }
}
function setup(stable: string, beta: string, distribution: "installed" | "portable" = "installed") {
  const updaters = { latest: new FakeUpdater(stable), beta: new FakeUpdater(beta) };
  const backend = new ElectronUpdateBackend({
    url: "https://updates.test/vera/",
    version: "1.0.0",
    platform: "win32",
    distribution,
    signed: false,
    resources: "/unused",
    create: (name: UpdateChannel) => updaters[name] as never,
  });
  return { backend, updaters };
}
it("disables implicit downloads/install/downgrades and beta selects stable when newer", async () => {
  const h = setup("1.2.0", "1.1.0-beta.2");
  for (const updater of Object.values(h.updaters)) {
    expect(updater.autoDownload).toBe(false);
    expect(updater.autoInstallOnAppQuit).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.disableWebInstaller).toBe(true);
  }
  expect(await h.backend.check("beta")).toMatchObject({
    version: "1.2.0",
    notes: "Notes",
    link: "https://updates.test/vera/update.exe",
  });
  await h.backend.download(() => {});
  h.backend.install(true);
  expect(h.updaters.latest.downloadUpdate).toHaveBeenCalledTimes(1);
  expect(h.updaters.beta.downloadUpdate).not.toHaveBeenCalled();
  expect(h.updaters.latest.quitAndInstall).toHaveBeenCalledWith(true, true);
});
it("uses an active native managed updater when APPIMAGE is absent", async () => {
  const select = Reflect.get(backendModule, "nativeUpdaterClass");
  expect(typeof select).toBe("function");
  expect(select("linux", "managed")).toBe(DebUpdater);
  expect(select("linux", "installed")).toBe(AppImageUpdater);
});
it("rejects SHA256-only metadata before offering a downloadable update", async () => {
  const h = setup("1.1.0", "1.2.0-beta.1");
  h.updaters.latest.sha512 = undefined;
  await expect(h.backend.check("latest")).rejects.toMatchObject({ code: "ERR_UPDATER_MISSING_SHA512" });
  expect(h.updaters.latest.downloadUpdate).not.toHaveBeenCalled();
});
it("latest excludes prereleases and older versions; beta chooses the greatest newer beta", async () => {
  expect(await setup("1.0.0", "0.9.0-beta.9").backend.check("beta")).toBeNull();
  expect(await setup("1.1.0-beta.1", "1.2.0-beta.1").backend.check("latest")).toBeNull();
  const h = setup("1.1.0", "1.2.0-beta.1");
  expect(await h.backend.check("beta")).toMatchObject({ version: "1.2.0-beta.1" });
  await h.backend.download(() => {});
  expect(h.updaters.beta.downloadUpdate).toHaveBeenCalledTimes(1);
});
it("portable backend refuses artifact actions and publisher config requires a nonempty identity", async () => {
  const h = setup("1.1.0", "1.2.0-beta.1", "portable");
  await h.backend.check("latest");
  await expect(h.backend.download(() => {})).rejects.toThrow();
  expect(() => h.backend.install(false)).toThrow();
  expect(publisherConfigured("provider: generic\npublisherName: DDP Engineering")).toBe(true);
  for (const raw of ["", "publisherName: ''", "publisherName: []", "publisherName: [DDP, 42]"])
    expect(publisherConfigured(raw)).toBe(false);
});
