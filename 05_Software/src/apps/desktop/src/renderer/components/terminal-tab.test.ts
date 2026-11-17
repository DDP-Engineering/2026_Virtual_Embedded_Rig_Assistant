// @vitest-environment jsdom
import type { TerminalSummary } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { TerminalTab } from "./terminal-tab.js";

const native = vi.hoisted(() => ({
  input: (_data: string) => {},
  resize: (_size: { cols: number; rows: number }) => {},
  write: vi.fn(),
  dispose: vi.fn(),
}));
vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.mock("../lib/terminal-document.js", () => ({
  terminalDocument: (document: Document) => ({ document, open: (fn: () => void) => fn(), dispose: () => {} }),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options = { disableStdin: false };
    loadAddon() {}
    open() {}
    focus() {}
    reset() {}
    write(data: string, parsed?: () => void) {
      native.write(data);
      queueMicrotask(() => {
        if (data.includes("\x1b[c") && !this.options.disableStdin) native.input("\x1b[?1;2c");
        parsed?.();
      });
    }
    dispose = native.dispose;
    onData(listener: typeof native.input) {
      native.input = listener;
      return { dispose() {} };
    }
    onResize(listener: typeof native.resize) {
      native.resize = listener;
      return { dispose() {} };
    }
  },
}));
vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    disconnect() {}
  },
);
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

it.each(["en", "ro", "de", "fr"])(
  "keeps %s consent and input isolated between user terminal tabs",
  async (language) => {
    await i18n.changeLanguage(language);
    vi.useFakeTimers();
    const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
    let rows: TerminalSummary[] = [];
    let delayList = false;
    let releaseList: (() => void) | undefined;
    vi.mocked(api.invoke).mockImplementation(async (channel, request) => {
      const args = request as { id?: string; shared?: boolean };
      if (channel === "terminal.list") {
        const snapshot = structuredClone(rows);
        if (delayList) {
          delayList = false;
          return await new Promise((resolve) => {
            releaseList = () => resolve(snapshot as never);
          });
        }
        return snapshot as never;
      }
      if (channel === "terminal.create") {
        const row = {
          id: `00000000-0000-4000-8000-00000000000${rows.length + 1}`,
          number: rows.length + 1,
          shared: false,
          running: true,
        };
        rows.push(row);
        return { ...row } as never;
      }
      if (channel === "terminal.output")
        return { ...rows.find((row) => row.id === args.id), output: "shell output" } as never;
      if (channel === "terminal.consent") {
        rows = rows.map((row) => (row.id === args.id ? { ...row, shared: args.shared === true } : row));
        return { ...rows.find((row) => row.id === args.id) } as never;
      }
      if (channel === "terminal.close") rows = rows.filter((row) => row.id !== args.id);
      return {} as never;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(createElement(TerminalTab, { workbenchId: owner })));
      expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
      expect(container.querySelector("label")?.textContent).toBe(i18n.t("terminal.consent"));
      const checkbox = () => container.querySelector<HTMLInputElement>('input[type="checkbox"]');
      expect(checkbox()?.checked).toBe(false);
      delayList = true;
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      await act(async () => checkbox()?.click());
      expect(checkbox()?.checked).toBe(true);
      await act(async () => releaseList?.());
      expect(checkbox()?.checked).toBe(true);
      const buttons = () => [...container.querySelectorAll<HTMLButtonElement>("button")];
      await act(async () =>
        buttons()
          .find((button) => button.textContent === i18n.t("terminal.new"))
          ?.click(),
      );
      expect(checkbox()?.checked).toBe(false);
      expect(container.querySelectorAll('[role="tab"]')).toHaveLength(2);
      await act(async () => container.querySelector<HTMLButtonElement>('[role="tab"]')?.click());
      expect(checkbox()?.checked).toBe(true);
      await act(async () => {
        native.input("pwd\r");
        native.resize({ cols: 60, rows: 20 });
      });
      expect(api.invoke).toHaveBeenCalledWith("terminal.input", {
        workbenchId: owner,
        id: rows[0]?.id,
        data: "pwd\r",
      });
      expect(api.invoke).toHaveBeenCalledWith("terminal.resize", {
        workbenchId: owner,
        id: rows[0]?.id,
        cols: 60,
        rows: 20,
      });
      await act(async () =>
        buttons()
          .find((button) => button.textContent === i18n.t("terminal.close"))
          ?.click(),
      );
      expect(rows).toHaveLength(1);
      expect(checkbox()?.checked).toBe(false);
      expect(native.write).toHaveBeenCalledWith("shell output");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
    expect(native.dispose).toHaveBeenCalled();
  },
);

it("renders restored and replaced history without resending terminal replies, while live queries and typing still work", async () => {
  vi.useFakeTimers();
  const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  const row: TerminalSummary = {
    id: "00000000-0000-4000-8000-000000000001",
    number: 1,
    shared: false,
    running: true,
  };
  let output = "history\x1b[c";
  vi.mocked(api.invoke).mockImplementation(async (channel) => {
    if (channel === "terminal.list") return [row] as never;
    if (channel === "terminal.output") return { ...row, output } as never;
    return {} as never;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const inputs = () => vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "terminal.input");
  try {
    await act(async () => root.render(createElement(TerminalTab, { workbenchId: owner })));
    expect(native.write).toHaveBeenCalledWith(output);
    expect(inputs()).toHaveLength(0);
    output += "live\x1b[c";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(inputs()).toHaveLength(1);
    expect(inputs()[0]?.[1]).toMatchObject({ data: "\x1b[?1;2c" });
    output = "masked history\x1b[c";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(inputs()).toHaveLength(1);
    await act(async () => native.input("ordinary user input"));
    expect(inputs()).toHaveLength(2);
    expect(inputs()[1]?.[1]).toMatchObject({ data: "ordinary user input" });
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it("answers fresh terminal startup queries once and does not answer them again after remount", async () => {
  vi.useFakeTimers();
  const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  const row: TerminalSummary = {
    id: "00000000-0000-4000-8000-000000000002",
    number: 2,
    shared: false,
    running: true,
  };
  let created = false;
  vi.mocked(api.invoke).mockImplementation(async (channel) => {
    if (channel === "terminal.list") return (created ? [row] : []) as never;
    if (channel === "terminal.create") {
      created = true;
      return row as never;
    }
    if (channel === "terminal.output") return { ...row, output: "startup\x1b[c" } as never;
    return {} as never;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const inputs = () => vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "terminal.input");
  try {
    await act(async () => root.render(createElement(TerminalTab, { workbenchId: owner })));
    expect(inputs()).toHaveLength(1);
    expect(inputs()[0]?.[1]).toMatchObject({ data: "\x1b[?1;2c" });
    await act(async () => root.render(null));
    await act(async () => root.render(createElement(TerminalTab, { workbenchId: owner })));
    expect(inputs()).toHaveLength(1);
    expect(
      vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "terminal.create"),
    ).toHaveLength(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
