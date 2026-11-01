// @vitest-environment jsdom
// REQ-UX-28ad0002 REQ-UX-28ad0003
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ComponentProps, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { WorkbenchDocuments } from "../workbench-documents.js";
import { DocsTab } from "./docs-tab.js";
import { DocumentTabs } from "./document-tabs.js";
import { DocumentBody, DocumentViewerProvider, useDocumentViewer } from "./viewer-context.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
/** Docs shows a folder tree (TASK-66b7d4aa): open the docs folder unless it is already open. */
async function expandDocs(scope: ParentNode) {
  const folder = scope.querySelector<HTMLElement>('[role="treeitem"][data-tree-path="docs"]');
  if (folder?.getAttribute("aria-expanded") === "false") {
    await act(async () => folder.click());
    await act(async () => {
      await new Promise((done) => setTimeout(done, 250));
    });
  }
}
/** Renders like `createElement`, inside a query client as the app does. */
const withQueries = (
  type: typeof DocumentViewerProvider,
  props: ComponentProps<typeof DocumentViewerProvider> & { key?: string },
  ...children: ReactNode[]
) =>
  createElement(
    QueryClientProvider,
    { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
    createElement(type, props, ...children),
  );
const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 250));
  });

it("opens live Docs heading/search refs, renders statuses and progress, restores focus and prevents read-only reindex", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const render = (readOnly: boolean) =>
    act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            DocumentViewerProvider,
            { workbenchId: id },
            createElement(DocsTab, { workbenchId: id, readOnly }),
            createElement(DocumentTabs, { chat: null }),
          ),
        ),
      ),
    );
  try {
    await render(false);
    await settle();
    await expandDocs(container);
    expect(container.querySelectorAll("[data-document]")).toHaveLength(10);
    expect(container.textContent).toContain("Needs OCR");
    const doc = container.querySelector<HTMLElement>('[data-document="docs/a.md"]');
    doc?.focus();
    await act(async () => doc?.click());
    await settle();
    expect(container.querySelector('[data-heading="power"]')?.textContent).toContain("3.3 V");
    await act(async () =>
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(document.activeElement).toBe(doc);
    const reindex = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Reindex",
    );
    await act(async () => reindex?.click());
    await settle();
    expect(container.textContent).toContain("0 pending");
    const input = container.querySelector<HTMLInputElement>("input");
    await act(async () => {
      if (input) {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "power");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    });
    await settle();
    await settle();
    expect(container.textContent).toContain("docs/a.md#h=power");
    await render(true);
    await settle();
    expect(reindex?.disabled).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    await api.invoke("workbench.close", {});
  }
});

it("rejects mismatched and late viewer responses after closing or scope remount", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Open() {
    const open = useDocumentViewer();
    return createElement("button", { type: "button", onClick: () => open?.({ path: "board.txt" }) }, "Open");
  }
  let resolve: (v: unknown) => void = () => {};
  const invoke = vi.spyOn(api, "invoke").mockImplementation(
    () =>
      new Promise((done) => {
        resolve = (value) => done(value as Awaited<ReturnType<typeof api.invoke>>);
      }) as ReturnType<typeof api.invoke>,
  );
  try {
    await act(async () =>
      root.render(
        withQueries(
          DocumentViewerProvider,
          { key: "one", workbenchId: id },
          createElement(Open),
          createElement(DocumentTabs, { chat: null }),
        ),
      ),
    );
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () =>
      resolve({
        workbenchId: "foreign",
        content: {
          kind: "text",
          path: "board.txt",
          ref: null,
          snippet: "",
          lines: ["secret"],
          start: 1,
          end: 1,
        },
      }),
    );
    await settle();
    expect(container.querySelector('[role="alert"]')).toBeTruthy();
    expect(container.textContent).not.toContain("secret");
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="close-tab"]')?.click());
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () =>
      root.render(
        withQueries(
          DocumentViewerProvider,
          { key: "one", workbenchId: "other" },
          createElement(Open),
          createElement(DocumentTabs, { chat: null }),
        ),
      ),
    );
    await act(async () =>
      resolve({
        workbenchId: id,
        content: {
          kind: "text",
          path: "board.txt",
          ref: null,
          snippet: "",
          lines: ["late secret"],
          start: 1,
          end: 1,
        },
      }),
    );
    expect(container.querySelector("[data-source-current]")).toBeNull();
    expect(container.textContent).not.toContain("secret");
  } finally {
    invoke.mockRestore();
    await act(async () => root.unmount());
    container.remove();
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
const typeInto = (input: HTMLInputElement | null, value: string) =>
  act(async () => {
    if (!input) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const press = (target: Element | null, key: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    target?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init }));
  });

