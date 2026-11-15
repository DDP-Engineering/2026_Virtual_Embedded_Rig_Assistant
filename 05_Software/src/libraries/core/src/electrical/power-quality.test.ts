// The power factor correction engine (spec REQ-DATA-4dc5e2c7): the guide's worked examples and hand calculations
// with tolerances fixed before the comparison, then the fictional plant Q with its fictional measurement day and the
// cited PFC catalog. Synthetic values (a pairing table, small profiles) are added in memory with a fictional source.
import { readFile } from "node:fs/promises";
import type { ElectricalModel, ElectricalResult, IndustrialCatalog } from "@vera/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCableTable } from "./cable-table.js";
import { type CatalogStamp, parseCatalog } from "./catalog.js";
import { type MeasurementSeries, parseMeasurements } from "./measurements.js";
import { parseModel } from "./model.js";
import { analyzeNetwork } from "./network.js";
import {
  analyzePowerQuality,
  capacitorCurrentRatio,
  compensationNeed,
  displacementFactor,
  powerFactorAfter,
  powerQualityRequestSchema,
  resonanceOrder,
  stepCurrent,
} from "./power-quality.js";

// Tolerances fixed before the comparison (journal TASK-b30a9859): guide examples 1 % (resonance 5 %), hand
// calculations 0.5 %.
const within = (actual: number, expected: number, share: number) =>
  expect(Math.abs(actual - expected) / Math.abs(expected)).toBeLessThanOrEqual(share);

it("matches the guide's compensation examples (EIG Fig. L16 simplified method) within 1 %", () => {
  // 666 kVA at cos 0.75 -> 500 kW; to 0.93 the guide reads 0.487 kvar/kW, i.e. 244 kvar.
  const p = 666 * 0.75;
  const q1 = Math.sqrt(666 ** 2 - p ** 2);
  within(compensationNeed(p, q1, 0.93), 244, 0.01);
  within(compensationNeed(1, Math.tan(Math.acos(0.8)), 0.93), 0.355, 0.01);
  expect(compensationNeed(100, 30, 0.93)).toBe(0); // already above the target
  expect(compensationNeed(100, -20, 0.93)).toBe(0); // leading
});

it("matches the guide's resonance example within 5 % and lowers the order with detuning", () => {
  // Ssc ~10 MVA, Q 350 kvar: the guide gives h0 = 5.5 (sqrt(10000/350) = 5.35).
  within(resonanceOrder(10_000, 350, 0), 5.5, 0.05);
  // A 7 % detuned bank: the order stays below 1/sqrt(0.07) = 3.78.
  expect(resonanceOrder(10_000, 350, 0.07)).toBeLessThan(1 / Math.sqrt(0.07));
  within(resonanceOrder(10_000, 350, 0.07), 1 / Math.sqrt(0.07 + 0.035), 0.005);
});

it("matches the guide's capacitor protection examples (EIG, Implementation of capacitor banks) within 1 %", () => {
  const inominal = stepCurrent(50, 400);
  within(inominal, 72, 0.01);
  within(1.5 * inominal, 108, 0.01); // standard capacitors, IMP/IN 1.5
  within(1.31 * inominal, 94, 0.01); // capacitors + 5.7 % reactor
  within(10 * inominal, 720, 0.01); // short-time setting
});

it("separates displacement and total power factor under distortion (hand calculation, 0.5 %)", () => {
  // DPF 0.9 lagging with THDi 40 % and a sinusoidal voltage: lambda = 0.9 / sqrt(1.16) = 0.8356.
  const p = 90;
  const q1 = Math.sqrt(100 ** 2 - 90 ** 2);
  within(displacementFactor(p, q1), 0.9, 0.005);
  const d2 = (p ** 2 + q1 ** 2) * 0.4 ** 2;
  within(powerFactorAfter(p, q1, d2).total as number, 0.8356, 0.005);
  // Compensating Q1 fully leaves the distortion: DPF 1, lambda = 90 / sqrt(90^2 + d2) = 0.9138.
  const after = powerFactorAfter(p, 0, d2);
  expect(after.displacement).toBe(1);
  within(after.total as number, 90 / Math.sqrt(90 ** 2 + d2), 0.005);
  expect(after.total as number).toBeLessThan(1);
  expect(powerFactorAfter(p, -10, null)).toMatchObject({ character: "leading", total: null });
});

