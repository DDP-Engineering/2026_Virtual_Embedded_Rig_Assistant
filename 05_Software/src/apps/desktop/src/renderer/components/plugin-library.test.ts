// @vitest-environment jsdom
// REQ-UX-28a74094 REQ-UX-41da0f4f REQ-UX-85399085 REQ-UX-2697c05c REQ-UX-b99b1695 REQ-UX-7c215eb1
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { CatalogPlugin, PluginCatalogView, PluginSummary } from "@vera/shared";
import { veraError } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { catalogKey } from "./plugin-catalog.js";
import { isNewCatalogEntry, libraryStateKey, pluginProgramsKey } from "./plugin-library.js";
import { Plugins } from "./plugins.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn(() => () => {}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let host: HTMLDivElement;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  client?.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});
const entries = (): CatalogPlugin[] =>
  Array.from({ length: 32 }, (_, index) => ({
    id: `plugin-${String(index).padStart(2, "0")}`,
    version: "1.0.0",
    name: `Écran ${String(index).padStart(2, "0")}`,
    description: "Wireless diagnostic",
    ecosystem: index < 16 ? "esp32" : "general",
    tier: index < 24 ? "official" : "community",
    platforms: ["windows-x64"],
    activities: index % 2 ? ["debug"] : ["build"],
    keywords: ["UART", "wireless"],
    requires: [],
    url: `plugin-${index}.zip`,
    sha256: "a".repeat(64),
    bytes: 10,
    update: index === 1,
    addedAt: `2026-11-${String((index % 10) + 1).padStart(2, "0")}`,
    updatedAt: `2026-10-${String((index % 20) + 1).padStart(2, "0")}`,
    ...(index < 2 ? { installed: { version: "0.9.0", issues: [] } } : {}),
  }));
const installed = (
  id: string,
  source: PluginSummary["source"] = "catalog",
  tier: PluginSummary["tier"] = "official",
): PluginSummary => ({
  id,
  name: `Installed ${id}`,
  version: "0.9.0",
  issues: [],
  enabled: false,
  source,
  tier,
  ecosystem: "esp32",
  sha256: "b".repeat(64),
  installedAt: "2026-11-01T00:00:00.000Z",
});
function setup() {
  const state = {
    entries: entries(),
    installed: [
      installed("plugin-00"),
      installed("plugin-01"),
      installed("local-tools", "folder", "local"),
      installed("trial-tools", "zip", "trial"),
    ],
    fail: "",
    catalogError: false,
  };
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-11T23:59:00Z"));
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: Record<string, unknown>) => {
    if (channel === "plugins.list") return state.installed;
    if (channel === "plugins.catalog") {
      if (state.catalogError) throw veraError("NOT_FOUND");
      return { source: "bundled", plugins: state.entries, packs: [] } satisfies PluginCatalogView;
    }
    if (channel === "app.settings.get") return { settings: { plugins: {} } };
    if (channel === "plugins.check") {
      if (request.id === state.fail) throw veraError("NOT_FOUND");
      return [{ name: "tool", kind: "find", state: request.id === "plugin-00" ? "missing" : "ready" }];
    }
    throw Error(`Unexpected ${channel}`);
  }) as never);
  return state;
}
async function mount(reuse = false) {
  if (!reuse) {
    await i18n.changeLanguage("en");
    host = document.createElement("div");
    document.body.append(host);
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  }
  root = createRoot(host);
  await act(async () =>
    root.render(createElement(QueryClientProvider, { client }, createElement(Plugins, {}))),
  );
  await vi.waitFor(() => expect(host.querySelector('[data-library-tab="available"]')).not.toBeNull());
}
const $ = (selector: string) => host.querySelector<HTMLElement>(selector)!;
const click = async (selector: string) => act(async () => userEvent.setup().click($(selector)));
const select = async (selector: string, value: string) =>
  act(async () => userEvent.setup().selectOptions($(selector), value));
const text = () => $("[data-library-results]").textContent;
const ids = () =>
  [...host.querySelectorAll<HTMLElement>("[data-catalog-plugin]")].map((el) => el.dataset.catalogPlugin);
const calls = (name: string) => vi.mocked(api.invoke).mock.calls.filter(([channel]) => channel === name);

it("starts with one Available list below all management controls and switches to source-aware Installed", async () => {
  const state = setup();
  state.installed.push({ ...installed("plugin-00", "workbench", "local"), issues: [{ code: "collision" }] });
  await mount();
  await vi.waitFor(() => expect(ids()).toHaveLength(6));
  expect(host.querySelectorAll(".plugin-list")).toHaveLength(1);
  expect(host.querySelector("[data-pack]")).toBeNull();
  for (const action of [
    "plugin-install-folder",
    "plugin-install-zip",
    "plugin-check-all",
    "plugin-refresh",
    "catalog-check",
  ]) {
    expect(
      $(`[data-action="${action}"]`).compareDocumentPosition($("[data-library-tabs]")) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).not.toBe(0);
  }
  expect(host.textContent).not.toContain("Configure workbench");
  $('[data-library-tab="available"]').focus();
  await act(async () => userEvent.setup().keyboard("{ArrowRight}"));
  expect(document.activeElement).toBe($('[data-library-tab="installed"]'));
  expect($('[data-library-tab="installed"]').getAttribute("aria-selected")).toBe("true");
  expect($('[data-library-tab="available"]').getAttribute("tabindex")).toBe("-1");
  expect(host.querySelectorAll("[data-plugin]")).toHaveLength(5);
  expect(host.textContent).toContain("Trial");
  expect(host.textContent).toContain("Local");
  expect(host.textContent).toContain("collision");
  expect(calls("plugins.programs")).toHaveLength(0);
});

