// The power factor correction engine "vera-pfc-1" (spec REQ-DATA-4dc5e2c7 "Method"): per scenario at one board it
// separates displacement and total power factor, computes the reactive compensation need to a stated target, checks a
// fixed or an automatic capacitor bank of equal steps against load variation, the step equipment against cited catalog
// data and the parallel resonance against measured harmonic orders. Pure: it reads the model, a CURRENT network result,
// a measurement series and a catalog and returns one format-1 electrical result; it switches nothing and sets nothing.
import {
  type CatalogItem,
  type ElectricalModel,
  type ElectricalObject,
  type ElectricalResult,
  electricalLimits,
  type IndustrialCatalog,
} from "@vera/shared";
import { z } from "zod";
import {
  type CatalogCoordinationEntry,
  type CatalogCriterion,
  type CatalogStamp,
  coordinationFor,
  findItems,
  selectItems,
} from "./catalog.js";
import type { MeasurementSeries, MeasurementStamp } from "./measurements.js";
import { toBaseUnit, unitDimension } from "./units.js";

export const PFC_ENGINE = { name: "vera-pfc", version: "1.0.0" } as const;
export const PFC_METHOD = {
  id: "vera-pfc-1",
  title:
    "Power factor correction: displacement and total power factor, compensation need, capacitor bank and resonance",
} as const;

// ---- request (a tool schema: compact, fixed units, bounds as refinements) ---------------------------------------
const id = z.string();
const range = (low: number, high: number, name: string, closedLow = false) =>
  z
    .number()
    .refine(
      (value) => (closedLow ? value >= low : value > low) && value <= high,
      `${name} must be ${closedLow ? ">=" : ">"} ${low} and <= ${high}`,
    );
const integer = (low: number, high: number, name: string) =>
  z
    .number()
    .refine(
      (value) => Number.isInteger(value) && value >= low && value <= high,
      `${name} must be an integer ${low}..${high}`,
    );
export const powerQualityRequestSchema = z.strictObject({
  board: id,
  network: z
    .string()
    .regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
    .optional(),
  measurements: id.optional(),
  catalog: id.optional(),
  targetPowerFactor: range(0.8, 1, "targetPowerFactor", true),
  totalPowerFactorMin: range(0, 1, "totalPowerFactorMin").optional(),
  /** % above Un. */
  voltageTolerance: range(0, 20, "voltageTolerance (%)", true).optional(),
  resonanceMargin: range(0, 0.5, "resonanceMargin").optional(),
  /** % of the fundamental. */
  harmonicThreshold: range(0, 100, "harmonicThreshold (%)", true).optional(),
  maxSteps: integer(1, 32, "maxSteps").optional(),
  /** kVA of the harmonic-generating devices. */
  harmonicGeneratorPower: range(0, 1e6, "harmonicGeneratorPower (kVA)", true).optional(),
  /** Read an `undeclared` reactive-power column as fundamental Q1 (a stated assumption of the engineer). */
  reactiveAsFundamental: z.boolean().optional(),
  steps: z
    .array(
      z.strictObject({ capacitor: id, reactor: id.optional(), units: integer(1, 8, "units").optional() }),
    )
    .refine((entries) => entries.length >= 1 && entries.length <= 4, "name 1..4 step candidates")
    .optional(),
  contactor: id.optional(),
  protection: id.optional(),
});
export type PowerQualityRequest = z.infer<typeof powerQualityRequestSchema>;

export interface PowerQualityInput {
  model: ElectricalModel;
  modelPath: string;
  modelSha256: string;
  /** A stored electrical-network result the caller checked is current, or null. */
  network: ElectricalResult | null;
  measurements: { series: MeasurementSeries; stamp: MeasurementStamp } | null;
  catalog: IndustrialCatalog | null;
  catalogStamp: CatalogStamp | null;
  request: PowerQualityRequest;
  runId: string;
  now: string;
}

type Num = number | null;
type Criterion = ElectricalResult["criteria"][number];
type Verdict = Criterion["verdict"];
type Conditions = Record<string, { value: number; unit: string } | { text: string }>;
const EPSILON = 1e-9;
const BIG = 1e15;
/** Bank states evaluated for resonance; a bank with more steps is not evaluated state by state. */
const MAX_STATES = 64;
const sig = (value: number) => Number(value.toPrecision(6));
const fmt = (value: number, digits = 3) => String(Number(value.toPrecision(digits)));
const label = (object: ElectricalObject) => (object.ref ? `${object.ref} (${object.id})` : object.id);
const fold = (text: string) => text.trim().toLowerCase();

// ---- the formulas (exported for the reference tests) -------------------------------------------------------------
/** kvar to raise the displacement factor of P (kW) and Q1 (kvar, inductive positive) to the target; 0 when not needed. */
export function compensationNeed(p: number, q1: number, target: number): number {
  if (p <= 0) return 0;
  return Math.max(0, q1 - p * Math.tan(Math.acos(target)));
}
export function displacementFactor(p: number, q1: number): number {
  const s1 = Math.hypot(p, q1);
  return s1 === 0 ? 1 : p / s1;
}
/** Displacement factor, its character and total power factor P / sqrt(P² + Q1² + D²) (D² null = unknown). */
export function powerFactorAfter(
  p: number,
  q1: number,
  d2: Num,
): { displacement: number; character: "lagging" | "leading" | "unity"; total: Num } {
  return {
    displacement: displacementFactor(p, q1),
    character: q1 > EPSILON ? "lagging" : q1 < -EPSILON ? "leading" : "unity",
    total: d2 === null ? null : p / Math.sqrt(p * p + q1 * q1 + d2),
  };
}
/** Parallel resonance order of a bank of Q kvar (capacitor power at Un) with detuning p on Ssc kVA. */
export function resonanceOrder(ssc: number, q: number, p: number): number {
  return 1 / Math.sqrt(p + q / ssc);
}
/** Fundamental current in A of Q kvar at Un V (three-phase). */
export function stepCurrent(q: number, un: number): number {
  return (q * 1000) / (Math.sqrt(3) * un);
}
/** Capacitor rms current over its rated current: (Un/Ur)(1 + tolerance) sqrt(1 + sum (h uh)²). */
export function capacitorCurrentRatio(
  un: number,
  ur: number,
  tolerance: number,
  harmonics: ReadonlyMap<number, number>,
): number {
  let sum = 0;
  for (const [order, share] of harmonics) sum += (order * share) ** 2;
  return (un / ur) * (1 + tolerance) * Math.sqrt(1 + sum);
}

// ---- the guide's rules, cited in the result -------------------------------------------------------------------
const GUIDE =
  "Schneider Electric: Electrical Installation Guide (electrical-installation.org), web pages read 2026-11-15";
const GUIDE_SOURCES = [
  `${GUIDE}: The choice between a fixed or automatically-regulated bank of capacitors (15 % rule)`,
  `${GUIDE}: Possible solutions for power-system harmonics, Fig. L34 (Gh/Ssc rule)`,
  `${GUIDE}: Risk of resonance due to power-system harmonics (h0 = sqrt(Ssc/Q))`,
  `${GUIDE}: Implementation of capacitor banks, Figs. L37/L38 (IMP/IN, 10 x IN short-time, 75 V in 3 min)`,
];
const FIXED_SHARE = 0.15;
const INRUSH_MULTIPLE = 10;
const CLASSES = ["standard", "heavy-duty", "detuned", "filtering"] as const;

interface Sample {
  label: string;
  p: number;
  q1: number;
  /** Distortion power squared (kVA²), null when unknown. */
  d2: Num;
  totalPf: Num;
  approx: boolean;
  need: number;
}

