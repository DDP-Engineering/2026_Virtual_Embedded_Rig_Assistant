// Industrial catalog format 1 and the documented selection (spec REQ-DATA-d7e27def): strict reading, links without
// credentials, order code versus distributor SKU, firm requirements with eliminations and unknowns, sources and the
// catalog stamp in every selection, coordination limited to its products and conditions, reproducible output.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { CatalogRequirement, IndustrialCatalog } from "@vera/shared";
import { describe, expect, it } from "vitest";
import {
  type CatalogSelectedItem,
  type CatalogStamp,
  checkCatalog,
  coordinationFor,
  findItems,
  parseCatalog,
  selectItems,
} from "./catalog.js";
import { toBaseUnit, unitDimensions } from "./units.js";

const FIXTURE = new URL(
  "../../../../../tests/fixtures/industrial-catalog/cat-schneider-tesys.json",
  import.meta.url,
);
const fixtureText = () => readFile(FIXTURE, "utf8");
const fixture = async (): Promise<IndustrialCatalog> =>
  parseCatalog(await fixtureText(), "cat-schneider-tesys");
const stampOf = async (): Promise<CatalogStamp> => ({
  id: "cat-schneider-tesys",
  version: "2026-11-15.1",
  sha256: createHash("sha256")
    .update(await readFile(FIXTURE))
    .digest("hex"),
  path: "electrical-automation-catalogs/cat-schneider-tesys.json",
});
const problems = (raw: unknown, fileId?: string) => {
  const checked = checkCatalog(raw, fileId);
  if (!("problems" in checked)) throw Error("expected the catalog to be refused");
  return checked.problems.map((problem) => `${problem.path}: ${problem.message}`).join("\n");
};
const copy = async () => JSON.parse(await fixtureText()) as IndustrialCatalog & Record<string, unknown>;
const at400: CatalogRequirement["conditions"] = {
  utilisationCategory: { text: "AC-3" },
  voltage: { value: 400, unit: "V" },
};
const byCode = (items: CatalogSelectedItem[], code: string) => {
  const found = items.find((item) => item.orderCode === code);
  if (!found) throw Error(`no ${code} in the selection`);
  return found;
};

