// @vitest-environment jsdom
// REQ-UX-c28dde55 REQ-UX-795a7f61 REQ-UX-775eb693 REQ-UX-9f16abf2 REQ-UX-2d9cdf43 REQ-UX-fdd495b8
// REQ-UX-541a5bee REQ-UX-4d1b3324 REQ-UX-ed65cbbc REQ-UX-2504362b REQ-UX-d455531b
// REQ-UX-25c814e1 REQ-UX-89cdb49d REQ-UX-3a3d67c1 REQ-UX-ef3e2304 REQ-UX-b5edf930
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { mockAppInfo } from "../../mocks/fixtures.js";
import { type Attachments, AttachmentsContext } from "../session/attachments.js";
import { DocsTab } from "./docs-tab.js";
import { folderSummaries } from "./docs-tree.js";
import { DocumentTabs } from "./document-tabs.js";
import { DocumentViewerProvider } from "./viewer-context.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 300));
  });
let root: Root;
let container: HTMLDivElement;
async function mount(workbenchId = id, attachments?: Attachments) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } },
  });
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          DocumentViewerProvider,
          { workbenchId },
          attachments
            ? createElement(
                AttachmentsContext.Provider,
                { value: attachments },
                createElement(DocsTab, { workbenchId, readOnly: false }),
              )
            : createElement(DocsTab, { workbenchId, readOnly: false }),
          createElement(DocumentTabs, { chat: null }),
        ),
      ),
    ),
  );
  await settle();
}
async function unmount() {
  await act(async () => root.unmount());
  container.remove();
}
beforeEach(async () => {
  localStorage.clear();
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
});
afterEach(async () => {
  vi.restoreAllMocks();
  if (container?.isConnected) await unmount();
});
const row = (path: string) =>
  container.querySelector<HTMLElement>(`[role="treeitem"][data-tree-path="${path}"]`);
const visible = () =>
  [...container.querySelectorAll<HTMLElement>('[role="treeitem"]')].map((item) => item.dataset.treePath);
const click = (element: Element | null) => act(async () => (element as HTMLElement).click());
const key = (element: Element | null, name: string, init: KeyboardEventInit = {}) =>
  act(async () => {
    (element as HTMLElement).dispatchEvent(
      new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true, ...init }),
    );
  });
/** Types into the Docs tab's single search box. */
const type = (value: string) =>
  act(async () => {
    const input = container.querySelector<HTMLInputElement>("[data-docs-search]") as HTMLInputElement;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
const contextMenu = (element: Element | null) =>
  act(async () => {
    (element as HTMLElement).dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 40, clientY: 60 }),
    );
  });
const menu = () => container.querySelector<HTMLElement>('[role="menu"][data-tree-menu]');
/** The main menu's own items, without those of an open submenu. */
const menuItems = () =>
  [...(menu()?.querySelectorAll<HTMLElement>('[role="menuitem"][data-menu-depth="0"]') ?? [])].map(
    (item) => item.dataset.menuAction,
  );
const submenu = (action: string) =>
  menu()?.querySelector<HTMLElement>(`[role="menu"][data-submenu="${action}"]`);
const subItems = (action: string) =>
  [...(submenu(action)?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])].map(
    (item) => item.dataset.menuAction,
  );
