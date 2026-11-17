// @vitest-environment jsdom
// REQ-UX-e0e51891 REQ-UX-25921e97 REQ-UX-93fd56dc
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { ProgramRunInfo, RightPanelTab } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { RunsTab } from "./runs-tab.js";
import { Shell } from "./shell.js";

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

it.each(["en", "ro", "de", "fr"])(
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

it.each(["en", "ro", "de", "fr"])(
  "shows actual commands, folder, live output and duration (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    const state = stub([{ ...serve, command: { text: "node server.cjs", cwd: "D:/sibling" } }], "READY\n");
    await render();
    await vi.waitFor(() => expect($("[data-run-output]")?.textContent).toBe("READY\n"));
    expect($("[data-run-cwd]")?.textContent).toContain("D:/sibling");
    expect($("[data-run]").textContent).toContain("node server.cjs");
    state.log = "READY\nheartbeat\n";
    await vi.waitFor(() => expect($("[data-run-output]")?.textContent).toContain("heartbeat"), {
      timeout: 3000,
    });
    state.runs = state.runs.map((run) => ({ ...run, state: "exited", exitCode: 7, durationMs: 1234 }));
    await client.invalidateQueries({ queryKey: ["runs", workbenchId] });
    await vi.waitFor(() => expect($("[data-run-duration]")?.textContent).toContain("1.234"));
    expect($("[data-run]").textContent).toContain(i18n.t("runs.exitCode", { code: 7 }));
  },
);

it("says when the workbench has no runs", async () => {
  await i18n.changeLanguage("en");
  stub([]);
  await render();
  await vi.waitFor(() => expect(container.textContent).toContain(i18n.t("runs.none")));
});

it.each(["", " \n\t"])(
  "keeps a blank command log %j accessible without an empty output block",
  async (log) => {
    stub([{ ...serve, command: { text: "node server.cjs", cwd: "D:/sibling" } }], log);
    await render();
    await vi.waitFor(() => expect($("[data-action=run-log]")).not.toBeNull());
    await vi.waitFor(() =>
      expect(vi.mocked(api.invoke).mock.calls.some(([channel]) => channel === "runs.log")).toBe(true),
    );
    expect($("[data-run-output]")).toBeNull();
    await click($("[data-action=run-log]"));
    await vi.waitFor(() => expect($("dialog [data-run-log]")?.textContent).toBe(log));
  },
);

it("preserves declared vera/shell plugin labels instead of inferring command identity", async () => {
  await i18n.changeLanguage("en");
  stub([{ ...serve, plugin: "vera", program: "shell", args: ["declared"] }]);
  await render();
  await vi.waitFor(() => expect($("[data-run]")?.textContent).toContain("shell declared"));
  expect($("[data-run]").textContent).toContain(i18n.t("runs.plugin", { plugin: "vera" }));
  expect($("[data-run-output]")).toBeNull();
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

it("hiding Runs detaches presentation without stopping active work or losing its log", async () => {
  localStorage.clear();
  const state = stub([serve]);
  await render();
  const show = async (visibleTabs: RightPanelTab[]) =>
    act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(Shell, {
            navigation: null,
            settings: false,
            navigate: vi.fn(),
            visibleTabs,
            runs: createElement(RunsTab, { workbenchId }),
          }),
        ),
      ),
    );
  await show(["runs", "docs"]);
  await click($('[data-toggle="right"]'));
  await click($("#tab-runs"));
  await vi.waitFor(() => expect($(`[data-run="${serve.id}"]`)).not.toBeNull());
  await show(["docs"]);
  expect($("#tab-runs")).toBeNull();
  expect($(`[data-run="${serve.id}"]`)).toBeNull();
  expect(state.runs[0]?.state).toBe("running");
  state.log = "boot\nwork continued while hidden\n";
  await show(["runs", "docs"]);
  await click($("#tab-runs"));
  await click($('[data-action="run-log"]'));
  await vi.waitFor(() => expect($("[data-run-log]")?.textContent).toContain("work continued while hidden"));
  expect(vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "runs.stop")).toHaveLength(0);
  localStorage.clear();
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

it("refreshes the open log dialog command after a live presentation reset", async () => {
  const state = stub([serve], "private-token");
  await render();
  await vi.waitFor(() => expect($("[data-action=run-log]")).not.toBeNull());
  await click($("[data-action=run-log]"));
  state.runs = [{ ...serve, args: ["[REDACTED]"] }];
  state.log = "[REDACTED]";
  await act(async () => {
    await client.resetQueries({ queryKey: ["runs"] });
    await client.resetQueries({ queryKey: ["run-log"] });
  });
  await vi.waitFor(() => expect($("dialog .approval-command").textContent).toContain("[REDACTED]"));
  expect($("dialog").textContent).not.toContain("private-token");
});
