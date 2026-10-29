// @vitest-environment jsdom
// REQ-UX-d1b480e0. Execution deferred by direct user instruction.
import { emptySessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import i18n from "../../i18n.js";
import { ContextIndicator, contextOccupancy, UsageMeter } from "./usage-meter.js";

it.each(["en", "ro", "de"])("presents translated status and request view tokens in %s", async (language) => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const element = document.createElement("div");
  const root = createRoot(element);
  const state = emptySessionState();
  state.usage = {
    inputTokens: 17,
    outputTokens: 3,
    contextTokens: 1200,
    requestViewTokens: 1200,
    compactionStatus: "completed",
    estimated: true,
  };
  try {
    await i18n.changeLanguage(language);
    await act(async () => root.render(createElement(UsageMeter, { state })));
    expect(element.querySelector('[role="status"]')?.textContent).toBe(i18n.t("chat.compaction.completed"));
    expect(element.textContent).toContain(`${i18n.t("chat.requestView")}: 1200`);
    expect(element.textContent).toContain(`${i18n.t("chat.estimated")}: 1200`);
    expect(element.textContent).toContain("17 / 3");
  } finally {
    await act(async () => root.unmount());
    await i18n.changeLanguage("en");
  }
});

it("reports request-view occupancy honestly, including unknown and over-budget windows", async () => {
  const state = emptySessionState();
  expect(contextOccupancy(state)).toBeUndefined();
  state.usage.contextTokens = 200;
  expect(contextOccupancy(state)).toBeUndefined();
  state.usage.contextWindow = 1000;
  expect(contextOccupancy(state)).toBe(20);
  state.usage.requestViewTokens = 1250;
  expect(contextOccupancy(state)).toBe(125);
  state.usage.contextWindow = 0;
  expect(contextOccupancy(state)).toBeUndefined();
  const element = document.createElement("div");
  const root = createRoot(element);
  try {
    await act(async () => root.render(createElement(ContextIndicator, { state, open: () => {} })));
    expect(element.textContent).toBe("—");
    expect(element.querySelector("button")?.title).toContain(i18n.t("chat.contextUnknown"));
    state.usage.contextWindow = 1000;
    state.usage.estimated = true;
    await act(async () => root.render(createElement(ContextIndicator, { state, open: () => {} })));
    expect(element.textContent).toBe("125%");
    expect(element.querySelector("button")?.title).toContain(i18n.t("chat.estimated"));
  } finally {
    await act(async () => root.unmount());
  }
});
