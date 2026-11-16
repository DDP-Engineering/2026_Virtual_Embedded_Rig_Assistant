// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { WorkbenchFolders } from "./workbench-folders.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn(() => () => {}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
it.each(["en", "ro", "de", "fr"])(
  "shows masked identities and disables read-only folder mutations in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    vi.mocked(api.invoke).mockResolvedValue([
      { id: "a".repeat(64), label: "/masked/[REDACTED]/repo" },
    ] as never);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const change = vi.fn();
    try {
      await act(async () =>
        root.render(createElement(WorkbenchFolders, { workbenchId: "wb_test", disabled: true, change })),
      );
      expect(container.querySelector("h4")?.textContent).toBe(i18n.t("folders.title"));
      expect(container.querySelector("li")?.textContent).toContain("[REDACTED]");
      for (const button of container.querySelectorAll<HTMLButtonElement>(
        "[data-add-folder],[data-remove-folder]",
      )) {
        expect(button.disabled).toBe(true);
        button.click();
      }
      expect(change).not.toHaveBeenCalled();
    } finally {
      await act(async () => root.unmount());
      container.remove();
      vi.clearAllMocks();
    }
  },
);

it("refreshes opaque grants on config events even when masked descriptive config is unchanged", async () => {
  let changed: () => void = () => {};
  vi.mocked(api.subscribe).mockImplementation((...args: unknown[]) => {
    const listener = args[2];
    if (typeof listener !== "function") throw Error("Expected workbench listener");
    changed = () => listener({ type: "config.changed" });
    return () => {};
  });
  vi.mocked(api.invoke).mockResolvedValue([
    { id: "a".repeat(64), label: "/masked/[REDACTED]/repo" },
  ] as never);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(WorkbenchFolders, { workbenchId: "wb_test", live: true })),
    );
    expect(container.querySelectorAll("li")).toHaveLength(1);
    vi.mocked(api.invoke).mockResolvedValue([] as never);
    await act(async () => changed());
    expect(container.querySelectorAll("li")).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    vi.clearAllMocks();
  }
});
