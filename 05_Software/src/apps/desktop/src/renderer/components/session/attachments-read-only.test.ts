// @vitest-environment jsdom
// REQ-UX-b5edf930
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { App } from "../../App.js";
import { api } from "../../api/index.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "read-only").api, usingMocks: true };
});
let root: Root;
let container: HTMLDivElement;
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
const settle = () =>
  act(async () => {
    await new Promise((done) => setTimeout(done, 60));
  });
afterEach(async () => {
  localStorage.clear();
  await act(async () => root?.unmount());
  container?.remove();
});

test("a read-only workbench offers Attach as context disabled and attaches nothing", async () => {
  await api.invoke("workbench.open", { folder: "/mock/demo-board" });
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
  if (!container.querySelector("#tab-docs"))
    await act(async () => container.querySelector<HTMLButtonElement>('[data-toggle="right"]')?.click());
  await act(async () => container.querySelector<HTMLButtonElement>("#tab-docs")?.click());
  await settle();
  const row = container.querySelector<HTMLElement>('[role="treeitem"][data-tree-path="board.txt"]');
  await act(async () => {
    row?.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
  });
  const item = container.querySelector<HTMLElement>('[data-tree-menu] [data-menu-action="attach"]');
  expect(item?.getAttribute("aria-disabled")).toBe("true");
  await act(async () => item?.click());
  await settle();
  expect(container.querySelector("[data-attachment]")).toBeNull();
  expect(container.querySelector("[data-tree-menu]")).not.toBeNull();
});