const hover = (element: Element | null) =>
  act(async () => {
    (element as HTMLElement).dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
const menuItem = (action: string) =>
  menu()?.querySelector<HTMLElement>(`[role="menuitem"][data-menu-action="${action}"]`) ?? null;

it("shows the workbench as a lazily expanded tree with document status and dimmed other files", async () => {
  await mount();
  expect(container.querySelector('[role="tree"]')).not.toBeNull();
  expect(container.querySelector(".documents-list")).toBeNull();
  // Folders first, then files, top level only while folders are collapsed.
  expect(visible()).toEqual([".git", ".vera", "docs", "firmware", "manuals", "node_modules", "board.txt"]);
  expect(row("docs")?.getAttribute("aria-expanded")).toBe("false");
  await click(row("docs"));
  await settle();
  expect(row("docs")?.getAttribute("aria-expanded")).toBe("true");
  expect(row("docs/a.pdf")?.dataset.status).toBe("indexed");
  expect(row("docs/failed.pdf")?.textContent).toContain("Failed");
  const failed = row("docs/failed.pdf")?.querySelector("[data-doc-status]");
  expect(failed?.getAttribute("title")).toBe("Failed · Processing failed");
  expect(failed?.textContent).toBe("Failed · Processing failed");
  expect(failed?.querySelector("svg")).not.toBeNull();
  await click(row("firmware"));
  await settle();
  expect(row("firmware/main.c")?.dataset.indexed).toBe("false");
  expect(row("firmware/drivers")?.dataset.treeType).toBe("folder");
  // The search box narrows the tree to name matches instead of the whole folder.
  await type("main");
  await vi.waitFor(() => expect(visible()).toEqual(["firmware", "firmware/main.c"]), { timeout: 3000 });
  expect(container.querySelector('[role="tree"]')).not.toBeNull();
});

it("lists document matches under the filtered tree from the same search box", async () => {
  await mount();
  expect(container.querySelectorAll("[data-docs-search]")).toHaveLength(1);
  expect(container.querySelector("[data-tree-filter]")).toBeNull();
  expect(container.querySelector("[data-docs-hits]")).toBeNull();
  await type("power");
  await vi.waitFor(() => expect(container.querySelector("[data-docs-hits] li")).not.toBeNull(), {
    timeout: 3000,
  });
  const hits = container.querySelector("[data-docs-hits]") as HTMLElement;
  expect(hits.querySelector("h3")?.textContent).toBe("In documents");
  expect(hits.textContent).toContain("docs/a.md#h=power");
  expect(hits.textContent).toContain("3.3 V supply");
  // The hits come after the tree.
  expect(container.querySelector('[role="tree"]')?.compareDocumentPosition(hits) ?? 0).toBe(
    Node.DOCUMENT_POSITION_FOLLOWING,
  );
  // No file is named after the query, and the tree says so while the hits still show.
  expect(container.querySelector('[role="tree"]')).not.toBeNull();
  expect(visible()).toEqual([]);
  expect(container.textContent).toContain("No files match.");
  await click(hits.querySelector("button"));
  await settle();
  expect(container.querySelector('[data-heading="power"]')?.textContent).toContain("3.3 V");
  // A name match without document hits.
  await type("rm0440");
  await vi.waitFor(() => expect(visible()).toEqual(["manuals", "manuals/rm0440-reference.txt"]), {
    timeout: 3000,
  });
  await vi.waitFor(() =>
    expect(container.querySelector("[data-docs-hits]")?.textContent).toContain("No matching documents."),
  );
  await type("");
  await vi.waitFor(() => expect(container.querySelector("[data-docs-hits]")).toBeNull());
});

it("keeps Reindex and Collapse all on one row under the search box", async () => {
  await mount();
  const collapse = () => container.querySelector<HTMLButtonElement>('[data-action="collapse-all"]');
  expect(collapse()?.disabled).toBe(true);
  await click(row("docs"));
  await settle();
  expect(collapse()?.disabled).toBe(false);
  // Matches show expanded while searching, so Collapse all waits for the box to be cleared.
  await type("main");
  expect(collapse()?.disabled).toBe(true);
  await type("");
  expect(collapse()?.disabled).toBe(false);
  const actions = container.querySelector(".docs-actions") as HTMLElement;
  expect(actions.querySelector('[data-action="reindex"]')?.textContent).toBe("Reindex");
  expect(actions.querySelector('[data-action="collapse-all"]')?.textContent).toBe("Collapse all");
  // The search box comes first, then the actions row, then the tree.
  const order = [
    container.querySelector("[data-docs-search]"),
    actions,
    container.querySelector('[role="tree"]'),
  ] as Element[];
  expect(order[0]?.compareDocumentPosition(order[1] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
  expect(order[1]?.compareDocumentPosition(order[2] as Node)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
});

it("shows entries ignored by VERA in italic with faded icons, announced, expandable and readable", async () => {
  const invoke = vi.spyOn(api, "invoke");
  await mount();
  for (const path of [".git", ".vera", "node_modules"]) {
    expect(row(path)?.dataset.ignored, path).toBe("true");
    expect(row(path)?.textContent, path).toContain("Ignored by VERA");
  }
  expect(row("docs")?.dataset.ignored).toBeUndefined();
  await click(row(".git"));
  await settle();
  expect(row(".git/config")?.dataset.ignored).toBe("true");
  expect(row(".git/config")?.textContent).not.toContain("Not indexed");
  await click(row(".git/config"));
  await settle();
  expect(invoke).toHaveBeenCalledWith("docs.read", { workbenchId: id, path: ".git/config" });
  expect(container.querySelector("[data-source-current]")?.textContent).toContain(".git/config");
  // An ignored allowlisted file has no Open in default app, in the menu or in its document tab.
  await click(row("node_modules"));
  await settle();
  await click(row("node_modules/pkg"));
  await settle();
  await contextMenu(row("node_modules/pkg/README.md"));
  await click(menuItem("open-in"));
  expect(subItems("open-in")).not.toContain("open-external");
  await click(menuItem("open"));
  await settle();
  const source = container.querySelector("[data-source-current]");
  expect(source?.textContent).toContain("node_modules/pkg/README.md");
  expect(source?.querySelector('[data-action="open-external"]')).toBeNull();
  // The name filter stays outside ignored folders.
  await type("config");
  await vi.waitFor(() => expect(container.textContent).toContain("No files match."), { timeout: 3000 });
  expect(row(".git/config")).toBeNull();
});

it("counts indexed documents beneath each folder and marks problems", async () => {
  expect(
    folderSummaries([
      { path: "a/x.md", status: "indexed" },
      { path: "a/b/y.pdf", status: "failed" },
      { path: "a/b/z.pdf", status: "indexed" },
      { path: "c/w.md", status: "indexed" },
    ]),
  ).toEqual(
    new Map([
      ["a", { count: 3, problems: true }],
      ["a/b", { count: 2, problems: true }],
      ["c", { count: 1, problems: false }],
    ]),
  );
  await mount();
  expect(row("docs")?.querySelector("[data-folder-count]")?.textContent).toBe("9");
  expect(row("docs")?.querySelector("[data-folder-problems]")).not.toBeNull();
  expect(row("firmware")?.querySelector("[data-folder-count]")).toBeNull();
  expect(row("firmware")?.querySelector("[data-folder-problems]")).toBeNull();
});

it("opens indexed documents and other text files in a document tab", async () => {
  const invoke = vi.spyOn(api, "invoke");
  await mount();
  await click(row("docs"));
  await settle();
  await click(row("docs/a.md"));
  await settle();
  expect(invoke).toHaveBeenCalledWith("docs.open", { workbenchId: id, path: "docs/a.md" });
  expect(container.querySelector('[data-heading="power"]')?.textContent).toContain("3.3 V");
  await click(row("firmware"));
  await settle();
  (row("firmware/main.c") as HTMLElement).focus();
  await key(row("firmware/main.c"), "Enter");
  await settle();
  expect(invoke).toHaveBeenCalledWith("docs.read", { workbenchId: id, path: "firmware/main.c" });
  expect(
    container.querySelector('[data-document-tabs] [role="tab"][aria-selected="true"]')?.getAttribute("title"),
  ).toBe("firmware/main.c");
  expect(container.textContent).toContain("int main(void)");
});

it("filters the whole workbench by name, expands matching folders and restores the tree afterwards", async () => {
  await mount();
  // One search box drives the filter; the Docs tab has no other text input.
  expect(container.querySelectorAll("input")).toHaveLength(1);
  await click(row("docs"));
  await settle();
  await type("rm0440");
  // Debounced, then searched: wait for the filtered rows.
  await vi.waitFor(() => expect(visible()).toEqual(["manuals", "manuals/rm0440-reference.txt"]), {
    timeout: 3000,
  });
  expect(row("manuals")?.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector("[data-tree-more]")).toBeNull();
  const original = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) =>
    channel === "docs.find"
      ? { workbenchId: id, paths: ["firmware/main.c"], truncated: true }
      : original(channel as never, request as never)) as typeof api.invoke);
  await type("main");
  await vi.waitFor(() => expect(visible()).toEqual(["firmware", "firmware/main.c"]), { timeout: 3000 });
  expect(container.querySelector("[data-tree-more]")).not.toBeNull();
  await type("");
  await vi.waitFor(() => expect(row("docs/a.pdf")).not.toBeNull(), { timeout: 3000 });
  // The expansion from before the filter comes back.
  expect(row("docs")?.getAttribute("aria-expanded")).toBe("true");
  expect(row("docs/a.pdf")).not.toBeNull();
});

it("remembers expanded folders per workbench and collapses them all", async () => {
  // Another workbench's memory is neither applied nor touched.
  const other = "vera.docs.tree.wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0D";
  localStorage.setItem(other, JSON.stringify(["firmware"]));
  await mount();
  expect(row("firmware")?.getAttribute("aria-expanded")).toBe("false");
  await click(row("docs"));
  await settle();
  await unmount();
  await mount();
  expect(row("docs")?.getAttribute("aria-expanded")).toBe("true");
  expect(row("docs/a.pdf")).not.toBeNull();
  await click(container.querySelector('[data-action="collapse-all"]'));
  await settle();
  expect(row("docs")?.getAttribute("aria-expanded")).toBe("false");
  await unmount();
  await mount();
  expect(row("docs")?.getAttribute("aria-expanded")).toBe("false");
  await click(row("docs"));
  await settle();
  expect(localStorage.getItem(`vera.docs.tree.${id}`)).toContain("docs");
  expect(localStorage.getItem(other)).toBe('["firmware"]');
});

it("drops saved folders that are gone and says when the top listing is cut off", async () => {
  localStorage.setItem(`vera.docs.tree.${id}`, JSON.stringify(["docs", "old", "old/sub"]));
  const original = api.invoke.bind(api);
  vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: { path?: string }) =>
    channel === "docs.tree" && request.path === ""
      ? { ...(await original("docs.tree", request as never)), truncated: true }
      : original(channel as never, request as never)) as typeof api.invoke);
  await mount();
  await settle();
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(JSON.parse(localStorage.getItem(`vera.docs.tree.${id}`) ?? "null")).toEqual(["docs"]);
  expect(row("docs")?.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector("[data-tree-truncated]")?.textContent).toBe(
    "Only the first 5,000 entries are shown.",
  );
});

