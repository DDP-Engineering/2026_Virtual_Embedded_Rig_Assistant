// @vitest-environment jsdom
// REQ-UX-388cf31a REQ-UX-712804c9 REQ-FUNC-89161a95 REQ-UX-37821e01 REQ-UX-89428322 REQ-UX-1f53a583
// REQ-UX-5fc1d7d3 REQ-UX-be7140e4 REQ-UX-d64f086f REQ-REL-6fc27952
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ViewerContent } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { removeTabs, tabStorageKey } from "../../lib/document-tabs-store.js";
import { DocumentTabs } from "./document-tabs.js";
import {
  DocumentViewerProvider,
  documentKey,
  useDocumentTabs,
  useDocumentViewer,
  type ViewerTarget,
} from "./viewer-context.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
// jsdom has no modal dialogs; Properties opens one.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.removeAttribute("open");
};
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const tabOwner = (sessionId: string, folder = "/mock/demo-board") => ({ folder, workbenchId: id, sessionId });
const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 50));
  });

let root: Root | undefined;
let container: HTMLElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
  localStorage.removeItem("vera.viewer.modes");
});

/** Buttons that open targets, rendered outside the tabs like the Files tree and citation chips. */
function Openers({ targets }: { targets: Record<string, ViewerTarget> }) {
  const open = useDocumentViewer();
  return createElement(
    "div",
    { "data-openers": true },
    ...Object.entries(targets).map(([name, target]) =>
      createElement(
        "button",
        { key: name, type: "button", "data-open": name, onClick: () => open?.(target) },
        name,
      ),
    ),
  );
}
const targets: Record<string, ViewerTarget> = {
  binary: { textPath: "board.bin" },
  mdHex: { textPath: "docs/a.md", hex: true },
  unindexed: { textPath: "unindexed.md" },
  md: { path: "docs/a.md" },
  archivedMd: { path: "archive/a.md" },
  recordedEdit: { sessionChange: { sessionId: "tab-actions", changeId: 1, path: "docs/a.md" } },
  mdOther: { path: "docs/other.md" },
  reset: { ref: "docs/a.md#h=reset" },
  html: { path: "docs/a.html" },
  htmlRef: { ref: "docs/a.html#h=reset" },
  artifact: { ref: "artifact:notes.md" },
  power: { ref: "docs/a.md#h=power" },
  download: { downloadId: "dl_01JB8Z6Q4M7N2K5R9T3V8X1Y0C" },
  board: { path: "board.txt" },
  log: { textPath: "logs/big.log" },
  run: { runId: "01JC00000000000000000000R2" },
  logLine: { ref: "logs/big.log#L5-L5" },
};

it("defaults unknown files to Hex and offers explicit Text without loading whole text first", async () => {
  const { open, view } = await mount();
  const original = api.invoke.bind(api);
  const spy = vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    const data = request as { path?: string; offset?: number };
    if (data.path === "board.bin" && channel === "docs.stat")
      return {
        workbenchId: id,
        properties: {
          path: "board.bin",
          extension: ".bin",
          type: "file",
          size: 2,
          modified: "2026-11-17T00:00:00.000Z",
        },
      };
    if (data.path === "board.bin" && channel === "docs.readBytes")
      return { workbenchId: id, path: "board.bin", offset: data.offset, size: 2, data: "AP8=" };
    return original(channel as never, request as never);
  }) as typeof api.invoke);
  await open("binary");
  expect(view.querySelector("[data-hex-viewer]")).not.toBeNull();
  expect(view.querySelector('[data-viewer-mode="text"]')).not.toBeNull();
  expect(view.querySelector('[data-viewer-mode="rendered"]')).toBeNull();
  expect(spy.mock.calls.some(([channel]) => channel === "docs.open")).toBe(false);
  await act(async () => view.querySelector<HTMLButtonElement>('[data-viewer-mode="text"]')?.click());
  await settle();
  expect(view.querySelector("[data-show-as-text]")).not.toBeNull();
  await act(async () => view.querySelector<HTMLButtonElement>("[data-show-as-text]")?.click());
  expect(view.querySelector('[data-line="1"]')?.textContent).toContain("�");
  localStorage.removeItem("vera.viewer.modes");
});

it("switches Markdown through all modes, remembers another real extension and keeps citation provenance", async () => {
  const original = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    const data = request as { path?: string };
    if (data.path !== "docs/other.md") return original(channel as never, request as never);
    const reply = (await original(channel as never, { ...data, path: "docs/a.md" } as never)) as {
      properties: object;
    };
    if (channel === "docs.stat")
      return { ...reply, properties: { ...(reply as { properties: object }).properties, path: data.path } };
    return { ...reply, path: data.path };
  }) as typeof api.invoke);
  const h = await mount();
  await h.open("md");
  expect(h.view.querySelector('[data-heading="reset"]')).not.toBeNull();
  const choose = async (mode: string) => {
    await act(async () => h.view.querySelector<HTMLButtonElement>(`[data-viewer-mode="${mode}"]`)?.click());
    await settle();
  };
  await choose("text");
  expect(h.view.querySelector("[data-text-encoding]")).not.toBeNull();
  await choose("hex");
  expect(h.view.querySelector("[data-hex-viewer]")).not.toBeNull();
  await h.open("mdOther");
  expect(h.view.querySelector('[data-viewer-mode="hex"]')?.getAttribute("aria-pressed")).toBe("true");
  await choose("rendered");
  await h.open("md");
  expect(h.view.querySelector('[data-heading="reset"]')).not.toBeNull();
  await h.open("power");
  expect(h.view.querySelector("[data-viewer-mode]")).toBeNull();
  expect(h.view.querySelector('[data-heading="power"]')?.getAttribute("aria-current")).toBe("true");
  localStorage.removeItem("vera.viewer.modes");
});

it("keeps mode controls on a rendered failure and rejects a late rendered answer after switching", async () => {
  const original = api.invoke.bind(api);
  let release: ((value: unknown) => void) | undefined;
  let fail = true;
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    if (channel !== "docs.open") return original(channel as never, request as never);
    if (fail) throw Object.assign(Error("not indexed"), { code: "NOT_FOUND" });
    return new Promise<unknown>((done) => {
      release = done;
    });
  }) as typeof api.invoke);
  const h = await mount();
  await h.open("md");
  expect(h.view.querySelector('[role="alert"]')).not.toBeNull();
  expect(h.view.querySelectorAll("[data-viewer-mode]")).toHaveLength(3);
  expect(localStorage.getItem("vera.viewer.modes")).toBeNull();
  fail = false;
  await h.open("md");
  await act(async () => h.view.querySelector<HTMLButtonElement>('[data-viewer-mode="hex"]')?.click());
  await settle();
  expect(h.view.querySelector("[data-hex-viewer]")).not.toBeNull();
  await act(async () =>
    release?.({
      workbenchId: id,
      content: {
        kind: "markdown",
        path: "docs/a.md",
        ref: null,
        snippet: "",
        sections: [{ slug: "stale", path: [], text: "late answer", start: 1, end: 1 }],
        anchor: null,
      },
    }),
  );
  await settle();
  expect(h.view.querySelector("[data-hex-viewer]")).not.toBeNull();
  expect(h.view.textContent).not.toContain("late answer");
});

it("remembers explicit Files Hex by real extension and replaces its saved override after a toolbar choice", async () => {
  const session = "mode-menu";
  const h = await mount(`${id}/${session}`, session);
  await h.open("mdHex");
  expect(h.view.querySelector("[data-hex-viewer]")).not.toBeNull();
  expect(JSON.parse(localStorage.getItem("vera.viewer.modes") ?? "null").extensions[".md"]).toBe("hex");
  await act(async () => h.view.querySelector<HTMLButtonElement>('[data-viewer-mode="text"]')?.click());
  await settle();
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(JSON.parse(localStorage.getItem(tabStorageKey(tabOwner(session))) ?? "null").tabs[0].target).toEqual(
    {
      textPath: "docs/a.md",
    },
  );
  await h.open("md");
  expect(h.view.querySelector('[data-viewer-mode="text"]')?.getAttribute("aria-pressed")).toBe("true");
  removeTabs(localStorage, tabOwner(session));
});

