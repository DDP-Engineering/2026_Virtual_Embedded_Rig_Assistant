// Electrical model format 1: strict reading, IDs and references, relations, units, unknown values, the canonical
// round trip and the two-pump fixture (spec REQ-DATA-06c0bd54).
import { readFile } from "node:fs/promises";
import type { ElectricalModel } from "@vera/shared";
import { describe, expect, it } from "vitest";
import { checkModel, entityHash, modelIssues, parseModel, serializeModel } from "./model.js";
import { unitProblem } from "./units.js";

const FIXTURE = new URL(
  "../../../../../tests/fixtures/electrical-model/two-pump-panel.json",
  import.meta.url,
);
const fixtureText = () => readFile(FIXTURE, "utf8");
const fixture = async (): Promise<ElectricalModel> => parseModel(await fixtureText());
const problems = (raw: unknown) => {
  const checked = checkModel(raw);
  if (!("problems" in checked)) throw Error("expected the model to be refused");
  return checked.problems.map((problem) => `${problem.path}: ${problem.message}`).join("\n");
};
const object = (model: ElectricalModel, id: string) => {
  const found = model.objects.find((item) => item.id === id);
  if (!found) throw Error(`no ${id}`);
  return found;
};

describe("two-pump panel fixture (REQ-TEST-033d495e)", () => {
  it("holds one LV source, one board, three circuits, two motors, lighting, I/O, a sensor and tags", async () => {
    const model = await fixture();
    const count = (type: string) => model.objects.filter((item) => item.type === type).length;
    expect([count("source"), count("board"), count("circuit"), count("motor")]).toEqual([1, 1, 3, 2]);
    expect(model.objects.filter((item) => item.attributes?.category === "lighting")).toHaveLength(1);
    expect(count("io")).toBe(7);
    expect(count("sensor")).toBe(1);
    expect(count("tag")).toBe(5);
    const sources = new Set(model.sources.map((source) => source.id));
    for (const item of model.objects)
      for (const quantity of Object.values(item.properties ?? {})) {
        expect(quantity.basis).toBeDefined();
        expect(sources.has(quantity.source?.id ?? "")).toBe(true);
      }
    expect(modelIssues(model)).toEqual([]);
  });
});

describe("strict format 1 (REQ-DATA-06c0bd54)", () => {
  it("refuses another format, an unknown key, a missing project, too many objects and non-JSON text", async () => {
    const model = await fixture();
    expect(problems({ ...model, format: 2 })).toContain("format:");
    expect(problems({ ...model, extra: true })).toMatch(/Unrecognized key/);
    const { project: _project, ...rest } = model;
    expect(problems(rest)).toContain("project:");
    const many = Array.from({ length: 5001 }, (_, index) => ({ id: `lod-x${index}`, type: "load" }));
    expect(problems({ ...model, objects: many, relations: [] })).toContain("objects:");
    expect(() => parseModel("{not json")).toThrow(/Invalid electrical model:\n\(document\): is not JSON/);
  });
});

describe("IDs and visible references (REQ-DATA-183b71d2)", () => {
  it("refuses a repeated ID, a repeated reference and a reference equal to an ID", async () => {
    const model = await fixture();
    expect(problems({ ...model, objects: [...model.objects, { id: "mot-p1", type: "motor" }] })).toContain(
      "ID mot-p1 is used more than once",
    );
    expect(
      problems({ ...model, objects: [...model.objects, { id: "prt-qf9", type: "protection", ref: "QF1" }] }),
    ).toContain("reference QF1 is used more than once");
    expect(
      problems({ ...model, objects: [...model.objects, { id: "lod-x1", type: "load", ref: "mot-p1" }] }),
    ).toContain("reference mot-p1 equals an entity ID");
    const named = [...model.objects, { id: "lod-x1", type: "load" as const, name: "Pump 1" }];
    expect("model" in checkModel({ ...model, objects: named })).toBe(true);
  });
});

describe("references to existing entities (REQ-DATA-05117b78)", () => {
  it("refuses a relation to a missing object and a citation of a missing source", async () => {
    const model = await fixture();
    const withoutMotor = { ...model, objects: model.objects.filter((item) => item.id !== "mot-p1") };
    const refused = problems(withoutMotor);
    expect(refused).toContain("object mot-p1 does not exist (relation rel-feed-m1)");
    expect(refused).toMatch(/relations\[\d+\]\.to/);
    const fixed = {
      ...withoutMotor,
      relations: model.relations.filter((relation) => relation.from !== "mot-p1" && relation.to !== "mot-p1"),
    };
    expect("model" in checkModel(fixed)).toBe(true);
    const motor = structuredClone(object(model, "mot-p2"));
    if (motor.properties?.ratedPower) motor.properties.ratedPower.source = { id: "src-missing" };
    const cited = { ...model, objects: model.objects.map((item) => (item.id === "mot-p2" ? motor : item)) };
    expect(problems(cited)).toContain("properties.ratedPower.source.id: source src-missing does not exist");
  });
});

