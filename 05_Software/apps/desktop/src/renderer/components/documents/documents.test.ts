// @vitest-environment jsdom
// REQ-UX-28ad0002 REQ-UX-28ad0003
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { DocsTab } from "./docs-tab.js";
import { DocumentBody, DocumentViewerProvider, useDocumentViewer } from "./viewer-context.js";
import "../../i18n.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.open = true;
};
HTMLDialogElement.prototype.close = function () {
  this.open = false;
};
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";
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
          ),
        ),
      ),
    );
  try {
    await render(false);
    await settle();
    expect(container.querySelectorAll("[data-document]")).toHaveLength(8);
    expect(container.textContent).toContain("Needs OCR");
    const doc = container.querySelector<HTMLButtonElement>('[data-document="docs/a.md"] button');
    doc?.focus();
    await act(async () => doc?.click());
    await settle();
    expect(container.querySelector('[data-heading="power"]')?.textContent).toContain("3.3 V");
    await act(async () => container.querySelector<HTMLButtonElement>("dialog header button")?.click());
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
        createElement(DocumentViewerProvider, { key: "one", workbenchId: id }, createElement(Open)),
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
    await act(async () => container.querySelector<HTMLButtonElement>("dialog header button")?.click());
    await act(async () => container.querySelector<HTMLButtonElement>("button")?.click());
    await act(async () =>
      root.render(
        createElement(DocumentViewerProvider, { key: "one", workbenchId: "other" }, createElement(Open)),
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
    expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).not.toContain("secret");
  } finally {
    invoke.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});
it("bounds large text DOM while preserving absolute line numbers and cited ranges", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(DocumentBody, {
          content: {
            kind: "text",
            path: "large.log",
            ref: "large.log#L1500-L1502",
            snippet: "",
            lines: Array.from({ length: 2000 }, (_, i) => `Source ${i + 1}`),
            start: 1500,
            end: 1502,
          },
        }),
      ),
    );
    expect(container.querySelectorAll("[data-line]")).toHaveLength(250);
    expect(container.querySelector('[data-line="1500"]')?.textContent).toBe("1500Source 1500");
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(3);
    const next = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (b) => b.textContent === "Next page",
    );
    await act(async () => next?.click());
    expect(container.querySelectorAll("[data-line]")).toHaveLength(250);
    expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(0);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