it("raises the capacitor current with the harmonic voltages and the capacitance tolerance (hand calculation)", () => {
  // 480 V capacitor at 400 V, +10 % capacitance, u5 = 3 %, u7 = 2 %: 0.8333 * 1.1 * sqrt(1 + 0.15^2 + 0.14^2).
  const harmonics = new Map([
    [5, 0.03],
    [7, 0.02],
  ]);
  within(
    capacitorCurrentRatio(400, 480, 0.1, harmonics),
    (400 / 480) * 1.1 * Math.sqrt(1 + 0.0225 + 0.0196),
    0.005,
  );
});

// ---- the engine on fictional plant Q, its fictional measurement day and the cited PFC catalog -------------------
const fixtures = new URL("../../../../../tests/fixtures/", import.meta.url);
let model: ElectricalModel;
let network: ElectricalResult;
let catalog: IndustrialCatalog;
let series: MeasurementSeries;
const stamp: CatalogStamp = { id: "cat-pfc", version: "2026-11-15.1", sha256: "c".repeat(64), path: "c" };
const measurementStamp = (file: MeasurementSeries) => ({
  id: file.file.id,
  sha256: "d".repeat(64),
  path: "m",
  rows: file.times.length,
  origin: file.file.origin,
});

beforeAll(async () => {
  model = parseModel(await readFile(new URL("power-quality-pfc/plant-q.json", fixtures), "utf8"));
  const table = parseCableTable(
    await readFile(new URL("electrical-network/tbl-test-cu-pvc.json", fixtures), "utf8"),
    "tbl-test-cu-pvc",
  );
  network = analyzeNetwork({
    model,
    modelPath: "electrical-automation-model.json",
    modelSha256: "0".repeat(64),
    table,
    tableStamp: { id: table.id, version: table.version, sha256: "a".repeat(64), path: "t" },
    request: {
      cableTable: "tbl-test-cu-pvc",
      voltageTolerance: 10,
      scenarios: [
        { id: "day", title: "Day shift" },
        {
          id: "night",
          title: "Night",
          loads: { "lod-m1": 0.15, "lod-m2": 0.15, "lod-m3": 0.15, "lod-v1": 0.2, "lod-l1": 0.3 },
        },
      ],
      voltageDropLimit: { value: 4, unit: "%" },
    },
    runId: "20261115-100000-aaaa",
    now: "2026-11-15T10:00:00Z",
  });
  catalog = parseCatalog(
    await readFile(new URL("power-quality-pfc/cat-pfc.json", fixtures), "utf8"),
    "cat-pfc",
  );
  series = parseMeasurements(
    await readFile(new URL("power-quality-pfc/meas-fictional-mdb-day.json", fixtures), "utf8"),
    await readFile(new URL("power-quality-pfc/meas-fictional-mdb-day.csv", fixtures), "utf8"),
    "meas-fictional-mdb-day",
  );
});

