// The lighting engine (spec REQ-DATA-affb2e6b): a preliminary lumen-method estimate with cited utilisation factors and
// the direct illuminance component on the calculation grid from IES/LDT photometry, plus the verification level that
// maps the values of a demonstrated photometric engine's report (target DIALux evo). VERA never computes uniformity
// or glare (UGR) itself and never runs the engine. Pure: the tool reads the files.
import type {
  ElectricalModel,
  ElectricalResult,
  IndustrialCatalog,
  LightingProject,
  LightingReport,
} from "@vera/shared";
import { electricalIdSchema, lightingLimits } from "@vera/shared";
import { z } from "zod";
import { type CatalogCitedValue, type CatalogStamp, findItems } from "./catalog.js";
import type { LightingFileStamp, PhotometryStamp } from "./lighting-files.js";
import { intensityAt, type Photometry } from "./photometry.js";
import { toBaseUnit } from "./units.js";

export const LIGHTING_ENGINE = { name: "vera-lighting", version: "1.0.0" } as const;
const deg = Math.PI / 180;
const RESULT_LIST = 200;
const PLACEMENT_CRITERIA = 20;
const BLOCKERS_NAMED = 5;
/** Result texts stay within the result format's limits (sources 200, notes and messages 1000 characters). */
const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 3)}...`);

export const lightingRequestSchema = z
  .strictObject({
    project: electricalIdSchema,
    level: z.enum(["preliminary", "verification"]),
    report: electricalIdSchema.optional(),
    catalog: electricalIdSchema.optional(),
    scenarios: z.array(electricalIdSchema).min(1).max(lightingLimits.scenarios).optional(),
  })
  .refine((request) => (request.level === "verification") === (request.report !== undefined), {
    message: "level verification needs report; level preliminary takes none",
    path: ["report"],
  });
export type LightingRequest = z.infer<typeof lightingRequestSchema>;

export interface LightingInput {
  model: ElectricalModel;
  modelPath: string;
  modelSha256: string;
  project: LightingProject;
  projectStamp: LightingFileStamp;
  /** By luminaire type ID. */
  photometry: ReadonlyMap<string, { photometry: Photometry; stamp: PhotometryStamp }>;
  catalog: IndustrialCatalog | null;
  catalogStamp: CatalogStamp | null;
  /** `evidenceSha256` is the hash VERA computed of the record's evidence file, or null. */
  report: { report: LightingReport; stamp: LightingFileStamp; evidenceSha256: string | null } | null;
  request: LightingRequest;
  /** Checked once per scenario: a large grid can take a while. */
  signal?: AbortSignal;
  runId: string;
  now: string;
}

type Point = { x: number; y: number; z: number };
type Placement = Point & { rotation: number; tilt: number };
type Criterion = ElectricalResult["criteria"][number];
type Intermediate = ElectricalResult["intermediate"][number];

/** Room index k = L W / (hm (L + W)), hm the mounting height above the calculation plane. */
export function roomIndex(length: number, width: number, mountingHeight: number): number {
  return (length * width) / (mountingHeight * (length + width));
}

type UtilisationEntry = NonNullable<LightingProject["utilisationFactors"]>[number];
/** The cited UF at room index k: an entry at k (to 0.005) or linear between the nearest lower and higher entry. */
export function utilisationFactorAt(
  entries: readonly UtilisationEntry[],
  type: string,
  reflectances: LightingProject["reflectances"],
  k: number,
):
  | { value: number; basis: "luminaire" | "lamp"; sources: string[]; between?: [number, number] }
  | { reason: string } {
  const same = (a: number, b: number) => Math.abs(a - b) <= 0.005;
  const ofType = entries.filter((entry) => entry.type === type);
  if (!ofType.length) return { reason: `no utilisation factor entry for ${type}` };
  const matching = ofType.filter(
    (entry) =>
      same(entry.ceiling, reflectances.ceiling) &&
      same(entry.walls, reflectances.walls) &&
      same(entry.floor, reflectances.floor),
  );
  if (!matching.length)
    return {
      reason: `no utilisation factor entry for ${type} with the room's reflectances ${reflectances.ceiling}/${reflectances.walls}/${reflectances.floor}`,
    };
  for (const basis of ["luminaire", "lamp"] as const) {
    const rows = matching.filter((entry) => entry.basis === basis).sort((a, b) => a.roomIndex - b.roomIndex);
    if (!rows.length) continue;
    const exact = rows.find((entry) => same(entry.roomIndex, k));
    if (exact) return { value: exact.value, basis, sources: [exact.source] };
    const lower = rows.filter((entry) => entry.roomIndex < k).pop();
    const upper = rows.find((entry) => entry.roomIndex > k);
    if (lower && upper) {
      const share = (k - lower.roomIndex) / (upper.roomIndex - lower.roomIndex);
      return {
        value: lower.value + share * (upper.value - lower.value),
        basis,
        sources: [lower.source, upper.source],
        between: [lower.roomIndex, upper.roomIndex],
      };
    }
  }
  const indices = matching.map((entry) => entry.roomIndex).sort((a, b) => a - b);
  return {
    reason: `k = ${round(k, 3)} is outside the tabulated room indices ${indices[0]}..${indices[indices.length - 1]} for ${type}`,
  };
}

