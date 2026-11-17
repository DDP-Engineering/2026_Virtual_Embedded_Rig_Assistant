// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import "../../i18n.js";
import { TextViewer } from "./text-viewer.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

// REQ-FUNC-c5def0c3 REQ-UX-5a886e34
it("decodes BOM text, re-decodes Latin bytes and explicitly replaces invalid UTF8", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const user = userEvent.setup();
  const content = {
    kind: "text" as const,
    path: "sample.txt",
    ref: null,
    snippet: "",
    lines: [""],
    start: 1,
    end: 1,
  };
  const render = (bytes: Uint8Array, key: string) =>
    act(async () =>
      root.render(
        createElement(TextViewer, {
          key,
          content,
          bytes,
          findRequest: 0,
          gotoRequest: 0,
        }),
      ),
    );
  try {
    await render(Uint8Array.of(0xff, 0xfe, 0x63, 0, 0x61, 0, 0x66, 0, 0xe9, 0), "bom");
    expect(container.querySelector('[data-line="1"]')?.textContent).toContain("café");
    expect(container.querySelector<HTMLSelectElement>("[data-text-encoding]")?.value).toBe("utf-16le");
    await render(Uint8Array.of(0x63, 0x61, 0x66, 0xe9, 0x20, 0x80), "latin");
    expect(container.querySelector('[data-line="1"]')).toBeNull();
    await act(async () =>
      user.selectOptions(container.querySelector("select") as HTMLSelectElement, "iso-8859-1"),
    );
    expect(container.querySelector('[data-line="1"]')?.textContent).toContain("café €");
    await act(async () =>
      user.selectOptions(container.querySelector("select") as HTMLSelectElement, "iso-8859-2"),
    );
    expect(container.querySelector('[data-line="1"]')?.textContent).toContain("café \u0080");
    await act(async () =>
      user.selectOptions(container.querySelector("select") as HTMLSelectElement, "utf-8"),
    );
    await act(async () => (container.querySelector("[data-show-as-text]") as HTMLButtonElement).click());
    expect(container.querySelector('[data-line="1"]')?.textContent).toContain("caf� �");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});

// REQ-UX-77baabba
it("measures unequal wrapped rows and settles distant Find and Go to line", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const user = userEvent.setup();
  const rect = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
    this: HTMLElement,
  ) {
    const row = this.hasAttribute("data-line");
    const wrapped = this.closest('[data-wrap="true"]');
    return {
      height: row && wrapped ? 80 : 20,
      width: 400,
      top: 0,
      left: 0,
      bottom: 0,
      right: 400,
      x: 0,
      y: 0,
      toJSON() {},
    };
  });
  const content = {
    kind: "text" as const,
    path: "wrapped.log",
    ref: null,
    snippet: "",
    lines: Array.from({ length: 1400 }, (_, i) => `Source ${i + 1} ${"long words ".repeat(30)}`),
    start: 1,
    end: 1400,
  };
  const render = (findRequest = 0, gotoRequest = 0) =>
    act(async () => root.render(createElement(TextViewer, { content, findRequest, gotoRequest })));
  try {
    await render();
    const wrap = container.querySelector<HTMLInputElement>("[data-text-wrap]");
    expect(wrap).not.toBeNull();
    await act(async () => user.click(wrap as HTMLInputElement));
    expect(container.querySelector(".document-lines")).toHaveProperty("dataset.wrap", "true");
    await render(0, 1);
    await act(async () =>
      user.type(container.querySelector("[data-document-goto]") as HTMLInputElement, "1200{Enter}"),
    );
    const row = container.querySelector<HTMLElement>('[data-line="1200"]');
    expect(row?.textContent).toContain("Source 1200");
    expect(row?.style.height).not.toBe("20px");
    const scroll = container.querySelector<HTMLElement>(".document-body");
    expect(scroll?.scrollTop).toBe(Number.parseFloat(row?.style.top ?? "NaN"));
    await render(1, 1);
    await act(async () =>
      user.type(container.querySelector("[data-document-search]") as HTMLInputElement, "Source 1375 "),
    );
    const hit = container.querySelector<HTMLElement>('[data-line="1375"]');
    expect(hit?.dataset.currentMatch).toBe("true");
    expect(scroll?.scrollTop).toBe(Number.parseFloat(hit?.style.top ?? "NaN"));
    expect(container.querySelectorAll("[data-line]").length).toBeLessThan(150);
  } finally {
    rect.mockRestore();
    await act(async () => root.unmount());
    container.remove();
  }
});
