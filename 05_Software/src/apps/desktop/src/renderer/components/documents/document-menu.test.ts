// @vitest-environment jsdom
// REQ-UX-c514899c REQ-FUNC-6d1fb02f REQ-UX-160f9f68
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ViewerContent } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { DocumentTabs } from "./document-tabs.js";
import { DocumentViewerProvider, useDocumentViewer, type ViewerTarget } from "./viewer-context.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
// pdf.js cannot draw in jsdom: one 600 x 800 page that renders at once.
vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "" }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => ({ promise: Promise.resolve(), cancel: () => {} }),
        getTextContent: async () => ({ items: [] }),
      }),
    }),
    destroy: async () => {},
  }),
  TextLayer: class {
    render = async () => {};
    cancel = () => {};
  },
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 50));
  });

let root: Root | undefined;
let container: HTMLElement | undefined;
let copied: string[] = [];
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
  copied = [];
  // jsdom has no clipboard; record what the copy command would copy.
  document.execCommand = ((command: string) => {
    if (command === "copy") copied.push(window.getSelection()?.toString() ?? "");
    return true;
  }) as typeof document.execCommand;
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  vi.restoreAllMocks();
});

const log: ViewerContent = {
  kind: "text",
  path: "logs/uart.log",
  ref: null,
  snippet: "",
  lines: ["boot", "uart 5 ready", "done"],
  start: 1,
  end: 3,
};
const pdf: ViewerContent = {
  kind: "pdf",
  path: "docs/a.pdf",
  ref: null,
  snippet: "",
  data: "AA==",
  pages: ["one"],
  page: 1,
  pageEnd: 1,
};
const targets: Record<string, ViewerTarget> = {
  log: { textPath: "logs/uart.log" },
  pdf: { path: "docs/a.pdf" },
  md: { path: "docs/a.md" },
};

async function mount() {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const original = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation(async (channel: string, request: unknown) => {
    const data = request as { path?: string };
    if (channel === "docs.read" && data.path === "logs/uart.log")
      return { workbenchId: id, content: log } as never;
    if (channel === "docs.open" && data.path === "docs/a.pdf")
      return { workbenchId: id, content: pdf } as never;
    return original(channel as never, request as never);
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  function Openers() {
    const open = useDocumentViewer();
    return createElement(
      "div",
      null,
      ...Object.entries(targets).map(([name, target]) =>
        createElement(
          "button",
          { key: name, type: "button", "data-open": name, onClick: () => open?.(target) },
          name,
        ),
      ),
    );
  }
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(
          DocumentViewerProvider,
          { workbenchId: id, scope: `${id}/s` },
          createElement(Openers),
          createElement(DocumentTabs, { chat: null }),
        ),
      ),
    ),
  );
  const view = container;
  const panel = () => view.querySelector<HTMLElement>("[data-source-current]");
  return {
    view,
    panel,
    open: async (name: string) => {
      await act(async () => view.querySelector<HTMLButtonElement>(`[data-open="${name}"]`)?.click());
      await settle();
    },
    rightClick: (target: Element | null) =>
      act(async () => {
        target?.dispatchEvent(
          new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }),
        );
      }),
    key: (target: Element | null, key: string, init: KeyboardEventInit = {}) =>
      act(async () => {
        target?.dispatchEvent(
          new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }),
        );
      }),
    menu: () => document.querySelector<HTMLElement>('[data-tree-menu][role="menu"]'),
    items: () =>
      [...document.querySelectorAll<HTMLElement>('[data-tree-menu] [role="menuitem"]')].map((item) => ({
        label: item.querySelector("span")?.textContent,
        keys: item.getAttribute("aria-keyshortcuts"),
        shown: item.querySelector(".tree-menu-keys")?.textContent ?? null,
        disabled: item.getAttribute("aria-disabled") === "true",
      })),
    choose: (action: string) =>
      act(async () =>
        document.querySelector<HTMLElement>(`[data-tree-menu] [data-menu-action="${action}"]`)?.click(),
      ),
  };
}

