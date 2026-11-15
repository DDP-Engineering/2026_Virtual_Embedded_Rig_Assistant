// The panel engineering engine (spec REQ-DATA-a8bf1713) on the cited plant M panel fixture: strict panel files, the
// published heat-balance example and the independent script tests/support/panel_thermal_check.py (tolerance 0.5 %,
// fixed before the run), accessories only when the host lists them, terminals, placement findings, the 24 V budget
// with its cited derating, short-circuit/busbars not evaluated without assembly data and the verification report.
import { readFile } from "node:fs/promises";
import type { ElectricalResult, IndustrialCatalog, Panel } from "@vera/shared";
import { describe, expect, it } from "vitest";
import { parseCatalog } from "./catalog.js";
import { parseModel } from "./model.js";
import {
  analyzePanel,
  draftEquipment,
  effectiveSurface,
  NO_CONFORMITY,
  type PanelCatalog,
  type PanelInput,
  panelBomCsv,
  temperatureRise,
} from "./panel.js";
import { checkPanel, parsePanel } from "./panel-file.js";
import { checkResult } from "./results.js";

const fixtures = new URL("../../../../../tests/fixtures/", import.meta.url);
const read = (path: string) => readFile(new URL(path, fixtures), "utf8");
const near = (actual: number | null | undefined, expected: number) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected) / Math.abs(expected)).toBeLessThan(0.005);
};
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const model = parseModel(await read("motor-drives/plant-m.json"));
const panelText = await read("panel-engineering/pnl-plant-m.json");
const basePanel = parsePanel(panelText, "pnl-plant-m");
const catalogFiles = {
  "cat-panel": parseCatalog(await read("panel-engineering/cat-panel.json"), "cat-panel"),
  "cat-motor-drives": parseCatalog(await read("motor-drives/cat-motor-drives.json"), "cat-motor-drives"),
};
const stamp = (catalog: IndustrialCatalog) => ({
  id: catalog.id,
  version: catalog.version,
  sha256: "0".repeat(64),
  path: `electrical-automation-catalogs/${catalog.id}.json`,
});
/** The assemblies the motor_drives engine returns for the fixture (M1 DOL, M2 star-delta). */
const motorDrives = {
  runId: "20261116-100000-md01",
  catalog: { id: "cat-motor-drives", version: "2026-11-16.1" },
  conditions: {},
  assemblies: [
    {
      motor: "mot-f1",
      circuit: "cir-m1",
      method: "dol",
      conditional: false,
      devices: [
        { tag: "Q1", role: "protection", item: "itm-gv2me10", orderCode: "GV2ME10" },
        { tag: "KM1", role: "line-contactor", item: "itm-lc1d09p7", orderCode: "LC1D09P7" },
      ],
      connections: [
        { from: "supply", to: "Q1", kind: "power" },
        { from: "Q1", to: "KM1", kind: "power" },
        { from: "KM1", to: "motor:U1,V1,W1", kind: "power" },
      ],
      interlocks: [],
    },
    {
      motor: "mot-p2",
      circuit: "cir-m2",
      method: "star-delta",
      conditional: false,
      devices: [
        { tag: "Q1", role: "protection", item: "itm-c10g32", orderCode: "C10G32" },
        { tag: "KM1", role: "line-contactor", item: "itm-lc1d18p7", orderCode: "LC1D18P7" },
        { tag: "KM2", role: "delta-contactor", item: "itm-lc1d18p7", orderCode: "LC1D18P7" },
        { tag: "KM3", role: "star-contactor", item: "itm-lc1d09p7", orderCode: "LC1D09P7" },
        { tag: "KM2-KM3", role: "mechanical-interlock", item: "itm-lad9v2", orderCode: "LAD9V2" },
        { tag: "F1", role: "overload-relay", item: "itm-lrd21", orderCode: "LRD21" },
      ],
      connections: [
        { from: "KM1", to: "F1", kind: "power" },
        { from: "F1", to: "motor:U1,V1,W1", kind: "power" },
        { from: "KM2", to: "motor:W2,U2,V2", kind: "power" },
        { from: "KM3", to: "motor:U2,V2,W2", kind: "power" },
      ],
      interlocks: [],
    },
  ],
} as unknown as ElectricalResult;

