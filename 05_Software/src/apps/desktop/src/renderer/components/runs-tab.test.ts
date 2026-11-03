// @vitest-environment jsdom
// REQ-UX-e0e51891 REQ-UX-25921e97 REQ-UX-93fd56dc
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ProgramRunInfo } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { RunsTab } from "./runs-tab.js";

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
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  client?.clear();
  vi.clearAllMocks();
});

const workbenchId = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const serve: ProgramRunInfo = {
  id: "01JC00000000000000000000R2",
  sessionId: "s1",
  plugin: "echo-tools",
  program: "echo",
  args: ["serve"],
  background: true,
  startedAt: "2026-11-03T10:00:00.000Z",
  state: "running",
  log: ".vera/runs/01JC00000000000000000000R2.log",
};
function stub(runs: ProgramRunInfo[], log = "boot\n") {
  const state = { runs: [...runs], log };
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: { id?: string }) => {
    switch (channel) {
      case "runs.list":
        return { runs: state.runs };
      case "runs.log":
        return {
          id: request.id,
          text: state.log,
          truncated: false,
          running: state.runs.find((run) => run.id === request.id)?.state === "running",
        };
      case "runs.stop":
        state.runs = state.runs.map((run) =>
          run.id === request.id ? { ...run, state: "stopped", end: "stopped", exitCode: null } : run,
        );
        return {};
      default:
        throw new Error(`Unexpected ${channel}`);
    }
  }) as never);
  return state;
}
async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(RunsTab, { workbenchId })));
  });
}
const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
const click = async (element: HTMLElement) => {
  await act(async () => {
    await userEvent.setup().click(element);
  });
};

it.each(["en", "ro", "de"])(
  "lists runs with their command line, plugin and state, and refreshes them (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    const state = stub([serve]);
    await render();
    await vi.waitFor(() => expect($(`[data-run="${serve.id}"]`)).not.toBeNull());
    const row = $(`[data-run="${serve.id}"]`);
    expect(row.textContent).toContain("echo serve");
    expect(row.textContent).toContain("echo-tools");
    expect(row.textContent).toContain(i18n.t("runs.state.running"));
    expect(row.querySelector("time")?.getAttribute("dateTime")).toBe(serve.startedAt);
    state.runs = [{ ...serve, state: "exited", end: "exited", exitCode: 3, durationMs: 1200 }];
    await vi.waitFor(
      () => expect($(`[data-run="${serve.id}"]`).textContent).toContain(i18n.t("runs.state.exited")),
      {
        timeout: 3000,
      },
    );
    expect($(`[data-run="${serve.id}"]`).textContent).toContain(i18n.t("runs.exitCode", { code: 3 }));
    expect($('[data-action="run-stop"]')).toBeNull();
  },
);

it("says when the workbench has no runs", async () => {
  await i18n.changeLanguage("en");
  stub([]);
  await render();
  await vi.waitFor(() => expect(container.textContent).toContain(i18n.t("runs.none")));
});

it("opens a run log that refreshes while the run is running and closes back to its button", async () => {
  await i18n.changeLanguage("en");
  const state = stub([serve]);
  await render();
  await vi.waitFor(() => expect($('[data-action="run-log"]')).not.toBeNull());
  const button = $('[data-action="run-log"]');
  await click(button);
  await vi.waitFor(() => expect($("[data-run-log]").textContent).toBe("boot\n"));
  state.log = "boot\nREADY\n";
  await vi.waitFor(() => expect($("[data-run-log]").textContent).toBe("boot\nREADY\n"), { timeout: 3000 });
  await click($('[data-action="run-log-close"]'));
  expect($("[data-run-log]")).toBeNull();
  expect(document.activeElement).toBe(button);
});

it("stops a running run and shows it stopped", async () => {
  await i18n.changeLanguage("en");
  stub([serve]);
  await render();
  await vi.waitFor(() => expect($('[data-action="run-stop"]')).not.toBeNull());
  await click($('[data-action="run-stop"]'));
  expect(vi.mocked(api.invoke).mock.calls.filter(([name]) => name === "runs.stop")).toEqual([
    ["runs.stop", { workbenchId, id: serve.id }],
  ]);
  await vi.waitFor(() =>
    expect($(`[data-run="${serve.id}"]`).textContent).toContain(i18n.t("runs.state.stopped")),
  );
  expect($('[data-action="run-stop"]')).toBeNull();
});
