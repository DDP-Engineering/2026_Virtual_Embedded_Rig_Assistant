// The motor drives engine (spec REQ-DATA-79118f9a) on the fictional plant M and the cited motor-drives catalog, run
// through the real pipeline: electrical-network -> protection-coordination -> motor-drives. References were fixed
// before the comparison (journal TASK-37f3835b): closed-form hand calculations 0.5 %, the ABB worked example 25 %.
// Synthetic model or catalog edits are made in memory only, to reach the branches the fixture does not.
import { readFile } from "node:fs/promises";
import type { ElectricalModel, ElectricalResult, IndustrialCatalog } from "@vera/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCableTable } from "./cable-table.js";
import { type CatalogStamp, parseCatalog } from "./catalog.js";
import { parseModel } from "./model.js";
import {
  accelerationTime,
  analyzeMotorDrives,
  breakdownSpeed,
  motorDrivesRequestSchema,
  motorTorque,
} from "./motor-drives.js";
import { analyzeNetwork } from "./network.js";
import { analyzeProtection, protectionRequestSchema } from "./protection.js";
import { renderResultReport } from "./report.js";
import { checkResult } from "./results.js";

const fixtures = new URL("../../../../../tests/fixtures/", import.meta.url);
let model: ElectricalModel;
let network: ElectricalResult;
let protection: ElectricalResult;
let catalog: IndustrialCatalog;
const stamp: CatalogStamp = {
  id: "cat-motor-drives",
  version: "2026-11-15.1",
  sha256: "c".repeat(64),
  path: "electrical-automation-catalogs/cat-motor-drives.json",
};

beforeAll(async () => {
  model = parseModel(await readFile(new URL("motor-drives/plant-m.json", fixtures), "utf8"));
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
      scenarios: [{ id: "normal", title: "Normal operation" }],
      voltageDropLimit: { value: 4, unit: "%" },
    },
    runId: "20261115-100000-aaaa",
    now: "2026-11-15T10:00:00Z",
  });
  catalog = parseCatalog(
    await readFile(new URL("motor-drives/cat-motor-drives.json", fixtures), "utf8"),
    "cat-motor-drives",
  );
  protection = analyzeProtection({
    model,
    modelPath: "electrical-automation-model.json",
    modelSha256: "0".repeat(64),
    network,
    catalog,
    catalogStamp: stamp,
    cable: { k: 115, text: "tbl-test-cu-pvc 1 sha256 aaaaaaaaaaaaaaaa (k 115)" },
    request: protectionRequestSchema.parse({
      network: network.runId,
      catalog: "cat-motor-drives",
      breakingCapacity: "Icu",
      circuits: [
        { circuit: "cir-m1", candidates: ["itm-gv2me10"], setting: 4.6 },
        { circuit: "cir-m2", candidates: ["itm-c10g32"] },
        { circuit: "cir-m3", candidates: ["itm-c10g20"] },
      ],
      starters: [{ circuit: "cir-m2", protection: "itm-c10g32", contactor: "itm-lc1d18p7", type: 2 }],
    }),
    runId: "20261115-110000-bbbb",
    now: "2026-11-15T11:00:00Z",
  });
});

const FAN = { motor: "mot-f1", protection: "itm-gv2me10", contactor: "itm-lc1d09p7" };
const PUMP = {
  motor: "mot-p2",
  startingCurrentMax: 70,
  switchover: 0.8,
  protection: "itm-c10g32",
  contactor: "itm-lc1d18p7",
  starContactor: "itm-lc1d09p7",
  overloadRelay: "itm-lrd21",
  softstarter: "itm-ats22d32q",
};
const CONVEYOR = {
  motor: "mot-c3",
  startingCurrentMax: 45,
  accelerationTimeMax: 5,
  stopTimeMax: 10,
  protection: "itm-c10g20",
  contactor: "itm-lc1d09p7",
  softstarter: "itm-ats22d32q",
  drive: "itm-atv930u75n4",
};
const run = (
  motors: unknown[],
  options: {
    model?: ElectricalModel;
    catalog?: IndustrialCatalog;
    protection?: ElectricalResult;
    extra?: Record<string, unknown>;
  } = {},
) =>
  analyzeMotorDrives({
    model: options.model ?? model,
    modelPath: "electrical-automation-model.json",
    modelSha256: "0".repeat(64),
    protection: options.protection ?? protection,
    network,
    catalog: options.catalog ?? catalog,
    catalogStamp: stamp,
    request: motorDrivesRequestSchema.parse({
      protection: protection.runId,
      catalog: "cat-motor-drives",
      ...options.extra,
      motors,
    }),
    runId: "20261115-120000-cccc",
    now: "2026-11-15T12:00:00Z",
  });

