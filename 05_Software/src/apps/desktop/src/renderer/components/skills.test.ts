// @vitest-environment jsdom
// REQ-UX-11a84a1d
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { SkillSettings } from "./skills.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
});

it.each(["en", "ro", "de"])(
  "shows plugin skills with their plugin, a toggle and no editor (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    vi.mocked(api.invoke).mockResolvedValue([
      { name: "echo-guide", source: "plugin", plugin: "echo-tools", description: "Guide.", enabled: true },
      { name: "reader", source: "workbench", description: "Reads.", enabled: true },
    ] as never);
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(SkillSettings, { workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", readOnly: false }),
        ),
      );
    });
    await act(async () => {
      await userEvent
        .setup()
        .click(container.querySelector('[data-action="skills-settings"]') as HTMLElement);
    });
    await vi.waitFor(() => expect(container.querySelectorAll(".skills-list li")).toHaveLength(2));
    const [plugin, workbench] = [...container.querySelectorAll(".skills-list li")];
    expect(plugin?.textContent).toContain(i18n.t("skills.plugin", { plugin: "echo-tools" }));
    expect(i18n.t("skills.plugin", { plugin: "echo-tools" })).toContain("echo-tools");
    expect(plugin?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(plugin?.querySelector('[data-action="open-skill"]')).toBeNull();
    expect(workbench?.querySelector('[data-action="open-skill"]')).not.toBeNull();
    client.clear();
  },
);
