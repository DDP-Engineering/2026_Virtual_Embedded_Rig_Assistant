// @vitest-environment jsdom
// REQ-UX-e07790cb REQ-FUNC-41f5c03b
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import {
  mergeWorkbench,
  type PluginSummary,
  veraError,
  type WorkbenchSnapshot,
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
});
const echo: PluginSummary = { id: "echo-tools", name: "Echo tools", issues: [], enabled: true };
const snapshot = (enabled: string[] = [], readOnly = false): WorkbenchSnapshot => ({
  config: workbenchSchema.parse({
    format: 1,
    id: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    name: "Bench",
    plugins: { enabled },
  }),
  folder: "/bench",
  readOnly,
  warnings: [],
});
function stub(wb: WorkbenchSnapshot, entries: PluginSummary[] = [echo]) {
  const faults = { list: false, save: false };
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: Record<string, unknown>) => {
    if (channel === "workbench.pinned.get") return { content: "Instructions", oversized: false };
    if (channel === "plugins.list") {
      if (faults.list) throw veraError("NOT_FOUND");
      return entries;
    }
    if (channel === "workbench.config.get") return wb;
    if (channel === "workbench.config.update") {
      if (faults.save) throw veraError("CONFLICT");
      return { ...wb, config: mergeWorkbench(wb.config, workbenchPatchSchema.parse(request.patch)) };
    }
    if (channel === "app.chooseFolder") return { folder: "/new-bench" };
    if (channel === "workbench.inspect")
      return { folder: "/new-bench", name: "New bench", existing: false, instructions: null, skills: [] };
    if (channel === "workbench.scanDocs") return { folders: [] };
    if (channel === "workbench.create")
      return {
        ...wb,
        folder: "/new-bench",
        config: mergeWorkbench(wb.config, workbenchPatchSchema.parse(request.config)),
      };
    throw Error(`Unexpected ${channel}`);
  }) as never);
  return faults;
}
async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root.render(createElement(QueryClientProvider, { client }, element)));
}
const click = async (selector: string) => {
  const element = container.querySelector<HTMLElement>(selector);
  expect(element, selector).not.toBeNull();
  await act(async () => userEvent.setup().click(element as HTMLElement));
};
const calls = (channel: string) => vi.mocked(api.invoke).mock.calls.filter(([name]) => name === channel);
const toggle = (id = "echo-tools") =>
  container.querySelector<HTMLInputElement>(`[data-workbench-plugin="${id}"] input`);

it.each(["en", "ro", "de"])(
  "edits plugin selection as a draft saved with its workbench (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    const wb = snapshot();
    stub(wb);
    const saved = vi.fn();
    await mount(createElement(WorkbenchEditor, { workbench: wb, saved, close: vi.fn() }));
    await click('[data-project-section="plugins"]');
    await vi.waitFor(() => expect(toggle()).not.toBeNull());
    expect(toggle()?.checked).toBe(false); // Ignore a global list's enabled flag: the draft owns selection.
    await click('[data-workbench-plugin="echo-tools"] input');
    expect(toggle()?.checked).toBe(true);
    expect(calls("plugins.toggle")).toHaveLength(0);
    expect(calls("workbench.config.update")).toHaveLength(0);
    await click("[data-project-save]");
    expect(calls("workbench.config.update")[0]?.[1]).toMatchObject({
      workbenchId: wb.config.id,
      patch: { plugins: { enabled: ["echo-tools"] } },
    });
    expect(saved.mock.calls[0]?.[0].config.plugins.enabled).toEqual(["echo-tools"]);
    expect(wb.config.plugins.enabled).toEqual([]);
  },
);