it("remembers clicking the active Text fallback without reloading and applies it to indexed Markdown", async () => {
  localStorage.setItem(
    "vera.viewer.modes",
    JSON.stringify({ version: 1, extensions: { ".md": "rendered" } }),
  );
  const original = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    const data = request as { path?: string; offset?: number };
    if (data.path === "unindexed.md" && channel === "docs.stat")
      return {
        workbenchId: id,
        properties: {
          path: data.path,
          extension: ".md",
          rendered: false,
          type: "file",
          size: 4,
          modified: "2026-11-17T00:00:00.000Z",
        },
      };
    if (data.path === "unindexed.md" && channel === "docs.readBytes")
      return { workbenchId: id, path: data.path, offset: data.offset, size: 4, data: btoa("# ok") };
    return original(channel as never, request as never);
  }) as typeof api.invoke);
  const h = await mount();
  await h.open("unindexed");
  const body = h.view.querySelector(".document-body");
  expect(h.view.querySelector('[data-viewer-mode="text"]')?.getAttribute("aria-pressed")).toBe("true");
  await act(async () => h.view.querySelector<HTMLButtonElement>('[data-viewer-mode="text"]')?.click());
  await settle();
  expect(JSON.parse(localStorage.getItem("vera.viewer.modes") ?? "null").extensions[".md"]).toBe("text");
  expect(h.view.querySelector(".document-body")).toBe(body);
  await h.open("md");
  expect(h.view.querySelector('[data-viewer-mode="text"]')?.getAttribute("aria-pressed")).toBe("true");
});

it("opens complete run logs by ID in the text viewer and rejects mismatched replies", async () => {
  const { open } = await mount();
  const original = api.invoke.bind(api);
  const spy = vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) =>
    channel === "runs.log"
      ? {
          id: targets.run && "runId" in targets.run ? targets.run.runId : "",
          text: "FIRST\nLAST\n",
          truncated: false,
          running: false,
        }
      : original(channel as never, request as never)) as typeof api.invoke);
  await open("run");
  expect(spy).toHaveBeenCalledWith("runs.log", {
    workbenchId: id,
    id: "01JC00000000000000000000R2",
    full: true,
  });
  expect(container?.querySelector(".document-body")?.textContent).toContain("FIRST");
  expect(container?.querySelector(".document-body")?.textContent).toContain("LAST");
  spy.mockImplementation((async (channel: string, request: unknown) =>
    channel === "runs.log"
      ? { id: "01JC00000000000000000000R3", text: "wrong owner", truncated: false, running: false }
      : original(channel as never, request as never)) as typeof api.invoke);
  await open("run");
  expect(container?.textContent).not.toContain("wrong owner");
  expect(container?.querySelector("[data-source-current]")?.textContent).toContain("Retry");
});

const serveRunLog = (truncated: boolean) => {
  const original = api.invoke.bind(api);
  const spy = vi
    .spyOn(api, "invoke")
    .mockImplementation((async (channel: string, request: unknown) =>
      channel === "runs.log"
        ? { id: "01JC00000000000000000000R2", text: "LATE\nLAST\n", truncated, running: false }
        : original(channel as never, request as never)) as typeof api.invoke);
  return () => spy.mock.calls.filter(([channel]) => channel === "runs.log").length;
};

it("shows the tail of a run log longer than the host sends, under a line that says so", async () => {
  const { open } = await mount();
  serveRunLog(true);
  await open("run");
  const body = container?.querySelector(".document-body")?.textContent;
  expect(body).toContain("[Earlier output is not shown.]");
  expect(body).toContain("LAST");
});

it("keeps open documents on a theme change and loads them again on a masking change", async () => {
  const { open } = await mount();
  await api.invoke("app.settings.update", { theme: "light", privacy: { mask: { runs: false } } });
  const loads = serveRunLog(false);
  await open("run");
  expect(loads()).toBe(1);
  await act(async () => {
    await api.invoke("app.settings.update", { theme: "dark" });
  });
  await settle();
  expect(loads()).toBe(1);
  expect(container?.querySelector(".document-body")?.textContent).toContain("LAST");
  await act(async () => {
    await api.invoke("app.settings.update", { privacy: { mask: { runs: true } } });
  });
  await settle();
  expect(loads()).toBe(2);
});

it("retires a comparison opener when the workbench lease changes", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const target = { gitDiff: { path: "board.txt", indexLease: 1, comparison: "staged" } } as const;
  const key = documentKey(target);
  const observe = vi.fn<(state: ReturnType<typeof useDocumentTabs>) => void>();
  function Inspect() {
    observe(useDocumentTabs());
    return null;
  }
  const render = (gitLease: number) =>
    act(async () =>
      root?.render(
        createElement(
          DocumentViewerProvider,
          { workbenchId: id, gitLease },
          createElement(Openers, { targets: { comparison: target } }),
          createElement(Inspect),
        ),
      ),
    );
  await render(1);
  const opener = container.querySelector<HTMLButtonElement>("button");
  await act(async () => {
    opener?.focus();
    opener?.click();
  });
  const latest = () => observe.mock.lastCall?.[0];
  expect(latest()?.tabs.map((t) => t.key)).toEqual([key]);
  expect(latest()?.opener(key)).toBe(opener);
  await render(2);
  expect(latest()?.tabs).toEqual([]);
  expect(latest()?.opener(key)).toBeNull();
  await render(1);
  await act(async () => opener?.click());
  await act(async () => latest()?.close(key));
  expect(latest()?.canReopen).toBe(true);
  await render(2);
  expect(latest()?.canReopen).toBe(false);
});

async function mount(scope = `${id}/session-a`, sessionId?: string) {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const reveal = vi.fn();
  const render = (next: string, workbenchFolder = "/mock/demo-board") =>
    act(async () =>
      root?.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            DocumentViewerProvider,
            { workbenchId: id, workbenchFolder, scope: next, sessionId, reveal },
            createElement(Openers, { targets }),
            createElement(DocumentTabs, {
              chat: createElement("textarea", { "aria-label": "Message", "data-chat": true }),
            }),
          ),
        ),
      ),
    );
  await render(scope);
  const view = container;
  const open = async (name: string) => {
    await act(async () => view.querySelector<HTMLButtonElement>(`[data-open="${name}"]`)?.click());
    await settle();
  };
  const tabs = () =>
    [...view.querySelectorAll<HTMLElement>('[role="tablist"][data-document-tabs] [role="tab"]')].map(
      (tab) => tab.textContent,
    );
  const selected = () =>
    view.querySelector<HTMLElement>('[data-document-tabs] [role="tab"][aria-selected="true"]')?.textContent;
  const tab = (name: string) =>
    [...view.querySelectorAll<HTMLElement>('[data-document-tabs] [role="tab"]')].find(
      (t) => t.textContent === name,
    );
  const close = (name: string) =>
    view.querySelector<HTMLButtonElement>(`[data-action="close-tab"][data-tab-label="${name}"]`);
  return { view, reveal, render, open, tabs, selected, tab, close };
}

/** A long log so the text viewer has more than one 250-line window. */
function bigLog(lines = 600): ViewerContent {
  return {
    kind: "text",
    path: "logs/big.log",
    ref: null,
    snippet: "",
    lines: Array.from({ length: lines }, (_, i) => `uart ${i + 1}`),
    start: 1,
    end: lines,
  };
}
function serveBigLog() {
  const original = api.invoke.bind(api);
  const log = bigLog();
  const bytes = new TextEncoder().encode(log.kind === "text" ? log.lines.join("\n") : "");
  return vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    const data = request as { path?: string; ref?: string; offset: number; length: number };
    if (channel === "docs.read" && data.path === "logs/big.log")
      return { workbenchId: id, content: bigLog() } as never;
    if (channel === "docs.stat" && data.path === "logs/big.log")
      return {
        workbenchId: id,
        properties: {
          path: data.path,
          extension: ".log",
          type: "file",
          size: bytes.length,
          modified: "2026-10-13T00:00:00.000Z",
        },
      } as never;
    if (channel === "docs.readBytes" && data.path === "logs/big.log")
      return {
        workbenchId: id,
        path: data.path,
        size: bytes.length,
        offset: data.offset,
        data: btoa(
          Array.from(bytes.slice(data.offset, data.offset + data.length), (byte) =>
            String.fromCharCode(byte),
          ).join(""),
        ),
      } as never;
    if (channel === "docs.open" && data.ref === "logs/big.log#L5-L5")
      return { workbenchId: id, content: { ...bigLog(), ref: data.ref, start: 5, end: 5 } } as never;
    return original(channel as never, request as never);
  });
}