function run(
  change: (panel: Panel) => void = () => undefined,
  options: { catalogs?: Record<string, IndustrialCatalog>; network?: ElectricalResult | null } = {},
): ElectricalResult {
  const panel = clone(basePanel);
  change(panel);
  const catalogs = new Map<string, PanelCatalog>(
    Object.values(options.catalogs ?? catalogFiles).map((catalog) => [
      catalog.id,
      { catalog, stamp: stamp(catalog) },
    ]),
  );
  const input: PanelInput = {
    model,
    modelPath: "electrical-automation-model.json",
    modelSha256: "1".repeat(64),
    panel,
    panelPath: "electrical-automation-panels/pnl-plant-m.json",
    panelSha256: "2".repeat(64),
    catalogs,
    motorDrives,
    network: options.network ?? null,
    schematics: [],
    runId: "20261116-120000-pn01",
    now: "2026-11-16T12:00:00Z",
  };
  return analyzePanel(input);
}
const criterion = (result: ElectricalResult, id: string) => result.criteria.find((entry) => entry.id === id);
const value = (result: ElectricalResult, name: string) =>
  result.intermediate.find((entry) => entry.name === name)?.value;
const entry = (panel: Panel, tag: string) =>
  panel.equipment.find((item) => item.tag === tag) as Panel["equipment"][number];

describe("panel file (REQ-DATA-a8bf1713)", () => {
  const raw = () =>
    JSON.parse(panelText) as Record<string, unknown> & { equipment: Record<string, unknown>[] };
  const problems = (value: unknown, id = "pnl-plant-m") => {
    const checked = checkPanel(value, id);
    return "problems" in checked
      ? checked.problems.map((problem) => `${problem.path}: ${problem.message}`)
      : [];
  };
  it("reads the fixture", () => {
    expect(problems(raw())).toEqual([]);
    expect(basePanel.equipment).toHaveLength(15);
  });
  it("refuses unknown keys, other formats, repeated tags, broken references and wrong units", () => {
    expect(problems({ ...raw(), extra: 1 }).join()).toMatch(/Unrecognized key/);
    expect(problems({ ...raw(), format: 2 })[0]).toMatch(/^format/);
    const repeated = raw();
    (repeated.equipment[1] as Record<string, unknown>).tag = "Q1-M1";
    expect(problems(repeated).join()).toContain("tag Q1-M1 repeats");
    const zone = raw();
    (zone.rails as Record<string, unknown>[])[0] = {
      ...(zone.rails as Record<string, unknown>[])[0],
      zone: "Z9",
    };
    expect(problems(zone).join()).toContain("rails[0].zone: zone Z9 does not exist");
    const host = raw();
    (host.equipment[4] as Record<string, unknown>).mountedOn = "KM9";
    expect(problems(host).join()).toContain("equipment[4].mountedOn: equipment KM9 does not exist");
    const supply = raw();
    (supply.equipment[14] as Record<string, unknown>).supply = "G9";
    expect(problems(supply).join()).toContain("equipment[14].supply: equipment G9 does not exist");
    expect(problems(raw(), "pnl-other").join()).toContain("differs from its file name pnl-other.json");
    const unit = raw();
    ((unit.thermal as Record<string, unknown>).ambientTemperatureMax as Record<string, unknown>).unit = "A";
    expect(problems(unit).join()).toContain(
      "thermal.ambientTemperatureMax.unit: unit A is not a unit of temperature",
    );
    expect(() => parsePanel("{", "pnl-plant-m")).toThrow(/^Invalid panel file pnl-plant-m:/);
  });
});

