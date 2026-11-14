// @vitest-environment jsdom
// REQ-UX-4bea0002 REQ-UX-0165dafe
// PERF-03 (#251): collapsed tool details are not built, and one live event re-renders only its row.

import userEvent from "@testing-library/user-event";
import { applySessionEvent, emptySessionState, type SessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import i18n from "../../i18n.js";
import { Transcript } from "./transcript.js";

/** Markdown renders per text, counted; the real pipeline is covered by markdown.test.ts. */
const renders = vi.hoisted(() => new Map<string, number>());
vi.mock("./markdown.js", () => ({
  Markdown: ({ text }: { text: string }) => {
    renders.set(text, (renders.get(text) ?? 0) + 1);
    return createElement("div", { className: "markdown" }, text);
  },
}));
vi.mock("../../api/index.js", () => ({ api: { invoke: vi.fn().mockResolvedValue({}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let root: Root;
let container: HTMLDivElement;
const retry = () => {};
const reasoning = {};
beforeEach(async () => {
  await i18n.changeLanguage("en");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  renders.clear();
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
async function render(state: SessionState, updates: Record<string, string> = {}, search = "") {
  await act(async () =>
    root.render(
      createElement(Transcript, {
        state,
        detail: "verbose",
        reasoning,
        updates,
        retry,
        search,
        sessionId: "session",
      }),
    ),
  );
}

it("builds collapsed tool details only when opened, keeping aria-controls resolvable", async () => {
  const state = emptySessionState();
  state.items.push({
    kind: "tool",
    id: "call",
    turnId: "turn",
    name: "read",
    args: { path: "board-notes.txt" },
    status: "ok",
    preview: "very large preview body",
  });
  await render(state);
  const toggle = container.querySelector<HTMLButtonElement>("[data-tool-row] button") as HTMLButtonElement;
  const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "");
  expect(panel?.hidden).toBe(true);
  expect(panel?.childElementCount).toBe(0);
  expect(container.textContent).not.toContain("very large preview body");
  toggle.focus();
  await act(async () => userEvent.setup().keyboard("{Enter}"));
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  expect(panel?.hidden).toBe(false);
  expect(panel?.textContent).toContain("very large preview body");
  expect(panel?.textContent).toContain('"path": "board-notes.txt"');
  await act(async () => userEvent.setup().keyboard(" "));
  expect(panel?.hidden).toBe(true);
  expect(container.textContent).not.toContain("very large preview body");
});

it("caps the collapsed tool title argument summary", async () => {
  const state = emptySessionState();
  state.items.push({
    kind: "tool",
    id: "call",
    turnId: "turn",
    name: "write",
    args: { text: "x".repeat(100_000) },
    status: "running",
  });
  await render(state);
  const toggle = container.querySelector("[data-tool-row] button");
  expect(toggle?.textContent?.length).toBeLessThan(200);
});

it("a live delta to a 200-item transcript re-renders only the touched message row", async () => {
  let state = emptySessionState();
  for (let i = 0; i < 100; i++)
    state.items.push(
      { kind: "user", id: `u${i}`, text: `question ${i}` },
      {
        kind: "assistant",
        id: `a${i}`,
        turnId: `t${i}`,
        text: `answer ${i}`,
        streaming: i === 99,
        citations: [],
      },
    );
  await render(state, {}, "answer");
  expect(renders.size).toBe(200);
  expect(container.querySelectorAll("[data-search-match=true]")).toHaveLength(100);
  renders.clear();
  state = applySessionEvent(state, { type: "message.delta", messageId: "a99", text: " more" });
  await render(state, {}, "answer");
  expect([...renders.entries()]).toEqual([["answer 99 more", 1]]);
  expect(container.querySelectorAll("[data-search-match=true]")).toHaveLength(100);
});
