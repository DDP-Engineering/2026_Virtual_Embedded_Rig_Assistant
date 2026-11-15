// Cable tables, format 1 (spec REQ-DATA-42ce122f "Cable table file"): strict reading, lookups at the next tabulated
// point, and the cited Nexans NYM-J fixture typed from the public product page.
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { CableTable, ElectricalModel, ElectricalObject } from "@vera/shared";
import { describe, expect, it } from "vitest";
import {
  checkCableTable,
  groupingFactor,
  readCableTableFile,
  tableRating,
  temperatureFactor,
} from "./cable-table.js";
import { analyzeNetwork } from "./network.js";

const fixtures = new URL("../../../../../tests/fixtures/electrical-network/", import.meta.url);
const load = (name: string) => JSON.parse(readFileSync(fileURLToPath(new URL(name, fixtures)), "utf8"));
const test = (): CableTable => load("tbl-test-cu-pvc.json");
const problems = (raw: unknown, id?: string) => {
  const checked = checkCableTable(raw, id);
  return "problems" in checked
    ? checked.problems.map((problem) => `${problem.path}: ${problem.message}`)
    : [];
};

describe("cable table format (REQ-DATA-42ce122f)", () => {
  it("accepts both fixtures", () => {
    expect(problems(test(), "tbl-test-cu-pvc")).toEqual([]);
    expect(problems(load("tbl-nexans-nym-j.json"), "tbl-nexans-nym-j")).toEqual([]);
  });
  it("refuses unknown keys, other formats, a file name mismatch and a missing licence", () => {
    expect(problems({ ...test(), extra: 1 }).join()).toMatch(/extra|Unrecognized/);
    expect(problems({ ...test(), format: 2 }).join()).toMatch(/format/);
    expect(problems(test(), "tbl-other").join()).toMatch(/differs from the file name/);
    const table = test();
    delete (table.source as Partial<CableTable["source"]>).license;
    expect(problems(table).join()).toMatch(/source\.license/);
    for (const key of ["uri", "pages"] as const) {
      const uncited = test();
      delete (uncited.source as Partial<CableTable["source"]>)[key];
      expect(problems(uncited).join(), key).toMatch(new RegExp(`source\\.${key}`));
    }
    expect(problems({ ...test(), source: { ...test().source, readAt: "15 Nov" } }).join()).toMatch(
      /YYYY-MM-DD/,
    );
  });
  it("refuses duplicate or unordered sections, ratings without conductor data and unordered factors", () => {
    const duplicate = test();
    duplicate.conductors.push({ crossSection: 35, resistance20: 0.5, reactance: null });
    expect(problems(duplicate).join()).toMatch(/unique and ascending/);
    const orphan = test();
    orphan.methods[0]?.ratings.push({ crossSection: 50, loadedConductors: 3, current: 150 });
    expect(problems(orphan).join()).toMatch(/no conductor data for 50 mm²/);
    const twice = test();
    twice.methods[0]?.ratings.push({ crossSection: 35, loadedConductors: 3, current: 1 });
    expect(problems(twice).join()).toMatch(/listed twice/);
    const unordered = test();
    unordered.temperatureFactors[0]?.points.reverse();
    expect(problems(unordered).join()).toMatch(/strictly ascending/);
    const unknownMethod = test();
    unknownMethod.groupingFactors[0]?.methods.push("ground");
    expect(problems(unknownMethod).join()).toMatch(/method ground does not exist/);
    expect(
      problems({ ...test(), source: { ...test().source, uri: "https://user:pw@example.com/x" } }).join(),
    ).toMatch(/user information/);
  });
  it("looks factors up at the next tabulated point and never beyond the table", () => {
    const table = test();
    expect(temperatureFactor(table, "air", 30)).toBe(1);
    expect(temperatureFactor(table, "air", 31)).toBe(0.94);
    expect(temperatureFactor(table, "air", 51)).toBeUndefined();
    expect(groupingFactor(table, "air", 5)).toBe(0.57);
    expect(groupingFactor(table, "air", 7)).toBeUndefined();
    expect(tableRating(table, "air", 2.5, 2)).toBe(30);
    expect(tableRating(table, "ground", 2.5, 2)).toBeUndefined();
  });
  it("reads a table file confined to the workbench, strictly", async () => {
    const root = await mkdtemp(join(tmpdir(), "vera-table-"));
    try {
      await mkdir(join(root, "electrical-automation-tables"));
      await writeFile(
        join(root, "electrical-automation-tables/tbl-test-cu-pvc.json"),
        JSON.stringify(test()),
      );
      const read = await readCableTableFile(root, "tbl-test-cu-pvc");
      expect(read.stamp).toMatchObject({
        id: "tbl-test-cu-pvc",
        version: "1",
        path: "electrical-automation-tables/tbl-test-cu-pvc.json",
      });
      await expect(readCableTableFile(root, "../x")).rejects.toThrow(/not a valid id/);
      await expect(readCableTableFile(root, "tbl-none")).rejects.toThrow(/does not exist/);
      await writeFile(join(root, "electrical-automation-tables/tbl-broken.json"), "{");
      await expect(readCableTableFile(root, "tbl-broken")).rejects.toThrow(/Invalid cable table/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("the cited Nexans NYM-J table (PWR-02-C)", () => {
  const table = load("tbl-nexans-nym-j.json") as CableTable;
  it("cites its public source with read date and page", () => {
    expect(table.source).toMatchObject({ publisher: "Nexans (La Triveneta Cavi)", readAt: "2026-11-15" });
    expect(table.source.uri).toMatch(/^https:\/\/latrivenetacavi\.nexans\.com\//);
    expect(table.conductors.every((conductor) => conductor.reactance === null)).toBe(true);
    // Spot values from the page: NYM-J 5G2,5 7.41 Ω/km, 24 A in air and 20 A in pipe/air at 30 °C.
    expect(table.conductors.find((conductor) => conductor.crossSection === 2.5)?.resistance20).toBe(7.41);
    expect(tableRating(table, "air", 2.5, 3)).toBe(24);
    expect(tableRating(table, "pipe-air", 2.5, 3)).toBe(20);
    expect(tableRating(table, "air", 35, 3)).toBe(119);
  });
  it("sizes a circuit at 30 °C and gives unknown where the page has no factors", () => {
    const model = load("network-a.json") as ElectricalModel;
    const run = (ambient: number, assumedReactance: number | null = 0.08) => {
      const copy = structuredClone(model);
      const w2 = copy.objects.find((object) => object.id === "cbl-w2") as ElectricalObject;
      w2.properties = {
        ...w2.properties,
        ambientTemperature: { value: ambient, unit: "°C", basis: "input" },
      };
      return analyzeNetwork({
        model: copy,
        modelPath: "electrical-automation-model.json",
        modelSha256: "0".repeat(64),
        table,
        tableStamp: { id: table.id, version: table.version, sha256: "1".repeat(64), path: "x" },
        request: {
          cableTable: table.id,
          voltageTolerance: 10,
          scenarios: [{ id: "normal", title: "Normal" }],
          voltageDropLimit: { value: 4, unit: "%" },
          ...(assumedReactance === null ? {} : { assumedReactance }),
        },
        runId: "r1",
        now: "2026-11-15T12:00:00Z",
      });
    };
    const cool = run(30);
    // M1 Ib 20.75 A: 2.5 mm² 5G is rated 24 A in air at 30 °C.
    expect(
      cool.intermediate.find((entry) => entry.name === "crossSection" && entry.subject === "cbl-w2")?.value,
    ).toBe(2.5);
    expect(cool.assumptions.join(" ")).toMatch(/reactance 0\.08 Ω\/km/);
    // Without an agreed reactance the page's data give no voltage drop: unknown, not fail.
    const noX = run(30, null);
    expect(
      noX.criteria.find((entry) => entry.id === "cable-section" && entry.subject === "cir-m1")?.verdict,
    ).toBe("unknown");
    const warm = run(35);
    expect(
      warm.intermediate.find((entry) => entry.name === "crossSection" && entry.subject === "cbl-w2")?.value,
    ).toBeNull();
    expect(
      warm.criteria.find((entry) => entry.id === "current-capacity" && entry.subject === "cir-m1")?.verdict,
    ).toBe("unknown");
  });
});