describe("enclosure heat balance (REQ-FUNC-c3a96daf, REQ-TEST-265439fc)", () => {
  it("reproduces the published example: 2000 x 800 x 400 mm against a wall, 800 W, K 5.5", () => {
    const surface = effectiveSurface("wall", 2, 0.8, 0.4);
    near(surface, 4.128);
    near(temperatureRise(800, 5.5, surface), 35.2361);
  });
  it("equals the independent script for the fixture's scenarios", () => {
    const result = run();
    near(value(result, "effectiveSurface"), 0.664);
    near(value(result, "dissipation:idle"), 10.227273);
    near(value(result, "internalTemperature:idle"), 37.800458);
    near(value(result, "dissipation:m1-run"), 21.327273);
    near(value(result, "temperatureRise:m1-run"), 5.839888);
    near(value(result, "internalTemperature:m1-run"), 40.839888);
    expect(criterion(result, "thermal:m1-run")?.verdict).toBe("pass");
    expect(criterion(result, "thermal:m1-run")?.limit).toEqual({ value: 55, unit: "°C" });
    expect(result.limits.join(" ")).toContain("mean air temperature");
  });
  it("adds the fan's airflow, keeps a missing ambient unknown and an undeclared thermal block not evaluated", () => {
    const fanCatalog = clone(catalogFiles["cat-panel"]);
    fanCatalog.families.push({
      id: "fam-test-fan",
      manufacturer: "Test",
      name: "Fictional fan",
      category: "fan",
    });
    fanCatalog.items.push({
      id: "itm-test-fan",
      family: "fam-test-fan",
      orderCode: "TEST-FAN-100",
      parameters: [
        {
          name: "airflow",
          value: 100,
          unit: "m³/h",
          basis: "input",
          source: { id: "src-se-nsys3d6420" },
          status: "confirmed",
        },
      ],
    });
    const fan = run(
      (panel) => {
        (panel.thermal as NonNullable<Panel["thermal"]>).fan = { catalog: "cat-panel", item: "itm-test-fan" };
      },
      { catalogs: { "cat-panel": fanCatalog, "cat-motor-drives": catalogFiles["cat-motor-drives"] } },
    );
    near(value(fan, "temperatureRise:m1-run"), 21.327273 / (5.5 * 0.664 + 100 / 3.1));
    expect(criterion(fan, "thermal:m1-run")?.note).toContain("at least 5 K above");
    const noAmbient = run((panel) => {
      (panel.thermal as NonNullable<Panel["thermal"]>).ambientTemperatureMax.value = null;
    });
    expect(criterion(noAmbient, "thermal:m1-run")?.verdict).toBe("unknown");
    expect(criterion(noAmbient, "thermal:m1-run")?.note).toContain("ambient temperature");
    const none = run((panel) => {
      panel.thermal = null;
    });
    expect(criterion(none, "thermal")?.verdict).toBe("not-evaluated");
    expect(none.criteria.some((entry) => entry.id.startsWith("thermal:"))).toBe(false);
  });
});

describe("dissipation (REQ-FUNC-39b7793a)", () => {
  it("names each active device without a stated loss and never counts it as zero", () => {
    const result = run();
    expect(value(result, "dissipation:full")).toBeNull();
    expect(criterion(result, "dissipation:full")?.note).toMatch(
      /Q1-M2 power loss, F1-M2 power loss, KT1-M2 power loss/,
    );
    expect(criterion(result, "thermal:full")?.verdict).toBe("unknown");
  });
  it("takes the per-pole value of the declared category, else the largest", () => {
    const catalog = clone(catalogFiles["cat-motor-drives"]);
    const item = catalog.items.find(
      (candidate) => candidate.id === "itm-lc1d09p7",
    ) as IndustrialCatalog["items"][number];
    item.parameters.push({
      name: "powerLossPerPole",
      value: 1.56,
      unit: "W",
      basis: "input",
      conditions: { utilisationCategory: { text: "AC-1" } },
      source: { id: "src-se-lc1d09p7", table: "Complementary" },
      status: "confirmed",
    });
    const catalogs = { "cat-panel": catalogFiles["cat-panel"], "cat-motor-drives": catalog };
    expect(
      value(
        run(() => undefined, { catalogs }),
        "loss:KM1-M1",
      ),
    ).toBeCloseTo(0.2 * 3 + 3, 6);
    const largest = run(
      (panel) => {
        delete entry(panel, "KM1-M1").conditions;
      },
      { catalogs },
    );
    expect(value(largest, "loss:KM1-M1")).toBeCloseTo(1.56 * 3 + 3, 6);
  });
});

