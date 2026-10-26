// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { mockAppInfo } from "../mocks/fixtures.js";
import { Metadata } from "./metadata.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
it("shows one application identity without build or signing labels in all supported languages", async () => {
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    for (const language of ["en", "ro", "de"]) {
      await act(async () => {
        await i18n.changeLanguage(language);
        root.render(
          createElement(Metadata, {
            info: { ...mockAppInfo, signing: "unsigned", testBuild: true },
          }),
        );
      });
      expect(container.querySelector('[data-info="name"]')?.textContent).toBe(mockAppInfo.name);
      expect(container.querySelector('[data-info="version"]')?.textContent).toBe(mockAppInfo.version);
      expect(container.querySelectorAll("dd")).toHaveLength(6);
      expect(container.querySelector('[data-info="build"]')).toBeNull();
      expect(container.querySelector('[data-info="signing"]')).toBeNull();
    }
  } finally {
    await act(async () => root.unmount());
    await i18n.changeLanguage("en");
  }
});