const chat = (overrides: Partial<Attachments> = {}): Attachments => ({
  list: () => [],
  remove: () => {},
  clear: () => {},
  attach: vi.fn(),
  full: false,
  ...overrides,
});

it("offers Open, Attach as context, Open in, Show in Explorer, Copy and Properties in a context menu instead of row buttons", async () => {
  const invoke = vi.spyOn(api, "invoke");
  await mount(id, chat());
  await click(row("docs"));
  await settle();
  expect(container.querySelector('[role="tree"] button')).toBeNull();
  await contextMenu(row("docs/a.pdf"));
  expect(menuItems()).toEqual(["open", "attach", "open-in", "reveal", "copy", "properties"]);
  expect(menu()?.getAttribute("aria-label")).toContain("a.pdf");
  expect(document.activeElement).toBe(menuItem("open"));
  await key(document.activeElement, "ArrowDown");
  expect(document.activeElement).toBe(menuItem("attach"));
  await key(document.activeElement, "Escape");
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(row("docs/a.pdf"));
  // Open expands a folder and opens a file in a document tab.
  await contextMenu(row("manuals"));
  await click(menuItem("open"));
  await settle();
  expect(row("manuals")?.getAttribute("aria-expanded")).toBe("true");
  await contextMenu(row("docs/a.md"));
  await click(menuItem("open"));
  await settle();
  expect(invoke).toHaveBeenCalledWith("docs.open", { workbenchId: id, path: "docs/a.md" });
  // Shift+F10 and the context menu key open it from the keyboard; keys wrap and Tab closes.
  (row("board.txt") as HTMLElement).focus();
  await key(row("board.txt"), "F10", { shiftKey: true });
  expect(document.activeElement).toBe(menuItem("open"));
  await key(document.activeElement, "ArrowUp");
  expect(document.activeElement).toBe(menuItem("properties"));
  await key(document.activeElement, "Home");
  expect(document.activeElement).toBe(menuItem("open"));
  await key(document.activeElement, "End");
  expect(document.activeElement).toBe(menuItem("properties"));
  await key(document.activeElement, "ArrowDown");
  expect(document.activeElement).toBe(menuItem("open"));
  await key(document.activeElement, "Tab");
  expect(menu()).toBeNull();
  await key(row("board.txt"), "ContextMenu");
  expect(menu()).not.toBeNull();
  // A pointer press outside closes it.
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  expect(menu()).toBeNull();
});

