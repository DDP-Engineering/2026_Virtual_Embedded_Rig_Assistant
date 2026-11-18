// The radial LV network engine against independent references (REQ-TEST-e3eb9076): hand calculations written out
// below and fault currents computed by pandapower 3.1.2 (tests/support/pandapower_network_check.py). Tolerances are
// fixed here, before any comparison. VERA_PANDAPOWER_PYTHON names a Python with pandapower 3.1.2: the opt-in test
// recomputes the recorded values.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CableTable, ElectricalModel, ElectricalObject, ElectricalResult } from "@vera/shared";
import { describe, expect, it } from "vitest";
import { checkCableTable } from "./cable-table.js";
import { checkModel } from "./model.js";
import { analyzeNetwork, type NetworkRequest, networkRequestSchema } from "./network.js";
import { checkResult } from "./results.js";

/** Load balance and currents against hand calculations: 0.1 %. */
const TOL_BALANCE = 0.001;
/** Voltage drop against hand calculations: 0.5 %. */
const TOL_DROP = 0.005;
/** Fault currents against pandapower 3.1.2 (same method, independent implementation): 1 %. */
const TOL_FAULT = 0.01;

const near = (actual: number | null | undefined, expected: number, tolerance: number) => {
  expect(actual, `expected ${expected}`).not.toBeNull();
  expect(
    Math.abs((actual as number) - expected) / Math.abs(expected),
    `${actual} vs ${expected}`,
  ).toBeLessThanOrEqual(tolerance);
};

const fixtures = new URL("../../../../../tests/fixtures/electrical-network/", import.meta.url);
const read = (name: string) => readFileSync(fileURLToPath(new URL(name, fixtures)), "utf8");
/** The fictional test table (values chosen for the tests, not a product's data). */
const testTable = (): CableTable => JSON.parse(read("tbl-test-cu-pvc.json")) as CableTable;

const q = (
  value: number | null,
  unit: string,
  basis: "input" | "requirement" | "assumption" | "proposal" = "input",
) => ({ value, unit, basis });
const cable = (id: string, length: number, section: number | null): ElectricalObject => ({
  id,
  type: "cable",
  attributes: { installationMethod: "air" },
  properties: {
    length: q(length, "m"),
    crossSection: q(section, "mm²", section === null ? "proposal" : "input"),
    ambientTemperature: q(30, "°C"),
    groupedCircuits: q(1, "1"),
  },
});
/** Sets one property of an object of the edited copy. */
const setProp = (
  objects: Map<string, ElectricalObject>,
  id: string,
  name: string,
  value: ReturnType<typeof q>,
) => {
  const object = objects.get(id) as ElectricalObject;
  object.properties = { ...object.properties, [name]: value };
};
let relation = 100;
const rel = (type: string, from: string, to: string) =>
  ({ id: `rel-${++relation}`, type, from, to }) as ElectricalModel["relations"][number];

/**
 * Network A (tests/fixtures/electrical-network/network-a.json): 630 kVA 20/0.4 kV Dyn11 (uk 6 %, Pk 6.5 kW) behind
 * 500/250 MVA, TN-S. Main board MDB feeds the sub-board SDB (W1 35 mm² 60 m, breaker Q1 40 A) and a socket circuit
 * on L2 (W4 2.5 mm² 20 m, PE 1.5 mm², 3 kW, demand 0.5); SDB feeds the 11 kW pump motor (W2 30 m, section proposed)
 * and lighting on L1 (W3 2.5 mm² 0.04 km, 2 kW). `edit` changes a copy of its objects.
 */
function networkA(edit: (objects: Map<string, ElectricalObject>) => void = () => {}): ElectricalModel {
  const model = JSON.parse(read("network-a.json")) as ElectricalModel;
  const map = new Map(model.objects.map((object) => [object.id, object]));
  edit(map);
  model.objects = [...map.values()];
  const checked = checkModel(model);
  if ("problems" in checked) throw Error(JSON.stringify(checked.problems));
  return checked.model;
}

const requestA = (more: Partial<NetworkRequest> = {}): NetworkRequest => ({
  cableTable: "tbl-test-cu-pvc",
  voltageTolerance: 10,
  scenarios: [
    { id: "normal", title: "Normal operation", simultaneity: { "brd-main": 0.9 } },
    { id: "pump-off", title: "Pump stopped", simultaneity: { "brd-main": 0.9 }, loads: { "mot-p1": 0 } },
  ],
  voltageDropLimit: { value: 4, unit: "%" },
  voltageDropLimitLighting: { value: 3, unit: "%" },
  ...more,
});

