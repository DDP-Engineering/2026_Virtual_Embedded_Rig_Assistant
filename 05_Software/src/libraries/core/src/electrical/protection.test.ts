// The LV protection engine (spec REQ-DATA-a5673202) on network A and the cited protection fixture. Every limit is
// written out as a hand calculation before the verdict is asserted; synthetic catalog values are added in memory
// only, with a fictional source, to reach the branches the public pages give no data for.
import { readFile } from "node:fs/promises";
import type { CatalogItem, ElectricalModel, ElectricalResult, IndustrialCatalog } from "@vera/shared";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCableTable } from "./cable-table.js";
import { type CatalogStamp, parseCatalog } from "./catalog.js";
import { parseModel } from "./model.js";
import { analyzeNetwork } from "./network.js";
import { analyzeProtection, protectionRequestSchema } from "./protection.js";

const fixtures = new URL("../../../../../tests/fixtures/", import.meta.url);
let model: ElectricalModel;
let network: ElectricalResult;
let catalog: IndustrialCatalog;
const stamp: CatalogStamp = {
  id: "cat-lv-protection",
  version: "2026-11-15.1",
  sha256: "b".repeat(64),
  path: "electrical-automation-catalogs/cat-lv-protection.json",
};
const K = 115; // tbl-test-cu-pvc, copper PVC

beforeAll(async () => {
  model = parseModel(await readFile(new URL("electrical-network/network-a.json", fixtures), "utf8"));
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
    await readFile(new URL("protection-coordination/cat-lv-protection.json", fixtures), "utf8"),
    "cat-lv-protection",
  );
});

interface Options {
  model?: ElectricalModel;
  network?: ElectricalResult;
  catalog?: IndustrialCatalog;
  k?: number | null;
}
const run = (
  /** A raw request, parsed by the schema like the tool does. */
  request: { circuits: unknown[] } & Record<string, unknown>,
  options: Options = {},
) =>
  analyzeProtection({
    model: options.model ?? model,
    modelPath: "electrical-automation-model.json",
    modelSha256: "0".repeat(64),
    network: options.network ?? network,
    catalog: options.catalog ?? catalog,
    catalogStamp: stamp,
    cable: { k: options.k === undefined ? K : options.k, text: "tbl-test-cu-pvc 1 sha256 aaaaaaaaaaaaaaaa" },
    request: protectionRequestSchema.parse({
      network: "20261115-100000-aaaa",
      catalog: "cat-lv-protection",
      breakingCapacity: "Icu",
      ...request,
    }),
    runId: "20261115-110000-bbbb",
    now: "2026-11-15T11:00:00Z",
  });
const find = (result: ElectricalResult, id: string, subject?: string) => {
  const found = result.criteria.find((entry) => entry.id === id && (!subject || entry.subject === subject));
  if (!found) throw Error(`no criterion ${id} in ${result.criteria.map((entry) => entry.id).join(", ")}`);
  return found;
};
const storedValue = (result: ElectricalResult, name: string, subject: string) =>
  result.intermediate.find((entry) => entry.name === name && entry.subject === subject)?.value;
/** The network result with one stored value replaced. */
const withValue = (name: string, subject: string, value: number | null): ElectricalResult => {
  const copy = structuredClone(network);
  const entry = copy.intermediate.find((item) => item.name === name && item.subject === subject);
  if (!entry) throw Error(`no ${name} for ${subject}`);
  entry.value = value;
  return copy;
};
const FICTIONAL = {
  id: "src-test-fictional",
  kind: "other" as const,
  title: "Fictional values for the protection tests",
  publisher: "VERA tests",
  license: "Fictional test data, no product",
};
/** The catalog with extra (fictional) parameters, items or tables, built in memory. */
function edited(change: (copy: IndustrialCatalog) => void): IndustrialCatalog {
  const copy = structuredClone(catalog);
  copy.sources.push(FICTIONAL);
  change(copy);
  return parseCatalog(JSON.stringify(copy), "cat-lv-protection");
}
const fictional = (name: string, value: number, unit: string, conditions?: Record<string, unknown>) =>
  ({
    name,
    value,
    unit,
    basis: "input",
    ...(conditions ? { conditions } : {}),
    source: { id: FICTIONAL.id },
    status: "confirmed",
  }) as CatalogItem["parameters"][number];
