// The radial LV network engine "vera-radial-lv-1" (spec REQ-DATA-42ce122f "Method"): load balance per scenario,
// design currents, cable sizing from a cited cable table, voltage drop and fault currents by the impedance method
// with the voltage factors and transformer correction of IEC 60909-0:2016. Pure: it reads the model and a table and
// returns one format-1 electrical result; it never changes the model.
import {
  type CableTable,
  type ElectricalModel,
  type ElectricalObject,
  type ElectricalRelation,
  type ElectricalResult,
  electricalIdSchema,
  electricalLimits,
} from "@vera/shared";
import { z } from "zod";
import { type CableTableStamp, groupingFactor, tableRating, temperatureFactor } from "./cable-table.js";
import { toBaseUnit, unitDimension } from "./units.js";

export const NETWORK_ENGINE = { name: "vera-radial-lv", version: "1.0.0" } as const;
export const NETWORK_METHOD = {
  id: "vera-radial-lv-1",
  title:
    "Radial LV network: load balance, cable sizing, voltage drop and fault currents (impedance method after IEC 60909-0:2016)",
} as const;

const scenarioId = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "must be a lowercase scenario id");
const factors = z
  .record(electricalIdSchema, z.number().min(0).max(1))
  .refine((entries) => Object.keys(entries).length <= 200, "must hold at most 200 entries");
const percent = z.strictObject({ value: z.number().positive().max(100), unit: z.literal("%") });
export const networkRequestSchema = z.strictObject({
  cableTable: electricalIdSchema,
  source: electricalIdSchema.optional(),
  voltageTolerance: z.union([z.literal(6), z.literal(10)]),
  scenarios: z
    .array(
      z.strictObject({
        id: scenarioId,
        title: z
          .string()
          .min(1)
          .max(160)
          .refine((value) => !/\p{Cc}/u.test(value), "must not contain control characters"),
        simultaneity: factors.optional(),
        loads: factors.optional(),
      }),
    )
    .min(1)
    .max(8)
    .refine(
      (list) => new Set(list.map((scenario) => scenario.id)).size === list.length,
      "scenario ids must be unique",
    ),
  voltageDropLimit: percent,
  voltageDropLimitLighting: percent.optional(),
  faultDuration: z
    .strictObject({ value: z.number().positive().max(5000), unit: z.enum(["s", "ms"]) })
    .optional(),
  /** Ω/km used for conductors whose table reactance is unknown; recorded as an assumption. */
  assumedReactance: z.number().positive().max(1).optional(),
});
export type NetworkRequest = z.infer<typeof networkRequestSchema>;

export interface NetworkInput {
  model: ElectricalModel;
  modelPath: string;
  modelSha256: string;
  table: CableTable;
  tableStamp: CableTableStamp;
  request: NetworkRequest;
  runId: string;
  /** ISO time of the run. */
  now: string;
}

// ---- complex numbers -------------------------------------------------------------------------------------------
interface C {
  re: number;
  im: number;
}
const c = (re: number, im = 0): C => ({ re, im });
const add = (a: C, b: C): C => c(a.re + b.re, a.im + b.im);
const scale = (a: C, k: number): C => c(a.re * k, a.im * k);
const abs = (a: C) => Math.hypot(a.re, a.im);
const rotate = (a: C, degrees: number): C => {
  const r = (degrees * Math.PI) / 180;
  return c(a.re * Math.cos(r) - a.im * Math.sin(r), a.re * Math.sin(r) + a.im * Math.cos(r));
};
const PHASE_ANGLE = [0, -120, 120] as const;
const PHASES = ["L1", "L2", "L3"] as const;

const ALPHA_OPERATION = { copper: 0.00393, aluminium: 0.00403 } as const;
/** IEC 60909-0:2016 temperature coefficient for the resistance at the end of the short circuit. */
const ALPHA_SHORT_CIRCUIT = 0.004;
const C_MIN = 0.95;
const C_Q_MAX = 1.1;
const C_Q_MIN = 1.0;
const DEFAULT_RQ_XQ = 0.1;
/** Share of the supply voltage a motor's rated voltage may differ by before a message names it. */
const MOTOR_VOLTAGE_TOLERANCE = 0.1;
const sig = (value: number) => Number(value.toPrecision(6));

// ---- model reading ---------------------------------------------------------------------------------------------
type Num = number | null;
/** A property in its dimension's base unit (W, V, A, m, mm², ratio 1, K -> °C), or null when absent, unknown or of
 * another dimension than `dimension`. */
function prop(object: ElectricalObject | undefined, name: string, dimension: string): Num {
  const quantity = object?.properties?.[name];
  if (!quantity || quantity.value === null || unitDimension(quantity.unit) !== dimension) return null;
  const base = toBaseUnit(quantity.value, quantity.unit);
  return dimension === "temperature" ? base - 273.15 : base;
}
const attr = (object: ElectricalObject | undefined, name: string) => {
  const value = object?.attributes?.[name];
  return typeof value === "string" ? value : undefined;
};
const label = (object: ElectricalObject) => (object.ref ? `${object.ref} (${object.id})` : object.id);

interface Flow {
  p: number;
  q: number;
  /** Phase current phasors in A; null when a single-phase load has no phase. */
  i: [C, C, C] | null;
}
const ZERO_FLOW = (): Flow => ({ p: 0, q: 0, i: [c(0), c(0), c(0)] });
function sumFlows(flows: readonly (Flow | null)[]): Flow | null {
  const out = ZERO_FLOW();
  for (const flow of flows) {
    if (flow === null) return null;
    out.p += flow.p;
    out.q += flow.q;
    out.i =
      out.i && flow.i ? [add(out.i[0], flow.i[0]), add(out.i[1], flow.i[1]), add(out.i[2], flow.i[2])] : null;
  }
  return out;
}
const scaleFlow = (flow: Flow, k: number): Flow => ({
  p: flow.p * k,
  q: flow.q * k,
  i: flow.i && [scale(flow.i[0], k), scale(flow.i[1], k), scale(flow.i[2], k)],
});
/** The highest phase current, or null when a single-phase load's phase is unknown. */
const maxPhase = (flow: Flow): Num => (flow.i ? Math.max(...flow.i.map(abs)) : null);