function run(
  model: ElectricalModel,
  request: NetworkRequest = requestA(),
  table: CableTable = testTable(),
): ElectricalResult {
  const checked = checkCableTable(table, table.id);
  if ("problems" in checked) throw Error(JSON.stringify(checked.problems));
  return analyzeNetwork({
    model,
    modelPath: "electrical-automation-model.json",
    modelSha256: "0".repeat(64),
    table: checked.table,
    tableStamp: {
      id: table.id,
      version: table.version,
      sha256: "1".repeat(64),
      path: `electrical-automation-tables/${table.id}.json`,
    },
    request,
    runId: "20261115-120000-abcd",
    now: "2026-11-15T12:00:00Z",
  });
}
const valueAt = (result: ElectricalResult, name: string, subject: string) =>
  result.intermediate.find((entry) => entry.name === name && entry.subject === subject)?.value;
const criterionOf = (result: ElectricalResult, id: string, subject: string) =>
  result.criteria.find((entry) => entry.id === id && entry.subject === subject);

describe("load balance and voltage drop (PWR-02-A, hand calculations)", () => {
  // Hand calculation, Un 400 V, U0 = 230.94 V.
  // M1: P = 11 kW / 0.9 = 12.2222 kW, Q = P tan(acos 0.85) = 7.57465 kvar, I = P / (sqrt3 400 0.85) = 20.7544 A.
  // E1 on L1: 2 kW, Q 0.657368 kvar, I = S / U0 = 9.11606 A.  X1 on L2: 3 kW cos 1, I = 12.9904 A, demand 0.5.
  // SDB (no ks): P 14.2222 kW, Q 8.23202 kvar, S 16.4328 kVA, L1 29.6925 A, L2 = L3 20.7544 A, N 9.11606 A.
  // MDB normal = 0.9 x (SDB + 0.5 X1 on L2): P 14.15 kW, Q 7.40882 kvar, S 15.9723 kVA,
  //   L1 26.7233 A, L2 23.8475 A, L3 18.6790 A, N 9.04771 A.  MDB pump-off: P 3.15 kW, L1 8.20445 A.
  const result = run(networkA());
  it("writes a valid format-1 result", () => {
    expect("result" in checkResult(result, result.runId)).toBe(true);
    expect(result.method.reference).toContain("IEC 60909-0:2016");
    expect(result.preliminary).toBe(true);
  });
  it("balances P, Q and S with simultaneity, demand and load factors per scenario", () => {
    near(valueAt(result, "activePower:normal", "brd-sub"), 14.2222, TOL_BALANCE);
    near(valueAt(result, "reactivePower:normal", "brd-sub"), 8.23202, TOL_BALANCE);
    near(valueAt(result, "apparentPower:normal", "brd-sub"), 16.4328, TOL_BALANCE);
    near(valueAt(result, "activePower:normal", "brd-main"), 14.15, TOL_BALANCE);
    near(valueAt(result, "reactivePower:normal", "brd-main"), 7.40882, TOL_BALANCE);
    near(valueAt(result, "apparentPower:normal", "brd-main"), 15.9723, TOL_BALANCE);
    near(valueAt(result, "activePower:pump-off", "brd-main"), 3.15, TOL_BALANCE);
  });
  it("loads the phases and the neutral", () => {
    near(valueAt(result, "phaseCurrentL1:normal", "brd-sub"), 29.6925, TOL_BALANCE);
    near(valueAt(result, "phaseCurrentL2:normal", "brd-sub"), 20.7544, TOL_BALANCE);
    near(valueAt(result, "neutralCurrent:normal", "brd-sub"), 9.11606, TOL_BALANCE);
    near(valueAt(result, "phaseCurrentL1:normal", "brd-main"), 26.7233, TOL_BALANCE);
    near(valueAt(result, "phaseCurrentL2:normal", "brd-main"), 23.8475, TOL_BALANCE);
    near(valueAt(result, "phaseCurrentL3:normal", "brd-main"), 18.679, TOL_BALANCE);
    near(valueAt(result, "neutralCurrent:normal", "brd-main"), 9.04771, TOL_BALANCE);
    near(valueAt(result, "phaseCurrentL1:pump-off", "brd-main"), 8.20445, TOL_BALANCE);
  });
  it("computes design currents of final and distribution circuits", () => {
    near(valueAt(result, "designCurrent", "cir-m1"), 20.7544, TOL_BALANCE);
    near(valueAt(result, "designCurrent", "cir-l1"), 9.11606, TOL_BALANCE);
    near(valueAt(result, "designCurrent", "cir-s1"), 12.9904, TOL_BALANCE); // no demand factor on a final circuit
    near(valueAt(result, "designCurrent", "cir-f1"), 29.6925, TOL_BALANCE); // SDB's highest phase
    expect(valueAt(result, "designCurrent:pump-off", "cir-m1")).toBe(0);
  });
  // Voltage drop, R at 70 °C = R20 (1 + 0.00393 x 50):
  // W1 3-phase: sqrt3 x 29.6925 A x 0.06 km x (0.524 x 1.1965 x 0.86548 + 0.08 x 0.50094) / 400 = 0.449515 %.
  // W3 1-phase: 2 x 9.11606 A x 0.04 km x (7.41 x 1.1965 x 0.95 + 0.1 x 0.31225) / 230.94 = 2.66968 %; at E1 3.11919 %.
  // W4 1-phase: 2 x 12.9904 A x 0.02 km x 7.41 x 1.1965 / 230.94 = 1.99486 %.
  it("computes three-phase and single-phase voltage drop along the path", () => {
    near(valueAt(result, "voltageDrop:normal", "cir-f1"), 0.449515, TOL_DROP);
    near(valueAt(result, "voltageDrop:normal", "cir-l1"), 3.11919, TOL_DROP);
    near(valueAt(result, "voltageDrop:normal", "cir-s1"), 1.99486, TOL_DROP);
  });
  it("compares the worst scenario with the limit (lighting 3 %, others 4 %)", () => {
    expect(criterionOf(result, "voltage-drop", "cir-l1")).toMatchObject({
      verdict: "fail",
      limit: { value: 3, unit: "%" },
    });
    expect(criterionOf(result, "voltage-drop", "cir-s1")).toMatchObject({
      verdict: "pass",
      limit: { value: 4, unit: "%" },
    });
    const relaxed = run(networkA(), requestA({ voltageDropLimitLighting: { value: 3.5, unit: "%" } }));
    expect(criterionOf(relaxed, "voltage-drop", "cir-l1")?.verdict).toBe("pass");
  });
});

