// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type {
  CatalogPlugin,
  PluginCatalogReview,
  PluginCatalogView,
  PluginProgramStatus,
  PluginSummary,
} from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { installOrder } from "./plugin-catalog.js";
import { Plugins } from "./plugins.js";

vi.mock("../api/index.js", () => ({
  api: { invoke: vi.fn(), subscribe: vi.fn(() => () => {}), getAppInfo: vi.fn() },
}));
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
  summary: `Short ${id}.`,
  description: `About ${id}.`,
  risk: "device-read",
  requires: [],
  dependencies: [],
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
const reviewOf = (id: string, required: boolean, update = false, version = "1.0.0"): PluginCatalogReview => ({
  review: {
    path: `C:/data/plugins/catalog/${id}.zip`,
    kind: "zip",
    sha256: `${id.length.toString(16)}`.padStart(64, "c"),
    issues: [],
    manifest: {
      format: 1,
      id,
      version,
      name: `Name ${id}`,
      summary: `Short ${id}.`,
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
  version,
  tier: "official",
  required,
});

function stub(options: {
  catalog: PluginCatalogView;
  installed?: PluginSummary[];
  required?: Record<string, boolean>;
  plugins?: Record<string, string>;
  host?: { platform: string; arch: string };
  provision?: Record<string, PluginProgramStatus[]>;
}) {
  vi.mocked(api.getAppInfo).mockResolvedValue({
    name: "VERA",
    version: "0.0.0",
    ...(options.host ?? { platform: "win32", arch: "x64" }),
    portable: false,
    locale: "en",
    testBuild: true,
    signing: "not-applicable",
  });
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
          options.catalog.plugins.find((plugin) => plugin.id === id)?.version,
        );
      }
      case "plugins.catalogInstall":
        return installed(request.id as string, "1.0.0");
      case "plugins.provision":
      case "plugins.check":
        return options.provision?.[request.id as string] ?? [];
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

// REQ-UX-84d8cad7
it("chooses the catalog channel keeping the other plugin settings and reloads the catalog", async () => {
  await i18n.changeLanguage("en");
  const state = stub({
    catalog: view([]),
    plugins: { index: "https://pypi.test/simple", catalog: "https://mirror.test/vera/" },
  });
  await render();
  await vi.waitFor(() => expect($("[data-catalog-channel]")).not.toBeNull());
  const select = $("[data-catalog-channel]") as HTMLSelectElement;
  await vi.waitFor(() => expect(select.disabled).toBe(false));
  expect(select.value).toBe("stable");
  expect([...select.options].map((option) => option.textContent)).toEqual([
    i18n.t("plugins.catalog.channels.stable"),
    i18n.t("plugins.catalog.channels.pre-release"),
  ]);
  const before = calls("plugins.catalog").length;
  await act(async () => {
    await userEvent.setup().selectOptions(select, "pre-release");
  });
  await vi.waitFor(() => expect(calls("app.settings.update")).toHaveLength(1));
  expect(calls("app.settings.update")[0]).toEqual({
    plugins: {
      index: "https://pypi.test/simple",
      catalog: "https://mirror.test/vera/",
      channel: "pre-release",
    },
  });
  expect(state.settings.plugins.channel).toBe("pre-release");
  await vi.waitFor(() => expect(calls("plugins.catalog").length).toBeGreaterThan(before));
  expect(($("[data-catalog-channel]") as HTMLSelectElement).value).toBe("pre-release");
});

// REQ-UX-84d8cad7
it.each(["en", "ro", "de"])("names an unsigned or untrusted remote catalog in %s", async (language) => {
  await i18n.changeLanguage(language);
  for (const problem of ["unsigned", "untrusted"] as const) {
    stub({ catalog: view(esp32, { source: "bundled", problem }) });
    await render();
    await vi.waitFor(() => expect($(`[data-catalog-problem="${problem}"]`)).not.toBeNull());
    const key = problem === "unsigned" ? "problemUnsigned" : "problemUntrusted";
    const text = $(`[data-catalog-problem="${problem}"]`).textContent ?? "";
    expect(text).toBe(i18n.t(`plugins.catalog.${key}`));
    expect(text).not.toContain("plugins.catalog");
    if (problem === "unsigned") {
      await act(async () => root.unmount());
      container.remove();
    }
  }
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

// REQ-UX-4ef3aa51
it.each(["en", "ro", "de"])(
  "shows the Pre-release badge beside a pre-release version on cards and in the review (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    const badge = i18n.t("plugins.maturity.preRelease");
    stub({
      catalog: view([entry("serial-monitor", { version: "0.2.0" }), entry("ltspice")]),
      installed: [installed("git", "0.3.0"), installed("kicad", "1.0.0")],
    });
    await render();
    await vi.waitFor(() => expect($('[data-catalog-plugin="serial-monitor"]')).not.toBeNull());
    expect($('[data-catalog-plugin="serial-monitor"] [data-maturity="pre-release"]').textContent).toBe(badge);
    expect($('[data-catalog-plugin="ltspice"] [data-maturity]')).toBeNull();
    await vi.waitFor(() => expect($('[data-plugin="git"]')).not.toBeNull());
    expect($('[data-plugin="git"] [data-maturity="pre-release"]').textContent).toBe(badge);
    expect($('[data-plugin="kicad"] [data-maturity]')).toBeNull();
    await click('[data-catalog-plugin="serial-monitor"] [data-action="catalog-install"]');
    await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
    expect($('[data-plugin-review] [data-maturity="pre-release"]').textContent).toBe(badge);
  },
);

// REQ-UX-d431b9b2, REQ-UX-9ae801f5, REQ-UX-41f26472
it.each(["en", "ro", "de"])(
  "shows the summary and type on the card, and the platform and risk warnings only when they apply (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    stub({
      catalog: view([
        entry("ltspice", { platforms: ["windows-x64"], risk: "safe", version: "0.3.0" }),
        entry("esp32-esptool", { risk: "device-write" }),
        entry("esp32-efuse", { risk: "irreversible" }),
        entry("serial-monitor"),
      ]),
      host: { platform: "linux", arch: "x64" },
    });
    await render();
    const card = (id: string) => `[data-catalog-plugin="${id}"]`;
    const warning = (id: string, kind: string) => $(`${card(id)} [data-catalog-warning="${kind}"]`);
    await vi.waitFor(() => expect(warning("ltspice", "platform")).not.toBeNull());
    const ltspice = $(card("ltspice"));
    expect(ltspice.textContent).toContain("Name ltspice");
    expect(ltspice.textContent).toContain("0.3.0");
    expect(ltspice.querySelector('[data-maturity="pre-release"]')).not.toBeNull();
    expect(ltspice.querySelector('[data-tier="official"]')?.textContent).toBe(
      i18n.t("plugins.tier.official"),
    );
    expect(ltspice.textContent).toContain("esp32");
    expect(ltspice.textContent).toContain("Short ltspice.");
    expect(ltspice.textContent).not.toContain("About ltspice.");
    expect(warning("ltspice", "platform").textContent).toBe(
      i18n.t("plugins.catalog.platformWarning", { platforms: "windows-x64" }),
    );
    expect(warning("ltspice", "risk")).toBeNull();
    expect(warning("esp32-esptool", "risk").textContent).toBe(
      i18n.t("plugins.catalog.riskWarning.device-write"),
    );
    expect(warning("esp32-efuse", "risk").textContent).toBe(
      i18n.t("plugins.catalog.riskWarning.irreversible"),
    );
    expect(warning("esp32-efuse", "risk").textContent).not.toBe(warning("esp32-esptool", "risk").textContent);
    for (const id of ["esp32-esptool", "esp32-efuse", "serial-monitor"])
      expect(warning(id, "platform"), id).toBeNull();
    expect(warning("serial-monitor", "risk")).toBeNull();
    // The review keeps the full description and the rules.
    await click(`${card("serial-monitor")} [data-action="catalog-install"]`);
    await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
    expect($("[data-plugin-review]").textContent).toContain("About serial-monitor.");
    expect($('[data-plugin-review] [data-rule="device-write"]')).not.toBeNull();
  },
);