describe("Schneider fixture (REQ-TEST-647c2266)", () => {
  it("holds two real families and an accessory, every value cited from a se.com page with licence terms", async () => {
    const catalog = await fixture();
    expect(catalog.items.length).toBeLessThanOrEqual(10);
    expect(catalog.families.map((family) => family.category)).toEqual([
      "contactor",
      "motor-circuit-breaker",
      "auxiliary-contact-block",
    ]);
    const sources = new Map(catalog.sources.map((source) => [source.id, source]));
    const parameters = [
      ...catalog.items.flatMap((item) => item.parameters),
      ...catalog.coordination.flatMap((table) => table.entries.flatMap((entry) => entry.parameters)),
    ];
    expect(parameters.length).toBeGreaterThan(50);
    for (const parameter of parameters) {
      const source = sources.get(parameter.source.id);
      expect(source?.uri).toMatch(/^https:\/\/www\.se\.com\/uk\/en\/product\//);
      expect(source?.license).toBeTruthy();
      expect(source?.revision).toContain("2026-11-15");
      expect(parameter.source.table).toMatch(/^(Main|Complementary|Environment)$/);
      expect(parameter.status).toBe("confirmed");
    }
  });
});

describe("strict format 1 (REQ-DATA-d7e27def)", () => {
  it("accepts the fixture under its file name and refuses another file name", async () => {
    const raw = JSON.parse(await fixtureText());
    expect("catalog" in checkCatalog(raw, "cat-schneider-tesys")).toBe(true);
    expect(problems(raw, "cat-other")).toContain(
      "id: the catalog id cat-schneider-tesys differs from the file name cat-other",
    );
  });

  it("refuses another format, unknown keys and a source without licence terms", async () => {
    expect(problems({ ...(await copy()), format: 2 })).toMatch(/^format: /);
    expect(problems({ ...(await copy()), prices: [] })).toContain("prices");
    const unlicensed = await copy();
    delete (unlicensed.sources[0] as Record<string, unknown>).license;
    expect(problems(unlicensed)).toMatch(/^sources\[0\]\.license: /);
  });

  it("refuses units outside the table, of another dimension, and in conditions", async () => {
    const wrong = await copy();
    wrong.items[0]!.parameters[1]!.unit = "V";
    expect(problems(wrong)).toContain("items[0].parameters[1].unit: unit V is not a unit of current");
    const unknown = await copy();
    unknown.items[0]!.parameters[1]!.conditions!.voltageMax = { value: 440, unit: "volt" };
    expect(problems(unknown)).toContain(
      "items[0].parameters[1].conditions.voltageMax.unit: unit volt is not a unit of voltage",
    );
  });

  it("refuses repeated IDs, repeated order codes and references to missing entities", async () => {
    const twice = await copy();
    twice.items[1]!.id = twice.items[0]!.id;
    expect(problems(twice)).toContain("items[1].id: ID itm-lc1d09p7 is used more than once");
    const sameCode = await copy();
    sameCode.items[1]!.orderCode = "LC1D09P7";
    expect(problems(sameCode)).toContain(
      "items[1].orderCode: Schneider Electric LC1D09P7 is listed more than once",
    );
    const missing = await copy();
    missing.items[0]!.parameters[0]!.source.id = "src-nowhere";
    missing.items[0]!.accessories![0]!.item = "itm-nowhere";
    missing.items[0]!.family = "fam-nowhere";
    missing.coordination[0]!.entries[0]!.items = ["itm-nowhere"];
    const text = problems(missing);
    expect(text).toContain("items[0].family: family fam-nowhere does not exist");
    expect(text).toContain("items[0].parameters[0].source.id: source src-nowhere does not exist");
    expect(text).toContain("items[0].accessories[0].item: item itm-nowhere does not exist");
    expect(text).toContain("coordination[0].entries[0].items[0]: item itm-nowhere does not exist");
  });

  it("refuses a non-JSON text with one problem", () => {
    expect(() => parseCatalog("{ not json", "cat-x")).toThrow(/^Invalid industrial catalog:\n\(document\): /);
  });
});

describe("links without credentials (REQ-SEC-07040413)", () => {
  it.each([
    ["https://user:secret@www.se.com/uk/en/product/LC1D09P7/", "user information"],
    ["https://www.se.com/uk/en/product/LC1D09P7/?apikey=abc", "apikey"],
    ["https://uk.rs-online.com/web/p/contactors/3949790?X-Amz-Signature=1", "X-Amz-Signature"],
    ["file:///C:/catalogs/lc1d.pdf", "https"],
    ["https://store.example.com/p?sig=abc", "sig"],
    ["https://store.example.com/p?X-Amz-Credential=abc", "X-Amz-Credential"],
    ["https://store.example.com/p#access_token=abc", "fragment parameter access_token"],
  ])("refuses %s", async (uri, why) => {
    const catalog = await copy();
    catalog.sources[0]!.uri = uri;
    expect(problems(catalog)).toMatch(new RegExp(`^sources\\[0\\]\\.uri: .*${why}`));
    const distributor = await copy();
    distributor.items[0]!.distributors![0]!.uri = uri;
    expect(problems(distributor)).toMatch(/^items\[0\]\.distributors\[0\]\.uri: /);
  });
});

describe("order code, variant, accessories and distributor SKU (REQ-DATA-b3d86b99)", () => {
  it("finds an item by its order code or by a distributor SKU and says which matched", async () => {
    const catalog = await fixture();
    expect(findItems(catalog, { sku: "394-9790" }).map((item) => [item.orderCode, item.match])).toEqual([
      ["LC1D09P7", "distributor-sku"],
    ]);
    expect(findItems(catalog, { orderCode: "LC1D09P7" }).map((item) => [item.orderCode, item.match])).toEqual(
      [["LC1D09P7", "order-code"]],
    );
    expect(findItems(catalog, { orderCode: "394-9790" })).toEqual([]);
    expect(findItems(catalog, { sku: "LC1D09P7" })).toEqual([]);
  });

  it("keeps two coil variants of one base as two items with their own parameters", async () => {
    const catalog = await fixture();
    const variants = findItems(catalog, { category: "contactor" }).filter(
      (item) => item.variant?.base === "LC1D09",
    );
    expect(variants.map((item) => [item.orderCode, item.variant?.label])).toEqual([
      ["LC1D09B7", "24 V AC 50/60 Hz coil"],
      ["LC1D09P7", "230 V AC 50/60 Hz coil"],
    ]);
    expect(variants[0]!.distributors).toEqual([]);
    expect(variants[1]!.distributors[0]).toMatchObject({ supplier: "RS Components UK", sku: "394-9790" });
  });

  it("lists an accessory apart and never evaluates its ratings for the contactor", async () => {
    const selection = selectItems(await fixture(), await stampOf(), {
      category: "contactor",
      requirements: [
        {
          id: "aux",
          parameter: "ratedCurrent",
          op: ">=",
          value: { value: 6, unit: "A" },
          conditions: { utilisationCategory: { text: "AC-15" }, voltage: { value: 120, unit: "V" } },
        },
      ],
    });
    expect(selection.items.map((item) => item.orderCode)).not.toContain("LADN11");
    const contactor = byCode(selection.items, "LC1D09P7");
    expect(contactor.outcome).toBe("unknown");
    expect(contactor.criteria[0]).toMatchObject({ verdict: "unknown", reason: "conditions" });
    expect(contactor.accessories).toEqual([
      { item: "itm-ladn11", orderCode: "LADN11", role: "front-mounted auxiliary contact block" },
    ]);
  });
});

describe("firm requirements (REQ-FUNC-742db7ea)", () => {
  it("eliminates the 24 V coil variant and names the requirement, value and limit", async () => {
    const selection = selectItems(await fixture(), await stampOf(), {
      family: "fam-tesys-deca-lc1d",
      requirements: [{ id: "coil", parameter: "controlVoltage", op: "==", value: { value: 230, unit: "V" } }],
    });
    const b7 = byCode(selection.items, "LC1D09B7");
    expect(b7.outcome).toBe("eliminated");
    expect(b7.criteria[0]).toMatchObject({
      requirement: "coil",
      verdict: "fail",
      measured: { value: 24, unit: "V" },
      limit: { op: "==", value: 230, unit: "V" },
    });
    expect(byCode(selection.items, "LC1D09P7").outcome).toBe("eligible");
  });

  it("eliminates a contactor below the AC-3 current at 400 V and keeps the larger ones", async () => {
    const selection = selectItems(await fixture(), await stampOf(), {
      category: "contactor",
      requirements: [
        { id: "ie", parameter: "ratedCurrent", op: ">=", value: { value: 12, unit: "A" }, conditions: at400 },
      ],
    });
    expect(selection.items.map((item) => [item.orderCode, item.outcome])).toEqual([
      ["LC1D12P7", "eligible"],
      ["LC1D18P7", "eligible"],
      ["LC1D09B7", "eliminated"],
      ["LC1D09P7", "eliminated"],
    ]);
    expect(byCode(selection.items, "LC1D09P7").criteria[0]).toMatchObject({
      verdict: "fail",
      measured: { value: 9, unit: "A" },
      limit: { op: ">=", value: 12, unit: "A" },
    });
    expect(selection.counts).toEqual({ eligible: 2, unknown: 0, eliminated: 2 });
  });

  it("compares kA ratings with a requirement in A at the stated voltage", async () => {
    const selection = selectItems(await fixture(), await stampOf(), {
      family: "fam-tesys-gv2me",
      requirements: [
        {
          id: "icu",
          parameter: "ultimateBreakingCapacity",
          op: ">=",
          value: { value: 20000, unit: "A" },
          conditions: { voltage: { value: 440, unit: "V" } },
        },
      ],
    });
    expect(selection.items.map((item) => [item.orderCode, item.outcome])).toEqual([
      ["GV2ME08", "eligible"],
      ["GV2ME10", "eligible"],
      ["GV2ME14", "eliminated"],
    ]);
    expect(byCode(selection.items, "GV2ME14").criteria[0]!.measured).toEqual({ value: 15, unit: "kA" });
  });

  it("refuses a requirement whose unit has another dimension than the values", async () => {
    const catalog = await fixture();
    const stamp = await stampOf();
    expect(() =>
      selectItems(catalog, stamp, {
        requirements: [
          {
            id: "bad",
            parameter: "ratedCurrent",
            op: ">=",
            value: { value: 9, unit: "V" },
            conditions: at400,
          },
        ],
      }),
    ).toThrow("requirement bad: unit V is not a unit of current");
  });
});

describe("unknown values (REQ-DATA-fd465e9f)", () => {
  it("marks an absent parameter unknown and never eligible", async () => {
    const selection = selectItems(await fixture(), await stampOf(), {
      category: "contactor",
      requirements: [
        { id: "ie", parameter: "ratedCurrent", op: ">=", value: { value: 9, unit: "A" }, conditions: at400 },
        { id: "icu", parameter: "ultimateBreakingCapacity", op: ">=", value: { value: 6, unit: "kA" } },
      ],
    });
    const p7 = byCode(selection.items, "LC1D09P7");
    expect(p7.outcome).toBe("unknown");
    expect(p7.criteria[1]).toMatchObject({ requirement: "icu", verdict: "unknown", reason: "absent" });
    expect(p7.criteria[1]).not.toHaveProperty("measured");
    expect(selection.counts.eligible).toBe(0);
  });

  it("marks a value outside the requested conditions unknown and lists the conditions on offer", async () => {
    const selection = selectItems(await fixture(), await stampOf(), {
      family: "fam-tesys-gv2me",
      requirements: [
        {
          id: "icu",
          parameter: "ultimateBreakingCapacity",
          op: ">=",
          value: { value: 3, unit: "kA" },
          conditions: { voltage: { value: 1000, unit: "V" } },
        },
      ],
    });
    const criterion = byCode(selection.items, "GV2ME14").criteria[0]!;
    expect(criterion).toMatchObject({ verdict: "unknown", reason: "conditions" });
    expect(criterion.available).toContainEqual({
      voltage: { value: 690, unit: "V" },
      standard: { text: "IEC 60947-2" },
    });
  });

  it("does not decide on an extracted value and ranks unknown items after eligible ones", async () => {
    const extracted = await copy();
    for (const parameter of extracted.items.find((item) => item.orderCode === "LC1D18P7")!.parameters)
      parameter.status = "extracted";
    const catalog = parseCatalog(JSON.stringify(extracted), "cat-schneider-tesys");
    const selection = selectItems(catalog, await stampOf(), {
      category: "contactor",
      requirements: [
        { id: "ie", parameter: "ratedCurrent", op: ">=", value: { value: 12, unit: "A" }, conditions: at400 },
      ],
    });
    expect(selection.items.map((item) => [item.orderCode, item.outcome])).toEqual([
      ["LC1D12P7", "eligible"],
      ["LC1D18P7", "unknown"],
      ["LC1D09B7", "eliminated"],
      ["LC1D09P7", "eliminated"],
    ]);
    expect(byCode(selection.items, "LC1D18P7").criteria[0]).toMatchObject({
      verdict: "unknown",
      reason: "unconfirmed",
    });
  });
});

describe("catalog revision and sources (REQ-FUNC-b2ae3ed9)", () => {
  it("stamps the selection and cites page table, revision, link and licence for each value", async () => {
    const stamp = await stampOf();
    const selection = selectItems(await fixture(), stamp, {
      category: "contactor",
      requirements: [
        { id: "ie", parameter: "ratedCurrent", op: ">=", value: { value: 9, unit: "A" }, conditions: at400 },
      ],
    });
    expect(selection.catalog).toEqual(stamp);
    const evidence = byCode(selection.items, "LC1D09P7").criteria[0]!.evidence!;
    expect(evidence).toMatchObject({
      value: 9,
      unit: "A",
      status: "confirmed",
      conditions: {
        utilisationCategory: { text: "AC-3" },
        voltageMax: { value: 440, unit: "V" },
        ambientTemperatureMax: { value: 60, unit: "°C" },
        circuit: { text: "power" },
      },
      source: {
        id: "src-se-lc1d09p7",
        title: "LC1D09P7 product page, Specifications",
        publisher: "Schneider Electric (se.com UK)",
        uri: "https://www.se.com/uk/en/product/LC1D09P7/tesys-d-contactor-3p3-no-ac3-440-v-9-a-230-v-ac-coil/",
        table: "Main",
      },
    });
    expect(evidence.source.revision).toContain("2026-11-15");
    expect(evidence.source.license).toBeTruthy();
    expect(selection.commercial).toContain("nothing was looked up live");
  });
});

describe("coordination tables (REQ-FUNC-ca8c6870)", () => {
  it("returns the type 2 fuse entry for LC1D09P7 at 400 V with its source", async () => {
    const result = coordinationFor(await fixture(), await stampOf(), ["itm-lc1d09p7"], {
      voltage: { value: 400, unit: "V" },
      circuit: { text: "power" },
    });
    const type2 = result.applicable.find((entry) => entry.table === "tbl-lc1d-fuse-type2");
    expect(type2?.parameters[0]).toMatchObject({
      name: "fuseRating",
      value: 20,
      unit: "A",
      source: { id: "src-se-lc1d09p7", table: "Complementary", uri: expect.stringContaining("LC1D09P7") },
    });
    expect(result.catalog.version).toBe("2026-11-15.1");
  });

  it("never applies the LC1D09P7 entry to LC1D12P7, to 1000 V or without a voltage", async () => {
    const catalog = await fixture();
    const stamp = await stampOf();
    const other = coordinationFor(catalog, stamp, ["itm-lc1d12p7"], {
      voltage: { value: 400, unit: "V" },
      circuit: { text: "power" },
    });
    expect(other.applicable.every((entry) => entry.items.join() === "itm-lc1d12p7")).toBe(true);
    expect(
      other.applicable.find((entry) => entry.table === "tbl-lc1d-fuse-type2")?.parameters[0]?.value,
    ).toBe(25);
    const high = coordinationFor(catalog, stamp, ["itm-lc1d09p7"], {
      voltage: { value: 1000, unit: "V" },
      circuit: { text: "power" },
    });
    expect(high.applicable).toEqual([]);
    expect(high.notApplicable).toContainEqual(
      expect.objectContaining({ table: "tbl-lc1d-fuse-type2", reason: "conditions" }),
    );
    const silent = coordinationFor(catalog, stamp, ["itm-lc1d09p7"], { circuit: { text: "power" } });
    expect(silent.applicable).toEqual([]);
    expect(silent.notApplicable).toContainEqual(
      expect.objectContaining({
        table: "tbl-lc1d-fuse-type2",
        reason: "missing-condition",
        condition: "voltageMax",
      }),
    );
  });

  it("reports an entry of another product set as not applicable", async () => {
    const pair = await copy();
    pair.coordination[1]!.entries[0]!.items = ["itm-gv2me14", "itm-lc1d09p7"];
    const catalog = parseCatalog(JSON.stringify(pair), "cat-schneider-tesys");
    const result = coordinationFor(catalog, await stampOf(), ["itm-lc1d09p7"], {
      voltage: { value: 400, unit: "V" },
      circuit: { text: "power" },
    });
    expect(result.notApplicable).toContainEqual(
      expect.objectContaining({
        table: "tbl-lc1d-fuse-type2",
        items: ["itm-gv2me14", "itm-lc1d09p7"],
        reason: "other-products",
      }),
    );
  });
});

describe("conservative values, bounds and condition kinds (REQ-FUNC-742db7ea, REQ-DATA-fd465e9f)", () => {
  const ie = (op: ">=" | "<=" | "==", value: number): CatalogRequirement => ({
    id: "ie",
    parameter: "ratedCurrent",
    op,
    value: { value, unit: "A" },
    conditions: at400,
  });
  const withSecondValue = async () => {
    const catalog = await copy();
    const p7 = catalog.items.find((item) => item.orderCode === "LC1D09P7");
    if (!p7) throw Error("no LC1D09P7");
    p7.parameters.push({
      ...p7.parameters[1]!,
      value: 8,
      conditions: { utilisationCategory: { text: "AC-3" }, voltageMax: { value: 400, unit: "V" } },
    });
    return parseCatalog(JSON.stringify(catalog), "cat-schneider-tesys");
  };
  const verdictOf = async (requirement: CatalogRequirement) => {
    const selection = selectItems(await withSecondValue(), await stampOf(), {
      category: "contactor",
      requirements: [requirement],
    });
    return byCode(selection.items, "LC1D09P7").criteria[0]!;
  };

  it("lets the smallest value decide >=, the largest <= and any differing value ==", async () => {
    expect(await verdictOf(ie(">=", 9))).toMatchObject({
      verdict: "fail",
      measured: { value: 8, unit: "A" },
    });
    expect(await verdictOf(ie("<=", 8.5))).toMatchObject({
      verdict: "fail",
      measured: { value: 9, unit: "A" },
    });
    expect(await verdictOf(ie("==", 9))).toMatchObject({
      verdict: "fail",
      measured: { value: 8, unit: "A" },
    });
    expect(await verdictOf(ie(">=", 8))).toMatchObject({
      verdict: "pass",
      measured: { value: 8, unit: "A" },
    });
  });

  it("covers a request at a Min or Max bound and not beyond it", async () => {
    const icu = (volts: number): CatalogRequirement => ({
      id: "icu",
      parameter: "ultimateBreakingCapacity",
      op: ">=",
      value: { value: 50, unit: "kA" },
      conditions: { voltage: { value: volts, unit: "V" } },
    });
    const outcome = async (volts: number) =>
      byCode(
        selectItems(await fixture(), await stampOf(), {
          family: "fam-tesys-gv2me",
          requirements: [icu(volts)],
        }).items,
        "GV2ME14",
      ).criteria[0];
    expect(await outcome(415)).toMatchObject({ verdict: "pass", measured: { value: 100, unit: "kA" } });
    expect(await outcome(230)).toMatchObject({ verdict: "pass" });
    expect(await outcome(416)).toMatchObject({ verdict: "unknown", reason: "conditions" });
  });

  it("compares a temperature condition in K with a bound in °C and keeps text and numbers apart", async () => {
    const run = async (conditions: CatalogRequirement["conditions"]) =>
      byCode(
        selectItems(await fixture(), await stampOf(), {
          category: "contactor",
          requirements: [
            { id: "ie", parameter: "ratedCurrent", op: ">=", value: { value: 9, unit: "A" }, conditions },
          ],
        }).items,
        "LC1D09P7",
      ).criteria[0];
    expect(await run({ ...at400, ambientTemperature: { value: 333.15, unit: "K" } })).toMatchObject({
      verdict: "pass",
    });
    expect(await run({ ...at400, ambientTemperature: { value: 70, unit: "°C" } })).toMatchObject({
      verdict: "unknown",
      reason: "conditions",
    });
    expect(
      await run({ utilisationCategory: { value: 3, unit: "1" }, voltage: { value: 400, unit: "V" } }),
    ).toMatchObject({ verdict: "unknown", reason: "conditions" });
  });

  it("treats a null value as absent, never as zero", async () => {
    const catalog = await copy();
    for (const parameter of catalog.items.find((item) => item.orderCode === "LC1D12P7")!.parameters)
      if (parameter.name === "ratedCurrent") parameter.value = null;
    const selection = selectItems(
      parseCatalog(JSON.stringify(catalog), "cat-schneider-tesys"),
      await stampOf(),
      {
        category: "contactor",
        requirements: [ie("<=", 100)],
      },
    );
    expect(byCode(selection.items, "LC1D12P7").criteria[0]).toMatchObject({
      verdict: "unknown",
      reason: "absent",
    });
  });

  it("checks the dimension of a condition named like a known property, Min and Max included", async () => {
    const catalog = await copy();
    catalog.items[4]!.parameters[0]!.conditions = { settingCurrentMin: { value: 5, unit: "V" } };
    expect(problems(catalog)).toContain("conditions.settingCurrentMin.unit: unit V is not a unit of current");
  });

  it("names the requested conditions a coordination table does not evaluate", async () => {
    const result = coordinationFor(await fixture(), await stampOf(), ["itm-lc1d09p7"], {
      voltage: { value: 400, unit: "V" },
      circuit: { text: "power" },
      ambientTemperature: { value: 70, unit: "°C" },
    });
    expect(result.applicable[0]?.unevaluated).toEqual(["ambientTemperature"]);
  });
});

describe("reproducible selection (REQ-REL-6546e9a4)", () => {
  it("gives identical output twice, ordered by outcome then order code", async () => {
    const run = async () =>
      selectItems(await fixture(), await stampOf(), {
        requirements: [
          { id: "ue", parameter: "ratedVoltage", op: ">=", value: { value: 400, unit: "V" } },
          { id: "coil", parameter: "controlVoltage", op: "==", value: { value: 230, unit: "V" } },
        ],
      });
    const first = await run();
    expect(JSON.stringify(await run())).toBe(JSON.stringify(first));
    const rank = { eligible: 0, unknown: 1, eliminated: 2 };
    const keys = first.items.map((item) => [rank[item.outcome], item.orderCode] as const);
    expect(keys).toEqual([...keys].sort((a, b) => a[0] - b[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0)));
    expect(first.items.map((item) => item.orderCode).slice(0, 3)).toEqual([
      "LC1D09P7",
      "LC1D12P7",
      "LC1D18P7",
    ]);
  });

  it("scales units to the base unit of their dimension", () => {
    expect(toBaseUnit(15, "kA")).toBe(15000);
    expect(toBaseUnit(0.2, "W")).toBe(0.2);
    expect(toBaseUnit(60, "°C")).toBeCloseTo(333.15);
    expect(toBaseUnit(75, "%")).toBeCloseTo(0.75);
    for (const unit of Object.values(unitDimensions).flat())
      expect(Number.isFinite(toBaseUnit(1, unit))).toBe(true);
  });
});