describe("accessories (REQ-FUNC-cc5f6c3c)", () => {
  it("accepts only accessories the host's item lists, citing the entry", () => {
    const result = run();
    expect(criterion(result, "accessory:plate")?.verdict).toBe("pass");
    expect(criterion(result, "accessory:F1-M2")?.note).toContain("LRD21 product page");
    const other = run((panel) => {
      entry(panel, "F1-M2").mountedOn = "KM3-M2";
    });
    expect(criterion(other, "accessory:F1-M2")?.verdict).toBe("unknown");
    expect(criterion(other, "accessory:F1-M2")?.note).toContain(
      "not established in the catalog and is not assumed",
    );
    const noItem = run((panel) => {
      entry(panel, "F1-M2").item = null;
    });
    expect(criterion(noItem, "accessory:F1-M2")?.verdict).toBe("unknown");
  });
});

describe("terminals (REQ-FUNC-a7c2c1de)", () => {
  it("checks motor terminals, spare and strips without a requirement", () => {
    const result = run();
    expect(criterion(result, "terminals:XM2")?.verdict).toBe("pass");
    expect(criterion(result, "terminals:XM1")?.limit).toEqual({ value: 3, unit: "1" });
    expect(criterion(result, "terminals:X0")?.verdict).toBe("unknown");
    const short = run((panel) => {
      const strip = panel.strips.find((candidate) => candidate.tag === "XM2") as Panel["strips"][number];
      strip.count = 3;
      strip.spare = 0;
    });
    expect(criterion(short, "terminals:XM2")?.verdict).toBe("fail");
    expect(criterion(short, "terminals:XM2")?.note).toContain("3 terminals against 6 motor terminals");
    expect(criterion(short, "terminal-spare:XM2")?.verdict).toBe("fail");
  });
});

describe("placement (REQ-FUNC-0487d376)", () => {
  it("places every entry with known dimensions and flags missing data", () => {
    const result = run();
    const placed = result.panel?.placements
      .filter((entry) => entry.state === "placed")
      .map((entry) => entry.tag);
    expect(placed).toEqual(["Q1-M1", "KM1-M1", "KM1-M2", "KM3-M2", "G1", "A1", "X0", "X1", "XM1", "XM2"]);
    expect(result.panel?.placements.find((entry) => entry.tag === "KM1-M2")).toMatchObject({
      x: 10,
      y: 191.5,
      width: 45,
      height: 143,
    });
    expect(criterion(result, "placement:KT1-M2")?.verdict).toBe("unknown");
    expect(criterion(result, "placement:KM2-M2")?.note).toContain("KM2-KM3-M2 width");
    expect(criterion(result, "segregation:SEG1")?.measured).toEqual({ value: 53.7, unit: "mm" });
    expect(criterion(result, "reserve-rails")?.verdict).toBe("unknown");
  });
  it("fails collisions, ducts, depth, zones, segregation and the rail reserve", () => {
    const pinned = run((panel) => {
      Object.assign(entry(panel, "Q1-M1"), { x: 0 });
      Object.assign(entry(panel, "KM1-M1"), { x: 20 });
    });
    expect(criterion(pinned, "placement:Q1-M1")?.note).toContain("overlaps KM1-M1");
    expect(criterion(pinned, "placement:KM1-M1")?.note).toContain("overlaps Q1-M1");
    const duct = run((panel) => {
      (panel.rails[0] as Panel["rails"][number]).y = 150;
    });
    expect(criterion(duct, "placement:Q1-M1")?.note).toContain("overlaps duct D1");
    const depth = run((panel) => {
      panel.enclosure.mountingDepth = 100;
    });
    expect(criterion(depth, "placement:G1")?.note).toContain("exceeds the mounting depth 100 mm");
    const zone = run((panel) => {
      entry(panel, "A1").rail = "R1";
    });
    expect(criterion(zone, "placement:A1")?.note).toContain("zone Z1 does not accept class selv");
    const segregation = run((panel) => {
      Object.assign(panel.rules[0] as object, { distance: 60 });
    });
    expect(criterion(segregation, "segregation:SEG1")?.verdict).toBe("fail");
    const full = run((panel) => {
      panel.equipment = panel.equipment.filter((item) => item.motor !== "mot-p2");
      panel.strips = panel.strips.filter((strip) => strip.motor !== "mot-p2");
      panel.scenarios = [{ tag: "full", title: "Everything" }];
      panel.reserve.railPercent = 90;
    });
    expect(criterion(full, "layout")?.verdict).toBe("pass");
    expect(criterion(full, "reserve-rails")?.verdict).toBe("fail");
  });
});