const find = (result: ElectricalResult, id: string, subject: string) => {
  const found = result.criteria.find((entry) => entry.id === id && entry.subject === subject);
  if (!found) throw Error(`no criterion ${id} for ${subject}`);
  return found;
};
const stored = (result: ElectricalResult, name: string, subject: string) =>
  result.intermediate.find((entry) => entry.name === name && entry.subject === subject)?.value;
/** The plant model with one motor's properties or attributes changed (null removes them). */
const edited = (
  motor: string,
  properties: Record<string, [number, string] | null>,
  attributes: Record<string, string | null> = {},
): ElectricalModel => {
  const copy = structuredClone(model);
  const object = copy.objects.find((entry) => entry.id === motor);
  if (!object) throw Error(`no ${motor}`);
  object.properties ??= {};
  object.attributes ??= {};
  for (const [key, value] of Object.entries(properties)) {
    if (value === null) delete object.properties[key];
    else object.properties[key] = { value: value[0], unit: value[1], basis: "input" };
  }
  for (const [key, value] of Object.entries(attributes)) {
    if (value === null) delete object.attributes[key];
    else object.attributes[key] = value;
  }
  return copy;
};
const within = (actual: number | null | undefined, expected: number, share: number) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual as number) - expected) / expected).toBeLessThanOrEqual(share);
};
const omegaRated = (rpm: number) => (2 * Math.PI * rpm) / 60;

