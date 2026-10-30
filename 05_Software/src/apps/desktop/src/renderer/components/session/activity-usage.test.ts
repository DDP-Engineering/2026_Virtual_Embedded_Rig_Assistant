// @vitest-environment jsdom
// REQ-UX-bc9adf3a
import { emptySessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import i18n from "../../i18n.js";
import { ActivityLog } from "./session-inspector.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});
it.each([
  ["en", "Input", "Output", "Initial context", "Shared"],
  ["ro", "Intrare", "Ieșire", "Context inițial", "Comun"],
  ["de", "Eingabe", "Ausgabe", "Anfangskontext", "Gemeinsam"],
])(
  "renders independent compact, estimated/unavailable and shared prompt statistics in %s",
  async (language, input, output, context, shared) => {
    await i18n.changeLanguage(language);
    const state = emptySessionState();
    state.items = [
      {
        kind: "user",
        id: "one",
        text: "One",
        usage: {
          inputTokens: 2450,
          outputTokens: 380,
          contextTokens: 120,
          contextWindow: 1000,
          estimated: true,
        },
      },
      { kind: "assistant", id: "a", turnId: "t", text: "Answer", streaming: false, citations: [] },
      {
        kind: "user",
        id: "two",
        text: "Two",
        usage: { contextTokens: 450, contextWindow: 1000, estimated: true, shared: true },
      },
      { kind: "user", id: "three", text: "Pending", pending: true },
    ];
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(createElement(ActivityLog, { state, reasoning: {}, updates: {} })));
    const lines = [...container.querySelectorAll<HTMLElement>("[data-prompt-usage]")];
    expect(lines).toHaveLength(3);
    for (const label of [input, output, context]) expect(lines[0]?.textContent).toContain(label);
    expect(lines[0]?.textContent).toContain(new Intl.NumberFormat(language).format(2450));
    expect(lines[0]?.textContent).toContain("≈");
    expect(lines[0]?.textContent).toContain(
      new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 0 }).format(0.12),
    );
    expect(lines[1]?.textContent).toContain(shared);
    expect(lines[1]?.textContent).toContain("—");
    expect(lines[1]?.textContent).not.toContain("380");
    expect(lines[2]?.textContent?.match(/—/g)).toHaveLength(3);
    expect(container.querySelectorAll('[data-activity-kind="assistant"] [data-prompt-usage]')).toHaveLength(
      0,
    );
  },
);