it("attaches an entry to the chat unless VERA ignores it, the chat is full or none can take it", async () => {
  const attach = vi.fn();
  await mount(id, chat({ attach }));
  await contextMenu(row("board.txt"));
  expect(menuItem("attach")?.textContent).toBe("Attach as context");
  expect(menuItem("attach")?.hasAttribute("aria-disabled")).toBe(false);
  await click(menuItem("attach"));
  expect(attach).toHaveBeenCalledWith("board.txt");
  expect(menu()).toBeNull();
  // An ignored entry: the item is shown disabled, stays focusable and does nothing.
  await contextMenu(row("node_modules"));
  expect(menuItem("attach")?.getAttribute("aria-disabled")).toBe("true");
  await click(menuItem("attach"));
  (menuItem("attach") as HTMLElement).focus();
  await key(document.activeElement, "Enter");
  await key(document.activeElement, " ");
  expect(attach).toHaveBeenCalledTimes(1);
  expect(menu()).not.toBeNull();
  await unmount();
  for (const state of [chat({ full: true }), chat({ attach: undefined })]) {
    await mount(id, state);
    await contextMenu(row("board.txt"));
    expect(menuItem("attach")?.getAttribute("aria-disabled")).toBe("true");
    await unmount();
  }
});

it("operates the Open in and Copy submenus by keys and pointer", async () => {
  await mount();
  await contextMenu(row("board.txt"));
  await key(document.activeElement, "End");
  await key(document.activeElement, "ArrowUp");
  expect(document.activeElement).toBe(menuItem("copy"));
  expect(menuItem("copy")?.getAttribute("aria-haspopup")).toBe("menu");
  expect(menuItem("copy")?.getAttribute("aria-expanded")).toBe("false");
  await key(document.activeElement, "ArrowRight");
  expect(subItems("copy")).toEqual(["copy-absolute", "copy-relative", "copy-name"]);
  expect(menuItem("copy")?.getAttribute("aria-expanded")).toBe("true");
  expect(document.activeElement).toBe(menuItem("copy-absolute"));
  await key(document.activeElement, "ArrowDown");
  expect(document.activeElement).toBe(menuItem("copy-relative"));
  await key(document.activeElement, "End");
  expect(document.activeElement).toBe(menuItem("copy-name"));
  await key(document.activeElement, "ArrowDown");
  expect(document.activeElement).toBe(menuItem("copy-absolute"));
  await key(document.activeElement, "ArrowLeft");
  expect(submenu("copy")).toBeNull();
  expect(document.activeElement).toBe(menuItem("copy"));
  await key(document.activeElement, "ArrowUp");
  await key(document.activeElement, "ArrowUp");
  expect(document.activeElement).toBe(menuItem("open-in"));
  await key(document.activeElement, "Enter");
  expect(document.activeElement).toBe(submenu("open-in")?.querySelector('[role="menuitem"]'));
  // Escape in a submenu closes only the submenu.
  await key(document.activeElement, "Escape");
  expect(submenu("open-in")).toBeNull();
  expect(menu()).not.toBeNull();
  expect(document.activeElement).toBe(menuItem("open-in"));
  // Space opens it too, with focus on its first item.
  await key(document.activeElement, " ");
  expect(document.activeElement).toBe(submenu("open-in")?.querySelector('[role="menuitem"]'));
  await key(document.activeElement, "ArrowLeft");
  expect(submenu("open-in")).toBeNull();
  // A pointer hovers before it clicks: the click keeps the submenu that hover opened.
  await hover(menuItem("copy"));
  await click(menuItem("copy"));
  expect(submenu("copy")).not.toBeNull();
  await click(menuItem("copy"));
  expect(submenu("copy")).not.toBeNull();
  // Hovering an item with a submenu opens it; only one submenu is open at a time.
  await hover(menuItem("copy"));
  expect(submenu("copy")).not.toBeNull();
  await hover(menuItem("open-in"));
  expect(submenu("open-in")).not.toBeNull();
  expect(submenu("copy")).toBeNull();
  await hover(menuItem("properties"));
  expect(submenu("open-in")).toBeNull();
  (menuItem("open") as HTMLElement).focus();
  await key(document.activeElement, "Escape");
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(row("board.txt"));
});

