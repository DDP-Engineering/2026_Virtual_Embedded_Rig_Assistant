// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import "../../i18n.js";
import { DocumentTabs } from "./document-tabs.js";
import { DocumentViewerProvider, useDocumentViewer } from "./viewer-context.js";

vi.mock("../../api/index.js", async () => {
  const { createMockApi } = await import("../../mocks/mockApi.js");
  return { api: createMockApi(undefined, "chat").api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const id = "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C";

it("opens compact verified citations at their range, wraps Find counts, restores Escape focus and retries failed windows", async () => {
  const raw = new TextEncoder().encode(
    Array.from(
      { length: 300 },
      (_, i) => `Source ${i + 1} ${[5, 150, 290].includes(i + 1) ? "HIT HIT " : ""}${"x".repeat(21000)}\r\n`,
    ).join(""),
  );
  const allEnds: number[] = [];
  for (let i = 0; i < raw.length; i++) if (raw[i] === 10) allEnds.push(i + 1);
  let failed = false,
    opens = 0;
  const original = api.invoke.bind(api);
  const spy = vi.spyOn(api, "invoke").mockImplementation((async (
    channel: string,
    input: { requestId?: string; path?: string; offset: number; length: number; revision?: string },
  ) => {
    if (channel === "docs.open") {
      opens++;
      return {
        workbenchId: id,
        requestId: input.requestId,
        content: {
          kind: "text",
          path: "opaque.",
          ref: "large.txt#L250-L251",
          snippet: "issued",
          lines: [],
          start: 250,
          end: 251,
          byteSource: {
            size: raw.length,
            modified: "2026-11-17T00:00:00.000Z",
            revision: "sealed",
            lines: 300,
            utf8Log: false,
          },
        },
      };
    }
    if (channel === "docs.stat")
      return {
        workbenchId: id,
        properties: { path: "opaque.", type: "file", size: raw.length, modified: "2026-11-17T00:00:00.000Z" },
      };
    if (channel === "docs.readBytes") {
      if (failed) {
        failed = false;
        throw { code: "OFFLINE", messageKey: "errors.OFFLINE" };
      }
      expect(input.revision).toBe("sealed");
      expect(input.length).toBeLessThanOrEqual(256 * 1024);
      const part = raw.subarray(input.offset, input.offset + input.length);
      let binary = "";
      for (let i = 0; i < part.length; i += 8192)
        binary += String.fromCharCode(...part.subarray(i, i + 8192));
      return {
        workbenchId: id,
        path: "opaque.",
        size: raw.length,
        offset: input.offset,
        revision: "sealed",
        lineEnds: allEnds
          .filter((end) => end > input.offset && end <= input.offset + part.length)
          .map((end) => end - input.offset),
        data: btoa(binary),
      };
    }
    return original(channel as never, input as never);
  }) as typeof api.invoke);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node),
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Open() {
    const open = useDocumentViewer();
    return createElement(
      "button",
      { type: "button", onClick: () => open?.({ ref: "large.txt#L250-L251" }) },
      "Open",
    );
  }
  const wait = async (predicate: () => boolean) => {
    for (let i = 0; i < 300 && !predicate(); i++)
      await act(async () => new Promise((done) => setTimeout(done, 20)));
    expect(predicate()).toBe(true);
  };
  const key = async (target: Element, key: string, extra = {}) =>
    act(async () =>
      target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...extra })),
    );
  const fill = async (target: HTMLInputElement, value: string) =>
    act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(target, value);
      target.dispatchEvent(new Event("input", { bubbles: true }));
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
            createElement(Open),
            createElement(DocumentTabs, { chat: null }),
          ),
        ),
      ),
    );
    await act(async () => node.querySelector<HTMLButtonElement>("button")?.click());
    await wait(
      () =>
        node.querySelector('[data-line="250"][aria-current="true"]') !== null &&
        node.querySelector("[data-text-cancel]") === null,
    );
    expect(node.querySelector('[data-line="251"]')?.getAttribute("aria-current")).toBe("true");
    expect(node.querySelector("[data-text-encoding]")).toBeNull();
    const panel = node.querySelector("[data-source-current]") as HTMLElement;
    await key(panel, "f", { ctrlKey: true });
    await fill(node.querySelector("[data-document-search]") as HTMLInputElement, "hit");
    await wait(
      () => node.textContent?.includes("1 of 3") === true && !node.querySelector("[data-text-cancel]"),
    );
    await key(node.querySelector("[data-document-search]") as Element, "Enter", { shiftKey: true });
    await wait(
      () => node.textContent?.includes("3 of 3") === true && !node.querySelector("[data-text-cancel]"),
    );
    await key(node.querySelector("[data-document-search]") as Element, "Enter");
    await wait(
      () => node.textContent?.includes("1 of 3") === true && !node.querySelector("[data-text-cancel]"),
    );
    await key(node.querySelector("[data-document-search]") as Element, "Escape");
    expect(document.activeElement).toBe(node.querySelector(".document-body"));
    await key(document.activeElement as Element, "g", { ctrlKey: true });
    expect(node.querySelector("[data-document-goto]")).not.toBeNull();
    await key(node.querySelector("[data-document-goto]") as Element, "Escape");
    expect(document.activeElement).toBe(node.querySelector(".document-body"));
    failed = true;
    await fill(node.querySelector("[data-byte-scroll]") as HTMLInputElement, "3001234");
    await wait(() => !!node.querySelector('[role="alert"]'));
    const retry = [...node.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "Retry",
    );
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    await wait(() => !!node.querySelector('[data-line="5"]') && !node.querySelector("[data-text-cancel]"));
    expect(opens).toBe(2);
    expect(node.querySelector('[role="alert"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    client.clear();
    node.remove();
    spy.mockRestore();
  }
}, 20000);
