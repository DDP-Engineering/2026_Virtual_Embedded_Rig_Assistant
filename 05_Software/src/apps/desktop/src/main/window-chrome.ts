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

/** Native role menus expose fixed host commands, never renderer-supplied templates. */
export function popupWindowMenu(window: BrowserWindow | undefined, request: Request<"window.menu">) {
  if (!window || window.isDestroyed()) throw veraError("NOT_FOUND");
  const templates: Record<Request<"window.menu">["menu"], MenuItemConstructorOptions> = {
    file: { role: "fileMenu" },
    edit: { role: "editMenu" },
    view: { role: "viewMenu" },
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
