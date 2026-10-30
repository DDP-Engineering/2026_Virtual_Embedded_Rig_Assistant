// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { WebAccessPanel } from "./web-access.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
HTMLDialogElement.prototype.showModal = function () {
  this.setAttribute("open", "");
};
HTMLDialogElement.prototype.close = function () {
  this.removeAttribute("open");
};
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.resetAllMocks();
});
async function mount(language = "en") {
  await i18n.changeLanguage(language);
  let snapshot = {
    preferences: { enabled: true, provider: "exa", authentication: "anonymous" },
    keyConfigured: false,
    storage: null as string | null,
    secureStorage: true,
    readOnly: false,
  };
  vi.mocked(api.invoke).mockImplementation(async (name, raw) => {
    if (name === "web.access.get") return structuredClone(snapshot) as never;
    if (name === "web.access.save") {
      const input = raw as { enabled: boolean; authentication: string; apiKey?: string };
      snapshot = {
        ...snapshot,
        preferences: {
          ...snapshot.preferences,
          enabled: input.enabled,
          authentication: input.authentication,
        },
        keyConfigured: !!input.apiKey || snapshot.keyConfigured,
      };
      return { status: "saved" } as never;
    }
    if (name === "web.access.test")
      return {
        ...(raw as object),
        status: "pass",
        checkedAt: "2026-10-30T12:00:00Z",
        durationMs: 10,
        apiKey: undefined,
      } as never;
    return {} as never;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () =>
    root!.render(
      createElement(
        QueryClientProvider,
        { client: new QueryClient({ defaultOptions: { queries: { retry: false } } }) },
        createElement(WebAccessPanel),
      ),
    ),
  );
  await act(async () => {
    await new Promise((done) => setTimeout(done, 20));
  });
  return userEvent.setup();
}
it.each(["en", "ro", "de"])(
  "presents translated optional-key settings and tests in a single dismissible modal: %s",
  async (language) => {
    const user = await mount(language);
    expect(container!.querySelector<HTMLInputElement>("#web-enabled")?.checked).toBe(true);
    expect(container!.textContent).not.toContain("webAccess.");
    await act(async () => user.click(container!.querySelector("[data-web-test]")!));
    const dialog = document.querySelector("dialog[open]")!;
    expect(dialog).toBeTruthy();
    expect(dialog.textContent).not.toContain("webAccess.");
    expect(dialog.querySelectorAll("button")).toHaveLength(1);
    await act(async () => user.click(dialog.querySelector("[data-web-close]")!));
    expect(document.querySelector("dialog[open]")).toBeNull();
  },
);
it("saves explicit API-key mode and clears the password draft without echoing a stored key", async () => {
  const user = await mount();
  await act(async () => user.selectOptions(container!.querySelector("#web-authentication")!, "api-key"));
  const key = "private-draft-exa-key-012345";
  await act(async () => user.type(container!.querySelector("#web-api-key")!, key));
  await act(async () => user.click(container!.querySelector("[data-web-save]")!));
  expect(api.invoke).toHaveBeenCalledWith(
    "web.access.save",
    expect.objectContaining({ authentication: "api-key", apiKey: key }),
  );
  expect(container!.querySelector<HTMLInputElement>("#web-api-key")?.value).toBe("");
  expect(container!.textContent).not.toContain(key);
});
