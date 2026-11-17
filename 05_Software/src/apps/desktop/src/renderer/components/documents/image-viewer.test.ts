// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import "../../i18n.js";
import { DocumentBody } from "./viewer-context.js";

vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const file = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
  path: "opaque.",
  size: 4,
  modified: null,
  mime: "image/svg+xml",
};
const content = {
  kind: "text" as const,
  path: file.path,
  ref: null,
  snippet: "",
  lines: [],
  start: 1,
  end: 1,
};
const created = vi.fn(() => "blob:owned-image"),
  revoked = vi.fn();
Object.assign(URL, { createObjectURL: created, revokeObjectURL: revoked });
afterEach(() => {
  vi.resetAllMocks();
});
async function wait(predicate: () => boolean) {
  for (let i = 0; i < 100 && !predicate(); i++)
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  expect(predicate()).toBe(true);
}
function serve() {
  vi.mocked(api.invoke).mockImplementation((async (
    channel: string,
    input: { offset: number; length: number },
  ) =>
    channel === "docs.stat"
      ? { workbenchId: file.workbenchId, properties: { ...file, type: "file" } }
      : {
          workbenchId: file.workbenchId,
          path: file.path,
          size: file.size,
          offset: input.offset,
          data: "PHN2Zw==",
        }) as typeof api.invoke);
}
it("owns an inert img URL under StrictMode, constrains Fit to the viewport and scales the original resource through400 percent", async () => {
  serve();
  created.mockReturnValue("blob:owned-image");
  const node = document.createElement("div");
  document.body.append(node);
  const root = createRoot(node);
  try {
    await act(async () =>
      root.render(
        createElement(StrictMode, null, createElement(DocumentBody, { content, ...{ imageFile: file } })),
      ),
    );
    await wait(() => !!node.querySelector("img"));
    const img = node.querySelector("img") as HTMLImageElement;
    expect(img.getAttribute("src")).toBe("blob:owned-image");
    expect(node.querySelector("svg, iframe, object")).toBeNull();
    Object.defineProperties(img, { naturalWidth: { value: 800 }, naturalHeight: { value: 400 } });
    await act(async () => {
      img.dispatchEvent(new Event("load"));
    });
    expect(img.style.width).toBe("");
    expect(img.style.maxWidth).toBe("100%");
    expect(img.style.maxHeight).toBe("100%");
    const select = node.querySelector("[data-image-zoom]") as HTMLSelectElement;
    await act(async () => {
      select.value = "400";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(img.style.width).toBe("3200px");
    expect(img.style.height).toBe("1600px");
    await act(async () => {
      select.value = "50";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(img.style.width).toBe("400px");
    await act(async () => {
      select.value = "fit";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(img.style.width).toBe("");
    expect(img.style.maxWidth).toBe("100%");
    expect(node.querySelector("[data-image-fit]")).not.toBeNull();
    expect(created).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
  expect(revoked).toHaveBeenCalledWith("blob:owned-image");
});

it("keeps typed read errors and safe decode failures retryable", async () => {
  serve();
  created.mockReturnValue("blob:owned-image");
  const retry = vi.fn(),
    node = document.createElement("div"),
    root = createRoot(node);
  document.body.append(node);
  try {
    await act(async () =>
      root.render(createElement(DocumentBody, { content, retry, ...{ imageFile: file } })),
    );
    await wait(() => !!node.querySelector("img"));
    await act(async () => node.querySelector("img")?.dispatchEvent(new Event("error")));
    expect(node.textContent).toContain("Cannot preview this image");
    await act(async () => (node.querySelector("[data-image-retry]") as HTMLElement).click());
    expect(retry).toHaveBeenCalledOnce();
    expect(revoked).toHaveBeenCalledWith("blob:owned-image");
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});

it("does not publish a late Blob after unmount and retains typed changed-file errors", async () => {
  const node = document.createElement("div");
  document.body.append(node);
  let release: ((value: unknown) => void) | undefined;
  vi.mocked(api.invoke).mockImplementation(
    (() =>
      new Promise<unknown>((resolve) => {
        release = resolve;
      })) as typeof api.invoke,
  );
  let root = createRoot(node);
  await act(async () => root.render(createElement(DocumentBody, { content, ...{ imageFile: file } })));
  await act(async () => root.unmount());
  await act(async () => release?.({ workbenchId: file.workbenchId, properties: { ...file, type: "file" } }));
  expect(created).not.toHaveBeenCalled();
  vi.mocked(api.invoke).mockRejectedValue({ code: "CONFLICT", messageKey: "errors.CONFLICT" });
  root = createRoot(node);
  try {
    await act(async () => root.render(createElement(DocumentBody, { content, ...{ imageFile: file } })));
    await wait(() => !!node.querySelector("[data-image-retry]"));
    expect(node.textContent).toContain("The operation conflicts with the current state.");
    expect(node.querySelector("img")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    node.remove();
  }
});
