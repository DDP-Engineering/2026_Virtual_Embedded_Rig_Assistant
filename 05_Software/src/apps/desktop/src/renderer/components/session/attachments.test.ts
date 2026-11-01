// @vitest-environment jsdom
// REQ-UX-b5edf930 REQ-UX-f8ec3a43 REQ-FUNC-47287974
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../../App.js";
import { api } from "../../api/index.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api, usingMocks: true };
});
let root: Root;
let container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
  this.dispatchEvent(new Event("close"));
};
const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 60));
  });
async function mount() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(App),
      ),
    ),
  );
  await settle();
}
afterEach(async () => {
  vi.restoreAllMocks();
  localStorage.clear();
  await act(async () => root?.unmount());
  container?.remove();
});
const row = (path: string) =>
  container.querySelector<HTMLElement>(`[role="treeitem"][data-tree-path="${path}"]`);
const chips = () =>
  [...container.querySelectorAll<HTMLElement>("[data-attachment]")].map((chip) => chip.dataset.attachment);
const message = () => container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Message"]');
async function openDocs() {
  if (!container.querySelector("#tab-docs"))
    await act(async () => container.querySelector<HTMLButtonElement>('[data-toggle="right"]')?.click());
  await act(async () => container.querySelector<HTMLButtonElement>("#tab-docs")?.click());
  await settle();
}
async function expand(path: string) {
  if (row(path)?.getAttribute("aria-expanded") === "false") {
    await act(async () => row(path)?.click());
    await settle();
  }
}
/** Chooses Attach as context in a row's menu and returns that menu item as it was. */
async function attach(path: string) {
  await act(async () => {
    row(path)?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const item = container.querySelector<HTMLElement>('[data-tree-menu] [data-menu-action="attach"]');
  const disabled = item?.getAttribute("aria-disabled");
  await act(async () => item?.click());
  await settle();
  // A disabled item leaves the menu open; close it like a press outside.
  await act(async () => {
    document.body.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  return disabled;
}
async function type(value: string) {
  const node = message() as HTMLTextAreaElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(node, value);
    node.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const send = () =>
  act(async () => container.querySelector<HTMLButtonElement>('[data-action="send-message"]')?.click());

test("attaches Docs tree entries to the active chat from the workbench page and sends them as mentions", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  expect(message()).toBeNull();
  await openDocs();
  await expand("docs");
  expect(await attach("docs/a.pdf")).toBeNull();
  // The chat of the active session opens with the entry as a chip.
  expect(message()).not.toBeNull();
  expect(chips()).toEqual(["docs/a.pdf"]);
  const chip = container.querySelector<HTMLElement>('[data-attachment="docs/a.pdf"]');
  expect(chip?.textContent).toContain("a.pdf");
  expect(chip?.getAttribute("title")).toBe("docs/a.pdf");
  await openDocs();
  await attach("docs/a.pdf");
  await attach("board.txt");
  expect(chips()).toEqual(["docs/a.pdf", "board.txt"]);
  const second = container.querySelector<HTMLElement>('[data-attachment="board.txt"]');
  expect(second?.textContent).toContain("board.txt");
  expect(second?.getAttribute("title")).toBe("board.txt");
  // Entries VERA ignores cannot be attached.
  await expand("node_modules");
  await expand("node_modules/pkg");
  expect(await attach("node_modules/pkg/README.md")).toBe("true");
  expect(chips()).toEqual(["docs/a.pdf", "board.txt"]);
  await act(async () =>
    container.querySelector<HTMLButtonElement>('[aria-label="Remove attachment: docs/a.pdf"]')?.click(),
  );
  expect(chips()).toEqual(["board.txt"]);
  // Focus stays in the composer when its chip goes away.
  expect(document.activeElement).toBe(message());
  // A failed send keeps the text and the chips; polls in between still reach the mock.
  const original = api.invoke.bind(api);
  let failSend = true;
  const invoke = vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    if (channel === "session.send" && failSend) {
      failSend = false;
      throw { code: "INTERNAL", messageKey: "errors.INTERNAL" };
    }
    return original(channel as never, request as never);
  }) as typeof api.invoke);
  await type("Summarize this");
  await send();
  await settle();
  expect(chips()).toEqual(["board.txt"]);
  expect(message()?.value).toBe("Summarize this");
  // An accepted send carries the mentions after the text and clears the chips.
  await send();
  await settle();
  expect(invoke).toHaveBeenCalledWith("session.send", {
    sessionId: expect.any(String),
    text: "Summarize this\n@board.txt",
  });
  expect(chips()).toEqual([]);
  // With only an attachment, the message is the mention alone.
  await openDocs();
  await attach("docs/a.pdf");
  await send();
  await settle();
  expect(invoke).toHaveBeenCalledWith("session.send", { sessionId: expect.any(String), text: "@docs/a.pdf" });
});

// TASK-79f6ffd3: the conversation hidden behind a document tab
test("attaching while a document tab is shown brings back the Chat tab, and hidden chat ignores window keys", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  await openDocs();
  await expand("docs");
  await act(async () => container.querySelector<HTMLElement>('[data-document="docs/a.md"]')?.click());
  await settle();
  const selected = () =>
    container.querySelector<HTMLElement>('[data-document-tabs] [role="tab"][aria-selected="true"]')
      ?.textContent;
  expect(selected()).toBe("a.md");
  // Ctrl+F outside the document belongs to no hidden conversation search.
  await act(async () => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "f", ctrlKey: true, bubbles: true }));
  });
  expect(container.querySelector(".transcript-search")).toBeNull();
  await attach("board.txt");
  expect(selected()).toBe("Chat");
  expect(chips()).toEqual(["board.txt"]);
  expect(document.activeElement).toBe(message());
  expect(container.querySelector(".transcript-search")).toBeNull();
});

