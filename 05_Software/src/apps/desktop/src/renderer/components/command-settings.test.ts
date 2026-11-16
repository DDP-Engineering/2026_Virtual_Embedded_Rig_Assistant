// @vitest-environment jsdom
import userEvent from "@testing-library/user-event";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import i18n from "../i18n.js";
import { CommandSettings } from "./command-settings.js";

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
it.each(["en", "ro", "de", "fr"])(
  "saves, cancels and resets a localized shell selection in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const update = vi.fn();
    const user = userEvent.setup();
    try {
      await act(async () =>
        root.render(createElement(CommandSettings, { shell: "", saving: false, update })),
      );
      const input = container.querySelector("input");
      const [cancel, save] = [...container.querySelectorAll("button")];
      if (!input || !cancel || !save) throw Error("Missing shell controls");
      expect(container.querySelector("label")?.textContent).toBe(i18n.t("settings.commandShell"));
      expect(save?.disabled).toBe(true);
      await act(async () => user.type(input, "pwsh"));
      await act(async () => user.click(cancel));
      expect(input.value).toBe("");
      expect(update).not.toHaveBeenCalled();
      await act(async () => user.type(input, "/bin/bash"));
      await act(async () => user.click(save));
      expect(update).toHaveBeenLastCalledWith({ shell: "/bin/bash" });
      await act(async () =>
        root.render(createElement(CommandSettings, { shell: "/bin/bash", saving: false, update })),
      );
      await act(async () => user.clear(input));
      await act(async () => user.click(save));
      expect(update).toHaveBeenLastCalledWith({ shell: "" });
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  },
);