it("shows Chat first without a close button and one labelled tab per opened document", async () => {
  const h = await mount();
  expect(h.tabs()).toEqual(["Chat"]);
  expect(h.selected()).toBe("Chat");
  expect(h.view.querySelector('[data-action="close-tab"]')).toBeNull();
  await h.open("md");
  await h.open("board");
  expect(h.tabs()).toEqual(["Chat", "a.md", "board.txt"]);
  expect(h.selected()).toBe("board.txt");
  expect(h.tab("a.md")?.title).toBe("docs/a.md");
  await h.open("artifact");
  expect(h.tabs()).toEqual(["Chat", "a.md", "board.txt", "notes.md"]);
  await act(async () => h.tab("board.txt")?.click());
  expect(h.close("a.md")).not.toBeNull();
  expect(h.view.querySelector("[data-source-current]")?.textContent).toContain("Board uses 3.3 V.");
  // Opening asks the app to show the chat area (it may be hidden behind the workbench page).
  expect(h.reveal).toHaveBeenCalledTimes(3);
});

it("selects the open tab of a document at the newly requested place instead of adding a tab", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("htmlRef");
  expect(h.tabs()).toEqual(["Chat", "a.md", "a.html"]);
  await h.open("reset");
  expect(h.tabs()).toEqual(["Chat", "a.md", "a.html"]);
  expect(h.selected()).toBe("a.md");
  expect(h.view.querySelector('[data-heading="reset"]')?.getAttribute("aria-current")).toBe("true");
});

it("closes a tab from its button or a middle click and selects the right, left, then Chat tab", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("board");
  await h.open("html");
  await act(async () => h.tab("board.txt")?.click());
  await act(async () => h.close("board.txt")?.click());
  expect(h.tabs()).toEqual(["Chat", "a.md", "a.html"]);
  expect(h.selected()).toBe("a.html");
  // Closing a tab that is not selected keeps the selection.
  await act(async () => h.close("a.md")?.click());
  expect(h.selected()).toBe("a.html");
  await h.open("md");
  expect(h.tabs()).toEqual(["Chat", "a.html", "a.md"]);
  await act(async () => {
    h.tab("a.md")?.dispatchEvent(new MouseEvent("auxclick", { bubbles: true, button: 1 }));
  });
  expect(h.tabs()).toEqual(["Chat", "a.html"]);
  await h.open("md");
  await act(async () => {
    h.tab("a.md")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  });
  expect(h.tabs()).toEqual(["Chat", "a.html"]);
  await act(async () => {
    h.tab("Chat")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
  });
  expect(h.tabs()).toEqual(["Chat", "a.html"]);
  expect(h.selected()).toBe("a.html");
  await act(async () => h.close("a.html")?.click());
  expect(h.tabs()).toEqual(["Chat"]);
  expect(h.selected()).toBe("Chat");
});

it("keeps each document's place and the conversation draft while switching tabs", async () => {
  serveBigLog();
  const h = await mount();
  await h.open("log");
  // One continuous scroll: scrolling to line 251 (20 px lines in a test DOM) renders it.
  const lines = h.view.querySelector<HTMLElement>("[data-source-current] .document-body");
  if (lines) Object.defineProperty(lines, "scrollTop", { configurable: true, writable: true, value: 5000 });
  await act(async () => lines?.dispatchEvent(new Event("scroll")));
  expect(h.view.querySelector('[data-line="251"]')?.textContent).toBe("251uart 251");
  await act(async () => h.tab("Chat")?.click());
  const draft = h.view.querySelector<HTMLTextAreaElement>("[data-chat]");
  if (draft) draft.value = "unsent question";
  expect(h.view.querySelector("[data-line]")).toBeNull();
  // The tab comes back with line 251 at the top again.
  const restored = vi.spyOn(Element.prototype, "scrollTop", "set");
  await act(async () => h.tab("big.log")?.click());
  expect(restored).toHaveBeenCalledWith(5000);
  restored.mockRestore();
  await act(async () => h.tab("Chat")?.click());
  // The conversation stays mounted: the same element keeps its draft (and its scroll).
  expect(h.view.querySelector<HTMLTextAreaElement>("[data-chat]")).toBe(draft);
  expect(h.view.querySelector<HTMLTextAreaElement>("[data-chat]")?.value).toBe("unsent question");
  // A scrolled document comes back at its scroll offset.
  await h.open("md");
  const body = h.view.querySelector<HTMLElement>("[data-source-current] .document-body");
  if (body) Object.defineProperty(body, "scrollTop", { configurable: true, writable: true, value: 120 });
  await act(async () => body?.dispatchEvent(new Event("scroll")));
  const scrolled = vi.spyOn(Element.prototype, "scrollTop", "set");
  await act(async () => h.tab("Chat")?.click());
  await act(async () => h.tab("a.md")?.click());
  expect(scrolled).toHaveBeenCalledWith(120);
  await act(async () => h.tab("big.log")?.click());
  // A new citation to the open log replaces its kept place with the cited line.
  await h.open("logLine");
  expect(h.tabs()).toEqual(["Chat", "big.log", "a.md"]);
  expect(h.view.querySelector("[data-line]")?.getAttribute("data-line")).toBe("1");
  expect(h.view.querySelector('[data-line="5"]')?.getAttribute("aria-current")).toBe("true");
});

it("keeps each session's own tabs for the run and shows them again when the session returns", async () => {
  const h = await mount(`${id}/session-a`);
  await h.open("md");
  await h.render(`${id}/session-b`);
  expect(h.tabs()).toEqual(["Chat"]);
  await h.open("html");
  expect(h.tabs()).toEqual(["Chat", "a.html"]);
  await h.render(`${id}/session-a`);
  await settle();
  expect(h.tabs()).toEqual(["Chat", "a.md"]);
  expect(h.selected()).toBe("a.md");
  await h.render(`${id}/session-b`);
  expect(h.tabs()).toEqual(["Chat", "a.html"]);
  // Another workbench's session starts empty; coming back keeps both sessions' tabs.
  await h.render("wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0D/session-c");
  expect(h.tabs()).toEqual(["Chat"]);
  await h.render(`${id}/session-a`);
  expect(h.tabs()).toEqual(["Chat", "a.md"]);
});

it("moves between tabs with the arrow keys, Home and End, wrapping at the ends", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("board");
  const key = (target: HTMLElement | undefined, init: KeyboardEventInit) =>
    act(async () => {
      target?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
    });
  await act(async () => h.tab("Chat")?.click());
  await key(h.tab("Chat"), { key: "ArrowRight" });
  expect(h.selected()).toBe("a.md");
  expect(document.activeElement).toBe(h.tab("a.md"));
  await key(h.tab("a.md"), { key: "ArrowLeft" });
  await key(h.tab("Chat"), { key: "ArrowLeft" });
  expect(h.selected()).toBe("board.txt");
  await key(h.tab("board.txt"), { key: "Home" });
  expect(h.selected()).toBe("Chat");
  await key(h.tab("Chat"), { key: "End" });
  expect(h.selected()).toBe("board.txt");
  await key(h.tab("board.txt"), { key: "ArrowRight", ctrlKey: true });
  expect(h.selected()).toBe("board.txt");
});

