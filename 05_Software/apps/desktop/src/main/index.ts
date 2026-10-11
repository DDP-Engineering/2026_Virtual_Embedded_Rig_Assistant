import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsService, WorkbenchService } from "@vera/core";
import { eventEnvelopeSchema } from "@vera/shared";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  nativeTheme,
  protocol,
  safeStorage,
  screen,
  session,
} from "electron";
import { getAppInfo } from "./app-info.js";
import { CredentialFile } from "./credentials.js";
import { configureDataLocations } from "./data-locations.js";
import { createEventEmitter } from "./events.js";
import { createFileAccess } from "./file-access.js";
import { systemClock } from "./host-ports.js";
import { createInvokeRouter } from "./ipc-router.js";
import { createLogger } from "./logger.js";
import { ProviderSettings } from "./provider-settings.js";
import { bundledResponse, secureSession, secureWindow } from "./security.js";
import { loadWindowState, saveWindowState } from "./window-state.js";

const here = dirname(fileURLToPath(import.meta.url));
declare const __VERA_DEV__: boolean;
declare const __VERA_TEST__: boolean;
app.setName("VERA");
const userData = app.commandLine.getSwitchValue("user-data-dir");
const dataLocations = configureDataLocations(app, process.execPath, userData);

protocol.registerSchemesAsPrivileged([
  { scheme: "vera", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let window: BrowserWindow | undefined;
let rendererUrl = "vera://app/index.html";
export const emitAppEvent = createEventEmitter(
  () => window?.webContents,
  (text) => credentials.scrub(text),
);
const logger = createLogger(dataLocations.paths.logs, systemClock);
const credentials = new CredentialFile({
  file: join(dataLocations.paths.userData, "credentials.json"),
  files: createFileAccess(systemClock),
  crypto: safeStorage,
  logger,
  platform: process.platform,
});
const settings = new SettingsService({
  files: createFileAccess(systemClock),
  paths: dataLocations.paths,
  uuid: randomUUID,
  changed: () => {
    emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } });
  },
});
const workbench = new WorkbenchService({
  files: createFileAccess(systemClock),
  settings,
  pid: process.pid,
  appVersion: app.getVersion(),
  now: () => systemClock.now(),
  token: randomUUID,
  isProcessAlive: (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return !(typeof error === "object" && error !== null && "code" in error && error.code === "ESRCH");
    }
  },
  changed: (event) => {
    emitAppEvent(eventEnvelopeSchema.parse(event));
  },
});
const providers = new ProviderSettings(settings, credentials);

ipcMain.handle(
  "vera:invoke",
  createInvokeRouter({
    target: () =>
      window && !window.isDestroyed() ? { webContents: window.webContents, url: rendererUrl } : undefined,
    handlers: {
      "providers.list": () => providers.list(),
      "providers.save": (request) => providers.save(request),
      "providers.remove": (request) => providers.remove(request),
      "app.info": () => getAppInfo(dataLocations.portable),
      "app.settings.get": () => {
        const snapshot = settings.get();
        if (credentials.containsSecret(snapshot)) throw { code: "INVALID", messageKey: "errors.INVALID" };
        return snapshot;
      },
      "app.settings.update": async (patch) => {
        if (credentials.containsSecret(patch)) throw { code: "INVALID", messageKey: "errors.INVALID" };
        const result = await settings.update(patch);
        nativeTheme.themeSource = result.settings.theme;
        return result;
      },
      "app.chooseFolder": async () => {
        if (__VERA_TEST__ && process.env.VERA_TEST_DIALOG_PATH)
          return { folder: process.env.VERA_TEST_DIALOG_PATH };
        if (!window || window.isDestroyed()) return { folder: null };
        const result = await dialog.showOpenDialog(window, {
          properties: ["openDirectory", "createDirectory"],
        });
        return { folder: result.canceled ? null : (result.filePaths[0] ?? null) };
      },
      "workbench.create": ({ folder, name }) => workbench.create(folder, name),
      "workbench.open": ({ folder }) => workbench.open(folder),
      "workbench.close": async () => {
        await workbench.close();
        return {};
      },
      "workbench.recent": ({ remove }) => workbench.recent(remove),
      "workbench.config.get": () => workbench.getConfig(),
      "workbench.config.update": ({ patch }) => workbench.updateConfig(patch),
      "workbench.pinned.get": () => workbench.getPinned(),
      "workbench.pinned.update": ({ content }) => workbench.updatePinned(content),
      "workbench.files": ({ query }) => workbench.files(query),
    },
    log: (failure) => logger.log("error", "ipc.internal", failure),
    sanitize: (value) => credentials.sanitize(value),
  }),
);