describe("acceleration model against independent references (REQ-FUNC-31a5706e, REQ-TEST-c04129a0)", () => {
  it("matches closed-form hand calculations within 0.5 %", () => {
    // Constant accelerating torque A: t = J 2 pi / 60 x n / A.
    const constant = accelerationTime(1.2, 0, 1400, () => 50);
    within(constant.time, ((1.2 * 2 * Math.PI) / 60) * (1400 / 50), 0.005);
    // a(n) = A - B (n/ns)^2: t = J 2 pi / 60 x ns / sqrt(A B) x atanh(sqrt(B/A) x n/ns).
    const [A, B, ns, n, j] = [100, 50, 1500, 1400, 0.8];
    const closed =
      ((j * 2 * Math.PI) / 60) * (ns / Math.sqrt(A * B)) * Math.atanh(Math.sqrt(B / A) * (n / ns));
    within(accelerationTime(j, 0, n, (x) => A - B * (x / ns) ** 2).time, closed, 0.005);
    // A stall is the first speed where the accelerating torque is not positive (here 500 rpm).
    const stall = accelerationTime(1, 0, 1000, (x) => 10 - x / 50);
    expect(stall.time).toBeNull();
    expect(stall.stall).toBeGreaterThan(499);
    expect(stall.stall).toBeLessThan(501);
  });

  it("follows the Kloss curve through the rated point and the lower torque below breakdown speed", () => {
    const curve = { ns: 1500, nN: 1440, tn: 14.5892, tst: 33.555, tu: 29.178, tk: 43.768 };
    // sN = 0.04, k = 3.0, sk = 0.04 x (3 + sqrt(8)) = 0.233137, nk = 1500 x (1 - sk) = 1150.29 rpm.
    within(breakdownSpeed(curve), 1150.29, 0.0005);
    within(motorTorque(curve, 1440), 14.5892, 0.0005);
    within(motorTorque(curve, 1200), (2 * 43.768) / (0.2 / 0.233137 + 0.233137 / 0.2), 0.0005);
    expect(motorTorque(curve, 500)).toBe(29.178);
    expect(motorTorque({ ...curve, tu: null }, 500)).toBe(33.555);
  });

  it("is within 25 % of the ABB worked starting-time example for constant and quadratic loads", () => {
    // ABB, Three-phase asynchronous motors (worked example, read 2026-11-15): 160 kW, 4 poles, 1487 rpm, JM 2.9 +
    // JL 60 kg m2, Cs 2.4 CN, Cmax 2.9 CN, CL 1600 Nm: 11.6 s constant torque (KL 1), 5.14 s quadratic (KL 0.33).
    // The rated current is not part of the example and does not enter the acceleration.
    const abb = (characteristic: string) =>
      edited(
        "mot-c3",
        {
          ratedPower: [160, "kW"],
          ratedCurrent: [280, "A"],
          speed: [1487, "rpm"],
          startingTorqueRatio: [2.4, "1"],
          breakdownTorqueRatio: [2.9, "1"],
          pullUpTorqueRatio: null,
          inertia: [2.9, "kg·m²"],
          loadInertia: [60, "kg·m²"],
          loadTorque: [1600, "Nm"],
          breakawayTorque: [0, "Nm"],
          lockedRotorTime: null,
        },
        { loadCharacteristic: characteristic },
      );
    const constant = run([{ motor: "mot-c3" }], { model: abb("constant") });
    within(stored(constant, "ratedTorque", "mot-c3"), 1028, 0.001);
    within(stored(constant, "accelerationTime:dol", "mot-c3"), 11.6, 0.25);
    const quadratic = run([{ motor: "mot-c3" }], { model: abb("quadratic") });
    within(stored(quadratic, "accelerationTime:dol", "mot-c3"), 5.14, 0.25);
  });

  it("gives the VFD acceleration of the conveyor as J w / (Tv - Tl) by hand", () => {
    const result = run([CONVEYOR]);
    // Tn = 5500 / (2 pi 1455 / 60) = 36.0969 Nm; Tv = 19.8 / 11.2 x Tn = 63.8143 Nm; J = 0.022 + 0.5 kg m2.
    const tn = 5500 / omegaRated(1455);
    const tv = (19.8 / 11.2) * tn;
    within(stored(result, "startingTorque:vfd", "mot-c3"), tv, 0.005);
    within(stored(result, "accelerationTime:vfd", "mot-c3"), (0.522 * omegaRated(1455)) / (tv - 32.5), 0.005);
  });

  it("fails a star-delta start whose star torque stays below a constant load, and is unknown without inertia", () => {
    const delta = edited("mot-c3", {}, { connection: "delta" });
    const result = run([{ ...CONVEYOR, switchover: 0.8 }], { model: delta });
    // Star torque = Tu / 3 = 1.9 x 36.0969 / 3 = 22.861 Nm < 32.5 Nm.
    expect(find(result, "starting-torque:star-delta", "mot-c3").verdict).toBe("fail");
    const noInertia = run([PUMP], { model: edited("mot-p2", { loadInertia: null }) });
    expect(find(noInertia, "acceleration-time:star-delta", "mot-p2").verdict).toBe("unknown");
    expect(stored(noInertia, "accelerationTime:star-delta", "mot-p2")).toBeNull();
    expect(noInertia.messages.join(" ")).toContain("loadInertia");
  });
});