it("moves focus into an opened document and back to its opener on Escape, else to the Chat tab", async () => {
  const h = await mount();
  const opener = h.view.querySelector<HTMLButtonElement>('[data-open="reset"]');
  opener?.focus();
  await act(async () => opener?.click());
  await settle();
  const panel = h.view.querySelector("[data-source-current]");
  expect(panel?.contains(document.activeElement)).toBe(true);
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(h.selected()).toBe("Chat");
  expect(document.activeElement).toBe(opener);
  // An opener that is gone hands focus to the Chat tab.
  const gone = h.view.querySelector<HTMLButtonElement>('[data-open="html"]');
  gone?.focus();
  await act(async () => gone?.click());
  await settle();
  gone?.remove();
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(h.selected()).toBe("Chat");
  expect(document.activeElement).toBe(h.tab("Chat"));
  // An opener inside a hidden region hands focus to the Chat tab as well.
  const hidden = h.view.querySelector<HTMLButtonElement>('[data-open="board"]');
  hidden?.focus();
  await act(async () => hidden?.click());
  await settle();
  const openers = h.view.querySelector<HTMLElement>("[data-openers]");
  if (openers) openers.hidden = true;
  await act(async () => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(document.activeElement).toBe(h.tab("Chat"));
});

it("shows a document's load error with Retry in its own tab and keeps the other tabs usable", async () => {
  const original = api.invoke.bind(api);
  let fail = true;
  vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    if (channel === "docs.open" && (request as { path?: string }).path === "docs/a.html" && fail) {
      fail = false;
      throw { code: "INTERNAL", messageKey: "errors.INTERNAL" };
    }
    return original(channel as never, request as never);
  });
  const h = await mount();
  await h.open("md");
  await h.open("html");
  const retry = [...h.view.querySelectorAll<HTMLButtonElement>("button")].find(
    (b) => b.textContent === "Retry",
  );
  expect(retry).toBeDefined();
  await act(async () => h.tab("a.md")?.click());
  expect(h.view.querySelector('[data-heading="power"]')).not.toBeNull();
  await act(async () => h.tab("a.html")?.click());
  await act(async () =>
    [...h.view.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Retry")?.click(),
  );
  await settle();
  expect(h.view.querySelector('[data-heading="power"]')).not.toBeNull();
  expect(h.view.querySelector("[data-source-current]")?.contains(document.activeElement)).toBe(true);
  // A citation to a failed document retries it in the same tab.
  fail = true;
  await h.open("html");
  expect(h.view.querySelector('[role="alert"]')).not.toBeNull();
  await h.open("htmlRef");
  expect(h.tabs()).toEqual(["Chat", "a.md", "a.html"]);
  expect(h.view.querySelector('[data-heading="reset"]')?.getAttribute("aria-current")).toBe("true");
});

it("ignores the late answer of a closed tab when the same document is opened again", async () => {
  const original = api.invoke.bind(api);
  let release: () => void = () => {};
  vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    if (channel === "docs.open" && (request as { ref?: string }).ref === "docs/a.md#h=power")
      await new Promise<void>((done) => {
        release = done;
      });
    return original(channel as never, request as never);
  });
  const h = await mount();
  await h.open("power");
  await act(async () => h.close("a.md")?.click());
  await h.open("reset");
  expect(h.view.querySelector('[data-heading="reset"]')?.getAttribute("aria-current")).toBe("true");
  await act(async () => release());
  await settle();
  expect(h.tabs()).toEqual(["Chat", "a.md"]);
  expect(h.view.querySelector('[data-heading="reset"]')?.getAttribute("aria-current")).toBe("true");
  expect(h.view.querySelector('[data-heading="power"]')?.getAttribute("aria-current")).toBeNull();
});

// ---- TASK-6c4aeed8: reorder, menu, keys, bare panel and file actions
// REQ-UX-e0410483 REQ-UX-6ecb6c83 REQ-UX-67abf562 REQ-UX-fd131983 REQ-UX-a45c4384 REQ-UX-968b89b0
// REQ-UX-f261c988 REQ-UX-f5d6e9e4
const menuActions = (view: HTMLElement) =>
  [...view.querySelectorAll<HTMLElement>('[data-tree-menu] [data-menu-depth="0"]')].map((item) => [
    item.dataset.menuAction,
    item.getAttribute("aria-disabled") === "true",
  ]);
async function openMenu(h: Awaited<ReturnType<typeof mount>>, name: string) {
  await act(async () => {
    h.tab(name)?.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }),
    );
  });
  await settle();
}
const runItem = (view: HTMLElement, action: string) =>
  act(async () =>
    view.querySelector<HTMLElement>(`[data-tree-menu] [data-menu-action="${action}"]`)?.click(),
  );
const press = (init: KeyboardEventInit) =>
  act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }));
  });
const closeMenu = () =>
  act(async () => {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });

it("reopens the last closed document or diff in order and within the session", async () => {
  const h = await mount(`${id}/tab-actions`, "tab-actions");
  const reopen = () => h.view.querySelector<HTMLButtonElement>('[data-action="reopen-tab"]');
  expect(reopen()?.disabled).toBe(true);
  await h.open("md");
  await h.open("recordedEdit");
  const diff = h.selected() ?? "";
  expect(diff).toContain("a.md");
  expect(diff).not.toBe("a.md");
  await act(async () => h.close("a.md")?.click());
  await act(async () => h.close(diff)?.click());
  await h.render(`${id}/tab-actions-other`);
  expect(reopen()?.disabled).toBe(true);
  await h.render(`${id}/tab-actions`);
  await act(async () => reopen()?.click());
  expect(h.selected()).toBe(diff);
  await act(async () => reopen()?.click());
  expect(h.selected()).toBe("a.md");
  expect(reopen()?.disabled).toBe(true);
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  localStorage.removeItem(tabStorageKey(tabOwner("tab-actions")));
});

it("keeps pinned tabs after Chat and protects them from both bulk-close actions", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("html");
  await h.open("board");
  await openMenu(h, "board.txt");
  expect(menuActions(h.view)).toContainEqual(["pin", false]);
  await runItem(h.view, "pin");
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md", "a.html"]);
  await press({ key: "PageDown", ctrlKey: true, shiftKey: true });
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md", "a.html"]);
  await openMenu(h, "a.md");
  await runItem(h.view, "close-right");
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md"]);
  await h.open("html");
  await openMenu(h, "a.md");
  await runItem(h.view, "close-others");
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md"]);
  await openMenu(h, "a.md");
  expect(menuActions(h.view)).toContainEqual(["close-others", true]);
  await closeMenu();
  await act(async () => h.close("board.txt")?.click());
  expect(h.tabs()).toEqual(["Chat", "a.md"]);
  await act(async () => h.view.querySelector<HTMLButtonElement>('[data-action="reopen-tab"]')?.click());
  expect(h.selected()).toBe("board.txt");
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md"]);
  await openMenu(h, "board.txt");
  await runItem(h.view, "unpin");
  expect(h.tab("board.txt")?.closest(".document-tab")?.hasAttribute("data-pinned")).toBe(false);
});

it("restores and saves pin state with the current open-tab record", async () => {
  const session = "pinned-tab-storage";
  const key = tabStorageKey(tabOwner(session));
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      active: "file:docs/a.md",
      tabs: [{ target: { path: "board.txt" }, pinned: true }, { target: { path: "docs/a.md" } }],
    }),
  );
  const h = await mount(`${id}/${session}`, session);
  await settle();
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md"]);
  expect(h.tab("board.txt")?.closest(".document-tab")?.hasAttribute("data-pinned")).toBe(true);
  await openMenu(h, "a.md");
  await runItem(h.view, "pin");
  await openMenu(h, "board.txt");
  expect(menuActions(h.view)).toContainEqual(["close-right", true]);
  await closeMenu();
  await act(async () => window.dispatchEvent(new Event("pagehide")));
  expect(stored(key).tabs.map((tab: { pinned?: true }) => tab.pinned)).toEqual([true, true]);
  localStorage.removeItem(key);
});

