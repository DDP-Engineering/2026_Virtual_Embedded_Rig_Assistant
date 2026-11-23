// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { CommandSettings } from "./command-settings.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
const installed = [
  { id: "pwsh", executable: "C:/PowerShell/pwsh.exe" },
  { id: "powershell", executable: null },
  { id: "cmd", executable: "C:/Windows/System32/cmd.exe" },
  { id: "bash", executable: "/bin/bash" },
];
it.each(["en", "ro", "de", "fr"])(
  "selects installed shells, cancels, saves Custom and restores Automatic in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    vi.mocked(api.invoke).mockResolvedValue(installed as never);
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const update = vi.fn();
    const user = userEvent.setup();
    const render = (shell: string) =>
      act(async () =>
        root.render(
          createElement(
            QueryClientProvider,
            { client },
            createElement(CommandSettings, { shell, saving: false, update }),
          ),
        ),
      );
    try {
      await render("");
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const options = [...container.querySelectorAll<HTMLInputElement>('#command-shell input[type="radio"]')];
      const choice = (id: string) => {
        const option = options.find((item) => item.value === id);
        if (!option) throw Error(`Missing shell choice ${id}`);
        return option;
      };
      const [cancel, save] = [...container.querySelectorAll("button")];
      if (!cancel || !save) throw Error("Missing buttons");
      expect(choice("").checked).toBe(true);
      expect(choice("pwsh").disabled).toBe(false);
      expect(options.map((option) => option.value)).toEqual([
        "",
        "pwsh",
        "powershell",
        "cmd",
        "bash",
        "custom",
      ]);
      expect(choice("powershell").disabled).toBe(true);
      expect(choice("powershell").closest("label")?.textContent).toContain(
        i18n.t("settings.shellNotInstalled"),
      );
      expect(choice("pwsh").closest("label")?.textContent).toContain(installed[0]?.executable);
      expect(save.disabled).toBe(true);
      await act(async () => user.click(choice("pwsh")));
      await act(async () => user.click(cancel));
      expect(choice("").checked).toBe(true);
      await act(async () => user.click(choice("cmd")));
      await act(async () => user.click(save));
      expect(update).toHaveBeenLastCalledWith({ shell: "C:/Windows/System32/cmd.exe" });
      await act(async () => user.click(choice("custom")));
      const input = container.querySelector("#command-shell-path") as HTMLInputElement;
      await act(async () => user.clear(input));
      expect(save.disabled).toBe(true);
      await act(async () => user.type(input, "/custom/bash"));
      await act(async () => user.click(save));
      expect(update).toHaveBeenLastCalledWith({ shell: "/custom/bash" });
      await render("/custom/bash");
      expect(choice("custom").checked).toBe(true);
      expect(input.value).toBe("/custom/bash");
      await act(async () => user.click(choice("")));
      await act(async () => user.click(save));
      expect(update).toHaveBeenLastCalledWith({ shell: "" });
      await render("bash");
      expect(choice("bash").checked).toBe(true);
      expect(save.disabled).toBe(true);
    } finally {
      await act(async () => root.unmount());
      client.clear();
      container.remove();
    }
  },
);