describe("cable sizing (PWR-02-C)", () => {
  it("proposes the smallest section and names the governing criterion", () => {
    // M1: Ib 20.75 A; 2.5 mm² gives 25 A at 30 °C and one circuit, drop 2.05 % + 0.45 % upstream.
    const result = run(networkA());
    expect(valueAt(result, "crossSection", "cbl-w2")).toBe(2.5);
    expect(criterionOf(result, "cable-section", "cir-m1")?.note).toMatch(
      /Proposed 2\.5 mm², governing current-capacity, scenario normal/,
    );
    expect(criterionOf(result, "current-capacity", "cir-m1")).toMatchObject({
      verdict: "pass",
      measured: { value: 25 },
    });
    // F1 is checked at 35 mm² and must reach the 40 A breaker, not only Ib.
    expect(criterionOf(result, "current-capacity", "cir-f1")).toMatchObject({
      verdict: "pass",
      limit: { value: 40 },
    });
  });
  it("lowers the rating with temperature and grouping and raises the section", () => {
    const hot = run(networkA((o) => setProp(o, "cbl-w2", "ambientTemperature", q(42, "°C"))));
    // 42 °C is looked up at 45 °C (0.79): 25 x 0.79 = 19.75 A < 20.75 A -> 4 mm² (34 x 0.79 = 26.86 A).
    expect(valueAt(hot, "temperatureFactor", "cbl-w2")).toBe(0.79);
    expect(valueAt(hot, "crossSection", "cbl-w2")).toBe(4);
    near(valueAt(hot, "currentCapacity", "cbl-w2"), 26.86, TOL_BALANCE);
    const grouped = run(networkA((o) => setProp(o, "cbl-w2", "groupedCircuits", q(3, "1"))));
    expect(valueAt(grouped, "groupingFactor", "cbl-w2")).toBe(0.7);
    expect(valueAt(grouped, "crossSection", "cbl-w2")).toBe(4);
  });
  it("is governed by voltage drop on a long cable", () => {
    const long = run(networkA((o) => setProp(o, "cbl-w2", "length", q(150, "m"))));
    expect(criterionOf(long, "cable-section", "cir-m1")?.note).toMatch(/governing voltage-drop/);
    expect(valueAt(long, "crossSection", "cbl-w2")).toBeGreaterThan(2.5);
    expect(criterionOf(long, "voltage-drop", "cir-m1")?.verdict).toBe("pass");
  });
  it("fails a given section that is too small", () => {
    const small = run(networkA((o) => setProp(o, "cbl-w2", "crossSection", q(1.5, "mm²"))));
    expect(criterionOf(small, "current-capacity", "cir-m1")).toMatchObject({
      verdict: "fail",
      measured: { value: 18.5 },
    });
    expect(criterionOf(small, "cable-section", "cir-m1")?.note).toMatch(/^Checked 1\.5 mm²/);
  });
  it("proposes nothing without installation method, ambient temperature or grouping", () => {
    for (const drop of ["installationMethod", "ambientTemperature", "groupedCircuits"]) {
      const result = run(
        networkA((o) => {
          const w2 = o.get("cbl-w2") as ElectricalObject;
          if (drop === "installationMethod") w2.attributes = {};
          else if (w2.properties) delete w2.properties[drop];
        }),
      );
      expect(valueAt(result, "crossSection", "cbl-w2"), drop).toBeNull();
      expect(criterionOf(result, "cable-section", "cir-m1")?.verdict, drop).toBe("unknown");
      expect(criterionOf(result, "current-capacity", "cir-m1")?.verdict, drop).toBe("unknown");
      expect(result.status).toBe("incomplete");
    }
  });
  it("checks the thermal withstand with a fault duration and k", () => {
    // 0.2 s at the SDB (6.3986 kA): S >= 6398.6 x sqrt(0.2) / 115 = 24.88 mm² -> 25 mm² for M1.
    const result = run(networkA(), requestA({ faultDuration: { value: 200, unit: "ms" } }));
    near(valueAt(result, "thermalMinimumSection", "cbl-w2"), 24.88, TOL_FAULT);
    expect(valueAt(result, "crossSection", "cbl-w2")).toBe(25);
    expect(criterionOf(result, "cable-section", "cir-m1")?.note).toMatch(/governing short-circuit-withstand/);
    expect(criterionOf(result, "short-circuit-withstand", "cir-l1")?.verdict).toBe("fail");
    expect(criterionOf(run(networkA()), "short-circuit-withstand", "cir-l1")?.verdict).toBe("not-evaluated");
  });
});

