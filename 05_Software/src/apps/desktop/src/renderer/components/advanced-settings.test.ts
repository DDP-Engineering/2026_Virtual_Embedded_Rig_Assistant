// @vitest-environment jsdom
// REQ-UX-fcd1ad10 REQ-UX-9ea9184f REQ-UX-6a8a987d
import userEvent from "@testing-library/user-event";
import { defaultSettings } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { AdvancedField, advancedFieldValue } from "./advanced-field.js";
import { AdvancedSettingsPanel } from "./advanced-settings-panel.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const input = () =>
  container.querySelector<HTMLInputElement>("[data-advanced-field] input") as HTMLInputElement;
const reset = () => container.querySelector<HTMLButtonElement>("[data-advanced-reset]") as HTMLButtonElement;

it("shows the inherited value, refuses out-of-range entries and resets a set value", async () => {
  const onChange = vi.fn();
  await act(async () =>
    root.render(
      createElement(AdvancedField, {
        setting: "toolCallsPerTurn",
        value: undefined,
        inherited: { value: 120, source: "workbench" },
        onChange,
      }),
    ),
  );
  expect(input().value).toBe("");
  expect(input().placeholder).toBe("120 (workbench)");
  expect(reset().disabled).toBe(true);
  expect(container.querySelector("[data-advanced-timing]")?.getAttribute("title")).toBe("Applies right away");
  // Every entry reaches the draft; the page or dialog Save waits for a valid one.
  await act(async () => userEvent.setup().type(input(), "0"));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Use a whole number from 10 to 500.");
  expect(onChange).toHaveBeenLastCalledWith(0);
  await act(async () => userEvent.setup().clear(input()));
  await act(async () => userEvent.setup().type(input(), "75"));
  expect(onChange).toHaveBeenLastCalledWith(75);
  await act(async () =>
    root.render(
      createElement(AdvancedField, {
        setting: "toolCallsPerTurn",
        value: 75,
        inherited: { value: 120, source: "workbench" },
        onChange,
      }),
    ),
  );
  expect(reset().disabled).toBe(false);
  await act(async () => userEvent.setup().click(reset()));
  expect(onChange).toHaveBeenLastCalledWith(null);
});

it("shows only the switch until Show advanced settings is on, and saves both with Save", async () => {
  const update = vi.fn();
  const settings = defaultSettings("00000000-0000-4000-8000-000000000000");
  await act(async () =>
    root.render(createElement(AdvancedSettingsPanel, { settings, disabled: false, update })),
  );
  const toggle = container.querySelector<HTMLInputElement>("[data-show-advanced]") as HTMLInputElement;
  expect(toggle.checked).toBe(false);
  expect(container.querySelector("[data-advanced-field]")).toBeNull();
  await act(async () => userEvent.setup().click(toggle));
  expect(update).not.toHaveBeenCalled();
  expect(input().placeholder).toBe("50 (default)");
  await act(async () => userEvent.setup().type(input(), "100"));
  await act(async () =>
    userEvent.setup().click(container.querySelector("[data-settings-save]") as HTMLButtonElement),
  );
  expect(update).toHaveBeenLastCalledWith({ showAdvanced: true, advanced: { toolCallsPerTurn: 100 } });
});

it("offers Inherit and the allowed values for a choice, and saves the picked one with Save", async () => {
  const update = vi.fn();
  const settings = { ...defaultSettings("00000000-0000-4000-8000-000000000000"), showAdvanced: true };
  await act(async () =>
    root.render(createElement(AdvancedSettingsPanel, { settings, disabled: false, update })),
  );
  const select = container.querySelector<HTMLSelectElement>(
    '[data-advanced-field="pageSize"] select[data-advanced-choice]',
  ) as HTMLSelectElement;
  expect([...select.options].map((option) => [option.value, option.textContent])).toEqual([
    ["", "Inherit: 10 (default)"],
    ["10", "10"],
    ["20", "20"],
    ["50", "50"],
  ]);
  expect(select.value).toBe("");
  await act(async () => userEvent.setup().selectOptions(select, "20"));
  await act(async () =>
    userEvent.setup().click(container.querySelector("[data-settings-save]") as HTMLButtonElement),
  );
  expect(update).toHaveBeenLastCalledWith({ advanced: { pageSize: 20 } });
  // A hand-edited value outside the options shows as Inherit, like an out-of-range number.
  await act(async () =>
    root.render(
      createElement(AdvancedField, {
        setting: "pageSize",
        value: advancedFieldValue("pageSize", 15),
        inherited: { value: 10, source: "default" },
        onChange: vi.fn(),
      }),
    ),
  );
  expect(container.querySelector<HTMLSelectElement>("select[data-advanced-choice]")?.selectedIndex).toBe(0);
});

it("labels the fields in Romanian", async () => {
  await i18n.changeLanguage("ro");
  await act(async () =>
    root.render(
      createElement(AdvancedField, {
        setting: "toolCallsPerTurn",
        value: undefined,
        inherited: { value: 50, source: "default" },
        onChange: vi.fn(),
      }),
    ),
  );
  expect(container.querySelector("label")?.textContent).toBe("Apeluri de instrumente pe tură");
  expect(input().placeholder).toBe("50 (implicit)");
});