it("intersects normalized all-word search and ecosystem/activity/provenance filters with correct counts", async () => {
  setup();
  await mount();
  await act(async () => userEvent.setup().type($("[data-library-search]"), "ecran UART"));
  await select("[data-library-ecosystem]", "esp32");
  await select("[data-library-activity]", "build");
  expect(text()).toContain("8");
  expect($("[data-library-status=installed]").textContent).toContain("1");
  await select("[data-library-tier]", "community");
  expect(host.textContent).toContain("No plugins match");
  await click('[data-action="library-clear"]');
  expect(text()).toContain("32");
  expect(calls("plugins.catalog")).toHaveLength(1);
  expect(calls("plugins.check")).toHaveLength(0);
});

it("sorts known dates before unknown, has stable ties and classifies New by UTC day ages0..29", async () => {
  const state = setup();
  state.entries[0] = { ...state.entries[0]!, addedAt: undefined, updatedAt: undefined };
  state.entries[1] = { ...state.entries[1]!, addedAt: "2026-11-12" };
  state.entries[2] = { ...state.entries[2]!, addedAt: "2026-10-13" }; // age29
  state.entries[3] = { ...state.entries[3]!, addedAt: "2026-10-12" }; // age30
  state.entries[4] = { ...state.entries[4]!, addedAt: "2026-11-11" };
  await mount();
  await vi.waitFor(() =>
    expect(ids()).toEqual(["plugin-01", "plugin-04", "plugin-09", "plugin-19", "plugin-29", "plugin-08"]),
  );
  await click("[data-library-status=new]");
  expect(text()).toContain("29");
  await select("[data-library-page-size]", "24");
  expect(ids()).toContain("plugin-04");
  await click('[data-action="library-next"]');
  expect(ids()).toContain("plugin-02");
  expect(ids()).not.toContain("plugin-03");
  await click("[data-library-status=all]");
  await select("[data-library-sort]", "name");
  expect(ids()[0]).toBe("plugin-00");
  await select("[data-library-sort]", "updated");
  expect(ids()[0]).toBe("plugin-19");
  await click('[data-action="library-next"]');
  expect(ids().at(-1)).toBe("plugin-00");
});

it("changes New at UTC midnight rather than the host's local calendar day", () => {
  expect(isNewCatalogEntry("2026-10-13", Date.parse("2026-11-11T23:59:59Z"))).toBe(true);
  expect(isNewCatalogEntry("2026-10-13", Date.parse("2026-11-12T00:00:00Z"))).toBe(false);
  expect(isNewCatalogEntry("2026-11-11", Date.parse("2026-11-11T00:15:00+02:00"))).toBe(false);
  expect(isNewCatalogEntry("2026-11-11", Date.parse("2026-11-11T00:00:00Z"))).toBe(true);
  expect(isNewCatalogEntry(undefined, Date.parse("2026-11-11T00:00:00Z"))).toBe(false);
});

it("retains in-session filters/tab across remount, resets filters to page1 and clamps shrinking results", async () => {
  const state = setup();
  await mount();
  await click('[data-action="library-next"]');
  expect($("[data-library-range]").textContent).toContain("7");
  await select("[data-library-sort]", "name");
  expect(ids()[0]).toBe("plugin-00");
  await click('[data-action="library-next"]');
  await act(async () => root.unmount());
  await mount(true);
  expect(ids()[0]).toBe("plugin-06");
  state.entries = state.entries.slice(0, 2);
  await click('[data-action="plugin-refresh"]');
  await vi.waitFor(() => expect(ids()).toHaveLength(2));
  expect($("[data-library-range]").textContent).toContain("1");
});

it("retains the selected tab after navigating away beyond the default five-minute cache lifetime", async () => {
  setup();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    await mount();
    await act(async () =>
      userEvent.setup({ advanceTimers: vi.advanceTimersByTime }).click($('[data-library-tab="installed"]')),
    );
    await act(async () => root.unmount());
    await act(async () => vi.advanceTimersByTimeAsync(6 * 60_000));
    vi.useRealTimers();
    await mount(true);
    expect($('[data-library-tab="installed"]').getAttribute("aria-selected")).toBe("true");
  } finally {
    vi.useRealTimers();
  }
});

