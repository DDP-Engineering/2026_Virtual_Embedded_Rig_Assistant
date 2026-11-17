// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { defaultSettings, type SettingsSnapshot } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import { usePreferences } from "./use-preferences.js";

vi.mock("../api/index.js", () => ({
  api: { getSettings: vi.fn(), updateSettings: vi.fn(), subscribe: vi.fn(() => () => {}) },
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
vi.stubGlobal("matchMedia", () => ({
  matches: false,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
}));

it("publishes a confirmed settings save and rejects an older inflight fetch for immediate consumers", async () => {
  const old = { settings: defaultSettings("1b9dc50c-d87d-484b-88e6-04cb5f7c5a19") };
  const saved = { settings: { ...old.settings, privacy: { mask: { display: true, agent: false } } } };
  let finish!: (result: SettingsSnapshot) => void;
  vi.mocked(api.getSettings).mockReturnValue(
    new Promise((resolve) => {
      finish = resolve;
    }),
  );
  vi.mocked(api.updateSettings).mockResolvedValue(saved);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(["app.settings"], old);
  function Consumer() {
    const { snapshot, mutation } = usePreferences("en");
    return createElement(
      "button",
      {
        type: "button",
        onClick: () => mutation.mutate({ privacy: { mask: { display: true, agent: false } } }),
      },
      String(snapshot.data?.settings.privacy?.mask?.display),
    );
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  try {
    await act(async () =>
      root.render(createElement(QueryClientProvider, { client }, createElement(Consumer))),
    );
    await act(async () => userEvent.setup().click(container.querySelector("button") as HTMLElement));
    await vi.waitFor(() => expect(client.getQueryData(["app.settings"])).toEqual(saved));
    await act(async () => {
      finish(old);
    });
    expect(client.getQueryData(["app.settings"])).toEqual(saved);
    await vi.waitFor(() => expect(container.textContent).toBe("true"));
    expect(api.subscribe).toHaveBeenCalledWith("app", expect.any(Function));
  } finally {
    await act(async () => root.unmount());
    container.remove();
    client.clear();
    vi.clearAllMocks();
  }
});