// REQ-UX-8a994f4b REQ-NFR-0fe89e49 REQ-UX-58cf59b2 REQ-UX-fe9ec5c2 REQ-UX-3eb27a6c
it("scrolls large text continuously with a bounded DOM, absolute line numbers, find and go to line", async () => {
  const restore = keepScroll();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const content = {
    kind: "text" as const,
    path: "large.log",
    ref: "large.log#L1500-L1502",
    snippet: "",
    lines: Array.from({ length: 2000 }, (_, i) => `Source ${i + 1}`),
    start: 1500,
    end: 1502,
  };
  const render = (findRequest = 0, gotoRequest = 0) =>
    act(async () => root.render(createElement(DocumentBody, { content, findRequest, gotoRequest })));
  try {
    await render();
    const body = container.querySelector<HTMLElement>(".document-body");
    // The whole file is one scroll height, the cited lines are in view, and no navigation buttons show.
    expect(container.querySelector<HTMLElement>(".document-lines")?.style.height).toBe("40000px");
    expect(container.querySelectorAll("[data-line]").length).toBeLessThan(200);
    expect(container.querySelector('[data-line="1500"]')?.textContent).toBe("1500Source 1500");
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(3);
    expect(container.querySelector("button")).toBeNull();
    expect(container.querySelector("[data-document-find]")).toBeNull();
    // Scrolling to the top renders the first lines instead.
    if (body) body.scrollTop = 0;
    await act(async () => body?.dispatchEvent(new Event("scroll")));
    expect(container.querySelector('[data-line="1"]')).not.toBeNull();
    expect(container.querySelector('[data-line="1500"]')).toBeNull();
    expect(container.querySelectorAll("[data-line]").length).toBeLessThan(200);
    // Ctrl+G shows a field that jumps to a line; Escape hides it again.
    await render(0, 1);
    const goto = container.querySelector<HTMLInputElement>("[data-document-goto]");
    expect(document.activeElement).toBe(goto);
    await typeInto(goto, "1800");
    await press(goto, "Enter");
    expect(container.querySelector('[data-line="1800"]')?.textContent).toBe("1800Source 1800");
    await press(goto, "Escape");
    expect(container.querySelector("[data-document-goto]")).toBeNull();
    // Ctrl+F finds across the whole file, marks matches and steps with Enter and Shift+Enter.
    await render(1, 1);
    const find = container.querySelector<HTMLInputElement>("[data-document-search]");
    await typeInto(find, "source 19");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("1 of 111");
    expect(container.querySelector('[data-line="19"] [data-search-match]')?.textContent).toBe("Source 19");
    expect(container.querySelector("[data-current-match]")?.getAttribute("data-line")).toBe("19");
    await press(find, "Enter", { shiftKey: true });
    expect(container.querySelector('[role="status"]')?.textContent).toBe("111 of 111");
    expect(container.querySelector("[data-current-match]")?.getAttribute("data-line")).toBe("1999");
    await press(find, "Escape");
    expect(container.querySelector("[data-document-search]")).toBeNull();
    expect(document.activeElement).toBe(body);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    restore();
  }
});