export function analyzePowerQuality(input: PowerQualityInput): ElectricalResult {
  const { model, request, network, catalog, catalogStamp } = input;
  const objects = new Map(model.objects.map((object) => [object.id, object]));
  const board = objects.get(request.board);
  if (!board || (board.type !== "board" && board.type !== "busbar"))
    throw Error(`${request.board} is not a board or busbar of the model.`);
  const series = input.measurements?.series ?? null;
  if (series && series.file.board !== board.id)
    throw Error(`The measurement file ${series.file.id} measures ${series.file.board}, not ${board.id}.`);
  const itemIds = [
    ...(request.steps ?? []).flatMap((step) => [step.capacitor, ...(step.reactor ? [step.reactor] : [])]),
    ...(request.contactor ? [request.contactor] : []),
    ...(request.protection ? [request.protection] : []),
  ];
  if (itemIds.length && (!catalog || !catalogStamp)) throw Error("Name the catalog of the step items.");
  const items = new Map((catalog?.items ?? []).map((item) => [item.id, item]));
  for (const itemId of itemIds)
    if (!items.has(itemId)) throw Error(`The item ${itemId} does not exist in catalog ${catalog?.id}.`);
  const familyCategory = (item: CatalogItem) =>
    catalog?.families.find((family) => family.id === item.family)?.category ?? "";

  // ---- result scaffolding --------------------------------------------------------------------------------------
  const read = new Map<string, unknown>([[model.project.id, model.project]]);
  for (const entry of network?.inputs ?? []) read.set(entry.id, entry.snapshot);
  const touch = (entity: { id: string }) => read.set(entity.id, entity);
  const assumptions: string[] = [
    "Load convention: P > 0 is drawn from the supply and inductive reactive power is positive; declared generator or capacitive-positive data are converted.",
    "Network-result scenarios use the board's P and Q from the loads' power factors (fundamental reactive power); their total power factor is unknown because the network model has no harmonics.",
    "Harmonic currents and the distortion power are kept unchanged by the compensation (a plain bank may amplify them, a detuned bank absorbs part of them).",
    "The fault level at the board comes from the network result: the maximum one (cmax) and, when it is stored, the minimum one (cmin). The resonance orders are evaluated at both, the configuration rule (Gh/Ssc) at the maximum; a lower fault level lowers the resonance orders.",
    "Each measured interval is evaluated on its own; the regulator model connects the fewest equal steps that reach the target without leading operation.",
  ];
  const limits: string[] = [
    "Fundamental-frequency compensation of one board with equal steps; no active filter, no tuned filter design, no EMT or switching-transient model and no voltage-distortion limit check (no full power-quality report: flicker, unbalance and EN 50160 are not evaluated).",
    "Capacitor/reactor combinations come only from a cited manufacturer table; resonance uses sqrt-type estimates of the network and bank reactances only.",
    "No step is switched and no regulator parameter is set: the control logic is a proposal for the engineer; a step reconnects only after its discharge time (IEC 60831-1: discharge to 75 V within 3 min, per the guide).",
    "Capacitor banks for reactive compensation are not batteries or UPS; electrochemical storage is not evaluated.",
    "The measurement file is identified by its SHA-256 in the conditions; a later change to it does not mark this result stale - run again after new measurements.",
    "The bank's feeder cable is not sized here: size it with electrical_network for the permissible current.",
    "Preliminary engineering support: no verified design, no conformity statement and no safety certification.",
  ];
  const messages: string[] = [];
  const intermediate: ElectricalResult["intermediate"] = [];
  const criteria: ElectricalResult["criteria"] = [];
  const conditions: ElectricalResult["conditions"] = {};
  const sources = new Set<string>();
  const value = (name: string, amount: Num, unit: string) =>
    intermediate.push({
      name,
      subject: board.id,
      value: amount === null || !Number.isFinite(amount) ? null : sig(amount),
      unit,
    });
  const add = (entry: Omit<Criterion, "subject">): Verdict => {
    criteria.push({
      ...entry,
      subject: board.id,
      ...(entry.note ? { note: entry.note.slice(0, 1000) } : {}),
    });
    return entry.verdict;
  };
  const finish = (status: ElectricalResult["status"]): ElectricalResult => {
    let finalStatus = status;
    for (const [list, name] of [
      [intermediate, "intermediate values"],
      [criteria, "criteria"],
    ] as const)
      if (list.length > electricalLimits.resultList) {
        messages.unshift(
          `${list.length - electricalLimits.resultList} ${name} were left out (limit ${electricalLimits.resultList}).`,
        );
        list.length = electricalLimits.resultList;
        finalStatus = finalStatus === "completed" ? "incomplete" : finalStatus;
      }
    if (
      finalStatus === "completed" &&
      criteria.some((entry) => entry.verdict === "unknown" || entry.verdict === "not-evaluated")
    )
      finalStatus = "incomplete";
    const inputs = [...read.entries()]
      .slice(0, electricalLimits.resultInputs)
      .map(([key, snapshot]) => ({ id: key, snapshot: snapshot as never }));
    return {
      kind: "vera-electrical-result",
      format: 1,
      runId: input.runId,
      producer: { plugin: "power-quality-pfc", operation: "pfc", engine: { ...PFC_ENGINE } },
      method: {
        ...PFC_METHOD,
        reference: "Schneider Electric Electrical Installation Guide, chapter L (cited rules)",
      },
      status: finalStatus,
      preliminary: true,
      startedAt: input.now,
      finishedAt: input.now,
      model: { path: input.modelPath, sha256: input.modelSha256 },
      catalog: catalog ? { id: catalog.id, version: catalog.version } : null,
      inputs,
      assumptions: assumptions.slice(0, electricalLimits.resultList).map((text) => text.slice(0, 1000)),
      sources: [...sources].slice(0, electricalLimits.resultList).map((text) => text.slice(0, 200)),
      conditions,
      intermediate,
      criteria,
      limits,
      messages: messages.slice(0, electricalLimits.resultList).map((text) => text.slice(0, 1000)),
    };
  };

  // ---- the board, what it feeds and what feeds it -------------------------------------------------------------
  touch(board);
  const feeds = model.relations.filter((relation) => relation.type === "feeds");
  const below = (from: string) => {
    for (const relation of feeds.filter((entry) => entry.from === from)) {
      const child = objects.get(relation.to);
      if (!child || read.has(child.id)) continue;
      touch(relation);
      touch(child);
      below(child.id);
    }
  };
  below(board.id);
  let sourceObject: ElectricalObject | undefined;
  for (let at: string | undefined = board.id, guard = 0; at && guard < 1000; guard += 1) {
    const up = feeds.find((relation) => relation.to === at);
    if (!up) break;
    touch(up);
    const parent = objects.get(up.from);
    if (!parent) break;
    touch(parent);
    if (parent.type === "source") {
      sourceObject = parent;
      break;
    }
    at = parent.id;
  }
  const quantity = (object: ElectricalObject | undefined, name: string, dimension: string): Num => {
    const entry = object?.properties?.[name];
    if (!entry || entry.value === null || unitDimension(entry.unit) !== dimension) return null;
    return toBaseUnit(entry.value, entry.unit);
  };
  const sn = (() => {
    const va = quantity(sourceObject, "apparentPower", "apparent-power");
    return va === null ? null : va / 1000;
  })();
  value("transformerRating", sn, "kVA");

  // ---- network values ------------------------------------------------------------------------------------------
  conditions.board = { text: label(board).slice(0, 200) };
  conditions.targetPowerFactor = { value: request.targetPowerFactor, unit: "1" };
  /** A stored network value of the board in kA, kW or kvar, converted from the unit it was stored in. */
  const stored = (name: string, dimension: string): Num => {
    const entry = network?.intermediate.find((item) => item.name === name && item.subject === board.id);
    if (!entry || entry.value === null) return null;
    if (unitDimension(entry.unit) !== dimension) {
      messages.push(
        `The network result stores ${name} in ${entry.unit}, not a unit of ${dimension}: it is not used.`,
      );
      return null;
    }
    return toBaseUnit(entry.value, entry.unit) / 1000;
  };
  let un: Num = null;
  if (network) {
    conditions.networkRun = { text: network.runId };
    const nominal = network.conditions.nominalVoltage;
    if (nominal && "value" in nominal) un = toBaseUnit(nominal.value, nominal.unit);
  }
  if (series) {
    const declared = toBaseUnit(series.file.nominalVoltage.value, series.file.nominalVoltage.unit);
    if (un === null) un = declared;
    else if (Math.abs(declared - un) > EPSILON * un)
      messages.push(`The measurement file declares ${declared} V; the network result's ${un} V is used.`);
  }
  const frequency =
    series?.file.frequency.value ??
    (() => {
      const hz = quantity(sourceObject, "frequency", "frequency");
      return hz;
    })();
  if (un !== null) conditions.nominalVoltage = { value: un, unit: "V" };
  if (frequency !== null) conditions.frequency = { value: frequency, unit: "Hz" };
  else
    messages.push(
      "The network frequency is unknown (no measurement file, no source frequency): step outputs stay unknown.",
    );
  const ik3 = stored("ik3Max", "current");
  const ik3Min = stored("ik3Min", "current");
  const ssc = ik3 !== null && un !== null ? Math.sqrt(3) * un * ik3 : null; // V x kA = kVA
  const sscMin = ik3Min !== null && un !== null ? Math.sqrt(3) * un * ik3Min : null;
  value("shortCircuitPower", ssc, "kVA");
  value("shortCircuitPowerMin", sscMin, "kVA");
  if (network && ik3 === null)
    messages.push(`The network result gives no maximum fault current at ${label(board)}.`);
  else if (network && ik3Min === null && request.steps?.length)
    messages.push(
      `The network result gives no minimum fault current at ${label(board)}: resonance is checked at the maximum fault level only. A lower fault level (a transformer or generator out of service) lowers the resonance orders and can move one onto a harmonic.`,
    );

  // ---- scenarios -------------------------------------------------------------------------------------------------
  const tanTarget = Math.tan(Math.acos(request.targetPowerFactor));
  const named: Sample[] = [];
  const inconsistent: string[] = [];
  const sample = (name: string, p: number, q1: number, s: Num, pf: Num, thdi: Num): Sample => {
    const s1 = Math.hypot(p, q1);
    let d2: Num = null;
    let totalPf: Num = null;
    let approx = false;
    const apparent = s ?? (pf !== null && pf !== 0 ? p / Math.abs(pf) : null);
    if (apparent !== null) {
      d2 = apparent * apparent - s1 * s1;
      if (d2 < -0.01 * apparent * apparent) {
        inconsistent.push(name);
        d2 = 0;
      }
      d2 = Math.max(0, d2);
      totalPf = p / Math.sqrt(s1 * s1 + d2);
    } else if (thdi !== null) {
      d2 = s1 * s1 * thdi * thdi;
      totalPf = displacementFactor(p, q1) / Math.sqrt(1 + thdi * thdi);
      approx = true;
    }
    return {
      label: name,
      p,
      q1,
      d2,
      totalPf,
      approx,
      need: compensationNeed(p, q1, request.targetPowerFactor),
    };
  };
  const scenarioIds = Object.entries(network?.conditions ?? {})
    .filter(([key, entry]) => /^scenario\d+$/.test(key) && "text" in entry)
    .map(([, entry]) => ((entry as { text: string }).text.split(":")[0] ?? "").trim())
    .filter((name) => /^[a-z][a-z0-9-]{0,31}$/.test(name));
  for (const scenario of scenarioIds) {
    const p = stored(`activePower:${scenario}`, "power");
    const q = stored(`reactivePower:${scenario}`, "reactive-power");
    if (p === null || q === null || p <= 0) {
      messages.push(
        `Network scenario ${scenario}: P or Q at ${label(board)} is unknown or not positive; not evaluated.`,
      );
      continue;
    }
    named.push(sample(scenario, p, q, null, null, null));
  }

  // Measured intervals.
  const rows: (Sample & { time: string })[] = [];
  let skipped = 0;
  let undetermined = 0;
  const harmonicMax = new Map<string, number>();
  let voltageMax: Num = null;
  if (series) {
    const file = series.file;
    const stamp = input.measurements?.stamp;
    conditions.measurements = {
      text: `${file.id} sha256 ${stamp?.sha256.slice(0, 16) ?? "?"} origin ${file.origin} rows ${series.times.length}`.slice(
        0,
        200,
      ),
    };
    sources.add(
      `Measurements ${file.id} (${file.origin}; licence ${file.source.license}): ${file.source.title}${file.source.uri ? `, ${file.source.uri}` : ""}`,
    );
    messages.push(
      `Measurement source (attribution): ${[file.source.title, file.source.publisher, file.source.revision, file.source.uri, `licence ${file.source.license}`, file.source.readAt && `read ${file.source.readAt}`, file.source.note].filter(Boolean).join("; ")}.`,
    );
    if (file.origin === "fictional") {
      messages.unshift(
        `The measurement set ${file.id} is FICTIONAL (declared origin): the measured verdicts show the method, not a real installation.`,
      );
      limits.push(`The measurement set ${file.id} is fictional: no real installation is assessed.`);
    }
    const flip = file.conventions.power === "generator" ? -1 : 1;
    const qflip = flip * (file.conventions.reactiveSign === "capacitive-positive" ? -1 : 1);
    const column = (key: string) => series.values.get(key);
    const cP = column("activePower");
    const cQ = column("reactivePower");
    const cS = column("apparentPower");
    const cPf = column("powerFactor");
    const cDpf = column("displacementFactor");
    const cThdi = column("thdCurrent");
    const cU = column("voltage");
    for (const [key, values] of series.values)
      if (key.startsWith("harmonic") || key.startsWith("thd")) {
        const peak = values.reduce<number | null>(
          (best, entry) => (entry === null ? best : Math.max(best ?? 0, entry)),
          null,
        );
        if (peak !== null) harmonicMax.set(key, peak);
      }
    if (cU)
      voltageMax = cU.reduce<number | null>(
        (best, entry) => (entry === null ? best : Math.max(best ?? 0, entry)),
        null,
      );
    const asFundamental =
      file.conventions.reactive === "fundamental" ||
      (file.conventions.reactive === "undeclared" && request.reactiveAsFundamental === true);
    if (file.conventions.reactive === "undeclared" && request.reactiveAsFundamental === true)
      assumptions.push(
        `The reactive power of ${file.id} (declared undeclared) is read as fundamental reactive power Q1, as the request states; the displacement factor and the need rest on that assumption.`,
      );
    if (!asFundamental && !cDpf)
      messages.push(
        `The measurement file declares reactive power ${file.conventions.reactive} and has no displacement-factor column: the fundamental reactive power, the displacement factor and the need stay unknown for its intervals${file.conventions.reactive === "undeclared" ? " (reactiveAsFundamental states the assumption)" : ""}.`,
      );
    series.times.forEach((time, index) => {
      const rawP = cP?.[index] ?? null;
      if (rawP === null) {
        undetermined += 1;
        return;
      }
      const p = rawP * flip;
      if (p <= 0) {
        skipped += 1;
        return;
      }
      const rawQ = cQ?.[index] ?? null;
      let q1: Num = null;
      if (asFundamental && rawQ !== null) q1 = rawQ * qflip;
      else {
        const dpf = cDpf?.[index] ?? null;
        if (dpf !== null && dpf !== 0) {
          const magnitude = p * Math.tan(Math.acos(Math.min(1, Math.abs(dpf))));
          const sign =
            file.conventions.powerFactor === "lead-negative"
              ? Math.sign(dpf) * flip
              : rawQ !== null && rawQ !== 0
                ? Math.sign(rawQ * qflip)
                : 0;
          q1 = sign === 0 ? (magnitude < EPSILON ? 0 : null) : sign * magnitude;
        }
      }
      if (q1 === null) {
        undetermined += 1;
        return;
      }
      const s = cS?.[index] ?? null;
      const pf = cPf?.[index] ?? null;
      const thdi = cThdi?.[index] ?? null;
      rows.push({ ...sample(time, p, q1, s, pf, thdi), time });
    });
    if (inconsistent.length)
      messages.push(
        `${inconsistent.length} measured intervals have S below sqrt(P² + Q1²) by more than 1 % (first ${inconsistent[0]}); their distortion power is taken as 0.`,
      );
    value("measuredIntervals", series.times.length, "1");
    value("measuredEvaluated", rows.length, "1");
    value("measuredSkipped", skipped + undetermined, "1");
    value("measuredGaps", series.gaps, "1");
    if (skipped)
      messages.push(`${skipped} measured intervals with P <= 0 (export or idle) are not compensated.`);
    if (undetermined)
      messages.push(`${undetermined} measured intervals have unknown P or Q1 and are not evaluated.`);
    if (series.gaps) messages.push(`${series.gaps} gaps longer than 1.5 intervals in the measurement file.`);
    value(
      "thdCurrentMax",
      harmonicMax.has("thdCurrent") ? (harmonicMax.get("thdCurrent") as number) * 100 : null,
      "%",
    );
    value(
      "thdVoltageMax",
      harmonicMax.has("thdVoltage") ? (harmonicMax.get("thdVoltage") as number) * 100 : null,
      "%",
    );
    for (const [key, peak] of [...harmonicMax].filter(([key]) => key.startsWith("harmonicVoltage@")))
      value(`harmonicVoltageMax@${key.split("@")[1]}`, peak * 100, "%");
    if (rows.length) {
      const peak = rows.reduce((best, row) => (row.need > best.need + EPSILON ? row : best));
      const light = rows.reduce((best, row) => (row.q1 < best.q1 - EPSILON ? row : best));
      named.push({ ...peak, label: "measured-peak" }, { ...light, label: "measured-light" });
      messages.push(`measured-peak is the interval ${peak.time}; measured-light is ${light.time}.`);
    }
  }
  if (!named.length) {
    messages.push(
      `No scenario at ${label(board)} has a known positive P and Q1: name a current network result or a measurement file of this board.`,
    );
    return finish("blocked");
  }
  const all: Sample[] = [...named.filter((entry) => !entry.label.startsWith("measured-")), ...rows];
  const governing = Math.max(...all.map((entry) => entry.need));
  value("compensationNeed", governing, "kvar");
  const lightest = all.reduce((best, entry) => (entry.q1 < best.q1 ? entry : best));

  // ---- step candidates -----------------------------------------------------------------------------------------
  const one = (item: CatalogItem, requirement: Parameters<typeof selectItems>[2]["requirements"][number]) =>
    selectItems({ ...(catalog as IndustrialCatalog), items: [item] }, catalogStamp as CatalogStamp, {
      requirements: [requirement],
    }).items[0]?.criteria[0] as CatalogCriterion;
  const cite = (criterion: CatalogCriterion | undefined) => {
    const source = criterion?.evidence?.source;
    if (!source) return "";
    sources.add(
      `${source.publisher ?? ""}: ${source.title}, ${source.revision ?? ""}${source.uri ? `, ${source.uri}` : ""}`,
    );
    const where = source.table ?? source.page;
    return ` Source: ${source.title}${where ? `, ${where}` : ""}.`;
  };
  /** The most conservative cited value (smallest for `low`, largest for `high`) covering the conditions, base unit. */
  const pick = (
    item: CatalogItem,
    name: string,
    unit: string,
    end: "low" | "high",
    wanted: Conditions = {},
  ) => {
    const criterion = one(item, {
      id: "value",
      parameter: name,
      op: end === "low" ? ">=" : "<=",
      value: { value: end === "low" ? -BIG : BIG, unit },
      ...(Object.keys(wanted).length ? { conditions: wanted } : {}),
    });
    const measured = criterion.measured && "value" in criterion.measured ? criterion.measured : undefined;
    return { criterion, value: measured ? toBaseUnit(measured.value, measured.unit) : null };
  };
  const why = (criterion: CatalogCriterion, name: string) =>
    criterion.reason === "absent"
      ? `no cited ${name}`
      : criterion.reason === "conditions"
        ? `no cited ${name} covers the conditions`
        : `only an extracted (unconfirmed) ${name}`;
  const citedEntries = (item: CatalogItem, name: string) =>
    (findItems({ ...(catalog as IndustrialCatalog), items: [item] }, {})[0]?.parameters ?? []).filter(
      (parameter) => parameter.name === name && parameter.status === "confirmed" && parameter.value !== null,
    );
  const conditionBase = (conditionsOf: Conditions | undefined, key: string): Num => {
    const entry = conditionsOf?.[key];
    return entry && "unit" in entry ? toBaseUnit(entry.value, entry.unit) : null;
  };
  const atNetwork = (): Conditions => ({
    ...(un !== null ? { voltage: { value: un, unit: "V" } } : {}),
    ...(frequency !== null ? { frequency: { value: frequency, unit: "Hz" } } : {}),
  });

  const ratioOfThreshold = (request.harmonicThreshold ?? 0) / 100;
  const measuredOrders = new Set<number>();
  const significant = new Set<number>();
  for (const [key, peak] of harmonicMax) {
    const match = /^harmonic(?:Current|Voltage)@(\d+)$/.exec(key);
    if (!match) continue;
    const order = Number(match[1]);
    measuredOrders.add(order);
    if (request.harmonicThreshold === undefined ? peak > 0 : peak >= ratioOfThreshold - EPSILON)
      significant.add(order);
  }
  const highestOrder = measuredOrders.size ? Math.max(...measuredOrders) : null;
  const voltageHarmonics = new Map<number, number>(
    [...harmonicMax]
      .filter(([key]) => key.startsWith("harmonicVoltage@"))
      .map(([key, peak]) => [Number(key.split("@")[1]), peak]),
  );
  const gh = request.harmonicGeneratorPower ?? null;
  const requiredClass: Num =
    gh === null || ssc === null ? null : gh <= ssc / 120 ? 0 : gh <= ssc / 70 ? 1 : gh <= ssc / 30 ? 2 : 3;

  // Bank type from the product-independent need (rounded up to the step products below).
  const overcompensated = (bank: number) => all.filter((entry) => bank > entry.q1 + EPSILON);
  const fixedFails = overcompensated(governing);
  const fixedVerdict = add({
    id: "fixed-bank",
    title: "Fixed bank without overcompensation",
    verdict: governing <= EPSILON ? "pass" : fixedFails.length ? "fail" : "pass",
    measured: { value: sig(governing), unit: "kvar" },
    limit: { value: sig(lightest.q1), unit: "kvar" },
    note:
      governing <= EPSILON
        ? "No compensation is needed in any scenario."
        : fixedFails.length
          ? `A fixed ${fmt(governing)} kvar bank exceeds Q1 in ${fixedFails.length} of ${all.length} scenarios/intervals (lowest Q1 ${fmt(lightest.q1)} kvar at ${lightest.label}): the installation would run capacitive (overcompensation).`
          : `A fixed ${fmt(governing)} kvar bank stays at or below Q1 in every scenario and interval (lowest ${fmt(lightest.q1)} kvar at ${lightest.label}).`,
  });
  const shareVerdict = add({
    id: "fixed-share",
    title: "Fixed bank at most 15 % of the transformer rating",
    verdict: sn === null ? "unknown" : governing <= FIXED_SHARE * sn + EPSILON ? "pass" : "fail",
    measured: { value: sig(governing), unit: "kvar" },
    ...(sn !== null ? { limit: { value: sig(FIXED_SHARE * sn), unit: "kvar" } } : {}),
    note:
      sn === null
        ? "Unknown: the supplying transformer's apparentPower is not in the model."
        : `Commonly applied rule of the guide: fixed compensation up to 15 % of the ${fmt(sn)} kVA transformer rating, automatic above.`,
  });
  const bankType: "none" | "fixed" | "automatic" =
    governing <= EPSILON
      ? "none"
      : fixedVerdict === "pass" && shareVerdict !== "fail"
        ? "fixed"
        : "automatic";
  sources.add(GUIDE_SOURCES[0] as string);

  interface Candidate {
    key: string;
    qs: Num;
    p: number;
    steps: number | null;
    ratio: Num;
    verdict: Verdict;
    entry?: CatalogCoordinationEntry;
  }
  const candidates: Candidate[] = [];
  const contactor = request.contactor ? items.get(request.contactor) : undefined;
  const protection = request.protection ? items.get(request.protection) : undefined;
  for (const step of request.steps ?? []) {
    const capacitor = items.get(step.capacitor) as CatalogItem;
    const reactor = step.reactor ? items.get(step.reactor) : undefined;
    const units = step.units ?? 1;
    const key =
      `${capacitor.orderCode}${reactor ? `+${reactor.orderCode}` : ""}${units > 1 ? `x${units}` : ""}`.replace(
        /[^A-Za-z0-9.+-]/g,
        "-",
      );
    const verdicts: Verdict[] = [];
    const check = (name: string, title: string, rest: Omit<Criterion, "id" | "title" | "subject">) => {
      verdicts.push(add({ id: `${name}:${key}`, title, ...rest }));
    };
    if (familyCategory(capacitor) !== "capacitor")
      check("capacitor", "Capacitor item", {
        verdict: "fail",
        note: `${capacitor.orderCode} is not of category capacitor.`,
      });
    if (reactor && familyCategory(reactor) !== "detuned-reactor")
      check("reactor", "Detuned reactor item", {
        verdict: "fail",
        note: `${reactor.orderCode} is not of category detuned-reactor.`,
      });

    // Step output at the network voltage.
    let qs: Num = null;
    let p = 0;
    let ur: Num = null;
    let ratio: Num = null;
    let entry: CatalogCoordinationEntry | undefined;
    const ratedVoltage = pick(capacitor, "ratedVoltage", "V", "low");
    if (reactor) {
      const answer =
        un !== null && frequency !== null
          ? coordinationFor(
              catalog as IndustrialCatalog,
              catalogStamp as CatalogStamp,
              [capacitor.id, reactor.id],
              atNetwork(),
            )
          : null;
      entry = answer?.applicable.find((candidate) => fold(candidate.kind) === "detuned step");
      const output = entry?.parameters.find(
        (parameter) =>
          parameter.name === "reactivePower" && parameter.status === "confirmed" && parameter.value !== null,
      );
      const tuning = entry?.parameters.find(
        (parameter) =>
          parameter.name === "tuningFactor" && parameter.status === "confirmed" && parameter.value !== null,
      );
      if (entry?.parameters[0]?.source)
        sources.add(
          `${entry.parameters[0].source.publisher ?? ""}: ${entry.parameters[0].source.title}, ${entry.parameters[0].source.uri ?? ""}`,
        );
      check("step-combination", "Cited capacitor/reactor combination", {
        verdict: entry && output && tuning ? "pass" : "unknown",
        note:
          entry && output && tuning
            ? `Table ${entry.table}: ${output.value} ${output.unit} per pair at ${fmt(un as number)} V ${frequency} Hz, p ${tuning.value} ${tuning.unit}.`
            : un === null || frequency === null
              ? "Unknown: the network voltage or frequency is unknown."
              : `Unknown: no applicable cited "detuned step" table entry for exactly ${capacitor.orderCode} + ${reactor.orderCode} at ${fmt(un)} V ${frequency} Hz with reactivePower and tuningFactor; a pair is never derived from its inductance and capacitance.`,
      });
      if (entry && output && tuning) {
        qs = (units * toBaseUnit(output.value as number, output.unit)) / 1000;
        p = toBaseUnit(tuning.value as number, tuning.unit);
        const entryRatio = entry.parameters.find(
          (parameter) =>
            parameter.name === "overcurrentRatio" &&
            parameter.status === "confirmed" &&
            parameter.value !== null,
        );
        ratio = entryRatio
          ? toBaseUnit(entryRatio.value as number, entryRatio.unit)
          : (() => {
              const a = pick(capacitor, "overcurrentRatio", "1", "low").value;
              const b = pick(reactor, "overcurrentRatio", "1", "low").value;
              return a === null || b === null ? null : Math.min(a, b);
            })();
      }
      ur = ratedVoltage.value;
    } else if (un !== null && frequency !== null) {
      const ratings = citedEntries(capacitor, "reactivePower").filter((parameter) => {
        const hz = conditionBase(parameter.conditions, "frequency");
        return hz !== null && hz > 0 && conditionBase(parameter.conditions, "voltage") !== null;
      });
      const outputs = ratings.map((parameter) => {
        const voltage = conditionBase(parameter.conditions, "voltage") as number;
        const hz = conditionBase(parameter.conditions, "frequency") as number;
        return {
          q:
            (toBaseUnit(parameter.value as number, parameter.unit) / 1000) *
            (un / voltage) ** 2 *
            (frequency / hz),
          voltage,
          parameter,
        };
      });
      const lowest = outputs.reduce<(typeof outputs)[number] | null>(
        (best, entryOut) => (best === null || entryOut.q < best.q ? entryOut : best),
        null,
      );
      if (lowest) {
        qs = units * lowest.q;
        ur = ratedVoltage.value ?? lowest.voltage;
        const source = lowest.parameter.source;
        sources.add(
          `${source.publisher ?? ""}: ${source.title}, ${source.revision ?? ""}${source.uri ? `, ${source.uri}` : ""}`,
        );
      } else
        messages.push(
          `${capacitor.orderCode}: no cited reactivePower at a stated voltage and ${frequency} Hz; its step output is unknown.`,
        );
      ratio = pick(capacitor, "overcurrentRatio", "1", "low").value;
    }
    value(`stepOutput:${key}`, qs, "kvar");
    const i1 = qs !== null && un !== null ? stepCurrent(qs, un) : null;
    value(`stepCurrent:${key}`, i1, "A");
    const imp = i1 !== null && ratio !== null ? ratio * i1 : null;
    value(`permissibleCurrent:${key}`, imp, "A");
    const steps =
      qs !== null && qs > EPSILON ? (governing <= EPSILON ? 0 : Math.ceil(governing / qs - 1e-9)) : null;
    value(`steps:${key}`, steps, "1");

    // Step size (automatic) or the realised fixed bank against every scenario and interval.
    if (qs === null || steps === null)
      check("step-size", "Step size without overcompensation", {
        verdict: "unknown",
        note: "Unknown: the step output is unknown.",
      });
    else if (bankType === "fixed") {
      const bank = steps * qs;
      const fails = overcompensated(bank);
      check("step-size", "Fixed bank of these units without overcompensation", {
        verdict: fails.length ? "fail" : "pass",
        measured: { value: sig(bank), unit: "kvar" },
        limit: { value: sig(lightest.q1), unit: "kvar" },
        note: fails.length
          ? `${steps} x ${fmt(qs)} kvar = ${fmt(bank)} kvar exceeds Q1 at ${fails[0]?.label} (${fmt(fails[0]?.q1 ?? 0)} kvar) and ${fails.length - 1} more.`
          : `${steps} x ${fmt(qs)} kvar = ${fmt(bank)} kvar stays at or below Q1 everywhere.`,
      });
    } else {
      const fails = all.filter(
        (entry) => entry.need > EPSILON && Math.ceil(entry.need / qs - 1e-9) * qs > entry.q1 + EPSILON,
      );
      check("step-size", "Step size reaches the target without overcompensation", {
        verdict: fails.length ? "fail" : "pass",
        measured: { value: sig(qs), unit: "kvar" },
        note: fails.length
          ? `A ${fmt(qs)} kvar step cannot reach the target without leading operation at ${fails[0]?.label} (need ${fmt(fails[0]?.need ?? 0)} kvar, Q1 ${fmt(fails[0]?.q1 ?? 0)} kvar) and ${fails.length - 1} more: choose a smaller step.`
          : `Every scenario and interval reaches the target with whole ${fmt(qs)} kvar steps at or below its Q1.`,
      });
    }
    if (bankType === "automatic")
      check("step-count", "Steps within the regulator's outputs", {
        verdict:
          steps === null
            ? "unknown"
            : request.maxSteps === undefined
              ? "not-evaluated"
              : steps <= request.maxSteps
                ? "pass"
                : "fail",
        ...(steps !== null ? { measured: { value: steps, unit: "1" } } : {}),
        ...(request.maxSteps !== undefined ? { limit: { value: request.maxSteps, unit: "1" } } : {}),
        note:
          request.maxSteps === undefined
            ? "Not evaluated: maxSteps is not stated."
            : `${steps ?? "unknown"} steps of ${qs === null ? "unknown" : fmt(qs)} kvar for ${fmt(governing)} kvar.`,
      });

    // Capacitor voltage with tolerance and detuning.
    {
      const steady =
        un === null ? null : Math.max(un * (1 + (request.voltageTolerance ?? 0) / 100), voltageMax ?? 0);
      const needed = steady === null ? null : steady / (1 - p);
      check("capacitor-voltage", "Capacitor rated voltage", {
        verdict:
          ur === null || needed === null || request.voltageTolerance === undefined
            ? "unknown"
            : ur >= needed - EPSILON
              ? "pass"
              : "fail",
        ...(ur !== null ? { measured: { value: sig(ur), unit: "V" } } : {}),
        ...(needed !== null ? { limit: { value: sig(needed), unit: "V" } } : {}),
        note:
          ur === null
            ? "Unknown: no cited capacitor rated voltage."
            : request.voltageTolerance === undefined
              ? `Unknown: voltageTolerance is not stated (at Un the capacitor needs ${needed === null ? "unknown" : fmt(needed)} V).`
              : `Needs max(Un x (1 + ${request.voltageTolerance} %), measured max${voltageMax === null ? " unknown" : ` ${fmt(voltageMax)} V`})${p ? ` / (1 - ${fmt(p)})` : ""}.${cite(ratedVoltage.criterion)}`,
      });
    }
    // Harmonic duty.
    if (!reactor) {
      const tolerance = pick(capacitor, "capacitanceToleranceMax", "%", "high");
      const capRatio = ratio;
      const currentRatio =
        un !== null && ur !== null && tolerance.value !== null && voltageHarmonics.size
          ? capacitorCurrentRatio(un, ur, tolerance.value, voltageHarmonics)
          : null;
      value(`capacitorCurrentRatio:${key}`, currentRatio, "1");
      check("harmonic-duty", "Capacitor current with the measured harmonic voltages", {
        verdict:
          currentRatio === null || capRatio === null
            ? "unknown"
            : currentRatio <= capRatio + EPSILON
              ? "pass"
              : "fail",
        ...(currentRatio !== null ? { measured: { value: sig(currentRatio), unit: "1" } } : {}),
        ...(capRatio !== null ? { limit: { value: sig(capRatio), unit: "1" } } : {}),
        note: !voltageHarmonics.size
          ? "Unknown: no measured harmonic voltages."
          : tolerance.value === null
            ? `Unknown: ${why(tolerance.criterion, "capacitanceToleranceMax")}.`
            : capRatio === null
              ? "Unknown: no cited overcurrentRatio."
              : `Irms/In = (Un/Ur)(1 + tolerance) sqrt(1 + sum (h uh)²) with the measured maximum per order.${cite(tolerance.criterion)}`,
      });
    } else {
      const limitsCited = (entry?.parameters ?? []).filter(
        (parameter) =>
          (parameter.name === "harmonicVoltageMax" || parameter.name === "thdVoltageMax") &&
          parameter.status === "confirmed" &&
          parameter.value !== null,
      );
      const findings: string[] = [];
      let verdict: Verdict = limitsCited.length ? "pass" : "unknown";
      for (const parameter of limitsCited) {
        const order = conditionBase(parameter.conditions, "harmonicOrder");
        const measured =
          parameter.name === "thdVoltageMax"
            ? harmonicMax.get("thdVoltage")
            : order === null
              ? undefined
              : voltageHarmonics.get(Math.round(order));
        const limit = toBaseUnit(parameter.value as number, parameter.unit);
        const where = parameter.name === "thdVoltageMax" ? "THDu" : `U${order}`;
        if (measured === undefined) {
          verdict = verdict === "fail" ? "fail" : "unknown";
          findings.push(`${where} not measured`);
        } else if (measured > limit + EPSILON) {
          verdict = "fail";
          findings.push(`${where} ${fmt(measured * 100)} % > ${fmt(limit * 100)} %`);
        }
      }
      check("harmonic-duty", "Measured harmonic voltages within the combination's cited limits", {
        verdict,
        note: !entry
          ? "Unknown: no cited combination."
          : !limitsCited.length
            ? "Unknown: the combination's table entry cites no harmonic voltage limits."
            : findings.length
              ? `${findings.join("; ")}.`
              : "Every cited harmonic voltage limit holds for the measured maxima.",
      });
    }
    // Non-linear share.
    {
      const share = pick(capacitor, "nonLinearShareMax", "%", "low");
      const actual = gh !== null && sn !== null && sn > 0 ? gh / sn : null;
      check("non-linear-share", "Non-linear load share within the capacitor's limit", {
        verdict:
          actual === null || share.value === null
            ? "unknown"
            : actual <= share.value + EPSILON
              ? "pass"
              : "fail",
        ...(actual !== null ? { measured: { value: sig(actual * 100), unit: "%" } } : {}),
        ...(share.value !== null ? { limit: { value: sig(share.value * 100), unit: "%" } } : {}),
        note:
          actual === null
            ? "Unknown: harmonicGeneratorPower or the transformer rating is not stated."
            : share.value === null
              ? `Unknown: ${why(share.criterion, "nonLinearShareMax")}.`
              : `Gh / Sn = ${fmt(gh as number)} / ${fmt(sn as number)} kVA.${cite(share.criterion)}`,
      });
    }
    // Configuration rule.
    {
      const duty = capacitor.attributes?.duty;
      const own = reactor ? 2 : duty === "standard" ? 0 : duty === "heavy-duty" ? 1 : null;
      sources.add(GUIDE_SOURCES[1] as string);
      check("configuration", "Configuration for the harmonic level (guide Fig. L34)", {
        verdict:
          requiredClass === null || own === null
            ? "unknown"
            : requiredClass === 3
              ? "fail"
              : own >= requiredClass
                ? "pass"
                : "fail",
        note:
          requiredClass === null
            ? "Unknown: harmonicGeneratorPower or the fault level is not known."
            : requiredClass === 3
              ? `Gh ${fmt(gh as number)} kVA > Ssc/30 ${fmt((ssc as number) / 30)} kVA: harmonic filtering is necessary; VERA designs no filter.`
              : own === null
                ? "Unknown: the capacitor has no duty attribute (standard or heavy-duty)."
                : `Gh/Ssc needs ${CLASSES[requiredClass]}; the step is ${CLASSES[own]}.`,
      });
    }
    // Resonance per bank state.
    {
      const qc = qs === null ? null : qs * (1 - p);
      const margin = request.resonanceMargin;
      const states =
        steps === null
          ? []
          : bankType === "fixed"
            ? [steps]
            : Array.from({ length: Math.min(steps, MAX_STATES) }, (_, at) => at + 1);
      sources.add(GUIDE_SOURCES[2] as string);
      let verdict: Verdict = "pass";
      const notes: string[] = [];
      const hits: string[] = [];
      const missing =
        qc === null
          ? "the step output is unknown"
          : ssc === null
            ? "the board's fault level is unknown (no network result)"
            : margin === undefined
              ? "resonanceMargin is not stated"
              : !measuredOrders.size
                ? "no harmonic orders are measured"
                : steps !== null && bankType !== "fixed" && steps > MAX_STATES
                  ? `the bank has ${steps} steps; more than ${MAX_STATES} states are not evaluated - choose a larger step`
                  : null;
      if (missing) {
        verdict = "unknown";
        notes.push(`Unknown: ${missing}.`);
      }
      if (qc !== null && ssc !== null) {
        // Both ends of the fault level: a weaker network lowers the order and can move it onto a harmonic, so the
        // worse of the two verdicts stands.
        const levels =
          sscMin === null
            ? [{ ssc, at: "" }]
            : [
                { ssc, at: " at maximum Ssc" },
                { ssc: sscMin, at: " at minimum Ssc" },
              ];
        levels.forEach((level, index) => {
          states.forEach((state) => {
            const order = resonanceOrder(level.ssc, state * qc, p);
            if (index === 0 && state <= 12) value(`resonanceOrder:${key}@${state}`, order, "1");
            if (missing) return;
            const width = margin as number;
            const near = [...significant].filter((h) => Math.abs(order - h) <= width * h + EPSILON);
            const unmeasured = Array.from({ length: 49 }, (_, at) => at + 2).filter(
              (h) => !measuredOrders.has(h) && Math.abs(order - h) <= width * h + EPSILON,
            );
            const head = `${state} step(s): h ${fmt(order)}`;
            if (near.length) {
              verdict = "fail";
              hits.push(`${head} near measured order ${near.join(", ")}${level.at}`);
            } else if (highestOrder !== null && order > highestOrder * (1 + width)) {
              if (verdict === "pass") verdict = "unknown";
              notes.push(`${head} above the highest measured order ${highestOrder}${level.at}`);
            } else if (unmeasured.length) {
              if (verdict === "pass") verdict = "unknown";
              notes.push(`${head} near unmeasured order ${unmeasured.join(", ")}${level.at}`);
            }
          });
        });
        // The failing states first, the maximum level before the minimum: the note is cut at 1000 characters.
        notes.unshift(...hits);
      }
      if (!missing && !notes.length)
        notes.push("No bank state resonates within the margin of a significant measured order.");
      check("resonance", "Parallel resonance against the measured harmonic orders", {
        verdict: states.length ? verdict : missing ? "unknown" : "pass",
        note: `${notes.join("; ")}${missing ? "" : ` (Ssc ${fmt(ssc as number)} kVA${sscMin === null ? " maximum only" : ` maximum and ${fmt(sscMin)} kVA minimum`}, margin ${margin}, threshold ${request.harmonicThreshold ?? "> 0"} %).`}`,
      });
    }
    // Contactor and protection for this step.
    if (contactor) {
      const rating =
        familyCategory(contactor) === "capacitor-contactor"
          ? pick(contactor, "reactivePowerMax", "kvar", "low", atNetwork())
          : null;
      const kvar = rating?.value === null || rating === null ? null : rating.value / 1000;
      check("contactor", `Capacitor contactor ${contactor.orderCode}`, {
        verdict:
          rating === null || kvar === null || qs === null
            ? "unknown"
            : kvar >= qs - EPSILON
              ? "pass"
              : "fail",
        ...(qs !== null ? { measured: { value: sig(qs), unit: "kvar" } } : {}),
        ...(kvar !== null ? { limit: { value: sig(kvar), unit: "kvar" } } : {}),
        note:
          rating === null
            ? `Unknown: ${contactor.orderCode} is not a capacitor-duty contactor (category capacitor-contactor).`
            : kvar === null
              ? `Unknown: ${why(rating.criterion, "reactivePowerMax")} at the network voltage and frequency.`
              : `Switches ${fmt(kvar)} kvar at ${fmt(un as number)} V.${cite(rating.criterion)}`,
      });
    }
    if (protection) {
      const rated = pick(protection, "ratedCurrent", "A", "low");
      const settingTop = pick(protection, "settingCurrentMax", "A", "low");
      const deviceCurrent = settingTop.value ?? rated.value;
      sources.add(GUIDE_SOURCES[3] as string);
      check("protection", `Step protection ${protection.orderCode}`, {
        verdict:
          deviceCurrent === null || imp === null
            ? "unknown"
            : deviceCurrent >= imp - EPSILON
              ? "pass"
              : "fail",
        ...(deviceCurrent !== null ? { measured: { value: sig(deviceCurrent), unit: "A" } } : {}),
        ...(imp !== null ? { limit: { value: sig(imp), unit: "A" } } : {}),
        note:
          imp === null
            ? "Unknown: the step current or the permissible overcurrent ratio is unknown."
            : deviceCurrent === null
              ? "Unknown: no cited rated current or setting range."
              : `The device must carry the permissible current IMP = ${fmt(ratio as number)} x ${fmt(i1 as number)} A (long-time setting rule of the guide).${cite(settingTop.value !== null ? settingTop.criterion : rated.criterion)}`,
      });
      const category = familyCategory(protection);
      if (category === "fuse-link")
        check("inrush", `Inrush withstand of ${protection.orderCode}`, {
          verdict: "not-evaluated",
          note: "Not evaluated: a fuse's inrush withstand needs its time-current data.",
        });
      else {
        const magnetic = pick(protection, "magneticTripCurrent", "A", "low");
        const multiple = pick(protection, "magneticTripMultiple", "1", "low");
        const base =
          magnetic.value ??
          (multiple.value !== null && rated.value !== null ? multiple.value * rated.value : null);
        const needed = i1 === null ? null : INRUSH_MULTIPLE * i1;
        check("inrush", `Short-time setting of ${protection.orderCode} above the inrush`, {
          verdict: base === null || needed === null ? "unknown" : base >= needed - EPSILON ? "pass" : "fail",
          ...(base !== null ? { measured: { value: sig(base), unit: "A" } } : {}),
          ...(needed !== null ? { limit: { value: sig(needed), unit: "A" } } : {}),
          note:
            base === null
              ? "Unknown: no cited magnetic trip current."
              : "The guide sets the short-time protection at 10 x IN to stay insensitive to inrush.",
        });
      }
    }
    // Not-evaluated checks (no stated limit, fuse inrush) are listed but neither pass nor block the step.
    const evaluated = verdicts.filter((entry) => entry !== "not-evaluated");
    const stepVerdict: Verdict = evaluated.includes("fail")
      ? "fail"
      : evaluated.every((entry) => entry === "pass")
        ? "pass"
        : "unknown";
    add({
      id: `step:${key}`,
      title: "Step candidate",
      verdict: stepVerdict,
      note: `${evaluated.filter((entry) => entry === "pass").length} of ${evaluated.length} evaluated checks pass${evaluated.length < verdicts.length ? `; ${verdicts.length - evaluated.length} not evaluated` : ""}.`,
    });
    candidates.push({ key, qs, p, steps, ratio, verdict: stepVerdict, ...(entry ? { entry } : {}) });
  }

  // ---- proposal, regulation model and the values after compensation ----------------------------------------------
  const byOutput = (a: Candidate, b: Candidate) => (b.qs ?? 0) - (a.qs ?? 0);
  const chosen =
    candidates.filter((entry) => entry.verdict === "pass").sort(byOutput)[0] ??
    candidates.filter((entry) => entry.verdict === "unknown" && entry.qs !== null).sort(byOutput)[0];
  const stepMax = Math.min(
    ...all.filter((entry) => entry.need > EPSILON).map((entry) => entry.p * tanTarget),
  );
  value("stepOutputMax", Number.isFinite(stepMax) ? stepMax : null, "kvar");
  conditions.bankType = { text: bankType };
  const passing = chosen?.verdict === "pass";
  const proposalVerdict: Verdict =
    bankType === "none"
      ? "pass"
      : passing
        ? bankType === "fixed" && shareVerdict === "unknown"
          ? "unknown"
          : "pass"
        : candidates.some((entry) => entry.verdict === "unknown") || !candidates.length
          ? "unknown"
          : "fail";
  const qs = chosen?.qs ?? null;
  const steps = chosen?.steps ?? null;
  if (chosen && qs !== null && steps !== null) {
    conditions.step = { text: chosen.key };
    conditions.stepOutput = { value: sig(qs), unit: "kvar" };
    conditions.steps = { value: steps, unit: "1" };
    conditions.bankOutput = { value: sig(qs * steps), unit: "kvar" };
  }
  if (bankType !== "none")
    conditions.controlLogic = {
      text:
        bankType === "fixed"
          ? `Proposal only: fixed bank${qs !== null && steps !== null ? ` of ${steps} x ${fmt(qs)} kvar` : ""} switched with its feeder; no regulator; reconnect only after the discharge time.`
          : `Proposal, not a setting: DPF ${fmt(request.targetPowerFactor, 4)} lag; ${steps ?? "N"} x ${qs === null ? "q" : fmt(qs)} kvar equal steps, circular; add one while Q1 - P tan phi_t >= step, drop one if leading; reconnect only after discharge time.`,
    };
  add({
    id: "proposal",
    title: "Bank proposal",
    verdict: proposalVerdict,
    note:
      bankType === "none"
        ? "No bank: every scenario already reaches the target."
        : `${bankType === "fixed" ? "Fixed" : "Automatic"} bank for ${fmt(governing)} kvar${chosen ? ` with ${chosen.key} (${steps} x ${qs === null ? "?" : fmt(qs)} kvar)` : ""}${proposalVerdict === "pass" ? "." : proposalVerdict === "fail" ? ": every step candidate fails." : !candidates.length ? ": name step candidates from a catalog." : ": conditional, open checks remain."}`,
  });

  const after = (entry: Sample) => {
    let connected: number;
    if (bankType === "none") connected = 0;
    else if (qs === null || steps === null)
      connected = entry.need; // ideal continuous compensation
    else if (bankType === "fixed") connected = steps * qs;
    else {
      let n = Math.min(steps, Math.ceil(entry.need / qs - 1e-9));
      if (n * qs > entry.q1 + EPSILON) n = Math.max(0, Math.floor(entry.q1 / qs + 1e-9));
      connected = n * qs;
    }
    return powerFactorAfter(entry.p, entry.q1 - connected, entry.d2);
  };
  if (!chosen && bankType !== "none")
    messages.push("The values after compensation assume the exact need (no step product chosen).");
  for (const entry of named) {
    const before = powerFactorAfter(entry.p, entry.q1, entry.d2);
    const later = after(entry);
    value(`activePower:${entry.label}`, entry.p, "kW");
    value(`reactivePower:${entry.label}`, entry.q1, "kvar");
    value(
      `displacementFactor:${entry.label}`,
      before.displacement * (before.character === "leading" ? -1 : 1),
      "1",
    );
    value(`totalPowerFactor:${entry.label}`, entry.totalPf, "1");
    value(`compensationNeed:${entry.label}`, entry.need, "kvar");
    value(
      `displacementFactorAfter:${entry.label}`,
      later.displacement * (later.character === "leading" ? -1 : 1),
      "1",
    );
    value(`totalPowerFactorAfter:${entry.label}`, later.total, "1");
    if (entry.approx)
      messages.push(
        `${entry.label}: total power factor approximated as DPF / sqrt(1 + THDi²) (sinusoidal voltage).`,
      );
    add({
      id: `target:${entry.label}`,
      title: "Displacement factor after compensation",
      verdict:
        later.character !== "leading" && later.displacement >= request.targetPowerFactor - 1e-6
          ? "pass"
          : "fail",
      measured: { value: sig(later.displacement), unit: "1" },
      limit: { value: request.targetPowerFactor, unit: "1" },
      note: `${later.character} after compensation (before: ${fmt(before.displacement)} ${before.character}).`,
    });
    if (request.totalPowerFactorMin !== undefined)
      add({
        id: `total-power-factor:${entry.label}`,
        title: "Total power factor after compensation",
        verdict:
          later.total === null
            ? "unknown"
            : later.total >= request.totalPowerFactorMin - 1e-6
              ? "pass"
              : "fail",
        ...(later.total !== null ? { measured: { value: sig(later.total), unit: "1" } } : {}),
        limit: { value: request.totalPowerFactorMin, unit: "1" },
        note:
          later.total === null
            ? "Unknown: no apparent power, power factor or THDi for this scenario."
            : "Capacitors correct only the displacement part; the distortion part stays.",
      });
  }
  if (rows.length) {
    const results = rows.map((entry) => ({ entry, later: after(entry) }));
    const misses = results.filter(
      ({ later }) => later.character === "leading" || later.displacement < request.targetPowerFactor - 1e-6,
    );
    add({
      id: "target:measured",
      title: "Displacement factor after compensation in every measured interval",
      verdict: misses.length ? "fail" : "pass",
      limit: { value: request.targetPowerFactor, unit: "1" },
      note: misses.length
        ? `${misses.length} of ${rows.length} intervals miss the target, first ${misses[0]?.entry.time}.`
        : `All ${rows.length} evaluated intervals reach the target without leading operation.`,
    });
    if (request.totalPowerFactorMin !== undefined) {
      const known = results.filter(({ later }) => later.total !== null);
      const low = known.filter(
        ({ later }) => (later.total as number) < (request.totalPowerFactorMin as number) - 1e-6,
      );
      add({
        id: "total-power-factor:measured",
        title: "Total power factor after compensation in every measured interval",
        verdict: !known.length
          ? "unknown"
          : low.length
            ? "fail"
            : known.length < rows.length
              ? "unknown"
              : "pass",
        limit: { value: request.totalPowerFactorMin, unit: "1" },
        note: !known.length
          ? "Unknown: no interval has S, PF or THDi."
          : `${low.length} of ${known.length} intervals below the minimum${known.length < rows.length ? `; ${rows.length - known.length} without S, PF or THDi` : ""}.`,
      });
    }
  }
  return finish("completed");
}