it("opens Docs tree items in the default app and the detected programs from Open in", async () => {
  // The real invoke, taken before the spy replaces it.
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke");
  await mount();
  await click(row("docs"));
  await click(row("firmware"));
  await settle();
  await contextMenu(row("docs/a.pdf"));
  await click(menuItem("open-in"));
  expect(subItems("open-in")).toEqual(["open-external", "open-in-vscode", "open-in-notepadpp"]);
  expect(menuItem("open-external")?.textContent).toBe("Default app");
  expect(menuItem("open-external")?.getAttribute("aria-label")).toBe("Open in default app: docs/a.pdf");
  expect(menuItem("open-in-vscode")?.textContent).toBe("VS Code");
  (menuItem("open-external") as HTMLElement).focus();
  await key(document.activeElement, "Enter");
  await settle();
  expect(invoke).toHaveBeenCalledWith("app.openPath", { path: "docs/a.pdf" });
  expect(menu()).toBeNull();
  expect(document.activeElement).toBe(row("docs/a.pdf"));
  await contextMenu(row("firmware/main.c"));
  await click(menuItem("open-in"));
  expect(subItems("open-in")).toEqual(["open-in-vscode", "open-in-notepadpp"]);
  await click(menuItem("open-in-vscode"));
  await settle();
  expect(invoke).toHaveBeenCalledWith("docs.openWith", {
    workbenchId: id,
    path: "firmware/main.c",
    app: "vscode",
  });
  await contextMenu(row("firmware"));
  await click(menuItem("open-in"));
  expect(subItems("open-in")).toEqual(["open-in-vscode", "open-in-terminal"]);
  expect(menuItem("open-in-terminal")?.textContent).toBe("Terminal");
  // An ignored document has editors but no default application.
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await click(row("node_modules"));
  await settle();
  await click(row("node_modules/pkg"));
  await settle();
  await contextMenu(row("node_modules/pkg/README.md"));
  await click(menuItem("open-in"));
  expect(subItems("open-in")).toEqual(["open-in-vscode", "open-in-notepadpp"]);
  // A failure shows under the tree.
  invoke.mockImplementation((async (channel: string, request: unknown) =>
    channel === "docs.openWith"
      ? Promise.reject({ code: "INTERNAL", messageKey: "errors.INTERNAL" })
      : original(channel as never, request as never)) as typeof api.invoke);
  await click(menuItem("open-in-notepadpp"));
  await settle();
  expect(container.querySelector('.docs-tree [data-i18n="errors.INTERNAL"]')).not.toBeNull();
  // With no detected programs, a file outside the allowlist has no Open in.
  invoke.mockImplementation((async (channel: string, request: unknown) =>
    channel === "docs.openers"
      ? { apps: [] }
      : original(channel as never, request as never)) as typeof api.invoke);
  await unmount();
  await mount();
  await contextMenu(row("firmware/main.c"));
  expect(menuItems()).toEqual(["open", "reveal", "copy", "properties"]);
});

