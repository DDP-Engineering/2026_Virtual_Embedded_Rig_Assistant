// @vitest-environment jsdom
// REQ-UX-0f1a32c4 REQ-FUNC-37261edc

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { coreToolNames, defaultSettings, workbenchSchema } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { WorkbenchEditor } from "./workbench-editor.js";

vi.mock("../api/index.js", () => ({
  api: { invoke: vi.fn(), getSettings: vi.fn() },
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
let root: Root;
let container: HTMLDivElement;
const testSettings = () => defaultSettings("00000000-0000-4000-8000-000000000001");
beforeEach(() => {
  vi.mocked(api.getSettings).mockResolvedValue({ settings: testSettings() });
});
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
  vi.mocked(api.invoke).mockImplementation(
    async (channel) =>
      (channel === "skills.list" || channel === "workbench.additionalFolders.list"
        ? []
        : { content: "Instructions", oversized: false }) as never,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(WorkbenchEditor, {
          workbench: { folder: "/bench", config, readOnly, warnings: [] },
          close: vi.fn(),
          saved: vi.fn(),
        }),
      ),
    );
  });
  const user = userEvent.setup();
  await act(async () => {
    await user.click(container.querySelector('[data-project-section="tools"]') as HTMLElement);
  });
  const toggles = [...container.querySelectorAll<HTMLInputElement>("[data-tool-toggle]")];
  expect(toggles.map((input) => input.dataset.toolToggle)).toEqual(
    coreToolNames.filter((name) => name !== "view_image"),
  );
  for (const language of ["en", "ro", "de", "fr"]) {
    await act(async () => {
      await i18n.changeLanguage(language);
    });
    const description = container.querySelector('[data-tool-description="decode_register"]')?.textContent;
    expect(description).toBeTruthy();
    expect(description).not.toContain("workbenchTools.");
    expect(description).toBe(i18n.t("workbenchTools.decode_register"));
  }
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
  // Skills are listed in the section itself, like Tools.
  expect(container.querySelector("[data-skills-panel]")).not.toBeNull();
  expect(container.querySelector("[data-tool-toggle]")).toBeNull();
  await act(async () => {
    await user.click(container.querySelector('[data-project-section="tools"]') as HTMLElement);
  });
  expect(container.querySelector<HTMLInputElement>('[data-tool-toggle="grep"]')?.checked).toBe(!readOnly);
  expect(config.tools.disabled).toEqual(["grep"]);
  // Draft changes do not save: only reads (instructions, skills list) reach the API.
  const channels = vi.mocked(api.invoke).mock.calls.map((call) => call[0]);
  expect(channels).not.toContain("workbench.config.update");
  expect(channels).not.toContain("workbench.pinned.update");
});

it("a skill switched in its own panel leaves the editor without unsaved changes", async () => {
  await i18n.changeLanguage("en");
  const config = workbenchSchema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Skill bench",
  });
  vi.mocked(api.invoke).mockImplementation(
    async (channel) =>
      (channel === "skills.list" || channel === "workbench.additionalFolders.list"
        ? []
        : { content: "Instructions", oversized: false }) as never,
  );
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = (value: typeof config) =>
    act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(WorkbenchEditor, {
            workbench: { folder: "/bench", config: value, readOnly: false, warnings: [] },
            close: vi.fn(),
            saved: vi.fn(),
          }),
        ),
      );
    });
  await render(config);
  // config.changed after skills.toggle hands the editor a configuration with the skill disabled.
  await render({ ...config, skills: { disabled: ["probe-rs-flash"] } });
  const save = container.querySelector<HTMLButtonElement>("[data-project-save]");
  expect(save?.disabled).toBe(true);
  expect(container.querySelector("[data-project-actions] [role=status]")).toBeNull();
});

it.each([false, true])(
  "lists view_image for the draft image model with settings failure=%s and hides it for inheritance",
  async (settingsUnavailable) => {
    await i18n.changeLanguage("en");
    const config = workbenchSchema.parse({
      format: 1,
      id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      name: "Vision bench",
      tools: { disabled: ["view_image"] },
    });
    const getSettings = async () => {
      if (settingsUnavailable) throw Error("App settings read failed.");
      return { settings: { ...testSettings(), defaultModel: "custom:local/text" } };
    };
    vi.mocked(api.getSettings).mockImplementation(getSettings);
    vi.mocked(api.invoke).mockImplementation(async (channel: string, args: unknown) => {
      if (channel === "providers.image.capability")
        return {
          acceptsImages: (args as { modelRef: string | null }).modelRef === "custom:local/vision",
        } as never;
      if (channel === "app.settings.get") return (await getSettings()) as never;
      return (
        ["skills.list", "workbench.additionalFolders.list", "workbench.commandPrefixes.list"].includes(
          channel,
        )
          ? []
          : { content: "", oversized: false }
      ) as never;
    });
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(
          QueryClientProvider,
          { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
          createElement(WorkbenchEditor, {
            workbench: { folder: "/bench", config, readOnly: false, warnings: [] },
            close: vi.fn(),
            saved: vi.fn(),
          }),
        ),
      );
    });
    const user = userEvent.setup();
    const section = (name: string) =>
      act(async () => user.click(container.querySelector(`[data-project-section="${name}"]`) as HTMLElement));
    const checkbox = () => container.querySelector<HTMLInputElement>('[data-tool-toggle="view_image"]');
    await section("tools");
    expect(checkbox()).toBeNull();
    expect(container.querySelector('[data-tool-toggle="read"]')).toBeTruthy();
    await section("agent");
    await act(async () =>
      user.type(container.querySelector("[data-project-model]") as HTMLElement, "custom:local/vision"),
    );
    await section("tools");
    await expect.poll(() => checkbox()?.checked).toBe(false);
    for (const language of ["en", "ro", "de", "fr"]) {
      await act(async () => {
        await i18n.changeLanguage(language);
      });
      expect(checkbox()?.getAttribute("aria-describedby")).toBeTruthy();
      const description = container.querySelector('[data-tool-description="view_image"]')?.textContent;
      expect(description).toBe(i18n.t("workbenchTools.view_image"));
      expect(description).not.toContain("workbenchTools.");
    }
    await section("agent");
    await act(async () => user.clear(container.querySelector("[data-project-model]") as HTMLElement));
    await section("tools");
    expect(checkbox()).toBeNull();
  },
);
