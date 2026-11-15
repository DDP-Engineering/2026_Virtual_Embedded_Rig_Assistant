// The lighting engine (spec REQ-DATA-affb2e6b "Method", "Result") against hand calculations fixed before the
// comparison: room index k = L W / (hm (L + W)); lumen method E = N Phi UF MF d / A; UF linear between two tabulated
// room indices; inverse-square cosine law E = I(g) cos(theta) / r^2. Tolerance 0.5 % unless stated otherwise (the
// integrated flux carries up to 0.5 %, so comparisons with the nominal 4320 lm use 1 %).
import { readFile } from "node:fs/promises";
import type { ElectricalModel, IndustrialCatalog, LightingProject, LightingReport } from "@vera/shared";
import { describe, expect, it } from "vitest";
import { analyzeLighting, directIlluminance, roomIndex, utilisationFactorAt } from "./lighting.js";
import { type Photometry, parsePhotometry } from "./photometry.js";
import { checkResult } from "./results.js";

const fixtures = new URL("../../../../../tests/fixtures/lighting-design/", import.meta.url);
const read = async (name: string) => (await readFile(new URL(name, fixtures))).toString("latin1");
const json = async <T>(name: string) => JSON.parse(await read(name)) as T;
const near = (actual: number | null | undefined, expected: number, share: number) => {
  expect(actual).not.toBeNull();
  expect(Math.abs((actual ?? Number.NaN) - expected)).toBeLessThanOrEqual(Math.abs(expected) * share + 1e-9);
};
const cosd = (deg: number) => Math.cos((deg * Math.PI) / 180);
const SHA = "a".repeat(64);

const model = await json<ElectricalModel>("model-office-a.json");
const baseProject = await json<LightingProject>("lgt-office-a.json");
const baseReport = await json<LightingReport>("rep-office-a.json");
const catalog = await json<IndustrialCatalog>("cat-lighting.json");
const panel = parsePhotometry("fict-panel.ldt", await read("fict-panel.ldt"));
const downlight = parsePhotometry("fict-downlight.ies", await read("fict-downlight.ies"));
const stamp = (name: string) => ({ name, path: `electrical-automation-photometry/${name}`, sha256: SHA });

function run(
  options: {
    project?: LightingProject;
    photometry?: Record<string, Photometry>;
    level?: "preliminary" | "verification";
    report?: LightingReport | null;
    evidenceSha256?: string | null;
    catalog?: IndustrialCatalog | null;
    scenarios?: string[];
  } = {},
) {
  const project = options.project ?? baseProject;
  const photometry = new Map(
    project.types.map((type) => {
      const p = options.photometry?.[type.id] ?? (type.photometry.endsWith(".ies") ? downlight : panel);
      return [type.id, { photometry: p, stamp: stamp(type.photometry) }] as const;
    }),
  );
  const level = options.level ?? (options.report ? "verification" : "preliminary");
  const report = options.report ?? null;
  return analyzeLighting({
    model,
    modelPath: "electrical-automation-model.json",
    modelSha256: SHA,
    project,
    projectStamp: { id: project.id, path: `electrical-automation-lighting/${project.id}.json`, sha256: SHA },
    photometry,
    catalog: options.catalog ?? null,
    catalogStamp: options.catalog
      ? { id: options.catalog.id, version: options.catalog.version, sha256: SHA, path: "c.json" }
      : null,
    report: report
      ? {
          report,
          stamp: { id: report.id, path: `electrical-automation-lighting/${report.id}.json`, sha256: SHA },
          evidenceSha256: options.evidenceSha256 ?? null,
        }
      : null,
    request: {
      project: project.id,
      level,
      ...(report ? { report: report.id } : {}),
      ...(options.catalog ? { catalog: options.catalog.id } : {}),
      ...(options.scenarios ? { scenarios: options.scenarios } : {}),
    },
    runId: "20261115-200000-abcd",
    now: "2026-11-15T20:00:00Z",
  });
}
type Result = ReturnType<typeof run>;
const value = (result: Result, name: string, subject?: string) =>
  result.intermediate.find(
    (entry) => entry.name === name && (subject === undefined || entry.subject === subject),
  )?.value;
