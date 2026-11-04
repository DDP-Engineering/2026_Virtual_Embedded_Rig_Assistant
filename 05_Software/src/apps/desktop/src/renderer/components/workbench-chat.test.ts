// @vitest-environment jsdom
// REQ-UX-b94a613e
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

const selector = () => container.querySelector<HTMLSelectElement>("[data-chat-detail]");
const choose = async (detail: string) =>
  act(async () => userEvent.setup().selectOptions(selector() as HTMLSelectElement, detail));
it.each(["en", "ro", "de"])(
  "saves localized chat detail draft and preserves it on failure (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    const wb = snapshot(),
      faults = stub(wb),
      saved = vi.fn();
    await mount(createElement(WorkbenchEditor, { workbench: wb, saved, close: vi.fn() }));
    await click('[data-project-section="chat"]');
    expect(selector()?.value).toBe("normal");
    await choose("minimal");
    expect(calls("workbench.config.update")).toHaveLength(0);
    faults.save = true;
    await click("[data-project-save]");
    expect(saved).not.toHaveBeenCalled();
    expect(selector()?.value).toBe("minimal");
    faults.save = false;
    await click("[data-project-save]");
    expect(saved.mock.calls[0]?.[0].config.chat.detail).toBe("minimal");
    expect(wb.config.chat.detail).toBe("normal");
  },
);
it("Cancel leaves chat unchanged and a read-only workbench cannot edit", async () => {
  const wb = snapshot([], true);
  stub(wb);
  const close = vi.fn();
  await mount(createElement(WorkbenchEditor, { workbench: wb, saved: vi.fn(), close }));
  await click('[data-project-section="chat"]');
  expect(selector()?.matches(":disabled")).toBe(true);
  await click("footer button");
  expect(close).toHaveBeenCalledOnce();
  expect(calls("workbench.config.update")).toHaveLength(0);
});
it.each(["normal", "verbose"])("new workbench includes chosen/default detail %s", async (detail) => {
  stub(snapshot());
  await mount(createElement(WorkbenchCreate, { created: vi.fn() }));
  await click('[data-action="choose-create"]');
  await click('[data-project-section="chat"]');
  expect(selector()?.value).toBe("normal");
  if (detail !== "normal") await choose(detail);
  await click('[data-action="create-workbench"]');
  expect(calls("workbench.create")[0]?.[1]).toMatchObject({ config: { chat: { detail } } });
});
