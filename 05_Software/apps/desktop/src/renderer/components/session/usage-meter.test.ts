// @vitest-environment jsdom
// REQ-UX-d1b480e0. Execution deferred by direct user instruction.
import { emptySessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import i18n from "../../i18n.js";
import { UsageMeter } from "./usage-meter.js";

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
