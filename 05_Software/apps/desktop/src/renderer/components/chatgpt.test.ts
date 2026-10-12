// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { emptySessionState } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { Chatgpt } from "./chatgpt.js";
import { Composer } from "./session/composer.js";

vi.mock("../api/index.js", async () => {
  const { createMockApi } = await import("../mocks/mockApi.js");
  return { api: createMockApi().api };
});
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined, container: HTMLDivElement;
let client: QueryClient;
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = undefined;
  container?.remove();
  client?.clear();
  vi.restoreAllMocks();
  await api.invoke("providers.chatgpt.logout", {});
  await i18n.changeLanguage("en");
});
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40));
  });
}
async function mount(composer = false) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root?.render(
      createElement(
        QueryClientProvider,
        { client },
        createElement(
          "div",
          {},
          createElement(Chatgpt, { disabled: false }),
          composer
            ? createElement(Composer, {
                state: { ...emptySessionState(), modelRef: "chatgpt/mock-subscription" },
                disabled: false,
                send: async () => true,
                stop: () => {},
                setModel: async () => {},
                setMode: async () => {},
              })
            : null,
        ),
      ),
    ),
  );
  await settle();
}
function button(text: string) {
  const b = [...container.querySelectorAll("button")].find((b) => b.textContent === text);
  expect(b, text).toBeTruthy();
  if (!b) throw Error("Missing button");
  return b;
}
it("completes manual sign-in, clears secret draft/caches, offers subscription model, and signs out", async () => {
  await mount(true);
  const user = userEvent.setup();
  await act(async () => user.click(button("Sign in with ChatGPT")));
  await settle();
  const input = container.querySelector<HTMLInputElement>("input[type=password]");
  if (!input) throw Error("Missing input");
  expect(input).toBeTruthy();
  await act(async () => user.type(input, "http://127.0.0.1:1455/auth/callback?code=fake-sensitive-redirect"));
  await act(async () => user.click(button("Complete sign-in")));
  await settle();
  expect(container.textContent).toContain("Signed in with ChatGPT");
  expect(container.textContent).toContain("Token expires at");
  expect(container.querySelector("input")).toBeNull();
  await act(async () => client.invalidateQueries({ queryKey: ["chatgpt.status"] }));
  await settle();
  expect(container.querySelectorAll('option[value="chatgpt/mock-subscription"]')).toHaveLength(1);
  expect(
    JSON.stringify(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state),
    ),
  ).not.toContain("fake-sensitive-redirect");
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  await act(async () => user.click(button("Sign out")));
  await settle();
  expect(container.textContent).toContain("Not signed in");
  // A selected session reference remains visible as a fallback after sign-out.
  expect(container.querySelectorAll('option[value="chatgpt/mock-subscription"]')).toHaveLength(1);
});
it("cancel clears pending manual input and disabled settings prevent start", async () => {
  await mount();
  const user = userEvent.setup();
  await act(async () => user.click(button("Sign in with ChatGPT")));
  await settle();
  await act(async () => user.click(button("Cancel")));
  await settle();
  expect((await api.invoke("providers.chatgpt.status", {})).state).toBe("idle");
  expect(container.querySelector("input")).toBeNull();
  await act(async () =>
    root?.render(createElement(QueryClientProvider, { client }, createElement(Chatgpt, { disabled: true }))),
  );
  expect(button("Sign in with ChatGPT").disabled).toBe(true);
});
it.each(["ro", "de"])("uses localized controls in %s", async (lang) => {
  await i18n.changeLanguage(lang);
  await mount();
  expect(container.textContent).toContain(i18n.t("chatgpt.title"));
  expect(button(i18n.t("chatgpt.signIn"))).toBeTruthy();
});