const item = (copy: IndustrialCatalog, id: string) =>
  copy.items.find((entry) => entry.id === id) as CatalogItem;

describe("network A inputs the oracles start from", () => {
  it("reads Ib, Iz and the fault currents from the stored network result", () => {
    expect(storedValue(network, "ik3MaxStart", "cir-f1")).toBeCloseTo(16.1502, 3); // kA at the main board
    expect(storedValue(network, "ik3MaxStart", "cir-l1")).toBeCloseTo(6.3986, 3); // kA at the sub-board
    expect(storedValue(network, "ik1MinEnd", "cir-l1")).toBeCloseTo(0.213816, 5); // kA at the lighting end
    expect(storedValue(network, "designCurrent", "cir-l1")).toBeCloseTo(9.11606, 4);
    expect(storedValue(network, "currentCapacity", "cbl-w3")).toBe(30);
    expect(storedValue(network, "designCurrent", "cir-m1")).toBeCloseTo(20.7544, 3);
  });
});

describe("breaking capacity (REQ-FUNC-b65fb9ee)", () => {
  it("compares Icu at the circuit voltage with Ik3max at the origin", () => {
    const result = run({
      circuits: [{ circuit: "cir-f1", candidates: ["itm-a9f74340", "itm-gv2me14", "itm-c10g32"] }],
    });
    // 3P circuit at Un 400 V: iC60N Icu 10 kA (380..415 V) < 16.1502 kA; GV2ME14 100 kA (400/415 V); fuse 120 kA.
    expect(find(result, "breaking-capacity:A9F74340")).toMatchObject({
      verdict: "fail",
      measured: { value: 10, unit: "kA" },
      limit: { value: 16.1502, unit: "kA" },
    });
    expect(find(result, "breaking-capacity:GV2ME14")).toMatchObject({
      verdict: "pass",
      measured: { value: 100 },
    });
    expect(find(result, "breaking-capacity:C10G32")).toMatchObject({
      verdict: "pass",
      measured: { value: 120 },
    });
  });

  it("uses Ics directly or as ratio x Icu, and Icn only at its own voltage", () => {
    const ics = run({
      breakingCapacity: "Ics",
      circuits: [{ circuit: "cir-f1", candidates: ["itm-a9f74340", "itm-gv2me14"] }],
    });
    expect(find(ics, "breaking-capacity:A9F74340")).toMatchObject({
      verdict: "fail",
      measured: { value: 7.5 },
    });
    // GV2ME14: Ics = 100 % x Icu 100 kA at 400/415 V = 100 kA.
    expect(find(ics, "breaking-capacity:GV2ME14")).toMatchObject({
      verdict: "pass",
      measured: { value: 100 },
    });
    const icn = run({
      breakingCapacity: "Icn",
      circuits: [
        { circuit: "cir-m1", candidates: ["itm-a9f74316"] },
        { circuit: "cir-l1", candidates: ["itm-a9f74216", "itm-c10g20"] },
      ],
    });
    // Icn 6000 A at 400 V < Ik3max 6398.6 A at the sub-board.
    expect(find(icn, "breaking-capacity:A9F74316")).toMatchObject({
      verdict: "fail",
      measured: { value: 6000 },
    });
    // A single-phase circuit at U0 = 400/sqrt(3) = 230.9 V: Icn is stated at 400 V only.
    expect(find(icn, "breaking-capacity:A9F74216")).toMatchObject({ verdict: "unknown" });
    expect(find(icn, "breaking-capacity:A9F74216").note).toContain("conditions");
    // A fuse link is always rated by its rated breaking capacity.
    expect(find(icn, "breaking-capacity:C10G20")).toMatchObject({
      verdict: "pass",
      measured: { value: 120 },
    });
  });

  it("never reads the generic breakingCapacity, which names no capacity kind", () => {
    const generic = edited((copy) => {
      const mcb = item(copy, "itm-a9f74316");
      mcb.parameters = mcb.parameters.filter((parameter) => parameter.name !== "ultimateBreakingCapacity");
      mcb.parameters.push(fictional("breakingCapacity", 50, "kA"));
    });
    const result = run(
      { circuits: [{ circuit: "cir-m1", candidates: ["itm-a9f74316"] }] },
      { catalog: generic },
    );
    expect(find(result, "breaking-capacity:A9F74316")).toMatchObject({ verdict: "unknown" });
  });
});