const criterion = (result: Result, id: string, subject?: string) =>
  result.criteria.find((entry) => entry.id === id && (subject === undefined || entry.subject === subject));
const variant = (change: (project: LightingProject) => void) => {
  const copy = structuredClone(baseProject);
  change(copy);
  return copy;
};

describe("preliminary lumen-method estimate", () => {
  it("gives k, the interpolated UF, the estimate and the luminaires needed for the fixture room (REQ-FUNC-ca72aaff)", () => {
    const result = run();
    const k = 48 / (2.05 * 14);
    near(roomIndex(8, 6, 2.05), k, 0.005);
    near(value(result, "roomIndex", "scn-work"), k, 0.005);
    const uf = 0.7 + ((k - 1.5) / 0.5) * 0.06;
    near(value(result, "utilisationFactor", "scn-work"), uf, 0.005);
    const expected = (12 * panel.luminaireFlux * uf * 0.8) / 48;
    near(value(result, "estimatedAverageIlluminance", "scn-work"), expected, 0.005);
    near(value(result, "estimatedAverageIlluminance", "scn-work"), (12 * 4320 * uf * 0.8) / 48, 0.01);
    near(value(result, "estimatedAverageIlluminance", "scn-cleaning"), expected * 0.5, 0.005);
    expect(value(result, "luminairesNeeded", "scn-work")).toBe(
      Math.ceil((500 * 48) / (panel.luminaireFlux * uf * 0.8)),
    );
    expect(result.preliminary).toBe(true);
    expect(result.method.title).toMatch(/preliminary/);
    const estimate = criterion(result, "estimated-average-illuminance", "scn-work");
    expect(estimate).toMatchObject({ verdict: "pass", limit: { value: 500, unit: "lx" } });
    expect(estimate?.note).toMatch(/Preliminary lumen-method estimate.*not a photometric verification/);
    near(value(result, "installedPower", "scn-work"), 12 * 36, 0.0001);
    near(value(result, "powerDensity", "scn-work"), (12 * 36) / 48, 0.0001);
    near(value(result, "roomArea", "lgt-office-a"), 48, 0.0001);
  });

  it("takes an exact tabulated room index and refuses other reflectances, missing entries and mixed heights (REQ-FUNC-ca72aaff)", () => {
    const entries = baseProject.utilisationFactors ?? [];
    const reflect = baseProject.reflectances;
    expect(utilisationFactorAt(entries, "typ-panel", reflect, 1.5)).toMatchObject({ value: 0.7 });
    expect(utilisationFactorAt(entries, "typ-panel", reflect, 1.75)).toMatchObject({ value: 0.73 });
    expect(utilisationFactorAt(entries, "typ-panel", reflect, 2.5)).toMatchObject({
      reason: expect.stringMatching(/outside/),
    });
    expect(utilisationFactorAt(entries, "typ-panel", { ...reflect, floor: 0.1 }, 1.5)).toMatchObject({
      reason: expect.stringMatching(/reflectances/),
    });
    const other = run({ project: variant((p) => (p.reflectances.floor = 0.1)) });
    expect(criterion(other, "estimated-average-illuminance", "scn-work")?.verdict).toBe("unknown");
    expect(value(other, "estimatedAverageIlluminance", "scn-work")).toBeNull();
    const none = run({ project: variant((p) => delete p.utilisationFactors) });
    expect(criterion(none, "estimated-average-illuminance", "scn-work")?.note).toMatch(
      /no utilisation factor/i,
    );
    const mixed = run({ project: variant((p) => ((p.luminaires[0] as { z: number }).z = 2.6)) });
    expect(criterion(mixed, "estimated-average-illuminance", "scn-work")?.note).toMatch(/mounting heights/);
  });

  it("gives the same estimate for the room entered in millimetres (REQ-FUNC-ca72aaff, REQ-FUNC-dafae3f1)", () => {
    const mm = variant((p) => {
      p.lengthUnit = "mm";
      p.room = { length: 8000, width: 6000, height: 3000 };
      p.plane = { height: 750, border: 500, spacing: 250 };
      for (const l of p.luminaires) Object.assign(l, { x: l.x * 1000, y: l.y * 1000, z: l.z * 1000 });
    });
    const a = run();
    const b = run({ project: mm });
    near(
      value(b, "estimatedAverageIlluminance", "scn-work"),
      value(a, "estimatedAverageIlluminance", "scn-work") ?? 0,
      1e-9,
    );
    near(
      value(b, "directIlluminanceAverage", "scn-work"),
      value(a, "directIlluminanceAverage", "scn-work") ?? 0,
      1e-9,
    );
  });
});