it("lists the system's applications for a file on Linux and Other app on Windows, only for files", async () => {
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke");
  await mount();
  await click(row("manuals"));
  await settle();
  // The mock reports linux and two applications registered for PNG files.
  await contextMenu(row("manuals/scope-capture.png"));
  await click(menuItem("open-in"));
  await settle();
  expect(subItems("open-in")).toEqual([
    "open-in-vscode",
    "open-in-notepadpp",
    "system-org.gnome.eog.desktop",
    "system-gimp.desktop",
  ]);
  expect(menuItem("system-gimp.desktop")?.textContent).toBe("GNU Image Manipulation Program");
  await click(menuItem("system-gimp.desktop"));
  await settle();
  expect(invoke).toHaveBeenCalledWith("docs.openSystemApp", {
    workbenchId: id,
    path: "manuals/scope-capture.png",
    app: "gimp.desktop",
  });
  // Folders get neither system applications nor Other app.
  await contextMenu(row("manuals"));
  await click(menuItem("open-in"));
  await settle();
  expect(subItems("open-in")).toEqual(["open-in-vscode", "open-in-terminal"]);
  await unmount();
  // Windows: Other app comes last for files; no system application list is asked for.
  invoke.mockClear();
  invoke.mockImplementation((async (channel: string, request: unknown) =>
    channel === "docs.openers"
      ? { apps: ["vscode", "other"] }
      : original(channel as never, request as never)) as typeof api.invoke);
  vi.spyOn(api, "getAppInfo").mockResolvedValue({ ...mockAppInfo, platform: "win32" });
  await mount();
  // The expansion is remembered from before the remount.
  expect(row("manuals")?.getAttribute("aria-expanded")).toBe("true");
  await contextMenu(row("manuals/scope-capture.png"));
  await click(menuItem("open-in"));
  await settle();
  expect(subItems("open-in")).toEqual(["open-in-vscode", "open-in-other"]);
  expect(menuItem("open-in-other")?.textContent).toBe("Other app…");
  await click(menuItem("open-in-other"));
  await settle();
  expect(invoke).toHaveBeenCalledWith("docs.openWith", {
    workbenchId: id,
    path: "manuals/scope-capture.png",
    app: "other",
  });
  expect(invoke.mock.calls.some(([channel]) => channel === "docs.systemApps")).toBe(false);
  await contextMenu(row("manuals"));
  await click(menuItem("open-in"));
  expect(subItems("open-in")).toEqual(["open-in-vscode"]);
});

