import { type Request, veraError } from "@vera/shared";
import { type BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import type { WindowState } from "./window-state.js";

/** Hidden native frames can add DPI-dependent insets to requested outer bounds. */
export function restoreWindowBounds(window: BrowserWindow, bounds: WindowState["bounds"]) {
  window.setBounds(bounds);
  const actual = window.getNormalBounds();
  if (actual.width !== bounds.width || actual.height !== bounds.height) {
    window.setBounds({
      ...bounds,
      width: bounds.width - (actual.width - bounds.width),
      height: bounds.height - (actual.height - bounds.height),
    });
  }
}

export function titleBarOverlay(dark: boolean) {
  return {
    height: 40,
    color: dark ? "#181d20" : "#ffffff",
    symbolColor: dark ? "#e5e9e8" : "#242829",
  };
}

/** The renderer's `--background` token (styles/themes.css), painted before the first frame. */
export function windowBackground(dark: boolean): string {
  return dark ? "#101316" : "#f5f5f3";
}

/** Native role menus expose fixed host commands, never renderer-supplied templates. */
export function popupWindowMenu(
  window: BrowserWindow | undefined,
  request: Request<"window.menu">,
  packaged: boolean,
) {
  if (!window || window.isDestroyed()) throw veraError("NOT_FOUND");
  const templates: Record<Request<"window.menu">["menu"], MenuItemConstructorOptions> = {
    file: { role: "fileMenu" },
    edit: { role: "editMenu" },
    // The role's own submenu adds Reload and Developer Tools, which a release must not offer.
    view: packaged
      ? {
          role: "viewMenu",
          submenu: [
            { role: "resetZoom" },
            { role: "zoomIn" },
            { role: "zoomOut" },
            { type: "separator" },
            { role: "togglefullscreen" },
          ],
        }
      : { role: "viewMenu" },
    help: { role: "help", submenu: [{ role: "about" }] },
  };
  const menu = Menu.buildFromTemplate([templates[request.menu]]).items[0]?.submenu;
  if (!menu) throw veraError("NOT_FOUND");
  const { width, height } = window.getContentBounds();
  menu.popup({
    window,
    x: Math.min(request.x, Math.max(0, width - 1)),
    y: Math.min(request.y, Math.max(0, height - 1)),
  });
  return {};
}
