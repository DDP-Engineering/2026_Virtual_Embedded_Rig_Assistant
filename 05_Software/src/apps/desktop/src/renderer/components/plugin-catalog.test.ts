// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type { CatalogPlugin, PluginCatalogReview, PluginCatalogView, PluginSummary } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { installOrder } from "./plugin-catalog.js";
import { Plugins } from "./plugins.js";

vi.mock("../api/index.js", () => ({ api: { invoke: vi.fn(), subscribe: vi.fn(() => () => {}) } }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let container: HTMLDivElement;
let client: QueryClient;
afterEach(async () => {
  await act(async () => root?.unmount());
  container?.remove();
  client?.clear();
  vi.clearAllMocks();
});

const entry = (id: string, more: Partial<CatalogPlugin> = {}): CatalogPlugin => ({
  id,
  version: "1.0.0",
  tier: "official",
  ecosystem: "esp32",
  platforms: ["windows-x64", "linux-x64"],
  name: `Name ${id}`,
  description: `About ${id}.`,
  requires: [],
  activities: [],
  keywords: [],
  url: `${id}-1.0.0.zip`,
  sha256: "a".repeat(64),
  bytes: 100,
  update: false,
  ...more,
});
const view = (plugins: CatalogPlugin[], more: Partial<PluginCatalogView> = {}): PluginCatalogView => ({
  source: "remote",
  url: "https://catalog.test/vera/",
  checkedAt: "2026-11-03T12:00:00.000Z",
  plugins,
  packs: [
    {
      id: "esp32",
      name: "ESP32 (Espressif)",
      groups: [
        { name: "Core", plugins: ["serial-monitor", "esp32-esptool"], default: true },
        { name: "Security (irreversible)", plugins: ["esp32-efuse"], default: false },
      ],
    },
  ],
  ...more,
});
const esp32 = [
  entry("esp32-efuse", { requires: ["esp32-esptool"] }),
  entry("esp32-esptool", { requires: ["serial-monitor"] }),
  entry("can-logger", { tier: "community", ecosystem: "can" }),
  entry("serial-monitor"),
];
const installed = (id: string, version: string): PluginSummary => ({
  id,
  issues: [],
  version,
  name: `Name ${id}`,
  tier: "official",
  source: "catalog",
  sha256: "b".repeat(64),
  enabled: false,
});
const reviewOf = (id: string, required: boolean, update = false): PluginCatalogReview => ({
  review: {
    path: `C:/data/plugins/catalog/${id}.zip`,
    kind: "zip",
    sha256: `${id.length.toString(16)}`.padStart(64, "c"),
    issues: [],
    manifest: {
      format: 1,
      id,
      version: "1.0.0",
      name: `Name ${id}`,
      description: `About ${id}.`,
      ecosystem: "esp32",
      platforms: ["windows-x64"],
      requires: [],
      programs: {},
      rules: [{ match: `${id} *`, risk: "device-write" }],
      docs: [],
    },
    ...(update ? { installed: { version: "1.0.0" } } : {}),
  },
  id,
  version: "1.0.0",
  tier: "official",
  required,
});

function stub(options: {
  catalog: PluginCatalogView;
  installed?: PluginSummary[];
  required?: Record<string, boolean>;
  plugins?: Record<string, string>;
}) {
  const state = { settings: { plugins: options.plugins ?? {} } as { plugins: Record<string, string> } };
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: Record<string, unknown>) => {
    switch (channel) {
      case "plugins.list":
        return options.installed ?? [];
      case "plugins.programs":
        return [];
      case "plugins.catalog":
        return options.catalog;
      case "plugins.catalogReview": {
        const id = request.id as string;
        return reviewOf(
          id,
          options.required?.[id] ?? true,
          Boolean(options.installed?.some((p) => p.id === id)),
        );
      }
      case "plugins.catalogInstall":
        return installed(request.id as string, "1.0.0");
      case "app.settings.get":
        return { settings: state.settings };
      case "app.settings.update":
        state.settings = { ...state.settings, ...(request as { plugins: Record<string, string> }) };
        return { settings: state.settings };
      default:
        throw new Error(`Unexpected ${channel}`);
    }
  }) as never);
  return state;
}
async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Plugins, {})));
  });
  await vi.waitFor(() => expect($('[data-library-status="all"]')).not.toBeNull());
  await click(".plugin-catalog-settings > summary");
}
const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
const click = async (selector: string) => {
  await act(async () => {
    await userEvent.setup().click($(selector));
  });
};
const calls = (channel: string) =>
  vi
    .mocked(api.invoke)
    .mock.calls.filter(([name]) => name === channel)
    .map(([, request]) => request);