describe("three load fixtures (REQ-TEST-c04129a0, REQ-FUNC-179328ee, REQ-FUNC-270a3c8e)", () => {
  it("proposes DOL for the fan, star-delta for the pump and a VFD for the conveyor", () => {
    const result = run([FAN, PUMP, CONVEYOR], { extra: { ambientTemperature: 35 } });
    expect(checkResult(result, result.runId)).toHaveProperty("result");
    expect(result.conditions).toMatchObject({
      proposal1: { text: "mot-f1 dol" },
      proposal2: { text: "mot-p2 star-delta" },
      proposal3: { text: "mot-c3 vfd" },
    });
    expect(result.assemblies?.map((entry) => [entry.motor, entry.circuit, entry.method])).toEqual([
      ["mot-f1", "cir-m1", "dol"],
      ["mot-p2", "cir-m2", "star-delta"],
      ["mot-c3", "cir-m3", "vfd"],
    ]);
    // The pump: Ist 7.5 x 21.5 = 161.25 A fails 70 A; star 161.25 / 3 = 53.75 A passes.
    expect(find(result, "starting-current:dol", "mot-p2")).toMatchObject({
      verdict: "fail",
      measured: { value: 161.25 },
    });
    expect(find(result, "starting-current:star-delta", "mot-p2")).toMatchObject({
      verdict: "pass",
      measured: { value: 53.75 },
    });
    expect(find(result, "star-delta-eligibility:star-delta", "mot-p2").verdict).toBe("pass");
    // The conveyor does not admit star-delta (star at 400 V) and the softstarter stalls: Tu x (3.5/7)² = 17.15 Nm.
    expect(find(result, "star-delta-eligibility:star-delta", "mot-c3").verdict).toBe("fail");
    expect(find(result, "starting-torque:softstarter", "mot-c3")).toMatchObject({
      verdict: "fail",
      measured: { value: 17.1461 },
    });
    expect(find(result, "method:vfd", "mot-c3").verdict).toBe("pass");
    // Real public data leave the fuse and breaker selections open, so every proposal stays conditional.
    for (const motor of ["mot-f1", "mot-p2", "mot-c3"])
      expect(find(result, "proposal", motor).verdict).toBe("unknown");
    expect(result.assemblies?.every((entry) => entry.conditional)).toBe(true);
    expect(result.status).toBe("incomplete");
  });

  it("passes a proposal whose method and assembly are established, and makes it conditional without Tu", () => {
    const selected = structuredClone(protection);
    const selection = selected.criteria.find((entry) => entry.id === "selection:GV2ME10");
    if (!selection) throw Error("no selection");
    selection.verdict = "pass";
    const result = run([FAN], { protection: selected });
    expect(find(result, "proposal", "mot-f1").verdict).toBe("pass");
    expect(result.assemblies?.[0]?.conditional).toBe(false);
    const noPullUp = run([FAN], {
      protection: selected,
      model: edited("mot-f1", { pullUpTorqueRatio: null }),
    });
    expect(find(noPullUp, "starting-torque:dol", "mot-f1").verdict).toBe("unknown");
    expect(find(noPullUp, "proposal", "mot-f1").verdict).toBe("unknown");
    expect(noPullUp.assemblies?.[0]).toMatchObject({ method: "dol", conditional: true });
  });

  it("gives unknown star-delta eligibility without terminals", () => {
    const result = run([PUMP], { model: edited("mot-p2", { terminals: null }) });
    expect(find(result, "star-delta-eligibility:star-delta", "mot-p2").verdict).toBe("unknown");
  });
});