// ---- the engine ------------------------------------------------------------------------------------------------
export function analyzeNetwork(input: NetworkInput): ElectricalResult {
  const { model, table, request } = input;
  const objects = new Map(model.objects.map((object) => [object.id, object]));
  const byType = (type: ElectricalRelation["type"]) =>
    model.relations.filter((relation) => relation.type === type);
  const children = new Map<string, ElectricalRelation[]>();
  for (const relation of byType("feeds"))
    children.set(relation.from, [...(children.get(relation.from) ?? []), relation]);
  const routes = new Map<string, ElectricalRelation[]>();
  for (const relation of byType("routes"))
    routes.set(relation.to, [...(routes.get(relation.to) ?? []), relation]);
  const protects = new Map<string, ElectricalRelation[]>();
  for (const relation of byType("protects"))
    protects.set(relation.to, [...(protects.get(relation.to) ?? []), relation]);

  const read = new Map<string, unknown>([[model.project.id, model.project]]);
  const touch = (entity: { id: string }) => read.set(entity.id, entity);
  const assumptions: string[] = [
    "Equivalent voltage source c*Un/sqrt(3) at the fault location (IEC 60909-0:2016 principle); far-from-generator faults; no motor contribution; no fault impedance; no load currents before the fault.",
    "Transformer correction KT = 0.95*cmax/(1+0.6*xT) applied to the transformer impedance for the maximum and the minimum fault currents.",
    "Cable resistance at 20 °C for maximum fault currents and at the table's short-circuit temperature (alpha 0.004) for minimum fault currents; at the table's maximum conductor temperature for voltage drop.",
    "Board and busbar connections have no impedance; voltage drop is counted from the source's LV terminals.",
    "Simultaneity factors apply to a board's or busbar's sum; demand factors apply to loads when a board sums them, not to a final circuit's design current.",
    "The source's rated voltage Un is the transformer's rated LV voltage and the network feeder's voltage is the transformer's rated HV voltage (rated ratio); primaryVoltage is recorded, not used.",
    "A three-phase circuit with unbalanced loads uses the three-phase drop formula with its highest phase current; the drop on the neutral is not counted.",
  ];
  const limits: string[] = [
    "Radial three-phase AC LV networks fed by one transformer or LV supply point only; meshed networks, ties, parallel cables, generators, UPS, PV and DC are not evaluated.",
    "Peak current with kappa = 1.02 + 0.98*exp(-3R/X) of the total impedance at the fault (radial network); no thermal equivalent current Ith, no DC component.",
    "Line-to-earth faults only in TN systems with a Dyn transformer (zero-sequence impedance taken equal to the positive-sequence one) or a supply with a stated loop impedance Ze; cable zero sequence = phase + 3 x protective conductor, same reactance per length.",
    "Cable ratings and correction factors come only from the cited cable table; values are looked up at the next tabulated point at or above the input, never interpolated. No IEC 60364-5-52 table is part of VERA.",
    "Protective device selection, overload coordination (I2 <= 1.45 Iz), disconnection times and selectivity are not evaluated here.",
    "Preliminary engineering support: no verified design, no conformity statement and no safety certification.",
  ];
  const messages: string[] = [];
  const intermediate: ElectricalResult["intermediate"] = [];
  const criteria: ElectricalResult["criteria"] = [];
  const conditions: ElectricalResult["conditions"] = {};
  const sources = new Set<string>([
    `${table.source.publisher}: ${table.source.title}, ${table.source.revision}, read ${table.source.readAt}${table.source.pages ? `, ${table.source.pages}` : ""}${table.source.uri ? `, ${table.source.uri}` : ""}`.slice(
      0,
      200,
    ),
  ]);
  const value = (name: string, subject: string | undefined, amount: Num, unit: string) =>
    intermediate.push({
      name,
      ...(subject ? { subject } : {}),
      value: amount === null || !Number.isFinite(amount) ? null : sig(amount),
      unit,
    });
  const criterion = (entry: ElectricalResult["criteria"][number]) => criteria.push(entry);

  const cMax = request.voltageTolerance === 6 ? 1.05 : 1.1;
  conditions.cableTable = {
    text: `${input.tableStamp.id} ${input.tableStamp.version} sha256 ${input.tableStamp.sha256.slice(0, 16)}`.slice(
      0,
      200,
    ),
  };
  conditions.voltageTolerance = { value: request.voltageTolerance, unit: "%" };
  conditions.cMax = { value: cMax, unit: "1" };
  conditions.cMin = { value: C_MIN, unit: "1" };
  conditions.voltageDropLimit = { ...request.voltageDropLimit };
  if (request.voltageDropLimitLighting)
    conditions.voltageDropLimitLighting = { ...request.voltageDropLimitLighting };
  if (request.faultDuration) conditions.faultDuration = { ...request.faultDuration };
  request.scenarios.forEach((scenario, index) => {
    const parts = [
      `${scenario.id}: ${scenario.title}`,
      ...Object.entries(scenario.simultaneity ?? {}).map(([id, k]) => `ks ${id} ${k}`),
      ...Object.entries(scenario.loads ?? {}).map(([id, k]) => `load ${id} x${k}`),
    ];
    conditions[`scenario${index + 1}`] = { text: parts.join("; ").slice(0, 200) };
  });
  const methodReference = `IEC 60909-0:2016 (c, KT); cable table ${table.id} ${table.version}`.slice(0, 200);

  const finish = (status: ElectricalResult["status"]): ElectricalResult => {
    let finalStatus = status;
    for (const [list, name] of [
      [intermediate, "intermediate values"],
      [criteria, "criteria"],
    ] as const)
      if (list.length > electricalLimits.resultList) {
        messages.unshift(
          `${list.length - electricalLimits.resultList} ${name} were left out (limit ${electricalLimits.resultList}); analyse a smaller network.`,
        );
        list.length = electricalLimits.resultList;
        finalStatus = finalStatus === "completed" ? "incomplete" : finalStatus;
      }
    if (
      finalStatus === "completed" &&
      criteria.some((entry) => entry.verdict === "unknown" || entry.verdict === "not-evaluated")
    )
      finalStatus = "incomplete";
    if (read.size > electricalLimits.resultInputs) {
      messages.unshift(
        `${read.size - electricalLimits.resultInputs} inputs were left out (limit ${electricalLimits.resultInputs}): later changes to them do not mark this result stale; analyse a smaller network.`,
      );
      finalStatus = finalStatus === "completed" ? "incomplete" : finalStatus;
    }
    const inputs = [...read.entries()]
      .slice(0, electricalLimits.resultInputs)
      .map(([id, snapshot]) => ({ id, snapshot: snapshot as never }));
    if (messages.length > electricalLimits.resultList)
      messages.splice(
        electricalLimits.resultList - 1,
        messages.length,
        `${messages.length - electricalLimits.resultList + 1} further messages were left out.`,
      );
    return {
      kind: "vera-electrical-result",
      format: 1,
      runId: input.runId,
      producer: { plugin: "electrical-network", operation: "network", engine: { ...NETWORK_ENGINE } },
      method: { ...NETWORK_METHOD, reference: methodReference },
      status: finalStatus,
      preliminary: true,
      startedAt: input.now,
      finishedAt: input.now,
      model: { path: input.modelPath, sha256: input.modelSha256 },
      catalog: null,
      inputs,
      assumptions: assumptions.slice(0, electricalLimits.resultList).map((text) => text.slice(0, 1000)),
      sources: [...sources].slice(0, electricalLimits.resultList),
      conditions,
      intermediate,
      criteria,
      limits,
      messages: messages.map((text) => text.slice(0, 1000)),
    };
  };
  const blocked = (message: string) => {
    messages.push(message);
    return finish("blocked");
  };

  // Source and network checks.
  const supplies = model.objects.filter((object) => object.type === "source");
  const source = request.source
    ? objects.get(request.source)
    : supplies.length === 1
      ? supplies[0]
      : undefined;
  if (request.source && source?.type !== "source")
    return blocked(`${request.source} is not a source of the model.`);
  if (!source)
    return blocked(
      supplies.length ? "The model has several sources: name one in source." : "The model has no source.",
    );
  touch(source);
  const un = prop(source, "ratedVoltage", "voltage");
  const sourcePhases = prop(source, "phases", "ratio");
  if (un === null) return blocked(`The rated voltage of ${label(source)} is unknown.`);
  if (un < 50 || un > 1000)
    return blocked(`${label(source)} has ${un} V: only LV networks of 50..1000 V are evaluated.`);
  if (sourcePhases !== 3)
    return blocked(`${label(source)} is not a three-phase AC source (phases ${sourcePhases ?? "unknown"}).`);
  if (attr(source, "current") === "DC") return blocked(`${label(source)} is a DC source.`);
  const u0 = un / Math.sqrt(3);
  conditions.nominalVoltage = { value: un, unit: "V" };
  const earthing = attr(source, "system");
  conditions.earthing = { text: earthing ?? "unknown" };
  for (const cable of model.objects.filter((object) => object.type === "cable")) {
    const tied = byType("connects").filter(
      (relation) => relation.from === cable.id && objects.get(relation.to)?.type === "busbar",
    );
    if (tied.length >= 2)
      return blocked(
        `${label(cable)} connects ${tied.map((relation) => relation.to).join(" and ")}: a tie between busbars is not a radial network.`,
      );
  }

  // Tree from the source (feeds has at most one incoming relation and no cycle: the model guarantees a forest).
  const order: ElectricalObject[] = [];
  const parent = new Map<string, string>();
  const visit = (id: string) => {
    for (const relation of children.get(id) ?? []) {
      const child = objects.get(relation.to);
      if (!child) continue;
      touch(relation);
      touch(child);
      parent.set(child.id, id);
      order.push(child);
      visit(child.id);
    }
  };
  visit(source.id);
  const reachable = new Set<string>();
  const mark = (id: string) => {
    for (const relation of children.get(id) ?? []) {
      reachable.add(relation.to);
      mark(relation.to);
    }
  };
  for (const supply of supplies) mark(supply.id);
  const network = ["board", "busbar", "circuit", "load", "motor"];
  const unreached = model.objects.filter(
    (object) => network.includes(object.type) && !reachable.has(object.id),
  );
  if (unreached.length) {
    const names = unreached.slice(0, 30).map(label).join(", ");
    criterion({
      id: "network-coverage",
      title: "Network fed from the source",
      subject: source.id,
      verdict: "not-evaluated",
      note: `Not evaluated, not fed from any source: ${names}.`.slice(0, 1000),
    });
    messages.push(`Not evaluated, not fed from any source: ${names}.`);
  }
  const elsewhere = model.objects.filter(
    (object) => network.includes(object.type) && reachable.has(object.id) && !parent.has(object.id),
  );
  if (elsewhere.length)
    messages.push(
      `Fed from another source, not part of this run: ${elsewhere.slice(0, 30).map(label).join(", ")}.`,
    );
  for (const [index, scenario] of request.scenarios.entries())
    for (const [list, kinds] of [
      [scenario.simultaneity, ["board", "busbar"]],
      [scenario.loads, ["load", "motor"]],
    ] as const)
      for (const id of Object.keys(list ?? {}))
        if (!parent.has(id) || !kinds.includes(objects.get(id)?.type as never))
          messages.push(
            `Scenario ${scenario.id} (${index + 1}): ${id} is not a ${kinds.join(" or ")} of this network; its factor is ignored.`,
          );
  if (!order.length) return blocked(`${label(source)} feeds nothing.`);

  // Loads.
  const isLoad = (object: ElectricalObject) => object.type === "load" || object.type === "motor";
  const kids = (id: string) =>
    (children.get(id) ?? [])
      .map((relation) => objects.get(relation.to))
      .filter((o): o is ElectricalObject => !!o);
  const feeder = (id: string) => objects.get(parent.get(id) ?? "");
  interface LoadBase {
    p: number;
    q: number;
    phases: 1 | 3;
    phase?: 0 | 1 | 2;
    demand: number;
  }
  const loadBase = new Map<string, LoadBase | null>();
  for (const object of order.filter(isLoad)) {
    const circuit = feeder(object.id);
    const phasesValue =
      prop(object, "phases", "ratio") ??
      (circuit?.type === "circuit" ? prop(circuit, "phases", "ratio") : null);
    const phases = phasesValue === 1 || phasesValue === 3 ? phasesValue : null;
    const pf = prop(object, "powerFactor", "ratio");
    let p: Num = null;
    if (object.type === "load") {
      p = prop(object, "power", "power");
      const s = prop(object, "apparentPower", "apparent-power");
      if (p === null && s !== null && pf !== null) p = s * pf;
    } else {
      const current = prop(object, "ratedCurrent", "current");
      const voltage = prop(object, "ratedVoltage", "voltage") ?? (phases === 1 ? u0 : un);
      const rated = prop(object, "ratedPower", "power");
      const efficiency = prop(object, "efficiency", "ratio");
      if (current !== null && pf !== null && phases !== null) {
        p = (phases === 3 ? Math.sqrt(3) * voltage : voltage) * current * pf;
        // A winding voltage (230 V on a 400 V network) with the current of the other connection misstates the load.
        const supply = phases === 1 ? u0 : un;
        if (Math.abs(voltage - supply) > MOTOR_VOLTAGE_TOLERANCE * supply)
          messages.push(
            `${label(object)}: rated voltage ${sig(voltage)} V differs from the supply's ${sig(supply)} V by more than ${MOTOR_VOLTAGE_TOLERANCE * 100} %; its input power is computed from its own rated voltage and rated current - check that both belong to the connection used on this network.`,
          );
      } else if (rated !== null && efficiency !== null && efficiency > 0 && efficiency <= 1)
        p = rated / efficiency;
      else if (efficiency !== null && (efficiency <= 0 || efficiency > 1))
        messages.push(`${label(object)}: efficiency ${efficiency} is outside 0..1 (unit 1) or 0..100 %.`);
    }
    const phaseText =
      attr(object, "phase") ?? (circuit?.type === "circuit" ? attr(circuit, "phase") : undefined);
    const phaseIndex = PHASES.indexOf(phaseText as (typeof PHASES)[number]);
    const missing = [
      p === null && "power",
      pf === null && "power factor",
      phases === null && "phases",
    ].filter(Boolean);
    if (missing.length || p === null || pf === null || phases === null || pf <= 0 || pf > 1) {
      messages.push(
        `${label(object)}: ${missing.length ? `${missing.join(", ")} unknown` : "power factor outside 0..1"}; its circuits and boards are unknown.`,
      );
      loadBase.set(object.id, null);
      continue;
    }
    const demand = prop(object, "demandFactor", "ratio");
    if (demand !== null && (demand < 0 || demand > 1)) {
      messages.push(
        `${label(object)}: demand factor ${demand} is outside 0..1; its circuits and boards are unknown.`,
      );
      loadBase.set(object.id, null);
      continue;
    }
    if (demand === null) assumptions.push(`Demand factor 1 for ${label(object)} (none given).`);
    loadBase.set(object.id, {
      p,
      q: p * Math.tan(Math.acos(pf)),
      phases,
      ...(phases === 1 && phaseIndex >= 0 ? { phase: phaseIndex as 0 | 1 | 2 } : {}),
      demand: demand ?? 1,
    });
  }
  const loadFlow = (id: string, factor: number): Flow | null => {
    const base = loadBase.get(id);
    if (!base) return null;
    const p = base.p * factor;
    const q = base.q * factor;
    const current = c(p, -q); // conj(S) at a reference voltage of 1 V
    if (base.phases === 3) {
      const perPhase = scale(current, 1 / (3 * u0));
      return { p, q, i: [rotate(perPhase, 0), rotate(perPhase, -120), rotate(perPhase, 120)] };
    }
    if (base.phase === undefined) return { p, q, i: null };
    const flows: [C, C, C] = [c(0), c(0), c(0)];
    flows[base.phase] = rotate(scale(current, 1 / u0), PHASE_ANGLE[base.phase]);
    return { p, q, i: flows };
  };

  // Load balance per scenario: demand (boards, with demand and simultaneity factors) and design (final circuits).
  const scenarios = request.scenarios;
  const demand: Map<string, Flow | null>[] = scenarios.map(() => new Map());
  const design: Map<string, Flow | null>[] = scenarios.map(() => new Map());
  scenarios.forEach((scenario, s) => {
    const demandMap = demand[s] as Map<string, Flow | null>;
    const designMap = design[s] as Map<string, Flow | null>;
    const loadFactor = (id: string) => scenario.loads?.[id] ?? 1;
    const demandOf = (object: ElectricalObject): Flow | null => {
      const cached = demandMap.get(object.id);
      if (cached !== undefined) return cached;
      let flow: Flow | null;
      if (isLoad(object))
        flow = loadFlow(object.id, loadFactor(object.id) * (loadBase.get(object.id)?.demand ?? 1));
      else {
        flow = sumFlows(kids(object.id).map(demandOf));
        const ks = scenario.simultaneity?.[object.id];
        if (flow && ks !== undefined && (object.type === "board" || object.type === "busbar"))
          flow = scaleFlow(flow, ks);
      }
      demandMap.set(object.id, flow);
      return flow;
    };
    const designOf = (object: ElectricalObject): Flow | null => {
      const cached = designMap.get(object.id);
      if (cached !== undefined) return cached;
      const flow = isLoad(object)
        ? loadFlow(object.id, loadFactor(object.id))
        : object.type === "circuit"
          ? sumFlows(
              kids(object.id).map((child) =>
                child.type === "circuit" || isLoad(child) ? designOf(child) : demandOf(child),
              ),
            )
          : demandOf(object);
      designMap.set(object.id, flow);
      return flow;
    };
    for (const object of order) {
      demandOf(object);
      if (object.type === "circuit") designOf(object);
    }
  });
  for (const object of order.filter((o) => o.type === "board" || o.type === "busbar"))
    scenarios.forEach((scenario, s) => {
      const flow = demand[s]?.get(object.id) ?? null;
      const tag = `:${scenario.id}`;
      value(`activePower${tag}`, object.id, flow && flow.p / 1000, "kW");
      value(`reactivePower${tag}`, object.id, flow && flow.q / 1000, "kvar");
      value(`apparentPower${tag}`, object.id, flow && Math.hypot(flow.p, flow.q) / 1000, "kVA");
      value(`current${tag}`, object.id, flow && maxPhase(flow), "A");
      if (flow?.i) {
        flow.i.forEach((phase, index) => {
          value(`phaseCurrent${PHASES[index]}${tag}`, object.id, abs(phase), "A");
        });
        value(`neutralCurrent${tag}`, object.id, abs(add(add(flow.i[0], flow.i[1]), flow.i[2])), "A");
      }
    });

  // Source impedances (positive sequence max/min and the source part of 2*Z1 + Z0 for earth faults).
  const kind = attr(source, "kind");
  let sourceZMax: C | null = null;
  let sourceZMin: C | null = null;
  let sourceLoop: C | null = null;
  const tn = earthing === "TN-S" || earthing === "TN-C" || earthing === "TN-C-S";
  const scProblem: string[] = [];
  let minProblem: string | undefined;
  let earthProblem: string | undefined;
  if (kind === "transformer") {
    const sr = prop(source, "apparentPower", "apparent-power");
    const uk = prop(source, "impedanceVoltage", "ratio");
    const pk = prop(source, "loadLosses", "power");
    const skMax = prop(source, "networkShortCircuitPower", "apparent-power");
    const skMin = prop(source, "networkShortCircuitPowerMin", "apparent-power");
    const rq = prop(source, "networkResistanceReactanceRatio", "ratio");
    if (rq === null) assumptions.push(`Network feeder RQ/XQ = ${DEFAULT_RQ_XQ} (none given).`);
    const network = (cq: number, sk: number) => {
      const z = (cq * un * un) / sk;
      const x = z / Math.sqrt(1 + (rq ?? DEFAULT_RQ_XQ) ** 2);
      return c((rq ?? DEFAULT_RQ_XQ) * x, x);
    };
    if (sr === null || uk === null || pk === null)
      scProblem.push("transformer apparentPower, impedanceVoltage or loadLosses unknown");
    else if (uk <= 0 || uk >= 0.5 || pk < 0 || (pk * un * un) / (sr * sr) >= (uk * un * un) / sr)
      scProblem.push(`transformer impedanceVoltage ${uk * 100} % or loadLosses ${pk} W is not plausible`);
    else {
      const zt = (uk * un * un) / sr;
      const rt = (pk * un * un) / (sr * sr);
      const xt = Math.sqrt(Math.max(zt * zt - rt * rt, 0));
      const kt = (0.95 * cMax) / (1 + (0.6 * xt) / ((un * un) / sr));
      value("transformerCorrectionFactor", source.id, kt, "1");
      const ztk = c(rt * kt, xt * kt);
      if (skMax === null) scProblem.push("networkShortCircuitPower unknown");
      else sourceZMax = add(network(C_Q_MAX, skMax), ztk);
      if (skMin === null) minProblem = "networkShortCircuitPowerMin unknown";
      else {
        sourceZMin = add(network(C_Q_MIN, skMin), ztk);
        const group = attr(source, "vectorGroup") ?? "";
        if (tn && /^Dyn/i.test(group)) {
          sourceLoop = add(scale(sourceZMin, 2), ztk);
          assumptions.push(
            `Zero-sequence impedance of ${label(source)} (${group}) equal to its corrected positive-sequence impedance.`,
          );
        } else
          earthProblem = tn
            ? `vector group ${group || "unknown"} is not Dyn`
            : `earthing ${earthing ?? "unknown"} is not TN`;
      }
    }
  } else if (kind === "supply") {
    const ikMax = prop(source, "shortCircuitCurrent", "current");
    const ikMin = prop(source, "shortCircuitCurrentMin", "current");
    const rx = prop(source, "resistanceReactanceRatio", "ratio");
    const ze = prop(source, "earthFaultLoopImpedance", "resistance");
    const atRatio = (z: number) => {
      const x = z / Math.sqrt(1 + (rx ?? 0) ** 2);
      return c((rx ?? 0) * x, x);
    };
    if (ikMax === null || rx === null)
      scProblem.push("supply shortCircuitCurrent or resistanceReactanceRatio unknown");
    else {
      sourceZMax = atRatio((cMax * un) / (Math.sqrt(3) * ikMax));
      if (ikMin === null) minProblem = "shortCircuitCurrentMin unknown";
      else sourceZMin = atRatio((C_MIN * un) / (Math.sqrt(3) * ikMin));
      if (tn && ze !== null) {
        sourceLoop = scale(atRatio(ze), 3);
        assumptions.push(
          `Earth-fault loop impedance Ze of ${label(source)} split into resistance and reactance with the short-circuit R/X ratio ${rx} (resistanceReactanceRatio); Ze states no ratio of its own.`,
        );
      } else
        earthProblem = tn ? "earthFaultLoopImpedance unknown" : `earthing ${earthing ?? "unknown"} is not TN`;
    }
  } else scProblem.push(`source kind ${kind ?? "unknown"} is not transformer or supply`);
  if (scProblem.length) {
    criterion({
      id: "short-circuit",
      title: "Fault currents",
      subject: source.id,
      verdict: "not-evaluated",
      note: `Not evaluated: ${scProblem.join("; ")}.`,
    });
    messages.push(`Fault currents not evaluated: ${scProblem.join("; ")}.`);
  } else {
    if (minProblem)
      criterion({
        id: "short-circuit-minimum",
        title: "Minimum fault currents",
        subject: source.id,
        verdict: "unknown",
        note: `Unknown: ${minProblem}.`,
      });
    if (minProblem && !earthProblem) earthProblem = minProblem;
    if (earthProblem)
      criterion({
        id: "earth-fault",
        title: "Line-to-earth fault currents",
        subject: source.id,
        verdict: "not-evaluated",
        note: `Not evaluated: ${earthProblem}.`,
      });
  }
  const ik3 = (cf: number, z: C | null) => (z === null ? null : (cf * un) / (Math.sqrt(3) * abs(z)));
  const peak = (z: C | null, ik: Num) =>
    z === null || ik === null || z.im <= 0
      ? null
      : (1.02 + 0.98 * Math.exp((-3 * z.re) / z.im)) * Math.SQRT2 * ik;

  // Top-down cables, voltage drop and fault impedances.
  const nodeZMax = new Map<string, C | null>([[source.id, sourceZMax]]);
  const nodeZMin = new Map<string, C | null>([[source.id, sourceZMin]]);
  const nodeLoop = new Map<string, C | null>([[source.id, sourceLoop]]);
  const nodeDrop = new Map<string, Num[]>([[source.id, scenarios.map(() => 0)]]);
  const tSeconds = request.faultDuration
    ? toBaseUnit(request.faultDuration.value, request.faultDuration.unit)
    : null;
  const lighting = (id: string): boolean => {
    const object = objects.get(id);
    if (object && isLoad(object)) return attr(object, "category") === "lighting";
    return kids(id).some((child) => lighting(child.id));
  };
  const alphaOp = ALPHA_OPERATION[table.cable.material];
  const tempOp = 1 + alphaOp * (table.cable.maxConductorTemperature - 20);
  const tempSc = 1 + ALPHA_SHORT_CIRCUIT * (table.cable.shortCircuitTemperature - 20);
  const conductor = (section: number) => table.conductors.find((entry) => entry.crossSection === section);
  const reactance = (section: number): Num =>
    conductor(section)?.reactance ?? request.assumedReactance ?? null;
  if (request.assumedReactance !== undefined && table.conductors.some((entry) => entry.reactance === null))
    assumptions.push(
      `Conductor reactance ${request.assumedReactance} Ω/km where the cable table gives none.`,
    );

  for (const object of order) {
    const up = parent.get(object.id) ?? source.id;
    if (object.type !== "circuit") {
      nodeZMax.set(object.id, nodeZMax.get(up) ?? null);
      nodeZMin.set(object.id, nodeZMin.get(up) ?? null);
      nodeLoop.set(object.id, nodeLoop.get(up) ?? null);
      nodeDrop.set(object.id, nodeDrop.get(up) ?? scenarios.map(() => null));
      if (object.type === "board" || object.type === "busbar") {
        const ik = ik3(cMax, nodeZMax.get(object.id) ?? null);
        value("ik3Max", object.id, ik && ik / 1000, "kA");
        const ip = peak(nodeZMax.get(object.id) ?? null, ik);
        value("peakCurrent", object.id, ip && ip / 1000, "kA");
        // The weak end of the fault level, for checks that get worse with a weaker network (bank resonance).
        const ikMin = ik3(C_MIN, nodeZMin.get(object.id) ?? null);
        value("ik3Min", object.id, ikMin && ikMin / 1000, "kA");
      }
      continue;
    }
    const circuit = object;
    const unknownDownstream = () => {
      nodeZMax.set(circuit.id, null);
      nodeZMin.set(circuit.id, null);
      nodeLoop.set(circuit.id, null);
      nodeDrop.set(
        circuit.id,
        scenarios.map(() => null),
      );
    };
    const cableRelations = routes.get(circuit.id) ?? [];
    for (const relation of protects.get(circuit.id) ?? []) {
      touch(relation);
      const protection = objects.get(relation.from);
      if (protection) touch(protection);
    }
    const phasesValue = prop(circuit, "phases", "ratio");
    const childList = kids(circuit.id);
    const derived = childList.some(
      (child) => child.type === "board" || child.type === "busbar" || loadBase.get(child.id)?.phases === 3,
    )
      ? 3
      : childList.length && childList.every((child) => loadBase.get(child.id)?.phases === 1)
        ? 1
        : null;
    const phases = phasesValue === 1 || phasesValue === 3 ? phasesValue : derived;
    if (!childList.length) messages.push(`${label(circuit)} feeds nothing: its design current is unknown.`);
    const flows = scenarios.map((_, s) => (childList.length ? (design[s]?.get(circuit.id) ?? null) : null));
    const ib = flows.map((flow) =>
      flow === null ? null : phases === 1 ? Math.hypot(flow.p, flow.q) / u0 : maxPhase(flow),
    );
    const cosPhi = flows.map((flow) =>
      flow === null || Math.hypot(flow.p, flow.q) === 0 ? null : flow.p / Math.hypot(flow.p, flow.q),
    );
    scenarios.forEach((scenario, s) => {
      value(`designCurrent:${scenario.id}`, circuit.id, ib[s] ?? null, "A");
    });
    const governingScenario = ib.every((x) => x !== null) ? ib.indexOf(Math.max(...(ib as number[]))) : -1;
    const ibMax = governingScenario >= 0 ? (ib[governingScenario] as number) : null;
    value("designCurrent", circuit.id, ibMax, "A");
    const rated = (protects.get(circuit.id) ?? [])
      .map((relation) => prop(objects.get(relation.from), "ratedCurrent", "current"))
      .filter((x): x is number => x !== null);
    const inRated = rated.length ? Math.max(...rated) : null;

    const notEvaluated = (reason: string) => {
      for (const [id, title] of [
        ["current-capacity", "Current-carrying capacity"],
        ["voltage-drop", "Voltage drop"],
        ["cable-section", "Cable cross-section"],
      ] as const)
        criterion({ id, title, subject: circuit.id, verdict: "not-evaluated", note: reason });
      messages.push(`${label(circuit)}: ${reason}`);
      unknownDownstream();
    };
    if (cableRelations.length !== 1) {
      notEvaluated(
        cableRelations.length ? "parallel cables are not evaluated." : "no cable routes this circuit.",
      );
      continue;
    }
    const routed = cableRelations[0] as ElectricalRelation;
    touch(routed);
    const cable = objects.get(routed.from) as ElectricalObject;
    touch(cable);
    for (const relation of protects.get(cable.id) ?? []) {
      touch(relation);
      const protection = objects.get(relation.from);
      if (protection) touch(protection);
    }
    const length = prop(cable, "length", "length");
    const given = prop(cable, "crossSection", "area");
    const method = attr(cable, "installationMethod");
    const ambient = prop(cable, "ambientTemperature", "temperature");
    const grouped = prop(cable, "groupedCircuits", "ratio");
    const loaded: 2 | 3 = phases === 1 ? 2 : 3;
    const missing: string[] = [];
    if (phases === null) missing.push("phases");
    if (length === null) missing.push("length");
    if (!method) missing.push("installationMethod");
    else if (!table.methods.some((entry) => entry.id === method))
      missing.push(`method ${method} (not in table ${table.id})`);
    if (ambient === null) missing.push("ambientTemperature");
    if (grouped === null) missing.push("groupedCircuits");
    const methodEntry = table.methods.find((entry) => entry.id === method);
    const kTheta = method && ambient !== null ? temperatureFactor(table, method, ambient) : undefined;
    const kGroup = method && grouped !== null ? groupingFactor(table, method, Math.ceil(grouped)) : undefined;
    if (method && ambient !== null && kTheta === undefined)
      missing.push(`temperature factor for ${ambient} °C`);
    if (method && grouped !== null && kGroup === undefined)
      missing.push(`grouping factor for ${grouped} circuits`);
    value("temperatureFactor", cable.id, kTheta ?? null, "1");
    value("groupingFactor", cable.id, kGroup ?? null, "1");

    const upstream = nodeDrop.get(up) ?? scenarios.map(() => null);
    const limit =
      lighting(circuit.id) && request.voltageDropLimitLighting
        ? request.voltageDropLimitLighting.value
        : request.voltageDropLimit.value;
    const localDrop = (section: number, s: number): Num => {
      const x = reactance(section);
      const data = conductor(section);
      const current = ib[s] ?? null;
      const cos = cosPhi[s] ?? null;
      if (!data || x === null || current === null || length === null || phases === null) return null;
      if (current === 0) return 0;
      if (cos === null) return null;
      const sin = Math.sqrt(Math.max(1 - cos * cos, 0));
      const km = length / 1000;
      const drop = current * km * (data.resistance20 * tempOp * cos + x * sin);
      return phases === 3 ? (Math.sqrt(3) * drop * 100) / un : (2 * drop * 100) / u0;
    };
    const drops = (section: number) =>
      scenarios.map((_, s) => {
        const local = localDrop(section, s);
        const before = upstream[s];
        return local === null || before === null || before === undefined ? null : before + local;
      });
    const capacity = (section: number): Num => {
      const rating = tableRating(table, method ?? "", section, loaded);
      return rating === undefined || kTheta === undefined || kGroup === undefined
        ? null
        : rating * kTheta * kGroup;
    };
    const need = ibMax === null ? null : Math.max(ibMax, inRated ?? 0);
    const ikStart = ik3(cMax, nodeZMax.get(up) ?? null);
    const thermalMin =
      tSeconds !== null && table.cable.k !== null && ikStart !== null
        ? (ikStart * Math.sqrt(tSeconds)) / table.cable.k
        : null;
    value("thermalMinimumSection", cable.id, thermalMin, "mm²");
    const sections = table.conductors.map((entry) => entry.crossSection);
    const capOk = (section: number) => {
      const iz = capacity(section);
      return iz === null || need === null ? null : iz >= need;
    };
    const vdOk = (section: number) => {
      const list = drops(section);
      return list.some((x) => x === null) ? null : (list as number[]).every((x) => x <= limit + 1e-9);
    };
    const thOk = (section: number) => (thermalMin === null ? true : section >= thermalMin - 1e-9);
    const first = (ok: (section: number) => boolean | null) =>
      sections.find((section) => ok(section) === true);

    let section: Num = given;
    let sectionNote: string;
    let sectionVerdict: "pass" | "fail" | "unknown" = "pass";
    const unknownParts = () =>
      [
        sections.some((candidate) => capOk(candidate) === null) &&
          `current capacity (no rating for ${loaded} loaded conductors at some cross-sections)`,
        sections.some((candidate) => vdOk(candidate) === null) &&
          "voltage drop (reactance, upstream drop or power factor unknown)",
      ]
        .filter(Boolean)
        .join(" and ");
    const sMins = {
      "current-capacity": missing.length || need === null ? undefined : first(capOk),
      "voltage-drop": first(vdOk),
      "short-circuit-withstand": thermalMin === null ? undefined : first(thOk),
    };
    const governing = (Object.entries(sMins) as [string, number | undefined][])
      .filter(([, s]) => s !== undefined)
      .sort((a, b) => (b[1] as number) - (a[1] as number))[0]?.[0];
    const scenarioText = governingScenario >= 0 ? (scenarios[governingScenario]?.id ?? "unknown") : "unknown";
    if (given === null) {
      if (missing.length || need === null) {
        section = null;
        sectionVerdict = "unknown";
        sectionNote = `No cross-section proposed: ${missing.length ? `${missing.join(", ")} unknown or not covered` : "design current unknown"}.`;
      } else {
        const fit = sections.find((s) => capOk(s) === true && vdOk(s) === true && thOk(s));
        section = fit ?? null;
        const unknown = fit === undefined ? unknownParts() : "";
        sectionVerdict = fit !== undefined ? "pass" : unknown ? "unknown" : "fail";
        sectionNote =
          fit !== undefined
            ? `Proposed ${fit} mm², governing ${governing ?? "current-capacity"}, scenario ${scenarioText}.`
            : unknown
              ? `No cross-section proposed: ${unknown} unknown for some table cross-sections.`
              : `No table cross-section meets every criterion (largest ${sections[sections.length - 1]} mm²).`;
      }
    } else if (!conductor(given)) {
      section = null;
      sectionVerdict = "unknown";
      sectionNote = `The given ${given} mm² is not in table ${table.id}.`;
    } else if (missing.length || capOk(given) === null || vdOk(given) === null) {
      sectionVerdict = "unknown";
      sectionNote = `Checked ${given} mm², not established: ${missing.length ? `${missing.join(", ")} unknown or not covered` : "current capacity or voltage drop unknown"}.`;
    } else
      sectionNote = `Checked ${given} mm², governing ${governing ?? "unknown"}, scenario ${scenarioText}.`;

    value("crossSection", cable.id, section, "mm²");
    const tableCurrent =
      section === null || !method ? undefined : tableRating(table, method, section, loaded);
    value("tableCurrent", cable.id, tableCurrent ?? null, "A");
    const iz = section === null || missing.length ? null : capacity(section);
    value("currentCapacity", cable.id, iz, "A");
    criterion({
      id: "cable-section",
      title: "Cable cross-section",
      subject: circuit.id,
      verdict: sectionVerdict,
      note: sectionNote.slice(0, 1000),
    });
    criterion({
      id: "current-capacity",
      title: "Current-carrying capacity",
      subject: circuit.id,
      verdict: iz === null || need === null ? "unknown" : iz >= need ? "pass" : "fail",
      measured: { value: iz === null ? null : sig(iz), unit: "A" },
      limit: { value: need === null ? null : sig(need), unit: "A" },
      note: (missing.length
        ? `Unknown or not covered: ${missing.join(", ")}.`
        : `Table ${table.id}: method ${method} (${methodEntry?.title ?? ""}, reference ${methodEntry?.referenceTemperature} °C), ${loaded} loaded conductors; ambient ${ambient} °C -> k_theta ${kTheta}; ${grouped} grouped circuits -> k_group ${kGroup}; required max(Ib${inRated !== null ? `, In ${inRated} A` : ""}).`
      ).slice(0, 1000),
    });
    const dropList = section === null ? scenarios.map(() => null) : drops(section);
    scenarios.forEach((scenario, s) => {
      value(`voltageDrop:${scenario.id}`, circuit.id, dropList[s] ?? null, "%");
    });
    const worst = dropList.some((x) => x === null) ? null : Math.max(...(dropList as number[]));
    criterion({
      id: "voltage-drop",
      title: "Voltage drop from the origin",
      subject: circuit.id,
      verdict: worst === null ? "unknown" : worst <= limit + 1e-9 ? "pass" : "fail",
      measured: { value: worst === null ? null : sig(worst), unit: "%" },
      limit: { value: limit, unit: "%" },
      note: `${phases === 1 ? "Single-phase loop 2 I L (R cos phi + X sin phi) / U0" : "Three-phase sqrt(3) I L (R cos phi + X sin phi) / Un"}, R at ${table.cable.maxConductorTemperature} °C.`,
    });
    criterion({
      id: "short-circuit-withstand",
      title: "Short-circuit thermal withstand",
      subject: circuit.id,
      verdict:
        thermalMin === null
          ? "not-evaluated"
          : section === null
            ? "unknown"
            : section >= thermalMin - 1e-9
              ? "pass"
              : "fail",
      ...(thermalMin === null
        ? {}
        : { measured: { value: section, unit: "mm²" }, limit: { value: sig(thermalMin), unit: "mm²" } }),
      note:
        thermalMin === null
          ? `Not evaluated: ${tSeconds === null ? "no faultDuration given" : table.cable.k === null ? `table ${table.id} gives no k` : "maximum fault current unknown"}.`
          : `S >= Ik3max x sqrt(t) / k with k ${table.cable.k}, t ${tSeconds} s.`,
    });

    // Impedances of this circuit's cable.
    if (section === null || length === null || reactance(section) === null || !conductor(section)) {
      unknownDownstream();
    } else {
      const km = length / 1000;
      const r20 = (conductor(section) as { resistance20: number }).resistance20 * km;
      const x = (reactance(section) as number) * km;
      const peSection = prop(cable, "protectiveConductorCrossSection", "area") ?? section;
      if (prop(cable, "protectiveConductorCrossSection", "area") === null)
        assumptions.push(
          `Protective conductor of ${label(cable)} equal to its phase conductor (${section} mm²).`,
        );
      const pe = conductor(peSection);
      const zMaxHere = add(nodeZMax.get(up) ?? c(Number.NaN), c(r20, x));
      const zMinCable = c(r20 * tempSc, x);
      const zMinHere = add(nodeZMin.get(up) ?? c(Number.NaN), zMinCable);
      nodeZMax.set(circuit.id, nodeZMax.get(up) ? zMaxHere : null);
      nodeZMin.set(circuit.id, nodeZMin.get(up) ? zMinHere : null);
      const loopUp = nodeLoop.get(up) ?? null;
      const loopHere =
        loopUp && pe
          ? add(loopUp, add(scale(zMinCable, 3), scale(c(pe.resistance20 * km * tempSc, x), 3)))
          : null;
      nodeLoop.set(circuit.id, loopHere);
      nodeDrop.set(circuit.id, dropList);
    }
    const zStart = nodeZMax.get(up) ?? null;
    value("ik3MaxStart", circuit.id, ikStart && ikStart / 1000, "kA");
    const ipStart = peak(zStart, ikStart);
    value("peakCurrentStart", circuit.id, ipStart && ipStart / 1000, "kA");
    const ikMinEnd = ik3(C_MIN, nodeZMin.get(circuit.id) ?? null);
    value("ik3MinEnd", circuit.id, ikMinEnd && ikMinEnd / 1000, "kA");
    const loop = nodeLoop.get(circuit.id) ?? null;
    const ik1 = loop === null ? null : (Math.sqrt(3) * C_MIN * un) / abs(loop);
    value("ik1MinEnd", circuit.id, ik1 && ik1 / 1000, "kA");
  }
  return finish("completed");
}
