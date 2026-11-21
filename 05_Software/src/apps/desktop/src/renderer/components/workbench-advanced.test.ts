// @vitest-environment jsdom
// REQ-UX-fcd1ad10 REQ-UX-9ea9184f REQ-DATA-96ef3dd6
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {
  defaultSettings,
  mergeWorkbench,
  type WorkbenchSnapshot,
  workbenchPatchSchema,
  workbenchSchema,
} from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { WorkbenchEditor } from "./workbench-editor.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), getSettings: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.clearAllMocks();
});
let wb: WorkbenchSnapshot;
async function mount(showAdvanced: boolean, stored?: Record<string, unknown>) {
  wb = {
    config: workbenchSchema.parse({
      format: 1,
      id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
      name: "Bench",
      ...(stored ? { advanced: stored } : {}),
    }),
    folder: "/bench",
    readOnly: false,
    warnings: [],
  };
  await i18n.changeLanguage("en");
  const settings = {
    ...defaultSettings("00000000-0000-4000-8000-000000000000"),
    showAdvanced,
    advanced: { toolCallsPerTurn: 80 },
  };
  vi.mocked(api.getSettings).mockResolvedValue({ settings });
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: Record<string, unknown>) => {
    if (channel === "workbench.pinned.get") return { content: "Instructions", oversized: false };
    if (channel === "workbench.config.get") return wb;
    if (channel === "workbench.config.update")
      return { ...wb, config: mergeWorkbench(wb.config, workbenchPatchSchema.parse(request.patch)) };
    // Plugin and folder lists are empty in this workbench.
    return [];
  }) as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(WorkbenchEditor, { workbench: wb, saved: vi.fn(), close: vi.fn() }),
      ),
    ),
  );
  await act(async () => new Promise((done) => setTimeout(done, 10)));
}
const save = () => container.querySelector<HTMLButtonElement>("[data-project-save]") as HTMLButtonElement;
const field = () =>
  container.querySelector<HTMLInputElement>("[data-advanced-field] input") as HTMLInputElement;

it("hides the workbench Advanced section while Show advanced settings is off", async () => {
  await mount(false);
  expect(container.querySelector('[data-project-section="advanced"]')).toBeNull();
});

it("keeps Save off for an out-of-range value and saves a valid workbench value", async () => {
  await mount(true);
  await act(async () =>
    userEvent.setup().click(container.querySelector('[data-project-section="advanced"]') as HTMLElement),
  );
  expect(field().placeholder).toBe("80 (application)");
  await act(async () => userEvent.setup().type(field(), "9"));
  expect(container.querySelector('[role="alert"]')?.textContent).toBe("Use a whole number from 10 to 500.");
  expect(save().disabled).toBe(true);
  await act(async () => userEvent.setup().clear(field()));
  await act(async () => userEvent.setup().type(field(), "200"));
  expect(save().disabled).toBe(false);
  await act(async () => userEvent.setup().click(save()));
  const update = vi.mocked(api.invoke).mock.calls.find(([channel]) => channel === "workbench.config.update");
  expect((update?.[1] as { patch: { advanced: unknown } } | undefined)?.patch.advanced).toEqual({
    toolCallsPerTurn: 200,
  });
});

it("does not let an untouched invalid value from the file block Save", async () => {
  await mount(true, { toolCallsPerTurn: 0 });
  const name = container.querySelector<HTMLInputElement>("[data-project-name]") as HTMLInputElement;
  await act(async () => userEvent.setup().type(name, " 2"));
  expect(save().disabled).toBe(false);
});

// REQ-UX-91d7a481 REQ-FUNC-cae0533c
it("shows the inherited switch state and saves a workbench switch as a boolean", async () => {
  await mount(true);
  await act(async () =>
    userEvent.setup().click(container.querySelector('[data-project-section="advanced"]') as HTMLElement),
  );
  const select = container.querySelector<HTMLSelectElement>(
    '[data-advanced-field="backgroundCompaction"] select',
  ) as HTMLSelectElement;
  expect(select.options[0]?.textContent).toBe("Inherit: On (default)");
  await act(async () => userEvent.setup().selectOptions(select, "off"));
  await act(async () => userEvent.setup().click(save()));
  const update = vi.mocked(api.invoke).mock.calls.find(([channel]) => channel === "workbench.config.update");
  expect((update?.[1] as { patch: { advanced: unknown } } | undefined)?.patch.advanced).toEqual({
    backgroundCompaction: false,
  });
});

it("saves a stored switch chosen back to Inherit as removed", async () => {
  await mount(true, { backgroundCompaction: false });
  await act(async () =>
    userEvent.setup().click(container.querySelector('[data-project-section="advanced"]') as HTMLElement),
  );
  const select = container.querySelector<HTMLSelectElement>(
    '[data-advanced-field="backgroundCompaction"] select',
  ) as HTMLSelectElement;
  expect(select.value).toBe("off");
  await act(async () => userEvent.setup().selectOptions(select, ""));
  await act(async () => userEvent.setup().click(save()));
  const update = vi.mocked(api.invoke).mock.calls.find(([channel]) => channel === "workbench.config.update");
  expect((update?.[1] as { patch: { advanced: unknown } } | undefined)?.patch.advanced).toEqual({
    backgroundCompaction: null,
  });
});

it("clears a stored workbench value with Reset and saves it as inherited", async () => {
  await mount(true, { toolCallsPerTurn: 200 });
  await act(async () =>
    userEvent.setup().click(container.querySelector('[data-project-section="advanced"]') as HTMLElement),
  );
  expect(field().value).toBe("200");
  await act(async () =>
    userEvent.setup().click(container.querySelector("[data-advanced-reset]") as HTMLButtonElement),
  );
  expect(save().disabled).toBe(false);
  await act(async () => userEvent.setup().click(save()));
  const update = vi.mocked(api.invoke).mock.calls.find(([channel]) => channel === "workbench.config.update");
  expect((update?.[1] as { patch: { advanced: unknown } } | undefined)?.patch.advanced).toEqual({
    toolCallsPerTurn: null,
  });
});
