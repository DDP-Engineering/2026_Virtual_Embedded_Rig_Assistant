// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { terminalDocument } from "./terminal-document.js";

it("scopes xterm CSSOM sheets and restores the document factory even after open fails", () => {
  const replace = vi.fn();
  vi.stubGlobal(
    "CSSStyleSheet",
    class {
      replaceSync = replace;
    },
  );
  const unrelated = {} as CSSStyleSheet;
  Object.defineProperty(document, "adoptedStyleSheets", {
    configurable: true,
    writable: true,
    value: [unrelated],
  });
  const sourceCreate = document.createElement;
  const styles = terminalDocument(document);
  try {
    const sheet = styles.document.createElement("style");
    expect(sheet.tagName).toBe("SPAN");
    sheet.textContent = ".xterm { color: red; }";
    expect(replace).toHaveBeenCalledWith(".xterm { color: red; }");
    const cell = styles.document.createElement("span");
    cell.setAttribute("style", "color: red;");
    expect(cell.style.color).toBe("red");
    expect(() =>
      styles.open(() => {
        expect(document.createElement("style").tagName).toBe("SPAN");
        throw Error("open failed");
      }),
    ).toThrow("open failed");
    expect(document.createElement).toBe(sourceCreate);
  } finally {
    styles.dispose();
    vi.unstubAllGlobals();
  }
  expect(document.adoptedStyleSheets).toEqual([unrelated]);
});