it("orders installs with catalog requirements first and skips installed plugins", () => {
  expect(installOrder(view(esp32), ["esp32-efuse"])).toEqual([
    "serial-monitor",
    "esp32-esptool",
    "esp32-efuse",
  ]);
  const some = view(
    esp32.map((plugin) => (plugin.id === "serial-monitor" ? { ...plugin, installed: {} } : plugin)),
  );
  expect(installOrder(some, ["serial-monitor", "esp32-esptool"])).toEqual(["esp32-esptool"]);
});

// REQ-UX-72a349a1
it.each(["en", "ro", "de"])(
  "reviews individual catalog installs and required dependencies in order (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    stub({ catalog: view(esp32) });
    await render();
    await vi.waitFor(() => expect($('[data-catalog-plugin="esp32-esptool"]')).not.toBeNull());
    expect($("[data-pack]")).toBeNull();
    await click('[data-catalog-plugin="esp32-esptool"] [data-action="catalog-install"]');
    await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
    expect(calls("plugins.catalogReview")).toEqual([{ id: "serial-monitor" }]);
    expect($("[data-catalog-review]").textContent).toContain(
      i18n.t("plugins.catalog.reviewFrom", { tier: i18n.t("plugins.tier.official"), version: "1.0.0" }),
    );
    await click('[data-action="plugin-install"]');
    await vi.waitFor(() => expect(calls("plugins.catalogReview")).toHaveLength(2));
    expect(calls("plugins.catalogInstall")).toEqual([
      { id: "serial-monitor", sha256: reviewOf("serial-monitor", true).review.sha256 },
    ]);
    expect(calls("plugins.catalogReview")[1]).toEqual({ id: "esp32-esptool" });
    await vi.waitFor(() => expect($("[data-plugin-review]")?.textContent).toContain("esp32-esptool"));
    await click('[data-action="plugin-review-cancel"]');
    expect($("[data-plugin-review]")).toBeNull();
    expect(calls("plugins.catalogInstall")).toHaveLength(1);
  },
);

// REQ-UX-72a349a1
it("stops the queue when the first review is cancelled", async () => {
  await i18n.changeLanguage("en");
  stub({ catalog: view(esp32) });
  await render();
  await vi.waitFor(() => expect($('[data-catalog-plugin="esp32-efuse"]')).not.toBeNull());
  await click('[data-catalog-plugin="esp32-efuse"] [data-action="catalog-install"]');
  await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
  await click('[data-action="plugin-review-cancel"]');
  expect(calls("plugins.catalogReview")).toEqual([{ id: "serial-monitor" }]);
  expect(calls("plugins.catalogInstall")).toEqual([]);
});

// REQ-UX-c55a0fe1
it("lists catalog plugins with tiers and installed states, and notes an unreachable catalog", async () => {
  await i18n.changeLanguage("en");
  const plugins = esp32.map((plugin) =>
    plugin.id === "serial-monitor"
      ? { ...plugin, installed: { version: "1.0.0", tier: "official" as const } }
      : plugin,
  );
  stub({ catalog: view(plugins, { source: "bundled", problem: "unreachable" }) });
  await render();
  await vi.waitFor(() => expect($('[data-catalog-plugin="can-logger"]')).not.toBeNull());
  expect($("[data-catalog-source]")).toBeNull();
  expect($('[data-catalog-problem="unreachable"]').textContent).toBe(
    i18n.t("plugins.catalog.problemUnreachable"),
  );
  expect($('[data-catalog-plugin="can-logger"] [data-tier="community"]').textContent).toBe(
    i18n.t("plugins.tier.community"),
  );
  expect($('[data-catalog-plugin="serial-monitor"] [data-installed]').textContent).toContain("1.0.0");
  expect($('[data-catalog-plugin="serial-monitor"] [data-action="catalog-install"]')).toBeNull();
  await click('[data-catalog-plugin="esp32-esptool"] [data-action="catalog-install"]');
  await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
  expect(calls("plugins.catalogReview")).toEqual([{ id: "esp32-esptool" }]);
});