describe("overload (REQ-FUNC-f24b4131)", () => {
  it("passes Ib <= In <= Iz and I2 <= 1.45 Iz", () => {
    const result = run({ circuits: [{ circuit: "cir-l1", candidates: ["itm-a9f74216", "itm-c10g20"] }] });
    // Ib 9.116 A <= In 16 A <= Iz 30 A; I2 = 1.45 x 16 = 23.2 A <= 1.45 x 30 = 43.5 A.
    expect(find(result, "rated-current:A9F74216")).toMatchObject({
      verdict: "pass",
      measured: { value: 16, unit: "A" },
      limit: { value: 30, unit: "A" },
    });
    expect(find(result, "conventional-tripping:A9F74216")).toMatchObject({
      verdict: "pass",
      measured: { value: 23.2, unit: "A" },
      limit: { value: 43.5, unit: "A" },
    });
  });

  it("fails a gG fuse whose I2 exceeds 1.45 Iz although In <= Iz", () => {
    const result = run(
      { circuits: [{ circuit: "cir-l1", candidates: ["itm-c10g20"] }] },
      { network: withValue("currentCapacity", "cbl-w3", 21) },
    );
    // In 20 A <= Iz 21 A, but I2 = 1.6 x 20 = 32 A > 1.45 x 21 = 30.45 A.
    expect(find(result, "rated-current:C10G20")).toMatchObject({ verdict: "pass" });
    expect(find(result, "conventional-tripping:C10G20")).toMatchObject({
      verdict: "fail",
      measured: { value: 32 },
      limit: { value: 30.45 },
    });
  });

  it("compares Iz and I2 with the largest cited rated current and Ib with the smallest", () => {
    // A fictional derated value: In 16 A, 13 A at 60 °C. Iz 15 A: In 16 A > Iz although 13 A <= 15 A;
    // I2 = 1.45 x 16 = 23.2 A > 1.45 x 15 = 21.75 A.
    const derated = edited((copy) => {
      item(copy, "itm-a9f74216").parameters.push(
        fictional("ratedCurrent", 13, "A", { ambientTemperature: { value: 60, unit: "°C" } }),
      );
    });
    const circuits = [{ circuit: "cir-l1", candidates: ["itm-a9f74216"] }];
    const small = run(
      { circuits },
      { catalog: derated, network: withValue("currentCapacity", "cbl-w3", 15) },
    );
    expect(find(small, "rated-current:A9F74216")).toMatchObject({
      verdict: "fail",
      measured: { value: 16, unit: "A" },
      limit: { value: 15, unit: "A" },
    });
    expect(find(small, "rated-current:A9F74216").note).toContain("from 13 A to 16 A");
    expect(find(small, "conventional-tripping:A9F74216")).toMatchObject({
      verdict: "fail",
      measured: { value: 23.2 },
      limit: { value: 21.75 },
    });
    // Ib 14 A is above the derated 13 A: not established as carried, although In 16 A <= Iz 30 A.
    const loaded = run({ circuits }, { catalog: derated, network: withValue("designCurrent", "cir-l1", 14) });
    expect(find(loaded, "rated-current:A9F74216")).toMatchObject({ verdict: "fail" });
  });

  it("checks an adjustable device at its requested setting inside the cited range", () => {
    const outside = run({
      circuits: [{ circuit: "cir-m1", candidates: ["itm-gv2me14"], setting: 11 }],
    });
    expect(find(outside, "rated-current:GV2ME14")).toMatchObject({ verdict: "fail" });
    expect(find(outside, "rated-current:GV2ME14").note).toContain("6..10 A");
    // Setting 10 A is inside 6..10 A but below Ib 20.75 A.
    const low = run({
      circuits: [{ circuit: "cir-m1", candidates: ["itm-gv2me14"], setting: 10 }],
    });
    expect(find(low, "rated-current:GV2ME14")).toMatchObject({ verdict: "fail", measured: { value: 10 } });
    const none = run({ circuits: [{ circuit: "cir-m1", candidates: ["itm-gv2me14"] }] });
    expect(find(none, "rated-current:GV2ME14")).toMatchObject({ verdict: "unknown" });
  });

  it("leaves I2 unknown where the cited guide gives no ratio (gG 16 A) and Ib unknown when the network has none", () => {
    const result = run({ circuits: [{ circuit: "cir-l1", candidates: ["itm-c10g16"] }] });
    expect(find(result, "conventional-tripping:C10G16")).toMatchObject({ verdict: "unknown" });
    const noIb = run(
      { circuits: [{ circuit: "cir-l1", candidates: ["itm-a9f74216"] }] },
      { network: withValue("designCurrent", "cir-l1", null) },
    );
    expect(find(noIb, "rated-current:A9F74216")).toMatchObject({ verdict: "unknown" });
  });
});

