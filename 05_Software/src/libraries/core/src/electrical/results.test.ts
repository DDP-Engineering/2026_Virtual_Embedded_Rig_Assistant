// Electrical results format 1 and freshness derived from input snapshots (spec REQ-DATA-06c0bd54 "Result document").
import { readFile } from "node:fs/promises";
import type { ElectricalModel, ElectricalResult } from "@vera/shared";
import { describe, expect, it } from "vitest";
import { parseModel } from "./model.js";
import { checkResult, resultFreshness } from "./results.js";

const FIXTURE = new URL(
  "../../../../../tests/fixtures/electrical-model/two-pump-panel.json",
  import.meta.url,
);
const fixture = async (): Promise<ElectricalModel> => parseModel(await readFile(FIXTURE, "utf8"));
const entity = (model: ElectricalModel, id: string): unknown =>
  id === model.project.id
    ? model.project
    : [...model.objects, ...model.relations, ...model.sources].find((item) => item.id === id);

/** A result of a fictional run that read the given entities of the model. */
function resultOf(model: ElectricalModel, runId: string, ids: string[]): ElectricalResult {
  return {
    kind: "vera-electrical-result",
    format: 1,
    runId,
    producer: {
      plugin: "electrical-network",
      operation: "cable-sizing",
      engine: { name: "test", version: "1.0.0" },
    },
    method: { id: "test-method", title: "Test method" },
    status: "completed",
    preliminary: true,
    startedAt: "2026-11-15T12:00:00Z",
    finishedAt: "2026-11-15T12:00:01Z",
    model: { path: "electrical-automation-model.json", sha256: "0".repeat(64) },
    catalog: null,
    inputs: ids.map((id) => ({ id, snapshot: structuredClone(entity(model, id)) as never })),
    assumptions: ["Ambient 30 °C"],
    sources: ["src-brief"],
    conditions: { ambientTemperature: { value: 30, unit: "°C" } },
    intermediate: [{ name: "designCurrent", subject: "cir-m1", value: 8.1, unit: "A" }],
    criteria: [
      {
        id: "c1",
        title: "Voltage drop",
        subject: "cir-m1",
        verdict: "pass",
        measured: { value: 2.1, unit: "%" },
        limit: { value: 3, unit: "%" },
      },
      { id: "c2", title: "Thermal", subject: "cir-m1", verdict: "fail" },
      {
        id: "c3",
        title: "Short circuit",
        subject: "cir-m1",
        verdict: "unknown",
        measured: { value: null, unit: "kA" },
      },
      { id: "c4", title: "Selectivity", verdict: "not-evaluated" },
    ],
    limits: ["Radial LV only"],
    messages: [],
  };
}

describe("result format 1 (REQ-DATA-8b66f751)", () => {
  it("accepts every verdict and run status, and refuses an unknown status, verdict, kind, folder or unit", async () => {
    const model = await fixture();
    const result = resultOf(model, "run-1", ["mot-p1"]);
    expect("result" in checkResult(result, "run-1")).toBe(true);
    for (const status of ["incomplete", "blocked", "error", "interrupted"])
      expect("result" in checkResult({ ...result, status, finishedAt: null }, "run-1")).toBe(true);
    const problem = (raw: unknown, folder = "run-1") => {
      const checked = checkResult(raw, folder);
      return "problem" in checked ? `${checked.problem.path}: ${checked.problem.message}` : "accepted";
    };
    expect(problem({ ...result, status: "done" })).toMatch(/^status:/);
    expect(problem({ ...result, criteria: [{ ...result.criteria[0], verdict: "ok" }] })).toMatch(
      /^criteria\[0\]\.verdict:/,
    );
    expect(problem({ ...result, kind: "vera-electronics-result" })).toMatch(/^kind:/);
    expect(problem(result, "run-2")).toBe("runId: run ID run-1 differs from its folder run-2");
    expect(
      problem({ ...result, criteria: [{ ...result.criteria[0], limit: { value: 3, unit: "pc" } }] }),
    ).toBe("criteria[0].limit.unit: unit pc is not in the electrical unit table");
    expect(problem({ ...result, inputs: [] })).toMatch(/^inputs:/);
  });
});

describe("freshness (REQ-FUNC-7f4b0a41)", () => {
  it("marks exactly the results that read a changed or removed entity stale", async () => {
    const model = await fixture();
    const motor = resultOf(model, "run-motor", ["mot-p1", "cir-m1", "prj-two-pump"]);
    const lighting = resultOf(model, "run-light", ["cir-l1", "lod-e1", "prj-two-pump"]);
    expect(resultFreshness(motor, model)).toEqual({ freshness: "current", changed: [], removed: [] });

    const changed = structuredClone(model);
    const power = changed.objects.find((item) => item.id === "mot-p1")?.properties?.ratedPower;
    if (power) power.value = 5.5;
    expect(resultFreshness(motor, changed)).toEqual({ freshness: "stale", changed: ["mot-p1"], removed: [] });
    expect(resultFreshness(lighting, changed)).toEqual({ freshness: "current", changed: [], removed: [] });

    const removed = { ...model, objects: model.objects.filter((item) => item.id !== "lod-e1") };
    expect(resultFreshness(lighting, removed)).toEqual({
      freshness: "stale",
      changed: [],
      removed: ["lod-e1"],
    });

    const reordered = structuredClone(model);
    const target = reordered.objects.find((item) => item.id === "mot-p1");
    if (target?.properties)
      target.properties = Object.fromEntries(Object.entries(target.properties).reverse());
    expect(resultFreshness(motor, reordered).freshness).toBe("current");

    expect(resultFreshness(motor, null)).toEqual({
      freshness: "stale",
      changed: [],
      removed: ["mot-p1", "cir-m1", "prj-two-pump"],
    });
  });
});