// REQ-UX-c55a0fe1
it("opens the review screen for an update that needs one and installs other updates at once", async () => {
  await i18n.changeLanguage("en");
  const plugins = esp32.map((plugin) =>
    ["serial-monitor", "esp32-esptool"].includes(plugin.id)
      ? {
          ...plugin,
          version: "1.1.0",
          installed: { version: "1.0.0", tier: "official" as const },
          update: true,
        }
      : plugin,
  );
  stub({
    catalog: view(plugins),
    installed: [installed("serial-monitor", "1.0.0"), installed("esp32-esptool", "1.0.0")],
    required: { "serial-monitor": true, "esp32-esptool": false },
  });
  await render();
  await click('[data-library-status="installed"]');
  await vi.waitFor(() =>
    expect($('[data-plugin="esp32-esptool"] [data-action="plugin-update"]')).not.toBeNull(),
  );
  expect($('[data-plugin="esp32-esptool"] [data-plugin-update]').textContent).toBe(
    i18n.t("plugins.catalog.updateAvailable", { version: "1.1.0" }),
  );
  await click('[data-plugin="esp32-esptool"] [data-action="plugin-update"]');
  await vi.waitFor(() => expect(calls("plugins.catalogInstall")).toHaveLength(1));
  expect($("[data-plugin-review]")).toBeNull();

  await click('[data-library-status="all"]');
  await click('[data-plugin="serial-monitor"] [data-action="plugin-update"]');
  await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
  expect($("[data-catalog-review]").textContent).toContain(i18n.t("plugins.catalog.reviewChanges"));
  expect(calls("plugins.catalogInstall")).toHaveLength(1);
  await click('[data-action="plugin-install"]');
  await vi.waitFor(() => expect(calls("plugins.catalogInstall")).toHaveLength(2));
});

// REQ-UX-c55a0fe1 REQ-UX-28a74094
it.each([
  { source: "folder", tier: "local" },
  { source: "zip", tier: "trial" },
] as const)(
  "retains reviewed catalog updates for a global $source import without borrowing trust or updating its scoped collision",
  async ({ source, tier }) => {
    await i18n.changeLanguage("en");
    const global = { ...installed("serial-monitor", "1.0.0"), source, tier };
    const scoped = {
      ...global,
      source: "workbench" as const,
      sha256: "c".repeat(64),
      installedAt: "2026-11-01T00:00:00Z",
    };
    const newer = entry("serial-monitor", {
      version: "1.1.0",
      activities: ["build"],
      keywords: ["catalog-only"],
      addedAt: "2026-11-01",
      installed: { version: "1.0.0", tier },
      update: true,
    });
    const options = {
      catalog: view([newer]),
      installed: [global, scoped],
      required: { "serial-monitor": true },
    };
    stub(options);
    await render();
    await click('[data-library-status="installed"]');
    await vi.waitFor(() =>
      expect(container.querySelectorAll('[data-plugin="serial-monitor"]')).toHaveLength(2),
    );
    expect(container.querySelectorAll(`[data-plugin="serial-monitor"] [data-tier="${tier}"]`)).toHaveLength(
      2,
    );
    await act(async () => userEvent.setup().selectOptions($("[data-library-activity]"), "build"));
    expect(container.querySelectorAll("[data-plugin]")).toHaveLength(0);
    await click('[data-action="library-clear"]');
    await click('[data-library-status="updates"]');
    expect(container.querySelectorAll('[data-plugin="serial-monitor"]')).toHaveLength(1);
    expect($(`[data-plugin="serial-monitor"] [data-tier="${tier}"]`)).not.toBeNull();
    await click('[data-plugin="serial-monitor"] [data-action="plugin-expand"]');
    expect($('[data-plugin="serial-monitor"]').textContent).toContain(
      i18n.t("plugins.library.dateUnavailable"),
    );
    expect($('[data-plugin="serial-monitor"]').textContent).not.toContain("2026-11-01");
    await click('[data-plugin="serial-monitor"] [data-action="plugin-update"]');
    await vi.waitFor(() => expect($("[data-catalog-review]")).not.toBeNull());
    expect(calls("plugins.catalogReview")).toEqual([{ id: "serial-monitor" }]);
    expect(calls("plugins.catalogInstall")).toHaveLength(0);
    expect(global.tier).toBe(tier);
    expect(global.version).toBe("1.0.0");
    expect(calls("plugins.toggle")).toHaveLength(0);
    await click('[data-action="plugin-review-cancel"]');
    options.catalog = view([{ ...newer, installed: { version: "0.8.0", tier } }]);
    await click('[data-action="catalog-check"]');
    await vi.waitFor(() => expect(container.querySelectorAll("[data-plugin]")).toHaveLength(0));
  },
);