it("copies a Docs tree item's path from the Copy submenu and says so", async () => {
  // The real invoke, taken before the spy replaces it.
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke");
  await mount();
  await click(row("firmware"));
  await settle();
  for (const form of ["absolute", "relative", "name"] as const) {
    await contextMenu(row("firmware/main.c"));
    await click(menuItem("copy"));
    await click(menuItem(`copy-${form}`));
    await settle();
    expect(invoke).toHaveBeenCalledWith("docs.copyPath", { workbenchId: id, path: "firmware/main.c", form });
    expect(menu()).toBeNull();
  }
  expect(container.querySelector(".docs-tree [data-tree-notice]")?.textContent).toBe(
    "Copied to the clipboard.",
  );
  invoke.mockImplementation((async (channel: string, request: unknown) =>
    channel === "docs.copyPath"
      ? Promise.reject({ code: "INTERNAL", messageKey: "errors.INTERNAL" })
      : original(channel as never, request as never)) as typeof api.invoke);
  await contextMenu(row("firmware"));
  await click(menuItem("copy"));
  await click(menuItem("copy-name"));
  await settle();
  expect(container.querySelector('.docs-tree [data-i18n="errors.INTERNAL"]')).not.toBeNull();
  expect(container.querySelector(".docs-tree [data-tree-notice]")).toBeNull();
});

it("shows a Docs tree item in the file manager under the platform's name", async () => {
  // The real invoke, taken before the spy replaces it.
  const original = api.invoke.bind(api);
  const invoke = vi.spyOn(api, "invoke");
  await mount();
  await contextMenu(row("docs"));
  // The mock reports linux.
  expect(menuItem("reveal")?.textContent).toBe("Show in folder");
  await click(menuItem("reveal"));
  await settle();
  expect(invoke).toHaveBeenCalledWith("docs.reveal", { workbenchId: id, path: "docs" });
  for (const [platform, label] of [
    ["win32", "Show in Explorer"],
    ["darwin", "Show in Finder"],
  ] as const) {
    await unmount();
    vi.spyOn(api, "getAppInfo").mockResolvedValue({ ...mockAppInfo, platform });
    await mount();
    await contextMenu(row("docs"));
    expect(menuItem("reveal")?.textContent).toBe(label);
  }
  invoke.mockImplementation((async (channel: string, request: unknown) =>
    channel === "docs.reveal"
      ? Promise.reject({ code: "INTERNAL", messageKey: "errors.INTERNAL" })
      : original(channel as never, request as never)) as typeof api.invoke);
  await click(menuItem("reveal"));
  await settle();
  expect(container.querySelector('.docs-tree [data-i18n="errors.INTERNAL"]')).not.toBeNull();
});