describe("disconnection time (REQ-FUNC-b9c2bc7d)", () => {
  const lighting = (extra: Record<string, unknown> = {}) => ({
    circuits: [
      {
        circuit: "cir-l1",
        candidates: ["itm-a9f74216"],
        disconnectionTime: 0.4,
        ...extra,
      },
    ],
  });
  it("passes when Ik1min reaches the upper edge of the instantaneous band with a stated operating time", () => {
    const result = run({ ...lighting(), assumedInstantaneousTripTime: 0.1 });
    // Upper edge 8 x 16 A x (1 + 20 %) = 153.6 A <= Ik1min 213.816 A, operating time 0.1 s <= 0.4 s.
    expect(find(result, "disconnection-time:A9F74216")).toMatchObject({
      verdict: "pass",
      measured: { value: 213.816, unit: "A" },
      limit: { value: 153.6, unit: "A" },
    });
    expect(result.assumptions.join(" ")).toContain("0.1 s");
  });

  it("is unknown below the band edge without a point at the required time, and without an operating time", () => {
    const below = run(
      { ...lighting(), assumedInstantaneousTripTime: 0.1 },
      { network: withValue("ik1MinEnd", "cir-l1", 0.12) },
    );
    expect(find(below, "disconnection-time:A9F74216")).toMatchObject({ verdict: "unknown" });
    const untimed = run(lighting());
    expect(find(untimed, "disconnection-time:A9F74216")).toMatchObject({ verdict: "unknown" });
    expect(find(untimed, "disconnection-time:A9F74216").note).toContain("operating time");
  });

  it("is unknown for average curves and a magnetic current without tolerance (GV2ME14)", () => {
    const result = run({
      assumedInstantaneousTripTime: 0.1,
      circuits: [
        {
          circuit: "cir-m1",
          candidates: ["itm-gv2me14"],
          setting: 10,
          disconnectionTime: 5,
        },
      ],
    });
    expect(find(result, "disconnection-time:GV2ME14")).toMatchObject({ verdict: "unknown" });
    expect(find(result, "disconnection-time:GV2ME14").note).toContain("tolerance");
  });

  it("fails below a band point given at exactly the required time and passes above it", () => {
    const gated = edited((copy) => {
      item(copy, "itm-c10g20").parameters.push(
        fictional("tripCurrentMax", 80, "A", { tripTime: { value: 5, unit: "s" } }),
      );
    });
    const at = (kA: number) =>
      run(
        {
          circuits: [{ circuit: "cir-l1", candidates: ["itm-c10g20"], disconnectionTime: 5 }],
        },
        { catalog: gated, network: withValue("ik1MinEnd", "cir-l1", kA) },
      );
    // A point stated for other conditions (here DC) does not cover the AC circuit.
    const dc = edited((copy) => {
      item(copy, "itm-c10g20").parameters.push(
        fictional("tripCurrentMax", 80, "A", {
          tripTime: { value: 5, unit: "s" },
          currentKind: { text: "DC" },
        }),
      );
    });
    const offCondition = run(
      { circuits: [{ circuit: "cir-l1", candidates: ["itm-c10g20"], disconnectionTime: 5 }] },
      { catalog: dc, network: withValue("ik1MinEnd", "cir-l1", 0.09) },
    );
    expect(find(offCondition, "disconnection-time:C10G20")).toMatchObject({ verdict: "unknown" });
    expect(find(offCondition, "disconnection-time:C10G20").note).toContain("other conditions");
    expect(find(at(0.07), "disconnection-time:C10G20")).toMatchObject({
      verdict: "fail",
      limit: { value: 80 },
    });
    expect(find(at(0.09), "disconnection-time:C10G20")).toMatchObject({ verdict: "pass" });
  });

  it("is not evaluated without a required disconnection time", () => {
    const result = run({ circuits: [{ circuit: "cir-l1", candidates: ["itm-a9f74216"] }] });
    expect(find(result, "disconnection-time:A9F74216")).toMatchObject({ verdict: "not-evaluated" });
  });
});

