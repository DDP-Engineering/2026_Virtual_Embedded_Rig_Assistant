// @vitest-environment jsdom
// REQ-UX-032aab57 REQ-UX-58a693f3 REQ-UX-4a040003 REQ-UX-4a040004 REQ-UX-fcd1ad10
import userEvent from "@testing-library/user-event";
import { defaultSettings, type Settings } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useAppearancePreview } from "../hooks/appearance-preview.js";
import i18n from "../i18n.js";
import { AdvancedSettingsPanel } from "./advanced-settings-panel.js";
import { AppearanceSettings } from "./appearance-settings.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
let previews: unknown[] = [];
function Probe() {
  previews.push(useAppearancePreview());
  return null;
}
beforeEach(async () => {
  await i18n.changeLanguage("en");
  previews = [];
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const base = (): Settings => defaultSettings("00000000-0000-4000-8000-000000000000");
const save = () => container.querySelector<HTMLButtonElement>("[data-settings-save]") as HTMLButtonElement;
const cancel = () =>
  container.querySelector<HTMLButtonElement>("[data-settings-cancel]") as HTMLButtonElement;
const click = async (selector: string) =>
  act(async () => userEvent.setup().click(container.querySelector(selector) as HTMLElement));

it("keeps Appearance changes in a draft with a live preview until Save, and Cancel restores", async () => {
  const update = vi.fn();
  const dirty = vi.fn();
  const render = (settings: Settings) =>
    act(async () =>
      root.render(
        createElement(
          "div",
          null,
          createElement(AppearanceSettings, { settings, disabled: false, update, dirtyChanged: dirty }),
          createElement(Probe),
        ),
      ),
    );
  await render(base());
  expect(save().disabled).toBe(true);
  expect(cancel().disabled).toBe(true);
  await click('[data-theme-option="dark"]');
  await act(async () =>
    userEvent.setup().selectOptions(container.querySelector("#interface-font-size") as HTMLElement, "1.25"),
  );
  // Previewed at once, nothing written yet.
  expect(previews.at(-1)).toEqual({ theme: "dark", textScale: 1.25 });
  expect(update).not.toHaveBeenCalled();
  expect(dirty).toHaveBeenLastCalledWith(true);
  await click("[data-settings-cancel]");
  expect(previews.at(-1)).toBeUndefined();
  expect(container.querySelector('[data-theme-option="system"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(dirty).toHaveBeenLastCalledWith(false);
  await click('[data-theme-option="dark"]');
  await click("[data-settings-save]");
  expect(update).toHaveBeenCalledTimes(1);
  expect(update).toHaveBeenLastCalledWith({ theme: "dark" });
  // The saved snapshot catches up: the draft is clean again and the preview is gone.
  await render({ ...base(), theme: "dark" });
  expect(save().disabled).toBe(true);
  expect(previews.at(-1)).toBeUndefined();
});

it("keeps the draft when a save fails and clears the preview when the page closes", async () => {
  const update = vi.fn();
  await act(async () =>
    root.render(
      createElement(
        "div",
        null,
        createElement(AppearanceSettings, {
          settings: base(),
          disabled: false,
          update,
          dirtyChanged: vi.fn(),
        }),
        createElement(Probe),
      ),
    ),
  );
  await click('[data-theme-option="light"]');
  await click("[data-settings-save]");
  // The settings snapshot never changed (the save failed): the draft stays.
  expect(container.querySelector('[data-theme-option="light"]')?.getAttribute("aria-pressed")).toBe("true");
  expect(save().disabled).toBe(false);
  await act(async () => root.render(createElement(Probe)));
  expect(previews.at(-1)).toBeUndefined();
});

it("saves Advanced values and the switch only with Save", async () => {
  const update = vi.fn();
  await act(async () =>
    root.render(
      createElement(AdvancedSettingsPanel, {
        settings: { ...base(), showAdvanced: true },
        disabled: false,
        update,
        dirtyChanged: vi.fn(),
      }),
    ),
  );
  const input = container.querySelector<HTMLInputElement>("[data-advanced-field] input") as HTMLInputElement;
  await act(async () => userEvent.setup().type(input, "120"));
  await act(async () => input.blur());
  expect(update).not.toHaveBeenCalled();
  await click("[data-settings-save]");
  expect(update).toHaveBeenLastCalledWith({ advanced: { toolCallsPerTurn: 120 } });
  await click("[data-show-advanced]");
  expect(update).toHaveBeenCalledTimes(1);
});