// pandapower 3.1.2 (calc_sc, lv_tol_percent 10, topology radial), recorded 2026-11-15 from
// tests/support/pandapower_network_check.py with the network below. kA.
const PANDAPOWER_A = {
  origin: { ik3Max: 16.15016, ip: 36.6221, ik3Min: 13.6977, ik1Min: 13.88213 },
  sub: { ik3Max: 6.3986, ip: 9.28723, ik3Min: 3.93894, ik1Min: 2.11206 },
  motor: { ik3Max: 0.98663, ip: 1.42322, ik3Min: 0.54953, ik1Min: 0.27598 },
  light: { ik3Max: 0.76652, ip: 1.10571, ik3Min: 0.42623, ik1Min: 0.21382 },
  socket: { ik3Max: 1.67248, ip: 2.41255, ik3Min: 0.93528, ik1Min: 0.35865 },
};
const PANDAPOWER_SPEC = {
  un: 400,
  tolerance: 10,
  transformer: { sn: 630000, uk: 6, pk: 6500, hv: 20000, skMax: 500e6, skMin: 250e6, rx: 0.1 },
  lines: [
    { name: "W1", from: "origin", to: "sub", length: 60, r: 0.524, x: 0.08, rPe: 0.524, endTemp: 160 },
    { name: "W2", from: "sub", to: "motor", length: 30, r: 7.41, x: 0.1, rPe: 7.41, endTemp: 160 },
    { name: "W3", from: "sub", to: "light", length: 40, r: 7.41, x: 0.1, rPe: 7.41, endTemp: 160 },
    { name: "W4", from: "origin", to: "socket", length: 20, r: 7.41, x: 0.1, rPe: 12.1, endTemp: 160 },
  ],
};