const FULL = {
  board: "brd-main",
  network: "20261115-100000-aaaa",
  measurements: "meas-fictional-mdb-day",
  catalog: "cat-pfc",
  targetPowerFactor: 0.95,
  totalPowerFactorMin: 0.9,
  voltageTolerance: 10,
  resonanceMargin: 0.1,
  harmonicThreshold: 0.5,
  maxSteps: 12,
  harmonicGeneratorPower: 43,
  steps: [
    { capacitor: "itm-blrch125a150b48" },
    { capacitor: "itm-blrch125a150b48", reactor: "itm-lvr07125a40t" },
  ],
  contactor: "itm-lc1dfkp7",
  protection: "itm-c10g32",
};
interface Options {
  network?: ElectricalResult | null;
  series?: MeasurementSeries | null;
  catalog?: IndustrialCatalog | null;
}
const run = (raw: Record<string, unknown>, options: Options = {}) => {
  const measured = options.series === undefined ? series : options.series;
  const chosen = options.catalog === undefined ? catalog : options.catalog;
  return analyzePowerQuality({
    model,
    modelPath: "electrical-automation-model.json",
    modelSha256: "0".repeat(64),
    network: options.network === undefined ? network : options.network,
    measurements: measured ? { series: measured, stamp: measurementStamp(measured) } : null,
    catalog: chosen,
    catalogStamp: chosen ? stamp : null,
    request: powerQualityRequestSchema.parse(raw),
    runId: "20261115-110000-bbbb",
    now: "2026-11-15T11:00:00Z",
  });
};
const criterion = (result: ElectricalResult, id: string) => {
  const found = result.criteria.find((entry) => entry.id === id);
  if (!found) throw Error(`no criterion ${id}: ${result.criteria.map((entry) => entry.id).join(", ")}`);
  return found;
};
const amountOf = (result: ElectricalResult, name: string) =>
  result.intermediate.find((entry) => entry.name === name)?.value;
const PLAIN = "BLRCH125A150B48";
const DETUNED = "BLRCH125A150B48+LVR07125A40T";
const fictional = (name: string, value: number, unit: string, conditions?: Record<string, unknown>) => ({
  name,
  value,
  unit,
  basis: "input" as const,
  ...(conditions ? { conditions } : {}),
  source: { id: "src-fictional-pair" },
  status: "confirmed" as const,
});
/** A fictional detuned-step table for the capacitor and the reactor (no public pairing table was found). */
const withPairTable = (third = 1): IndustrialCatalog =>
  ({
    ...catalog,
    sources: [
      ...catalog.sources,
      {
        id: "src-fictional-pair",
        kind: "other",
        title: "Fictional pairing table for the tests",
        license: "CC0-1.0",
      },
    ],
    coordination: [
      {
        id: "tbl-fictional-detuned",
        title: "Fictional detuned steps",
        kind: "detuned step",
        conditions: { voltage: { value: 400, unit: "V" }, frequency: { value: 50, unit: "Hz" } },
        entries: [
          {
            items: ["itm-blrch125a150b48", "itm-lvr07125a40t"],
            parameters: [
              fictional("reactivePower", 6.25, "kvar"),
              fictional("tuningFactor", 7, "%"),
              fictional("overcurrentRatio", 1.19, "1"),
              fictional("thdVoltageMax", 8, "%"),
              ...[
                [3, third],
                [5, 6],
                [7, 4],
                [11, 3.5],
                [13, 3],
              ].map(([order, limit]) =>
                fictional("harmonicVoltageMax", limit as number, "%", {
                  harmonicOrder: { value: order, unit: "1" },
                }),
              ),
            ],
          },
        ],
      },
    ],
  }) as IndustrialCatalog;

/** The catalog with a fictional capacitor of `kvar` at 400 V 50 Hz (heavy-duty, 480 V, 1.8 In, +10 %). */
const withSmallStep = (kvar: number): IndustrialCatalog =>
  ({
    ...catalog,
    sources: [
      ...catalog.sources,
      {
        id: "src-fictional-pair",
        kind: "other",
        title: "Fictional values for the tests",
        license: "CC0-1.0",
      },
    ],
    items: [
      ...catalog.items,
      {
        id: "itm-fict-small",
        family: "fam-varplus-can-hduty",
        orderCode: "FICT-SMALL",
        attributes: { duty: "heavy-duty" },
        parameters: [
          fictional("reactivePower", kvar, "kvar", {
            voltage: { value: 400, unit: "V" },
            frequency: { value: 50, unit: "Hz" },
          }),
          fictional("ratedVoltage", 480, "V"),
          fictional("overcurrentRatio", 1.8, "1"),
          fictional("capacitanceToleranceMax", 10, "%"),
        ],
      },
    ],
  }) as IndustrialCatalog;

