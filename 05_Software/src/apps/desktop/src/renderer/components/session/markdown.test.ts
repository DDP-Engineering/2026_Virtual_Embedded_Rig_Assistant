// @vitest-environment jsdom
// REQ-UX-34535128
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../../api/index.js";
import { Markdown } from "./markdown.js";
import "../../i18n.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn().mockResolvedValue({}) } }));
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
it("opens source URLs only after confirmation and keeps non-web URLs inert", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(
        createElement(Markdown, {
          text: "[Source](https://example.com/doc) [File](file:///secret) [JS](javascript:alert)",
        }),
      ),
    );
    const link = container.querySelector<HTMLButtonElement>('[data-web-source="https://example.com/doc"]');
    expect(link).toBeTruthy();
    expect(container.querySelectorAll("a")).toHaveLength(0);
    link!.focus();
    await act(async () => link!.click());
    expect(document.querySelector("dialog[open]")?.textContent).toContain("https://example.com/doc");
    expect(api.invoke).not.toHaveBeenCalled();
    await act(async () => document.querySelector<HTMLButtonElement>("[data-web-cancel]")!.click());
    expect(api.invoke).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(link);
    await act(async () => link!.click());
    await act(async () => document.querySelector<HTMLButtonElement>("[data-web-open]")!.click());
    expect(api.invoke).toHaveBeenCalledExactlyOnceWith("app.openExternal", {
      url: "https://example.com/doc",
      confirmed: true,
    });
    expect(document.querySelector("dialog[open]")).toBeNull();
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
it("shows kind icons/compact labels/full refs and keeps invalid or malformed chips inert", async () => {
  const cases = [
    ["docs/a.pdf#p=2", "page", "a.pdf p2"],
    ["docs/a.pdf#p=1-2", "page-range", "a.pdf p1–2"],
    ["docs/a.md#h=power", "heading", "a.md #power"],
    ["docs/a.html#h=reset", "heading", "a.html #reset"],
    ["logs/a.log#L1-L2", "lines", "a.log L1–2"],
    ["artifact:summary.md", "artifact", "summary.md"],
  ];
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const onCitation = vi.fn();
  try {
    await act(async () =>
      root.render(
        createElement(Markdown, {
          text: [
            ...cases.map(([ref]) => `[[${ref}]]`),
            "[[docs/a.pdf#p=3]]",
            "[[malformed]]",
            "`[[docs/a.pdf#p=2]]`",
          ].join(" "),
          onCitation,
          citations: [
            ...cases.map(([ref]) => ({ ref: ref!, valid: true })),
            { ref: "malformed", valid: true },
          ],
        }),
      ),
    );
    const chips = [...container.querySelectorAll<HTMLButtonElement>("[data-citation]")];
    expect(chips).toHaveLength(8);
    for (let i = 0; i < cases.length; i++) {
      const [ref, kind, label] = cases[i]!;
      expect(chips[i]?.dataset.citationKind).toBe(kind);
      expect(chips[i]?.dataset.citation).toBe("valid");
      expect(chips[i]?.textContent?.trim()).toBe(label);
      expect(chips[i]?.title).toBe(ref);
      expect(chips[i]?.getAttribute("aria-label")).toBe(ref);
      expect(chips[i]?.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
    }
    for (const chip of chips.slice(6)) {
      expect(chip.dataset.citation).toBe("invalid");
      expect(chip.getAttribute("aria-disabled")).toBe("true");
      expect(chip.classList.contains("invalid")).toBe(true);
      expect(chip.title).toContain("could not be verified");
      await act(async () => chip.click());
      expect(container.querySelector('[role="status"]')).toBeNull();
    }
    await act(async () => chips[0]?.click());
    expect(onCitation).toHaveBeenCalledExactlyOnceWith(cases[0]![0]);
    expect(container.querySelector("code")?.textContent).toBe("[[docs/a.pdf#p=2]]");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