describe("process function (REQ-FUNC-30561076)", () => {
  it("fails every method but the VFD for speed control and leaves the proposal open without a drive", () => {
    const result = run([{ ...FAN, speedControl: true }]);
    for (const method of ["dol", "star-delta", "softstarter"])
      expect(find(result, `function:${method}`, "mot-f1").verdict).toBe("fail");
    expect(find(result, "function:vfd", "mot-f1").verdict).toBe("pass");
    expect(find(result, "method:vfd", "mot-f1").verdict).toBe("unknown");
    expect(find(result, "proposal", "mot-f1").verdict).toBe("unknown");
    expect(result.assemblies?.[0]?.method).toBe("vfd");
  });

  it("fails DOL and proposes reversing with a mechanical and an electrical interlock", () => {
    const result = run([{ ...FAN, reversing: true }]);
    expect(find(result, "function:dol", "mot-f1").verdict).toBe("fail");
    expect(find(result, "method:reversing", "mot-f1").verdict).toBe("pass");
    expect(find(result, "mechanical-interlock:LC1D09P7", "mot-f1").verdict).toBe("pass");
    const assembly = result.assemblies?.[0];
    expect(assembly?.method).toBe("reversing");
    expect(assembly?.devices.map((device) => device.orderCode)).toEqual(
      expect.arrayContaining(["GV2ME10", "LC1D09P7", "LAD9V2"]),
    );
    expect(assembly?.interlocks.map((lock) => lock.kind)).toEqual(["mechanical", "electrical"]);
  });

  it("keeps reversing not evaluated when only speed control is required", () => {
    const result = run([{ ...FAN, speedControl: true }]);
    expect(find(result, "function:reversing", "mot-f1").verdict).toBe("not-evaluated");
  });

  it("leaves a direct start's acceleration time unknown without the motor's locked-rotor time", () => {
    const result = run([{ ...FAN, accelerationTimeMax: 5 }], {
      model: edited("mot-f1", { lockedRotorTime: null }),
    });
    expect(find(result, "acceleration-time:dol", "mot-f1").verdict).toBe("unknown");
    expect(find(result, "acceleration-time:dol", "mot-f1").note).toContain("No locked-rotor time");
  });

  it("caps the softstarter line current at the direct-on-line starting current", () => {
    // currentLimit 8 x In is above Ist / In = 7: the line current stays 7 x 4.6 = 32.2 A.
    const result = run([{ ...FAN, softstarter: "itm-ats22d32q", currentLimit: 8 }]);
    expect(stored(result, "startingCurrent:softstarter", "mot-f1")).toBe(32.2);
  });

  it("does not pass a method without a stated starting-current limit", () => {
    const result = run([FAN]);
    expect(find(result, "starting-current:dol", "mot-f1")).toMatchObject({
      verdict: "not-evaluated",
      measured: { value: 32.2 },
    });
  });
});

describe("starter assembly (REQ-FUNC-12507326, REQ-FUNC-028689c0)", () => {
  it("sizes the star-delta contactors at In/sqrt(3) and In/3 with LAD9V2 and LRD21 at In/sqrt(3)", () => {
    const result = run([PUMP]);
    expect(find(result, "contactor-line:LC1D18P7", "mot-p2")).toMatchObject({
      verdict: "pass",
      limit: { value: 12.413 },
    });
    expect(find(result, "contactor-delta:LC1D18P7", "mot-p2").verdict).toBe("pass");
    expect(find(result, "contactor-star:LC1D09P7", "mot-p2")).toMatchObject({
      verdict: "pass",
      limit: { value: 7.16667 },
    });
    expect(find(result, "mechanical-interlock:LC1D09P7", "mot-p2").verdict).toBe("pass");
    expect(find(result, "overload-relay:LRD21", "mot-p2")).toMatchObject({
      verdict: "pass",
      measured: { value: 12.413 },
    });
    // Star stage: 7.5 / sqrt(3) = 4.33 x Ir < 7.2 x Ir and the start is shorter than 2 s (class 10A).
    expect(find(result, "overload-start:LRD21", "mot-p2").verdict).toBe("pass");
    const assembly = result.assemblies?.[0];
    expect(assembly?.devices.map((device) => [device.tag, device.role, device.orderCode])).toEqual([
      ["Q1", "protection", "C10G32"],
      ["KM1", "line-contactor", "LC1D18P7"],
      ["KM2", "delta-contactor", "LC1D18P7"],
      ["KM3", "star-contactor", "LC1D09P7"],
      ["KM2-KM3", "mechanical-interlock", "LAD9V2"],
      ["F1", "overload-relay", "LRD21"],
    ]);
    expect(assembly?.connections).toContainEqual({ from: "KM3", to: "motor:U2,V2,W2", kind: "power" });
    expect(assembly?.interlocks.map((lock) => lock.kind)).toEqual([
      "mechanical",
      "electrical",
      "sequence",
      "electrical",
    ]);
  });

  it("copies the protection verdicts and never recomputes them", () => {
    const result = run([PUMP]);
    const selection = protection.criteria.find(
      (entry) => entry.id === "selection:C10G32" && entry.subject === "cir-m2",
    );
    expect(find(result, "protection:C10G32", "mot-p2").verdict).toBe(selection?.verdict);
    const starter = protection.criteria.find((entry) => entry.id === "starter-type-2:C10G32/LC1D18P7");
    expect(find(result, "starter-coordination:C10G32/LC1D18P7", "mot-p2").verdict).toBe(starter?.verdict);
    const other = run([{ ...FAN, protection: "itm-c10g32" }]);
    expect(find(other, "protection:C10G32", "mot-f1").verdict).toBe("not-evaluated");
  });

  it("fails a contactor below its position current and leaves AC-4 inching unknown", () => {
    const small = run([{ ...PUMP, contactor: "itm-lc1d09p7" }]);
    // 12.413 A line current > 9 A AC-3.
    expect(find(small, "contactor-line:LC1D09P7", "mot-p2").verdict).toBe("fail");
    expect(find(small, "proposal", "mot-p2").verdict).toBe("fail");
    const inching = run([{ ...FAN, inching: true }]);
    expect(find(inching, "contactor-line:LC1D09P7", "mot-f1").verdict).toBe("unknown");
    expect(find(inching, "function:star-delta", "mot-f1").verdict).toBe("not-evaluated");
  });

  it("derates the softstarter by 2.2 %/K above 40 °C", () => {
    // The fan with a lighter load, so that the 3.5 In current limit still accelerates it.
    const light = edited("mot-f1", { loadTorque: [9, "Nm"] });
    const result = run([{ ...FAN, startingCurrentMax: 20, softstarter: "itm-ats22d32q" }], {
      model: light,
      extra: { ambientTemperature: 50 },
    });
    expect(result.assemblies?.[0]?.method).toBe("softstarter");
    // 32 A x (1 - 0.022 x 10) = 24.96 A.
    expect(find(result, "softstarter:ATS22D32Q", "mot-f1")).toMatchObject({
      verdict: "pass",
      measured: { value: 24.96 },
    });
    expect(result.assemblies?.[0]?.interlocks[0]?.note).toContain("internal bypass");
  });
});