it("keeps saved tab pins separate for copied workbenches with identical IDs", async () => {
  const session = "copied-tabs";
  const first = "/mock/demo-board";
  const copy = "/mock/copied-board";
  const storageKey = (folder: string) => tabStorageKey(tabOwner(session, folder));
  localStorage.setItem(
    storageKey(first),
    JSON.stringify({ version: 1, active: "chat", tabs: [{ target: { path: "board.txt" }, pinned: true }] }),
  );
  const h = await mount(`${id}/${session}/first`, session);
  try {
    await settle();
    expect(h.tabs()).toEqual(["Chat", "board.txt"]);
    await h.render(`${id}/${session}/copy`, copy);
    await settle();
    expect(h.tabs()).toEqual(["Chat"]);
    await h.open("md");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(stored(storageKey(first)).tabs[0].pinned).toBe(true);
    expect(stored(storageKey(copy)).tabs.map((tab: { target: unknown }) => tab.target)).toEqual([
      { path: "docs/a.md" },
    ]);
  } finally {
    localStorage.removeItem(storageKey(first));
    localStorage.removeItem(storageKey(copy));
  }
});

it("finds duplicate filenames by their path and opens results by keyboard or mouse", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("archivedMd");
  const show = h.view.querySelector<HTMLButtonElement>('[data-action="search-tabs"]');
  await act(async () => show?.click());
  const dialog = () => h.view.querySelector<HTMLDialogElement>("dialog[open][data-tab-search]");
  const input = () => dialog()?.querySelector<HTMLInputElement>("input") ?? null;
  const results = () => [...(dialog()?.querySelectorAll<HTMLButtonElement>("[data-tab-result]") ?? [])];
  expect(results()).toHaveLength(2);
  const cancel = [...(dialog()?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
    (button) => button.textContent === "Cancel",
  );
  expect(cancel).toBeDefined();
  await act(async () => cancel?.click());
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(show);
  await act(async () => show?.click());
  const key = (path: string) => h.view.querySelector(`[role="tab"][data-tab-key="file:${path}"]`);
  expect(results().map((result) => result.textContent)).toEqual(
    expect.arrayContaining([expect.stringContaining("docs/a.md"), expect.stringContaining("archive/a.md")]),
  );
  await typeInto(input(), "A.MD");
  expect(results()).toHaveLength(2);
  await typeInto(input(), "missing");
  expect(results()).toHaveLength(0);
  await typeInto(input(), "DOCS/");
  expect(results()).toHaveLength(1);
  await keyOn(input(), "ArrowDown");
  expect(document.activeElement).toBe(results()[0]);
  await keyOn(results()[0] ?? null, "Enter");
  expect(dialog()).toBeNull();
  expect(key("docs/a.md")?.getAttribute("aria-selected")).toBe("true");
  await act(async () => show?.click());
  await typeInto(input(), "archive");
  await act(async () => results()[0]?.click());
  expect(key("archive/a.md")?.getAttribute("aria-selected")).toBe("true");
  await h.render(`${id}/another-search-session`);
  expect(show?.disabled).toBe(true);
});

it("moves a dragged document tab before the tab it is dropped on, or to the end, never before Chat", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("board");
  await h.open("html");
  const drag = async (from: string, to: Element | null | undefined) =>
    act(async () => {
      h.tab(from)?.dispatchEvent(new Event("dragstart", { bubbles: true }));
      to?.dispatchEvent(new Event("dragover", { bubbles: true, cancelable: true }));
      to?.dispatchEvent(new Event("drop", { bubbles: true, cancelable: true }));
      h.tab(from)?.dispatchEvent(new Event("dragend", { bubbles: true }));
    });
  await drag("a.html", h.tab("a.md"));
  expect(h.tabs()).toEqual(["Chat", "a.html", "a.md", "board.txt"]);
  expect(h.selected()).toBe("a.html");
  await drag("a.html", h.view.querySelector("[data-tab-strip-end]"));
  expect(h.tabs()).toEqual(["Chat", "a.md", "board.txt", "a.html"]);
  await drag("a.md", h.tab("Chat"));
  expect(h.tabs()).toEqual(["Chat", "a.md", "board.txt", "a.html"]);
  expect(h.tab("Chat")?.closest('[draggable="true"]')).toBeNull();
  await openMenu(h, "board.txt");
  await runItem(h.view, "pin");
  await drag("a.html", h.tab("board.txt"));
  await drag("board.txt", h.view.querySelector("[data-tab-strip-end]"));
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md", "a.html"]);
});

it("moves the selected document tab with Ctrl+Shift+PageUp and PageDown, staying at the ends", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("board");
  await act(async () => h.tab("a.md")?.click());
  await press({ key: "PageDown", ctrlKey: true, shiftKey: true });
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md"]);
  await press({ key: "PageDown", ctrlKey: true, shiftKey: true });
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md"]);
  await press({ key: "PageUp", ctrlKey: true, shiftKey: true });
  await press({ key: "PageUp", ctrlKey: true, shiftKey: true });
  expect(h.tabs()).toEqual(["Chat", "a.md", "board.txt"]);
  expect(h.selected()).toBe("a.md");
  await act(async () => h.tab("Chat")?.click());
  await press({ key: "PageDown", ctrlKey: true, shiftKey: true });
  expect(h.tabs()).toEqual(["Chat", "a.md", "board.txt"]);
});

it("offers Close, Close others, Close to the right and moves in a document tab's menu, none for Chat", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("board");
  await h.open("html");
  await openMenu(h, "a.md");
  expect(menuActions(h.view).slice(0, 5)).toEqual([
    ["close", false],
    ["close-others", false],
    ["close-right", false],
    ["move-left", true],
    ["move-right", false],
  ]);
  await runItem(h.view, "move-right");
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md", "a.html"]);
  await openMenu(h, "a.html");
  expect(menuActions(h.view).slice(0, 5)).toEqual([
    ["close", false],
    ["close-others", false],
    ["close-right", true],
    ["move-left", false],
    ["move-right", true],
  ]);
  await closeMenu();
  await openMenu(h, "board.txt");
  await runItem(h.view, "close-right");
  expect(h.tabs()).toEqual(["Chat", "board.txt"]);
  await h.open("md");
  await openMenu(h, "a.md");
  await runItem(h.view, "close-others");
  expect(h.tabs()).toEqual(["Chat", "a.md"]);
  await openMenu(h, "a.md");
  await runItem(h.view, "close");
  expect(h.tabs()).toEqual(["Chat"]);
  await openMenu(h, "Chat");
  expect(h.view.querySelector("[data-tree-menu]")).toBeNull();
  // Shift+F10 or the context menu key on a focused tab opens its menu too.
  await h.open("md");
  h.tab("a.md")?.focus();
  await act(async () => {
    h.tab("a.md")?.dispatchEvent(new KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true }));
  });
  expect(h.view.querySelector("[data-tree-menu]")).not.toBeNull();
  await closeMenu();
  expect(h.view.querySelector("[data-tree-menu]")).toBeNull();
  await act(async () => {
    h.tab("a.md")?.dispatchEvent(new KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true }));
  });
  expect(h.view.querySelector("[data-tree-menu]")).not.toBeNull();
});

it("switches tabs with Ctrl+Tab and Ctrl+PageUp or PageDown with wrap, except while a dialog is open", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("board");
  await act(async () => h.tab("Chat")?.click());
  await press({ key: "Tab", ctrlKey: true });
  expect(h.selected()).toBe("a.md");
  await press({ key: "PageDown", ctrlKey: true });
  expect(h.selected()).toBe("board.txt");
  await press({ key: "Tab", ctrlKey: true });
  expect(h.selected()).toBe("Chat");
  await press({ key: "Tab", ctrlKey: true, shiftKey: true });
  expect(h.selected()).toBe("board.txt");
  await press({ key: "PageUp", ctrlKey: true });
  expect(h.selected()).toBe("a.md");
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  await press({ key: "Tab", ctrlKey: true });
  expect(h.selected()).toBe("a.md");
  dialog.remove();
});

it("closes the selected document tab with Ctrl+W and does nothing on Chat or with a dialog open", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("board");
  await press({ key: "w", ctrlKey: true });
  expect(h.tabs()).toEqual(["Chat", "a.md"]);
  expect(h.selected()).toBe("a.md");
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.append(dialog);
  await press({ key: "w", ctrlKey: true });
  expect(h.tabs()).toEqual(["Chat", "a.md"]);
  dialog.remove();
  await act(async () => h.tab("Chat")?.click());
  await press({ key: "w", ctrlKey: true });
  expect(h.tabs()).toEqual(["Chat", "a.md"]);
});