// REQ-UX-8a994f4b REQ-UX-58cf59b2 REQ-UX-fe9ec5c2 REQ-NFR-0fe89e49
it("keeps a text tab's line, clamps go to line, reports no match and stays bounded for any size", async () => {
  const restore = keepScroll();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const text = (count: number, start = 1) => ({
    kind: "text" as const,
    path: "huge.log",
    ref: start > 1 ? `huge.log#L${start}-L${start}` : null,
    snippet: "",
    lines: Array.from({ length: count }, (_, i) => (i === 4 ? "ERR boot" : `ok ${i + 1}`)),
    start,
    end: start,
  });
  const body = () => container.querySelector<HTMLElement>(".document-body");
  const rows = () => container.querySelectorAll("[data-line]").length;
  try {
    // A kept first visible line wins over the cited start.
    await act(async () =>
      root.render(createElement(DocumentBody, { content: text(600, 412), place: { line: 300 } })),
    );
    expect(body()?.scrollTop).toBe(299 * 20);
    expect(container.querySelector('[data-line="300"]')).not.toBeNull();
    await act(async () => root.render(createElement("div")));
    // 600 000 lines stay under 300 rendered rows at the top, in the middle and at the end.
    const huge = text(600_000);
    const render = (gotoRequest: number, findRequest = 0) =>
      act(async () => root.render(createElement(DocumentBody, { content: huge, gotoRequest, findRequest })));
    await render(0);
    expect(rows()).toBeLessThan(300);
    const node = body();
    if (node) node.scrollTop = 300_000 * 20;
    await act(async () => node?.dispatchEvent(new Event("scroll")));
    expect(container.querySelector('[data-line="300001"]')).not.toBeNull();
    expect(rows()).toBeLessThan(300);
    await render(1);
    const goto = container.querySelector<HTMLInputElement>("[data-document-goto]");
    await typeInto(goto, "999999");
    await press(goto, "Enter");
    expect(container.querySelector('[data-line="600000"]')).not.toBeNull();
    expect(rows()).toBeLessThan(300);
    const before = body()?.scrollTop;
    await typeInto(goto, "1e");
    await press(goto, "Enter");
    expect(body()?.scrollTop).toBe(before);
    await press(goto, "Escape");
    await render(1, 1);
    const find = container.querySelector<HTMLInputElement>("[data-document-search]");
    await typeInto(find, "watchdog");
    expect(container.querySelector('[role="status"]')?.textContent).toBe("0 of 0");
    expect(body()?.scrollTop).toBe(before);
    await act(async () => root.render(createElement("div")));
    // A short file renders every line.
    await act(async () => root.render(createElement(DocumentBody, { content: text(10) })));
    expect(rows()).toBe(10);
    // An empty file shows no lines.
    await act(async () => root.render(createElement(DocumentBody, { content: text(0) })));
    expect(rows()).toBe(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    restore();
  }
});

// REQ-UX-64738341
it("shows office extractions as numbered slides and sections with the cited unit in view", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const scrolled: string[] = [];
  // jsdom has no layout; record which unit the viewer brings into view.
  const original = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
  Element.prototype.scrollIntoView = function (this: HTMLElement) {
    scrolled.push(this.dataset.slide ?? this.dataset.heading ?? "");
  };
  let target = "";
  function Open() {
    const open = useDocumentViewer();
    return createElement("button", { type: "button", onClick: () => open?.({ ref: target }) }, "Open");
  }
  try {
    await act(async () =>
      root.render(
        withQueries(
          DocumentViewerProvider,
          { workbenchId: id },
          createElement(Open),
          createElement(DocumentTabs, { chat: null }),
        ),
      ),
    );
    target = "docs/bringup.pptx#p=2";
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await settle();
    const slides = [...container.querySelectorAll<HTMLElement>("[data-source-current] [data-slide]")];
    expect(slides.map((s) => s.querySelector("h3")?.textContent)).toEqual(["Slide 1", "Slide 2"]);
    // Slides are headed sections inside the one named document region, not landmarks of their own.
    expect(
      container.querySelectorAll(
        "[data-source-current] section[aria-label], [data-source-current] section[aria-labelledby]",
      ),
    ).toHaveLength(1);
    expect(slides[0]?.textContent).toContain("Power the 3.3 V rail first");
    expect(slides[1]?.textContent).toContain("3.29 V");
    expect(slides.map((s) => s.getAttribute("aria-current"))).toEqual([null, "true"]);
    expect(scrolled).toContain("2");
    expect(document.activeElement).toBe(slides[1]);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="close-tab"]')?.click());
    target = "docs/review.docx#h=reset";
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await settle();
    const sections = [...container.querySelectorAll<HTMLElement>("[data-source-current] [data-heading]")];
    expect(sections.map((s) => s.dataset.heading)).toEqual(["", "power", "reset"]);
    expect(
      container.querySelector('[data-source-current] [aria-current="true"]')?.getAttribute("data-heading"),
    ).toBe("reset");
    expect(scrolled).toContain("reset");
    expect(document.activeElement).toBe(sections[2]);
    // REQ-UX-9be5fd96: #h= opens the untitled leading section.
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="close-tab"]')?.click());
    target = "docs/review.docx#h=";
    scrolled.length = 0;
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await settle();
    const lead = container.querySelector<HTMLElement>('[data-source-current] [data-heading=""]');
    expect(lead?.textContent).toContain("Review notes for the bench.");
    expect(lead?.getAttribute("aria-current")).toBe("true");
    expect(container.querySelectorAll('[data-source-current] [aria-current="true"]')).toHaveLength(1);
    expect(scrolled).toEqual([""]);
    expect(document.activeElement).toBe(lead);
  } finally {
    if (original) Object.defineProperty(Element.prototype, "scrollIntoView", original);
    else delete (Element.prototype as Partial<Element>).scrollIntoView;
    await act(async () => root.unmount());
    container.remove();
  }
});

