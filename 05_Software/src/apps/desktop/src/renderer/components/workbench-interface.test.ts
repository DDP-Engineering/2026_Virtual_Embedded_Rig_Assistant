// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {
  defaultRightPanelTabs,
  mergeWorkbench,
  rightPanelTabIds,
  workbenchPatchSchema,
  workbenchSchema,
} from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { WorkbenchCreate } from "./workbench-create.js";
import { WorkbenchEditor } from "./workbench-editor.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  client?.clear();
  vi.clearAllMocks();
  await i18n.changeLanguage("en");
});
function stub(readOnly = false) {
  const wb = {
    config: workbenchSchema.parse({ format: 1, id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C", name: "Bench" }),
    folder: "/bench",
    indexLease: 1,
    readOnly,
    warnings: [],
  };
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: Record<string, unknown>) => {
    if (channel === "workbench.pinned.get") return { content: "Instructions", oversized: false };
    if (channel === "workbench.config.get") return wb;
    if (channel === "workbench.config.update")
      return { ...wb, config: mergeWorkbench(wb.config, workbenchPatchSchema.parse(request.patch)) };
    if (channel === "app.chooseFolder") return { folder: "/new-bench" };
    if (channel === "workbench.inspect")
      return { folder: "/new-bench", name: "New bench", existing: false, instructions: null, skills: [] };
    if (channel === "workbench.scanDocs") return { folders: [] };
    if (channel === "workbench.create") return wb;
    throw Error(`Unexpected ${channel}`);
  }) as never);
  return wb;
}
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, element)));
}
async function click(selector: string) {
  const element = container.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  await act(async () => userEvent.setup().click(element as HTMLElement));
}
const checked = () =>
  Array.from(container.querySelectorAll<HTMLInputElement>("[data-panel-tab-toggle]"))
    .filter((input) => input.checked)
    .map((input) => input.dataset.panelTabToggle);
const updates = () =>
  vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "workbench.config.update");

it.each(["en", "ro", "de", "fr"])(
  "saves localized visibility and restores defaults only in the draft (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    const wb = stub(),
      saved = vi.fn();
    await mount(createElement(WorkbenchEditor, { workbench: wb, saved, close: vi.fn() }));
    await click('[data-project-section="interface"]');
    // REQ-UX-effec625: Bookmarks is offered after Plan, unchecked by default.
    expect(checked()).toEqual(defaultRightPanelTabs);
    const git = container.querySelector<HTMLInputElement>("[data-git-status-toggle]");
    expect(git?.checked).toBe(false);
    expect(git?.closest("label")?.textContent).toContain(i18n.t("gitStatus.preference"));
    for (const id of rightPanelTabIds) {
      const input = container.querySelector<HTMLInputElement>(`[data-panel-tab-toggle="${id}"]`);
      expect(input?.closest("label")?.textContent).toContain(i18n.t(`panel.${id}`));
      await click(`[data-panel-tab-toggle="${id}"]`);
    }
    expect(checked()).toEqual(["bookmarks"]);
    expect(updates()).toHaveLength(0);
    await click("[data-restore-panel-tabs]");
    expect(checked()).toEqual(defaultRightPanelTabs);
    expect(updates()).toHaveLength(0);
    expect(container.querySelector<HTMLButtonElement>("[data-project-save]")?.disabled).toBe(true);
    await click("[data-git-status-toggle]");
    await click('[data-panel-tab-toggle="terminal"]');
    await click('[data-panel-tab-toggle="context"]');
    await click('[data-panel-tab-toggle="bookmarks"]');
    await click("[data-project-save]");
    expect(saved.mock.calls[0]?.[0].config.interface.right_panel_tabs).toEqual([
      "docs",
      "changes",
      "artifacts",
      "plan",
      "bookmarks",
      "runs",
    ]);
    expect(saved.mock.calls[0]?.[0].config.interface.git_status).toBe(true);
    expect(wb.config.interface.git_status).toBe(false);
    expect(wb.config.interface.right_panel_tabs).toEqual(defaultRightPanelTabs);
  },
);

it("Cancel discards visibility and restored-default drafts; read-only controls stay disabled", async () => {
  const wb = stub(),
    close = vi.fn();
  wb.config.interface.right_panel_tabs = ["docs"];
  const render = (readOnly = false) =>
    createElement(WorkbenchEditor, {
      key: String(readOnly),
      workbench: { ...wb, readOnly },
      saved: vi.fn(),
      close,
    });
  await mount(render());
  await click('[data-project-section="interface"]');
  await click("[data-restore-panel-tabs]");
  await click("[data-project-cancel]");
  expect(close).toHaveBeenCalledOnce();
  expect(updates()).toHaveLength(0);
  expect(wb.config.interface.right_panel_tabs).toEqual(["docs"]);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, render(true))));
  await click('[data-project-section="interface"]');
  expect(checked()).toEqual(["docs"]);
  expect(container.querySelector("[data-panel-tab-toggle]")?.matches(":disabled")).toBe(true);
  expect(container.querySelector("[data-restore-panel-tabs]")?.matches(":disabled")).toBe(true);
});

it("includes visibility in a new workbench configuration", async () => {
  stub();
  await mount(createElement(WorkbenchCreate, { created: vi.fn() }));
  await click('[data-action="choose-create"]');
  await click('[data-project-section="interface"]');
  await click('[data-panel-tab-toggle="terminal"]');
  await click('[data-action="create-workbench"]');
  const request = vi.mocked(api.invoke).mock.calls.find(([channel]) => channel === "workbench.create")?.[1];
  expect(request).toMatchObject({
    config: { interface: { right_panel_tabs: defaultRightPanelTabs.filter((id) => id !== "terminal") } },
  });
});