describe("the fixture plant", () => {
  it("separates network and measured scenarios and proposes an automatic bank because the night load is small", () => {
    const result = run(FULL);
    expect(result.producer).toMatchObject({ plugin: "power-quality-pfc", operation: "pfc" });
    // Network day: P = 90 + 30 + 10 = 130 kW, Q = 90 x 0.75 + 40 x tan(acos 0.95) = 80.65 kvar.
    const dayQ = 67.5 + 40 * Math.tan(Math.acos(0.95));
    expect(amountOf(result, "activePower:day")).toBeCloseTo(130, 3);
    expect(amountOf(result, "reactivePower:day")).toBeCloseTo(dayQ, 3);
    expect(amountOf(result, "compensationNeed:day")).toBeCloseTo(compensationNeed(130, dayQ, 0.95), 2);
    expect(amountOf(result, "totalPowerFactor:day")).toBeNull(); // the network model has no harmonics
    expect(amountOf(result, "totalPowerFactor:measured-peak")).toBeLessThan(
      amountOf(result, "displacementFactor:measured-peak") as number,
    );
    expect(criterion(result, "fixed-bank").verdict).toBe("fail");
    expect(criterion(result, "fixed-bank").note).toMatch(/capacitive \(overcompensation\)/);
    expect(criterion(result, "fixed-share").verdict).toBe("pass");
    expect(result.conditions.bankType).toEqual({ text: "automatic" });
    // 12.5 kvar at 480 V delivers 12.5 x (400/480)^2 = 8.68 kvar at 400 V.
    expect(amountOf(result, `stepOutput:${PLAIN}`)).toBeCloseTo(8.6806, 3);
    for (const name of [
      "step-size",
      "step-count",
      "capacitor-voltage",
      "harmonic-duty",
      "non-linear-share",
      "configuration",
      "contactor",
      "protection",
    ])
      expect(criterion(result, `${name}:${PLAIN}`).verdict, name).toBe("pass");
    // IMP = 1.8 x 8.68 / (sqrt(3) x 0.4) = 22.55 A <= 32 A.
    expect(amountOf(result, `permissibleCurrent:${PLAIN}`)).toBeCloseTo(1.8 * stepCurrent(8.6806, 400), 2);
    expect(criterion(result, `inrush:${PLAIN}`).verdict).toBe("not-evaluated");
    // The plain bank resonates near the measured 17th (h = sqrt(Ssc / (n x 8.68))).
    expect(criterion(result, `resonance:${PLAIN}`).verdict).toBe("fail");
    expect(criterion(result, `resonance:${PLAIN}`).note).toMatch(/order 17/);
    expect(criterion(result, `step:${PLAIN}`).verdict).toBe("fail");
    // No cited pairing table: the detuned candidate stays open, so the proposal is conditional.
    expect(criterion(result, `step-combination:${DETUNED}`).verdict).toBe("unknown");
    expect(criterion(result, "proposal").verdict).toBe("unknown");
    expect(result.status).toBe("incomplete");
    expect(result.messages[0]).toMatch(/FICTIONAL/);
    expect(result.conditions.measurements).toMatchObject({
      text: expect.stringMatching(/origin fictional rows 96/),
    });
    expect(result.sources.join("\n")).toMatch(/BLRCH125A150B48 product page/);
    expect(result.limits.join("\n")).toMatch(/not batteries or UPS/);
    expect(JSON.stringify(result)).not.toMatch(/"setting"/);
  });

  it("accepts a detuned step only through a cited table entry and then proposes it", () => {
    const result = run(FULL, { catalog: withPairTable() });
    expect(criterion(result, `step-combination:${DETUNED}`).verdict).toBe("pass");
    expect(amountOf(result, `stepOutput:${DETUNED}`)).toBe(6.25);
    // 480 V >= 440 V / (1 - 0.07) = 473 V.
    expect(criterion(result, `capacitor-voltage:${DETUNED}`)).toMatchObject({
      verdict: "pass",
      limit: { value: 473.118 },
    });
    expect(criterion(result, `harmonic-duty:${DETUNED}`).verdict).toBe("pass");
    expect(criterion(result, `resonance:${DETUNED}`).verdict).toBe("pass");
    expect(criterion(result, `step:${DETUNED}`).verdict).toBe("pass");
    expect(criterion(result, "proposal").verdict).toBe("pass");
    expect(result.conditions.step).toEqual({ text: DETUNED });
    const logic = (result.conditions.controlLogic as { text: string }).text;
    expect(logic).toMatch(/^Proposal, not a setting: DPF 0.95 lag; 7 x 6.25 kvar equal steps/);
    expect(logic).toMatch(/reconnect only after discharge time\.$/);
    expect(logic.length).toBeLessThanOrEqual(200);
    expect(result.limits.join("\n")).toMatch(/discharge to 75 V within 3 min/);
    expect(criterion(result, "target:measured").verdict).toBe("pass");
    expect(criterion(result, "total-power-factor:measured").verdict).toBe("pass");
    expect(criterion(result, "total-power-factor:day").verdict).toBe("unknown");
    // A stricter fictional 3rd-harmonic limit than the measured 0.6 % fails the combination.
    expect(criterion(run(FULL, { catalog: withPairTable(0.5) }), `harmonic-duty:${DETUNED}`).verdict).toBe(
      "fail",
    );
  });

  it("fails a step that is too coarse, too many steps, an undersized contactor and fuse", () => {
    const coarse = run({
      ...FULL,
      steps: [{ capacitor: "itm-blrch125a150b48", units: 3 }],
      maxSteps: 1,
      protection: "itm-c10g20",
    });
    const key = `${PLAIN}x3`;
    expect(amountOf(coarse, `stepOutput:${key}`)).toBeCloseTo(26.04, 2);
    expect(criterion(coarse, `step-size:${key}`).verdict).toBe("fail");
    expect(criterion(coarse, `step-size:${key}`).note).toMatch(/choose a smaller step/);
    expect(criterion(coarse, `step-count:${key}`).verdict).toBe("fail");
    expect(criterion(coarse, `contactor:${key}`).verdict).toBe("fail"); // 12.5 kvar < 26 kvar
    expect(criterion(coarse, `protection:${key}`).verdict).toBe("fail"); // 20 A < 1.8 x 37.6 A
    expect(criterion(coarse, "proposal").verdict).toBe("fail");
  });

  it("limits the verdicts without network data, margin or harmonic data", () => {
    const alone = run(FULL, { network: null });
    expect(criterion(alone, `resonance:${PLAIN}`)).toMatchObject({
      verdict: "unknown",
      note: expect.stringMatching(/fault level/),
    });
    expect(criterion(alone, `configuration:${PLAIN}`).verdict).toBe("unknown");
    expect(amountOf(alone, "activePower:day")).toBeUndefined();
    const noMargin = run({ ...FULL, resonanceMargin: undefined });
    expect(criterion(noMargin, `resonance:${PLAIN}`).note).toMatch(/resonanceMargin is not stated/);
    const networkOnly = run(FULL, { series: null });
    expect(criterion(networkOnly, `harmonic-duty:${PLAIN}`).verdict).toBe("unknown");
    // Without a measurement file nor a source frequency the step output stays unknown.
    expect(amountOf(networkOnly, `stepOutput:${PLAIN}`)).toBeNull();
    expect(criterion(networkOnly, `resonance:${PLAIN}`).verdict).toBe("unknown");
    const noTolerance = run({ ...FULL, voltageTolerance: undefined });
    expect(criterion(noTolerance, `capacitor-voltage:${PLAIN}`).verdict).toBe("unknown");
    for (const limited of [alone, noMargin, networkOnly]) expect(limited.status).toBe("incomplete");
  });

  it("checks every bank state for resonance and bounds the states", () => {
    // A fictional 2 kvar step: ceil(39 / 2) = 20 states; state 20 resonates at sqrt(11200 / 40) = 16.7, near the 17th.
    const many = run({ ...FULL, steps: [{ capacitor: "itm-fict-small" }] }, { catalog: withSmallStep(2) });
    expect(amountOf(many, "steps:FICT-SMALL")).toBe(20);
    expect(criterion(many, "resonance:FICT-SMALL").note).toMatch(
      /20 step\(s\): h 16.7 near measured order 17/,
    );
    const huge = run(
      { ...FULL, steps: [{ capacitor: "itm-fict-small" }] },
      { catalog: withSmallStep(0.001) },
    );
    expect(criterion(huge, "resonance:FICT-SMALL")).toMatchObject({
      verdict: "unknown",
      note: expect.stringMatching(/more than 64 states are not evaluated/),
    });
  });

  it("classifies a heavily distorted installation as needing a filter and designs none", () => {
    const result = run({ ...FULL, harmonicGeneratorPower: 2000 });
    expect(criterion(result, `configuration:${PLAIN}`)).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/designs no filter/),
    });
    expect(criterion(result, `configuration:${DETUNED}`).verdict).toBe("fail");
    const unstated = run({ ...FULL, harmonicGeneratorPower: undefined });
    expect(criterion(unstated, `configuration:${PLAIN}`).verdict).toBe("unknown");
  });
});