describe("direct component", () => {
  const above = { x: 4, y: 3, z: 2.75, rotation: 0, tilt: 0 };
  it("follows the inverse-square cosine law below and beside a luminaire (REQ-FUNC-b78b7b15)", () => {
    near(directIlluminance(downlight, above, { x: 4, y: 3, z: 0.75 }), 1000 / 4, 0.005);
    // r^2 = 1 + 4, cos(g) = cos(theta) = 2 / sqrt(5): E = 1000 cos^2 / r^2 = 160 lx.
    near(directIlluminance(downlight, above, { x: 5, y: 3, z: 0.75 }), 160, 0.005);
    expect(directIlluminance(downlight, above, { x: 4, y: 3, z: 2.9 })).toBe(0);
  });

  it("turns C0 from +x toward +y (REQ-FUNC-b78b7b15)", () => {
    // Bilateral IES with I = 1000 cos(g) (1 + 0.5 cos C): the C0 side is three times the C180 side.
    const horizontal = Array.from({ length: 13 }, (_, i) => i * 15);
    const vertical = Array.from({ length: 19 }, (_, i) => i * 5);
    const ies = [
      "IESNA:LM-63-2002",
      "TILT=NONE",
      `1 -1 1 ${vertical.length} ${horizontal.length} 1 2 0.2 0.2 0.05`,
      "1 1 30",
      vertical.join(" "),
      horizontal.join(" "),
      ...horizontal.map((h) =>
        vertical.map((v) => (1000 * cosd(v) * (1 + 0.5 * cosd(h))).toFixed(3)).join(" "),
      ),
    ].join(String.fromCharCode(10));
    const p = parsePhotometry("b.ies", ies);
    const point = { x: 4, y: 4, z: 0.75 }; // +y of the luminaire
    const plus = directIlluminance(p, { ...above, rotation: 90 }, point);
    const minus = directIlluminance(p, { ...above, rotation: -90 }, point);
    near(plus / minus, 3, 0.005);
  });

  it("turns the distribution with rotation and tips it with tilt (REQ-FUNC-b78b7b15)", () => {
    const point = { x: 5, y: 3, z: 0.75 };
    const g = (Math.atan2(1, 2) * 180) / Math.PI;
    const ratio = (1 + 0.3 * cosd(0)) / (1 + 0.3 * cosd(180));
    const c0 = directIlluminance(panel, above, point);
    const c90 = directIlluminance(panel, { ...above, rotation: 90 }, point);
    near(c0 / c90, ratio, 0.005);
    near(c0, ((900 / Math.PI) * cosd(g) * 1.3 * 4.8 * cosd(g)) / 5, 0.005);
    expect(directIlluminance(downlight, { ...above, tilt: 180 }, point)).toBe(0);
    // Tilted 26.57 degrees toward C0 (+x) the nadir points at the point: I(0) cos(theta) / r^2.
    near(directIlluminance(downlight, { ...above, tilt: g }, point), (1000 * (2 / Math.sqrt(5))) / 5, 0.005);
  });

  it("reports grid values as direct-component values only and refuses a grid over 10000 points (REQ-FUNC-b78b7b15)", () => {
    const result = run();
    expect(value(result, "gridPoints", "scn-work")).toBe(28 * 20);
    const min = value(result, "directIlluminanceMin", "scn-work") ?? 0;
    const avg = value(result, "directIlluminanceAverage", "scn-work") ?? 0;
    const max = value(result, "directIlluminanceMax", "scn-work") ?? 0;
    expect(min).toBeGreaterThan(0);
    expect(min).toBeLessThan(avg);
    expect(avg).toBeLessThan(max);
    // Independent oracle: a Python midpoint sum of the analytic panel distribution on a 0.05 m grid of the same inner
    // area gives 725.53 lx before MF, 580.42 lx with MF 0.8 (scratch script, 2026-11-15); tolerance 1 % for VERA's
    // 0.25 m grid and the interpolated 5-degree data.
    near(avg, 580.42, 0.01);
    // The direct component on the inner grid is below the lumen-method estimate of the total.
    expect(avg).toBeLessThan(value(result, "estimatedAverageIlluminance", "scn-work") ?? 0);
    expect(result.intermediate.some((entry) => /uniformity|ugr/i.test(entry.name))).toBe(false);
    expect(result.limits.join(" ")).toMatch(/direct component/i);
    expect(() => run({ project: variant((p) => (p.plane.spacing = 0.05)) })).toThrow(/10000/);
  });
});

