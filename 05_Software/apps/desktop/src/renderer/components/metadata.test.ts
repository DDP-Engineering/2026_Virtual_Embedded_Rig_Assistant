// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { mockAppInfo } from "../mocks/fixtures.js";
import { Metadata } from "./metadata.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
it("localizes unsigned and instrumented identity in About in all supported languages", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    for (const [language, unsigned, instrumented] of [
      ["en", "Unsigned build", "Instrumented test build"],
      ["ro", "Versiune nesemnată", "Versiune de test instrumentată"],
      ["de", "Nicht signierter Build", "Instrumentierter Test-Build"],
    ]) {
      await act(async () => {
        await i18n.changeLanguage(language);
        root.render(
          createElement(Metadata, {
            info: { ...mockAppInfo, signing: "unsigned", testBuild: true },
          }),
        );
      });
      expect(container.textContent).toContain(unsigned);
      expect(container.textContent).toContain(instrumented);
    }
  } finally {
    await act(async () => root.unmount());
    await i18n.changeLanguage("en");
  }
});