describe("drive selection (REQ-FUNC-f19b1719)", () => {
  it("selects the duty class by current and overload and reports braking, EMC and cable from data", () => {
    const result = run([CONVEYOR]);
    const drive = find(result, "drive-current:ATV930U75N4", "mot-c3");
    expect(drive.verdict).toBe("pass");
    // Needed: (32.5 + 0.522 x 152.367 / 5) / 36.0969 x 11.2 = 15.02 A <= 19.8 A transient; 16.5 A >= 11.2 A.
    expect(drive.note).toContain("Duty normal selected (by current, not by power)");
    expect(drive.note).toContain("15.0195 A needed");
    expect(find(result, "motor-cable:ATV930U75N4", "mot-c3").verdict).toBe("unknown");
    expect(find(result, "emc:ATV930U75N4", "mot-c3").verdict).toBe("unknown");
    expect(find(result, "braking:ATV930U75N4", "mot-c3").verdict).toBe("unknown");
    // 0.5 x 0.522 x 152.367² = 6059.3 J.
    within(stored(result, "brakingEnergy", "mot-c3"), 0.5 * 0.522 * omegaRated(1455) ** 2, 0.005);
    expect(result.assemblies?.[0]?.devices.map((device) => device.role)).toEqual([
      "protection",
      "drive",
      "braking-resistor",
    ]);
  });

  it("asks for an overload relay when the drive data do not state motor thermal protection", () => {
    const plain = structuredClone(catalog);
    const drive = plain.items.find((item) => item.id === "itm-atv930u75n4");
    if (!drive?.attributes) throw Error("no drive");
    delete drive.attributes.motorThermalProtection;
    const result = run([CONVEYOR], { catalog: plain });
    expect(find(result, "overload-relay", "mot-c3").verdict).toBe("unknown");
    expect(result.assemblies?.[0]?.devices.map((device) => device.role)).toContain("overload-relay");
    const relayed = run([{ ...CONVEYOR, overloadRelay: "itm-lrd21" }], { catalog: plain });
    // 11.2 A is below the LRD21 range 12..18 A.
    expect(find(relayed, "overload-relay:LRD21", "mot-c3").verdict).toBe("fail");
  });

  it("fails a 7.5 kW drive for a 7.5 kW motor whose current and overload it does not reach", () => {
    const tn = 7500 / omegaRated(1455);
    const big = edited("mot-c3", {
      ratedPower: [7.5, "kW"],
      ratedCurrent: [15.5, "A"],
      loadTorque: [tn, "Nm"],
    });
    const result = run([{ ...CONVEYOR, accelerationTimeMax: 3 }], { model: big });
    // Needed (Tn + 0.522 x 152.367 / 3) / Tn x 15.5 = 23.85 A > 19.8 A; heavy duty 12.7 A < 15.5 A.
    expect(find(result, "drive-current:ATV930U75N4", "mot-c3").verdict).toBe("fail");
  });
});