// REQ-UX-f5d6e9e4 REQ-REL-85ae1f66 REQ-UX-541a5bee
it("offers Open in default app for allowlisted workbench documents only and shows its errors in place", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invoke = api.invoke.bind(api);
  const opened: unknown[] = [];
  let reply: () => Promise<unknown> = async () => ({});
  const sources: Record<string, unknown> = {
    "tools/flash.py": {
      kind: "text",
      path: "tools/flash.py",
      ref: null,
      snippet: "",
      lines: ["x"],
      start: 1,
      end: 1,
    },
    // An artifact with an allowlisted name still has no external action.
    "summary.md": {
      kind: "artifact",
      path: "summary.md",
      ref: "artifact:summary.md",
      snippet: "",
      content: "# Summary",
      mime: "text/markdown",
    },
    ".vera/downloads/d/chip.pdf": {
      kind: "text",
      path: ".vera/downloads/d/chip.pdf",
      ref: null,
      snippet: "",
      lines: ["x"],
      start: 1,
      end: 1,
    },
  };
  const spy = vi.spyOn(api, "invoke").mockImplementation((async (
    channel: string,
    request: { path?: string },
  ) => {
    if (channel === "app.openPath") {
      opened.push(request);
      return reply();
    }
    if (channel === "docs.open" && request.path && sources[request.path])
      return { workbenchId: id, content: sources[request.path] };
    return invoke(channel as "app.info", request as never);
  }) as typeof api.invoke);
  let target: { path: string } = { path: "docs/a.pdf" };
  function Open() {
    const open = useDocumentViewer();
    return createElement(
      "button",
      { type: "button", "data-test-open": "", onClick: () => open?.(target) },
      "Open",
    );
  }
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            DocumentViewerProvider,
            { workbenchId: id },
            createElement(Open),
            createElement(DocsTab, { workbenchId: id, readOnly: false }),
            createElement(DocumentTabs, { chat: null }),
          ),
        ),
      ),
    );
    await settle();
    await expandDocs(container);
    const external = (scope: ParentNode | null | undefined) =>
      scope?.querySelector<HTMLButtonElement>('[data-action="open-external"]') ?? null;
    // Docs tree: the row's context menu offers it for allowlisted documents only (TASK-66b7d4aa).
    expect(external(container.querySelector('[role="tree"]'))).toBeNull();
    const externalItem = async (path: string) => {
      await act(async () => {
        container
          .querySelector(`[role="treeitem"][data-tree-path="${path}"]`)
          ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      // The default application is in the row menu's Open in submenu (TASK-eae3a69e).
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[data-tree-menu] [data-menu-action="open-in"]')?.click(),
      );
      return container.querySelector<HTMLButtonElement>(
        '[data-tree-menu] [data-menu-action="open-external"]',
      );
    };
    const closeMenu = () =>
      act(async () => {
        document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      });
    expect(await externalItem("docs/a.html")).toBeNull();
    await closeMenu();
    expect((await externalItem("docs/a.pdf"))?.getAttribute("aria-label")).toBe(
      "Open in default app: docs/a.pdf",
    );
    await closeMenu();
    const item = await externalItem("docs/review.docx");
    await act(async () => item?.click());
    expect(opened).toEqual([{ path: "docs/review.docx" }]);
    // The document tab's menu (TASK-6c4aeed8): offered for a workbench document, not for code,
    // managed downloads or artifacts; the document panel itself has no buttons.
    await act(async () => container.querySelector<HTMLButtonElement>("[data-test-open]")?.click());
    await settle();
    const dialog = () => container.querySelector<HTMLElement>("[data-source-current]");
    expect(external(dialog())).toBeNull();
    const tabItem = async () => {
      await act(async () => {
        container
          .querySelector('[data-document-tabs] [role="tab"][aria-selected="true"]')
          ?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
      });
      await act(async () =>
        container.querySelector<HTMLButtonElement>('[data-tree-menu] [data-menu-action="open-in"]')?.click(),
      );
      return container.querySelector<HTMLButtonElement>(
        '[data-tree-menu] [data-menu-action="open-external"]',
      );
    };
    const fromTab = await tabItem();
    expect(fromTab?.getAttribute("aria-label")).toBe("Open in default app: docs/a.pdf");
    reply = async () => {
      throw { code: "INTERNAL", messageKey: "errors.INTERNAL" };
    };
    await act(async () => fromTab?.click());
    await settle();
    expect(opened.at(-1)).toEqual({ path: "docs/a.pdf" });
    expect(container.querySelector('[data-tab-notices] [data-i18n="errors.INTERNAL"]')).toBeTruthy();
    expect(dialog()).toBeTruthy();
    // A failure from the tree's menu shows in the tree.
    const failing = await externalItem("docs/a.pdf");
    await act(async () => failing?.click());
    await settle();
    expect(opened.at(-1)).toEqual({ path: "docs/a.pdf" });
    expect(container.querySelector('.docs-tree [data-i18n="errors.INTERNAL"]')).toBeTruthy();
    for (const path of ["tools/flash.py", ".vera/downloads/d/chip.pdf", "summary.md"]) {
      await act(async () => container.querySelector<HTMLButtonElement>('[data-action="close-tab"]')?.click());
      target = { path };
      await act(async () => container.querySelector<HTMLButtonElement>("[data-test-open]")?.click());
      await settle();
      expect(
        container
          .querySelector('[data-document-tabs] [role="tab"][aria-selected="true"]')
          ?.getAttribute("title"),
      ).toBe(path);
      expect(await tabItem(), path).toBeNull();
      await closeMenu();
    }
  } finally {
    spy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});