describe("conventions and scenarios", () => {
  const file = (
    conventions: Record<string, string>,
    data: unknown[][],
    extra: Record<string, unknown>[] = [],
  ) =>
    parseMeasurements(
      JSON.stringify({
        kind: "vera-power-measurements",
        format: 1,
        id: "meas-test",
        title: "t",
        origin: "fictional",
        source: { title: "t", license: "CC0-1.0" },
        board: "brd-main",
        interval: { value: 1, unit: "h" },
        conventions: {
          power: "load",
          reactive: "fundamental",
          reactiveSign: "inductive-positive",
          powerFactor: "unsigned",
          ...conventions,
        },
        nominalVoltage: { value: 400, unit: "V" },
        frequency: { value: 50, unit: "Hz" },
        columns: [
          { name: "time", quantity: "time" },
          { name: "P", quantity: "activePower", unit: "kW" },
          { name: "Q", quantity: "reactivePower", unit: "kvar" },
          ...extra,
        ],
        rows: data,
      }),
      undefined,
      "meas-test",
    );
  const t = (hour: number) => `2026-11-02T${String(hour).padStart(2, "0")}:00:00Z`;
  const BASIC = { board: "brd-main", targetPowerFactor: 0.95 };

  it("converts generator and capacitive-positive data to the load convention", () => {
    const load = run(BASIC, { network: null, series: file({}, [[t(1), 100, 60]]) });
    const generator = run(BASIC, {
      network: null,
      series: file({ power: "generator" }, [[t(1), -100, -60]]),
    });
    const capacitive = run(BASIC, {
      network: null,
      series: file({ reactiveSign: "capacitive-positive" }, [[t(1), 100, -60]]),
    });
    for (const result of [load, generator, capacitive]) {
      expect(amountOf(result, "reactivePower:measured-peak")).toBe(60);
      expect(amountOf(result, "displacementFactor:measured-peak")).toBeCloseTo(100 / Math.hypot(100, 60), 5);
    }
    const leading = run(BASIC, { network: null, series: file({}, [[t(1), 100, -20]]) });
    expect(amountOf(leading, "displacementFactor:measured-peak")).toBeLessThan(0); // leading is reported negative
    expect(amountOf(leading, "compensationNeed:measured-peak")).toBe(0);
  });

  it("uses a displacement-factor column for nonactive Q and blocks an undetermined profile", () => {
    const dpf = run(BASIC, {
      network: null,
      series: file(
        { reactive: "nonactive", powerFactor: "lead-negative" },
        [[t(1), 100, 80, 0.8]],
        [{ name: "DPF", quantity: "displacementFactor", unit: "1" }],
      ),
    });
    expect(amountOf(dpf, "reactivePower:measured-peak")).toBeCloseTo(75, 5); // 100 x tan(acos 0.8)
    // A generator-convention meter: P -100 and a lagging (positive) DPF in its own frame is a leading load.
    const generator = run(BASIC, {
      network: null,
      series: file(
        { power: "generator", reactive: "nonactive", powerFactor: "lead-negative" },
        [[t(1), -100, 80, 0.8]],
        [{ name: "DPF", quantity: "displacementFactor", unit: "1" }],
      ),
    });
    expect(amountOf(generator, "reactivePower:measured-peak")).toBeCloseTo(-75, 5);
    const blocked = run(BASIC, { network: null, series: file({ reactive: "nonactive" }, [[t(1), 100, 80]]) });
    expect(blocked.status).toBe("blocked");
    expect(blocked.messages.join("\n")).toMatch(/displacement-factor column/);
  });

  it("counts export intervals and approximates the total power factor from THDi", () => {
    const result = run(BASIC, {
      network: null,
      series: file(
        {},
        [
          [t(1), -5, 1, null],
          [t(2), 90, Math.sqrt(100 ** 2 - 90 ** 2), 40],
        ],
        [{ name: "THDi", quantity: "thdCurrent", unit: "%" }],
      ),
    });
    expect(amountOf(result, "measuredSkipped")).toBe(1);
    expect(result.messages.join("\n")).toMatch(/1 measured intervals with P <= 0/);
    within(amountOf(result, "totalPowerFactor:measured-peak") as number, 0.8356, 0.005);
    expect(result.messages.join("\n")).toMatch(/approximated as DPF \/ sqrt\(1 \+ THDi²\)/);
  });

  it("leaves resonance unknown without harmonic columns or above the measured orders", () => {
    const rowsDay = [
      [t(1), 100, 60, 1],
      [t(2), 101, 61, 1],
    ];
    const step = { catalog: "cat-pfc", steps: [{ capacitor: "itm-blrch125a150b48" }], resonanceMargin: 0.1 };
    const bare = run(
      { ...BASIC, ...step },
      {
        series: file(
          {},
          rowsDay.map((row) => row.slice(0, 3)),
        ),
      },
    );
    expect(criterion(bare, `resonance:${PLAIN}`)).toMatchObject({
      verdict: "unknown",
      note: expect.stringMatching(/no harmonic orders are measured/),
    });
    expect(bare.status).toBe("incomplete");
    const fifthOnly = run(
      { ...BASIC, ...step },
      { series: file({}, rowsDay, [{ name: "U5", quantity: "harmonicVoltage", order: 5, unit: "%" }]) },
    );
    expect(criterion(fifthOnly, `resonance:${PLAIN}`)).toMatchObject({
      verdict: "unknown",
      note: expect.stringMatching(/above the highest measured order 5/),
    });
    expect(fifthOnly.status).toBe("incomplete");
  });

  it("proposes a fixed bank for a constant load", () => {
    const steady = file({}, [
      [t(1), 100, 60],
      [t(2), 101, 61],
      [t(3), 99, 60],
    ]);
    const result = run(
      { ...BASIC, catalog: "cat-pfc", steps: [{ capacitor: "itm-blrch125a150b48" }], maxSteps: 12 },
      { network: null, series: steady },
    );
    expect(criterion(result, "fixed-bank").verdict).toBe("pass");
    // Need 100 x (0.6 - tan(acos 0.95)) = 27.8 kvar; 4 units of 8.68 kvar = 34.7 kvar stay below Q1 60 kvar.
    expect(result.conditions.bankType).toEqual({ text: "fixed" });
    expect(criterion(result, `step-size:${PLAIN}`).verdict).toBe("pass");
    expect(result.conditions.controlLogic).toMatchObject({
      text: expect.stringMatching(/fixed bank of 4 x 8.68 kvar .*reconnect only after the discharge time/),
    });
  });

  it("refuses an invalid request before anything is evaluated", () => {
    expect(() => powerQualityRequestSchema.parse({ ...BASIC, extra: 1 })).toThrow();
    expect(() => powerQualityRequestSchema.parse({ ...BASIC, targetPowerFactor: 0.7 })).toThrow(
      /targetPowerFactor/,
    );
    expect(() =>
      powerQualityRequestSchema.parse({
        ...BASIC,
        steps: Array.from({ length: 5 }, () => ({ capacitor: "x" })),
      }),
    ).toThrow(/1..4 step candidates/);
    expect(() => run({ ...BASIC, board: "lod-m1" })).toThrow(/not a board or busbar/);
    expect(() => run({ ...BASIC, catalog: "cat-pfc", steps: [{ capacitor: "itm-none" }] })).toThrow(
      /does not exist/,
    );
    expect(() => run({ ...BASIC, steps: [{ capacitor: "itm-blrch125a150b48" }] }, { catalog: null })).toThrow(
      /Name the catalog/,
    );
    const other = { ...series, file: { ...series.file, board: "brd-other" } };
    expect(() => run(BASIC, { series: other })).toThrow(/measures brd-other/);
  });
});