// REQ-UX-9ae801f5
it("shows no platform warning on a listed platform or when the host platform is unknown", async () => {
  await i18n.changeLanguage("en");
  for (const host of [
    { platform: "win32", arch: "x64" },
    { platform: "darwin", arch: "arm64" },
  ]) {
    stub({ catalog: view([entry("ltspice", { platforms: ["windows-x64"] })]), host });
    await render();
    await vi.waitFor(() => expect($('[data-catalog-plugin="ltspice"]')).not.toBeNull());
    await vi.waitFor(() => expect(vi.mocked(api.getAppInfo)).toHaveBeenCalled());
    expect($('[data-catalog-warning="platform"]'), host.platform).toBeNull();
    await act(async () => root.unmount());
    container.remove();
    client.clear();
  }
});

const arduinoSha = "2769b9b282ce597db9679d8ec14d726d57004ca4205ef4d7a795bf36b6cdc9d8";
const kicadGuide =
  "Install KiCad 10 from https://www.kicad.org/download/, then check again. VERA never installs KiCad.";
const dependencyCatalog = [
  entry("arduino-cli", {
    ecosystem: "arduino",
    requires: ["serial-monitor"],
    dependencies: [
      {
        name: "arduino-cli",
        kind: "download",
        automatic: true,
        downloads: [
          { platform: "windows-x64", sha256: arduinoSha, bytes: 20404890 },
          { platform: "linux-x64", sha256: "3".repeat(64), bytes: 20111675 },
        ],
        find: ["windows", "linux"],
        range: ">=1.6,<2",
        guide: "Install arduino-cli from https://arduino.github.io/arduino-cli/latest/installation/.",
      },
      { name: "arduino-tool", kind: "script", automatic: true, script: "scripts/arduino_tool.py" },
    ],
  }),
  entry("kicad", {
    ecosystem: "kicad",
    dependencies: [
      {
        name: "kicad-cli",
        kind: "find",
        automatic: false,
        find: ["windows", "linux"],
        range: ">=10.0,<11",
        guide: kicadGuide,
      },
      { name: "kicad-tool", kind: "script", automatic: true, script: "scripts/kicad_tool.py" },
    ],
  }),
  entry("serial-monitor", {
    dependencies: [{ name: "serial-tool", kind: "pip", automatic: true, pip: "pyserial>=3.5" }],
  }),
];