test("a taken composer focus request never pulls a later document tab back to Chat", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  const selected = () =>
    container.querySelector<HTMLElement>('[data-document-tabs] [role="tab"][aria-selected="true"]')
      ?.textContent;
  await openDocs();
  await expand("docs");
  await attach("board.txt");
  expect(document.activeElement).toBe(message());
  // Leave the chat area and come back through a document: the old request is gone.
  await act(async () => container.querySelector<HTMLButtonElement>('[data-action="plugins-nav"]')?.click());
  expect(container.querySelector("[data-document-tabs]")).toBeNull();
  await openDocs();
  await expand("docs");
  await act(async () => container.querySelector<HTMLElement>('[data-document="docs/a.md"]')?.click());
  await settle();
  expect(selected()).toBe("a.md");
});

test("attaching while the composer is disabled shows Chat once and lets documents stay selected", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  const selected = () =>
    container.querySelector<HTMLElement>('[data-document-tabs] [role="tab"][aria-selected="true"]')
      ?.textContent;
  await openDocs();
  await expand("docs");
  await act(async () => container.querySelector<HTMLElement>('[data-document="docs/a.md"]')?.click());
  await settle();
  const [session] = await api.invoke("session.list", {});
  if (!session) throw Error("Missing session");
  await act(async () => {
    await api.invoke("session.send", { sessionId: session.id, text: "edit notes" });
  });
  await act(async () => {
    await new Promise((done) => setTimeout(done, 400));
  });
  await attach("board.txt");
  expect(selected()).toBe("Chat");
  expect(message()?.disabled).toBe(true);
  await act(async () =>
    [...container.querySelectorAll<HTMLElement>('[data-document-tabs] [role="tab"]')]
      .find((tab) => tab.textContent === "a.md")
      ?.click(),
  );
  await settle();
  await settle();
  expect(selected()).toBe("a.md");
});

// REQ-UX-f261c988: the document tab menu attaches its file like the Files tree.
test("attaches a document from its tab menu and brings back the Chat tab", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  await openDocs();
  await expand("docs");
  await act(async () => container.querySelector<HTMLElement>('[data-document="docs/a.md"]')?.click());
  await settle();
  const tab = [...container.querySelectorAll<HTMLElement>('[data-document-tabs] [role="tab"]')].find(
    (node) => node.textContent === "a.md",
  );
  await act(async () => {
    tab?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  await act(async () =>
    container.querySelector<HTMLElement>('[data-tree-menu] [data-menu-action="attach"]')?.click(),
  );
  await settle();
  expect(chips()).toEqual(["docs/a.md"]);
  expect(
    container.querySelector('[data-document-tabs] [role="tab"][aria-selected="true"]')?.textContent,
  ).toBe("Chat");
  await act(async () => {
    await new Promise((done) => setTimeout(done, 50));
  });
  expect(document.activeElement).toBe(message());
});

test("keeps the attachments of each session apart", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  await mount();
  const sessions = await api.invoke("session.list", {});
  const [first, second] = sessions;
  const open = (id: string | undefined) =>
    act(async () => container.querySelector<HTMLButtonElement>(`[data-session="${id}"]`)?.click());
  await open(first?.id);
  await settle();
  await openDocs();
  await attach("board.txt");
  expect(chips()).toEqual(["board.txt"]);
  await open(second?.id);
  await settle();
  expect(chips()).toEqual([]);
  // The second session gets its own chip.
  await openDocs();
  await expand("docs");
  await attach("docs/a.md");
  expect(chips()).toEqual(["docs/a.md"]);
  await open(first?.id);
  await settle();
  expect(chips()).toEqual(["board.txt"]);
  await open(second?.id);
  await settle();
  expect(chips()).toEqual(["docs/a.md"]);
});

test("creates a session to attach to when the workbench has none", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
  const original = api.invoke.bind(api);
  let created = false;
  const invoke = vi.spyOn(api, "invoke").mockImplementation((async (channel: string, request: unknown) => {
    if (channel === "session.create") created = true;
    if (channel === "session.list" && !created) return [];
    return original(channel as never, request as never);
  }) as typeof api.invoke);
  await mount();
  await openDocs();
  await attach("board.txt");
  expect(invoke).toHaveBeenCalledWith("session.create", expect.objectContaining({ reuseEmpty: true }));
  expect(message()).not.toBeNull();
  expect(chips()).toEqual(["board.txt"]);
});
