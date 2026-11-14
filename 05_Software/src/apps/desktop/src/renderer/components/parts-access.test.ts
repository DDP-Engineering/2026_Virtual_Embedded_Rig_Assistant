// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import { type PartsAccessSnapshot, partsSearchDefaults, partsSupplierIds } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { PartsAccessPanel } from "./parts-access.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn() } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root | undefined, container: HTMLDivElement | undefined;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  vi.resetAllMocks();
});
const KEY = "mouser-key-typed-by-user";

async function mount(language: string) {
  await i18n.changeLanguage(language);
  let snapshot: PartsAccessSnapshot = {
    preferences: structuredClone(partsSearchDefaults),
    keys: Object.fromEntries(
      partsSupplierIds.map((id) => [id, { keyConfigured: false, storage: null }]),
    ) as PartsAccessSnapshot["keys"],
    secureStorage: true,
  };
  vi.mocked(api.invoke).mockImplementation(async (name, raw) => {
    const input = raw as Record<string, never>;
    if (name === "parts.access.get") return structuredClone(snapshot) as never;
    if (name === "parts.access.save") {
      const request = input as unknown as {
        preferences: PartsAccessSnapshot["preferences"];
        supplier?: "mouser";
      };
      snapshot = {
        ...snapshot,
        preferences: request.preferences,
        keys: request.supplier
          ? { ...snapshot.keys, [request.supplier]: { keyConfigured: true, storage: "encrypted" } }
          : snapshot.keys,
      };
      return { status: "saved" } as never;
    }
    if (name === "parts.access.removeKey") {
      snapshot = { ...snapshot, keys: { ...snapshot.keys, mouser: { keyConfigured: false, storage: null } } };
      return {} as never;
    }
    if (name === "parts.access.test")
      return {
        testId: (raw as { testId: string }).testId,
        supplier: "mouser",
        status: "auth",
        checkedAt: "2026-11-13T10:00:00Z",
        durationMs: 3,
      } as never;
    return {} as never;
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root!.render(createElement(QueryClientProvider, { client }, createElement(PartsAccessPanel))),
  );
  await vi.waitFor(() => expect(container!.querySelectorAll("fieldset[data-supplier]")).toHaveLength(5));
  return userEvent.setup();
}
const supplier = (id: string) =>
  container!.querySelector<HTMLFieldSetElement>(`fieldset[data-supplier="${id}"]`)!;
const button = (scope: ParentNode, label: string) =>
  [...scope.querySelectorAll("button")].find((element) => element.textContent === label)!;

it.each(["en", "ro", "de"])(
  "enables a supplier, saves and removes its credential and tests it: %s",
  async (language) => {
    const user = await mount(language);
    const t = i18n.getFixedT(language);
    expect(container!.textContent).toContain(t("settings.partsSearch"));
    expect([...container!.querySelectorAll("legend")].map((legend) => legend.textContent)).toEqual([
      t("partsSearch.region"),
      "Mouser",
      "DigiKey",
      "TME",
      "Farnell",
      "Rutronik",
    ]);
    expect(supplier("digikey").textContent).toContain(t("partsSearch.idLabel.digikey"));
    expect(supplier("mouser").textContent).not.toContain(t("partsSearch.idLabel.digikey"));
    expect(container!.textContent).not.toMatch(/partsSearch\./);
    const mouser = supplier("mouser");
    await act(async () => user.click(mouser.querySelector('input[type="checkbox"]')!));
    await act(async () => user.type(mouser.querySelector('input[type="password"]')!, KEY));
    await act(async () => user.click(button(mouser, t("partsSearch.saveKey"))));
    await vi.waitFor(() =>
      expect(supplier("mouser").textContent).toContain(
        t("partsSearch.keyConfigured", { storage: t("webAccess.storage.encrypted") }),
      ),
    );
    const save = vi.mocked(api.invoke).mock.calls.find(([name]) => name === "parts.access.save")!;
    expect(save[1]).toMatchObject({
      supplier: "mouser",
      credential: { secret: KEY },
      preferences: { suppliers: { mouser: { enabled: true } } },
    });
    expect(supplier("mouser").querySelector<HTMLInputElement>('input[type="password"]')!.value).toBe("");
    expect(container!.innerHTML).not.toContain(KEY);
    await act(async () => user.click(button(supplier("mouser"), t("partsSearch.test"))));
    await vi.waitFor(() => expect(supplier("mouser").textContent).toContain(t("partsSearch.results.auth")));
    await act(async () => user.click(button(supplier("mouser"), t("partsSearch.removeKey"))));
    await vi.waitFor(() => expect(supplier("mouser").textContent).toContain(t("partsSearch.noKey")));
  },
);