// REQ-UX-714c27e6
it.each(["en", "ro", "de"])(
  "lists a catalog plugin's dependencies in its card details before any download (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    stub({ catalog: view(dependencyCatalog) });
    await render();
    await vi.waitFor(() => expect($('[data-catalog-plugin="arduino-cli"]')).not.toBeNull());
    await click('[data-catalog-plugin="arduino-cli"] details > summary');
    const card = $('[data-catalog-plugin="arduino-cli"]');
    const required = card.querySelector('[data-required-plugin="serial-monitor"]') as HTMLElement;
    expect(required.getAttribute("data-installed")).toBe("false");
    const download = card.querySelector('[data-dependency="arduino-cli"]') as HTMLElement;
    expect(download.getAttribute("data-automatic")).toBe("true");
    expect(download.textContent).toContain(i18n.t("plugins.dependencies.automatic"));
    expect(download.textContent).toContain(arduinoSha);
    expect(download.textContent).toContain("windows-x64");
    // The host is Windows x64: only its download is listed.
    expect(download.textContent).not.toContain("3".repeat(64));
    expect(download.textContent).toMatch(/20[.,]4/);
    const script = card.querySelector('[data-dependency="arduino-tool"]') as HTMLElement;
    expect(script.getAttribute("data-automatic")).toBe("true");
    expect(script.textContent).toContain("scripts/arduino_tool.py");
    expect(calls("plugins.catalogReview")).toEqual([]);

    await click('[data-catalog-plugin="kicad"] details > summary');
    const vendor = $('[data-catalog-plugin="kicad"] [data-dependency="kicad-cli"]');
    expect(vendor.getAttribute("data-automatic")).toBe("false");
    expect(vendor.textContent).toContain(i18n.t("plugins.dependencies.manual"));
    expect(vendor.textContent).toContain(">=10.0,<11");
    expect(vendor.querySelector('[data-web-source="https://www.kicad.org/download/"]')).not.toBeNull();
    expect(calls("plugins.catalogReview")).toEqual([]);
  },
);

