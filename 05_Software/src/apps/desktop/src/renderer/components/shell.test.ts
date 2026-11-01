// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import "../i18n.js";
import { layoutKey } from "../lib/layout.js";
import { Shell } from "./shell.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => localStorage.clear());

it("retains Home, projects and Settings in a saved collapsed rail", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const navigate = vi.fn();
  try {
    await act(async () => {
      root.render(
        createElement(Shell, {
          navigation: createElement("button", { type: "button", "data-project": true }, "Project navigation"),
          settings: false,
          navigate,
        }),
      );
    });
    const toggle = container.querySelector<HTMLButtonElement>('[data-toggle="sidebar"]');
    await act(async () => toggle?.click());
    const rail = container.querySelector("#sidebar");
    expect(rail).not.toBeNull();
    expect(rail?.getAttribute("data-collapsed")).toBe("true");
    expect(JSON.parse(localStorage.getItem(layoutKey) ?? "{}").sidebarCollapsed).toBe(true);
    await act(async () => rail?.querySelector<HTMLButtonElement>('[data-i18n="nav.settings"]')?.click());
    expect(navigate).toHaveBeenLastCalledWith(true);
    await act(async () => rail?.querySelector<HTMLButtonElement>('[data-i18n="nav.welcome"]')?.click());
    expect(navigate).toHaveBeenLastCalledWith(false);
    await act(async () => rail?.querySelector<HTMLButtonElement>('[data-action="show-projects"]')?.click());
    expect(container.querySelector("#sidebar")?.getAttribute("data-collapsed")).toBe("false");
    expect(document.activeElement).toBe(container.querySelector("[data-project]"));
    expect(container.querySelector('[data-toggle="right"]')).not.toBeNull();
    expect(container.querySelector('.topbar [data-i18n="nav.settings"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
