// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { defaultSettings } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { PrivacySettings } from "./privacy-settings.js";
import { Settings } from "./settings.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("./providers.js", () => ({ Providers: () => null }));
vi.mock("./updates.js", () => ({ UpdatesPanel: () => null }));
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
it("offers the four masking switches and clean top Save/Cancel actions", async () => {
  await i18n.changeLanguage("en");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient();
  try {
    await act(async () =>
      root.render(
        createElement(
          QueryClientProvider,
          { client },
          createElement(Settings, {
            section: "data",
            snapshot: { settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19") },
            info: undefined,
            saving: false,
            error: undefined,
            update: vi.fn(),
          }),
        ),
      ),
    );
    expect(container.querySelectorAll('[data-mask-area] input[role="switch"]')).toHaveLength(4);
    expect(container.querySelector<HTMLButtonElement>("[data-privacy-save]")?.disabled).toBe(true);
    expect(container.querySelector("[data-privacy-save]")?.classList.contains("primary")).toBe(true);
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});

it.each(["en", "ro", "de", "fr"])(
  "confirms only agent disabling and saves partial app drafts in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container),
      update = vi.fn();
    const user = userEvent.setup();
    const render = (privacy: Parameters<typeof PrivacySettings>[0]["privacy"] = undefined, saving = false) =>
      act(async () => root.render(createElement(PrivacySettings, { privacy, saving, update })));
    const input = (area: string) =>
      container.querySelector<HTMLInputElement>(`[data-mask-area="${area}"] input`) as HTMLInputElement;
    const click = async (selector: string) =>
      act(async () => user.click(document.querySelector(selector) as HTMLElement));
    try {
      await render();
      expect(["display", "runs", "agent", "exports"].map((area) => input(area).checked)).toEqual([
        false,
        false,
        true,
        true,
      ]);
      for (const area of ["display", "runs", "exports"]) {
        await act(async () => user.click(input(area)));
        expect(document.querySelector("dialog")).toBeNull();
      }
      await click("[data-privacy-cancel]");
      await act(async () => user.click(input("agent")));
      expect(input("agent").checked).toBe(true);
      expect(document.querySelector("dialog")?.textContent).toContain(i18n.t("privacy.warning"));
      await click('[data-action="cancel-mask-off"]');
      expect(input("agent").checked).toBe(true);
      expect(document.activeElement).toBe(input("agent"));
      await act(async () => user.click(input("agent")));
      await act(async () => {
        document.querySelector("dialog")?.dispatchEvent(new Event("cancel", { cancelable: true }));
      });
      expect(input("agent").checked).toBe(true);
      expect(document.activeElement).toBe(input("agent"));
      await act(async () => user.click(input("agent")));
      await click('[data-action="confirm-mask-off"]');
      expect(input("agent").checked).toBe(false);
      expect(update).not.toHaveBeenCalled();
      await render({ mask: { display: true, runs: true } });
      expect(input("display").checked).toBe(true);
      expect(input("agent").checked).toBe(false);
      await click("[data-privacy-save]");
      expect(update).toHaveBeenLastCalledWith({ privacy: { mask: { agent: false } } });
      await render({ mask: { display: true, runs: true } }, true);
      expect(input("display").disabled).toBe(true);
      // A rejected update leaves the confirmed snapshot intact; the draft can be retried.
      await render({ mask: { display: true, runs: true } });
      expect(input("agent").checked).toBe(false);
      await click("[data-privacy-save]");
      expect(update).toHaveBeenCalledTimes(2);
      await render({ mask: { display: true, runs: true, agent: false } });
      expect(container.querySelector<HTMLButtonElement>("[data-privacy-save]")?.disabled).toBe(true);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