/**
 * Direct illuminance (lx, before maintenance factor) on an upward horizontal plane at `point` from one luminaire:
 * I(C, g) cos(theta) / r^2. Rotation turns C0 from +x toward +y; tilt tips the nadir toward the luminaire's C0.
 */
export function directIlluminance(photometry: Photometry, luminaire: Placement, point: Point): number {
  const vx = point.x - luminaire.x;
  const vy = point.y - luminaire.y;
  const vz = point.z - luminaire.z;
  const r2 = vx * vx + vy * vy + vz * vz;
  if (vz >= 0 || r2 === 0) return 0;
  const psi = luminaire.rotation * deg;
  const tau = luminaire.tilt * deg;
  const x1 = Math.cos(psi) * vx + Math.sin(psi) * vy;
  const y1 = -Math.sin(psi) * vx + Math.cos(psi) * vy;
  // Luminaire frame: nadir (sin tau, 0, -cos tau), C0 axis (cos tau, 0, sin tau), C90 axis (0, 1, 0).
  const a = x1 * Math.cos(tau) + vz * Math.sin(tau);
  const b = y1;
  const c = x1 * Math.sin(tau) - vz * Math.cos(tau);
  const gamma = Math.atan2(Math.hypot(a, b), c) / deg;
  const cAngle = Math.atan2(b, a) / deg;
  const r = Math.sqrt(r2);
  return (intensityAt(photometry, cAngle, gamma) * (-vz / r)) / r2;
}

const round = (value: number, digits = 4) => Number(value.toPrecision(digits + 2));
/** A confirmed catalog value in its base unit (lm, W), or why it cannot be used. */
const cited = (entry: CatalogCitedValue | undefined) => {
  if (!entry || entry.value === null) return { value: null, reason: "absent" };
  if (entry.status !== "confirmed") return { value: null, reason: "not confirmed (extracted)" };
  return { value: toBaseUnit(entry.value, entry.unit), reason: "" };
};

