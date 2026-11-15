// The motor drives engine "vera-motor-drives-1" (spec REQ-DATA-79118f9a "Method"): per motor of the model it compares
// direct-on-line, reversing, star-delta, softstarter and variable-speed drive against the process function and the
// stated limits, proposes the simplest feasible method, sizes that method's assembly from one industrial catalog and
// returns a logical connection and interlock scheme. Pure: it reads the model, a CURRENT protection-coordination result,
// its network result and the catalog, and returns one format-1 electrical result; it never configures a device.
import {
  type CatalogItem,
  type ElectricalAssembly,
  type ElectricalModel,
  type ElectricalObject,
  type ElectricalResult,
  electricalLimits,
  type IndustrialCatalog,
} from "@vera/shared";
import { z } from "zod";
import { type CatalogCriterion, type CatalogStamp, findItems, selectItems } from "./catalog.js";
import { toBaseUnit, unitDimension } from "./units.js";

export const MOTOR_DRIVES_ENGINE = { name: "vera-motor-drives", version: "1.0.0" } as const;
export const MOTOR_DRIVES_METHOD = {
  id: "vera-motor-drives-1",
  title:
    "Motor starting and drives: method comparison, acceleration model, starter assembly and connection scheme",
} as const;
export const startingMethods = ["dol", "reversing", "star-delta", "softstarter", "vfd"] as const;
export type StartingMethod = (typeof startingMethods)[number];

// The request is a tool schema, so it stays compact: numbers carry fixed units (A, s, °C, m, ratios) and bounds are
// refinements; IDs are checked against the model and the catalog.
const id = z.string();
const range = (low: number, high: number, name: string, closedLow = false) =>
  z
    .number()
    .refine(
      (value) => (closedLow ? value >= low : value > low) && value <= high,
      `${name} must be ${closedLow ? ">=" : ">"} ${low} and <= ${high}`,
    );
export const motorDrivesRequestSchema = z.strictObject({
  protection: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  catalog: id,
  /** °C in the panel. */
  ambientTemperature: range(-50, 100, "ambientTemperature (°C)").optional(),
  /** m above sea level. */
  altitude: range(0, 6000, "altitude (m)", true).optional(),
  motors: z
    .array(
      z.strictObject({
        motor: id,
        reversing: z.boolean().optional(),
        speedControl: z.boolean().optional(),
        inching: z.boolean().optional(),
        startingCurrentMax: range(0, 1e6, "startingCurrentMax (A)").optional(),
        accelerationTimeMax: range(0, 600, "accelerationTimeMax (s)").optional(),
        stopTimeMax: range(0, 600, "stopTimeMax (s)").optional(),
        switchover: z
          .number()
          .refine((value) => value > 0 && value < 1, "switchover must be > 0 and < 1")
          .optional(),
        currentLimit: range(1, 10, "currentLimit (x In)").optional(),
        protection: id.optional(),
        contactor: id.optional(),
        starContactor: id.optional(),
        overloadRelay: id.optional(),
        softstarter: id.optional(),
        drive: id.optional(),
      }),
    )
    .refine((entries) => entries.length >= 1 && entries.length <= 4, "name 1..4 motors")
    .refine(
      (entries) => new Set(entries.map((entry) => entry.motor)).size === entries.length,
      "motors must be unique",
    ),
});
export type MotorDrivesRequest = z.infer<typeof motorDrivesRequestSchema>;

export interface MotorDrivesInput {
  model: ElectricalModel;
  modelPath: string;
  modelSha256: string;
  /** The stored protection-coordination result and the network result it names; the caller checked both are current. */
  protection: ElectricalResult;
  network: ElectricalResult;
  catalog: IndustrialCatalog;
  catalogStamp: CatalogStamp;
  request: MotorDrivesRequest;
  runId: string;
  now: string;
}

type Num = number | null;
type Criterion = ElectricalResult["criteria"][number];
type Verdict = Criterion["verdict"];
type Conditions = Record<string, { value: number; unit: string } | { text: string }>;
const EPSILON = 1e-9;
const BIG = 1e15;
const STEPS = 2000;
/** The acceleration ends at this share of the steady speed where motor and load torque meet. */
const END_SHARE = 0.98;
const KELVIN = 273.15;
const sig = (value: number) => Number(value.toPrecision(6));
const fold = (text: string) => text.trim().toLowerCase();
const label = (object: ElectricalObject) => (object.ref ? `${object.ref} (${object.id})` : object.id);
const atLeast = (value: number, limit: number) => value >= limit - EPSILON * Math.max(1, Math.abs(limit));
const base = (entry: { value: number; unit: string }) => toBaseUnit(entry.value, entry.unit);
/** A cited parameter (value checked non-null by `cited`) in its base unit. */
const num = (entry: { value: number | null; unit: string }) => toBaseUnit(entry.value as number, entry.unit);
const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
const METHOD_TITLES: Record<StartingMethod, string> = {
  dol: "direct-on-line",
  reversing: "reversing direct-on-line",
  "star-delta": "star-delta",
  softstarter: "softstarter",
  vfd: "variable-speed drive",
};

// ---- the torque and acceleration model (exported for the hand-calculation tests) ---------------------------------
export interface MotorCurve {
  /** Synchronous and rated speed, rpm. */
  ns: number;
  nN: number;
  /** Rated, starting, pull-up (null when not stated) and breakdown torque, Nm. */
  tn: number;
  tst: number;
  tu: number | null;
  tk: number;
}
/** Breakdown slip of the Kloss curve through the rated point. */
export function breakdownSpeed(curve: MotorCurve): number {
  const sN = (curve.ns - curve.nN) / curve.ns;
  const k = curve.tk / curve.tn;
  const sk = sN * (k + Math.sqrt(Math.max(k * k - 1, 0)));
  return curve.ns * (1 - sk);
}
/** Motor torque at speed n (rpm): Kloss above breakdown speed, the lower of Tu and Tst below it. */
export function motorTorque(curve: MotorCurve, n: number): number {
  const nk = breakdownSpeed(curve);
  if (n < nk) return Math.min(curve.tu ?? curve.tst, curve.tst);
  const s = (curve.ns - n) / curve.ns;
  if (s <= 0) return 0;
  const sk = (curve.ns - nk) / curve.ns;
  return (2 * curve.tk) / (s / sk + sk / s);
}
/** Time from `from` to `to` rpm with total inertia j (kg·m²) and accelerating torque a(n) (Nm); stall = the first
 * speed where a(n) <= 0. Midpoint rule over `steps` intervals. */
export function accelerationTime(
  j: number,
  from: number,
  to: number,
  accelerating: (n: number) => number,
  steps = STEPS,
): { time: number | null; stall: number | null } {
  if (to <= from) return { time: 0, stall: null };
  const h = (to - from) / steps;
  let sum = 0;
  for (let i = 0; i < steps; i++) {
    const n = from + (i + 0.5) * h;
    const a = accelerating(n);
    if (!(a > 0)) return { time: null, stall: n };
    sum += h / a;
  }
  return { time: ((j * 2 * Math.PI) / 60) * sum, stall: null };
}
/** The steady speed on the stable branch where a(n) falls to zero (bisection between nk and ns); null on a stall. */
function steadySpeed(nk: number, ns: number, accelerating: (n: number) => number): Num {
  let low = Math.max(nk, 0);
  let high = ns;
  if (!(accelerating(low) > 0)) return null;
  for (let i = 0; i < 100; i++) {
    const mid = (low + high) / 2;
    if (accelerating(mid) > 0) low = mid;
    else high = mid;
  }
  return low;
}

