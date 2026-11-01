// @vitest-environment jsdom
// REQ-UX-388cf31a REQ-UX-712804c9 REQ-FUNC-89161a95 REQ-UX-37821e01 REQ-UX-89428322 REQ-UX-1f53a583
// REQ-UX-5fc1d7d3 REQ-UX-be7140e4 REQ-UX-d64f086f REQ-REL-6fc27952
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ViewerContent } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { removeTabs } from "../../lib/document-tabs-store.js";
import { DocumentTabs } from "./document-tabs.js";
import { DocumentViewerProvider, useDocumentViewer, type ViewerTarget } from "./viewer-context.js";
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
  md: { path: "docs/a.md" },
  reset: { ref: "docs/a.md#h=reset" },
  html: { path: "docs/a.html" },
  htmlRef: { ref: "docs/a.html#h=reset" },
  artifact: { ref: "artifact:notes.md" },
  power: { ref: "docs/a.md#h=power" },
  download: { downloadId: "dl_01JB8Z6Q4M7N2K5R9T3V8X1Y0C" },
  board: { path: "board.txt" },
  log: { textPath: "logs/big.log" },
  logLine: { ref: "logs/big.log#L5-L5" },
};

async function mount(scope = `${id}/session-a`, sessionId?: string) {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const reveal = vi.fn();
  const render = (next: string) =>
    act(async () =>
      root?.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            DocumentViewerProvider,
            { workbenchId: id, scope: next, sessionId, reveal },
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
  return vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    const data = request as { path?: string; ref?: string };
    if (channel === "docs.read" && data.path === "logs/big.log")
      return { workbenchId: id, content: bigLog() } as never;
    if (channel === "docs.stat" && data.path === "logs/big.log")
      return {
        workbenchId: id,
        properties: { path: data.path, type: "file", size: 6000, modified: "2026-10-13T00:00:00.000Z" },
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
    [...(panel?.querySelectorAll("button") ?? [])].filter((button) => !button.closest(".document-body")),
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
      .slice(5),
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
  const key = `vera.tabs.${id}.session-r`;
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
  const key = `vera.tabs.${id}.session-s`;
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
  const key = `vera.tabs.${id}.session-t`;
  localStorage.setItem(key, JSON.stringify({ version: 2, active: "chat", tabs: [] }));
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    if (channel === "docs.open" && (request as { path?: string }).path === "board.txt")
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
    expect(h.view.querySelector("[data-source-current] button")).toBeNull();
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
  const key = `vera.tabs.${id}.session-g`;
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
  const key = `vera.tabs.${id}.session-u`;
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
  const key = `vera.tabs.${id}.session-v`;
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
    removeTabs(localStorage, id, "session-v");
    await act(async () => window.dispatchEvent(new Event("pagehide")));
    expect(localStorage.getItem(key)).toBeNull();
  } finally {
    invoke.mockRestore();
    localStorage.removeItem(key);
  }
});