it("retains its page while the selected catalog reloads after the data cache expires", async () => {
  const state = setup();
  await mount();
  await vi.waitFor(() => expect(ids()).toHaveLength(6));
  await select("[data-library-sort]", "name");
  await click('[data-action="library-next"]');
  const before = ids();
  await act(async () => root.unmount());
  client.removeQueries({ queryKey: catalogKey });
  let resolve!: (value: PluginCatalogView) => void;
  const pending = new Promise<PluginCatalogView>((done) => {
    resolve = done;
  });
  const invoke = vi.mocked(api.invoke).getMockImplementation()!;
  vi.mocked(api.invoke).mockImplementation(((channel: string, request: never) =>
    channel === "plugins.catalog" ? pending : invoke(channel as never, request)) as never);
  await mount(true);
  expect(client.getQueryData<{ page: number }>(libraryStateKey)?.page).toBe(2);
  await act(async () => resolve({ source: "bundled", plugins: state.entries, packs: [] }));
  await vi.waitFor(() => expect(ids()).toEqual(before));
});

it("retains Installed activity-filter paging while catalog metadata reloads", async () => {
  const state = setup();
  state.installed = state.entries.map((entry) => installed(entry.id));
  await mount();
  await vi.waitFor(() => expect(ids()).toHaveLength(6));
  await click('[data-library-tab="installed"]');
  await select("[data-library-activity]", "build");
  await select("[data-library-sort]", "name");
  await click('[data-action="library-next"]');
  const installedIds = () =>
    [...host.querySelectorAll<HTMLElement>("[data-plugin]")].map((el) => el.dataset.plugin);
  const before = installedIds();
  expect(before).toHaveLength(6);
  await act(async () => root.unmount());
  client.removeQueries({ queryKey: catalogKey });
  let resolve!: (value: PluginCatalogView) => void;
  const pending = new Promise<PluginCatalogView>((done) => {
    resolve = done;
  });
  const invoke = vi.mocked(api.invoke).getMockImplementation()!;
  vi.mocked(api.invoke).mockImplementation(((channel: string, request: never) =>
    channel === "plugins.catalog" ? pending : invoke(channel as never, request)) as never);
  await mount(true);
  expect(client.getQueryData<{ page: number }>(libraryStateKey)?.page).toBe(2);
  await act(async () => resolve({ source: "bundled", plugins: state.entries, packs: [] }));
  await vi.waitFor(() => expect(installedIds()).toEqual(before));
});

it("checks all installed entries despite individual failures and updates passive readiness filters", async () => {
  const state = setup();
  state.fail = "plugin-01";
  await mount();
  await click('[data-library-tab="installed"]');
  await click('[data-plugin="plugin-00"] [data-action="plugin-expand"]');
  expect(calls("plugins.programs")).toHaveLength(0);
  expect(calls("plugins.check")).toHaveLength(0);
  expect(host.textContent).toContain(i18n.t("plugins.notChecked"));
  await click('[data-action="plugin-check-all"]');
  await vi.waitFor(() => expect(calls("plugins.check")).toHaveLength(4));
  expect(host.textContent).toContain("plugin-01");
  expect(host.querySelector("[data-check-all-result]")).not.toBeNull();
  await click('[data-library-status="needs"]');
  expect(host.querySelectorAll("[data-plugin]")).toHaveLength(1);
  expect($('[data-plugin="plugin-00"]')).not.toBeNull();
  expect(calls("plugins.provision")).toHaveLength(0);
  expect(calls("plugins.toggle")).toHaveLength(0);
});

it("keeps unavailable program observations distinct from missing configuration", async () => {
  const state = setup();
  await mount();
  await click('[data-library-tab="installed"]');
  await act(async () => {
    client.setQueryData(pluginProgramsKey(undefined, state.installed[0]!), [
      { name: "tool", kind: "find", state: "unavailable", problem: "version" },
    ]);
    client.setQueryData(pluginProgramsKey(undefined, state.installed[1]!), [
      { name: "tool", kind: "find", state: "missing" },
    ]);
  });
  await vi.waitFor(() =>
    expect($('[data-plugin="plugin-00"] [data-readiness]').getAttribute("data-readiness")).toBe(
      "unavailable",
    ),
  );
  expect($('[data-plugin="plugin-00"]').textContent).toContain("Unavailable / error");
  expect($('[data-plugin="plugin-01"] [data-readiness]').getAttribute("data-readiness")).toBe("needs");
  await click('[data-library-status="needs"]');
  expect(host.querySelectorAll("[data-plugin]")).toHaveLength(1);
  expect(calls("plugins.programs")).toHaveLength(0);
});

it("keeps installed packages usable when catalog loading fails and provides empty-list recovery", async () => {
  const state = setup();
  state.catalogError = true;
  await mount();
  await click('[data-library-tab="installed"]');
  await vi.waitFor(() => expect(host.querySelectorAll("[data-plugin]")).toHaveLength(4));
  await act(async () => userEvent.setup().type($("[data-library-search]"), "zz-no-match"));
  expect(host.textContent).toContain("No plugins match");
  await click('[data-action="library-clear"]');
  expect(host.querySelectorAll("[data-plugin]")).toHaveLength(4);
});