describe("24 V supply (REQ-FUNC-4017a1ee)", () => {
  it("budgets the PLC against the output current less the reserve", () => {
    const result = run();
    expect(criterion(result, "supply:G1:idle")).toMatchObject({
      verdict: "pass",
      measured: { value: 0.191667, unit: "A" },
      limit: { value: 4, unit: "A" },
    });
  });
  it("derates by the cited factor above 50 °C, is unknown above 70 °C or without consumption", () => {
    const hot = run((panel) => {
      (panel.thermal as NonNullable<Panel["thermal"]>).ambientTemperatureMax.value = 54;
    });
    const ti = value(hot, "internalTemperature:m1-run") as number;
    near(value(hot, "supplyAvailable:G1:m1-run"), 5 * (1 - 0.025 * (ti - 50)) * 0.8);
    expect(criterion(hot, "supply:G1:m1-run")?.note).toContain("derated by 2.5 % per K above 50 °C");
    const above = run((panel) => {
      (panel.thermal as NonNullable<Panel["thermal"]>).ambientTemperatureMax.value = 70;
    });
    expect(criterion(above, "supply:G1:idle")?.verdict).toBe("unknown");
    expect(criterion(above, "thermal:idle")?.verdict).toBe("fail");
    const unknown = run((panel) => {
      entry(panel, "A1").conditions = { expansion: { text: "partial" } };
    });
    expect(criterion(unknown, "supply:G1:idle")?.note).toContain("no stated consumption for A1");
  });
});

describe("short-circuit, busbars and the verification report (REQ-FUNC-865665b6, REQ-FUNC-f761244d)", () => {
  const network = {
    runId: "20261116-090000-nw01",
    intermediate: [{ name: "ik3Max", subject: "brd-main", value: 12.5, unit: "kA" }],
  } as unknown as ElectricalResult;
  it("evaluates a declared rating only, never busbars", () => {
    const result = run();
    expect(criterion(result, "short-circuit-withstand")?.verdict).toBe("not-evaluated");
    expect(criterion(result, "busbars")?.verdict).toBe("not-evaluated");
    const rated = (kA: number) =>
      run(
        (panel) => {
          panel.assembly.shortCircuitRating = { value: kA, unit: "kA", basis: "input" };
        },
        { network },
      );
    expect(criterion(rated(10), "short-circuit-withstand")?.verdict).toBe("fail");
    expect(criterion(rated(15), "short-circuit-withstand")).toMatchObject({
      verdict: "pass",
      measured: { value: 12.5, unit: "kA" },
      limit: { value: 15, unit: "kA" },
    });
    expect(criterion(rated(15), "busbars")?.verdict).toBe("not-evaluated");
  });
  it("lists the characteristics with evidence and claims no conformity", () => {
    const result = run();
    const report = result.panel?.verification ?? [];
    expect(report).toHaveLength(13);
    expect(report.filter((entry) => entry.state === "partial").map((entry) => entry.characteristic)).toEqual([
      "incorporation of switching devices and components",
      "terminals for external conductors",
      "temperature-rise limits",
    ]);
    expect(report.find((entry) => entry.characteristic === "temperature-rise limits")?.evidence).toContain(
      "thermal:m1-run",
    );
    expect(result.limits).toContain(NO_CONFORMITY);
    expect(JSON.stringify(result)).not.toMatch(/compliant|conforms to IEC 61439/i);
    expect(result.status).toBe("incomplete");
    expect(result.preliminary).toBe(true);
    expect("result" in checkResult(result, result.runId)).toBe(true);
  });
});

