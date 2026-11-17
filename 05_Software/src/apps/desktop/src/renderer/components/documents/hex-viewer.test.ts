// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import "../../i18n.js";
import { HexViewer } from "./hex-viewer.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
function base64(bytes: Uint8Array) {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}
const file = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  path: "opaque.",
  size: 131091,
  modified: "2026-11-17",
};
it("navigates, finds a border sequence, selects/copies bytes, validates inputs and retries", async () => {
  const bytes = new Uint8Array(file.size).fill(46);
  bytes.set([65, 66, 0, 255, 67], 65534);
  bytes.set([0, 31, 65], file.size - 3);
  let fail = false;
  const calls = vi.mocked(api.invoke).mockImplementation((async (
    channel: string,
    input: { offset: number; length: number },
  ) => {
    if (channel === "docs.stat")
      return { workbenchId: file.workbenchId, properties: { ...file, type: "file" } };
    if (fail) {
      fail = false;
      throw { code: "OFFLINE", messageKey: "errors.OFFLINE" };
    }
    return {
      workbenchId: file.workbenchId,
      path: file.path,
      size: file.size,
      offset: input.offset,
      data: base64(bytes.subarray(input.offset, input.offset + input.length)),
    };
  }) as typeof api.invoke);
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  const wait = async (predicate: () => boolean) => {
    for (let i = 0; i < 100 && !predicate(); i++)
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    expect(predicate()).toBe(true);
  };
  const click = async (selector: string) =>
    act(async () => {
      (node.querySelector(selector) as HTMLElement)?.click();
    });
  const input = async (selector: string, value: string) =>
    act(async () => {
      const field = node.querySelector(selector) as HTMLInputElement;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(field, value);
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
  const submit = async (selector: string) =>
    act(async () => {
      node.querySelector(selector)?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
  let copied = "";
  const exec = vi.fn(() => {
    copied = (document.activeElement as HTMLTextAreaElement).value;
    return true;
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
  try {
    await act(async () => root.render(createElement(StrictMode, null, createElement(HexViewer, { file }))));
    await wait(() => !!node.querySelector("[data-hex-byte]"));
    expect(node.querySelectorAll("[data-hex-row]").length).toBeLessThanOrEqual(100);
    await click("[data-hex-find-open]");
    await input("[data-document-search]", "41 42 00 FF 43");
    await submit("[data-hex-find-form]");
    await wait(() => node.querySelector('[data-hex-byte="65534"]')?.getAttribute("aria-pressed") === "true");
    await click('[data-hex-copy="hex"]');
    await wait(() => exec.mock.calls.length === 1);
    expect(copied).toBe("41 42 00 FF 43");
    const search = node.querySelector("[data-document-search]") as HTMLElement;
    await act(async () =>
      search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })),
    );
    expect(document.activeElement?.hasAttribute("data-hex-rows")).toBe(true);
    await click("[data-hex-goto-open]");
    await input("[data-hex-offset]", "0x20010");
    await submit("[data-hex-goto-form]");
    await wait(() => !!node.querySelector('[data-hex-byte="131088"]'));
    expect(node.querySelector('[data-hex-row="131088"] [data-hex-ascii]')?.textContent).toBe("..A");
    await click('[data-hex-byte="131090"]');
    await click('[data-hex-copy="text"]');
    await wait(() => exec.mock.calls.length === 2);
    expect(copied).toBe("A");
    await input("[data-hex-offset]", "-1");
    await submit("[data-hex-goto-form]");
    expect(node.querySelector("[data-hex-invalid]")).not.toBeNull();
    fail = true;
    await input("[data-hex-offset]", "65500");
    await submit("[data-hex-goto-form]");
    await wait(() => !!node.querySelector("[data-hex-retry]"));
    await click("[data-hex-retry]");
    await wait(() => !!node.querySelector('[data-hex-byte="65500"]'));
    expect(
      calls.mock.calls
        .filter(([channel]) => channel === "docs.readBytes")
        .every(([, request]) => (request as { length: number }).length <= 65536),
    ).toBe(true);
  } finally {
    await act(async () => root.unmount());
    node.remove();
    vi.restoreAllMocks();
  }
});
