import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, ipcMain, protocol, screen, session } from "electron";
import { getAppInfo } from "./app-info.js";
import { createEventEmitter } from "./events.js";
import { createInvokeRouter } from "./ipc-router.js";
import { bundledResponse, secureSession, secureWindow } from "./security.js";
import { loadWindowState, saveWindowState } from "./window-state.js";

const here = dirname(fileURLToPath(import.meta.url));
declare const __VERA_DEV__: boolean;
app.setName("VERA");
const userData = app.commandLine.getSwitchValue("user-data-dir");
if (userData) app.setPath("userData", userData);

protocol.registerSchemesAsPrivileged([
  { scheme: "vera", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let window: BrowserWindow | undefined;
let rendererUrl = "vera://app/index.html";
export const emitAppEvent = createEventEmitter(() => window?.webContents);

ipcMain.handle(
  "vera:invoke",
  createInvokeRouter({
    target: () =>
      window && !window.isDestroyed() ? { webContents: window.webContents, url: rendererUrl } : undefined,
    handlers: { "app.info": getAppInfo },
    log: (failure) => console.error("VERA IPC INTERNAL", failure),
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
      .catch((error: unknown) => console.error("VERA window state save failed", error))
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
  app.on("second-instance", () => {
    if (window?.isMinimized()) window.restore();
    window?.show();
    window?.focus();
  });
  app.on("window-all-closed", () => app.quit());
  app
    .whenReady()
    .then(async () => {
      secureSession(session.defaultSession);
      protocol.handle("vera", (request) => bundledResponse(join(here, "../renderer"), request));
      await createWindow();
    })
    .catch((error: unknown) => {
      console.error("VERA startup failed", error);
      app.exit(1);
    });
}