export function analyzeMotorDrives(input: MotorDrivesInput): ElectricalResult {
  const { model, protection, network, catalog, catalogStamp: stamp, request } = input;
  const objects = new Map(model.objects.map((object) => [object.id, object]));
  const items = new Map(catalog.items.map((item) => [item.id, item]));
  const families = new Map(catalog.families.map((family) => [family.id, family]));
  const category = (item: CatalogItem) => families.get(item.family)?.category ?? "";

  // ---- request checks (thrown before anything is evaluated) ----------------------------------------------------
  const fail = (message: string): never => {
    throw Error(message);
  };
  const itemOf = (key: string) => items.get(key) ?? fail(`${key} is not an item of catalog ${catalog.id}`);
  const feeds = model.relations.filter((relation) => relation.type === "feeds");
  const circuitOf = new Map<string, { circuit: ElectricalObject; relation: (typeof feeds)[number] }>();
  for (const entry of request.motors) {
    const motor = objects.get(entry.motor);
    if (motor?.type !== "motor") fail(`${entry.motor} is not a motor of the model`);
    const fed = feeds.filter((relation) => relation.to === entry.motor);
    const circuit = fed.length === 1 ? objects.get(fed[0]?.from ?? "") : undefined;
    if (circuit?.type !== "circuit" || !fed[0]) fail(`${entry.motor} is not fed by exactly one circuit`);
    circuitOf.set(entry.motor, {
      circuit: circuit as ElectricalObject,
      relation: fed[0] as (typeof feeds)[number],
    });
    for (const key of [
      "protection",
      "contactor",
      "starContactor",
      "overloadRelay",
      "softstarter",
      "drive",
    ] as const) {
      const value = entry[key];
      if (value !== undefined) itemOf(value);
    }
  }

  // ---- inputs, conditions and the result frame ------------------------------------------------------------------
  const read = new Map<string, unknown>();
  for (const entry of protection.inputs) read.set(entry.id, entry.snapshot);
  const touch = (entity: { id: string } | undefined) => {
    if (entity && !read.has(entity.id)) read.set(entity.id, entity);
  };
  touch(model.project);
  const assumptions = [
    "Motor torque: Kloss curve through the rated point from breakdown speed to synchronous speed; below breakdown speed the pull-up torque Tu (the smallest torque there) or, when Tu is not stated, the starting torque Tst.",
    `Acceleration: t = (J + JL) 2 pi / 60 x integral of dn / (Tm - Tl) by the midpoint rule over ${STEPS} steps, from standstill to ${END_SHARE * 100} % of the steady speed (VFD: to rated speed).`,
    "Star-delta: Tm/3 and Ist/3 in star up to the stated switch-over speed, then Tm; the switch-over transient is not modelled.",
    "Softstarter: torque Tm x (current limit / DOL current)², the DOL current being Ist below breakdown speed and falling linearly to In at rated speed.",
    "VFD: constant torque min(drive transient current / In, Tk/Tn) x Tn up to rated speed (a current of k x In with k >= 1 gives at least k x Tn at rated flux); line current = the drive's cited maximum input current.",
    "Drive current needed = max(1, (largest load torque + J x rated angular speed / accelerationTimeMax) / Tn) x In.",
    "Contactor currents: In (DOL, reversing; AC-3, AC-4 with inching), In/sqrt(3) line and delta and In/3 star (AC-3), In for an external softstarter bypass (AC-1, it switches after the ramp at rated current).",
  ];
  const limits = [
    "Starting and drive methods are compared on the stated data only; the switch-over transient of star-delta, voltage dips during the start, harmonics and motor heating over a duty cycle are not evaluated.",
    "No drive, softstarter or relay is configured or parameterised; settings in the result are the values checked.",
    "Product codes and the connection scheme are a preliminary assembly; no safety function (for example STO or emergency stop) is claimed or validated by choosing a product.",
    "Protective-device verdicts are copied from the protection result; they are not recomputed here.",
    "A later change of the catalog file does not mark this result stale; its version and sha256 are in the conditions.",
    "Preliminary engineering support: no verified design, no conformity statement and no safety certification.",
  ];
  const messages: string[] = [];
  const intermediate: ElectricalResult["intermediate"] = [];
  const criteria: Criterion[] = [];
  const assemblies: ElectricalAssembly[] = [];
  const sources = new Set<string>([
    `protection-coordination result ${protection.runId} (${protection.method.id})`,
    `electrical-network result ${network.runId} (${network.method.id})`,
    `${catalog.title}, version ${catalog.version}`.slice(0, 200),
  ]);
  const conditions: ElectricalResult["conditions"] = {
    protectionRun: { text: protection.runId },
    networkRun: { text: network.runId },
    catalog: { text: `${stamp.id} ${stamp.version} sha256 ${stamp.sha256.slice(0, 16)}`.slice(0, 200) },
  };
  if (request.ambientTemperature !== undefined)
    conditions.ambientTemperature = { value: request.ambientTemperature, unit: "°C" };
  if (request.altitude !== undefined) conditions.altitude = { value: request.altitude, unit: "m" };
  const value = (name: string, subject: string, amount: Num, unit: string) =>
    intermediate.push({
      name,
      subject,
      value: amount === null || !Number.isFinite(amount) ? null : sig(amount),
      unit,
    });
  const add = (entry: Criterion) => {
    criteria.push({ ...entry, ...(entry.note ? { note: entry.note.slice(0, 1000) } : {}) });
    return entry.verdict;
  };
  const cite = (criterion: CatalogCriterion) => {
    const source = criterion.evidence?.source;
    if (!source) return "";
    const where = source.table ?? source.page;
    sources.add(
      `${source.publisher ?? ""}: ${source.title}, ${source.revision ?? ""}${source.uri ? `, ${source.uri}` : ""}`.slice(
        0,
        200,
      ),
    );
    return ` Source: ${source.title}${where ? `, ${where}` : ""}.`;
  };

  // ---- catalog look-ups through the PWR-01 selection rules ---------------------------------------------------------
  const one = (item: CatalogItem, requirement: Parameters<typeof selectItems>[2]["requirements"][number]) =>
    selectItems({ ...catalog, items: [item] }, stamp, { requirements: [requirement] }).items[0]
      ?.criteria[0] as CatalogCriterion;
  /** The most conservative cited value covering the conditions: the smallest (`low`) or the largest (`high`). */
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
    return { criterion, value: measured ? base(measured) : null, measured };
  };
  const why = (criterion: CatalogCriterion, name: string) =>
    criterion.reason === "absent"
      ? `no cited ${name}`
      : criterion.reason === "conditions"
        ? `no cited ${name} covers the requested conditions`
        : `only extracted (unconfirmed) ${name}`;
  /** Cited parameters of one item by name (confirmed, with value). */
  const cited = (item: CatalogItem, name: string) =>
    (findItems({ ...catalog, items: [item] }, {})[0]?.parameters ?? []).filter(
      (parameter) => parameter.name === name && parameter.status === "confirmed" && parameter.value !== null,
    );
  const boundOf = (parameter: { conditions?: Conditions }, key: string): Num => {
    const condition = parameter.conditions?.[key];
    return condition && "unit" in condition ? base(condition) : null;
  };
  const ambientK = request.ambientTemperature === undefined ? null : request.ambientTemperature + KELVIN;
  const altitude = request.altitude ?? null;
  const panel = (): Conditions => ({
    ...(request.ambientTemperature !== undefined
      ? { ambientTemperature: { value: request.ambientTemperature, unit: "°C" } }
      : {}),
    ...(request.altitude !== undefined ? { altitude: { value: request.altitude, unit: "m" } } : {}),
  });
  /** A current rating at the panel conditions, derated by cited per-kelvin / per-100 m factors above their bounds. */
  const derated = (item: CatalogItem, name: string, wanted: Conditions) => {
    const direct = pick(item, name, "A", "low", { ...wanted, ...panel() });
    if (direct.value !== null)
      return { value: direct.value, note: cite(direct.criterion), criterion: direct.criterion };
    const parts: string[] = [];
    const at: Conditions = { ...wanted };
    let factor = 1;
    const derate = (factorName: string, key: string, actual: number, unitScale: number, unitText: string) => {
      const entries = cited(item, factorName).filter((parameter) => {
        const low = boundOf(parameter, `${key}Min`);
        const high = boundOf(parameter, `${key}Max`);
        return low !== null && actual > low && (high === null || actual <= high + EPSILON);
      });
      if (!entries.length) return null;
      const worst = entries.reduce((a, b) => (num(b) > num(a) ? b : a));
      const from = boundOf(worst, `${key}Min`) as number;
      const rate = num(worst);
      factor *= 1 - (rate * (actual - from)) / unitScale;
      parts.push(
        `${sig(rate * 100)} % per ${unitText} above ${sig(key === "ambientTemperature" ? from - KELVIN : from)}`,
      );
      return from;
    };
    if (ambientK !== null) {
      const from = derate("ambientDeratingPerKelvin", "ambientTemperature", ambientK, 1, "K");
      at.ambientTemperature =
        from === null
          ? { value: request.ambientTemperature as number, unit: "°C" }
          : { value: sig(from - KELVIN), unit: "°C" };
    }
    if (altitude !== null) {
      const from = derate("altitudeDeratingPer100m", "altitude", altitude, 100, "100 m");
      at.altitude = { value: from ?? altitude, unit: "m" };
    }
    if (!parts.length) return { value: null, note: "", criterion: direct.criterion };
    const basis = pick(item, name, "A", "low", at);
    if (basis.value === null) return { value: null, note: "", criterion: basis.criterion };
    return {
      value: basis.value * factor,
      note: ` Derated ${parts.join(" and ")} from ${sig(basis.value)} A.${cite(basis.criterion)}`,
      criterion: basis.criterion,
    };
  };

  // ---- network values --------------------------------------------------------------------------------------------
  const nominal = network.conditions.nominalVoltage;
  const un = nominal && "unit" in nominal ? base(nominal) : null;
  if (un === null) messages.push("The network result states no nominal voltage.");
  const prop = (object: ElectricalObject, name: string, dimension: string): Num => {
    const quantity = object.properties?.[name];
    if (!quantity || quantity.value === null || unitDimension(quantity.unit) !== dimension) return null;
    return base({ value: quantity.value, unit: quantity.unit });
  };
  const attr = (object: ElectricalObject, name: string) => {
    const text = object.attributes?.[name];
    return typeof text === "string" ? text : undefined;
  };
  const stored = (result: ElectricalResult, name: string, subject: string) =>
    result.criteria.find((criterion) => criterion.id === name && criterion.subject === subject);

  request.motors.forEach((entry, index) => {
    const motor = objects.get(entry.motor) as ElectricalObject;
    const { circuit, relation } = circuitOf.get(entry.motor) as {
      circuit: ElectricalObject;
      relation: { id: string };
    };
    touch(motor);
    touch(circuit);
    touch(relation as { id: string });
    const routes = model.relations.filter((r) => r.type === "routes" && r.to === circuit.id);
    const cable = routes.length === 1 ? objects.get(routes[0]?.from ?? "") : undefined;
    if (cable && routes[0]) {
      touch(cable);
      touch(routes[0]);
    }
    const subject = motor.id;
    const name = label(motor);

    // Nameplate and load data.
    const power = prop(motor, "ratedPower", "power");
    const inRated = prop(motor, "ratedCurrent", "current");
    const uMotor = prop(motor, "ratedVoltage", "voltage");
    const speed = prop(motor, "speed", "speed");
    const frequency = prop(motor, "frequency", "frequency");
    const kIst = prop(motor, "startingCurrentRatio", "ratio");
    const kTst = prop(motor, "startingTorqueRatio", "ratio");
    const kTu = prop(motor, "pullUpTorqueRatio", "ratio");
    const kTk = prop(motor, "breakdownTorqueRatio", "ratio");
    const jMotor = prop(motor, "inertia", "inertia");
    const jLoad = prop(motor, "loadInertia", "inertia");
    const tLoad = prop(motor, "loadTorque", "torque");
    const tBreak = prop(motor, "breakawayTorque", "torque");
    const lockedTime = prop(motor, "lockedRotorTime", "time");
    const starts = prop(motor, "startsPerHour", "rate");
    const startsMax = prop(motor, "startsPerHourMax", "rate");
    const terminals = prop(motor, "terminals", "ratio");
    const connection = attr(motor, "connection");
    const characteristic = attr(motor, "loadCharacteristic");
    const exponent =
      characteristic === undefined
        ? null
        : (({ constant: 0, linear: 1, quadratic: 2 } as Record<string, number>)[fold(characteristic)] ??
          null);
    const dutyType = attr(motor, "duty");
    if (dutyType)
      messages.push(
        `${name}: duty ${dutyType} is reported only; heating over the duty cycle is not evaluated.`,
      );
    const missing: string[] = [];
    const need = (amount: Num, what: string) => {
      if (amount === null) missing.push(what);
      return amount;
    };
    need(inRated, "ratedCurrent");
    need(speed, "speed");
    need(frequency, "frequency");
    need(power, "ratedPower");
    need(kTst, "startingTorqueRatio");
    need(kTk, "breakdownTorqueRatio");
    need(jMotor, "inertia");
    need(jLoad, "loadInertia");
    need(tLoad, "loadTorque");
    if (exponent === null) missing.push("loadCharacteristic (constant, linear or quadratic)");
    else if (exponent > 0) need(tBreak, "breakawayTorque");
    const poles =
      speed !== null && frequency !== null && speed > 0 ? 2 * Math.floor((60 * frequency) / speed) : null;
    const ns =
      poles !== null && poles > 0 && frequency !== null ? (120 * (frequency as number)) / poles : null;
    const tn = power !== null && speed !== null && speed > 0 ? power / ((2 * Math.PI * speed) / 60) : null;
    const curve: MotorCurve | null =
      ns !== null && tn !== null && speed !== null && kTst !== null && kTk !== null && speed < ns && kTk > 1
        ? { ns, nN: speed, tn, tst: kTst * tn, tu: kTu === null ? null : kTu * tn, tk: kTk * tn }
        : null;
    const j = jMotor !== null && jLoad !== null ? jMotor + jLoad : null;
    const load =
      tLoad !== null && exponent !== null && speed !== null && (exponent === 0 || tBreak !== null)
        ? (n: number) =>
            exponent === 0
              ? (tLoad as number)
              : (tBreak as number) +
                ((tLoad as number) - (tBreak as number)) * Math.max(n / (speed as number), 0) ** exponent
        : null;
    value("ratedTorque", subject, tn, "Nm");
    value("synchronousSpeed", subject, ns, "rpm");
    value("totalInertia", subject, j, "kg·m²");
    if (missing.length)
      messages.push(`${name}: ${missing.join(", ")} not stated; the dependent values are unknown.`);
    if (curve && kTu === null)
      messages.push(
        `${name}: no pull-up torque stated; the starting torque stands in below breakdown speed.`,
      );
    const nk = curve ? breakdownSpeed(curve) : null;
    const tm = (n: number) => (curve ? motorTorque(curve, n) : 0);

    // Drive selection comes first: the VFD method uses the selected duty class's transient current.
    const driveItem = entry.drive ? items.get(entry.drive) : undefined;
    const omega = speed === null ? null : (2 * Math.PI * speed) / 60;
    const loadMax = load && speed !== null ? Math.max(load(0), load(speed)) : null;
    const needRatio =
      loadMax === null || tn === null
        ? null
        : Math.max(
            1,
            (loadMax +
              (entry.accelerationTimeMax !== undefined && j !== null && omega !== null
                ? (j * omega) / entry.accelerationTimeMax
                : 0)) /
              tn,
          );
    const driveNeed = needRatio === null || inRated === null ? null : needRatio * inRated;
    interface DutyClass {
      duty: string;
      continuous: Num;
      transient: Num;
      time: Num;
      note: string;
      verdict: Verdict;
    }
    const duties: DutyClass[] = [];
    if (driveItem && category(driveItem) === "variable-speed-drive") {
      const names = [
        ...new Set(
          cited(driveItem, "ratedCurrent").flatMap((parameter) => {
            const duty = parameter.conditions?.dutyClass;
            return duty && "text" in duty ? [duty.text] : [];
          }),
        ),
      ];
      for (const duty of names) {
        const continuous = derated(driveItem, "ratedCurrent", { dutyClass: { text: duty } });
        const transientEntries = cited(driveItem, "overloadCurrent").filter((parameter) => {
          const d = parameter.conditions?.dutyClass;
          return d && "text" in d && fold(d.text) === fold(duty);
        });
        const smallest = transientEntries.length
          ? transientEntries.reduce((a, b) => (num(b) < num(a) ? b : a))
          : undefined;
        const transient = smallest ? num(smallest) : null;
        const time = smallest ? boundOf(smallest, "overloadTime") : null;
        let verdict: Verdict = "unknown";
        const notes: string[] = [];
        if (continuous.value === null)
          notes.push(`no cited continuous current for duty ${duty} at the panel conditions`);
        if (transient === null) notes.push(`no cited transient current for duty ${duty}`);
        if (continuous.value !== null && transient !== null && inRated !== null && driveNeed !== null) {
          verdict = atLeast(continuous.value, inRated) && atLeast(transient, driveNeed) ? "pass" : "fail";
          notes.push(
            `duty ${duty}: continuous ${sig(continuous.value)} A against In ${sig(inRated)} A, transient ${sig(transient)} A${time === null ? "" : ` for ${sig(time)} s`} against ${sig(driveNeed)} A needed.${continuous.note}`,
          );
        } else if (driveNeed === null)
          notes.push("the needed current is unknown (load torque or rated data missing)");
        duties.push({ duty, continuous: continuous.value, transient, time, note: notes.join("; "), verdict });
      }
      // Cited duty classes in the order light, normal, heavy, then any other by name.
      const rank = (duty: string) => {
        const at = ["light", "normal", "heavy"].indexOf(fold(duty));
        return at < 0 ? 3 : at;
      };
      duties.sort((a, b) => rank(a.duty) - rank(b.duty) || a.duty.localeCompare(b.duty));
    }
    const duty =
      duties.find((entry) => entry.verdict === "pass") ?? duties.find((entry) => entry.verdict === "unknown");
    const inputCurrent = driveItem ? pick(driveItem, "inputCurrentMax", "A", "high") : null;

    // ---- method evaluation ------------------------------------------------------------------------------------------
    const softItem = entry.softstarter ? items.get(entry.softstarter) : undefined;
    const softLimit =
      entry.currentLimit ?? (softItem ? pick(softItem, "currentLimitMax", "1", "high").value : null);
    const verdictOf: Partial<Record<StartingMethod, Verdict>> = {};
    const timeOf: Partial<Record<StartingMethod, Num>> = {};
    const accelOf: Partial<Record<StartingMethod, (n: number) => number>> = {};
    const reasonsOf: Partial<Record<StartingMethod, string[]>> = {};
    const istLine = kIst !== null && inRated !== null ? kIst * inRated : null;
    for (const method of startingMethods) {
      const checks: Verdict[] = [];
      const open: string[] = [];
      const check = (key: string, title: string, rest: Omit<Criterion, "id" | "title" | "subject">) => {
        checks.push(rest.verdict);
        if (rest.verdict === "fail" || rest.verdict === "unknown") open.push(`${key} ${rest.verdict}`);
        add({ id: `${key}:${method}`, title: `${title} (${METHOD_TITLES[method]})`, subject, ...rest });
      };
      // Process function.
      let fn: Verdict = "pass";
      let fnNote = "Meets the stated process function.";
      if (method === "reversing" && !entry.reversing) {
        fn = "not-evaluated";
        fnNote = "Reversing is not required.";
      } else if (entry.speedControl && method !== "vfd") {
        fn = "fail";
        fnNote = "Speed control is required; only a variable-speed drive provides it.";
      } else if (entry.reversing && method === "dol") {
        fn = "fail";
        fnNote = "Reversing is required; a single direct-on-line contactor does not reverse.";
      } else if (entry.reversing && (method === "star-delta" || method === "softstarter")) {
        fn = "not-evaluated";
        fnNote = "Reversing with this method is not modelled.";
      } else if (entry.inching && (method === "star-delta" || method === "softstarter")) {
        fn = "not-evaluated";
        fnNote = "Inching with this method is not modelled.";
      }
      check("function", "Process function", { verdict: fn, note: fnNote });
      if (fn === "not-evaluated") {
        verdictOf[method] = "not-evaluated";
        add({
          id: `method:${method}`,
          title: `Method ${METHOD_TITLES[method]}`,
          subject,
          verdict: "not-evaluated",
          note: fnNote,
        });
        for (const [key, unit] of [
          ["startingCurrent", "A"],
          ["startingTorque", "Nm"],
          ["accelerationTime", "s"],
        ] as const)
          value(`${key}:${method}`, subject, null, unit);
        continue;
      }

      // Star-delta eligibility.
      if (method === "star-delta") {
        let verdict: Verdict;
        let note: string;
        if (terminals === null || connection === undefined || uMotor === null || un === null) {
          verdict = "unknown";
          note = `Not stated: ${[terminals === null && "terminals", connection === undefined && "connection", uMotor === null && "ratedVoltage", un === null && "network nominal voltage"].filter(Boolean).join(", ")}.`;
        } else {
          const delta = fold(connection) === "delta";
          const sameVoltage = Math.abs(uMotor - un) <= 0.01 * un + EPSILON;
          verdict = terminals >= 6 && delta && sameVoltage ? "pass" : "fail";
          note = `${sig(terminals)} terminals, ${connection} at ${sig(uMotor)} V on a ${sig(un)} V network: ${verdict === "pass" ? "the winding runs in delta at the network voltage" : "star-delta needs 6 terminals and a delta winding rated for the network voltage"}.`;
        }
        check("star-delta-eligibility", "Star-delta eligibility", { verdict, note });
      }

      // Torque and current under the method.
      let accelerating: ((n: number) => number) | null = null;
      let startCurrent: Num = null;
      let startTorque: Num = null;
      let methodNote = "";
      const loadFn = load;
      if (method === "dol" || method === "reversing") {
        startCurrent = istLine;
        if (curve && loadFn) accelerating = (n) => tm(n) - loadFn(n);
        startTorque = curve ? tm(0) : null;
      } else if (method === "star-delta") {
        startCurrent = istLine === null ? null : istLine / 3;
        startTorque = curve ? tm(0) / 3 : null;
        if (curve && loadFn && speed !== null && entry.switchover !== undefined) {
          const sw = entry.switchover * speed;
          accelerating = (n) => (n < sw ? tm(n) / 3 : tm(n)) - loadFn(n);
          methodNote = ` Switch-over at ${sig(sw)} rpm.`;
        } else if (entry.switchover === undefined) methodNote = " No switch-over speed stated.";
      } else if (method === "softstarter") {
        if (softLimit === null)
          methodNote = " No current limit (request currentLimit or a cited currentLimitMax).";
        else if (inRated !== null)
          // The limit never raises the current above the direct-on-line starting current.
          startCurrent = (kIst === null ? softLimit : Math.min(softLimit, kIst)) * inRated;
        if (curve && loadFn && softLimit !== null && kIst !== null && nk !== null && speed !== null) {
          const dolCurrent = (n: number) =>
            n <= nk ? kIst : n >= speed ? 1 : kIst + ((1 - kIst) * (n - nk)) / (speed - nk);
          const factor = (n: number) => Math.min(1, (softLimit / dolCurrent(n)) ** 2);
          accelerating = (n) => tm(n) * factor(n) - loadFn(n);
          startTorque = tm(0) * factor(0);
        }
      } else {
        startCurrent = inputCurrent?.value ?? null;
        if (!driveItem) methodNote = " No drive named.";
        else if (!duty || duty.transient === null) methodNote = " No cited transient current of the drive.";
        if (curve && loadFn && inRated !== null && duty?.transient != null && tn !== null) {
          const torque = Math.min(duty.transient / inRated, curve.tk / tn) * tn;
          accelerating = (n) => torque - loadFn(n);
          startTorque = torque;
          methodNote = ` Duty ${duty.duty}: ${sig(torque)} Nm from ${sig(duty.transient)} A.`;
        }
      }
      let time: Num = null;
      let stall: Num = null;
      if (accelerating && j !== null && speed !== null && nk !== null && ns !== null) {
        let end: Num = speed;
        if (method !== "vfd") {
          const steady = steadySpeed(nk, ns, accelerating);
          end = steady === null ? null : END_SHARE * steady;
          if (steady === null) stall = nk;
        }
        if (end !== null) {
          const run = accelerationTime(j, 0, end, accelerating);
          time = run.time;
          stall = run.stall;
        }
      }
      if (accelerating) accelOf[method] = accelerating;
      timeOf[method] = time;
      value(`startingCurrent:${method}`, subject, startCurrent, "A");
      value(`startingTorque:${method}`, subject, startTorque, "Nm");
      value(`accelerationTime:${method}`, subject, time, "s");

      // Starting current.
      if (entry.startingCurrentMax === undefined)
        check("starting-current", "Starting current", {
          verdict: "not-evaluated",
          ...(startCurrent === null ? {} : { measured: { value: sig(startCurrent), unit: "A" } }),
          note: "No starting-current limit stated.",
        });
      else
        check("starting-current", "Starting current", {
          verdict:
            startCurrent === null
              ? "unknown"
              : atLeast(entry.startingCurrentMax, startCurrent)
                ? "pass"
                : "fail",
          ...(startCurrent === null ? {} : { measured: { value: sig(startCurrent), unit: "A" } }),
          limit: { value: entry.startingCurrentMax, unit: "A" },
          note:
            startCurrent === null
              ? `Line starting current unknown.${methodNote}`
              : `Line starting current of the ${METHOD_TITLES[method]} start.${methodNote}`,
        });

      // Starting torque (no stall).
      const torqueOpen =
        !curve || !loadFn
          ? `Torque or load data missing (${missing.join(", ") || "motor curve"}).`
          : !accelerating
            ? `Not modelled without the method data.${methodNote}`
            : null;
      check("starting-torque", "Accelerating torque over the speed range", {
        verdict:
          torqueOpen !== null || (j === null && stall === null)
            ? "unknown"
            : stall !== null
              ? "fail"
              : kTu === null && method !== "vfd"
                ? "unknown"
                : "pass",
        ...(startTorque === null ? {} : { measured: { value: sig(startTorque), unit: "Nm" } }),
        ...(loadFn ? { limit: { value: sig(loadFn(0)), unit: "Nm" } } : {}),
        note:
          torqueOpen ??
          (stall !== null
            ? `The motor torque falls to the load torque at ${sig(stall)} rpm: no acceleration.${methodNote}`
            : j === null
              ? "Inertia not stated."
              : kTu === null && method !== "vfd"
                ? `No stall with the starting torque standing in for the unstated pull-up torque; not established.${methodNote}`
                : `The motor torque stays above the load torque up to the end speed.${methodNote}`),
      });

      // Acceleration time.
      const limitsHere: string[] = [];
      let accelVerdict: Verdict = "not-evaluated";
      const timeLimit = Math.min(
        entry.accelerationTimeMax ?? Number.POSITIVE_INFINITY,
        method === "vfd" ? Number.POSITIVE_INFINITY : (lockedTime ?? Number.POSITIVE_INFINITY),
      );
      if (entry.accelerationTimeMax !== undefined)
        limitsHere.push(`accelerationTimeMax ${entry.accelerationTimeMax} s`);
      if (method !== "vfd" && lockedTime !== null) limitsHere.push(`locked-rotor time ${sig(lockedTime)} s`);
      // A direct start also has to stay below the motor's permissible locked-rotor time; without it a pass is
      // not established.
      const lockedOpen = method !== "vfd" && lockedTime === null;
      if (limitsHere.length) {
        if (stall !== null) accelVerdict = "fail";
        else if (time === null) accelVerdict = "unknown";
        else
          accelVerdict =
            method !== "vfd" && lockedTime !== null && !(time < lockedTime)
              ? "fail"
              : !atLeast(timeLimit, time)
                ? "fail"
                : lockedOpen
                  ? "unknown"
                  : "pass";
      }
      check("acceleration-time", "Acceleration time", {
        verdict: accelVerdict,
        ...(time === null ? {} : { measured: { value: sig(time), unit: "s" } }),
        ...(Number.isFinite(timeLimit) ? { limit: { value: sig(timeLimit), unit: "s" } } : {}),
        note: limitsHere.length
          ? `Against ${limitsHere.join(" and ")}.${time === null && stall === null ? " Time unknown." : ""}${lockedOpen ? " No locked-rotor time of the motor stated." : ""}`
          : "No acceleration limit stated; the time is reported only.",
      });

      // Starts per hour.
      if (starts === null)
        check("starts-per-hour", "Starts per hour", {
          verdict: "not-evaluated",
          note: "No starts per hour stated.",
        });
      else {
        const caps: { value: Num; what: string }[] = [];
        if (method !== "vfd") caps.push({ value: startsMax, what: "motor startsPerHourMax" });
        if (method === "softstarter")
          caps.push({
            value: softItem ? pick(softItem, "startsPerHourMax", "1/h", "low").value : null,
            what: "softstarter startsPerHourMax",
          });
        const unknownCaps = caps.filter((cap) => cap.value === null).map((cap) => cap.what);
        const lowest = caps
          .filter((cap) => cap.value !== null)
          .reduce<Num>(
            (low, cap) => (low === null || (cap.value as number) < low ? (cap.value as number) : low),
            null,
          );
        const verdict: Verdict =
          lowest !== null && !atLeast(lowest, starts)
            ? "fail"
            : unknownCaps.length
              ? "unknown"
              : caps.length
                ? "pass"
                : "not-evaluated";
        check("starts-per-hour", "Starts per hour", {
          verdict,
          measured: { value: sig(starts), unit: "1/h" },
          ...(lowest === null ? {} : { limit: { value: sig(lowest), unit: "1/h" } }),
          note: unknownCaps.length
            ? `Not cited: ${unknownCaps.join(", ")}.`
            : caps.length
              ? "Against the cited limits."
              : "The drive limits the current; starts are not limited by this check.",
        });
      }

      const verdict: Verdict = checks.includes("fail")
        ? "fail"
        : checks.includes("unknown")
          ? "unknown"
          : "pass";
      verdictOf[method] = verdict;
      reasonsOf[method] = open;
      add({
        id: `method:${method}`,
        title: `Method ${METHOD_TITLES[method]}`,
        subject,
        verdict,
        note:
          verdict === "pass"
            ? "Every evaluated check passes."
            : `${verdict === "fail" ? "Fails" : "Not established"}: ${open.join(", ")}.`,
      });
    }

    // ---- proposal ------------------------------------------------------------------------------------------------
    let proposed: StartingMethod | null = null;
    const earlier: StartingMethod[] = [];
    for (const method of startingMethods) {
      if (verdictOf[method] === "pass") {
        proposed = method;
        break;
      }
      if (verdictOf[method] === "unknown") earlier.push(method);
    }
    const conditional = proposed === null || earlier.length > 0;
    if (proposed === null && earlier.length) proposed = earlier[0] as StartingMethod;
    if (proposed === null) {
      add({
        id: "proposal",
        title: "Proposed starting method",
        subject,
        verdict: startingMethods.every((m) => verdictOf[m] === "not-evaluated") ? "not-evaluated" : "fail",
        note: "No method meets the process function and the stated limits.",
      });
      return;
    }

    // ---- assembly for the proposed method --------------------------------------------------------------------------
    const open: string[] = [];
    const failed: string[] = [];
    const part = (entry: Criterion, blocking = true) => {
      add(entry);
      if (entry.verdict === "fail") failed.push(entry.id);
      else if (blocking && (entry.verdict === "unknown" || entry.verdict === "not-evaluated"))
        open.push(entry.id);
    };
    const devices: ElectricalAssembly["devices"] = [];
    const connections: ElectricalAssembly["connections"] = [];
    const interlocks: ElectricalAssembly["interlocks"] = [];
    const device = (
      tag: string,
      role: string,
      item: CatalogItem | undefined,
      setting?: { value: number; unit: string },
    ) =>
      devices.push({
        tag,
        role,
        item: item?.id ?? null,
        orderCode: item?.orderCode ?? null,
        ...(setting ? { setting: { value: sig(setting.value), unit: setting.unit } } : {}),
      });
    const link = (from: string, to: string, kind: "power" | "control" = "power") =>
      connections.push({ from, to, kind });
    const time = timeOf[proposed] ?? null;

    // Protective device: copied from the protection result.
    const protectionItem = entry.protection ? items.get(entry.protection) : undefined;
    if (!protectionItem)
      part({
        id: "protection",
        title: "Protective device",
        subject,
        verdict: "unknown",
        note: "No protective device named; name a candidate of the protection run.",
      });
    else {
      const selection = stored(protection, `selection:${protectionItem.orderCode}`, circuit.id);
      part({
        id: `protection:${protectionItem.orderCode}`,
        title: `Protective device (${protectionItem.orderCode})`,
        subject,
        verdict: selection?.verdict ?? "not-evaluated",
        note: selection
          ? `From protection result ${protection.runId} on ${label(circuit)}: ${selection.note ?? selection.verdict}`
          : `The protection result ${protection.runId} holds no selection of ${protectionItem.orderCode} on ${label(circuit)}; run protection_coordination with it as candidate.`,
      });
    }
    device("Q1", "protection", protectionItem, undefined);
    link("supply", "Q1");
    const thermalTrip =
      protectionItem !== undefined && /thermal/i.test(String(protectionItem.attributes?.tripUnit ?? ""));

    // Contactors.
    const vWanted: Conditions = un === null ? {} : { voltage: { value: sig(un), unit: "V" } };
    const contactor = (
      position: string,
      tag: string,
      item: CatalogItem | undefined,
      current: Num,
      use: string,
    ) => {
      device(tag, `${position}-contactor`, item);
      const key = `contactor-${position}`;
      if (!item) {
        part({
          id: key,
          title: `Contactor ${position}`,
          subject,
          verdict: "unknown",
          note: "No contactor named.",
        });
        return;
      }
      if (current === null || un === null) {
        part({
          id: `${key}:${item.orderCode}`,
          title: `Contactor ${position} (${item.orderCode})`,
          subject,
          verdict: "unknown",
          note: current === null ? "Motor rated current unknown." : "Network voltage unknown.",
        });
        return;
      }
      const c = one(item, {
        id: "ie",
        parameter: "ratedCurrent",
        op: ">=",
        value: { value: sig(current), unit: "A" },
        conditions: {
          utilisationCategory: { text: use },
          ...vWanted,
          ...(request.ambientTemperature !== undefined
            ? { ambientTemperature: { value: request.ambientTemperature, unit: "°C" } }
            : {}),
        },
      });
      const measured = c.measured && "value" in c.measured ? c.measured : undefined;
      part({
        id: `${key}:${item.orderCode}`,
        title: `Contactor ${position} (${item.orderCode})`,
        subject,
        verdict: c.verdict,
        ...(measured ? { measured: { value: measured.value, unit: measured.unit } } : {}),
        limit: { value: sig(current), unit: "A" },
        note:
          c.verdict === "unknown"
            ? sentence(
                `${why(c, `${use} rated current`)} at ${sig(un)} V${request.ambientTemperature !== undefined ? ` and ${request.ambientTemperature} °C` : ""}`,
              )
            : `${use} Ie at ${sig(un)} V against the ${position} current.${cite(c)}`,
      });
    };
    const interlock = (pair: [string, string], item: CatalogItem | undefined) => {
      const accessory = item?.accessories?.find((entry) => fold(entry.role) === "mechanical-interlock");
      const part2 = accessory ? items.get(accessory.item) : undefined;
      part({
        id: `mechanical-interlock${item ? `:${item.orderCode}` : ""}`,
        title: `Mechanical interlock ${pair.join("/")}`,
        subject,
        verdict: part2 ? "pass" : "unknown",
        note: part2
          ? `${part2.orderCode} listed as mechanical-interlock accessory of ${item?.orderCode}.`
          : `No mechanical-interlock accessory listed for ${item?.orderCode ?? "the contactor"}.`,
      });
      interlocks.push({
        kind: "mechanical",
        devices: pair,
        note: part2
          ? `${part2.orderCode} mechanical interlock between ${pair.join(" and ")}.`
          : `Mechanical interlock between ${pair.join(" and ")} (accessory not established).`,
      });
      if (part2) device(`${pair[0]}-${pair[1]}`.slice(0, 64), "mechanical-interlock", part2);
      interlocks.push({
        kind: "electrical",
        devices: pair,
        note: `An auxiliary NC contact of each of ${pair.join(" and ")} opens the other's coil circuit.`,
      });
    };
    const relay = (current: Num, multiple: Num) => {
      const item = entry.overloadRelay ? items.get(entry.overloadRelay) : undefined;
      device("F1", "overload-relay", item, current === null ? undefined : { value: current, unit: "A" });
      if (!item) {
        part({
          id: "overload-relay",
          title: "Overload relay",
          subject,
          verdict: "unknown",
          note: "No overload relay named.",
        });
        return;
      }
      const low = pick(item, "settingCurrentMin", "A", "high");
      const high = pick(item, "settingCurrentMax", "A", "low");
      const ambientMax = pick(item, "ambientTemperatureMax", "°C", "low");
      let verdict: Verdict = "unknown";
      let note: string;
      if (current === null) note = "Setting current unknown.";
      else if (low.value === null || high.value === null)
        note = sentence(why(low.value === null ? low.criterion : high.criterion, "setting range"));
      else {
        verdict = atLeast(current, low.value) && atLeast(high.value, current) ? "pass" : "fail";
        note = `Setting ${sig(current)} A within ${sig(low.value)}..${sig(high.value)} A: ${verdict === "pass" ? "yes" : "no"}.${cite(high.criterion)}`;
      }
      if (verdict === "pass" && ambientK !== null) {
        if (ambientMax.value === null) {
          verdict = "unknown";
          note += " No cited ambient limit.";
        } else if (ambientMax.value < ambientK - EPSILON) {
          verdict = "fail";
          note += ` Panel ${request.ambientTemperature} °C above the cited ${sig(ambientMax.value - KELVIN)} °C.`;
        }
      }
      part({
        id: `overload-relay:${item.orderCode}`,
        title: `Overload relay (${item.orderCode})`,
        subject,
        verdict,
        ...(current === null ? {} : { measured: { value: sig(current), unit: "A" } }),
        note,
      });
      // The start against the cited tripping band from cold.
      const bands = cited(item, "tripTimeMin");
      const band = bands[0];
      const at = band ? boundOf(band, "currentMultiple") : null;
      const tMin = band ? num(band) : null;
      const tMax = (() => {
        const entry2 = cited(item, "tripTimeMax").find((p) => boundOf(p, "currentMultiple") === at);
        return entry2 ? num(entry2) : null;
      })();
      let startVerdict: Verdict = "unknown";
      let startNote: string;
      if (time === null || multiple === null)
        startNote = "Acceleration time or starting current multiple unknown.";
      else if (at === null || tMin === null)
        startNote = "No cited tripping band (tripTimeMin at a currentMultiple).";
      else if (multiple <= at + EPSILON && time <= tMin) {
        startVerdict = "pass";
        startNote = `Start ${sig(time)} s at ${sig(multiple)} x Ir stays below the minimum tripping time ${sig(tMin)} s at ${sig(at)} x Ir.`;
      } else if (multiple >= at - EPSILON && tMax !== null && time > tMax) {
        startVerdict = "fail";
        startNote = `Start ${sig(time)} s at ${sig(multiple)} x Ir exceeds the maximum tripping time ${sig(tMax)} s at ${sig(at)} x Ir.`;
      } else
        startNote = `Start ${sig(time)} s at ${sig(multiple)} x Ir is inside or beyond the cited band at ${sig(at)} x Ir; not established.`;
      part({
        id: `overload-start:${item.orderCode}`,
        title: `Overload relay against the start (${item.orderCode})`,
        subject,
        verdict: startVerdict,
        ...(time === null ? {} : { measured: { value: sig(time), unit: "s" } }),
        ...(tMin === null ? {} : { limit: { value: sig(tMin), unit: "s" } }),
        note: startNote,
      });
    };
    const starter = (contactorItem: CatalogItem | undefined) => {
      if (!protectionItem || !contactorItem) return;
      for (const type of [2, 1]) {
        const found = stored(
          protection,
          `starter-type-${type}:${protectionItem.orderCode}/${contactorItem.orderCode}`,
          circuit.id,
        );
        if (found) {
          part(
            {
              id: `starter-coordination:${protectionItem.orderCode}/${contactorItem.orderCode}`,
              title: `Starter coordination type ${type} (${protectionItem.orderCode} / ${contactorItem.orderCode})`,
              subject,
              verdict: found.verdict,
              note: `From protection result ${protection.runId}: ${found.note ?? found.verdict}`,
            },
            false,
          );
          return;
        }
      }
      part(
        {
          id: `starter-coordination:${protectionItem.orderCode}/${contactorItem.orderCode}`,
          title: `Starter coordination (${protectionItem.orderCode} / ${contactorItem.orderCode})`,
          subject,
          verdict: "not-evaluated",
          note: "The protection result holds no starter coordination for this pair.",
        },
        false,
      );
    };
    const main = entry.contactor ? items.get(entry.contactor) : undefined;
    const ac = entry.inching ? "AC-4" : "AC-3";
    const multipleDirect = kIst;
    if (proposed === "dol" || proposed === "reversing") {
      contactor("line", "KM1", main, inRated, ac);
      link("Q1", "KM1");
      if (proposed === "reversing") {
        contactor("reverse", "KM2", main, inRated, ac);
        link("Q1", "KM2");
        interlock(["KM1", "KM2"], main);
      }
      starter(main);
      if (thermalTrip) {
        part(
          {
            id: "overload-relay",
            title: "Overload relay",
            subject,
            verdict: "not-evaluated",
            note: `${protectionItem?.orderCode} has a thermal trip and protects against overload; its tripping class against the start is not cited here.`,
          },
          false,
        );
        link("KM1", "motor:U1,V1,W1");
        if (proposed === "reversing") link("KM2", "motor:W1,V1,U1");
      } else {
        relay(inRated, multipleDirect);
        link("KM1", "F1");
        // KM2 swaps L1 and L3 on its way to the relay: its outputs 2, 4, 6 feed F1's inputs 5, 3, 1.
        if (proposed === "reversing") link("KM2", "F1:5,3,1");
        link("F1", "motor:U1,V1,W1");
        interlocks.push({
          kind: "electrical",
          devices: ["F1", "KM1"],
          note: "F1 auxiliary NC opens the coil circuit.",
        });
      }
    } else if (proposed === "star-delta") {
      const lineCurrent = inRated === null ? null : inRated / Math.sqrt(3);
      contactor("line", "KM1", main, lineCurrent, "AC-3");
      contactor("delta", "KM2", main, lineCurrent, "AC-3");
      const star = entry.starContactor ? items.get(entry.starContactor) : main;
      contactor("star", "KM3", star, inRated === null ? null : inRated / 3, "AC-3");
      interlock(["KM2", "KM3"], star ?? main);
      starter(main);
      relay(lineCurrent, kIst === null ? null : kIst / Math.sqrt(3));
      link("Q1", "KM1");
      link("KM1", "F1");
      link("F1", "motor:U1,V1,W1");
      link("KM1", "KM2");
      link("KM2", "motor:W2,U2,V2");
      link("KM3", "motor:U2,V2,W2");
      interlocks.push({
        kind: "sequence",
        devices: ["KM3", "KM1", "KM2"],
        note: `KM3 (star) and KM1 close to start; at the switch-over ${entry.switchover !== undefined ? `(${sig(entry.switchover * 100)} % of rated speed)` : "(not stated)"} KM3 opens before KM2 (delta) closes.`,
      });
      interlocks.push({
        kind: "electrical",
        devices: ["F1", "KM1"],
        note: "F1 auxiliary NC opens the coil circuits.",
      });
    } else if (proposed === "softstarter") {
      device("A1", "softstarter", softItem, softLimit === null ? undefined : { value: softLimit, unit: "1" });
      link("Q1", "A1");
      link("A1", "motor:U1,V1,W1");
      if (!softItem)
        part({
          id: "softstarter",
          title: "Softstarter",
          subject,
          verdict: "unknown",
          note: "No softstarter named.",
        });
      else {
        const rating = derated(softItem, "ratedCurrent", {});
        part({
          id: `softstarter:${softItem.orderCode}`,
          title: `Softstarter rating (${softItem.orderCode})`,
          subject,
          verdict:
            rating.value === null || inRated === null
              ? "unknown"
              : atLeast(rating.value, inRated)
                ? "pass"
                : "fail",
          ...(rating.value === null ? {} : { measured: { value: sig(rating.value), unit: "A" } }),
          ...(inRated === null ? {} : { limit: { value: sig(inRated), unit: "A" } }),
          note:
            rating.value === null
              ? sentence(why(rating.criterion, "rated current at the panel conditions"))
              : `Rated current against In.${rating.note}`,
        });
        const limitMax = pick(softItem, "currentLimitMax", "1", "high");
        if (entry.currentLimit !== undefined)
          part({
            id: `softstarter-limit:${softItem.orderCode}`,
            title: `Softstarter current limit (${softItem.orderCode})`,
            subject,
            verdict:
              limitMax.value === null
                ? "unknown"
                : atLeast(limitMax.value, entry.currentLimit)
                  ? "pass"
                  : "fail",
            measured: { value: entry.currentLimit, unit: "1" },
            ...(limitMax.value === null ? {} : { limit: { value: sig(limitMax.value), unit: "1" } }),
            note:
              limitMax.value === null
                ? "No cited maximum current limit."
                : `Requested limit within the cited maximum.${cite(limitMax.criterion)}`,
          });
        const internal = fold(String(softItem.attributes?.bypass ?? "")) === "internal";
        if (internal)
          interlocks.push({
            kind: "sequence",
            devices: ["A1"],
            note: "The internal bypass closes at the end of the ramp.",
          });
        else {
          contactor("bypass", "KM2", main, inRated, "AC-1");
          link("Q1", "KM2");
          link("KM2", "motor:U1,V1,W1");
          interlocks.push({
            kind: "sequence",
            devices: ["A1", "KM2"],
            note: "KM2 bypasses A1 at the end of the ramp and opens before a soft stop.",
          });
        }
        if (fold(String(softItem.attributes?.motorThermalProtection ?? "")) !== "integrated") {
          relay(inRated, softLimit);
          link("A1", "F1");
        }
      }
    } else {
      device("A1", "drive", driveItem);
      link("Q1", "A1");
      link("A1", "motor:U1,V1,W1");
      if (!driveItem)
        part({
          id: "drive",
          title: "Variable-speed drive",
          subject,
          verdict: "unknown",
          note: "No drive named.",
        });
      else {
        const code = driveItem.orderCode;
        const chosen = duties.find((entry2) => entry2.verdict === "pass");
        part({
          id: `drive-current:${code}`,
          title: `Drive current and overload (${code})`,
          subject,
          verdict: chosen
            ? "pass"
            : duties.some((entry2) => entry2.verdict === "unknown") || !duties.length
              ? "unknown"
              : "fail",
          ...(inRated === null ? {} : { limit: { value: sig(inRated), unit: "A" } }),
          note: duties.length
            ? `${chosen ? `Duty ${chosen.duty} selected (by current, not by power). ` : ""}${duties.map((entry2) => entry2.note).join(" | ")}`
            : "No cited continuous current per duty class (ratedCurrent with condition dutyClass).",
        });
        const overloadTime = chosen?.time ?? null;
        if (chosen && time !== null)
          part({
            id: `drive-overload-time:${code}`,
            title: `Acceleration within the drive overload time (${code})`,
            subject,
            verdict: overloadTime === null ? "unknown" : time <= overloadTime + EPSILON ? "pass" : "fail",
            measured: { value: sig(time), unit: "s" },
            ...(overloadTime === null ? {} : { limit: { value: sig(overloadTime), unit: "s" } }),
            note:
              overloadTime === null
                ? "No cited overload time."
                : "Acceleration at the transient current within its cited duration.",
          });
        const vMin = pick(driveItem, "supplyVoltageMin", "V", "high");
        const vMax = pick(driveItem, "supplyVoltageMax", "V", "low");
        part({
          id: `drive-voltage:${code}`,
          title: `Drive supply voltage (${code})`,
          subject,
          verdict:
            un === null || vMin.value === null || vMax.value === null
              ? "unknown"
              : atLeast(un, vMin.value) && atLeast(vMax.value, un)
                ? "pass"
                : "fail",
          ...(un === null ? {} : { measured: { value: sig(un), unit: "V" } }),
          note:
            vMin.value === null || vMax.value === null
              ? "No cited supply voltage range."
              : `Network ${un === null ? "unknown" : `${sig(un)} V`} within ${sig(vMin.value)}..${sig(vMax.value)} V.${cite(vMax.criterion)}`,
        });
        // Motor cable (dv/dt) from cited data only.
        const length = cable ? prop(cable, "length", "length") : null;
        const cableMax = pick(driveItem, "motorCableLengthMax", "m", "low");
        part(
          {
            id: `motor-cable:${code}`,
            title: `Motor cable length (${code})`,
            subject,
            verdict:
              length === null || cableMax.value === null
                ? "unknown"
                : atLeast(cableMax.value, length)
                  ? "pass"
                  : "fail",
            ...(length === null ? {} : { measured: { value: sig(length), unit: "m" } }),
            ...(cableMax.value === null ? {} : { limit: { value: sig(cableMax.value), unit: "m" } }),
            note:
              cableMax.value === null
                ? "No cited maximum motor cable length; output filter (dv/dt, sine) needs not established."
                : length === null
                  ? "Motor cable length unknown."
                  : atLeast(cableMax.value, length)
                    ? `Within the cited maximum.${cite(cableMax.criterion)}`
                    : `Longer than the cited maximum: an output filter or reactor from the manufacturer's data is needed.${cite(cableMax.criterion)}`,
          },
          false,
        );
        if (length !== null && cableMax.value !== null && !atLeast(cableMax.value, length)) {
          device("L1", "output-filter", undefined);
          link("A1", "L1");
        }
        const emc = driveItem.attributes?.emcCategory;
        part(
          {
            id: `emc:${code}`,
            title: `EMC category (${code})`,
            subject,
            verdict: typeof emc === "string" ? "pass" : "unknown",
            note:
              typeof emc === "string"
                ? `Cited EMC category ${emc}; the environment's required category follows the profile.`
                : `No cited EMC category${driveItem.attributes?.emcFilter ? ` (EMC filter: ${driveItem.attributes.emcFilter})` : ""}.`,
          },
          false,
        );
        const rcd = driveItem.attributes?.rcdTypes;
        if (typeof rcd === "string")
          part(
            {
              id: `rcd-requirement:${code}`,
              title: `RCD requirement (${code})`,
              subject,
              verdict: "not-evaluated",
              note: `The drive data ask for RCD types ${rcd}; state rcdTypes on the motor and run protection_coordination.`,
            },
            false,
          );
        if (entry.stopTimeMax !== undefined) {
          const energy = j !== null && omega !== null ? 0.5 * j * omega * omega : null;
          value("brakingEnergy", subject, energy, "J");
          value("brakingPower", subject, energy === null ? null : energy / entry.stopTimeMax, "W");
          const chopper = driveItem.attributes?.brakingChopper;
          part(
            {
              id: `braking:${code}`,
              title: `Braking within ${entry.stopTimeMax} s (${code})`,
              subject,
              verdict: "unknown",
              note: `Kinetic energy ${energy === null ? "unknown" : `${sig(energy)} J`}, mean braking power ${energy === null ? "unknown" : `${sig(energy / entry.stopTimeMax)} W`}; braking chopper ${typeof chopper === "string" ? chopper : "not stated"}: the resistor needs the manufacturer's resistor data.`,
            },
            false,
          );
          if (typeof chopper === "string" && fold(chopper) === "integrated") {
            device("R1", "braking-resistor", undefined);
            link("A1", "R1");
          }
        }
      }
      // Motor overload protection: the drive's own only when its data say so, else an overload relay.
      if (driveItem && fold(String(driveItem.attributes?.motorThermalProtection ?? "")) !== "integrated") {
        const transient = duties.find((entry2) => entry2.verdict === "pass")?.transient ?? null;
        relay(inRated, transient === null || inRated === null ? null : transient / inRated);
        link("A1", "F1");
      }
      interlocks.push({
        kind: "electrical",
        devices: ["A1"],
        note: "Start, stop and speed through the drive's control inputs; no safety function is claimed by this scheme.",
      });
    }

    // Curve points of the proposed method.
    const accelerating = accelOf[proposed];
    for (const pct of [0, 25, 50, 75, 90, 100]) {
      const n = ns === null ? null : (pct / 100) * ns;
      const loadAt = n !== null && load ? load(n) : null;
      value(`loadTorque@${pct}`, subject, loadAt, "Nm");
      value(
        `motorTorque:${proposed}@${pct}`,
        subject,
        n !== null && accelerating && loadAt !== null ? accelerating(n) + loadAt : null,
        "Nm",
      );
    }

    const methodPass = verdictOf[proposed] === "pass" && earlier.length === 0;
    const verdict: Verdict = failed.length ? "fail" : methodPass && !open.length ? "pass" : "unknown";
    add({
      id: "proposal",
      title: "Proposed starting method",
      subject,
      verdict,
      note: `${METHOD_TITLES[proposed]} for ${label(circuit)}${conditional ? " (conditional)" : ""}.${earlier.length && earlier[0] !== proposed ? ` Not established for simpler methods: ${earlier.join(", ")}.` : ""}${verdictOf[proposed] !== "pass" ? ` Method not established: ${(reasonsOf[proposed] ?? []).join(", ")}.` : ""}${failed.length ? ` Assembly fails: ${failed.join(", ")}.` : ""}${open.length ? ` Assembly not established: ${open.join(", ")}.` : ""}`,
    });
    conditions[`proposal${index + 1}`] = { text: `${motor.id} ${proposed}` };
    assemblies.push({
      motor: motor.id,
      circuit: circuit.id,
      method: proposed,
      conditional: verdict !== "pass",
      devices: devices.slice(0, 16),
      connections: connections.slice(0, 32),
      interlocks: interlocks.slice(0, 8),
    });
  });

  // ---- finish ---------------------------------------------------------------------------------------------------
  let status: ElectricalResult["status"] = "completed";
  for (const [list, name] of [
    [intermediate, "intermediate values"],
    [criteria, "criteria"],
  ] as const)
    if (list.length > electricalLimits.resultList) {
      messages.unshift(
        `${list.length - electricalLimits.resultList} ${name} were left out (limit ${electricalLimits.resultList}); evaluate fewer motors.`,
      );
      list.length = electricalLimits.resultList;
      status = "incomplete";
    }
  if (criteria.some((entry) => entry.verdict === "unknown" || entry.verdict === "not-evaluated"))
    status = "incomplete";
  if (read.size > electricalLimits.resultInputs) {
    messages.unshift(
      `${read.size - electricalLimits.resultInputs} inputs were left out (limit ${electricalLimits.resultInputs}): later changes to them do not mark this result stale.`,
    );
    status = "incomplete";
  }
  return {
    kind: "vera-electrical-result",
    format: 1,
    runId: input.runId,
    producer: { plugin: "motor-drives", operation: "motor-starting", engine: { ...MOTOR_DRIVES_ENGINE } },
    method: {
      ...MOTOR_DRIVES_METHOD,
      reference:
        `Motor starting as implemented; catalog ${stamp.id} ${stamp.version}; protection run ${protection.runId}; network run ${network.runId}`.slice(
          0,
          200,
        ),
    },
    status,
    preliminary: true,
    startedAt: input.now,
    finishedAt: input.now,
    model: { path: input.modelPath, sha256: input.modelSha256 },
    catalog: { id: stamp.id, version: stamp.version },
    inputs: [...read.entries()]
      .slice(0, electricalLimits.resultInputs)
      .map(([key, snapshot]) => ({ id: key, snapshot: snapshot as never })),
    assumptions: assumptions.map((text) => text.slice(0, 1000)),
    sources: [...sources].slice(0, electricalLimits.resultList),
    conditions,
    intermediate,
    criteria,
    limits,
    messages: messages.slice(0, electricalLimits.resultList).map((text) => text.slice(0, 1000)),
    ...(assemblies.length ? { assemblies } : {}),
  };
}