describe("review fixes (round 1)", () => {
  it("refuses a heat-transfer coefficient of 0 and a mounted accessory on a door device", () => {
    const zero = JSON.parse(panelText) as { thermal: { heatTransferCoefficient: { value: number } } };
    zero.thermal.heatTransferCoefficient.value = 0;
    const checked = checkPanel(zero, "pnl-plant-m");
    expect("problems" in checked && checked.problems.map((p) => p.path)).toContain(
      "thermal.heatTransferCoefficient.value",
    );
    const door = JSON.parse(panelText) as { equipment: Record<string, unknown>[] };
    (door.equipment[4] as Record<string, unknown>).mountedOn = "S0-M1";
    const doorChecked = checkPanel(door, "pnl-plant-m");
    expect("problems" in doorChecked && doorChecked.problems.map((p) => p.message)).toContain(
      "a mounted equipment and its host are on the plate",
    );
  });
  it("needs the coil loss of an item with a control voltage and accepts a consumer's stated current", () => {
    const catalog = clone(catalogFiles["cat-motor-drives"]);
    const item = catalog.items.find(
      (candidate) => candidate.id === "itm-lc1d09p7",
    ) as IndustrialCatalog["items"][number];
    item.parameters = item.parameters.filter((parameter) => parameter.name !== "coilPowerLoss");
    const catalogs = { "cat-panel": catalogFiles["cat-panel"], "cat-motor-drives": catalog };
    const noCoil = run(() => undefined, { catalogs });
    expect(value(noCoil, "dissipation:m1-run")).toBeNull();
    expect(criterion(noCoil, "dissipation:m1-run")?.note).toContain("KM1-M1 coil loss");
    const current = run((panel) => {
      const plc = entry(panel, "A1");
      plc.item = null;
      plc.declared = {
        current: { value: 0.5, unit: "A", basis: "input" },
        ambientTemperatureMax: { value: 55, unit: "°C", basis: "input" },
      };
      delete plc.rail;
      plc.location = "field";
    });
    expect(criterion(current, "supply:G1:idle")?.measured).toEqual({ value: 0.5, unit: "A" });
  });
  it("keeps labels from files plain and short in notes", async () => {
    const { readQetProject } = await import("./qet.js");
    const qet = await readFile(new URL("qelectrotech/dol.generated.qet", fixtures), "utf8");
    const project = readQetProject(qet, "dol.qet");
    const device = project.devices.find((candidate) => candidate.label === "S1");
    if (device) device.label = `S1\t${"x".repeat(300)}`;
    const panel = clone(basePanel);
    const catalogs = new Map<string, PanelCatalog>(
      Object.values(catalogFiles).map((catalog) => [catalog.id, { catalog, stamp: stamp(catalog) }]),
    );
    const result = analyzePanel({
      model,
      modelPath: "electrical-automation-model.json",
      modelSha256: "1".repeat(64),
      panel,
      panelPath: "electrical-automation-panels/pnl-plant-m.json",
      panelSha256: "2".repeat(64),
      catalogs,
      motorDrives,
      network: null,
      schematics: [{ path: "schematics/m1.qet", sha256: "3".repeat(64), motor: "mot-f1", project }],
      runId: "20261116-120000-pn02",
      now: "2026-11-16T12:00:00Z",
    });
    const note = criterion(result, "schematic:schematics/m1.qet")?.note ?? "";
    expect(note).toMatch(/Drawn but not in the panel: .*S1 x{50,58}…/);
    expect(note).not.toMatch(/\t/);
    expect("result" in checkResult(result, result.runId)).toBe(true);
  });
  it("guards CSV cells against formulas and drafts the same tags for one motor or all", () => {
    const result = run((panel) => {
      entry(panel, "Q1-M1").role = "=HYPERLINK(1)";
    });
    expect(panelBomCsv(result)).toContain("Q1-M1,equipment,'=HYPERLINK(1),");
    const catalog = catalogFiles["cat-motor-drives"];
    const one = draftEquipment(motorDrives, model, catalog, ["mot-f1"]).map((item) => item.tag);
    expect(one).toEqual(["Q1-M1", "KM1-M1"]);
  });
});