describe("let-through energy (REQ-FUNC-884410b3)", () => {
  const withI2t = (value: number, ikMax: number) =>
    edited((copy) => {
      item(copy, "itm-c10g20").parameters.push(
        fictional("letThroughEnergy", value, "A²s", {
          prospectiveCurrentMax: { value: ikMax, unit: "kA" },
          voltageMax: { value: 500, unit: "V" },
        }),
      );
    });
  const lighting = { circuits: [{ circuit: "cir-l1", candidates: ["itm-c10g20"] }] };
  it("compares the cited I2t covering Ik3max with k²S²", () => {
    // k²S² = 115² x 2.5² = 82 656.25 A²s; Ik3max 6.3986 kA at the origin, U0 230.9 V.
    expect(find(run(lighting, { catalog: withI2t(30000, 25) }), "let-through-energy:C10G20")).toMatchObject({
      verdict: "pass",
      measured: { value: 30000, unit: "A²s" },
      limit: { value: 82656.3, unit: "A²s" },
    });
    expect(find(run(lighting, { catalog: withI2t(100000, 25) }), "let-through-energy:C10G20")).toMatchObject({
      verdict: "fail",
    });
  });

  it("is unknown when no cited value covers Ik3max, the fixture has none or k is unknown", () => {
    expect(find(run(lighting, { catalog: withI2t(30000, 5) }), "let-through-energy:C10G20")).toMatchObject({
      verdict: "unknown",
    });
    expect(find(run(lighting), "let-through-energy:C10G20")).toMatchObject({ verdict: "unknown" });
    expect(
      find(run(lighting, { catalog: withI2t(30000, 25), k: null }), "let-through-energy:C10G20"),
    ).toMatchObject({ verdict: "unknown" });
  });
});

