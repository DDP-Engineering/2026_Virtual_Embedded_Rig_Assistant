import type { BrowserWindow } from "electron";
import { expect, it, vi } from "vitest";

const { popup, build } = vi.hoisted(() => {
  const popup = vi.fn();
  return { popup, build: vi.fn(() => ({ items: [{ submenu: { popup } }] })) };
});
vi.mock("electron", () => ({ Menu: { buildFromTemplate: build } }));

import { popupWindowMenu, restoreWindowBounds, titleBarOverlay, windowBackground } from "./window-chrome.js";

it("restores outer geometry without accumulating native DPI frame insets", () => {
  let actual = { x: 20, y: 20, width: 1206, height: 804 };
  const window = {
    setBounds: (bounds: typeof actual) => {
      actual = { ...bounds, width: bounds.width + 2, height: bounds.height + 1 };
    },
    getNormalBounds: () => actual,
  } as unknown as BrowserWindow;
  const saved = { x: 20, y: 20, width: 1082, height: 681 };
  restoreWindowBounds(window, saved);
  expect(actual).toEqual(saved);
  restoreWindowBounds(window, saved);
  expect(actual).toEqual(saved);
});

it("anchors only native role menus inside the live window and rejects absent windows", () => {
  const window = {
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 1024, height: 640 }),
  } as unknown as BrowserWindow;
  expect(popupWindowMenu(window, { menu: "edit", x: 9000, y: 9000 }, false)).toEqual({});
  expect(build).toHaveBeenLastCalledWith([{ role: "editMenu" }]);
  expect(popup).toHaveBeenLastCalledWith({ window, x: 1023, y: 639 });
  popupWindowMenu(window, { menu: "help", x: 10, y: 40 }, false);
  expect(build).toHaveBeenLastCalledWith([{ role: "help", submenu: [{ role: "about" }] }]);
  expect(() => popupWindowMenu(undefined, { menu: "file", x: 1, y: 40 }, false)).toThrow();
  expect(titleBarOverlay(false)).toEqual({ height: 40, color: "#ffffff", symbolColor: "#242829" });
  expect(titleBarOverlay(true)).toEqual({ height: 40, color: "#181d20", symbolColor: "#e5e9e8" });
});

it("builds the full View role menu in development and a zoom and full-screen menu when packaged", () => {
  const window = {
    isDestroyed: () => false,
    getContentBounds: () => ({ width: 1024, height: 640 }),
  } as unknown as BrowserWindow;
  popupWindowMenu(window, { menu: "view", x: 10, y: 40 }, false);
  expect(build).toHaveBeenLastCalledWith([{ role: "viewMenu" }]);
  popupWindowMenu(window, { menu: "view", x: 10, y: 40 }, true);
  expect(build).toHaveBeenLastCalledWith([
    {
      role: "viewMenu",
      submenu: [
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
  ]);
});

it("paints the window background with the app background token of the theme", () => {
  expect(windowBackground(true)).toBe("#101316");
  expect(windowBackground(false)).toBe("#f5f5f3");
});