describe("fault currents (PWR-02-B, pandapower 3.1.2 and hand calculation)", () => {
  const result = run(networkA());
  it("matches the hand calculation at the transformer terminals", () => {
    // ZQ = 1.1 x 400² / 500 MVA = 0.352 mΩ (R/X 0.1); ZT = 0.06 x 400² / 630 kVA = 15.238 mΩ, RT = 6.5 kW x 400² /
    // 630 kVA² = 2.6203 mΩ; KT = 0.95 x 1.1 / (1 + 0.6 x 0.0591) = 1.00917; |Z| = 15.729 mΩ; Ik3 = 1.1 x 400 /
    // (sqrt3 x 15.729 mΩ) = 16.150 kA.
    near(valueAt(result, "ik3Max", "brd-main"), 16.15, TOL_FAULT);
    near(valueAt(result, "transformerCorrectionFactor", "sup-t1"), 1.00917, TOL_BALANCE);
  });
  it("agrees with pandapower at boards and circuit ends", () => {
    for (const [board, ref] of [
      ["brd-main", PANDAPOWER_A.origin],
      ["brd-sub", PANDAPOWER_A.sub],
    ] as const) {
      near(valueAt(result, "ik3Max", board), ref.ik3Max, TOL_FAULT);
      near(valueAt(result, "peakCurrent", board), ref.ip, TOL_FAULT);
      near(valueAt(result, "ik3Min", board), ref.ik3Min, TOL_FAULT);
    }
    near(valueAt(result, "ik3MaxStart", "cir-m1"), PANDAPOWER_A.sub.ik3Max, TOL_FAULT);
    for (const [circuit, ref] of [
      ["cir-f1", PANDAPOWER_A.sub],
      ["cir-m1", PANDAPOWER_A.motor],
      ["cir-l1", PANDAPOWER_A.light],
      ["cir-s1", PANDAPOWER_A.socket],
    ] as const) {
      near(valueAt(result, "ik3MinEnd", circuit), ref.ik3Min, TOL_FAULT);
      near(valueAt(result, "ik1MinEnd", circuit), ref.ik1Min, TOL_FAULT);
    }
  });
  it("shows the method, its edition and its simplifications", () => {
    expect(result.method).toMatchObject({ id: "vera-radial-lv-1" });
    expect(result.assumptions.join(" ")).toMatch(/KT = 0\.95\*cmax/);
    expect(result.limits.join(" ")).toMatch(/no conformity statement/);
    expect(result.conditions).toMatchObject({
      cMax: { value: 1.1, unit: "1" },
      cMin: { value: 0.95, unit: "1" },
      earthing: { text: "TN-S" },
    });
    const six = run(networkA(), requestA({ voltageTolerance: 6 }));
    expect(six.conditions.cMax).toEqual({ value: 1.05, unit: "1" });
  });
  it("computes a supply point from its fault level and loop impedance", () => {
    // Supply 10 kA, R/X 0.5: |Z1| = 1.1 x 400 / (sqrt3 x 10 kA) = 25.403 mΩ -> Ik3max at MDB = 10 kA by construction.
    // Ik3min with 6 kA: Z = 0.95 x 400 / (sqrt3 x 6 kA) = 36.566 mΩ -> 6 kA at MDB.
    const supply = run(
      networkA((o) => {
        o.set("sup-t1", {
          id: "sup-t1",
          type: "source",
          ref: "T1",
          attributes: { kind: "supply", system: "TN-C-S" },
          properties: {
            ratedVoltage: q(400, "V"),
            phases: q(3, "1"),
            shortCircuitCurrent: q(10, "kA"),
            shortCircuitCurrentMin: q(6, "kA"),
            resistanceReactanceRatio: q(0.5, "1"),
            earthFaultLoopImpedance: q(0.05, "Ω"),
          },
        });
      }),
    );
    near(valueAt(supply, "ik3Max", "brd-main"), 10, TOL_BALANCE);
    near(valueAt(supply, "ik3Min", "brd-main"), 6, TOL_BALANCE);
    expect(supply.assumptions.join(" ")).toMatch(/Ze of T1 \(sup-t1\) .* short-circuit R\/X ratio 0\.5/);
    // Ik1 at the end of W4 = 0.95 x 230.94 / |Ze + Z_L(160 °C) + Z_PE(160 °C)| with Ze 50 mΩ at R/X 0.5:
    // Ze = 22.361 + j44.721 mΩ; L: 7.41 x 0.02 x 1.56 = 231.19 mΩ + j2 mΩ; PE: 12.1 x 0.02 x 1.56 = 377.52 mΩ + j2 mΩ;
    // |Z| = 632.95 mΩ -> 0.34662 kA.
    near(valueAt(supply, "ik1MinEnd", "cir-s1"), 0.34662, TOL_FAULT);
  });
  it.skipIf(!process.env.VERA_PANDAPOWER_PYTHON)(
    "recomputes the pandapower references (opt-in)",
    async () => {
      const folder = await mkdtemp(join(tmpdir(), "vera-pp-"));
      try {
        const spec = join(folder, "network.json");
        await writeFile(spec, JSON.stringify(PANDAPOWER_SPEC));
        const script = fileURLToPath(
          new URL("../../../../../tests/support/pandapower_network_check.py", import.meta.url),
        );
        const out = spawnSync(
          process.env.VERA_PANDAPOWER_PYTHON as string,
          ["-I", "-W", "ignore", script, spec],
          { encoding: "utf8" },
        );
        expect(out.status, out.stderr.slice(-800)).toBe(0);
        const doc = JSON.parse(out.stdout) as {
          pandapower: string;
          buses: Record<string, Record<string, number>>;
        };
        expect(doc.pandapower).toBe("3.1.2");
        for (const [bus, ref] of Object.entries(PANDAPOWER_A))
          for (const [key, expected] of Object.entries(ref)) near(doc.buses[bus]?.[key], expected, 1e-4);
      } finally {
        await rm(folder, { recursive: true, force: true });
      }
    },
  );
});

