// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { ErrorBoundary } from "./error-boundary.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

it("replaces a failed render with a message and a Reload button", async () => {
  await i18n.changeLanguage("en");
  // React logs the error it hands to the boundary.
  vi.spyOn(console, "error").mockImplementation(() => {});
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  const Broken = () => {
    throw new Error("render failed");
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(ErrorBoundary, null, createElement(Broken))));
    expect(container.querySelector('[role="alert"] p')?.textContent).toBe(
      "VERA could not display this window.",
    );
    const button = container.querySelector<HTMLButtonElement>("button.primary");
    expect(button?.textContent).toBe("Reload");
    await act(async () => button?.click());
    expect(reload).toHaveBeenCalledTimes(1);
  } finally {
    await act(async () => root.unmount());
    container.remove();
  }
});