describe("coordination from manufacturer tables only (REQ-FUNC-894dce2a)", () => {
  const motor = (protection: string, type: 1 | 2 = 2) => ({
    circuits: [{ circuit: "cir-m1", candidates: [protection], setting: 10 }],
    starters: [{ circuit: "cir-m1", protection, contactor: "itm-lc1d09p7", type }],
  });
  it("keeps a real type-2 fuse entry unknown because the table states no prospective current", () => {
    const result = run(motor("itm-c10g20"));
    // LC1D09P7 type 2: gG <= 20 A at <= 690 V (se.com); the fuse is gG 20 A.
    const starter = find(result, "starter-type-2:C10G20/LC1D09P7");
    expect(starter.verdict).toBe("unknown");
    expect(starter.note).toContain("prospectiveCurrent");
    expect(starter.limit).toEqual({ value: 20, unit: "A" });
    expect(find(run(motor("itm-c10g20", 1)), "starter-type-1:C10G20/LC1D09P7")).toMatchObject({
      verdict: "unknown",
      limit: { value: 25, unit: "A" },
    });
  });

  it("fails a fuse above the table rating and passes when the table covers the prospective current", () => {
    expect(find(run(motor("itm-c10g32")), "starter-type-2:C10G32/LC1D09P7")).toMatchObject({
      verdict: "fail",
    });
    const covered = edited((copy) => {
      const table = copy.coordination.find((entry) => entry.id === "tbl-lc1d-fuse-type2");
      if (table) table.conditions.prospectiveCurrentMax = { value: 50, unit: "kA" };
    });
    expect(
      find(run(motor("itm-c10g20"), { catalog: covered }), "starter-type-2:C10G20/LC1D09P7"),
    ).toMatchObject({ verdict: "pass" });
  });

  it("keeps a table rating that names no fuse class unknown", () => {
    const classless = edited((copy) => {
      for (const table of copy.coordination) {
        table.conditions.prospectiveCurrentMax = { value: 50, unit: "kA" }; // would pass with a class
        for (const entry of table.entries)
          for (const parameter of entry.parameters) delete parameter.conditions;
      }
    });
    expect(
      find(run(motor("itm-c10g20"), { catalog: classless }), "starter-type-2:C10G20/LC1D09P7"),
    ).toMatchObject({ verdict: "unknown" });
  });

  it("does not evaluate a breaker and contactor pair without a breaker coordination table", () => {
    const result = run(motor("itm-gv2me14"));
    expect(find(result, "starter-type-2:GV2ME14/LC1D09P7")).toMatchObject({ verdict: "not-evaluated" });
  });

  it("evaluates selectivity only from a selectivity table, never from curves", () => {
    const pair = {
      circuits: [
        { circuit: "cir-f1", candidates: ["itm-a9f74340"] },
        { circuit: "cir-l1", candidates: ["itm-a9f74216", "itm-c10g20"] },
      ],
      coordination: [
        {
          kind: "selectivity" as const,
          upstream: "cir-f1",
          upstreamItem: "itm-a9f74340",
          downstream: "cir-l1",
          downstreamItem: "itm-a9f74216",
        },
        {
          kind: "selectivity" as const,
          upstream: "cir-f1",
          upstreamItem: "itm-a9f74340",
          downstream: "cir-l1",
          downstreamItem: "itm-c10g20",
        },
      ],
    };
    const table = (kA: number) =>
      edited((copy) => {
        copy.coordination.push({
          id: "tbl-test-selectivity",
          title: "Fictional selectivity table",
          kind: "selectivity",
          conditions: { voltageMax: { value: 415, unit: "V" } },
          entries: [
            {
              items: ["itm-a9f74340", "itm-a9f74216"],
              parameters: [fictional("selectivityLimit", kA, "kA")],
            },
          ],
        });
      });
    // Downstream Ik3max 6.3986 kA at the sub-board.
    const total = run(pair, { catalog: table(10) });
    expect(find(total, "selectivity:A9F74340/A9F74216")).toMatchObject({
      verdict: "pass",
      measured: { value: 10 },
    });
    expect(find(total, "selectivity:A9F74340/C10G20")).toMatchObject({ verdict: "not-evaluated" });
    expect(find(run(pair, { catalog: table(3) }), "selectivity:A9F74340/A9F74216")).toMatchObject({
      verdict: "fail",
    });
    // A table entry is directional: [A9F74216 upstream, A9F74340 downstream] says nothing about the requested order.
    const reversed = edited((copy) => {
      copy.coordination.push({
        id: "tbl-test-selectivity",
        title: "Fictional selectivity table",
        kind: "selectivity",
        conditions: { voltageMax: { value: 415, unit: "V" } },
        entries: [
          { items: ["itm-a9f74216", "itm-a9f74340"], parameters: [fictional("selectivityLimit", 10, "kA")] },
        ],
      });
    });
    const swapped = find(run(pair, { catalog: reversed }), "selectivity:A9F74340/A9F74216");
    expect(swapped.verdict).toBe("not-evaluated");
    expect(swapped.note).toContain("reverse direction");
    // The upstream circuit must feed the downstream one.
    expect(() =>
      run({
        ...pair,
        coordination: [
          {
            kind: "selectivity",
            upstream: "cir-l1",
            upstreamItem: "itm-a9f74216",
            downstream: "cir-f1",
            downstreamItem: "itm-a9f74340",
          },
        ],
      }),
    ).toThrow("cir-l1 does not feed cir-f1");
  });
});

