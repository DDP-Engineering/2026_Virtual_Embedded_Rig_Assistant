// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import userEvent from "@testing-library/user-event";
import type {
  CatalogPack,
  CatalogPlugin,
  PluginCatalogReview,
  PluginCatalogView,
  PluginProgramStatus,
} from "@vera/shared";
import { veraError } from "@vera/shared";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "../api/index.js";
import i18n from "../i18n.js";
import { packPlan } from "./plugin-packs.js";
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
  ecosystem: "arduino",
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
// The Arduino pack as plugins/packs.yaml defines it.
const arduino: CatalogPack = {
  id: "arduino",
  name: "Arduino",
  groups: [
    { name: "Sketches (Arduino CLI)", plugins: ["arduino-cli"], default: true },
    { name: "MicroPython", plugins: ["micropython"], default: true },
    { name: "CircuitPython", plugins: ["circuitpython"], default: true },
    { name: "Bus transactions (I2C, SPI, UART)", plugins: ["bus-tools"], default: true },
    { name: "MQTT telemetry and commands", plugins: ["mqtt-tools"], default: true },
    { name: "BLE devices (GATT)", plugins: ["ble-tools"], default: true },
    { name: "Cloud simulation (Wokwi)", plugins: ["wokwi"], default: false },
    { name: "Raspberry Pi Linux projects", plugins: ["raspberry-pi-linux"], default: false },
  ],
};
const electronics: CatalogPack = {
  id: "electronics",
  name: "Electronics design",
  groups: [
    { name: "Simulation (ngspice)", plugins: ["ngspice"], default: true },
    { name: "Simulation (LTspice, Windows)", plugins: ["ltspice", "ltspice-library"], default: false },
  ],
};
const plugins = [
  entry("arduino-cli", {
    requires: ["serial-monitor"],
    risk: "device-write",
    dependencies: [{ name: "arduino-cli", kind: "download", automatic: true }],
  }),
  entry("serial-monitor"),
  entry("micropython", { requires: ["serial-monitor"], risk: "device-write" }),
  entry("circuitpython", { requires: ["serial-monitor"] }),
  entry("bus-tools"),
  entry("mqtt-tools"),
  entry("ble-tools"),
  entry("wokwi"),
  entry("raspberry-pi-linux"),
  entry("ngspice", { ecosystem: "electronics" }),
  entry("ltspice", { ecosystem: "electronics", platforms: ["windows-x64"] }),
  entry("ltspice-library", { ecosystem: "electronics", requires: ["ltspice"] }),
];
const catalog = (more: Partial<PluginCatalogView> = {}): PluginCatalogView => ({
  source: "bundled",
  plugins,
  packs: [arduino, electronics],
  ...more,
});
const defaults = (pack: CatalogPack) =>
  new Set(pack.groups.filter((group) => group.default).map((group) => group.name));
const ids = (plan: ReturnType<typeof packPlan>) => plan.install.map((item) => item.entry.id);
const arduinoDefaults = [
  "serial-monitor",
  "arduino-cli",
  "micropython",
  "circuitpython",
  "bus-tools",
  "mqtt-tools",
  "ble-tools",
];

// REQ-FUNC-0817ec80
it("plans the default Arduino groups with the required plugins first and skips installed plugins", () => {
  const plan = packPlan(catalog(), arduino, defaults(arduino), "windows-x64");
  expect(ids(plan)).toEqual(arduinoDefaults);
  expect(plan.install[0]?.requiredBy).toBe("arduino-cli");
  expect(plan.install[1]?.requiredBy).toBeUndefined();
  expect(plan.skipped).toEqual([]);
  const some = catalog({
    plugins: plugins.map((plugin) =>
      plugin.id === "serial-monitor" || plugin.id === "bus-tools"
        ? { ...plugin, installed: { tier: "official" as const, version: "1.0.0" } }
        : plugin,
    ),
  });
  const partial = packPlan(some, arduino, defaults(arduino), "windows-x64");
  expect(ids(partial)).toEqual(["arduino-cli", "micropython", "circuitpython", "mqtt-tools", "ble-tools"]);
  expect(partial.installed.map((item) => item.id)).toEqual(["bus-tools"]);
});

