// @vitest-environment jsdom
import { type TerminalSummary, veraError } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { TerminalNavigation } from "./terminal-navigation.js";
import { TerminalTab } from "./terminal-tab.js";

const native = vi.hoisted(() => ({
  input: (_data: string) => {},
  resize: (_size: { cols: number; rows: number }) => {},
  write: vi.fn(),
  reset: vi.fn(),
  dispose: vi.fn(),
  created: vi.fn(),
  fit: vi.fn(),
}));
vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.mock("../lib/terminal-document.js", () => ({
  terminalDocument: (document: Document) => ({ document, open: (fn: () => void) => fn(), dispose: () => {} }),
}));
vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: { disableStdin: boolean; fontSize: number };
    constructor(options: { disableStdin: boolean; fontSize: number }) {
      this.options = { ...options };
      native.created(this);
    }
    loadAddon() {}
    open() {}
    focus() {}
    reset = native.reset;
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
    fit = native.fit;
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

it("updates the mounted terminal font and refits immediately when code text size changes", async () => {
  const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  const row: TerminalSummary = {
    id: "00000000-0000-4000-8000-000000000001",
    number: 1,
    shared: false,
    shell: "bash",
    dispatchEligible: false,
    running: true,
  };
  vi.mocked(api.invoke).mockImplementation(async (channel) => {
    if (channel === "terminal.list") return [row] as never;
    if (channel === "terminal.output") return { ...row, output: "retained shell history" } as never;
    return {} as never;
  });
  const documentRoot = document.documentElement;
  const previous = documentRoot.style.getPropertyValue("--code-font-size");
  documentRoot.style.setProperty("--code-font-size", "20px");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(TerminalTab, { workbenchId: owner })));
    const term = native.created.mock.calls[0]?.[0] as { options: { fontSize: number } };
    expect(term.options.fontSize).toBe(20);
    const surface = container.querySelector(".terminal-surface");
    Object.defineProperties(surface, { clientWidth: { value: 600 }, clientHeight: { value: 300 } });
    for (const size of [10, 12, 14, 16, 20, 24]) {
      const fits = native.fit.mock.calls.length;
      await act(async () => documentRoot.style.setProperty("--code-font-size", `${size}px`));
      expect(term.options.fontSize).toBe(size);
      expect(native.fit).toHaveBeenCalledTimes(fits + 1);
    }
    await act(async () => documentRoot.style.removeProperty("--code-font-size"));
    expect(term.options.fontSize).toBe(14);
    expect(native.created).toHaveBeenCalledTimes(1);
    expect(native.dispose).not.toHaveBeenCalled();
    expect(native.write).toHaveBeenCalledExactlyOnceWith("retained shell history");
  } finally {
    await act(async () => root.unmount());
    container.remove();
    if (previous) documentRoot.style.setProperty("--code-font-size", previous);
    else documentRoot.style.removeProperty("--code-font-size");
  }
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
          shell: "bash" as const,
          dispatchEligible: false,
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
          .find((button) => button.getAttribute("aria-label") === i18n.t("terminal.new"))
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
          .find((button) => button.getAttribute("aria-label") === i18n.t("terminal.close"))
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
    shell: "bash",
    dispatchEligible: false,
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