describe("relation rules (REQ-DATA-b75d05b0)", () => {
  it("refuses wrong endpoint types, a second feed, a self-relation and a feeds cycle", async () => {
    const model = await fixture();
    const add = (...relations: ElectricalModel["relations"]) => ({
      ...model,
      relations: [...model.relations, ...relations],
    });
    expect(problems(add({ id: "rel-x1", type: "feeds", from: "mot-p1", to: "brd-main" }))).toContain(
      "relation rel-x1: feeds does not join a motor to a board",
    );
    expect(problems(add({ id: "rel-x2", type: "feeds", from: "brd-main", to: "mot-p1" }))).toContain(
      "relation rel-x2: mot-p1 already has 1 incoming feeds",
    );
    expect(problems(add({ id: "rel-x3", type: "documents", from: "cir-m1", to: "cir-m1" }))).toContain(
      "relation rel-x3 joins cir-m1 to itself",
    );
    const cycle = {
      ...model,
      relations: [
        ...model.relations.filter((relation) => relation.id !== "rel-feed-board"),
        { id: "rel-x4", type: "feeds" as const, from: "cir-m1", to: "brd-main" },
      ],
    };
    expect(problems(cycle)).toMatch(
      /feeds relations form a cycle: (brd-main -> cir-m1 -> brd-main|cir-m1 -> brd-main -> cir-m1)/,
    );
  });

  it("accepts an unfed circuit and reports it only as an issue", async () => {
    const model = await fixture();
    const unfed = {
      ...model,
      relations: model.relations.filter((relation) => relation.id !== "rel-feed-c3"),
    };
    const checked = checkModel(unfed);
    expect("model" in checked).toBe(true);
    expect(modelIssues(unfed)).toEqual([
      { code: "unfed", id: "cir-l1", ref: "C3", message: "C3 has no feeds relation" },
    ]);
    const bare = {
      ...model,
      relations: model.relations.filter((relation) => relation.id !== "rel-protect-c1"),
    };
    expect(modelIssues(bare).map((issue) => `${issue.code} ${issue.id}`)).toEqual([
      "unprotected cir-m1",
      "unprotected mot-p1",
    ]);
  });
});

describe("unknown values (REQ-DATA-006f36b5)", () => {
  it("keeps null as unknown, keeps zero as zero and refuses a missing value", async () => {
    const model = await fixture();
    const power = object(model, "mot-p1").properties?.efficiency;
    expect(power).toMatchObject({ value: null, unit: "%" });
    const again = parseModel(serializeModel(model));
    expect(object(again, "mot-p1").properties?.efficiency?.value).toBeNull();
    const zero = structuredClone(model);
    const quantity = object(zero, "mot-p1").properties?.efficiency;
    if (quantity) quantity.value = 0;
    expect(object(parseModel(serializeModel(zero)), "mot-p1").properties?.efficiency?.value).toBe(0);
    const missing = structuredClone(model) as unknown as {
      objects: { properties?: Record<string, object> }[];
    };
    const motor = missing.objects.find((item) => (item as { id?: string }).id === "mot-p1");
    if (motor?.properties) motor.properties.efficiency = { unit: "%", basis: "input" };
    expect(problems(missing)).toContain("properties.efficiency.value");
  });
});

describe("units (REQ-DATA-9d50631c)", () => {
  it("refuses another dimension on a known property and any unit outside the table", async () => {
    expect(unitProblem("V", "ratedPower")).toBe("unit V is not a unit of power (W, kW, MW)");
    expect(unitProblem("mm", "crossSection")).toBe("unit mm is not a unit of area (mm²)");
    expect(unitProblem("kW", "ratedPower")).toBeUndefined();
    expect(unitProblem("W", "ratedPower")).toBeUndefined();
    expect(unitProblem("furlong", "anything")).toBe("unit furlong is not in the electrical unit table");
    const model = await fixture();
    const wrong = structuredClone(model);
    const quantity = object(wrong, "mot-p1").properties?.ratedPower;
    if (quantity) quantity.unit = "V";
    expect(problems(wrong)).toContain(
      "objects[11].properties.ratedPower.unit: unit V is not a unit of power (W, kW, MW)",
    );
  });
});

describe("canonical form (REQ-FUNC-11cf80d0)", () => {
  it("writes the fixture back byte for byte and orders keys whatever the input order", async () => {
    const text = await fixtureText();
    const model = parseModel(text);
    expect(serializeModel(model)).toBe(text);
    const shuffled = JSON.parse(text, (_key, value) =>
      value && typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value,
    );
    expect(serializeModel(parseModel(JSON.stringify(shuffled)))).toBe(text);
    expect(entityHash(shuffled.objects[0])).toBe(entityHash(model.objects[0]));
  });
});