// REQ-UX-21440e02
it("leaves out a plugin of another platform, one that requires it and one missing from the catalog", () => {
  const all = new Set(electronics.groups.map((group) => group.name));
  const plan = packPlan(catalog(), electronics, all, "linux-x64");
  expect(ids(plan)).toEqual(["ngspice"]);
  expect(plan.skipped).toEqual([
    { id: "ltspice", name: "Name ltspice", reason: "platform", detail: "windows-x64" },
    { id: "ltspice-library", name: "Name ltspice-library", reason: "requires", detail: "ltspice" },
  ]);
  // Unknown host platform: nothing is skipped for its platform.
  expect(ids(packPlan(catalog(), electronics, all, undefined))).toEqual([
    "ngspice",
    "ltspice",
    "ltspice-library",
  ]);
  const gone = catalog({ plugins: plugins.filter((plugin) => plugin.id !== "ble-tools") });
  expect(packPlan(gone, arduino, defaults(arduino), "windows-x64").skipped).toEqual([
    { id: "ble-tools", name: "ble-tools", reason: "catalog" },
  ]);
});

const reviewOf = (id: string): PluginCatalogReview => ({
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
      summary: `Short ${id}.`,
      description: `About ${id}.`,
      ecosystem: "arduino",
      platforms: ["windows-x64"],
      requires: [],
      programs: {},
      rules: [],
      docs: [],
    },
  },
  id,
  version: "1.0.0",
  tier: "official",
  source: `https://example.com/catalog/${id}-1.0.0.zip`,
  required: true,
});
function stub(options: {
  view?: PluginCatalogView;
  host?: { platform: string; arch: string };
  fail?: string;
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
  vi.mocked(api.invoke).mockImplementation((async (channel: string, request: Record<string, unknown>) => {
    switch (channel) {
      case "plugins.list":
        return [];
      case "plugins.catalog":
        return options.view ?? catalog();
      case "plugins.catalogReview":
        if (request.id === options.fail) throw veraError("OFFLINE");
        return reviewOf(request.id as string);
      case "plugins.catalogInstall":
        return { id: request.id, version: "1.0.0", tier: "official" };
      case "plugins.provision":
        return [{ name: `${request.id}-tool`, kind: "pip", state: "ready" }] satisfies PluginProgramStatus[];
      case "app.settings.get":
        return { settings: { plugins: {} } };
      default:
        throw new Error(`Unexpected ${channel}`);
    }
  }) as never);
}
async function render() {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () => {
    root.render(createElement(QueryClientProvider, { client }, createElement(Plugins, {})));
  });
  await vi.waitFor(() => expect($('[data-catalog-plugin="arduino-cli"]')).not.toBeNull());
}
const $ = (selector: string) => container.querySelector(selector) as HTMLElement;
const $$ = (selector: string) => [...container.querySelectorAll(selector)] as HTMLElement[];
const click = async (selector: string) => {
  await vi.waitFor(() => expect($(selector)).not.toBeNull());
  await act(async () => {
    await userEvent.setup().click($(selector));
  });
};
const calls = (channel: string) =>
  vi
    .mocked(api.invoke)
    .mock.calls.filter(([name]) => name === channel)
    .map(([, request]) => (request as { id: string }).id);