it("appends only the new tail when the host trims the head of a full buffer", async () => {
  vi.useFakeTimers();
  const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  const row: TerminalSummary = {
    id: "00000000-0000-4000-8000-000000000001",
    number: 1,
    shared: false,
    shell: "bash",
    dispatchEligible: false,
    running: true,
  };
  let snapshot = { output: "line 1\nline 2\n", start: 0 };
  vi.mocked(api.invoke).mockImplementation(async (channel) => {
    if (channel === "terminal.list") return [row] as never;
    if (channel === "terminal.output") return { ...row, ...snapshot } as never;
    return {} as never;
  });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const next = async (value: typeof snapshot) => {
    snapshot = value;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
  };
  try {
    await act(async () => root.render(createElement(TerminalTab, { workbenchId: owner })));
    expect(native.write).toHaveBeenLastCalledWith("line 1\nline 2\n");
    await next({ output: "line 2\nline 3\n", start: 7 });
    expect(native.write).toHaveBeenLastCalledWith("line 3\n");
    await next({ output: "line 9\n", start: 60 });
    expect(native.write).toHaveBeenLastCalledWith("line 9\n");
    expect(native.reset).not.toHaveBeenCalled();
    await next({ output: "masked\n", start: 60 });
    expect(native.reset).toHaveBeenCalledTimes(1);
    expect(native.write).toHaveBeenLastCalledWith("masked\n");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

it.each(["panel", "chat"])(
  "answers %s startup queries once and does not answer them again after remount",
  async (source) => {
    vi.useFakeTimers();
    const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
    const row: TerminalSummary = {
      id: "00000000-0000-4000-8000-000000000002",
      number: 2,
      shared: false,
      shell: "bash",
      dispatchEligible: false,
      running: true,
    };
    let created = source === "chat";
    const terminalView = createElement(TerminalTab, { workbenchId: owner });
    const view =
      source === "chat"
        ? createElement(
            TerminalNavigation.Provider,
            {
              value: { workbenchId: owner, available: true, target: { id: row.id }, reveal() {} },
            },
            terminalView,
          )
        : terminalView;
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
      await act(async () => root.render(view));
      expect(inputs()).toHaveLength(1);
      expect(inputs()[0]?.[1]).toMatchObject({ data: "\x1b[?1;2c" });
      await act(async () => root.render(null));
      await act(async () => root.render(view));
      expect(inputs()).toHaveLength(1);
      expect(
        vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === "terminal.create"),
      ).toHaveLength(source === "chat" ? 0 : 1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);

it.each([true, false])(
  "suspends terminal I/O during close and recovers correctly (success: %s)",
  async (success) => {
    vi.useFakeTimers();
    const owner = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
    const row: TerminalSummary = {
      id: "00000000-0000-4000-8000-000000000001",
      number: 1,
      shared: false,
      shell: "bash",
      dispatchEligible: false,
      running: true,
    };
    let rows = [row],
      finished = false;
    let finishClose: (() => void) | undefined;
    const failures: ((error: unknown) => void)[] = [];
    vi.mocked(api.invoke).mockImplementation(async (channel) => {
      if (channel === "terminal.list") return rows as never;
      if (channel === "terminal.create") {
        rows = [{ ...row, id: "00000000-0000-4000-8000-000000000002", number: 2 }];
        return rows[0] as never;
      }
      if (channel === "terminal.close")
        return await new Promise<never>((resolve, reject) => {
          finishClose = () => {
            finished = true;
            if (success) {
              rows = [];
              resolve({} as never);
            } else reject(veraError("DENIED"));
          };
        });
      if (["terminal.output", "terminal.input", "terminal.resize"].includes(channel)) {
        if (!finished) return await new Promise<never>((_resolve, reject) => failures.push(reject));
        return { ...rows[0], output: "ready" } as never;
      }
      return {} as never;
    });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const ioCalls = () =>
      vi
        .mocked(api.invoke)
        .mock.calls.filter(([channel]) =>
          ["terminal.output", "terminal.input", "terminal.resize"].includes(channel),
        );
    try {
      await act(async () => root.render(createElement(TerminalTab, { workbenchId: owner })));
      await act(async () => {
        native.input("pwd\r");
        native.resize({ cols: 60, rows: 20 });
      });
      expect(failures).toHaveLength(3);
      await act(async () =>
        container.querySelector<HTMLButtonElement>(".terminal-actions button:last-child")?.click(),
      );
      await act(async () => {
        for (const reject of failures) reject(veraError("NOT_FOUND"));
      });
      expect(container.querySelector('[role="alert"]')).toBeNull();
      const calls = ioCalls().length;
      await act(async () => {
        native.input("ignored while closing");
        native.resize({ cols: 80, rows: 24 });
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(ioCalls()).toHaveLength(calls);
      await act(async () => finishClose?.());
      if (success) {
        expect(container.querySelectorAll('[role="tab"]')).toHaveLength(0);
        expect(container.querySelector('[role="alert"]')).toBeNull();
        await act(async () =>
          container.querySelector<HTMLButtonElement>(".terminal-actions button")?.click(),
        );
        expect(container.querySelector("[data-terminal-id]")?.getAttribute("data-terminal-id")).toBe(
          rows[0]?.id,
        );
      } else {
        expect(container.querySelectorAll('[role="tab"]')).toHaveLength(1);
        expect(container.querySelector('[role="alert"]')?.getAttribute("data-i18n")).toBe("errors.DENIED");
        await act(async () => vi.advanceTimersByTimeAsync(250));
        expect(ioCalls().length).toBeGreaterThan(calls);
      }
      expect(native.write).toHaveBeenCalledWith("ready");
    } finally {
      if (!finished) await act(async () => finishClose?.());
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