it("shows only the document in a tab and offers its file actions in the tab menu", async () => {
  const original = api.invoke.bind(api);
  const calls: [string, unknown][] = [];
  let failOpen = false;
  vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    calls.push([channel, request]);
    if (channel === "app.openPath" && failOpen) throw { code: "INTERNAL", messageKey: "errors.INTERNAL" };
    return original(channel as never, request as never);
  });
  const h = await mount();
  await h.open("md");
  const panel = h.view.querySelector<HTMLElement>("[data-source-current]");
  expect(panel?.querySelector(".document-path")).toBeNull();
  expect(panel?.querySelector('[data-action="open-external"]')).toBeNull();
  expect(
    [...(panel?.querySelectorAll("button") ?? [])].filter(
      (button) => !button.closest(".document-body, .viewer-mode-toolbar"),
    ),
  ).toEqual([]);
  expect(h.tab("a.md")?.title).toBe("docs/a.md");
  await openMenu(h, "a.md");
  const actions = menuActions(h.view).map(([action]) => action);
  expect(actions).toEqual(
    expect.arrayContaining(["close", "move-right", "open-in", "reveal", "copy", "properties"]),
  );
  await act(async () => h.view.querySelector<HTMLElement>('[data-menu-action="open-in"]')?.click());
  const external = h.view.querySelector<HTMLElement>('[data-menu-action="open-external"]');
  expect(external?.textContent).toBe("Default app");
  expect(external?.getAttribute("aria-label")).toBe("Open in default app: docs/a.md");
  failOpen = true;
  await act(async () => external?.click());
  await settle();
  expect(calls).toContainEqual(["app.openPath", { path: "docs/a.md" }]);
  expect(h.view.querySelector('[data-tab-notices] [data-i18n="errors.INTERNAL"]')).not.toBeNull();
  await openMenu(h, "a.md");
  await runItem(h.view, "properties");
  await settle();
  expect(h.view.querySelector("[data-tree-properties]")?.textContent).toContain("docs/a.md");
  // Closing Properties returns focus to the tab whose menu opened it.
  await act(async () => h.view.querySelector<HTMLElement>('[data-action="close-properties"]')?.click());
  expect(document.activeElement).toBe(h.tab("a.md"));
  // A download offers Show in Explorer only; an artifact only the tab actions.
  await h.open("download");
  await openMenu(h, "Downloaded files");
  expect(
    menuActions(h.view)
      .map(([action]) => action)
      .slice(7),
  ).toEqual(["reveal-download"]);
  await closeMenu();
  await h.open("artifact");
  await openMenu(h, "notes.md");
  expect(menuActions(h.view).map(([action]) => action)).toEqual([
    "close",
    "close-others",
    "close-right",
    "move-left",
    "move-right",
    "pin",
    "show-beside-chat",
  ]);
});

it("keeps tab keys away from an open menu and drops a menu whose tab is gone", async () => {
  const h = await mount();
  await h.open("md");
  await h.open("board");
  await openMenu(h, "board.txt");
  await press({ key: "w", ctrlKey: true });
  expect(h.tabs()).toEqual(["Chat", "a.md", "board.txt"]);
  await press({ key: "Tab", ctrlKey: true });
  expect(h.selected()).toBe("board.txt");
  // The tab closes behind its menu; opening the document again brings no stale menu back.
  await act(async () => h.close("board.txt")?.click());
  await settle();
  expect(h.view.querySelector("[data-tree-menu]")).toBeNull();
  await h.open("board");
  expect(h.view.querySelector("[data-tree-menu]")).toBeNull();
});

it("shows a menu action's message above the panels, with Chat too, and clears it on another tab", async () => {
  const original = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    if (channel === "docs.reveal") throw { code: "INTERNAL", messageKey: "errors.INTERNAL" };
    return original(channel as never, request as never);
  });
  const h = await mount();
  await h.open("md");
  await h.open("board");
  await act(async () => h.tab("Chat")?.click());
  await openMenu(h, "a.md");
  await runItem(h.view, "reveal");
  await settle();
  expect(h.selected()).toBe("Chat");
  expect(h.view.querySelector('[data-tab-notices] [data-i18n="errors.INTERNAL"]')).not.toBeNull();
  await act(async () => h.tab("board.txt")?.click());
  expect(h.view.querySelector('[data-tab-notices] [data-i18n="errors.INTERNAL"]')).toBeNull();
  // Moving a focused tab from its menu keeps the focus on it.
  await openMenu(h, "a.md");
  await runItem(h.view, "move-right");
  await settle();
  expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md"]);
  expect(document.activeElement).toBe(h.tab("a.md"));
});

// REQ-FUNC-8a061992 REQ-REL-4622d972 REQ-DATA-3b6664f9
it("restores a session's saved tabs, order, selection and places, leaving out documents that are gone", async () => {
  const key = tabStorageKey(tabOwner("session-r"));
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      active: "file:board.txt",
      tabs: [
        { target: { path: "docs/a.md" }, place: { scroll: 120 } },
        { target: { path: "docs/gone.md" } },
        { target: { path: "board.txt" } },
      ],
    }),
  );
  try {
    const scrolled = vi.spyOn(Element.prototype, "scrollTop", "set");
    const h = await mount(`${id}/session-r`, "session-r");
    await settle();
    expect(h.tabs()).toEqual(["Chat", "a.md", "board.txt"]);
    expect(h.selected()).toBe("board.txt");
    await act(async () => h.tab("a.md")?.click());
    await settle();
    expect(scrolled).toHaveBeenCalledWith(120);
    // The record drops the missing document, then follows every change of the tabs.
    await act(async () => {
      await new Promise((done) => setTimeout(done, 600));
    });
    const saved = () => JSON.parse(localStorage.getItem(key) ?? "null");
    expect(saved().tabs.map((tab: { target: unknown }) => tab.target)).toEqual([
      { path: "docs/a.md" },
      { path: "board.txt" },
    ]);
    await h.open("html");
    await act(async () => h.close("board.txt")?.click());
    // Leaving the app saves at once instead of waiting.
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(saved()).toEqual({
      version: 1,
      active: "file:docs/a.html",
      tabs: [{ target: { path: "docs/a.md" }, place: { scroll: 120 } }, { target: { path: "docs/a.html" } }],
    });
  } finally {
    localStorage.removeItem(key);
  }
});

it("saves nothing for a session-less scope and keeps tabs opened before the restore finished", async () => {
  const key = tabStorageKey(tabOwner("session-s"));
  localStorage.setItem(
    key,
    JSON.stringify({ version: 1, active: "chat", tabs: [{ target: { path: "docs/a.md" } }] }),
  );
  try {
    const h = await mount(`${id}/session-s`, "session-s");
    await h.open("board");
    await settle();
    expect(h.tabs()).toEqual(["Chat", "a.md", "board.txt"]);
    expect(h.selected()).toBe("board.txt");
    await h.render(`${id}/`);
    await h.open("html");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(Object.keys(localStorage).filter((k) => k.startsWith("vera.tabs."))).toEqual([key]);
  } finally {
    localStorage.removeItem(key);
  }
});