// REQ-UX-5d984350, REQ-FUNC-0817ec80
it.each(["en", "ro", "de"])(
  "installs the Arduino pack with its default groups after one review (%s)",
  async (language) => {
    await i18n.changeLanguage(language);
    stub({});
    await render();
    await click('[data-action="pack-open"]');
    expect(($("[data-pack-select]") as HTMLSelectElement).value).toBe("arduino");
    const checked = (name: string) => ($(`[data-pack-group="${name}"] input`) as HTMLInputElement).checked;
    expect(checked("MicroPython")).toBe(true);
    expect(checked("Cloud simulation (Wokwi)")).toBe(false);
    expect(checked("Raspberry Pi Linux projects")).toBe(false);
    await click('[data-action="pack-review"]');
    expect($("[data-pack-review]").textContent).toContain(
      i18n.t("plugins.packs.reviewTitle", { name: "Arduino" }),
    );
    expect($$("[data-pack-plugin]").map((item) => item.dataset.packPlugin)).toEqual(arduinoDefaults);
    // Each plugin shows its risk and dependencies from the index.
    expect($('[data-pack-plugin="arduino-cli"] [data-catalog-warning="risk"]')).not.toBeNull();
    expect($('[data-pack-plugin="arduino-cli"] [data-dependency="arduino-cli"]')).not.toBeNull();
    expect($('[data-pack-plugin="serial-monitor"]').textContent).toContain(
      i18n.t("plugins.packs.requiredBy", { name: "Name arduino-cli" }),
    );
    expect(calls("plugins.catalogReview")).toEqual([]);
    await click('[data-action="pack-install"]');
    await vi.waitFor(() => expect(calls("plugins.provision")).toHaveLength(arduinoDefaults.length));
    expect($("[data-plugin-review]")).toBeNull();
    expect(calls("plugins.catalogReview")).toEqual(arduinoDefaults);
    expect(calls("plugins.catalogInstall")).toEqual(arduinoDefaults);
    expect(calls("plugins.provision")).toEqual(arduinoDefaults);
    await vi.waitFor(() => expect($$("[data-install-result]")).toHaveLength(arduinoDefaults.length));
    await act(async () => root.unmount());
    container.remove();
  },
);

// REQ-UX-21440e02
it("reports a plugin not available on this platform and installs only the others after Install", async () => {
  await i18n.changeLanguage("en");
  stub({ host: { platform: "linux", arch: "x64" } });
  await render();
  await click('[data-action="pack-open"]');
  const select = $("[data-pack-select]") as HTMLSelectElement;
  await act(async () => userEvent.setup().selectOptions(select, "electronics"));
  expect(($('[data-pack-group="Simulation (LTspice, Windows)"] input') as HTMLInputElement).checked).toBe(
    false,
  );
  await click('[data-pack-group="Simulation (LTspice, Windows)"] input');
  await click('[data-action="pack-review"]');
  expect($$("[data-pack-plugin]").map((item) => item.dataset.packPlugin)).toEqual(["ngspice"]);
  expect($('[data-pack-skipped="ltspice"]').getAttribute("data-reason")).toBe("platform");
  expect($('[data-pack-skipped="ltspice"]').textContent).toContain("windows-x64");
  expect($('[data-pack-skipped="ltspice-library"]').textContent).toContain("ltspice");
  expect($('[data-action="pack-install"]').textContent).toBe(i18n.t("plugins.packs.install", { count: 1 }));
  expect(calls("plugins.catalogInstall")).toEqual([]);
  await click('[data-action="pack-install"]');
  await vi.waitFor(() => expect(calls("plugins.provision")).toEqual(["ngspice"]));
  expect(calls("plugins.catalogReview")).toEqual(["ngspice"]);
  expect(calls("plugins.catalogInstall")).toEqual(["ngspice"]);
});

// REQ-REL-baf16878
it("stops a pack install at the first failure and still installs the programs of the plugins before it", async () => {
  await i18n.changeLanguage("en");
  stub({ fail: "arduino-cli" });
  await render();
  await click('[data-action="pack-open"]');
  await click('[data-action="pack-review"]');
  await click('[data-action="pack-install"]');
  await vi.waitFor(() => expect($('[data-install-result="arduino-cli"] [role="alert"]')).not.toBeNull());
  expect(calls("plugins.catalogReview")).toEqual(["serial-monitor", "arduino-cli"]);
  expect(calls("plugins.catalogInstall")).toEqual(["serial-monitor"]);
  await vi.waitFor(() => expect(calls("plugins.provision")).toEqual(["serial-monitor"]));
});

// REQ-UX-5d984350
it("offers no pack install when the catalog has no packs", async () => {
  await i18n.changeLanguage("en");
  stub({ view: catalog({ packs: [] }) });
  await render();
  expect($('[data-action="pack-open"]')).toBeNull();
});