// REQ-FUNC-34191c6f
it("installs a plugin with its required plugins and programs and lists what stays manual", async () => {
  await i18n.changeLanguage("en");
  stub({
    catalog: view(dependencyCatalog),
    provision: {
      "serial-monitor": [{ name: "serial-tool", kind: "pip", state: "missing", problem: "download" }],
      "arduino-cli": [
        { name: "arduino-cli", kind: "download", state: "ready", version: "1.6.0" },
        { name: "arduino-tool", kind: "script", state: "ready", version: "0.2.0" },
      ],
      kicad: [
        {
          name: "kicad-cli",
          kind: "find",
          state: "missing",
          problem: "notFound",
          hint: kicadGuide,
          link: "https://www.kicad.org/download/",
        },
        { name: "kicad-tool", kind: "script", state: "ready", version: "0.3.0" },
      ],
    },
  });
  await render();
  await vi.waitFor(() => expect($('[data-catalog-plugin="arduino-cli"]')).not.toBeNull());
  await click('[data-catalog-plugin="arduino-cli"] [data-action="catalog-install-all"]');
  await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
  await click('[data-action="plugin-install"]');
  await vi.waitFor(() => expect($("[data-plugin-review]")?.textContent).toContain("arduino-cli"));
  await click('[data-action="plugin-install"]');
  await vi.waitFor(() => expect($('[data-install-result="arduino-cli"]')).not.toBeNull());
  expect(calls("plugins.catalogInstall").map((request) => (request as { id: string }).id)).toEqual([
    "serial-monitor",
    "arduino-cli",
  ]);
  expect(calls("plugins.provision")).toEqual([{ id: "serial-monitor" }, { id: "arduino-cli" }]);
  expect(
    $('[data-install-result="arduino-cli"] [data-program="arduino-cli"]').getAttribute("data-state"),
  ).toBe("ready");
  // Offline: the failed download has an explicit state.
  expect($('[data-install-result="serial-monitor"]').textContent).toContain(
    i18n.t("plugins.problem.download"),
  );

  await click('[data-catalog-plugin="kicad"] [data-action="catalog-install-all"]');
  await vi.waitFor(() => expect($("[data-plugin-review]")).not.toBeNull());
  await click('[data-action="plugin-install"]');
  await vi.waitFor(() => expect($('[data-install-result="kicad"]')).not.toBeNull());
  const manual = $('[data-install-result="kicad"] [data-program="kicad-cli"]');
  expect(manual.getAttribute("data-automatic")).toBe("false");
  expect(manual.textContent).toContain(i18n.t("plugins.problem.notFound"));
  expect(manual.querySelector('[data-web-source="https://www.kicad.org/download/"]')).not.toBeNull();
  await click('[data-install-result="kicad"] [data-action="install-result-check"]');
  await vi.waitFor(() => expect(calls("plugins.check")).toEqual([{ id: "kicad" }]));
});

// REQ-FUNC-34191c6f
it("installs only the plugins when Install is chosen without dependencies", async () => {
  await i18n.changeLanguage("en");
  stub({ catalog: view(dependencyCatalog), required: { kicad: false } });
  await render();
  await vi.waitFor(() => expect($('[data-catalog-plugin="kicad"]')).not.toBeNull());
  await click('[data-catalog-plugin="kicad"] [data-action="catalog-install"]');
  await vi.waitFor(() => expect(calls("plugins.catalogInstall")).toHaveLength(1));
  expect(calls("plugins.provision")).toEqual([]);
  expect($("[data-install-result]")).toBeNull();
});