// REQ-REL-f19a4bc2 REQ-REL-4622d972 REQ-DATA-3b6664f9
it("starts from Chat on an unreadable record and keeps a restored tab whose document fails to load", async () => {
  const key = tabStorageKey(tabOwner("session-t"));
  localStorage.setItem(key, JSON.stringify({ version: 2, active: "chat", tabs: [] }));
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    if (channel === "docs.readBytes" && (request as { path?: string }).path === "board.txt")
      throw Object.assign(Error("busy"), { code: "INTERNAL" });
    return original(channel as never, request as never);
  });
  try {
    const h = await mount(`${id}/session-t`, "session-t");
    await settle();
    expect(h.tabs()).toEqual(["Chat"]);
    // The next change writes a valid version 1 record in place of the unreadable one.
    await h.open("md");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(JSON.parse(localStorage.getItem(key) ?? "null")).toEqual({
      version: 1,
      active: "file:docs/a.md",
      tabs: [{ target: { path: "docs/a.md" } }],
    });
    await act(async () => root?.unmount());
    root = undefined;
    container?.remove();
    // A stored document that exists but cannot be read comes back with its error and Retry.
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, active: "file:board.txt", tabs: [{ target: { path: "board.txt" } }] }),
    );
    const again = await mount(`${id}/session-t`, "session-t");
    await settle();
    expect(again.tabs()).toEqual(["Chat", "board.txt"]);
    expect(again.view.querySelector("[data-source-current] [role='alert']")).not.toBeNull();
    expect(
      [...again.view.querySelectorAll("[data-source-current] button")].some((b) => b.textContent === "Retry"),
    ).toBe(true);
  } finally {
    invoke.mockRestore();
    localStorage.removeItem(key);
  }
});

/** jsdom keeps no scroll offset; give elements a real one for the continuous viewers. */
function keepScroll() {
  const offsets = new WeakMap<Element, number>();
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");
  Object.defineProperty(Element.prototype, "scrollTop", {
    configurable: true,
    get(this: Element) {
      return offsets.get(this) ?? 0;
    },
    set(this: Element, value: number) {
      offsets.set(this, value);
    },
  });
  return () => {
    if (original) Object.defineProperty(Element.prototype, "scrollTop", original);
  };
}
const keyOn = (target: Element | null, key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
  });
const typeInto = (input: HTMLInputElement | null, value: string) =>
  act(async () => {
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const wait = (ms: number) =>
  act(async () => {
    await new Promise((done) => setTimeout(done, ms));
  });
const stored = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

// REQ-UX-58cf59b2 REQ-UX-fe9ec5c2 REQ-UX-8a994f4b
it("goes to a line with Ctrl+G and finds text with Ctrl+F in a text tab, Escape keeping the tab", async () => {
  const restore = keepScroll();
  serveBigLog();
  try {
    const h = await mount();
    await h.open("log");
    expect(h.view.querySelector("[data-source-current] button:not([data-viewer-mode])")).toBeNull();
    await keyOn(document.activeElement, "g", { ctrlKey: true });
    const goto = h.view.querySelector<HTMLInputElement>("[data-document-goto]");
    expect(document.activeElement).toBe(goto);
    await typeInto(goto, "400");
    await keyOn(goto, "Enter");
    expect(h.view.querySelector('[data-line="400"]')?.textContent).toBe("400uart 400");
    await keyOn(goto, "Escape");
    expect(h.view.querySelector("[data-document-goto]")).toBeNull();
    expect(h.selected()).toBe("big.log");
    expect(document.activeElement).toBe(h.view.querySelector(".document-body"));
    await keyOn(document.activeElement, "f", { ctrlKey: true });
    const find = h.view.querySelector<HTMLInputElement>("[data-document-search]");
    expect(document.activeElement).toBe(find);
    // "uart 5" is on line 5, lines 50-59 and lines 500-599.
    await typeInto(find, "uart 5");
    const status = () => h.view.querySelector('[role="status"]')?.textContent;
    expect(status()).toBe("1 of 111");
    expect(h.view.querySelector("[data-current-match]")?.getAttribute("data-line")).toBe("5");
    await keyOn(find, "Enter");
    expect(status()).toBe("2 of 111");
    expect(h.view.querySelector("[data-current-match]")?.getAttribute("data-line")).toBe("50");
    await keyOn(find, "Escape");
    expect(h.view.querySelector("[data-document-search]")).toBeNull();
    expect(h.view.querySelector("[data-search-match]")).toBeNull();
    expect(h.selected()).toBe("big.log");
  } finally {
    restore();
  }
});

// REQ-REL-4622d972
it("leaves out a selected missing document and unlisted downloads and artifacts, selecting Chat", async () => {
  const key = tabStorageKey(tabOwner("session-g"));
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      active: "file:docs/gone.md",
      tabs: [
        { target: { path: "docs/gone.md" } },
        { target: { downloadId: "dl_gone" } },
        { target: { ref: "artifact:gone.md" } },
        { target: { path: "docs/a.md" } },
      ],
    }),
  );
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    if (channel === "downloads.list") return { workbenchId: id, downloads: [] } as never;
    if (channel === "artifacts.list") return [] as never;
    return original(channel as never, request as never);
  });
  try {
    const h = await mount(`${id}/session-g`, "session-g");
    await settle();
    expect(h.tabs()).toEqual(["Chat", "a.md"]);
    expect(h.selected()).toBe("Chat");
    // Restored tabs load only when they are shown.
    expect(invoke.mock.calls.filter(([channel]) => channel === "docs.open")).toEqual([]);
    await wait(600);
    expect(stored(key)).toEqual({ version: 1, active: "chat", tabs: [{ target: { path: "docs/a.md" } }] });
  } finally {
    invoke.mockRestore();
    localStorage.removeItem(key);
  }
});

// REQ-FUNC-8a061992 REQ-DATA-3b6664f9
it("restores a log at its line, saves moves and new places, and restores a session once per run", async () => {
  const key = tabStorageKey(tabOwner("session-u"));
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      active: "file:docs/a.md",
      tabs: [
        { target: { textPath: "logs/big.log" }, place: { line: 251 } },
        { target: { path: "docs/a.md" } },
      ],
    }),
  );
  serveBigLog();
  try {
    const h = await mount(`${id}/session-u`, "session-u");
    await settle();
    expect(h.tabs()).toEqual(["Chat", "big.log", "a.md"]);
    expect(h.selected()).toBe("a.md");
    const scrolled = vi.spyOn(Element.prototype, "scrollTop", "set");
    await act(async () => h.tab("big.log")?.click());
    await settle();
    expect(scrolled).toHaveBeenCalledWith(5000);
    scrolled.mockRestore();
    // Moving the log after a.md and scrolling it to line 101 are saved after the throttle.
    await keyOn(h.tab("big.log") ?? null, "PageDown", { ctrlKey: true, shiftKey: true });
    expect(h.tabs()).toEqual(["Chat", "a.md", "big.log"]);
    const body = h.view.querySelector<HTMLElement>("[data-source-current] .document-body");
    if (body) Object.defineProperty(body, "scrollTop", { configurable: true, writable: true, value: 2000 });
    await act(async () => body?.dispatchEvent(new Event("scroll")));
    await wait(600);
    const record = stored(key);
    expect(record.active).toBe("file:logs/big.log");
    expect(record.tabs.map((tab: { target: unknown }) => tab.target)).toEqual([
      { path: "docs/a.md" },
      { textPath: "logs/big.log" },
    ]);
    expect(record.tabs[1].place).toEqual({ line: 101 });
    // A session already shown in this run is not restored again from its record.
    localStorage.setItem(
      key,
      JSON.stringify({ version: 1, active: "chat", tabs: [{ target: { path: "board.txt" } }] }),
    );
    await h.render(`${id}/session-other`);
    await h.render(`${id}/session-u`);
    await settle();
    expect(h.tabs()).toEqual(["Chat", "a.md", "big.log"]);
  } finally {
    localStorage.removeItem(key);
  }
});

