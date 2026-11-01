// @vitest-environment jsdom
// REQ-UX-33b9d601 REQ-UX-bb147586
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { defaultSettings, type PermissionMode } from "@vera/shared";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { PermissionPicker } from "./permission-picker.js";

vi.mock("../api/index.js", () => ({ api: { getSettings: vi.fn(), updateSettings: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  client?.clear();
  vi.clearAllMocks();
});
function Harness() {
  const [mode, change] = useState<PermissionMode>("ask");
  return createElement(PermissionPicker, { mode, disabled: false, change });
}
async function mount() {
  await i18n.changeLanguage("en");
  const snapshot = { settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19") };
  vi.mocked(api.getSettings).mockResolvedValue(snapshot);
  client = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(createElement(QueryClientProvider, { client }, createElement(Harness))));
  const picker = container.querySelector("select") as HTMLSelectElement;
  const user = userEvent.setup();
  await act(async () => {
    await user.selectOptions(picker, "bypass");
  });
  expect(document.querySelector(".bypass-warning")).toBeTruthy();
  return { picker, user, snapshot };
}
it("keeps the warning and a visible error when suppression cannot be saved, then retries successfully", async () => {
  const { picker, user, snapshot } = await mount();
  vi.mocked(api.updateSettings).mockRejectedValueOnce({ code: "DENIED", messageKey: "errors.DENIED" });
  await act(async () => {
    await user.click(document.querySelector("[data-hide-bypass-warning]") as HTMLElement);
  });
  await act(async () => {
    await user.click(document.querySelector('[data-action="close-bypass-warning"]') as HTMLElement);
  });
  expect(document.querySelector(".bypass-warning [role=alert]")).toBeTruthy();
  expect(document.querySelector(".bypass-warning")).toBeTruthy();
  vi.mocked(api.updateSettings).mockResolvedValueOnce({
    ...snapshot,
    settings: { ...snapshot.settings, suppressBypassWarning: true },
  });
  await act(async () => {
    await user.click(document.querySelector('[data-action="close-bypass-warning"]') as HTMLElement);
  });
  expect(document.querySelector(".bypass-warning")).toBeNull();
  expect(api.updateSettings).toHaveBeenCalledWith({ suppressBypassWarning: true });
  await act(async () => {
    await user.selectOptions(picker, "ask");
    await user.selectOptions(picker, "bypass");
  });
  expect(document.querySelector(".bypass-warning")).toBeNull();
});
