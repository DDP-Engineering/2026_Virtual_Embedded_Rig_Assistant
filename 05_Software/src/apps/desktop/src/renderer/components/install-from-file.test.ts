// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { BrowserRuntimeView, DictationSnapshot } from "@vera/shared";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { BrowserSettings } from "./browser-settings.js";
import { DictationSettings } from "./dictation-settings.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});
const settle = () => act(async () => new Promise((done) => setTimeout(done, 20)));
const mount = async (element: ReactElement) => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => root?.render(createElement(QueryClientProvider, { client }, element)));
  await settle();
  return container;
};
const labels = (scope: ParentNode) => [...scope.querySelectorAll("button")].map((node) => node.textContent);

// REQ-UX-f17b5648
it.each<[BrowserRuntimeView, string[]]>([
  [{ phase: "missing" }, ["browser.install", "browser.installFile"]],
  [{ phase: "failed", failure: "integrity" }, ["browser.install", "browser.installFile", "browser.remove"]],
  [{ phase: "verifying" }, ["browser.cancelInstall"]],
  [{ phase: "ready", version: "156.0.8078.4" }, ["browser.remove"]],
])(
  "offers Install from file beside Install only while the runtime is not installed (%o)",
  async (runtime, keys) => {
    await i18n.changeLanguage("en");
    vi.mocked(api.invoke)
      .mockReset()
      .mockResolvedValue({ phase: "verifying" } as never);
    const settings = { runtime, appEnabled: false, workbench: null };
    const page = await mount(
      createElement(BrowserSettings, {
        settings,
        error: null,
        refetch: () => {},
        appEnabled: false,
        workbenchEnabled: false,
        setApp: () => {},
        setWorkbench: () => {},
        disabled: false,
      }),
    );
    expect(labels(page)).toEqual(keys.map((key) => i18n.t(key)));
    const button = page.querySelector<HTMLButtonElement>('[data-action="browser-install-file"]');
    if (!button) return;
    await act(async () => userEvent.setup().click(button));
    await settle();
    expect(api.invoke).toHaveBeenCalledExactlyOnceWith("browser.runtime.installFile", {});
  },
);

// REQ-UX-3c6ae462
it("offers Install from file beside Download and labels an installation from a file", async () => {
  await i18n.changeLanguage("en");
  const base = { id: "whisper-base", bytes: 79_677_901 } as const;
  const small = { id: "whisper-small", bytes: 251_875_316 } as const;
  const snapshot: DictationSnapshot = {
    language: "auto",
    selectedModel: null,
    models: [
      { ...base, status: "missing" },
      { ...small, status: "installed" },
    ],
  };
  const fromFile: DictationSnapshot = {
    ...snapshot,
    models: [{ ...base, status: "downloading", receivedBytes: 0, fromFile: true }, snapshot.models[1]!],
  };
  const mock = vi.mocked(api.invoke).mockReset();
  mock.mockResolvedValueOnce(snapshot as never).mockResolvedValue(fromFile as never);
  const page = await mount(createElement(DictationSettings, { saving: false, update: () => {} }));
  const [missing, installed] = [...page.querySelectorAll("tr.dictation-model")];
  expect(labels(missing!)).toEqual([i18n.t("dictation.download"), i18n.t("dictation.installFile")]);
  expect(labels(installed!)).toEqual([i18n.t("dictation.select"), i18n.t("dictation.remove")]);
  const button = missing!.querySelector<HTMLButtonElement>('[data-action="dictation-install-file"]');
  await act(async () => userEvent.setup().click(button as HTMLButtonElement));
  await settle();
  expect(mock).toHaveBeenCalledWith("dictation.installFile", { id: base.id });
  const row = page.querySelector("tr.dictation-model");
  expect(row?.textContent).toContain(i18n.t("dictation.installingFile"));
  expect(row?.querySelector("progress")?.hasAttribute("value")).toBe(false);
  expect(labels(row!)).toEqual([i18n.t("dictation.cancel")]);
});