describe("unsupported networks and missing data never pass (PWR-02-C)", () => {
  it("does not evaluate fault currents of a generator source", () => {
    const result = run(
      networkA(
        (o) => ((o.get("sup-t1") as ElectricalObject).attributes = { kind: "generator", system: "TN-S" }),
      ),
    );
    expect(criterionOf(result, "short-circuit", "sup-t1")?.verdict).toBe("not-evaluated");
    expect(valueAt(result, "ik3Max", "brd-main")).toBeNull();
    expect(result.status).toBe("incomplete");
    expect(valueAt(result, "activePower:normal", "brd-main")).not.toBeNull();
  });
  it("gives no line-to-earth fault current in an IT system", () => {
    const result = run(
      networkA(
        (o) =>
          ((o.get("sup-t1") as ElectricalObject).attributes = {
            kind: "transformer",
            system: "IT",
            vectorGroup: "Dyn11",
          }),
      ),
    );
    expect(valueAt(result, "ik1MinEnd", "cir-s1")).toBeNull();
    expect(valueAt(result, "ik3MinEnd", "cir-s1")).not.toBeNull();
  });
  it("blocks a single-phase, DC, MV or tied network", () => {
    const cases: [string, (o: Map<string, ElectricalObject>) => void][] = [
      ["single-phase", (o) => setProp(o, "sup-t1", "phases", q(1, "1"))],
      [
        "DC",
        (o) => ((o.get("sup-t1") as ElectricalObject).attributes = { kind: "transformer", current: "DC" }),
      ],
      ["MV", (o) => setProp(o, "sup-t1", "ratedVoltage", q(20, "kV"))],
      ["unknown voltage", (o) => setProp(o, "sup-t1", "ratedVoltage", q(null, "V"))],
    ];
    for (const [name, edit] of cases) {
      const result = run(networkA(edit));
      expect(result.status, name).toBe("blocked");
      expect(
        result.criteria.filter((entry) => entry.verdict === "pass"),
        name,
      ).toEqual([]);
    }
    const tied = networkA((o) => {
      o.set("bus-a", { id: "bus-a", type: "busbar" });
      o.set("bus-b", { id: "bus-b", type: "busbar" });
    });
    tied.relations.push(rel("connects", "cbl-w1", "bus-a"), rel("connects", "cbl-w1", "bus-b"));
    expect(run(tied).status).toBe("blocked");
    expect(run(tied).messages.join(" ")).toMatch(/tie between busbars/);
  });
  it("does not evaluate parallel cables or a circuit without cable", () => {
    const parallel = networkA((o) => o.set("cbl-w5", cable("cbl-w5", 60, 35)));
    parallel.relations.push(rel("routes", "cbl-w5", "cir-f1"));
    const result = run(parallel);
    expect(criterionOf(result, "current-capacity", "cir-f1")?.verdict).toBe("not-evaluated");
    expect(criterionOf(result, "voltage-drop", "cir-l1")?.verdict).toBe("unknown"); // downstream of F1
    expect(valueAt(result, "ik3Max", "brd-sub")).toBeNull();
    const bare = networkA();
    bare.relations = bare.relations.filter((entry) => !(entry.type === "routes" && entry.to === "cir-s1"));
    expect(criterionOf(run(bare), "cable-section", "cir-s1")?.verdict).toBe("not-evaluated");
  });
  it("keeps an unknown motor efficiency unknown, never zero", () => {
    const result = run(networkA((o) => setProp(o, "mot-p1", "efficiency", q(null, "%"))));
    expect(valueAt(result, "designCurrent", "cir-m1")).toBeNull();
    expect(valueAt(result, "activePower:normal", "brd-sub")).toBeNull();
    expect(criterionOf(result, "current-capacity", "cir-m1")?.verdict).toBe("unknown");
    expect(criterionOf(result, "current-capacity", "cir-f1")?.verdict).toBe("unknown");
    expect(result.status).toBe("incomplete");
  });
  it("names a motor whose rated voltage is not the supply's and still computes its power", () => {
    // 230 V winding data with 36 A on the 400 V network: P = sqrt3 x 230 x 36 x 0.85 = 12.1902 kW, as before.
    const delta = run(
      networkA((o) => {
        setProp(o, "mot-p1", "ratedCurrent", q(36, "A"));
        setProp(o, "mot-p1", "ratedVoltage", q(230, "V"));
      }),
    );
    near(valueAt(delta, "designCurrent", "cir-m1"), (36 * 230) / 400, TOL_BALANCE);
    expect(delta.messages.join(" ")).toMatch(
      /M1 \(mot-p1\): rated voltage 230 V differs from the supply's 400 V/,
    );
    // 380 V on 400 V is inside the 10 % tolerance.
    const close = run(
      networkA((o) => {
        setProp(o, "mot-p1", "ratedCurrent", q(21, "A"));
        setProp(o, "mot-p1", "ratedVoltage", q(380, "V"));
      }),
    );
    expect(close.messages.join(" ")).not.toMatch(/rated voltage/);
  });
  it("keeps P, Q and S but not the phase currents when a single-phase load has no phase", () => {
    const result = run(networkA((o) => ((o.get("cir-s1") as ElectricalObject).attributes = {})));
    near(valueAt(result, "activePower:normal", "brd-main"), 14.15, TOL_BALANCE);
    expect(valueAt(result, "phaseCurrentL1:normal", "brd-main")).toBeUndefined();
    expect(valueAt(result, "current:normal", "brd-main")).toBeNull();
  });
});