describe("the HIPE measurement excerpt (real data, CC BY 4.0)", () => {
  let hipe: MeasurementSeries;
  beforeAll(async () => {
    hipe = parseMeasurements(
      await readFile(new URL("power-quality-pfc/meas-hipe-main-terminal-2017-10-24.json", fixtures), "utf8"),
      await readFile(new URL("power-quality-pfc/meas-hipe-main-terminal-2017-10-24.csv", fixtures), "utf8"),
      "meas-hipe-main-terminal-2017-10-24",
    );
  });
  const HIPE = {
    board: "brd-main",
    measurements: "meas-hipe-main-terminal-2017-10-24",
    catalog: "cat-pfc",
    targetPowerFactor: 0.95,
    voltageTolerance: 10,
    resonanceMargin: 0.1,
    harmonicThreshold: 0.5,
    steps: [{ capacitor: "itm-blrch125a150b48" }],
  };

  it("keeps an undeclared Q unknown unless the engineer states the assumption", () => {
    expect(hipe.file).toMatchObject({ origin: "measured", conventions: { reactive: "undeclared" } });
    expect(hipe.file.source.license).toMatch(/CC BY 4.0/);
    const blocked = run(HIPE, { network: null, series: hipe });
    expect(blocked.status).toBe("blocked");
    expect(blocked.messages.join("\n")).toMatch(/reactiveAsFundamental states the assumption/);
  });

  it("produces a traceable result with limits from the real day (independent check: the CSV recomputed in Python)", () => {
    const result = run({ ...HIPE, reactiveAsFundamental: true }, { network: null, series: hipe });
    expect(amountOf(result, "measuredIntervals")).toBe(1440);
    expect(amountOf(result, "measuredEvaluated")).toBe(1440);
    // Python over the CSV: max(Q - P tan(acos 0.95)) = 6.3424 kvar at 19:03 (P 24.18 kW, Q 14.29 kvar); the
    // largest equal step that reaches the target without leading operation is min P tan(phi_t) = 1.8110 kvar.
    within(amountOf(result, "compensationNeed") as number, 6.3424, 0.005);
    within(amountOf(result, "stepOutputMax") as number, 1.811, 0.005);
    expect(criterion(result, "fixed-bank").verdict).toBe("fail"); // the lowest Q1 is 2.19 kvar
    expect(result.conditions.bankType).toEqual({ text: "automatic" });
    expect(criterion(result, `step-size:${PLAIN}`).verdict).toBe("fail"); // an 8.68 kvar step is far too coarse
    expect(criterion(result, `resonance:${PLAIN}`).note).toMatch(/fault level/);
    expect(result.status).toBe("incomplete");
    expect(result.messages.join("\n")).not.toMatch(/FICTIONAL/);
    expect(result.assumptions.join("\n")).toMatch(/read as fundamental reactive power Q1/);
    expect(result.sources.join("\n")).toContain(
      "meas-hipe-main-terminal-2017-10-24 (measured; licence CC BY 4.0",
    );
    expect(result.messages.join("\n")).toMatch(/attribution\): HIPE .*Bischof, Trittenbach/);
    expect(result.conditions.measurements).toMatchObject({
      text: expect.stringMatching(/origin measured rows 1440/),
    });
    expect(JSON.stringify(result)).not.toMatch(/"setting"/);
  });
});
