// @vitest-environment jsdom
import type { CommandBlockShell, TerminalSummary } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
import { TerminalNavigation } from "../terminal-navigation.js";
import { Markdown } from "./markdown.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const terminal: TerminalSummary = {
  id: "00000000-0000-4000-8000-000000000001",
  number: 1,
  shell: "bash",
  running: true,
  shared: false,
  dispatchEligible: true,
};
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(api.invoke).mockImplementation(async (channel) => {
    if (channel === "terminal.list") return [] as never;
    if (channel === "terminal.create") return terminal as never;
    return {} as never;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(text: string, shell: CommandBlockShell) {
  await act(async () =>
    root.render(
      createElement(
        TerminalNavigation.Provider,
        { value: { workbenchId: owner, available: true, reveal: vi.fn() } },
        createElement(Markdown, { text: `\`\`\`${shell}\n${text}\n\`\`\``, assistantActions: true }),
      ),
    ),
  );
}
const run = () => container.querySelector<HTMLButtonElement>("[data-run-block]")!;

it.each(["bash", "powershell"] as const)(
  "validates %s block text before any terminal request while preserving Copy",
  async (shell) => {
    for (const text of ["", "x".repeat(16385), "echo ok\u001b[6n"]) {
      await render(text, shell);
      expect(run().disabled).toBe(true);
      await act(async () => run().click());
      expect(api.invoke).not.toHaveBeenCalled();
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[aria-label="Copy code block"]')!.click(),
      );
      expect(api.invoke).toHaveBeenCalledExactlyOnceWith("app.clipboard.write", { text });
      vi.mocked(api.invoke).mockClear();
    }
  },
);

it("accepts command text at the shared 16384-character limit", async () => {
  const text = "x".repeat(16384);
  await render(text, "bash");
  expect(run().disabled).toBe(false);
  await act(async () => run().click());
  expect(api.invoke).toHaveBeenCalledWith("terminal.create", {
    workbenchId: owner,
    cols: 80,
    rows: 24,
    shell: "bash",
  });
  expect(api.invoke).toHaveBeenCalledWith("terminal.execute", {
    workbenchId: owner,
    id: terminal.id,
    shell: "bash",
    text,
  });
});
