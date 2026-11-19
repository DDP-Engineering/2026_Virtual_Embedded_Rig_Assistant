// @vitest-environment jsdom
// REQ-UX-9c6aa149
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import i18n from "../../i18n.js";
import { TranscriptImages } from "./transcript-images.js";

const invoke = vi.hoisted(() => vi.fn());
vi.mock("../../api/index.js", () => ({ api: { invoke, subscribe: () => () => {} } }));
vi.mock("../documents/viewer-context.js", () => ({
  CHAT: "chat",
  useDocumentTabs: () => undefined,
  useDocumentViewer: () => undefined,
}));

it("releases an offscreen thumbnail and waits for a fresh preview when the row returns", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  let show: (visible: boolean) => void = () => {};
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(callback: (entries: { isIntersecting: boolean }[]) => void) {
        show = (isIntersecting) => callback([{ isIntersecting }]);
      }
      observe() {}
      disconnect() {}
    },
  );
  const createObjectURL = vi.fn().mockReturnValueOnce("blob:before").mockReturnValueOnce("blob:after");
  const revokeObjectURL = vi.fn();
  vi.stubGlobal(
    "URL",
    class extends URL {
      static override createObjectURL = createObjectURL;
      static override revokeObjectURL = revokeObjectURL;
    },
  );
  const data = {
    workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    path: "scope.png",
    displayPath: "scope.png",
    preview: { thumbnail: "AAAA", format: "png" },
  };
  let finish: (value: typeof data) => void = () => {};
  invoke.mockResolvedValueOnce(data).mockReturnValueOnce(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  await i18n.changeLanguage("en");
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(TranscriptImages, { workbenchId: data.workbenchId, paths: [data.path] })),
    );
    expect(invoke).not.toHaveBeenCalled();
    await act(async () => show(true));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:before");
    await act(async () => show(false));
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:before");
    expect(container.querySelector(".transcript-image-placeholder")).not.toBeNull();

    await act(async () => show(true));
    expect(container.querySelector("img")).toBeNull();
    await act(async () => finish(data));
    expect(container.querySelector("img")?.getAttribute("src")).toBe("blob:after");
  } finally {
    await act(async () => root.unmount());
    vi.unstubAllGlobals();
  }
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:after");
});