/** A text source for any path, so tests can open many distinct sources. */
function textSources() {
  const invoke = api.invoke.bind(api);
  return vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: { path?: string }) =>
    channel === "docs.open" && request.path?.startsWith("notes/")
      ? {
          workbenchId: id,
          content: {
            kind: "text",
            path: request.path,
            ref: null,
            snippet: "",
            lines: [request.path],
            start: 1,
            end: 1,
          },
        }
      : invoke(channel as "app.info", request as never)) as typeof api.invoke);
}

// REQ-UX-d64f086f
it("moves focus into a document tab, back to the opener on Escape, and to the Chat tab when it closes", async () => {
  const spy = textSources();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Opener() {
    const open = useDocumentViewer();
    return createElement(
      "button",
      { type: "button", "data-opener": "", onClick: () => open?.({ path: "notes/a.txt" }) },
      "Open",
    );
  }
  try {
    await act(async () =>
      root.render(
        withQueries(
          DocumentViewerProvider,
          { workbenchId: id, scope: "s" },
          createElement(Opener),
          createElement(DocumentTabs, { chat: null }),
        ),
      ),
    );
    const opener = container.querySelector<HTMLButtonElement>("[data-opener]");
    const panel = () => container.querySelector<HTMLElement>("[data-source-current]");
    opener?.focus();
    await act(async () => opener?.click());
    await settle();
    expect(panel()?.contains(document.activeElement)).toBe(true);
    await act(async () =>
      document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
    );
    expect(container.querySelector("[data-source-current]")).toBeNull();
    expect(document.activeElement).toBe(opener);
    await act(async () => opener?.click());
    await settle();
    expect(panel()?.contains(document.activeElement)).toBe(true);
    await act(async () => container.querySelector<HTMLButtonElement>('[data-action="close-tab"]')?.click());
    expect(container.querySelector("[data-source-current]")).toBeNull();
    expect(document.activeElement?.textContent).toBe("Chat");
  } finally {
    spy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});

// REQ-UX-d64f086f
it("keeps the source open when Escape only ends an IME composition", async () => {
  const spy = textSources();
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  function Opener() {
    const open = useDocumentViewer();
    return createElement(
      "button",
      { type: "button", "data-opener": "", onClick: () => open?.({ path: "notes/ime.txt" }) },
      "Open",
    );
  }
  try {
    await act(async () =>
      root.render(
        withQueries(
          DocumentViewerProvider,
          { workbenchId: id, scope: "s" },
          createElement(Opener),
          createElement(DocumentTabs, { chat: null }),
        ),
      ),
    );
    await act(async () => container.querySelector<HTMLButtonElement>("[data-opener]")?.click());
    await settle();
    await act(async () =>
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true, isComposing: true }),
      ),
    );
    expect(container.querySelector("[data-source-current]")).toBeTruthy();
  } finally {
    spy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});