describe("request, result and report (REQ-DATA-79118f9a, REQ-DATA-e3d5c15f, REQ-FUNC-285949c8)", () => {
  it("refuses invalid requests before anything is evaluated", () => {
    expect(() => run([{ ...FAN, colour: "red" }])).toThrow();
    expect(() => run([{ motor: "cir-m1" }])).toThrow("cir-m1 is not a motor of the model");
    expect(() => run([{ ...FAN, drive: "itm-nope" }])).toThrow(
      "itm-nope is not an item of catalog cat-motor-drives",
    );
    expect(() => run([FAN, FAN])).toThrow("motors must be unique");
    expect(() => run([FAN, PUMP, CONVEYOR, { motor: "mot-x" }, { motor: "mot-y" }])).toThrow(
      "name 1..4 motors",
    );
    const unfed = structuredClone(model);
    unfed.relations = unfed.relations.filter((relation) => relation.to !== "mot-f1");
    expect(() => run([FAN], { model: unfed })).toThrow("mot-f1 is not fed by exactly one circuit");
  });

  it("returns the same result for the same inputs and copies the inputs it read", () => {
    const first = run([FAN, PUMP, CONVEYOR]);
    expect(run([FAN, PUMP, CONVEYOR])).toEqual(first);
    const ids = first.inputs.map((entry) => entry.id);
    expect(ids).toEqual(
      expect.arrayContaining(["mot-f1", "mot-p2", "mot-c3", "cir-m2", "cbl-m3", "rel-m2-p2"]),
    );
    expect(first.producer).toEqual({
      plugin: "motor-drives",
      operation: "motor-starting",
      engine: { name: "vera-motor-drives", version: "1.0.0" },
    });
  });

  it("accepts only strict assemblies and lists them in the report", () => {
    const result = run([PUMP]);
    const report = renderResultReport(result, { freshness: "current", changed: [], removed: [] }, model);
    expect(report).toContain("## Assembly M2 (mot-p2) - star-delta (conditional)");
    expect(report).toContain("| KM3 | star-contactor | LC1D09P7 |");
    expect(report).toContain("mechanical interlock KM2/KM3");
    const bad = (change: (copy: ElectricalResult) => void) => {
      const copy = structuredClone(result);
      change(copy);
      return checkResult(copy, copy.runId);
    };
    expect(
      bad((copy) => {
        (copy.assemblies?.[0]?.connections[0] as { kind: string }).kind = "pneumatic";
      }),
    ).toMatchObject({ problem: { path: "assemblies[0].connections[0].kind" } });
    expect(
      bad((copy) => {
        const devices = copy.assemblies?.[0]?.devices ?? [];
        while (devices.length < 17)
          devices.push({ tag: `X${devices.length}`, role: "spare", item: null, orderCode: null });
      }),
    ).toHaveProperty("problem");
    expect(
      bad((copy) => {
        (copy.assemblies?.[0] as Record<string, unknown>).drawing = "x";
      }),
    ).toHaveProperty("problem");
  });
});