it("lists a text document's commands with their shortcuts and copies only a selection in the document", async () => {
  const h = await mount();
  await h.open("log");
  await h.rightClick(h.panel()?.querySelector('[data-line="2"]') ?? null);
  expect(h.items()).toEqual([
    { label: "Copy", keys: "Control+C", shown: "Ctrl+C", disabled: true },
    { label: "Find text", keys: "Control+F", shown: "Ctrl+F", disabled: false },
    { label: "Go to line", keys: "Control+G", shown: "Ctrl+G", disabled: false },
  ]);
  // Without a selection Copy does nothing; Escape closes the menu and the document keeps focus.
  await h.choose("copy-text");
  expect(copied).toEqual([]);
  await h.key(document.activeElement, "Escape");
  expect(h.menu()).toBeNull();
  expect(h.panel()?.contains(document.activeElement)).toBe(true);
  expect(h.view.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("uart.log");
  // A selection inside the document is copied even though the menu took focus.
  const text = h.panel()?.querySelector('[data-line="2"] span:last-child')?.firstChild;
  const range = document.createRange();
  if (text) range.setStart(text, 0);
  if (text) range.setEnd(text, 6);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  await h.rightClick(h.panel()?.querySelector('[data-line="2"]') ?? null);
  expect(h.items()[0]?.disabled).toBe(false);
  await h.choose("copy-text");
  expect(copied).toEqual(["uart 5"]);
  expect(h.menu()).toBeNull();
  // A selection outside the document leaves Copy disabled.
  const outside = h.view.querySelector('[data-open="log"]')?.firstChild;
  const away = document.createRange();
  if (outside) away.selectNodeContents(outside);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(away);
  await h.rightClick(h.panel()?.querySelector('[data-line="1"]') ?? null);
  expect(h.items()[0]?.disabled).toBe(true);
  await h.key(document.activeElement, "Escape");
});

it("runs Find and Go to line from the menu, opens it with Shift+F10 and not inside the find field", async () => {
  const h = await mount();
  await h.open("log");
  await h.key(document.activeElement, "F10", { shiftKey: true });
  expect(h.menu()).not.toBeNull();
  await h.choose("go-to-line");
  expect(document.activeElement).toBe(h.view.querySelector("[data-document-goto]"));
  await h.key(document.activeElement, "Escape");
  await h.key(document.activeElement, "ContextMenu");
  await h.choose("find");
  const find = h.view.querySelector<HTMLInputElement>("[data-document-search]");
  expect(document.activeElement).toBe(find);
  await h.rightClick(find);
  expect(h.menu()).toBeNull();
});

it("offers only Copy for other documents and zooms a PDF from its menu like the shortcuts", async () => {
  const h = await mount();
  await h.open("md");
  await h.rightClick(h.panel()?.querySelector(".document-body") ?? null);
  expect(h.items().map((item) => item.label)).toEqual(["Copy"]);
  await h.key(document.activeElement, "Escape");
  await h.open("pdf");
  const zoom = () => h.view.querySelector<HTMLElement>(".pdf-viewer")?.dataset.zoom;
  expect(zoom()).toBe("1");
  await h.rightClick(h.panel()?.querySelector(".pdf-scroll") ?? null);
  expect(h.items().map((item) => [item.label, item.shown])).toEqual([
    ["Copy", "Ctrl+C"],
    ["Find text", "Ctrl+F"],
    ["Zoom in", "Ctrl+="],
    ["Zoom out", "Ctrl+-"],
    ["Reset zoom", "Ctrl+0"],
  ]);
  await h.choose("zoom-in");
  expect(zoom()).toBe("1.25");
  await h.rightClick(h.panel()?.querySelector(".pdf-scroll") ?? null);
  await h.choose("zoom-out");
  expect(zoom()).toBe("1");
  for (let i = 0; i < 6; i++) {
    await h.rightClick(h.panel()?.querySelector(".pdf-scroll") ?? null);
    await h.choose("zoom-in");
  }
  expect(zoom()).toBe("2");
  await h.rightClick(h.panel()?.querySelector(".pdf-scroll") ?? null);
  await h.choose("zoom-reset");
  expect(zoom()).toBe("1");
  await h.rightClick(h.panel()?.querySelector(".pdf-scroll") ?? null);
  await h.choose("find");
  expect(document.activeElement).toBe(h.view.querySelector("[data-document-search]"));
});