describe("not evaluated without an engine report", () => {
  it("keeps maintained illuminance, uniformity and UGR not-evaluated at the preliminary level (REQ-FUNC-e087cb4d)", () => {
    const result = run();
    for (const id of ["maintained-illuminance", "uniformity", "glare-ugr"])
      expect(criterion(result, id, "scn-work")).toMatchObject({
        verdict: "not-evaluated",
        note: expect.stringMatching(/engine report/),
      });
    expect(criterion(result, "maintained-illuminance", "scn-cleaning")?.verdict).toBe("not-evaluated");
    expect(criterion(result, "uniformity", "scn-cleaning")).toBeUndefined();
    expect(criterion(result, "glare-ugr", "scn-cleaning")).toBeUndefined();
    expect(result.status).toBe("incomplete");
  });
});

describe("diagnostics", () => {
  it("fails the geometry of a room of 8000 m and blocks the run (REQ-FUNC-dafae3f1)", () => {
    const result = run({ project: variant((p) => (p.room.length = 8000)) });
    expect(criterion(result, "geometry", "lgt-office-a")).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/length unit/),
    });
    expect(result.status).toBe("blocked");
    expect(value(result, "estimatedAverageIlluminance")).toBeUndefined();
  });

  it("fails the placement of luminaires above the ceiling, below the plane or outside the room (REQ-FUNC-dafae3f1)", () => {
    const result = run({
      project: variant((p) => {
        Object.assign(p.luminaires[0] as object, { z: 3.2 });
        Object.assign(p.luminaires[1] as object, { z: 0.7 });
        Object.assign(p.luminaires[2] as object, { x: 9 });
      }),
    });
    for (const id of ["lum-1", "lum-2", "lum-3"])
      expect(criterion(result, "placement", id)?.verdict).toBe("fail");
    expect(criterion(result, "placement", "lum-4")).toBeUndefined();
    expect(criterion(result, "estimated-average-illuminance", "scn-work")?.note).toMatch(/blocked.*lum-1/);
    expect(result.status).toBe("blocked");
  });

  it("keeps a run with long sources and 60 misplaced luminaires a valid result (REQ-FUNC-dafae3f1, REQ-DATA-affb2e6b)", () => {
    const long = variant((p) => {
      p.maintenanceFactor.source = "M".repeat(900);
      (p.requirements[0] as { source: string }).source = "R".repeat(900);
      p.luminaires = Array.from({ length: 60 }, (_, i) => ({
        id: `lum-${i + 1}`,
        type: "typ-panel",
        x: 1 + (i % 6),
        y: 1 + Math.floor(i / 12),
        z: 2800,
        rotation: 0,
        tilt: 0,
      }));
    });
    const result = run({ project: long });
    expect("result" in checkResult(result, result.runId)).toBe(true);
    expect(result.criteria.filter((entry) => entry.id === "placement")).toHaveLength(21);
    expect(criterion(result, "placement", "lgt-office-a")?.note).toMatch(/^40 more luminaires fail/);
    expect(criterion(result, "estimated-average-illuminance", "scn-work")?.note).toMatch(/and 55 more\.$/);
    expect(result.status).toBe("blocked");
  });

  it("names a luminaire tilted upwards as giving almost no direct light (REQ-FUNC-dafae3f1)", () => {
    const result = run({ project: variant((p) => ((p.luminaires[4] as { tilt: number }).tilt = 180)) });
    expect(result.messages.join("\n")).toMatch(/lum-5.*almost no direct light.*tilt/);
  });

  it("fails a relative photometry with a light output ratio above 1.05 and blocks its scenarios (REQ-FUNC-dafae3f1)", () => {
    const ies = [
      "IESNA:LM-63-2002",
      "TILT=NONE",
      "1 1000 1 3 1 1 2 30 30 1",
      "1 1 30",
      "0 45 90",
      "0",
      "1000 707.1 0",
    ].join("\n");
    const wrong = parsePhotometry("w.ies", ies);
    const result = run({ photometry: { "typ-panel": wrong } });
    expect(criterion(result, "photometry", "typ-panel")).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/light output ratio/),
    });
    expect(result.messages.join("\n")).toMatch(/w\.ies.*30 m.*units/);
    expect(result.status).toBe("blocked");
    expect(criterion(run(), "photometry", "typ-panel")?.verdict).toBe("pass");
    const lorl = run({ photometry: { "typ-panel": { ...panel, declaredLightOutputRatio: 0.5 } } });
    expect(criterion(lorl, "photometry", "typ-panel")?.note).toMatch(
      /differs by more than 5 % from lamp flux x LORL/,
    );
  });
});

