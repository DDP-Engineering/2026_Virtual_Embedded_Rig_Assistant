// @vitest-environment jsdom
// REQ-UX-e4d5ce0f REQ-UX-e8dfdec3 REQ-UX-3eb27a6c REQ-NFR-0fe89e49
import type { ViewerContent } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import PdfViewer from "./pdf-viewer.js";
import "../../i18n.js";

// pdf.js cannot draw in jsdom: every page is a 600 x 800 box that renders at once.
vi.mock("pdfjs-dist/build/pdf.worker.mjs?url", () => ({ default: "" }));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pageCount,
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
let pageCount = 3;
/** A page box and its gap: 800 px at 100% plus 12 px. */
const PAGE = 812;

let root: Root | undefined;
let container: HTMLElement | undefined;
let restoreScroll = () => {};
beforeEach(() => {
  HTMLCanvasElement.prototype.getContext = (() => ({})) as never;
  // jsdom keeps no scroll offset; give elements a real one.
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
  restoreScroll = () => {
    if (original) Object.defineProperty(Element.prototype, "scrollTop", original);
  };
});
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
  restoreScroll();
});

const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
function pdf(pages: string[], page = 1): Extract<ViewerContent, { kind: "pdf" }> {
  pageCount = pages.length;
  return {
    kind: "pdf",
    path: "docs/a.pdf",
    ref: null,
    snippet: "",
    data: "AA==",
    pages,
    page,
    pageEnd: page,
  };
}
async function show(content: ReturnType<typeof pdf>, findRequest = 0) {
  container ??= document.body.appendChild(document.createElement("div"));
  root ??= createRoot(container);
  const view = container;
  await act(async () => root?.render(createElement(PdfViewer, { content, findRequest })));
  await settle();
  const viewer = () => view.querySelector<HTMLElement>(".pdf-viewer");
  const scroll = () => view.querySelector<HTMLElement>(".pdf-scroll");
  return {
    view,
    page: () => viewer()?.dataset.page,
    zoom: () => viewer()?.dataset.zoom,
    indicator: () => view.querySelector(".pdf-indicator")?.textContent,
    drawn: () => view.querySelectorAll("canvas").length,
    scroll,
    scrollTo: (y: number) =>
      act(async () => {
        const node = scroll();
        if (!node) return;
        node.scrollTop = y;
        node.dispatchEvent(new Event("scroll"));
      }),
    key: (key: string, init: KeyboardEventInit = { ctrlKey: true }) =>
      act(async () => {
        scroll()?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
      }),
    wheel: (deltaY: number, ctrlKey: boolean) =>
      act(async () => {
        scroll()?.dispatchEvent(
          new WheelEvent("wheel", { deltaY, ctrlKey, bubbles: true, cancelable: true }),
        );
      }),
  };
}

it("lays every page out in one scroll, opens at the cited page and follows the page in view", async () => {
  const h = await show(pdf(["one", "two", "three"], 2));
  expect(h.view.querySelectorAll(".pdf-sheet")).toHaveLength(3);
  expect(h.page()).toBe("2");
  expect(h.indicator()).toBe("2 / 3");
  expect(h.scroll()?.scrollTop).toBe(PAGE);
  expect(h.view.querySelector("button")).toBeNull();
  await h.scrollTo(2 * PAGE + 10);
  expect(h.indicator()).toBe("3 / 3");
  await h.scrollTo(0);
  expect(h.page()).toBe("1");
});

it("zooms from the keyboard and Ctrl+wheel within 50-200% and keeps the page in view", async () => {
  const h = await show(pdf(["one", "two", "three"], 2));
  await h.key("=");
  expect(h.zoom()).toBe("1.25");
  await h.key("-");
  expect(h.zoom()).toBe("1");
  for (let i = 0; i < 10; i++) await h.key("-");
  expect(h.zoom()).toBe("0.5");
  await h.key("0");
  expect(h.zoom()).toBe("1");
  await h.wheel(-100, true);
  expect(h.zoom()).toBe("1.25");
  // The page in view stays the same: page 2 starts at 1000 + 12 px at 125%.
  expect(h.page()).toBe("2");
  expect(h.scroll()?.scrollTop).toBe(1012);
  await h.wheel(-100, false);
  await h.key("=", {});
  expect(h.zoom()).toBe("1.25");
});

it("finds text across pages, steps and wraps through matches, and closes on Escape", async () => {
  const h = await show(pdf(["Assert reset", "Clocks", "Release reset"]));
  expect(h.view.querySelector("[data-document-search]")).toBeNull();
  await show(pdf(["Assert reset", "Clocks", "Release reset"]), 1);
  const find = h.view.querySelector<HTMLInputElement>("[data-document-search]");
  expect(document.activeElement).toBe(find);
  const type = (value: string) =>
    act(async () => {
      if (!find) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(find, value);
      find.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const enter = () =>
    act(async () => {
      find?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
  const status = () => h.view.querySelector('[role="status"]')?.textContent;
  await type("reset");
  expect(status()).toBe("1 of 2");
  expect(h.page()).toBe("1");
  await enter();
  expect(status()).toBe("2 of 2");
  expect(h.page()).toBe("3");
  await enter();
  expect(status()).toBe("1 of 2");
  expect(h.page()).toBe("1");
  await type("watchdog");
  expect(status()).toBe("0 of 0");
  expect(h.page()).toBe("1");
  await act(async () => {
    find?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
  expect(h.view.querySelector("[data-document-search]")).toBeNull();
  expect(document.activeElement).toBe(h.scroll());
});

it("draws at most five pages of a long PDF while scrolling through it", async () => {
  const h = await show(pdf(Array.from({ length: 300 }, (_, i) => `page ${i + 1}`)));
  expect(h.view.querySelectorAll(".pdf-sheet")).toHaveLength(300);
  expect(h.drawn()).toBeLessThanOrEqual(5);
  await h.scrollTo(150 * PAGE);
  expect(h.indicator()).toBe("151 / 300");
  expect(h.drawn()).toBe(5);
  await h.scrollTo(299 * PAGE);
  expect(h.indicator()).toBe("300 / 300");
  expect(h.drawn()).toBeLessThanOrEqual(5);
});