// REQ-UX-05c5b146 REQ-UX-d64e808a
it("warns about a large selection in Docs and in the Documents section, never at the limits", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const GiB = 1024 ** 3;
  let volume: { files: number; bytes: number } | null = { files: 2001, bytes: 10 };
  const previews: Record<string, { files: number; bytes: number; truncated?: boolean }> = {
    "big/**": { files: 2001, bytes: 5 },
    "edge/**": { files: 2000, bytes: 2 * GiB },
    "heavy/**": { files: 3, bytes: 2 * GiB + 1 },
    "huge/**": { files: 12, bytes: 5, truncated: true },
  };
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    if (channel === "docs.volume") return { workbenchId: id, volume };
    if (channel === "workbench.previewDocs") {
      const include = (request as { include: string[] }).include[0] ?? "";
      return { truncated: false, ...(previews[include] ?? { files: 1, bytes: 1 }), officePending: 0 };
    }
    return original(channel as never, request as never);
  }) as typeof api.invoke);
  const handlers: ((event: unknown) => void)[] = [];
  const deliver = (event: unknown) => {
    for (const on of handlers) on(event);
  };
  const subscribe = api.subscribe.bind(api);
  const spy = vi.spyOn(api, "subscribe").mockImplementation(((topic: string, ...rest: unknown[]) => {
    const on = rest.at(-1) as (event: unknown) => void;
    if (topic === "workbench") handlers.push(on);
    return (subscribe as (...args: unknown[]) => () => void)(topic, ...rest);
  }) as typeof api.subscribe);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  // Production defaults: cached data never goes stale on its own (main.tsx).
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  const warning = () => container.querySelector("[data-volume-warning]")?.textContent ?? null;
  const docs = () =>
    act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            DocumentViewerProvider,
            { workbenchId: id },
            createElement(DocsTab, { workbenchId: id, readOnly: false }),
          ),
        ),
      ),
    );
  try {
    await docs();
    await settle();
    expect(warning()).toContain("2,001");
    await expandDocs(container);
    expect(container.querySelectorAll("[data-document]")).toHaveLength(10);
    // At exactly 2,000 files and 2 GiB there is no warning; the list stays.
    await act(async () => deliver({ type: "index.volume", files: 2000, bytes: 2 * GiB }));
    // Query observers are notified on the next tick.
    await settle();
    expect(warning()).toBeNull();
    expect(container.querySelectorAll("[data-document]")).toHaveLength(10);
    await act(async () => deliver({ type: "index.volume", files: 5, bytes: 2 * GiB + 1 }));
    await settle();
    expect(warning()).toContain("2 GB");
    // Indexing progress keeps being reported beside the warning.
    await act(async () => deliver({ type: "index.progress", pending: 4, done: 1, failed: 0 }));
    await settle();
    expect(container.textContent).toContain("Index: 1 done, 4 pending, 0 failed");
    expect(warning()).toContain("2 GB");
    // Another right-panel tab unmounts Docs; on return the volume is read again, not the cache.
    await act(async () => root.render(createElement("div")));
    volume = { files: 10, bytes: 10 };
    await docs();
    await settle();
    expect(warning()).toBeNull();
    volume = null;
    // The Documents section warns beside its preview statement while the preview is too large.
    const section = (include: string) =>
      act(async () =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(WorkbenchDocuments, {
              folder: "/mock/demo-board",
              docs: { include: [include], exclude: [] },
              setDocs: () => {},
            }),
          ),
        ),
      );
    for (const [include, shown] of [
      ["big/**", true],
      ["edge/**", false],
      ["heavy/**", true],
      ["huge/**", true],
      ["small/**", false],
    ] as const) {
      await section(include);
      await act(async () => new Promise((resolve) => setTimeout(resolve, 400)));
      await settle();
      expect(container.querySelector("[data-docs-preview]")).not.toBeNull();
      expect(warning() !== null, include).toBe(shown);
      // Nothing is indexing yet on this page, so the text does not claim it.
      if (shown) expect(warning()).not.toContain("continues");
      if (include === "huge/**") expect(warning()).toContain("at least 12");
    }
  } finally {
    invoke.mockRestore();
    spy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});