describe("profiles", () => {
  it.each(["emergency", "exterior"] as const)(
    "blocks the %s profile as not supported (REQ-FUNC-e86a35c5)",
    (profile) => {
      const result = run({ project: variant((p) => (p.profile = profile)) });
      expect(result.status).toBe("blocked");
      expect(result.criteria).toEqual([
        expect.objectContaining({
          id: "profile",
          verdict: "not-evaluated",
          note: expect.stringMatching(new RegExp(`${profile}.*own criteria.*not supported`)),
        }),
      ]);
      expect(result.intermediate).toEqual([]);
    },
  );
});

describe("catalog", () => {
  const withItem = (change: (item: IndustrialCatalog["items"][number]) => void) => {
    const copy = structuredClone(catalog);
    change(copy.items[0] as IndustrialCatalog["items"][number]);
    return copy;
  };
  it("checks the item's category, photometry attribute, flux and power against the photometry (REQ-FUNC-50fa2fc0)", () => {
    const ok = run({ catalog });
    expect(criterion(ok, "catalog", "typ-panel")?.verdict).toBe("pass");
    expect(ok.catalog).toEqual({ id: "cat-lighting", version: "2026-11-15.1" });
    expect(criterion(run(), "catalog", "typ-panel")?.verdict).toBe("not-evaluated");
    const flux = run({
      catalog: withItem((item) => ((item.parameters[0] as { value: number }).value = 4320000)),
    });
    expect(criterion(flux, "catalog", "typ-panel")).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/luminousFlux/),
    });
    const file = run({ catalog: withItem((item) => (item.attributes = { photometry: "other.ldt" })) });
    expect(criterion(file, "catalog", "typ-panel")?.verdict).toBe("fail");
    const extracted = run({
      catalog: withItem((item) => ((item.parameters[1] as { status: string }).status = "extracted")),
    });
    expect(criterion(extracted, "catalog", "typ-panel")?.verdict).toBe("unknown");
    const absent = run({ catalog: withItem((item) => (item.parameters = item.parameters.slice(0, 1))) });
    expect(criterion(absent, "catalog", "typ-panel")).toMatchObject({
      verdict: "unknown",
      note: expect.stringMatching(/activePower absent/),
    });
    expect(() => run({ catalog: withItem((item) => (item.orderCode = "FICT-OTHER")) })).toThrow(
      /FICT-P40.*not in the catalog/,
    );
    const family = structuredClone(catalog);
    (family.families[0] as { category: string }).category = "socket";
    expect(() => run({ catalog: family })).toThrow(/not a luminaire/);
  });
});