// REQ-FUNC-8a061992 REQ-DATA-3b6664f9 REQ-FUNC-d9d16533
it("keeps a document opened during the restore, works without storage and forgets a deleted session", async () => {
  const key = tabStorageKey(tabOwner("session-v"));
  localStorage.setItem(
    key,
    JSON.stringify({
      version: 1,
      active: "file:docs/a.md",
      tabs: [{ target: { path: "docs/a.md" }, place: { scroll: 40 } }, { target: { path: "board.txt" } }],
    }),
  );
  // The existence check waits until the citation below has opened.
  let release = () => {};
  const gate = new Promise<void>((done) => {
    release = done;
  });
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    if (channel === "docs.stat") await gate;
    return original(channel as never, request as never);
  });
  try {
    const h = await mount(`${id}/session-v`, "session-v");
    // A citation opened before the check finishes keeps its tab, place and selection.
    await act(async () => h.view.querySelector<HTMLButtonElement>('[data-open="reset"]')?.click());
    await settle();
    expect(h.tabs()).toEqual(["Chat", "a.md"]);
    release();
    await settle();
    expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md"]);
    expect(h.selected()).toBe("a.md");
    expect(h.view.querySelector('[data-heading="reset"]')?.getAttribute("aria-current")).toBe("true");
    // Storage that refuses writes leaves the tabs working.
    const refuse = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw Error("quota");
    });
    await h.open("html");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(h.tabs()).toEqual(["Chat", "board.txt", "a.md", "a.html"]);
    refuse.mockRestore();
    // Deleting the session within the throttle: the pending save does not write the record back.
    await act(async () => h.close("a.html")?.click());
    removeTabs(localStorage, tabOwner("session-v"));
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(localStorage.getItem(key)).toBeNull();
  } finally {
    invoke.mockRestore();
    localStorage.removeItem(key);
  }
});

function serveDisplayContent(masked: () => boolean) {
  const original = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    const data = request as { path: string; offset: number; length: number };
    const text = masked() ? "[REDACTED]" : "cached-secret";
    if (channel === "docs.stat")
      return {
        workbenchId: id,
        properties: {
          path: data.path,
          extension: /\.[^/.]+$/.exec(data.path)?.[0] ?? "",
          displayPath: `${text}-${data.path.split("/").at(-1)}`,
          type: "file",
          size: text.length,
          modified: "2026-11-17T00:00:00.000Z",
        },
      };
    if (channel === "docs.readBytes")
      return {
        workbenchId: id,
        path: data.path,
        offset: data.offset,
        size: text.length,
        data: btoa(text.slice(data.offset, data.offset + data.length)),
      };
    if (channel === "docs.open") {
      const data = request as { path: string; requestId: string };
      return {
        workbenchId: id,
        requestId: data.requestId,
        content: {
          kind: "text",
          path: data.path,
          displayPath: `${masked() ? "[REDACTED]" : "cached-secret"}-${data.path.split("/").at(-1)}`,
          ref: null,
          snippet: "",
          lines: [masked() ? "[REDACTED]" : "cached-secret"],
          start: 1,
          end: 1,
        },
      };
    }
    return original(channel as never, request as never);
  }) as typeof api.invoke);
}
it("clears inactive tab labels and contents when Display changes", async () => {
  const f = await mount();
  await api.invoke("app.settings.update", { privacy: { mask: { display: false } } });
  let masked = false;
  serveDisplayContent(() => masked);
  await f.open("md");
  await f.open("board");
  expect(f.view.textContent).toContain("cached-secret-a.md");
  masked = true;
  await act(async () => {
    await api.invoke("app.settings.update", { privacy: { mask: { display: true } } });
  });
  await settle();
  expect(f.view.textContent).not.toContain("cached-secret");
  expect(f.view.querySelector("[data-source-current]")?.textContent).toContain("[REDACTED]");
});

it("reopens a previously closed tab with the current Display masking", async () => {
  const h = await mount();
  await api.invoke("app.settings.update", { privacy: { mask: { display: false } } });
  let masked = false;
  serveDisplayContent(() => masked);
  await h.open("md");
  expect(h.selected()).toBe("cached-secret-a.md");
  await act(async () => h.close("cached-secret-a.md")?.click());
  masked = true;
  await act(async () => {
    await api.invoke("app.settings.update", { privacy: { mask: { display: true } } });
  });
  await act(async () => h.view.querySelector<HTMLButtonElement>('[data-action="reopen-tab"]')?.click());
  expect(h.view.textContent).not.toContain("cached-secret");
  await settle();
  expect(h.selected()).toBe("[REDACTED]-a.md");
  expect(h.view.textContent).not.toContain("cached-secret");
});
it.each(["app", "workbench"])(
  "reloads a cached inactive session scope after %s Display changes",
  async (area) => {
    const f = await mount(`${id}/session-b`);
    await api.invoke("app.settings.update", { privacy: { mask: { display: false } } });
    await api.invoke("workbench.config.update", {
      workbenchId: id,
      patch: { privacy: { mask: { display: "default" } } },
    });
    let masked = false;
    serveDisplayContent(() => masked);
    await f.open("md");
    await f.render(`${id}/session-a`);
    await f.open("board");
    masked = true;
    await act(async () => {
      if (area === "app") await api.invoke("app.settings.update", { privacy: { mask: { display: true } } });
      else
        await api.invoke("workbench.config.update", {
          workbenchId: id,
          patch: { privacy: { mask: { display: "on" } } },
        });
    });
    await settle();
    await f.render(`${id}/session-b`);
    await settle();
    expect(f.view.textContent).not.toContain("cached-secret");
    expect(f.view.querySelector("[data-source-current]")?.textContent).toContain("[REDACTED]");
  },
);

it("restores raw current-format targets through host presentation after their names become secrets", async () => {
  const first = "later-secret-first.txt",
    second = "later-secret-second.txt";
  const sessionId = "ses_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
  localStorage.setItem(
    tabStorageKey(tabOwner(sessionId)),
    JSON.stringify({
      version: 1,
      active: `file:${second}`,
      tabs: [{ target: { path: first } }, { target: { path: second } }],
    }),
  );
  const original = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    const data = request as { path: string; requestId?: string };
    if (channel === "docs.stat")
      return {
        workbenchId: id,
        properties: {
          path: data.path,
          extension: ".txt",
          displayPath: "[REDACTED].txt",
          type: "file",
          size: 10,
          modified: "2026-11-17T00:00:00.000Z",
        },
      };
    if (channel === "docs.open")
      return {
        workbenchId: id,
        requestId: data.requestId,
        content: {
          kind: "text",
          path: data.path,
          displayPath: "[REDACTED].txt",
          ref: null,
          snippet: "",
          lines: ["[REDACTED]"],
          start: 1,
          end: 1,
        },
      };
    return original(channel as never, request as never);
  }) as typeof api.invoke);
  const f = await mount(`${id}/${sessionId}`, sessionId);
  await settle();
  await settle();
  expect(f.view.textContent).not.toContain("later-secret");
  expect(
    [...f.view.querySelectorAll<HTMLElement>("[data-tab-key]")].map((node) => node.title).join(" "),
  ).not.toContain("later-secret");
});

it("keeps opaque document references in the same file tab as their path target", () => {
  const path = "docs/__vera_display_cipher.";
  expect(documentKey({ ref: `${path}/__vera_reference_cipher.#L1-L1` })).toBe(documentKey({ path }));
});

it.each(["app", "workbench"])(
  "refreshes cached inactive full run logs after %s privacy changes",
  async (area) => {
    const f = await mount(`${id}/run-session-b`);
    await api.invoke("app.settings.update", { privacy: { mask: { runs: false } } });
    await api.invoke("workbench.config.update", {
      workbenchId: id,
      patch: { privacy: { mask: { runs: "default" } } },
    });
    let masked = false;
    const original = api.invoke.bind(api);
    vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) =>
      channel === "runs.log"
        ? {
            id: "01JC00000000000000000000R2",
            text: masked ? "[REDACTED]" : "cached-run-secret",
            truncated: false,
            running: false,
          }
        : original(channel as never, request as never)) as typeof api.invoke);
    await f.open("run");
    expect(f.view.textContent).toContain("cached-run-secret");
    await f.render(`${id}/run-session-a`);
    await f.open("run");
    masked = true;
    await act(async () => {
      if (area === "app") await api.invoke("app.settings.update", { privacy: { mask: { runs: true } } });
      else
        await api.invoke("workbench.config.update", {
          workbenchId: id,
          patch: { privacy: { mask: { runs: "on" } } },
        });
    });
    await settle();
    expect(f.view.textContent).not.toContain("cached-run-secret");
    await f.render(`${id}/run-session-b`);
    await settle();
    expect(f.view.textContent).not.toContain("cached-run-secret");
    expect(f.view.textContent).toContain("[REDACTED]");
  },
);