/** Evaluates the lighting project; throws for references the files cannot satisfy. */
export function analyzeLighting(input: LightingInput): ElectricalResult {
  const { project, model, request } = input;
  const scale = project.lengthUnit === "mm" ? 1e-3 : 1;
  const L = project.room.length * scale;
  const W = project.room.width * scale;
  const H = project.room.height * scale;
  const planeHeight = project.plane.height * scale;
  const border = project.plane.border * scale;
  const spacing = project.plane.spacing * scale;
  const mf = project.maintenanceFactor.value;
  const area = L * W;
  const verification = request.level === "verification";
  const criteria: Criterion[] = [];
  const intermediate: Intermediate[] = [];
  const messages: string[] = [];
  const assumptions: string[] = [
    "C angles count counter-clockwise seen from above; rotation turns C0 from the room's +x toward +y; tilt tips the nadir toward C0.",
    "Rectangular room with the origin at a floor corner; the calculation plane is horizontal and faces up.",
  ];
  const sources: string[] = [
    `lighting project ${input.projectStamp.path} sha256 ${input.projectStamp.sha256}`,
    `maintenance factor ${mf}: ${project.maintenanceFactor.source}`,
  ];
  const limits: string[] = [
    "Preliminary level: lumen-method estimate with a cited utilisation factor and the direct component only; it is engineering support, not a photometric verification.",
    "The grid values are the direct component (no inter-reflections, no daylight): a lower bound of the illuminance, never a maintained-illuminance or uniformity verdict.",
    "VERA computes no uniformity and no glare (UGR); those verdicts come only from a matched photometric engine report.",
    "Changes to the lighting project, photometry or report files after this run are not tracked; the sha256 values in the sources identify the files read.",
    "Emergency and exterior lighting have their own profiles and are not supported in this delivery.",
    "The report-match check compares room size, length unit, plane, maintenance factor, photometry files and luminaire count; reflectances and luminaire positions are not in the report record and are not compared.",
  ];
  const add = (entry: Intermediate) => {
    if (intermediate.length < RESULT_LIST) intermediate.push(entry);
  };
  const judge = (entry: Criterion) => {
    if (criteria.length < RESULT_LIST)
      criteria.push(entry.note === undefined ? entry : { ...entry, note: clip(entry.note, 1000) });
  };

  const inputs: ElectricalResult["inputs"] = [{ id: model.project.id, snapshot: model.project as never }];
  for (const type of project.types) {
    if (!type.load) continue;
    const load = model.objects.find((object) => object.id === type.load);
    if (!load || load.type !== "load")
      throw Error(
        `The luminaire type ${type.id} names ${type.load}, which is not a load of the electrical model.`,
      );
    if (load.attributes?.category !== "lighting")
      throw Error(
        `The load ${type.load} of luminaire type ${type.id} is not a lighting load (attribute category: lighting).`,
      );
    if (!inputs.some((entry) => entry.id === load.id)) inputs.push({ id: load.id, snapshot: load as never });
  }
  const conditions: ElectricalResult["conditions"] = {
    level: { text: request.level },
    profile: { text: project.profile },
    lengthUnit: { text: project.lengthUnit },
    maintenanceFactor: { value: mf, unit: "1" },
    planeHeight: { value: round(planeHeight), unit: "m" },
    gridSpacing: { value: round(spacing), unit: "m" },
  };
  if (input.report) {
    conditions.engine = {
      text: clip(`${input.report.report.engine.name} ${input.report.report.engine.version}`, 200),
    };
    conditions.reportOrigin = { text: input.report.report.origin };
    sources.push(`report record ${input.report.stamp.path} sha256 ${input.report.stamp.sha256}`);
  }
  const finish = (status: ElectricalResult["status"], preliminary: boolean): ElectricalResult => ({
    kind: "vera-electrical-result",
    format: 1,
    runId: input.runId,
    producer: { plugin: "lighting-design", operation: "lighting", engine: { ...LIGHTING_ENGINE } },
    method: {
      id: "vera-lighting-1",
      title: verification
        ? "Lighting - verification against a photometric engine report"
        : "Lighting - preliminary lumen-method estimate and direct component",
      reference: "lumen (utilisation factor) method; inverse-square cosine law for the direct component",
    },
    status,
    preliminary,
    startedAt: input.now,
    finishedAt: input.now,
    model: { path: input.modelPath, sha256: input.modelSha256 },
    catalog: input.catalogStamp ? { id: input.catalogStamp.id, version: input.catalogStamp.version } : null,
    inputs,
    assumptions: assumptions.slice(0, RESULT_LIST).map((text) => clip(text, 1000)),
    sources: sources.slice(0, RESULT_LIST).map((text) => clip(text, 200)),
    conditions,
    intermediate,
    criteria,
    limits,
    messages: messages.slice(0, RESULT_LIST).map((text) => clip(text, 1000)),
  });

  // 1. Profile.
  if (project.profile !== "interior") {
    judge({
      id: "profile",
      title: "Lighting profile",
      subject: project.id,
      verdict: "not-evaluated",
      note: `The ${project.profile} profile has its own criteria and sources (${project.profile === "emergency" ? "escape routes, open areas, high-risk task areas, emergency luminaires and duration" : "exterior work places, obtrusive light, exterior luminaires"}) and is not supported in this delivery.`,
    });
    return finish("blocked", true);
  }

  // 2. Geometry and grid.
  const wrong: string[] = [];
  const unit = project.lengthUnit;
  if (L < 0.5 || L > 500 || W < 0.5 || W > 500)
    wrong.push(`room ${round(L)} x ${round(W)} m is outside 0.5..500 m`);
  if (H < 1.5 || H > 100) wrong.push(`room height ${round(H)} m is outside 1.5..100 m`);
  if (planeHeight >= H)
    wrong.push(`the calculation plane at ${round(planeHeight)} m is not below the ceiling`);
  if (2 * border >= Math.min(L, W)) wrong.push(`the border ${round(border)} m leaves no calculation area`);
  judge({
    id: "geometry",
    title: "Room geometry and scale",
    subject: project.id,
    verdict: wrong.length ? "fail" : "pass",
    note: wrong.length
      ? `${wrong.join("; ")}: check the length unit (declared ${unit}) and the dimensions.`
      : `${round(L)} x ${round(W)} x ${round(H)} m (declared in ${unit}), plane ${round(planeHeight)} m, border ${round(border)} m.`,
  });
  if (wrong.length) return finish("blocked", true);
  add({ name: "roomArea", subject: project.id, value: round(area), unit: "m²" });
  const nx = Math.max(1, Math.ceil((L - 2 * border) / spacing - 1e-9));
  const ny = Math.max(1, Math.ceil((W - 2 * border) / spacing - 1e-9));
  if (nx * ny > lightingLimits.gridPoints)
    throw Error(
      `The calculation grid has ${nx * ny} points (more than ${lightingLimits.gridPoints}): use a larger plane spacing.`,
    );
  const grid: Point[] = [];
  for (let i = 0; i < nx; i += 1)
    for (let j = 0; j < ny; j += 1)
      grid.push({
        x: border + ((i + 0.5) * (L - 2 * border)) / nx,
        y: border + ((j + 0.5) * (W - 2 * border)) / ny,
        z: planeHeight,
      });

  // 3./4. Photometry and catalog per type.
  const badTypes = new Set<string>();
  for (const type of project.types) {
    const entry = input.photometry.get(type.id);
    if (!entry) throw Error(`No photometry was read for luminaire type ${type.id} (${type.photometry}).`);
    const p = entry.photometry;
    sources.push(`photometry ${type.id}: ${entry.stamp.path} sha256 ${entry.stamp.sha256}`);
    messages.push(...p.messages);
    add({ name: "luminaireFlux", subject: type.id, value: round(p.luminaireFlux), unit: "lm" });
    add({ name: "lampFlux", subject: type.id, value: p.lampFlux, unit: "lm" });
    add({ name: "inputPower", subject: type.id, value: p.inputWatts, unit: "W" });
    add({
      name: "efficacy",
      subject: type.id,
      value: p.inputWatts ? round(p.luminaireFlux / p.inputWatts) : null,
      unit: "lm/W",
    });
    add({
      name: "lightOutputRatio",
      subject: type.id,
      value: p.lightOutputRatio === null ? null : round(p.lightOutputRatio),
      unit: "1",
    });
    const problems: string[] = [];
    if (p.lightOutputRatio !== null && p.lightOutputRatio > 1.05)
      problems.push(
        `the light output ratio ${round(p.lightOutputRatio, 3)} is above 1.05 for relative photometry (check the lamp flux, multiplier or units)`,
      );
    if (p.format === "ldt" && p.lampFlux && p.declaredLightOutputRatio) {
      const declared = p.lampFlux * p.declaredLightOutputRatio;
      if (Math.abs(p.luminaireFlux - declared) > 0.05 * declared)
        problems.push(
          `the integrated flux ${round(p.luminaireFlux)} lm differs by more than 5 % from lamp flux x LORL ${round(declared)} lm`,
        );
    }
    if (problems.length) badTypes.add(type.id);
    judge({
      id: "photometry",
      title: "Photometric data",
      subject: type.id,
      verdict: problems.length ? "fail" : "pass",
      note: problems.length
        ? `${type.photometry}: ${problems.join("; ")}.`
        : `${type.photometry}: ${p.standard}, ${p.symmetry} symmetry, ${p.absolute ? "absolute" : "relative"} photometry, ${round(p.luminaireFlux)} lm.`,
    });
    if (type.orderCode === undefined) continue;
    if (!input.catalog) {
      judge({
        id: "catalog",
        title: "Catalog item against the photometry",
        subject: type.id,
        verdict: "not-evaluated",
        note: `No catalog is named; ${type.orderCode} is not checked.`,
      });
      continue;
    }
    const found = findItems(input.catalog, { orderCode: type.orderCode });
    const item = found[0];
    if (!item)
      throw Error(
        `The order code ${type.orderCode} of luminaire type ${type.id} is not in the catalog ${input.catalog.id}.`,
      );
    if (found.length !== 1)
      throw Error(
        `The order code ${type.orderCode} names ${found.length} items in the catalog ${input.catalog.id}.`,
      );
    if (item.category !== "luminaire")
      throw Error(
        `The catalog item ${type.orderCode} is not a luminaire (category ${item.category || "none"}).`,
      );
    const failed: string[] = [];
    const unknown: string[] = [];
    const attribute = item.attributes.photometry;
    if (attribute === undefined) unknown.push("no photometry attribute");
    else if (attribute !== type.photometry)
      failed.push(`photometry attribute ${String(attribute)} is not ${type.photometry}`);
    const compare = (name: "luminousFlux" | "activePower", unitName: "lm" | "W", actual: number | null) => {
      const value = cited(item.parameters.find((parameter) => parameter.name === name));
      if (value.value === null) unknown.push(`${name} ${value.reason}`);
      else if (actual === null)
        unknown.push(`the photometry gives no ${name === "activePower" ? "input power" : "flux"}`);
      else if (Math.abs(value.value - actual) > 0.1 * actual)
        failed.push(
          `${name} ${round(value.value)} ${unitName} differs by more than 10 % from the photometry's ${round(actual)} ${unitName}`,
        );
    };
    compare("luminousFlux", "lm", p.luminaireFlux);
    compare("activePower", "W", p.inputWatts);
    judge({
      id: "catalog",
      title: "Catalog item against the photometry",
      subject: type.id,
      verdict: failed.length ? "fail" : unknown.length ? "unknown" : "pass",
      note: `${type.orderCode} (${item.manufacturer}): ${[...failed, ...unknown].join("; ") || "category, photometry file, flux and power agree"}.`,
    });
  }

  // 5. Placement.
  const badLuminaires = new Set<string>();
  const placed = project.luminaires.map((luminaire) => ({
    ...luminaire,
    x: luminaire.x * scale,
    y: luminaire.y * scale,
    z: luminaire.z * scale,
  }));
  for (const luminaire of placed) {
    const reasons: string[] = [];
    if (luminaire.x < 0 || luminaire.x > L || luminaire.y < 0 || luminaire.y > W)
      reasons.push(
        `(${round(luminaire.x)}, ${round(luminaire.y)}) m is outside the ${round(L)} x ${round(W)} m room`,
      );
    if (luminaire.z > H) reasons.push(`height ${round(luminaire.z)} m is above the ceiling ${round(H)} m`);
    if (luminaire.z <= planeHeight)
      reasons.push(
        `height ${round(luminaire.z)} m is not above the calculation plane ${round(planeHeight)} m`,
      );
    if (!reasons.length) continue;
    badLuminaires.add(luminaire.id);
    if (badLuminaires.size > PLACEMENT_CRITERIA) continue;
    judge({
      id: "placement",
      title: "Luminaire position",
      subject: luminaire.id,
      verdict: "fail",
      note: `${reasons.join("; ")}: check the coordinates and the length unit (${unit}).`,
    });
  }

  if (badLuminaires.size > PLACEMENT_CRITERIA) {
    const more = [...badLuminaires].slice(PLACEMENT_CRITERIA);
    judge({
      id: "placement",
      title: "Luminaire position",
      subject: project.id,
      verdict: "fail",
      note: `${more.length} more luminaires fail their placement (${more.join(", ")}): check the coordinates and the length unit (${unit}).`,
    });
  }

  // 6.-8. Scenarios.
  const selected = request.scenarios ?? project.scenarios.map((scenario) => scenario.id);
  const typeOf = new Map(project.types.map((type) => [type.id, type]));
  let blockedScenarios = 0;
  let matchedAll = verification;
  for (const scenarioId of selected) {
    input.signal?.throwIfAborted();
    const scenario = project.scenarios.find((entry) => entry.id === scenarioId);
    if (!scenario) throw Error(`The scenario ${scenarioId} is not in the lighting project ${project.id}.`);
    const requirement = project.requirements.find((entry) => entry.id === scenario.requirement);
    if (!requirement) throw Error(`The requirement ${scenario.requirement} is not in the lighting project.`);
    sources.push(`requirement ${requirement.id}: ${requirement.source}`);
    const dimming = scenario.dimming ?? 1;
    const ids = scenario.luminaires ?? project.luminaires.map((luminaire) => luminaire.id);
    const members = placed.filter((luminaire) => ids.includes(luminaire.id));
    const em = requirement.maintainedIlluminance;
    const notEvaluated = (reason: string) => {
      judge({
        id: "maintained-illuminance",
        title: "Maintained average illuminance",
        subject: scenario.id,
        verdict: "not-evaluated",
        limit: { value: em, unit: "lx" },
        note: reason,
      });
      if (requirement.uniformityMin !== undefined)
        judge({
          id: "uniformity",
          title: "Uniformity Emin/Eavg",
          subject: scenario.id,
          verdict: "not-evaluated",
          limit: { value: requirement.uniformityMin, unit: "1" },
          note: reason,
        });
      if (requirement.ugrMax !== undefined)
        judge({
          id: "glare-ugr",
          title: "Discomfort glare UGR",
          subject: scenario.id,
          verdict: "not-evaluated",
          limit: { value: requirement.ugrMax, unit: "1" },
          note: reason,
        });
    };
    const blockers = [
      ...members
        .filter((luminaire) => badLuminaires.has(luminaire.id))
        .map((luminaire) => `placement of ${luminaire.id}`),
      ...[...new Set(members.map((luminaire) => luminaire.type))]
        .filter((type) => badTypes.has(type))
        .map((type) => `photometry of ${type}`),
    ];
    add({ name: "luminaireCount", subject: scenario.id, value: members.length, unit: "1" });
    if (blockers.length) {
      blockedScenarios += 1;
      matchedAll = false;
      const named = blockers.slice(0, BLOCKERS_NAMED).join(", ");
      const rest = blockers.length > BLOCKERS_NAMED ? ` and ${blockers.length - BLOCKERS_NAMED} more` : "";
      const note = `Scenario blocked by the failed ${named}${rest}.`;
      judge({
        id: "estimated-average-illuminance",
        title: "Estimated average illuminance (preliminary)",
        subject: scenario.id,
        verdict: "unknown",
        limit: { value: em, unit: "lx" },
        note,
      });
      notEvaluated(note);
      continue;
    }
    // Direct component on the grid.
    const totals = new Array<number>(grid.length).fill(0);
    const perLuminaire = members.map((luminaire) => {
      const p = input.photometry.get(luminaire.type)?.photometry as Photometry;
      let sum = 0;
      grid.forEach((point, index) => {
        const e = directIlluminance(p, luminaire, point) * mf * dimming;
        totals[index] = (totals[index] ?? 0) + e;
        sum += e;
      });
      return { id: luminaire.id, mean: sum / grid.length };
    });
    const directAverage = totals.reduce((sum, e) => sum + e, 0) / grid.length;
    const meanPerLuminaire =
      perLuminaire.reduce((sum, entry) => sum + entry.mean, 0) / Math.max(1, perLuminaire.length);
    for (const entry of perLuminaire)
      if (entry.mean < 0.01 * meanPerLuminaire)
        messages.push(
          `${entry.id} gives almost no direct light to the plane in ${scenario.id}: check rotation, tilt or the photometry orientation.`,
        );
    add({ name: "gridPoints", subject: scenario.id, value: grid.length, unit: "1" });
    add({
      name: "directIlluminanceMin",
      subject: scenario.id,
      value: round(Math.min(...totals)),
      unit: "lx",
    });
    add({ name: "directIlluminanceAverage", subject: scenario.id, value: round(directAverage), unit: "lx" });
    add({
      name: "directIlluminanceMax",
      subject: scenario.id,
      value: round(Math.max(...totals)),
      unit: "lx",
    });
    // Power.
    const watts = members.map(
      (luminaire) => input.photometry.get(luminaire.type)?.photometry.inputWatts ?? null,
    );
    const installed = watts.some((entry) => entry === null)
      ? null
      : watts.reduce<number>((sum, entry) => sum + (entry ?? 0), 0);
    add({
      name: "installedPower",
      subject: scenario.id,
      value: installed === null ? null : round(installed),
      unit: "W",
    });
    add({
      name: "powerDensity",
      subject: scenario.id,
      value: installed === null ? null : round(installed / area),
      unit: "W/m²",
    });
    // Lumen method.
    const heights = members.map((luminaire) => luminaire.z - planeHeight);
    let estimate: number | null = null;
    let estimateNote: string;
    if (Math.max(...heights) - Math.min(...heights) > 0.01) {
      estimateNote = "The mounting heights differ by more than 0.01 m: the lumen method does not apply.";
    } else {
      const hm = heights.reduce((sum, h) => sum + h, 0) / heights.length;
      const k = roomIndex(L, W, hm);
      add({ name: "mountingHeight", subject: scenario.id, value: round(hm), unit: "m" });
      add({ name: "roomIndex", subject: scenario.id, value: round(k), unit: "1" });
      const counts = new Map<string, number>();
      for (const luminaire of members) counts.set(luminaire.type, (counts.get(luminaire.type) ?? 0) + 1);
      let sum = 0;
      const reasons: string[] = [];
      const used: string[] = [];
      let single: { flux: number; uf: number } | null = null;
      for (const [typeId, count] of counts) {
        const factor = utilisationFactorAt(project.utilisationFactors ?? [], typeId, project.reflectances, k);
        if ("reason" in factor) {
          reasons.push(factor.reason);
          continue;
        }
        const p = input.photometry.get(typeId)?.photometry as Photometry;
        const flux = factor.basis === "luminaire" ? p.luminaireFlux : p.lampFlux;
        if (flux === null) {
          reasons.push(`the UF of ${typeId} is relative to the lamp flux, but the photometry is absolute`);
          continue;
        }
        used.push(`${typeId} UF ${round(factor.value, 3)} (${factor.sources.join("; ")})`);
        if (factor.between)
          assumptions.push(
            `UF of ${typeId} interpolated linearly between k = ${factor.between[0]} and ${factor.between[1]}.`,
          );
        for (const source of factor.sources)
          if (!sources.includes(`utilisation factor: ${source}`))
            sources.push(`utilisation factor: ${source}`);
        sum += count * flux * factor.value;
        if (counts.size === 1) {
          single = { flux, uf: factor.value };
          add({ name: "utilisationFactor", subject: scenario.id, value: round(factor.value), unit: "1" });
        }
      }
      if (reasons.length) {
        estimateNote = `${reasons.join("; ")}: no utilisation factor, the estimate is unknown.`;
      } else {
        estimate = (sum * mf * dimming) / area;
        estimateNote = `Preliminary lumen-method estimate (k = ${round(k, 3)}; ${used.join(", ")}; MF ${mf}${dimming < 1 ? `; dimming ${dimming}` : ""}): not a photometric verification.`;
        if (single)
          add({
            name: "luminairesNeeded",
            subject: scenario.id,
            value: Math.ceil((em * area) / (single.flux * single.uf * mf * dimming) - 1e-9),
            unit: "1",
          });
      }
    }
    add({
      name: "estimatedAverageIlluminance",
      subject: scenario.id,
      value: estimate === null ? null : round(estimate),
      unit: "lx",
    });
    judge({
      id: "estimated-average-illuminance",
      title: "Estimated average illuminance (preliminary)",
      subject: scenario.id,
      verdict: estimate === null ? "unknown" : estimate >= em ? "pass" : "fail",
      ...(estimate === null ? {} : { measured: { value: round(estimate), unit: "lx" } }),
      limit: { value: em, unit: "lx" },
      note: estimateNote,
    });
    if (!verification || !input.report) {
      notEvaluated(
        "Needs a matched photometric engine report (level verification); VERA computes no maintained illuminance, uniformity or UGR.",
      );
      continue;
    }
    // Verification against the engine report.
    const { report, evidenceSha256 } = input.report;
    const surface = report.surfaces.find((entry) => entry.scenario === scenario.id);
    const mismatches: string[] = [];
    if (!surface) mismatches.push(`the report has no surface for ${scenario.id}`);
    const rScale = report.lengthUnit === "mm" ? 1e-3 : 1;
    const within = (a: number, b: number) => Math.abs(a - b) <= 0.01 * b;
    if (
      !within(report.room.length * rScale, L) ||
      !within(report.room.width * rScale, W) ||
      !within(report.room.height * rScale, H)
    )
      mismatches.push(
        `room ${round(report.room.length * rScale)} x ${round(report.room.width * rScale)} x ${round(report.room.height * rScale)} m differs from ${round(L)} x ${round(W)} x ${round(H)} m`,
      );
    if (Math.abs(report.maintenanceFactor - mf) > 0.005)
      mismatches.push(`maintenance factor ${report.maintenanceFactor} differs from ${mf}`);
    for (const typeId of new Set(members.map((luminaire) => luminaire.type))) {
      const file = report.photometry.find((entry) => entry.type === typeId)?.file;
      const expected = typeOf.get(typeId)?.photometry;
      if (file !== expected)
        mismatches.push(`photometry of ${typeId} is ${file ?? "not given"}, not ${expected}`);
    }
    if (surface) {
      if (
        Math.abs(surface.height * rScale - planeHeight) > 0.01 ||
        Math.abs(surface.border * rScale - border) > 0.01
      )
        mismatches.push(
          `plane ${round(surface.height * rScale)} m / border ${round(surface.border * rScale)} m differs from ${round(planeHeight)} / ${round(border)} m`,
        );
      if (surface.luminaires !== members.length)
        mismatches.push(`${surface.luminaires} luminaires instead of ${members.length}`);
    }
    if (report.evidence && evidenceSha256 !== report.evidence.sha256)
      mismatches.push(
        `the evidence file ${report.evidence.path} has sha256 ${evidenceSha256 ?? "unknown"}, not the stated ${report.evidence.sha256}`,
      );
    const matched = mismatches.length === 0;
    if (!matched) matchedAll = false;
    judge({
      id: "report-match",
      title: "Engine report matches the project",
      subject: scenario.id,
      verdict: matched ? "pass" : "fail",
      note: matched
        ? `${report.engine.name} ${report.engine.version} surface "${surface?.name}" matches room, plane, maintenance factor, photometry and luminaire count${report.evidence ? "; evidence sha256 verified" : "; no evidence file"}.`
        : `${mismatches.join("; ")}.`,
    });
    if (!surface) {
      notEvaluated("The report has no surface for this scenario.");
      continue;
    }
    const uniformity = surface.uniformity ?? (surface.average > 0 ? surface.minimum / surface.average : null);
    add({ name: "reportAverage", subject: scenario.id, value: surface.average, unit: "lx" });
    add({ name: "reportMinimum", subject: scenario.id, value: surface.minimum, unit: "lx" });
    add({
      name: "reportUniformity",
      subject: scenario.id,
      value: uniformity === null ? null : round(uniformity),
      unit: "1",
    });
    add({ name: "reportUgr", subject: scenario.id, value: surface.ugr, unit: "1" });
    const verdict = (pass: boolean) => (matched ? (pass ? "pass" : "fail") : "unknown");
    const from = matched
      ? `From ${report.engine.name} ${report.engine.version} (${report.mapping})`
      : "Unknown: report-match failed";
    judge({
      id: "maintained-illuminance",
      title: "Maintained average illuminance",
      subject: scenario.id,
      verdict: verdict(surface.average >= em),
      measured: { value: surface.average, unit: "lx" },
      limit: { value: em, unit: "lx" },
      note: `${from}.`,
    });
    if (requirement.uniformityMin !== undefined)
      judge({
        id: "uniformity",
        title: "Uniformity Emin/Eavg",
        subject: scenario.id,
        verdict: uniformity === null ? "unknown" : verdict(uniformity >= requirement.uniformityMin),
        ...(uniformity === null ? {} : { measured: { value: round(uniformity), unit: "1" } }),
        limit: { value: requirement.uniformityMin, unit: "1" },
        note: `${from}.`,
      });
    if (requirement.ugrMax !== undefined)
      judge(
        surface.ugr === null
          ? {
              id: "glare-ugr",
              title: "Discomfort glare UGR",
              subject: scenario.id,
              verdict: "not-evaluated",
              limit: { value: requirement.ugrMax, unit: "1" },
              note: "The engine report gives no UGR for this surface.",
            }
          : {
              id: "glare-ugr",
              title: "Discomfort glare UGR",
              subject: scenario.id,
              verdict: verdict(surface.ugr <= requirement.ugrMax),
              measured: { value: surface.ugr, unit: "1" },
              limit: { value: requirement.ugrMax, unit: "1" },
              note: `${from}.`,
            },
      );
    judge({
      id: "report-consistency",
      title: "Engine average against VERA's direct component",
      subject: scenario.id,
      verdict: surface.average >= 0.95 * directAverage ? "pass" : "fail",
      measured: { value: surface.average, unit: "lx" },
      limit: { value: round(0.95 * directAverage), unit: "lx" },
      note:
        surface.average >= 0.95 * directAverage
          ? "The engine average is at least 0.95 x VERA's direct component on its grid."
          : "The engine average is below 0.95 x VERA's direct component: check photometry, orientation, maintenance factor and the mapping.",
    });
  }

  if (input.report) {
    const { report, evidenceSha256 } = input.report;
    if (report.origin === "fictional")
      messages.push(`The report record ${report.id} is fictional: the result stays preliminary.`);
    else if (!report.evidence || evidenceSha256 === null)
      messages.push(
        `The report record ${report.id} has no verified evidence file: the result stays preliminary.`,
      );
  }
  const preliminary = !(
    verification &&
    matchedAll &&
    input.report?.report.origin === "engine" &&
    input.report.report.evidence !== undefined &&
    input.report.evidenceSha256 === input.report.report.evidence.sha256
  );
  if (!preliminary)
    limits[0] =
      "Verification level: verdicts from the matched engine report; the lumen estimate and direct component are VERA's own cross-checks.";
  const status: ElectricalResult["status"] =
    blockedScenarios === selected.length
      ? "blocked"
      : criteria.every((entry) => entry.verdict === "pass" || entry.verdict === "fail")
        ? "completed"
        : "incomplete";
  return finish(status, preliminary);
}