describe("verification", () => {
  it("maps the fictional record's values and stays preliminary (REQ-FUNC-addd6a2f)", () => {
    const result = run({ report: baseReport, scenarios: ["scn-work"] });
    expect(result.method.title).toMatch(/verification/);
    expect(criterion(result, "report-match", "scn-work")?.verdict).toBe("pass");
    expect(criterion(result, "maintained-illuminance", "scn-work")).toMatchObject({
      verdict: "pass",
      measured: { value: 640, unit: "lx" },
      limit: { value: 500, unit: "lx" },
    });
    expect(criterion(result, "uniformity", "scn-work")).toMatchObject({
      verdict: "pass",
      measured: { value: 0.67, unit: "1" },
    });
    expect(criterion(result, "glare-ugr", "scn-work")).toMatchObject({
      verdict: "not-evaluated",
      note: expect.stringMatching(/no UGR/),
    });
    expect(criterion(result, "report-consistency", "scn-work")?.verdict).toBe("pass");
    expect(result.preliminary).toBe(true);
    expect(result.messages.join("\n")).toMatch(/fictional/);
    expect(result.conditions.engine).toEqual({ text: "DIALux evo fictional" });
  });

  it("fails report-match on another room, maintenance factor or luminaire count and keeps the verdicts unknown (REQ-FUNC-addd6a2f)", () => {
    for (const change of [
      (r: LightingReport) => (r.room.length = 8.5),
      (r: LightingReport) => (r.maintenanceFactor = 0.7),
      (r: LightingReport) => ((r.surfaces[0] as { luminaires: number }).luminaires = 11),
      (r: LightingReport) => ((r.photometry[0] as { file: string }).file = "other.ldt"),
    ]) {
      const report = structuredClone(baseReport);
      change(report);
      const result = run({ report, scenarios: ["scn-work"] });
      expect(criterion(result, "report-match", "scn-work")?.verdict).toBe("fail");
      expect(criterion(result, "maintained-illuminance", "scn-work")?.verdict).toBe("unknown");
      expect(criterion(result, "uniformity", "scn-work")?.verdict).toBe("unknown");
    }
    const missing = run({ report: baseReport });
    expect(criterion(missing, "report-match", "scn-cleaning")).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/no surface/),
    });
    expect(criterion(missing, "maintained-illuminance", "scn-cleaning")?.verdict).toBe("not-evaluated");
  });

  it("is not preliminary only for an engine record with a verified evidence file (REQ-FUNC-addd6a2f)", () => {
    const report: LightingReport = {
      ...structuredClone(baseReport),
      origin: "engine",
      evidence: { path: "electrical-automation-lighting/office-a.pdf", sha256: "b".repeat(64) },
    };
    (report.surfaces[0] as { ugr: number | null }).ugr = 18.2;
    const verified = run({ report, evidenceSha256: "b".repeat(64), scenarios: ["scn-work"] });
    expect(verified.preliminary).toBe(false);
    expect(criterion(verified, "glare-ugr", "scn-work")).toMatchObject({
      verdict: "pass",
      measured: { value: 18.2, unit: "1" },
    });
    const wrong = run({ report, evidenceSha256: "c".repeat(64), scenarios: ["scn-work"] });
    expect(criterion(wrong, "report-match", "scn-work")).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/sha256/),
    });
    expect(wrong.preliminary).toBe(true);
    const glare = structuredClone(report);
    (glare.surfaces[0] as { ugr: number }).ugr = 20;
    expect(
      criterion(
        run({ report: glare, evidenceSha256: "b".repeat(64), scenarios: ["scn-work"] }),
        "glare-ugr",
        "scn-work",
      )?.verdict,
    ).toBe("fail");
  });

  it("fails report-consistency when the engine average is below VERA's direct component (REQ-FUNC-addd6a2f)", () => {
    const report = structuredClone(baseReport);
    Object.assign(report.surfaces[0] as object, { average: 100, minimum: 50, maximum: 150, uniformity: 0.5 });
    const result = run({ report, scenarios: ["scn-work"] });
    expect(criterion(result, "report-consistency", "scn-work")).toMatchObject({
      verdict: "fail",
      note: expect.stringMatching(/below .*direct component/),
    });
    expect(criterion(result, "maintained-illuminance", "scn-work")?.verdict).toBe("fail");
  });
});