async function createWindow(): Promise<void> {
  const stateFile = join(app.getPath("userData"), "window-state.json");
  const state = await loadWindowState(
    stateFile,
    screen.getAllDisplays().map((display) => display.workArea),
  );
  window = new BrowserWindow({
    title: "VERA",
    ...state.bounds,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    webPreferences: {
      preload: join(here, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      webviewTag: false,
    },
  });
  secureWindow(window);
  const created = window;
  let closing = false;
  created.on("close", (event) => {
    if (state.readOnly) return;
    event.preventDefault();
    if (closing) return;
    closing = true;
    saveWindowState(stateFile, created.getNormalBounds())
      .catch(() => logger.log("error", "window.state.save.failed"))
      .finally(() => created.destroy());
  });
  window.on("closed", () => {
    window = undefined;
  });
  window.once("ready-to-show", () => window?.show());
  // electron-vite supplies this only to the development launch.
  const devUrl = process.env.ELECTRON_RENDERER_URL;
  if (__VERA_DEV__ && devUrl && !app.isPackaged) {
    const url = new URL(devUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || url.port !== "5173") {
      throw new Error("Unexpected renderer development origin");
    }
    rendererUrl = url.href;
    await window.loadURL(rendererUrl);
  } else {
    rendererUrl = "vera://app/index.html";
    await window.loadURL(rendererUrl);
  }
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  let draining = false;
  let drained = false;
  app.on("before-quit", (event) => {
    if (drained) return;
    event.preventDefault();
    if (draining) return;
    draining = true;
    void workbench
      .close()
      .then(() => providers.close())
      .then(() => credentials.close())
      .then(() => settings.close())
      .catch(() => {
        console.error("VERA shutdown persistence failed");
      })
      .finally(() => {
        drained = true;
        app.quit();
      });
  });
  let logsDraining = false;
  let logsDrained = false;
  app.on("will-quit", (event) => {
    if (logsDrained) return;
    event.preventDefault();
    if (logsDraining) return;
    logsDraining = true;
    void logger
      .flush()
      .catch(() => {
        console.error("VERA log persistence failed");
      })
      .finally(() => {
        logsDrained = true;
        app.quit();
      });
  });
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app
    .whenReady()
    .then(async () => {
      if (draining) return;
      await settings.load();
      await credentials.load();
      nativeTheme.themeSource = settings.get().settings.theme;
      if (draining) return;
      logger.log("info", "app.started", { portable: dataLocations.portable });
      secureSession(session.defaultSession);
      protocol.handle("vera", (request) => bundledResponse(join(here, "../renderer"), request));
      if (__VERA_TEST__ && app.commandLine.hasSwitch("packaging-probe")) {
        const { runPackagingProbe } = await import("./packaging/probe.js");
        app.exit(await runPackagingProbe(app.commandLine.getSwitchValue("packaging-probe")));
        return;
      }
      await createWindow();
    })
    .catch(async () => {
      logger.log("error", "app.startup.failed");
      try {
        await logger.flush();
      } catch {
        console.error("VERA log persistence failed");
      }
      app.exit(1);
    });
}
