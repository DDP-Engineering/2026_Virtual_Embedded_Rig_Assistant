// @vitest-environment jsdom
// REQ-UX-34535128
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { Markdown } from "./markdown.js";
import "../../i18n.js";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
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
    expect(container.querySelector('[role="status"]')?.textContent).toContain(cases[0]![0]);
    expect(container.querySelector("code")?.textContent).toBe("[[docs/a.pdf#p=2]]");
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
