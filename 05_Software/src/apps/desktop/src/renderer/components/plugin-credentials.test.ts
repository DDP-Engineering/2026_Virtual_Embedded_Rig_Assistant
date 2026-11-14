// @vitest-environment jsdom
// REQ-UX-4b90fed2, REQ-UX-c553435b
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { PluginCredentialList } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { PluginCredentialsPanel } from "./plugin-credentials.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.resetAllMocks();
});
const PASSWORD = "typed-broker-password";

async function mount(language: string, scope: "mqtt" | "wokwi" = "mqtt") {
  await i18n.changeLanguage(language);
  let list: PluginCredentialList = {
    credentials: [{ ref: "lab", storage: "encrypted" }],
    secureStorage: true,
  };
  vi.mocked(api.invoke).mockImplementation(async (name, raw) => {
    const input = raw as { ref: string };
    if (name === `${scope}.credentials.list`) return structuredClone(list) as never;
    if (name === `${scope}.credentials.save`) {
      list = { ...list, credentials: [...list.credentials, { ref: input.ref, storage: "encrypted" }] };
      return { status: "saved" } as never;
    }
    if (name === `${scope}.credentials.remove`) {
      list = { ...list, credentials: list.credentials.filter((entry) => entry.ref !== input.ref) };
      return {} as never;
    }
    return {} as never;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root!.render(
      createElement(QueryClientProvider, { client }, createElement(PluginCredentialsPanel, { scope })),
    ),
  );
  await vi.waitFor(() => expect(container!.querySelector('[data-credential="lab"]')).not.toBeNull());
  return userEvent.setup();
}
const button = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("button")].find((element) => element.textContent === label)!;
const field = (label: string) =>
  [...container!.querySelectorAll("label")]
    .find((element) => element.textContent?.startsWith(label))!
    .querySelector("input")!;

it.each(["en", "ro", "de"])("lists, saves and removes MQTT credentials: %s", async (language) => {
  const user = await mount(language);
  const t = i18n.getFixedT(language);
  expect(container!.textContent).toContain(t("settings.mqttCredentials"));
  expect(container!.textContent).toContain(
    t("mqttCredentials.stored", { storage: t("webAccess.storage.encrypted") }),
  );
  expect(container!.textContent).not.toMatch(/mqttCredentials\./);
  await act(async () => user.type(field(t("mqttCredentials.reference")), "bench-1"));
  await act(async () => user.type(field(t("mqttCredentials.username")), "bench-user"));
  await act(async () => user.type(field(t("mqttCredentials.password")), PASSWORD));
  await act(async () => user.click(button(container!, t("mqttCredentials.save"))));
  await vi.waitFor(() => expect(container!.querySelector('[data-credential="bench-1"]')).not.toBeNull());
  const save = vi.mocked(api.invoke).mock.calls.find(([name]) => name === "mqtt.credentials.save")!;
  expect(save[1]).toEqual({ ref: "bench-1", username: "bench-user", password: PASSWORD });
  expect(field(t("mqttCredentials.password")).value).toBe("");
  expect(container!.innerHTML).not.toContain(PASSWORD);
  const entry = container!.querySelector('[data-credential="lab"]')!;
  await act(async () => user.click(button(entry, t("mqttCredentials.remove"))));
  await vi.waitFor(() => expect(container!.querySelector('[data-credential="lab"]')).toBeNull());
  expect(
    vi
      .mocked(api.invoke)
      .mock.calls.some(
        ([name, raw]) => name === "mqtt.credentials.remove" && (raw as { ref: string }).ref === "lab",
      ),
  ).toBe(true);
});

const TOKEN = "typed-wokwi-token";
it.each(["en", "ro", "de"])(
  "lists, saves and removes Wokwi tokens without a username: %s",
  async (language) => {
    const user = await mount(language, "wokwi");
    const t = i18n.getFixedT(language);
    expect(container!.textContent).toContain(t("settings.wokwiTokens"));
    expect(container!.textContent).toContain(t("wokwiTokens.description"));
    expect(container!.textContent).not.toMatch(/wokwiTokens\.|mqttCredentials\./);
    expect(container!.textContent).not.toContain(t("mqttCredentials.username"));
    await act(async () => user.type(field(t("wokwiTokens.reference")), "ci"));
    await act(async () => user.type(field(t("wokwiTokens.token")), TOKEN));
    await act(async () => user.click(button(container!, t("wokwiTokens.save"))));
    await vi.waitFor(() => expect(container!.querySelector('[data-credential="ci"]')).not.toBeNull());
    const save = vi.mocked(api.invoke).mock.calls.find(([name]) => name === "wokwi.credentials.save")!;
    expect(save[1]).toEqual({ ref: "ci", token: TOKEN });
    expect(container!.innerHTML).not.toContain(TOKEN);
    const entry = container!.querySelector('[data-credential="lab"]')!;
    await act(async () => user.click(button(entry, t("wokwiTokens.remove"))));
    await vi.waitFor(() => expect(container!.querySelector('[data-credential="lab"]')).toBeNull());
    expect(vi.mocked(api.invoke).mock.calls.some(([name]) => String(name).startsWith("mqtt."))).toBe(false);
  },
);
