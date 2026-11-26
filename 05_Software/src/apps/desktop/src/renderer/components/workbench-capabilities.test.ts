// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import type { PluginSummary } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { WorkbenchPluginCapabilities, WorkbenchSharedCapabilities } from "./workbench-capabilities.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(element));
}
const plugin = (patch: Partial<PluginSummary> = {}): PluginSummary => ({
  id: "electrical-network",
  ecosystem: "electrical",
  issues: [],
  enabled: true,
  ...patch,
});

it.each(["en", "ro", "de", "fr"])(
  "explains provider states and keeps allowances independent (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    const toggleTool = vi.fn();
    const render = (value: PluginSummary, selected: boolean, locked = false) =>
      createElement(WorkbenchPluginCapabilities, {
        plugin: value,
        selected,
        disabledTools: ["apply_candidate"],
        toggleTool,
        locked,
      });
    await mount(render(plugin({ id: "kicad-layout", tier: "official" }), false));
    const state = () => container.querySelector("[data-capability-dependency]")?.textContent;
    expect(state()).toBe(i18n.t("pluginCapabilities.disabled"));
    const checkbox = () => container.querySelector<HTMLInputElement>("[data-tool-toggle]")!;
    expect(checkbox().checked).toBe(false);
    await act(async () => root.render(render(plugin({ id: "kicad-layout", tier: "official" }), true)));
    expect(state()).toBeUndefined();
    expect(checkbox().checked).toBe(false);
    expect(toggleTool).not.toHaveBeenCalled();
    checkbox().focus();
    await act(async () => userEvent.setup().keyboard(" "));
    expect(toggleTool).toHaveBeenCalledWith("apply_candidate", true);
    await act(async () => root.render(render(plugin({ id: "kicad-layout", tier: "local" }), true)));
    expect(state()).toContain(i18n.t("pluginCapabilities.officialOnly"));
    await act(async () => root.render(render(plugin({ issues: [{ code: "unavailable" }] }), true, true)));
    expect(state()).toContain(i18n.t("pluginCapabilities.unloadable"));
    expect(checkbox().disabled).toBe(true);
    expect(container.textContent).not.toContain("pluginCapabilities.");
  },
);

it("offers shared controls once a compatible package is installed and explains activation", async () => {
  await i18n.changeLanguage("en");
  const plugins = [
    plugin(),
    plugin({ id: "plc-engineering", ecosystem: "automation" }),
    plugin({ id: "kicad", ecosystem: "electronics" }),
  ];
  const render = (enabled: string[], values = plugins) =>
    createElement(WorkbenchSharedCapabilities, {
      plugins: values,
      enabled,
      disabledTools: ["electrical_model_change"],
      toggleTool: vi.fn(),
      locked: false,
    });
  const status = () => container.querySelector("[data-shared-dependency]")?.textContent;
  await mount(render(["kicad"], [plugin({ id: "kicad", ecosystem: "electronics" })]));
  expect(status()).toBeUndefined();
  await act(async () => root.render(render(["kicad"])));
  expect(status()).toContain(i18n.t("pluginCapabilities.noProvider"));
  await act(async () => root.render(render(["electrical-network", "plc-engineering"])));
  expect(status()).toContain("electrical-network, plc-engineering");
  expect(container.querySelectorAll('[data-tool-toggle="electrical_model_change"]')).toHaveLength(1);
  expect(
    container.querySelector<HTMLInputElement>('[data-tool-toggle="electrical_model_change"]')?.checked,
  ).toBe(false);
  await act(async () =>
    root.render(render(["electrical-network"], [plugin({ issues: [{ code: "unavailable" }] })])),
  );
  expect(status()).toContain(i18n.t("pluginCapabilities.noProvider"));
});
