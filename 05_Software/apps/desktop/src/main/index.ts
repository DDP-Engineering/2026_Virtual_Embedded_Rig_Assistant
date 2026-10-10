import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SettingsService } from "@vera/core";
import { app, BrowserWindow, ipcMain, protocol, screen, session } from "electron";
import { getAppInfo } from "./app-info.js";
import { configureDataLocations } from "./data-locations.js";
import { createEventEmitter } from "./events.js";
import { createFileAccess } from "./file-access.js";
import { systemClock } from "./host-ports.js";
import { createInvokeRouter } from "./ipc-router.js";
import { createLogger } from "./logger.js";
import { bundledResponse, secureSession, secureWindow } from "./security.js";
import { loadWindowState, saveWindowState } from "./window-state.js";

const here = dirname(fileURLToPath(import.meta.url));
declare const __VERA_DEV__: boolean;
app.setName("VERA");
const userData = app.commandLine.getSwitchValue("user-data-dir");
const dataLocations = configureDataLocations(app, process.execPath, userData);

protocol.registerSchemesAsPrivileged([
  { scheme: "vera", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let window: BrowserWindow | undefined;
let rendererUrl = "vera://app/index.html";
export const emitAppEvent = createEventEmitter(() => window?.webContents);
const logger = createLogger(dataLocations.paths.logs, systemClock);
const settings = new SettingsService({
  files: createFileAccess(systemClock),
  paths: dataLocations.paths,
  uuid: randomUUID,
  changed: () => {
    emitAppEvent({ topic: "app", id: "app", event: { type: "settings.changed" } });
  },
});

ipcMain.handle(
  "vera:invoke",
  createInvokeRouter({
    target: () =>
      window && !window.isDestroyed() ? { webContents: window.webContents, url: rendererUrl } : undefined,
    handlers: {
      "app.info": () => getAppInfo(dataLocations.portable),
      "app.settings.get": () => settings.get(),
      "app.settings.update": (patch) => settings.update(patch),
    },
    log: (failure) => logger.log("error", "ipc.internal", failure),
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
    void settings
      .close()
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
      if (draining) return;
      logger.log("info", "app.started", { portable: dataLocations.portable });
      secureSession(session.defaultSession);
      protocol.handle("vera", (request) => bundledResponse(join(here, "../renderer"), request));
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
