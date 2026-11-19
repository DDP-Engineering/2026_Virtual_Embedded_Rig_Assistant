// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { DictationSnapshot } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { DictationSettings } from "./dictation-settings.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
it.each(["en", "ro", "de", "fr"])(
  "renders model roles, sizes and distinct states in %s",
  async (language) => {
    await i18n.changeLanguage(language);
    const container = document.createElement("div");
    const root = createRoot(container);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    vi.mocked(api.invoke).mockResolvedValue({
      language: "auto",
      selectedModel: "whisper-small",
      models: [
        { id: "whisper-base", bytes: 79677901, status: "missing" },
        { id: "whisper-small", bytes: 251875316, status: "installed" },
      ],
    } as never);
    try {
      await act(async () =>
        root.render(createElement(QueryClientProvider, { client }, createElement(DictationSettings))),
      );
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const text = container.textContent;
      for (const key of [
        "settings.dictation",
        "dictation.compact",
        "dictation.recommended",
        "dictation.missing",
        "dictation.selected",
        "dictation.installed",
        "dictation.automatic",
      ]) {
        const label = i18n.t(key, { model: i18n.t("dictation.small") });
        expect(label).not.toBe(key);
        expect(text).toContain(label);
      }
      for (const bytes of [79677901, 251875316]) {
        expect(text).toContain(
          new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(bytes / 1e6),
        );
      }
      const select = container.querySelector("select");
      expect(select?.value).toBe("auto");
      expect(select?.querySelector('option[value="ro"]')?.textContent).toBe(
        new Intl.DisplayNames(language, { type: "language" }).of("ro"),
      );
    } finally {
      await act(async () => root.unmount());
      client.clear();
    }
  },
);

it("sends retry, cancel, language, selection and removal actions from the tab", async () => {
  await i18n.changeLanguage("en");
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const user = userEvent.setup();
  const base = { id: "whisper-base", bytes: 79_677_901 } as const;
  const small = { id: "whisper-small", bytes: 251_875_316 } as const;
  const noSelection: DictationSnapshot = {
    language: "auto",
    selectedModel: null,
    models: [
      { ...base, status: "missing" },
      { ...small, status: "installed" },
    ],
  };
  const pending = {
    ...noSelection,
    models: [
      { ...base, status: "downloading", receivedBytes: Math.floor(base.bytes / 3) },
      noSelection.models[1],
    ],
  };
  const french = { ...noSelection, language: "fr" };
  const mock = vi.mocked(api.invoke);
  mock.mockClear().mockResolvedValueOnce({
    ...noSelection,
    models: [{ ...base, status: "failed", failure: "integrity", canRemove: false }, noSelection.models[1]],
  } as never);
  const settle = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  const click = async (label: string) => {
    const button = [...container.querySelectorAll("button")].find((node) => node.textContent === label);
    if (!button) throw new Error(`Missing button ${label}`);
    await act(async () => user.click(button));
    await settle();
  };
  try {
    await act(async () =>
      root.render(createElement(QueryClientProvider, { client }, createElement(DictationSettings))),
    );
    await settle();
    expect(container.textContent).toContain(i18n.t("dictation.integrity"));
    mock.mockResolvedValueOnce(pending as never);
    await click(i18n.t("dictation.retry"));
    expect(mock).toHaveBeenLastCalledWith("dictation.change", { action: "download", id: base.id });
    expect(container.querySelector("progress")?.max).toBe(base.bytes);
    mock.mockResolvedValueOnce(noSelection as never);
    await click(i18n.t("dictation.cancel"));
    expect(mock).toHaveBeenLastCalledWith("dictation.change", { action: "cancel", id: base.id });
    expect(container.querySelector("progress")).toBeNull();
    const select = container.querySelector("select");
    if (!select) throw new Error("Missing spoken language");
    mock.mockResolvedValueOnce(french as never);
    await act(async () => user.selectOptions(select, "fr"));
    await settle();
    expect(mock).toHaveBeenLastCalledWith("dictation.change", { action: "language", language: "fr" });
    mock.mockResolvedValueOnce({ ...french, selectedModel: small.id } as never);
    await click(i18n.t("dictation.select"));
    expect(mock).toHaveBeenLastCalledWith("dictation.change", { action: "select", id: small.id });
    mock.mockResolvedValueOnce({
      ...french,
      models: [french.models[0], { ...small, status: "removal-failed" }],
    } as never);
    await click(i18n.t("dictation.remove"));
    expect(mock).toHaveBeenLastCalledWith("dictation.change", { action: "remove", id: small.id });
    expect(container.textContent).toContain(i18n.t("dictation.noSelection"));
    expect(container.textContent).toContain(i18n.t("dictation.removalFailed"));
    mock.mockResolvedValueOnce({
      ...french,
      models: [french.models[0], { ...small, status: "missing" }],
    } as never);
    await click(i18n.t("dictation.retry"));
    expect(mock).toHaveBeenLastCalledWith("dictation.change", { action: "remove", id: small.id });
    expect(container.textContent).not.toContain(i18n.t("dictation.removalFailed"));
  } finally {
    await act(async () => root.unmount());
    client.clear();
    container.remove();
  }
});
