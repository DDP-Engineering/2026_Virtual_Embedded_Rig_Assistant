// @vitest-environment jsdom
import { type RightPanelTab, rightPanelTabIds } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import "../i18n.js";
import { layoutKey } from "../lib/layout.js";
import { Shell } from "./shell.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => localStorage.clear());

it("opens Terminal with the configurable shortcut and keeps it available in the right panel", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(Shell, { navigation: null, settings: false, navigate: () => {} })),
    );
    await act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: "T",
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
    expect(container.querySelector('[data-panel="right"]')?.getAttribute("data-tab")).toBe("terminal");
    expect(container.querySelector("#tab-terminal")?.getAttribute("aria-label")).toBe("Terminal");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("filters navigation, falls back in canonical order, and restores focus when active content is hidden", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const render = async (visibleTabs: readonly RightPanelTab[], workbenchId = "first") =>
    act(async () =>
      root.render(
        createElement(Shell, {
          navigation: null,
          settings: false,
          navigate: vi.fn(),
          workbenchId,
          visibleTabs,
        }),
      ),
    );
  try {
    await render(rightPanelTabIds);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-toggle="right"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>("#tab-terminal")?.click());
    container.querySelector<HTMLButtonElement>("#tab-terminal")?.focus();
    await render(["runs", "docs"]);
    expect(container.querySelector('[data-panel="right"]')?.getAttribute("data-tab")).toBe("docs");
    expect(document.activeElement?.id).toBe("tab-docs");
    expect(Array.from(container.querySelectorAll('[role="tab"]')).map((node) => node.id)).toEqual([
      "tab-docs",
      "tab-runs",
    ]);
    expect(container.querySelector(".panel-close")).not.toBeNull();
    for (const [key, expected] of [
      ["ArrowRight", "runs"],
      ["ArrowRight", "docs"],
      ["End", "runs"],
      ["Home", "docs"],
      ["ArrowLeft", "runs"],
    ] as const) {
      await act(async () =>
        document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })),
      );
      expect(document.activeElement?.id).toBe(`tab-${expected}`);
    }
    await render(["artifacts"], "second");
    expect(container.querySelector('[data-panel="right"]')?.getAttribute("data-tab")).toBe("artifacts");
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
    await render(["runs", "docs"]);
    expect(container.querySelector('[data-panel="right"]')?.getAttribute("data-tab")).toBe("docs");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("refuses hidden shortcut targets and keeps settings reachable with every tab hidden", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const configurePanelTabs = vi.fn();
  const render = async (visibleTabs: readonly RightPanelTab[]) =>
    act(async () =>
      root.render(
        createElement(Shell, {
          navigation: null,
          settings: false,
          navigate: vi.fn(),
          visibleTabs,
          configurePanelTabs,
        }),
      ),
    );
  const shortcut = async (key: string) =>
    act(async () =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          shiftKey: true,
          bubbles: true,
          cancelable: true,
        }),
      ),
    );
  try {
    await render(["docs"]);
    await shortcut("T");
    expect(container.querySelector("#tab-terminal")).toBeNull();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("hidden");
    await act(async () => container.querySelector<HTMLButtonElement>("[data-configure-panel-tabs]")?.click());
    expect(configurePanelTabs).toHaveBeenCalledOnce();
    await shortcut("B");
    container.querySelector<HTMLButtonElement>("#tab-docs")?.focus();
    await render([]);
    expect(container.querySelector('[data-panel="right"]')).toBeNull();
    expect(container.querySelector('[data-toggle="right"]')).toBeNull();
    expect(document.activeElement).toBe(container.querySelector("[data-configure-panel-tabs]"));
    await shortcut("B");
    await shortcut("T");
    expect(container.querySelector('[data-panel="right"]')).toBeNull();
    await render(rightPanelTabIds);
    expect(container.querySelectorAll('[role="tab"]')).toHaveLength(7);
    expect(container.querySelector("#tab-context")?.getAttribute("aria-selected")).toBe("true");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

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
