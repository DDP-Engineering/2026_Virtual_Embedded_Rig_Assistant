// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { defaultSettings } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { UpdateBanner, UpdatesPanel } from "./updates.js";

vi.mock("../api/index.js", async () => {
  const { createMockApi } = await import("../mocks/mockApi.js");
  return { api: createMockApi().api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined, container: HTMLDivElement, client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
  await i18n.changeLanguage("en");
});
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
}
it("shows persisted Off controls, checks manually, renders text notes and ready banner", async () => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const update = vi.fn(),
    invoke = vi.spyOn(api, "invoke");
  const settings = defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19");
  settings.updates.mode = "off";
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          "div",
          {},
          createElement(UpdatesPanel, { preferences: settings.updates, disabled: false, update }),
          createElement(UpdateBanner),
        ),
      ),
    ),
  );
  await settle();
  expect(container.querySelector<HTMLSelectElement>("#update-mode")?.value).toBe("off");
  const user = userEvent.setup();
  const button = (key: string) => {
    const b = container.querySelector<HTMLButtonElement>(`[data-i18n="${key}"]`);
    if (!b) throw Error(key);
    return b;
  };
  const channel = container.querySelector<HTMLSelectElement>("#update-channel");
  if (!channel) throw Error("Missing channel control");
  await act(async () => user.selectOptions(channel, "beta"));
  expect(update).toHaveBeenCalledWith({ updates: { channel: "beta" } });
  await act(async () => user.click(button("updates.check")));
  await settle();
  expect(container.textContent).toContain("Update release notes");
  expect(container.textContent).toContain("0.0.1");
  await act(async () => user.click(button("updates.download")));
  await settle();
  expect(invoke).toHaveBeenCalledWith("update.download", { confirmed: true });
  expect(container.querySelector("[data-update-banner]")).not.toBeNull();
});