// REQ-UX-f6c347b8
it("shows stopped indexing with a Restart action that restarts the indexer", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  let state: "running" | "stopped" = "running";
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    if (channel === "indexer.status") return { state };
    if (channel === "indexer.restart") return {};
    return original(channel as never, request as never);
  }) as typeof api.invoke);
  const handlers: ((event: unknown) => void)[] = [];
  const subscribe = api.subscribe.bind(api);
  const spy = vi.spyOn(api, "subscribe").mockImplementation(((topic: string, ...rest: unknown[]) => {
    if (topic === "app") handlers.push(rest.at(-1) as (event: unknown) => void);
    return (subscribe as (...args: unknown[]) => () => void)(topic, ...rest);
  }) as typeof api.subscribe);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(
            DocumentViewerProvider,
            { workbenchId: id },
            createElement(DocsTab, { workbenchId: id, readOnly: false }),
          ),
        ),
      ),
    );
    await settle();
    const stopped = () => container.querySelector("[data-indexer-stopped]");
    const reindex = () =>
      [...container.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Reindex");
    expect(stopped()).toBeNull();
    // A stopped status event shows the message; Reindex waits, since it would empty the index first.
    state = "stopped";
    await act(async () => {
      for (const on of handlers) on({ type: "indexer.status", state: "stopped" });
    });
    await settle();
    expect(stopped()?.textContent).toContain("Indexing stopped");
    expect(reindex()?.disabled).toBe(true);
    const restart = container.querySelector<HTMLButtonElement>('[data-action="restart-indexer"]');
    expect(restart?.textContent).toBe("Restart indexing");
    await act(async () => restart?.click());
    expect(invoke).toHaveBeenCalledWith("indexer.restart", {});
    state = "running";
    await act(async () => {
      for (const on of handlers) on({ type: "indexer.status", state: "running" });
    });
    await settle();
    expect(stopped()).toBeNull();
    expect(reindex()?.disabled).toBe(false);
    // Documents stay listed meanwhile.
    await expandDocs(container);
    expect(container.querySelectorAll("[data-document]")).toHaveLength(10);
  } finally {
    invoke.mockRestore();
    spy.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});
