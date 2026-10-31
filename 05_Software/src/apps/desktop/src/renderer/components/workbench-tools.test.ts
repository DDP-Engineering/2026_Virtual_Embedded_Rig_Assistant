// @vitest-environment jsdom
// REQ-UX-0f1a32c4 REQ-FUNC-37261edc
import userEvent from "@testing-library/user-event";
import { builtinToolNames, workbenchSchema } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { WorkbenchEditor } from "./workbench-editor.js";

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

it.each([false, true])("tool checkboxes retain configured state and honor readOnly=%s", async (readOnly) => {
  await i18n.changeLanguage("en");
  const config = workbenchSchema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Tool bench",
    tools: { disabled: ["grep"] },
  });
  vi.mocked(api.invoke).mockResolvedValue({ content: "Instructions", oversized: false } as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(WorkbenchEditor, {
        workbench: { folder: "/bench", config, readOnly, warnings: [] },
        close: vi.fn(),
        saved: vi.fn(),
      }),
    );
  });
  const user = userEvent.setup();
  await act(async () => {
    await user.click(container.querySelector('[data-project-section="tools"]') as HTMLElement);
  });
  const toggles = [...container.querySelectorAll<HTMLInputElement>("[data-tool-toggle]")];
  expect(toggles).toHaveLength(builtinToolNames.length);
  expect(container.querySelector('[data-action="skills-settings"]')).toBeNull();
  const grep = container.querySelector<HTMLInputElement>('[data-tool-toggle="grep"]') as HTMLInputElement;
  expect(grep.checked).toBe(false);
  for (const input of toggles) expect(input.matches(":disabled")).toBe(readOnly);
  await act(async () => {
    await user.click(grep);
  });
  expect(grep.checked).toBe(!readOnly);
  const content = container.querySelector<HTMLDivElement>(".workbench-editor-content");
  if (!content) throw Error("Missing editor content");
  content.scrollTop = 500;
  await act(async () => {
    await user.click(container.querySelector('[data-project-section="skills"]') as HTMLElement);
  });
  expect(content.scrollTop).toBe(0);
  expect(container.querySelector('[data-action="skills-settings"]')).not.toBeNull();
  expect(container.querySelector("[data-tool-toggle]")).toBeNull();
  await act(async () => {
    await user.click(container.querySelector('[data-project-section="tools"]') as HTMLElement);
  });
  expect(container.querySelector<HTMLInputElement>('[data-tool-toggle="grep"]')?.checked).toBe(!readOnly);
  expect(config.tools.disabled).toEqual(["grep"]);
  expect(api.invoke).toHaveBeenCalledTimes(1); // Draft changes do not save or invoke tools.
});
