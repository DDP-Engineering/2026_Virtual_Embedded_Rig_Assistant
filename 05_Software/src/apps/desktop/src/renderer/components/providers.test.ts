// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { Providers } from "./providers.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn(() => () => {}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};

const id = "custom:bench-server";
const connection = {
  name: "Bench server",
  baseUrl: "http://localhost:11434/v1",
  model: "alpha",
  contextWindow: 32768,
  maxOutputTokens: 4096,
  slug: "bench-server",
  id,
  configured: true,
  hint: null,
  storage: null,
  enabledModels: ["alpha"],
};
const model = (name: string) => ({ id: name, name, reference: `${id}/${name}` });
let root: Root | undefined;
let container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
});

// REQ-UX-fe31a037
it("lists a connected provider's models as ticks saved with the page header and adds providers in a dialog", async () => {
  await i18n.changeLanguage("en");
  vi.mocked(api.invoke).mockImplementation((async (channel: string) => {
    if (channel === "providers.list")
      return {
        openai: { id: "openai", configured: false, hint: null, storage: null },
        chatgpt: { id: "chatgpt" },
        custom: [connection],
        secureStorage: true,
      };
    if (channel === "providers.chatgpt.status") return { connected: false, state: "idle" };
    if (channel === "providers.models") return { models: ["alpha", "beta", "gamma"].map(model) };
    return {};
  }) as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root?.render(createElement(QueryClientProvider, { client }, createElement(Providers))),
  );
  const settle = () => act(async () => new Promise((done) => setTimeout(done, 30)));
  await settle();
  const user = userEvent.setup();
  const card = container.querySelector(`[data-provider="${id}"]`);
  expect(card?.querySelector("h3")?.textContent).toBe("Bench server");
  const tick = (name: string) =>
    card?.querySelector<HTMLInputElement>(`[data-provider-model="${name}"]`) as HTMLInputElement;
  expect([tick("alpha").checked, tick("beta").checked, tick("gamma").checked]).toEqual([true, false, false]);
  const save = () => container?.querySelector<HTMLButtonElement>("[data-settings-save]") as HTMLButtonElement;
  expect(save().disabled).toBe(true);
  await act(async () => user.click(tick("beta")));
  expect(save().disabled).toBe(false);
  await act(async () => user.click(container?.querySelector("[data-settings-cancel]") as HTMLElement));
  expect([tick("beta").checked, save().disabled]).toEqual([false, true]);
  await act(async () => user.click(tick("beta")));
  await act(async () => user.click(save()));
  await settle();
  expect(api.invoke).toHaveBeenCalledWith("providers.models.enable", {
    providers: [{ id, models: ["alpha", "beta"] }],
  });
  await act(async () => user.click(container?.querySelector('[data-action="add-provider"]') as HTMLElement));
  const dialog = container.querySelector("[data-provider-dialog]");
  expect(dialog?.hasAttribute("open")).toBe(true);
  expect(dialog?.querySelector("[data-provider-preset]")).not.toBeNull();
  expect(dialog?.querySelector('input[type="search"]')).toBeNull();
});

// REQ-UX-fe31a037
it("filters and pages a card with more than ten models", async () => {
  await i18n.changeLanguage("en");
  const many = Array.from({ length: 12 }, (_, index) => `model-${String(index).padStart(2, "0")}`);
  vi.mocked(api.invoke).mockImplementation((async (channel: string) => {
    if (channel === "providers.list")
      return {
        openai: { id: "openai", configured: false, hint: null, storage: null },
        chatgpt: { id: "chatgpt" },
        custom: [{ ...connection, enabledModels: undefined }],
        secureStorage: true,
      };
    if (channel === "providers.chatgpt.status") return { connected: false, state: "idle" };
    if (channel === "providers.models") return { models: many.map(model) };
    return {};
  }) as never);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root?.render(createElement(QueryClientProvider, { client }, createElement(Providers))),
  );
  await act(async () => new Promise((done) => setTimeout(done, 30)));
  const card = container.querySelector(`[data-provider="${id}"]`) as HTMLElement;
  // A provider without a list offers its whole catalog, shown ticked, ten rows per page.
  expect(card.querySelectorAll("[data-provider-model]")).toHaveLength(10);
  expect(
    [...card.querySelectorAll<HTMLInputElement>("[data-provider-model]")].every((box) => box.checked),
  ).toBe(true);
  expect(card.querySelector("[data-pager]")).not.toBeNull();
  const user = userEvent.setup();
  await act(async () =>
    user.type(card.querySelector('input[type="search"]') as HTMLInputElement, "model-11"),
  );
  expect(
    [...card.querySelectorAll("[data-provider-model]")].map((box) => box.getAttribute("data-provider-model")),
  ).toEqual(["model-11"]);
});
