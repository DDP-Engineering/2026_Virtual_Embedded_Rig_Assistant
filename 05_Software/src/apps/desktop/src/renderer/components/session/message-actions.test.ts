// @vitest-environment jsdom
import { emptySessionState, type TerminalSummary, veraError } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import i18n from "../../i18n.js";
import { TerminalNavigation } from "../terminal-navigation.js";
import { Markdown } from "./markdown.js";
import { Transcript } from "./transcript.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const terminal = (number: number, shell: TerminalSummary["shell"] = "powershell"): TerminalSummary => ({
  id: `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`,
  number,
  shell,
  shared: false,
  running: true,
});
const text = "Get-Content README.MD -TotalCount 10";
const reveal = vi.fn();
const copy = vi.fn();
let container: HTMLDivElement;
let root: Root;
beforeEach(async () => {
  vi.resetAllMocks();
  await i18n.changeLanguage("en");
  copy.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  vi.mocked(api.invoke).mockImplementation(async (channel, request) => {
    if (channel === "app.clipboard.write") {
      await copy((request as { text: string }).text);
      return {} as never;
    }
    if (channel === "terminal.list") return [terminal(1)] as never;
    if (channel === "terminal.create") return terminal(2) as never;
    return {} as never;
  });
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(
  markdown = `\`\`\`powershell\n${text}\n\`\`\``,
  streaming = false,
  workbenchId = owner,
) {
  await act(async () =>
    root.render(
      createElement(
        TerminalNavigation.Provider,
        {
          value: { workbenchId, available: true, reveal },
        },
        createElement(Markdown, { text: markdown, assistantActions: true, streaming }),
      ),
    ),
  );
}
const run = () => container.querySelector<HTMLButtonElement>("[data-run-block]")!;
const executeCalls = () =>
  vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "terminal.execute");

it("offers Run only for explicit PowerShell and Bash blocks; copies original Unicode and multiline text", async () => {
  const original = "Write-Output 'Știință 🧪'\r\nGet-Content `\r\n  README.MD -TotalCount 10";
  await render(
    `\`\`\`PowerShell\r\n${original}\r\n\`\`\`\n\n\`\`\`text\nMissing type name after '['.\n\`\`\`\n\n\`\`\`ts\nconst source = 1;\n\`\`\`\n\n\`\`\`\nls\n\`\`\``,
  );
  expect(container.querySelectorAll("[data-run-block]")).toHaveLength(1);
  const copies = container.querySelectorAll<HTMLButtonElement>('[aria-label="Copy code block"]');
  expect(copies).toHaveLength(4);
  await act(async () => copies[0]!.click());
  expect(copy).toHaveBeenLastCalledWith(original);
  await act(async () => copies[1]!.click());
  expect(copy).toHaveBeenLastCalledWith("Missing type name after '['.");
  await act(async () => run().click());
  expect(executeCalls()).toEqual([
    ["terminal.execute", { workbenchId: owner, id: terminal(1).id, shell: "powershell", text: original }],
  ]);
  expect(reveal).toHaveBeenCalledExactlyOnceWith(terminal(1).id);
});

it("keeps incomplete streaming blocks disabled and makes completed blocks usable", async () => {
  await render(`\`\`\`powershell\n${text}`, true);
  expect(run().disabled).toBe(true);
  await act(async () => run().click());
  expect(api.invoke).not.toHaveBeenCalled();
  await render(`\`\`\`powershell\n${text}`, false);
  expect(run().disabled).toBe(true);
  await render();
  expect(run().disabled).toBe(false);
  await act(async () => run().click());
  expect(executeCalls()).toHaveLength(1);
});

it("recognizes only actual closing fences, including nested and longer tilde fences", async () => {
  for (const markdown of [
    "```bash\necho ```",
    "```bash\necho ok\n    ```",
    "````bash\necho ok\n```",
    "```bash\necho ok\n~~~",
  ]) {
    await render(markdown);
    expect(run().disabled).toBe(true);
  }
  for (const markdown of [
    "  ```bash\necho ok\n  ```",
    "- Commands\n\n  ```bash\n  echo ok\n  ```",
    "> ```bash\n> echo ok\n> ```",
    "~~~~bash\necho ok\n~~~~",
    "```bash\n```",
    "```bash\necho ok\n\n```",
    "````bash\n```\n````",
  ]) {
    await render(markdown);
    expect(run().disabled).toBe(false);
  }
});

it("creates a compatible terminal rather than dispatching into an incompatible or exited shell", async () => {
  vi.mocked(api.invoke).mockImplementation(async (channel) => {
    if (channel === "terminal.list")
      return [terminal(1, "bash"), { ...terminal(3), running: false }] as never;
    if (channel === "terminal.create") return terminal(2) as never;
    return {} as never;
  });
  await render();
  await act(async () => run().click());
  expect(api.invoke).toHaveBeenCalledWith("terminal.create", {
    workbenchId: owner,
    cols: 80,
    rows: 24,
    shell: "powershell",
  });
  expect(executeCalls()[0]?.[1]).toMatchObject({ id: terminal(2).id });
});

it("chooses a named destination when multiple compatible terminals exist, and cancels without executing", async () => {
  vi.mocked(api.invoke).mockImplementation(async (channel) =>
    channel === "terminal.list" ? ([terminal(1), terminal(2), terminal(3, "bash")] as never) : ({} as never),
  );
  await render();
  run().focus();
  await act(async () => run().click());
  const select = container.querySelector("select")!;
  expect([...select.options].map((option) => option.text)).toEqual([
    "Terminal 1 — powershell",
    "Terminal 2 — powershell",
  ]);
  expect(executeCalls()).toHaveLength(0);
  const cancel = [...container.querySelectorAll<HTMLButtonElement>("dialog button")].find(
    (button) => button.textContent === "Cancel",
  )!;
  await act(async () => cancel.click());
  expect(executeCalls()).toHaveLength(0);
  expect(document.activeElement).toBe(run());
  await act(async () => run().click());
  await act(async () => {
    const destination = container.querySelector("select")!;
    destination.value = terminal(2).id;
    destination.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await act(async () => container.querySelector<HTMLButtonElement>('dialog button[type="submit"]')!.click());
  expect(executeCalls()[0]?.[1]).toMatchObject({ id: terminal(2).id });
});

it.each(["terminal.create", "terminal.execute"])(
  "reports %s failures through the error UI and permits retry",
  async (failed) => {
    vi.mocked(api.invoke).mockImplementation(async (channel) => {
      if (channel === failed) throw veraError("CONFLICT");
      if (channel === "terminal.list") return (failed === "terminal.create" ? [] : [terminal(1)]) as never;
      return {} as never;
    });
    await render();
    await act(async () => run().click());
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(reveal).not.toHaveBeenCalled();
    expect(run().disabled).toBe(false);
  },
);

it("prevents duplicate dispatch while a click is processing", async () => {
  let release: (() => void) | undefined;
  vi.mocked(api.invoke).mockImplementation(async (channel) => {
    if (channel === "terminal.list")
      return await new Promise((resolve) => {
        release = () => resolve([terminal(1)] as never);
      });
    return {} as never;
  });
  await render();
  await act(async () => {
    run().click();
    run().click();
  });
  expect(run().disabled).toBe(true);
  await act(async () => release?.());
  expect(executeCalls()).toHaveLength(1);
});

it.each(["session", "workbench"])(
  "does not dispatch a stale destination after switching %s",
  async (scope) => {
    let release: (() => void) | undefined;
    vi.mocked(api.invoke).mockImplementation(async (channel) => {
      if (channel === "terminal.list")
        return await new Promise((resolve) => {
          release = () => resolve([terminal(1)] as never);
        });
      return {} as never;
    });
    await render();
    await act(async () => run().click());
    if (scope === "session") await act(async () => root.render(null));
    else await render(undefined, false, "another-workbench");
    await act(async () => release?.());
    expect(executeCalls()).toHaveLength(0);
    expect(reveal).not.toHaveBeenCalled();
  },
);

it.each(["en", "ro", "de", "fr"])(
  "copies only each completed reply as exact Markdown with localized accessible actions in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    const answer =
      "# Știință 🧪\n\n- First\n  - Nested\n\n[[docs/a.md#h=power]]\n\n```bash\nprintf 'λ\\n'\n```\n\n```ts\nconst value = 1;\n```\n";
    const state = emptySessionState();
    state.items.push(
      { kind: "user", id: "u", text: "private user text" },
      { kind: "assistant", id: "a1", turnId: "t1", text: answer, streaming: false, citations: [] },
      {
        kind: "tool",
        id: "tool",
        turnId: "t1",
        name: "read",
        args: {},
        status: "ok",
        preview: "private tool output",
      },
      { kind: "assistant", id: "a2", turnId: "t2", text: "Second reply", streaming: false, citations: [] },
      { kind: "assistant", id: "a3", turnId: "t3", text: "Still streaming", streaming: true, citations: [] },
    );
    await act(async () =>
      root.render(
        createElement(Transcript, {
          state,
          reasoning: { t1: "private reasoning" },
          updates: {},
          retry: () => {},
          search: "",
          detail: "verbose",
        }),
      ),
    );
    const buttons = container.querySelectorAll<HTMLButtonElement>(".copy-response");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      expect(button.title).toBe(i18n.t("chatActions.copyResponse"));
      expect(button.getAttribute("aria-label")).toBe(button.title);
      button.focus();
      expect(document.activeElement).toBe(button);
    }
    await act(async () => buttons[0]!.click());
    expect(copy).toHaveBeenLastCalledWith(answer);
    await act(async () => buttons[1]!.click());
    expect(copy).toHaveBeenLastCalledWith("Second reply");
    await act(async () =>
      container.querySelector<HTMLButtonElement>(`[aria-label="${i18n.t("chatActions.copyCode")}"]`)!.click(),
    );
    expect(copy).toHaveBeenLastCalledWith("printf 'λ\\n'");
    copy.mockRejectedValueOnce(Error("clipboard denied"));
    await act(async () => buttons[0]!.click());
    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      i18n.t("chatActions.clipboardFailed"),
    );
  },
);