describe("RCD (REQ-FUNC-870b4cdc)", () => {
  const rcds = () =>
    edited((copy) => {
      copy.families.push({
        id: "fam-test-rcd",
        manufacturer: "Test",
        name: "Fictional RCDs",
        category: "residual-current-device",
      });
      for (const [code, type, mA] of [
        ["TESTRCDA30", "A", 30],
        ["TESTRCDB300", "B", 300],
      ] as const)
        copy.items.push({
          id: `itm-${code.toLowerCase()}`,
          family: "fam-test-rcd",
          orderCode: code,
          attributes: { rcdType: type, poles: "4P" },
          parameters: [fictional("residualOperatingCurrent", mA, "mA")],
        });
    });
  const drive = () => {
    const copy = structuredClone(model);
    const motor = copy.objects.find((object) => object.id === "mot-p1");
    if (motor) motor.attributes = { ...motor.attributes, rcdTypes: "B" };
    return copy;
  };
  const circuit = (extra: Record<string, unknown>) => ({
    circuits: [{ circuit: "cir-m1", candidates: ["itm-c10g20"], ...extra }],
  });
  it("checks the RCD type against the equipment's allowed types", () => {
    const options = { catalog: rcds(), model: drive() };
    expect(find(run(circuit({ rcd: "itm-testrcda30" }), options), "rcd-type", "cir-m1").verdict).toBe("fail");
    expect(find(run(circuit({ rcd: "itm-testrcdb300" }), options), "rcd-type", "cir-m1").verdict).toBe(
      "pass",
    );
    expect(find(run(circuit({}), options), "rcd-type", "cir-m1").verdict).toBe("fail");
  });

  it("checks the sensitivity against the profile maximum and leaves the type alone when the equipment states none", () => {
    const options = { catalog: rcds() };
    const max = { residualCurrentMax: 30 };
    expect(find(run(circuit({ rcd: "itm-testrcda30", ...max }), options), "rcd-sensitivity").verdict).toBe(
      "pass",
    );
    expect(find(run(circuit({ rcd: "itm-testrcdb300", ...max }), options), "rcd-sensitivity").verdict).toBe(
      "fail",
    );
    expect(find(run(circuit({ rcd: "itm-testrcda30" }), options), "rcd-type").verdict).toBe("not-evaluated");
  });
});

describe("missing data never passes (REQ-REL-8f88c502)", () => {
  it("does not evaluate a product of another kind and keeps extracted values unknown", () => {
    const extracted = edited((copy) => {
      for (const parameter of item(copy, "itm-c10g20").parameters)
        if (parameter.name === "ratedBreakingCapacity") parameter.status = "extracted";
    });
    const result = run(
      { circuits: [{ circuit: "cir-l1", candidates: ["itm-lc1d09p7", "itm-c10g20"] }] },
      { catalog: extracted },
    );
    expect(find(result, "device-kind:LC1D09P7")).toMatchObject({ verdict: "not-evaluated" });
    expect(result.criteria.some((entry) => entry.id === "breaking-capacity:LC1D09P7")).toBe(false);
    expect(find(result, "breaking-capacity:C10G20")).toMatchObject({ verdict: "unknown" });
    expect(find(result, "selection:C10G20")).toMatchObject({ verdict: "unknown" });
    expect(result.status).toBe("incomplete");
  });

  it("selects a candidate only when every criterion passes and completes such a run", () => {
    const complete = edited((copy) => {
      item(copy, "itm-c10g20").parameters.push(
        fictional("tripCurrentMax", 120, "A", { tripTime: { value: 0.4, unit: "s" } }),
        fictional("letThroughEnergy", 30000, "A²s", {
          prospectiveCurrentMax: { value: 25, unit: "kA" },
          voltageMax: { value: 500, unit: "V" },
        }),
      );
    });
    const result = run(
      {
        circuits: [{ circuit: "cir-l1", candidates: ["itm-c10g20"], disconnectionTime: 0.4 }],
      },
      { catalog: complete },
    );
    expect(result.criteria.filter((entry) => entry.verdict !== "pass")).toEqual([]);
    expect(find(result, "selection:C10G20").verdict).toBe("pass");
    expect(result.status).toBe("completed");
    const failing = run({ circuits: [{ circuit: "cir-f1", candidates: ["itm-a9f74340"] }] });
    expect(find(failing, "selection:A9F74340").verdict).toBe("fail");
  });
});