it("deselects configured and missing plugins without saving on Cancel", async () => {
  await i18n.changeLanguage("en");
  const wb = snapshot(["echo-tools", "removed-tools"]);
  stub(wb);
  const close = vi.fn();
  await mount(createElement(WorkbenchEditor, { workbench: wb, saved: vi.fn(), close }));
  await click('[data-project-section="plugins"]');
  await vi.waitFor(() => expect(toggle("removed-tools")).not.toBeNull());
  expect(toggle()?.checked).toBe(true);
  await click('[data-workbench-plugin="echo-tools"] input');
  await click('[data-workbench-plugin="removed-tools"] input');
  expect(toggle()?.checked).toBe(false);
  await act(async () => userEvent.setup().click(container.querySelector("footer button") as HTMLElement));
  expect(close).toHaveBeenCalledOnce();
  expect(calls("workbench.config.update")).toHaveLength(0);
  expect(wb.config.plugins.enabled).toEqual(["echo-tools", "removed-tools"]);
});

it.each([false, true])(
  "does not newly select invalid or untrusted packages; readOnly=%s",
  async (readOnly) => {
    const wb = snapshot(["broken-tools"], readOnly);
    stub(wb, [
      echo,
      { id: "broken-tools", issues: [{ code: "changed" }], enabled: true },
      { id: "scoped-tools", source: "workbench", issues: [{ code: "untrusted" }], enabled: false },
    ]);
    await mount(createElement(WorkbenchEditor, { workbench: wb, saved: vi.fn(), close: vi.fn() }));
    await click('[data-project-section="plugins"]');
    await vi.waitFor(() => expect(toggle("scoped-tools")).not.toBeNull());
    expect(toggle("scoped-tools")?.matches(":disabled")).toBe(true);
    expect(toggle("broken-tools")?.matches(":disabled")).toBe(readOnly);
    expect(toggle()?.matches(":disabled")).toBe(readOnly);
  },
);

it.each([false, true])(
  "creates with explicit plugin selection and empty default; select=%s",
  async (select) => {
    const wb = snapshot();
    stub(wb);
    await mount(createElement(WorkbenchCreate, { created: vi.fn() }));
    await click('[data-action="choose-create"]');
    await click('[data-project-section="plugins"]');
    await vi.waitFor(() => expect(toggle()).not.toBeNull());
    expect(toggle()?.checked).toBe(false);
    if (select) await click('[data-workbench-plugin="echo-tools"] input');
    await click('[data-action="create-workbench"]');
    expect(calls("workbench.create")[0]?.[1]).toMatchObject({
      config: { plugins: { enabled: select ? ["echo-tools"] : [] } },
    });
    expect(calls("plugins.list").at(-1)?.[1]).toEqual({});
  },
);

it("retains the selected draft after a failed save and can retry", async () => {
  const wb = snapshot();
  const faults = stub(wb);
  faults.save = true;
  const saved = vi.fn();
  await mount(createElement(WorkbenchEditor, { workbench: wb, saved, close: vi.fn() }));
  await click('[data-project-section="plugins"]');
  await vi.waitFor(() => expect(toggle()).not.toBeNull());
  await click('[data-workbench-plugin="echo-tools"] input');
  await click("[data-project-save]");
  await vi.waitFor(() => expect(container.querySelector('[role="alert"]')).not.toBeNull());
  expect(toggle()?.checked).toBe(true);
  expect(saved).not.toHaveBeenCalled();
  expect(wb.config.plugins.enabled).toEqual([]);
  faults.save = false;
  await click("[data-project-save]");
  expect(saved.mock.calls[0]?.[0].config.plugins.enabled).toEqual(["echo-tools"]);
});

it("reports listing failure without clearing configured ids and supports retry", async () => {
  const wb = snapshot(["echo-tools"]);
  const faults = stub(wb);
  faults.list = true;
  await mount(createElement(WorkbenchEditor, { workbench: wb, saved: vi.fn(), close: vi.fn() }));
  await click('[data-project-section="plugins"]');
  await vi.waitFor(() =>
    expect(container.querySelector('[data-workbench-plugins] [role="alert"]')).not.toBeNull(),
  );
  expect(wb.config.plugins.enabled).toEqual(["echo-tools"]);
  faults.list = false;
  await click("[data-workbench-plugins] button");
  await vi.waitFor(() => expect(toggle()?.checked).toBe(true));
});