describe("unknown stays unknown and the status says so (review round 1)", () => {
  it("is completed only when every criterion is pass or fail", () => {
    const result = run(networkA(), requestA({ faultDuration: { value: 0.2, unit: "s" } }));
    expect(result.criteria.every((entry) => entry.verdict === "pass" || entry.verdict === "fail")).toBe(true);
    expect(result.status).toBe("completed");
  });
  it("does not pass a given section whose capacity inputs are missing", () => {
    const result = run(networkA((o) => ((o.get("cbl-w1") as ElectricalObject).attributes = {})));
    expect(criterionOf(result, "cable-section", "cir-f1")).toMatchObject({ verdict: "unknown" });
    expect(criterionOf(result, "cable-section", "cir-f1")?.note).toMatch(
      /not established: installationMethod/,
    );
    expect(result.status).toBe("incomplete");
  });
  it("gives unknown, not fail, when the reactance or a rating is unknown", () => {
    const noX = testTable();
    for (const conductor of noX.conductors) conductor.reactance = null;
    const result = run(networkA(), requestA(), noX);
    expect(criterionOf(result, "cable-section", "cir-m1")).toMatchObject({ verdict: "unknown" });
    expect(criterionOf(result, "cable-section", "cir-m1")?.note).toMatch(/voltage drop .* unknown/);
    expect(valueAt(result, "ik3Max", "brd-sub")).toBeNull();
    const withX = run(networkA(), requestA({ assumedReactance: 0.08 }), noX);
    expect(valueAt(withX, "crossSection", "cbl-w2")).toBe(2.5);
    const noTwo = testTable();
    for (const method of noTwo.methods)
      method.ratings = method.ratings.filter((rating) => rating.loadedConductors === 3);
    const single = run(networkA(), requestA(), noTwo);
    expect(criterionOf(single, "current-capacity", "cir-l1")?.verdict).toBe("unknown");
    expect(criterionOf(single, "cable-section", "cir-l1")?.verdict).toBe("unknown");
  });
  it("reports objects fed from no source and ignored scenario keys", () => {
    const model = networkA((o) => o.set("brd-orphan", { id: "brd-orphan", type: "board", ref: "X9" }));
    const result = run(
      model,
      requestA({ scenarios: [{ id: "normal", title: "Normal", simultaneity: { "brd-typo": 0.5 } }] }),
    );
    expect(criterionOf(result, "network-coverage", "sup-t1")).toMatchObject({ verdict: "not-evaluated" });
    expect(result.messages.join(" ")).toMatch(/brd-typo is not a board or busbar of this network/);
    expect(result.status).toBe("incomplete");
  });
  it("marks earth faults and minimum fault currents that cannot be computed", () => {
    const isolated = run(
      networkA(
        (o) =>
          ((o.get("sup-t1") as ElectricalObject).attributes = {
            kind: "transformer",
            system: "IT",
            vectorGroup: "Dyn11",
          }),
      ),
    );
    expect(criterionOf(isolated, "earth-fault", "sup-t1")).toMatchObject({
      verdict: "not-evaluated",
      note: "Not evaluated: earthing IT is not TN.",
    });
    expect(isolated.status).toBe("incomplete");
    const noMin = run(
      networkA((o) => {
        delete (o.get("sup-t1") as ElectricalObject).properties?.networkShortCircuitPowerMin;
      }),
    );
    expect(criterionOf(noMin, "short-circuit-minimum", "sup-t1")?.verdict).toBe("unknown");
    expect(valueAt(noMin, "ik3MinEnd", "cir-m1")).toBeNull();
    expect(valueAt(noMin, "ik3Min", "brd-main")).toBeNull();
    expect(valueAt(noMin, "ik3Max", "brd-main")).not.toBeNull();
    const parallel = networkA((o) => o.set("cbl-w5", cable("cbl-w5", 60, 35)));
    parallel.relations.push(rel("routes", "cbl-w5", "cir-f1"));
    expect(run(parallel).status).toBe("incomplete");
  });
  it("treats an efficiency or demand factor outside 0..1 as unknown", () => {
    const result = run(networkA((o) => setProp(o, "mot-p1", "efficiency", q(92, "1"))));
    expect(valueAt(result, "designCurrent", "cir-m1")).toBeNull();
    expect(result.messages.join(" ")).toMatch(/efficiency 92 is outside 0\.\.1/);
    const demand = run(networkA((o) => setProp(o, "lod-s1", "demandFactor", q(1.5, "1"))));
    expect(valueAt(demand, "activePower:normal", "brd-main")).toBeNull();
  });
  it("computes the supply point's minimum and peak currents", () => {
    // ip = (1.02 + 0.98 e^-1.5) sqrt2 x 10 kA = 17.5175 kA (R/X 0.5) at MDB and at the origin of C3.
    // Ik3min at the end of F1: source Z = 0.95 x 400 / (sqrt3 x 6 kA) = 36.566 mΩ at R/X 0.5 (16.353 + j32.706) plus
    // W1 at 160 °C (0.524 x 0.06 x 1.56 = 49.046 + j4.8 mΩ): |Z| = 75.393 mΩ -> 219.393 V / 75.393 mΩ = 2.9100 kA.
    const supply = run(
      networkA((o) => {
        o.set("sup-t1", {
          id: "sup-t1",
          type: "source",
          attributes: { kind: "supply", system: "TN-C-S" },
          properties: {
            ratedVoltage: q(400, "V"),
            phases: q(3, "1"),
            shortCircuitCurrent: q(10, "kA"),
            shortCircuitCurrentMin: q(6, "kA"),
            resistanceReactanceRatio: q(0.5, "1"),
            earthFaultLoopImpedance: q(50, "mΩ"),
          },
        });
      }),
    );
    near(valueAt(supply, "peakCurrent", "brd-main"), 17.5175, TOL_BALANCE);
    near(valueAt(supply, "peakCurrentStart", "cir-s1"), 17.5175, TOL_BALANCE);
    near(valueAt(supply, "ik3MinEnd", "cir-f1"), 2.91, TOL_BALANCE);
  });
  it("chooses one of several sources, refuses control characters and keeps long table texts valid", () => {
    const two = networkA((o) => o.set("sup-t2", { id: "sup-t2", type: "source", ref: "T2" }));
    expect(run(two).status).toBe("blocked");
    expect(run(two, requestA({ source: "sup-t1" })).status).toBe("incomplete");
    expect(
      networkRequestSchema.safeParse(requestA({ scenarios: [{ id: "a", title: "two\nlines" }] })).success,
    ).toBe(false);
    const long = testTable();
    long.version = "v".repeat(180);
    const result = run(networkA(), requestA(), long);
    expect("result" in checkResult(result, result.runId)).toBe(true);
  });
});