describe("request (REQ-DATA-a5673202)", () => {
  const circuits = [{ circuit: "cir-l1", candidates: ["itm-a9f74216"] }];
  it("refuses unknown keys, too many candidates and entries outside the model or catalog", () => {
    expect(() => run({ circuits, extra: 1 } as never)).toThrow();
    const many = ["itm-a9f74316", "itm-a9f74216", "itm-a9f74340", "itm-c10g16", "itm-c10g20", "itm-c10g32"];
    expect(() =>
      run({
        circuits: [
          { circuit: "cir-f1", candidates: many },
          { circuit: "cir-m1", candidates: many },
          { circuit: "cir-l1", candidates: many },
        ],
      }),
    ).toThrow(/16 candidates/);
    expect(() => run({ circuits: [{ circuit: "brd-main", candidates: ["itm-a9f74216"] }] })).toThrow(
      "brd-main is not a circuit of the model",
    );
    expect(() => run({ circuits: [{ circuit: "cir-l1", candidates: ["itm-nothing"] }] })).toThrow(
      "itm-nothing is not an item of catalog cat-lv-protection",
    );
    expect(() =>
      run({ circuits: [{ circuit: "cir-l1", protection: "prt-q1", candidates: ["itm-a9f74216"] }] }),
    ).toThrow("prt-q1 does not protect cir-l1");
    expect(() =>
      run({
        circuits,
        starters: [{ circuit: "cir-l1", protection: "itm-c10g20", contactor: "itm-lc1d09p7", type: 2 }],
      }),
    ).toThrow("itm-c10g20 is not a candidate of cir-l1");
  });
});

describe("result (REQ-FUNC-4dcdce2d)", () => {
  it("copies the network inputs, names catalog and network run, and is reproducible", () => {
    const request = {
      circuits: [{ circuit: "cir-f1", protection: "prt-q1", candidates: ["itm-a9f74340", "itm-c10g32"] }],
    };
    const first = run(request);
    const second = run(request);
    expect(second.criteria).toEqual(first.criteria);
    expect(first.producer).toMatchObject({ plugin: "protection-coordination", operation: "protection" });
    expect(first.catalog).toEqual({ id: "cat-lv-protection", version: "2026-11-15.1" });
    expect(first.conditions.networkRun).toEqual({ text: "20261115-100000-aaaa" });
    const ids = first.inputs.map((input) => input.id);
    for (const input of network.inputs) expect(ids).toContain(input.id);
    expect(ids).toContain("prt-q1");
    expect(first.limits.join(" ")).toContain("No device is configured");
  });
});

describe("fixture (REQ-TEST-4ef52f14)", () => {
  it("cites a public https page, the read date and licence terms for every value", () => {
    const sources = new Map(catalog.sources.map((source) => [source.id, source]));
    const parameters = [
      ...catalog.items.flatMap((entry) => entry.parameters),
      ...catalog.coordination.flatMap((table) => table.entries.flatMap((entry) => entry.parameters)),
    ];
    expect(parameters.length).toBeGreaterThan(60);
    for (const parameter of parameters) {
      const source = sources.get(parameter.source.id);
      expect(source?.uri).toMatch(/^https:\/\/www\.(se\.com|eaton\.com|electrical-installation\.org)\//);
      expect(source?.revision).toContain("2026-11-15");
      expect(source?.license).toBeTruthy();
      expect(parameter.source.table).toBeTruthy();
      expect(parameter.status).toBe("confirmed");
    }
    expect(catalog.families.map((family) => family.category).sort()).toEqual([
      "contactor",
      "fuse-link",
      "miniature-circuit-breaker",
      "motor-circuit-breaker",
    ]);
  });
});