it("shows the properties of documents, other files and folders", async () => {
  await mount();
  await click(row("docs"));
  await click(row("firmware"));
  await settle();
  const dialog = () => container.querySelector<HTMLDialogElement>("dialog[data-tree-properties]");
  const prop = (name: string) => dialog()?.querySelector(`[data-prop="${name}"]`)?.textContent ?? null;
  const properties = async (path: string) => {
    await contextMenu(row(path));
    await click(menuItem("properties"));
    await settle();
  };
  await properties("docs/a.pdf");
  expect(dialog()?.hasAttribute("open")).toBe(true);
  expect(prop("path")).toBe("docs/a.pdf");
  expect(prop("type")).toBe("File");
  expect(prop("size")).toMatch(/100/);
  expect(prop("modified")).toMatch(/2026/);
  expect(prop("status")).toBe("Indexed");
  expect(prop("pages")).toBe("2");
  await click(dialog()?.querySelector('[data-action="close-properties"]') ?? null);
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(row("docs/a.pdf"));
  await properties("docs/failed.pdf");
  expect(prop("status")).toBe("Failed · Processing failed");
  await act(async () => {
    dialog()?.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  expect(dialog()).toBeNull();
  expect(document.activeElement).toBe(row("docs/failed.pdf"));
  await properties("firmware/main.c");
  expect(prop("status")).toBe("Not indexed");
  expect(prop("pages")).toBeNull();
  await click(dialog()?.querySelector('[data-action="close-properties"]') ?? null);
  await click(row(".git"));
  await settle();
  await properties(".git/config");
  expect(prop("status")).toBe("Ignored by VERA");
  await click(dialog()?.querySelector('[data-action="close-properties"]') ?? null);
  await properties("docs");
  expect(prop("type")).toBe("Folder");
  expect(prop("size")).toBeNull();
  expect(prop("count")).toBe("9");
  expect(prop("status")).toBeNull();
});

it("navigates the tree with ARIA roles, one tab stop and arrow keys", async () => {
  await mount();
  const tabStops = () => container.querySelectorAll('[role="treeitem"][tabindex="0"]');
  expect(tabStops()).toHaveLength(1);
  expect(row("docs")?.getAttribute("aria-level")).toBe("1");
  const docs = row("docs") as HTMLElement;
  docs.focus();
  await key(docs, "ArrowDown");
  expect(document.activeElement).toBe(row("firmware"));
  await key(document.activeElement, "ArrowUp");
  expect(document.activeElement).toBe(row("docs"));
  await key(document.activeElement, "ArrowUp");
  expect(document.activeElement).toBe(row(".vera"));
  await key(document.activeElement, "Home");
  expect(document.activeElement).toBe(row(".git"));
  await key(document.activeElement, "ArrowUp");
  expect(document.activeElement).toBe(row(".git"));
  await key(document.activeElement, "End");
  expect(document.activeElement).toBe(row("board.txt"));
  (row("docs") as HTMLElement).focus();
  await key(document.activeElement, "ArrowRight");
  await settle();
  expect(row("docs")?.getAttribute("aria-expanded")).toBe("true");
  await key(document.activeElement, "ArrowRight");
  expect(document.activeElement).toBe(row("docs/a.html"));
  expect(row("docs/a.html")?.getAttribute("aria-level")).toBe("2");
  await key(document.activeElement, "ArrowLeft");
  expect(document.activeElement).toBe(row("docs"));
  await key(document.activeElement, "ArrowLeft");
  expect(row("docs")?.getAttribute("aria-expanded")).toBe("false");
  expect(tabStops()).toHaveLength(1);
  expect(tabStops()[0]).toBe(row("docs"));
});