// REQ-UX-9207423e
it("saves a catalog URL keeping the index and proxy, refuses a remote http URL and restores the default", async () => {
  await i18n.changeLanguage("en");
  const state = stub({
    catalog: view([]),
    plugins: { index: "https://pypi.test/simple", proxy: "http://proxy.test:8080" },
  });
  await render();
  await vi.waitFor(() => expect($("[data-catalog-url]")).not.toBeNull());
  const field = $("[data-catalog-url]") as HTMLInputElement;
  const type = async (text: string) => {
    await act(async () => {
      const user = userEvent.setup();
      await user.clear(field);
      await user.type(field, text);
    });
  };
  await type("http://mirror.test/vera/");
  await click('[data-action="catalog-url-save"]');
  expect($('[role="alert"]').textContent).toBe(i18n.t("plugins.catalog.urlInvalid"));
  expect(calls("app.settings.update")).toEqual([]);

  await type("https://mirror.test/vera/");
  await click('[data-action="catalog-url-save"]');
  await vi.waitFor(() => expect(calls("app.settings.update")).toHaveLength(1));
  expect(calls("app.settings.update")[0]).toEqual({
    plugins: {
      index: "https://pypi.test/simple",
      proxy: "http://proxy.test:8080",
      catalog: "https://mirror.test/vera/",
    },
  });
  await vi.waitFor(() => expect(calls("plugins.catalog").length).toBeGreaterThan(1));
  expect(state.settings.plugins.catalog).toBe("https://mirror.test/vera/");

  await click('[data-action="catalog-url-default"]');
  await vi.waitFor(() => expect(calls("app.settings.update")).toHaveLength(2));
  expect(calls("app.settings.update")[1]).toEqual({
    plugins: { index: "https://pypi.test/simple", proxy: "http://proxy.test:8080" },
  });
});

// REQ-UX-9207423e
it("saves nothing before the settings have loaded, so the package index and proxy cannot be lost", async () => {
  await i18n.changeLanguage("en");
  stub({ catalog: view([]) });
  const invoke = vi.mocked(api.invoke).getMockImplementation();
  vi.mocked(api.invoke).mockImplementation(((channel: string, request: unknown) =>
    channel === "app.settings.get"
      ? new Promise(() => {})
      : invoke?.(channel as never, request as never)) as never);
  await render();
  await vi.waitFor(() => expect($("[data-catalog-url]")).not.toBeNull());
  expect(($('[data-action="catalog-url-save"]') as HTMLButtonElement).disabled).toBe(true);
  expect(($('[data-action="catalog-url-default"]') as HTMLButtonElement).disabled).toBe(true);
  expect(calls("app.settings.update")).toEqual([]);
});

// REQ-UX-c55a0fe1
it("checks the catalog again on request", async () => {
  await i18n.changeLanguage("en");
  stub({ catalog: view(esp32) });
  await render();
  await vi.waitFor(() => expect($('[data-catalog-plugin="esp32-esptool"]')).not.toBeNull());
  await click('[data-action="catalog-check"]');
  await vi.waitFor(() => expect(calls("plugins.catalog")).toContainEqual({ refresh: true }));
  expect(calls("plugins.catalog")[0]).toEqual({ refresh: false });
});
