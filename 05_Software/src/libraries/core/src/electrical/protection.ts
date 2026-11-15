// The LV protection engine "vera-lv-protection-1" (spec REQ-DATA-a5673202 "Method"): candidate fuses and breakers
// per circuit against a CURRENT stored electrical-network result - breaking capacity of the named kind, overload,
// automatic disconnection from cited tripping bands, let-through energy, RCD type and sensitivity - and selectivity,
// cascading and starter coordination only from the catalog's manufacturer tables. Pure: it reads the model, the
// network result and one catalog and returns one format-1 electrical result; it never changes the model or a device.
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
  type CatalogCriterion,
  type CatalogStamp,
  coordinationFor,
  findItems,
  selectItems,
} from "./catalog.js";
import { toBaseUnit, unitDimension } from "./units.js";

export const PROTECTION_ENGINE = { name: "vera-lv-protection", version: "1.0.0" } as const;
export const PROTECTION_METHOD = {
  id: "vera-lv-protection-1",
  title:
    "LV protection: breaking capacity, overload, disconnection, let-through energy and manufacturer-table coordination",
} as const;

// The request is a tool schema in every electrical session, so it is kept small: IDs are checked against the model
// and the catalog, numbers carry fixed units (setting A, times s, residualCurrentMax mA) and bounds are refinements.
const id = z.string();
const within = (low: number, high: number, name: string) =>
  z.number().refine((value) => value > low && value <= high, `${name} must be > ${low} and <= ${high}`);
const list = <T extends z.ZodType>(item: T, max: number, name: string) =>
  z.array(item).refine((entries) => entries.length <= max, `at most ${max} ${name}`);
const MAX_CANDIDATES = 16;
export const protectionRequestSchema = z.strictObject({
  network: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/),
  catalog: id,
  breakingCapacity: z.enum(["Icu", "Ics", "Icn"]),
  /** s; stands in for a missing magneticTripTimeMax and is recorded as an assumption. */
  assumedInstantaneousTripTime: within(0, 1, "assumedInstantaneousTripTime (s)").optional(),
  circuits: list(
    z.strictObject({
      circuit: id,
      protection: id.optional(),
      candidates: list(id, 8, "candidates per circuit").refine(
        (entries) => entries.length >= 1 && new Set(entries).size === entries.length,
        "candidates must be 1..8 unique items",
      ),
      setting: within(0, 1e6, "setting (A)").optional(),
      disconnectionTime: within(0, 60, "disconnectionTime (s)").optional(),
      rcd: id.optional(),
      residualCurrentMax: within(0, 1e4, "residualCurrentMax (mA)").optional(),
    }),
    16,
    "circuits",
  )
    .refine((entries) => entries.length >= 1, "name at least one circuit")
    .refine(
      (entries) => new Set(entries.map((entry) => entry.circuit)).size === entries.length,
      "circuits must be unique",
    )
    .refine(
      (entries) => entries.reduce((sum, entry) => sum + entry.candidates.length, 0) <= MAX_CANDIDATES,
      `at most ${MAX_CANDIDATES} candidates over all circuits`,
    ),
  coordination: list(
    z.strictObject({
      kind: z.enum(["selectivity", "cascading"]),
      upstream: id,
      upstreamItem: id,
      downstream: id,
      downstreamItem: id,
    }),
    16,
    "coordination pairs",
  ).optional(),
  starters: list(
    z.strictObject({
      circuit: id,
      protection: id,
      contactor: id,
      type: z.number().refine((type) => type === 1 || type === 2, "type must be 1 or 2"),
    }),
    16,
    "starters",
  ).optional(),
});
export type ProtectionRequest = z.infer<typeof protectionRequestSchema>;

export interface ProtectionInput {
  model: ElectricalModel;
  modelPath: string;
  modelSha256: string;
  /** The stored electrical-network result; the caller has checked that it is current. */
  network: ElectricalResult;
  catalog: IndustrialCatalog;
  catalogStamp: CatalogStamp;
  /** k of the cable table the network result names (null when unknown) and its description or the reason. */
  cable: { k: number | null; text: string };
  request: ProtectionRequest;
  runId: string;
  /** ISO time of the run. */
  now: string;
}

type Num = number | null;
type Criterion = ElectricalResult["criteria"][number];
type Verdict = Criterion["verdict"];
type Kind = "breaker" | "fuse";
const KINDS: Record<string, Kind> = {
  "circuit-breaker": "breaker",
  "miniature-circuit-breaker": "breaker",
  "motor-circuit-breaker": "breaker",
  "fuse-link": "fuse",
};
const RCD_CATEGORY = "residual-current-device";
const EPSILON = 1e-9;
const BIG = 1e15;
const sig = (value: number) => Number(value.toPrecision(6));
const fold = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const near = (a: number, b: number) => Math.abs(a - b) <= EPSILON * Math.max(1, Math.abs(a), Math.abs(b));
const atLeast = (value: number, limit: number) => value >= limit - EPSILON * Math.max(1, Math.abs(limit));
const label = (object: ElectricalObject) => (object.ref ? `${object.ref} (${object.id})` : object.id);
const base = (entry: { value: number; unit: string }) => toBaseUnit(entry.value, entry.unit);

export function analyzeProtection(input: ProtectionInput): ElectricalResult {
  const { model, network, catalog, catalogStamp: stamp, request } = input;
  const objects = new Map(model.objects.map((object) => [object.id, object]));
  const items = new Map(catalog.items.map((item) => [item.id, item]));
  const families = new Map(catalog.families.map((family) => [family.id, family]));
  const relations = (type: string) => model.relations.filter((relation) => relation.type === type);
  const category = (item: CatalogItem) => families.get(item.family)?.category ?? "";

  // ---- request checks (thrown before anything is evaluated) -------------------------------------------------
  const fail = (message: string): never => {
    throw Error(message);
  };
  const itemOf = (id: string) => items.get(id) ?? fail(`${id} is not an item of catalog ${catalog.id}`);
  const candidatesOf = new Map<string, string[]>();
  for (const entry of request.circuits) {
    if (objects.get(entry.circuit)?.type !== "circuit")
      fail(`${entry.circuit} is not a circuit of the model`);
    if (entry.protection !== undefined) {
      if (objects.get(entry.protection)?.type !== "protection")
        fail(`${entry.protection} is not a protection object of the model`);
      if (!relations("protects").some((r) => r.from === entry.protection && r.to === entry.circuit))
        fail(`${entry.protection} does not protect ${entry.circuit}`);
    }
    for (const id of entry.candidates) itemOf(id);
    if (entry.rcd !== undefined && category(itemOf(entry.rcd)) !== RCD_CATEGORY)
      fail(`${entry.rcd} is not a residual-current device (family category ${RCD_CATEGORY})`);
    candidatesOf.set(entry.circuit, entry.candidates);
  }
  const candidate = (circuit: string, item: string) => {
    const list = candidatesOf.get(circuit) ?? fail(`${circuit} is not a circuit of this request`);
    if (!list.includes(item)) fail(`${item} is not a candidate of ${circuit}`);
  };
  const feeder = new Map(relations("feeds").map((relation) => [relation.to, relation.from]));
  const upstreamOf = (upstream: string, downstream: string) => {
    for (let at = feeder.get(downstream), steps = 0; at !== undefined && steps < 10000; steps++) {
      if (at === upstream) return true;
      at = feeder.get(at);
    }
    return false;
  };
  for (const pair of request.coordination ?? []) {
    candidate(pair.upstream, pair.upstreamItem);
    candidate(pair.downstream, pair.downstreamItem);
    if (!upstreamOf(pair.upstream, pair.downstream))
      fail(`${pair.upstream} does not feed ${pair.downstream} (directly or through boards)`);
  }
  for (const starter of request.starters ?? []) {
    candidate(starter.circuit, starter.protection);
    itemOf(starter.contactor);
  }

  // ---- inputs, conditions and the result frame ----------------------------------------------------------------
  const read = new Map<string, unknown>();
  for (const entry of network.inputs) read.set(entry.id, entry.snapshot);
  const touch = (entity: { id: string } | undefined) => {
    if (entity && !read.has(entity.id)) read.set(entity.id, entity);
  };
  touch(model.project);
  const assumedInstant = request.assumedInstantaneousTripTime ?? null;
  const assumptions: string[] = [
    "Circuit voltage: Un from the network result for three-phase circuits, U0 = Un/sqrt(3) for single-phase circuits.",
    "Breaking capacity is compared with the maximum three-phase fault current at the circuit origin from the network result, also for single-phase circuits.",
    "Overload: Ib <= In <= Iz and I2 <= 1.45 Iz (IEC 60364-4-43 principle), with I2 = the cited conventional tripping ratio x In or the setting.",
    "Automatic disconnection: the minimum line-to-protective-conductor fault current at the circuit end must reach the current that guarantees operation within the required time (IEC 60364-4-41 principle); the required time is the request's, from the normative profile.",
    "Let-through energy: cited I2t at the maximum fault current at the origin <= k²S² (IEC 60364-4-43 principle), k of the network's cable table and S of the circuit's cable.",
  ];
  if (assumedInstant !== null)
    assumptions.push(
      `Instantaneous releases without a cited operating time operate within ${assumedInstant} s (stated in the request).`,
    );
  const limits = [
    "Only the catalog's cited values and coordination tables are used; time-current curves are not digitised, and selectivity, cascading or starter coordination is never derived from curve overlap.",
    "Selectivity, cascading and starter coordination need the manufacturer's tables for exactly those products and conditions; without one the criterion is not evaluated.",
    "Neutral protection and switching, earth-fault relays, RCD discrimination, MV protection and DC are not evaluated.",
    "No device is configured and no relay or protection setting is written; settings in the request are only the values checked.",
    "A later change of the catalog file does not mark this result stale; its version and sha256 are in the conditions.",
    "Preliminary engineering support: no verified design, no conformity statement and no safety certification.",
  ];
  const messages: string[] = [];
  const intermediate: ElectricalResult["intermediate"] = [];
  const criteria: Criterion[] = [];
  const sources = new Set<string>([
    `electrical-network result ${network.runId} (${network.method.id}, engine ${network.producer.engine.version})`,
    `${catalog.title}, version ${catalog.version}`.slice(0, 200),
  ]);
  const conditions: ElectricalResult["conditions"] = {
    networkRun: { text: network.runId },
    catalog: { text: `${stamp.id} ${stamp.version} sha256 ${stamp.sha256.slice(0, 16)}`.slice(0, 200) },
    breakingCapacityBasis: { text: request.breakingCapacity },
    cableTable: { text: input.cable.text.slice(0, 200) },
  };
  if (request.assumedInstantaneousTripTime !== undefined)
    conditions.assumedInstantaneousTripTime = { value: request.assumedInstantaneousTripTime, unit: "s" };
  request.circuits.forEach((entry, index) => {
    if (entry.disconnectionTime !== undefined)
      conditions[`disconnectionTime${index + 1}`] = { text: `${entry.circuit} ${entry.disconnectionTime} s` };
  });
  const value = (name: string, subject: string, amount: Num, unit: string) =>
    intermediate.push({
      name,
      subject,
      value: amount === null || !Number.isFinite(amount) ? null : sig(amount),
      unit,
    });
  const add = (entry: Criterion) =>
    criteria.push({ ...entry, ...(entry.note ? { note: entry.note.slice(0, 1000) } : {}) });
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

  // ---- network values ---------------------------------------------------------------------------------------
  const stored = (name: string, subject: string): Num => {
    const entry = network.intermediate.find((item) => item.name === name && item.subject === subject);
    return entry && entry.value !== null ? base({ value: entry.value, unit: entry.unit }) : null;
  };
  const nominal = network.conditions.nominalVoltage;
  const un = nominal && "unit" in nominal ? base(nominal) : null;
  const kids = (id: string) =>
    relations("feeds")
      .filter((relation) => relation.from === id)
      .map((relation) => objects.get(relation.to))
      .filter((object): object is ElectricalObject => object !== undefined);
  const phasesOf = (circuit: ElectricalObject): 1 | 3 | null => {
    const quantity = circuit.properties?.phases;
    if (quantity && quantity.value !== null && unitDimension(quantity.unit) === "ratio") {
      const phases = base({ value: quantity.value, unit: quantity.unit });
      return phases === 1 || phases === 3 ? phases : null;
    }
    const list = kids(circuit.id);
    const loadPhases = (object: ElectricalObject) => {
      const p = object.properties?.phases;
      return p && p.value !== null ? base({ value: p.value, unit: p.unit }) : null;
    };
    if (list.some((child) => child.type === "board" || child.type === "busbar" || loadPhases(child) === 3))
      return 3;
    if (list.length && list.every((child) => loadPhases(child) === 1)) return 1;
    return null;
  };
  const cableOf = (circuit: string) => {
    const routes = relations("routes").filter((relation) => relation.to === circuit);
    return routes.length === 1 ? objects.get(routes[0]?.from ?? "") : undefined;
  };

  // ---- catalog look-ups through the PWR-01 selection rules -----------------------------------------------------
  const one = (item: CatalogItem, requirement: Parameters<typeof selectItems>[2]["requirements"][number]) =>
    selectItems({ ...catalog, items: [item] }, stamp, { requirements: [requirement] }).items[0]
      ?.criteria[0] as CatalogCriterion;
  type Conditions = Record<string, { value: number; unit: string } | { text: string }>;
  /** The most conservative cited value: the smallest (`low`) or the largest (`high`) covering the conditions. */
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
        ? `no cited ${name} covers the requested conditions (cited for ${(criterion.available ?? [])
            .map((entry) =>
              Object.entries(entry)
                .map(
                  ([key, condition]) =>
                    `${key} ${"text" in condition ? condition.text : `${condition.value} ${condition.unit}`}`,
                )
                .join(", "),
            )
            .slice(0, 6)
            .join("; ")})`
        : `only extracted (unconfirmed) ${name}`;
  const toVerdict = (criterion: CatalogCriterion): Verdict => criterion.verdict;
  const sentence = (text: string) => `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;

  // ---- per circuit and candidate ------------------------------------------------------------------------------
  const voltageOf = new Map<string, Num>();
  for (const entry of request.circuits) {
    const circuit = objects.get(entry.circuit) as ElectricalObject;
    touch(circuit);
    if (entry.protection) {
      touch(objects.get(entry.protection));
      touch(relations("protects").find((r) => r.from === entry.protection && r.to === circuit.id));
    }
    const phases = phasesOf(circuit);
    const u = un === null || phases === null ? null : phases === 3 ? un : un / Math.sqrt(3);
    voltageOf.set(circuit.id, u);
    if (phases === null)
      messages.push(`${label(circuit)}: phases unknown; voltage-dependent criteria are unknown.`);
    if (un === null) messages.push("The network result states no nominal voltage.");
    value("voltage", circuit.id, u, "V");
    const cable = cableOf(circuit.id);
    if (!cable)
      messages.push(`${label(circuit)}: no single cable routes it; Iz and the cable section are unknown.`);
    const ib = stored("designCurrent", circuit.id);
    const ik3 = stored("ik3MaxStart", circuit.id);
    const ik1 = stored("ik1MinEnd", circuit.id);
    const iz = cable ? stored("currentCapacity", cable.id) : null;
    const section = cable ? stored("crossSection", cable.id) : null;
    const k = input.cable.k;
    const withstand = k === null || section === null ? null : k * k * section * section;
    value("thermalWithstand", circuit.id, withstand, "A²s");
    const t = entry.disconnectionTime ?? null;

    for (const id of entry.candidates) {
      const item = items.get(id) as CatalogItem;
      const code = item.orderCode;
      const kind = KINDS[category(item)];
      const own: Criterion[] = [];
      const push = (name: string, title: string, rest: Omit<Criterion, "id" | "title" | "subject">) => {
        const criterion = {
          id: `${name}:${code}`,
          title: `${title} (${code})`,
          subject: circuit.id,
          ...rest,
        };
        own.push(criterion);
        add(criterion);
      };
      if (!kind) {
        push("device-kind", "Protective device kind", {
          verdict: "not-evaluated",
          note: `Family category ${category(item) || "unknown"} is not a fuse link or circuit breaker; not evaluated as protection.`,
        });
        continue;
      }
      const vWanted: Conditions | null = u === null ? null : { voltage: { value: sig(u), unit: "V" } };

      // Rated voltage.
      if (u === null)
        push("rated-voltage", "Rated voltage", { verdict: "unknown", note: "Circuit voltage unknown." });
      else {
        const c = one(item, {
          id: "ue",
          parameter: "ratedVoltage",
          op: ">=",
          value: { value: sig(u), unit: "V" },
          conditions: { currentKind: { text: "AC" } },
        });
        push("rated-voltage", "Rated voltage", {
          verdict: toVerdict(c),
          ...(c.measured && "value" in c.measured
            ? { measured: { value: c.measured.value, unit: c.measured.unit } }
            : {}),
          limit: { value: sig(u), unit: "V" },
          note:
            c.verdict === "unknown"
              ? sentence(why(c, "AC rated voltage"))
              : `Ue >= circuit voltage.${cite(c)}`,
        });
      }

      // Poles (breakers).
      if (kind === "breaker") {
        const text = item.attributes?.poles;
        const poles =
          typeof text === "string" ? Number(/^(\d+)P/.exec(text.trim())?.[1] ?? Number.NaN) : Number.NaN;
        const need = phases === 3 ? 3 : phases === 1 ? 1 : null;
        push("poles", "Protected poles", {
          verdict: Number.isNaN(poles) || need === null ? "unknown" : poles >= need ? "pass" : "fail",
          ...(Number.isNaN(poles) ? {} : { measured: { value: poles, unit: "1" } }),
          ...(need === null ? {} : { limit: { value: need, unit: "1" } }),
          note: Number.isNaN(poles)
            ? "No poles attribute in the catalog."
            : need === null
              ? "Circuit phases unknown."
              : `Attribute poles ${text}; neutral protection and switching follow the normative profile and are not evaluated.`,
        });
      }

      // Breaking capacity of the named kind.
      const capacityName =
        kind === "fuse"
          ? "ratedBreakingCapacity"
          : request.breakingCapacity === "Icu"
            ? "ultimateBreakingCapacity"
            : request.breakingCapacity === "Ics"
              ? "serviceBreakingCapacity"
              : "ratedBreakingCapacity";
      const capacityLabel = kind === "fuse" ? "rated breaking capacity" : request.breakingCapacity;
      const ikLimit = ik3 === null ? undefined : { value: sig(ik3 / 1000), unit: "kA" };
      if (ik3 === null || vWanted === null) {
        push("breaking-capacity", "Breaking capacity", {
          verdict: "unknown",
          note:
            ik3 === null
              ? "Maximum fault current at the origin unknown in the network result."
              : "Circuit voltage unknown.",
        });
        value(`breakingCapacity:${code}`, circuit.id, null, "kA");
      } else {
        let c = one(item, {
          id: "breaking",
          parameter: capacityName,
          op: ">=",
          value: { value: ik3, unit: "A" },
          conditions: vWanted,
        });
        let derived: { value: number; note: string } | null = null;
        if (
          kind === "breaker" &&
          request.breakingCapacity === "Ics" &&
          c.verdict === "unknown" &&
          c.reason === "absent"
        ) {
          const ratio = pick(item, "serviceBreakingCapacityRatio", "%", "low", vWanted);
          const icu = pick(item, "ultimateBreakingCapacity", "A", "low", vWanted);
          if (ratio.value !== null && icu.value !== null) {
            const ics = ratio.value * icu.value;
            derived = {
              value: ics,
              note: `Ics = ${ratio.measured?.value} ${ratio.measured?.unit} x Icu ${icu.measured?.value} ${icu.measured?.unit} = ${sig(ics / 1000)} kA at ${sig(u ?? 0)} V.${cite(ratio.criterion)}`,
            };
          } else c = ratio.value === null ? ratio.criterion : icu.criterion;
        }
        if (derived) {
          push("breaking-capacity", "Breaking capacity", {
            verdict: atLeast(derived.value, ik3) ? "pass" : "fail",
            measured: { value: sig(derived.value / 1000), unit: "kA" },
            ...(ikLimit ? { limit: ikLimit } : {}),
            note: derived.note,
          });
          value(`breakingCapacity:${code}`, circuit.id, derived.value / 1000, "kA");
        } else {
          const measured = c.measured && "value" in c.measured ? c.measured : undefined;
          push("breaking-capacity", "Breaking capacity", {
            verdict: toVerdict(c),
            ...(measured ? { measured: { value: measured.value, unit: measured.unit } } : {}),
            ...(ikLimit ? { limit: ikLimit } : {}),
            note:
              c.verdict === "unknown"
                ? sentence(why(c, `${capacityLabel} (${capacityName})`))
                : `${capacityLabel} at ${sig(u ?? 0)} V against Ik3max at the origin; no other capacity kind is used.${cite(c)}`,
          });
          value(`breakingCapacity:${code}`, circuit.id, measured ? base(measured) / 1000 : null, "kA");
        }
      }

      // Rated current or setting: Ib <= In <= Iz.
      const adjustable = item.parameters.some((parameter) => parameter.name === "settingCurrentMax");
      let inValue: Num = null;
      let inNote = "";
      let rangeFail = false;
      if (adjustable) {
        const low = pick(item, "settingCurrentMin", "A", "high");
        const high = pick(item, "settingCurrentMax", "A", "low");
        if (entry.setting === undefined) inNote = "Adjustable device: no setting given in the request.";
        else if (low.value === null || high.value === null)
          inNote = sentence(why(low.value === null ? low.criterion : high.criterion, "setting range"));
        else {
          const setting = entry.setting;
          const range = `${sig(low.value)}..${sig(high.value)} A`;
          if (!atLeast(setting, low.value) || !atLeast(high.value, setting)) {
            rangeFail = true;
            inNote = `Setting ${sig(setting)} A is outside the cited setting range ${range}.${cite(high.criterion)}`;
          } else {
            inValue = setting;
            inNote = `Setting ${sig(setting)} A inside the cited range ${range}.${cite(high.criterion)}`;
          }
        }
      } else {
        const rated = pick(item, "ratedCurrent", "A", "low");
        inValue = rated.value;
        inNote =
          rated.value === null
            ? sentence(why(rated.criterion, "rated current"))
            : `In ${sig(rated.value)} A.${cite(rated.criterion)}`;
      }
      value(`ratedCurrent:${code}`, circuit.id, inValue, "A");
      {
        let verdict: Verdict = "unknown";
        let note = inNote;
        if (rangeFail) verdict = "fail";
        else if (inValue !== null && (ib === null || iz === null))
          note = `${inNote} ${ib === null ? "Design current Ib" : "Current-carrying capacity Iz"} unknown in the network result.`;
        else if (inValue !== null && ib !== null && iz !== null) {
          verdict = atLeast(inValue, ib) && atLeast(iz, inValue) ? "pass" : "fail";
          note = `${inNote} Ib ${sig(ib)} A <= In <= Iz ${sig(iz)} A.`;
        }
        push("rated-current", "Rated current between Ib and Iz", {
          verdict,
          ...(inValue === null ? {} : { measured: { value: sig(inValue), unit: "A" } }),
          ...(iz === null ? {} : { limit: { value: sig(iz), unit: "A" } }),
          note,
        });
      }

      // Conventional tripping current: I2 <= 1.45 Iz.
      {
        const ratio = pick(item, "conventionalTrippingCurrentRatio", "1", "high");
        const i2 = ratio.value === null || inValue === null ? null : ratio.value * inValue;
        value(`conventionalTrippingCurrent:${code}`, circuit.id, i2, "A");
        push("conventional-tripping", "Conventional tripping current I2 <= 1.45 Iz", {
          verdict: i2 === null || iz === null ? "unknown" : atLeast(1.45 * iz, i2) ? "pass" : "fail",
          ...(i2 === null ? {} : { measured: { value: sig(i2), unit: "A" } }),
          ...(iz === null ? {} : { limit: { value: sig(1.45 * iz), unit: "A" } }),
          note:
            ratio.value === null
              ? sentence(why(ratio.criterion, "conventional tripping ratio"))
              : inValue === null
                ? "In or setting unknown."
                : iz === null
                  ? "Current-carrying capacity Iz unknown in the network result."
                  : `I2 = ${sig(ratio.value)} x ${sig(inValue)} A.${cite(ratio.criterion)}`,
        });
      }

      // Automatic disconnection from cited band points.
      if (t === null) {
        push("disconnection-time", "Automatic disconnection", {
          verdict: "not-evaluated",
          note: "No required disconnection time given (normative profile).",
        });
        value(`disconnectionCurrent:${code}`, circuit.id, null, "A");
      } else {
        const reasons: string[] = [];
        const points: { current: number; exact: boolean; text: string }[] = [];
        const found = findItems({ ...catalog, items: [item] }, {})[0];
        let extracted = 0;
        let offCondition = 0;
        for (const parameter of found?.parameters ?? []) {
          if (parameter.name !== "tripCurrentMax" || parameter.value === null) continue;
          const time = parameter.conditions?.tripTime;
          if (!time || !("unit" in time) || unitDimension(time.unit) !== "time") continue;
          if (Object.keys(parameter.conditions ?? {}).some((key) => key !== "tripTime")) {
            // A point stated for other conditions (another curve, ambient, DC) does not cover this circuit.
            offCondition += 1;
            continue;
          }
          if (parameter.status !== "confirmed") {
            extracted += 1;
            continue;
          }
          const at = base(time);
          if (at > t + EPSILON * Math.max(1, t)) continue;
          points.push({
            current: base({ value: parameter.value, unit: parameter.unit }),
            exact: near(at, t),
            text: `${parameter.value} ${parameter.unit} within ${time.value} ${time.unit} (${parameter.source.title})`,
          });
        }
        if (extracted) reasons.push(`${extracted} extracted band point(s) not used`);
        if (offCondition) reasons.push(`${offCondition} band point(s) stated for other conditions not used`);
        const multiple = pick(item, "magneticTripMultiple", "1", "high");
        const absolute = pick(item, "magneticTripCurrent", "A", "high");
        const im =
          absolute.value ?? (multiple.value !== null && inValue !== null ? multiple.value * inValue : null);
        if (im !== null) {
          const tolerance = pick(item, "magneticTripTolerance", "%", "high");
          const cited = pick(item, "magneticTripTimeMax", "s", "high");
          const time = cited.value ?? assumedInstant;
          if (tolerance.value === null)
            reasons.push(`no cited tolerance of the instantaneous trip current ${sig(im)} A`);
          else if (time === null)
            reasons.push(
              "no operating time of the instantaneous release (cite magneticTripTimeMax or state assumedInstantaneousTripTime)",
            );
          else if (time > t + EPSILON)
            reasons.push(`instantaneous operating time ${sig(time)} s exceeds ${sig(t)} s`);
          else
            points.push({
              current: im * (1 + tolerance.value),
              exact: false,
              text: `instantaneous band upper edge ${sig(im)} A x (1 + ${sig(tolerance.value * 100)} %) within ${sig(time)} s${cited.value === null ? " (assumed time)" : ""}`,
            });
        } else if (multiple.value !== null)
          reasons.push("In or setting unknown for the instantaneous trip multiple");
        else reasons.push("no cited instantaneous trip current");
        const lowest = points.length ? Math.min(...points.map((point) => point.current)) : null;
        const exact = points.filter((point) => point.exact);
        const exactLowest = exact.length ? Math.min(...exact.map((point) => point.current)) : null;
        value(`disconnectionCurrent:${code}`, circuit.id, lowest, "A");
        let verdict: Verdict = "unknown";
        let limit: Num = lowest;
        let note: string;
        if (ik1 === null)
          note =
            "No minimum line-to-protective-conductor fault current in the network result (earthing, vector group or data).";
        else if (lowest !== null && atLeast(ik1, lowest)) {
          verdict = "pass";
          note = `Ik1min reaches ${points.find((point) => point.current === lowest)?.text}.`;
        } else if (exactLowest !== null) {
          verdict = "fail";
          limit = exactLowest;
          note = `Ik1min stays below the band point at ${sig(t)} s: ${exact.find((point) => point.current === exactLowest)?.text}.`;
        } else
          note = `Not established within ${sig(t)} s: ${
            [
              ...(lowest !== null
                ? [`Ik1min below the lowest known point ${sig(lowest)} A and no point at exactly ${sig(t)} s`]
                : []),
              ...reasons,
            ].join("; ") || "no band point"
          }.`;
        push("disconnection-time", "Automatic disconnection", {
          verdict,
          ...(ik1 === null ? {} : { measured: { value: sig(ik1), unit: "A" } }),
          ...(limit === null ? {} : { limit: { value: sig(limit), unit: "A" } }),
          note: `${note} Required ${sig(t)} s.`,
        });
      }

      // Let-through energy against k²S².
      if (withstand === null || ik3 === null || vWanted === null) {
        push("let-through-energy", "Let-through energy I2t <= k²S²", {
          verdict: "unknown",
          note:
            k === null
              ? `k unknown: ${input.cable.text}.`
              : section === null
                ? "Cable cross-section unknown in the network result."
                : ik3 === null
                  ? "Maximum fault current at the origin unknown."
                  : "Circuit voltage unknown.",
        });
        value(`letThroughEnergy:${code}`, circuit.id, null, "A²s");
      } else {
        const c = one(item, {
          id: "i2t",
          parameter: "letThroughEnergy",
          op: "<=",
          value: { value: withstand, unit: "A²s" },
          conditions: { prospectiveCurrent: { value: ik3, unit: "A" }, ...vWanted },
        });
        const measured = c.measured && "value" in c.measured ? c.measured : undefined;
        value(`letThroughEnergy:${code}`, circuit.id, measured ? base(measured) : null, "A²s");
        push("let-through-energy", "Let-through energy I2t <= k²S²", {
          verdict: toVerdict(c),
          ...(measured ? { measured: { value: measured.value, unit: measured.unit } } : {}),
          limit: { value: sig(withstand), unit: "A²s" },
          note:
            c.verdict === "unknown"
              ? sentence(why(c, `let-through energy at ${sig(ik3 / 1000)} kA`))
              : `k ${k}, S ${section} mm².${cite(c)}`,
        });
      }

      // Selection summary.
      const failed = own
        .filter((criterion) => criterion.verdict === "fail")
        .map((criterion) => criterion.id.split(":")[0]);
      const open = own.filter(
        (criterion) => criterion.verdict === "unknown" || criterion.verdict === "not-evaluated",
      );
      add({
        id: `selection:${code}`,
        title: `Selection (${code})`,
        subject: circuit.id,
        verdict: failed.length ? "fail" : open.length ? "unknown" : "pass",
        note: failed.length
          ? `Eliminated: ${failed.join(", ")}.`
          : open.length
            ? `Not established: ${open.map((criterion) => criterion.id.split(":")[0]).join(", ")}.`
            : "Every criterion passes.",
      });
    }

    // RCD per circuit.
    const fed = kids(circuit.id).filter((object) => object.type === "load" || object.type === "motor");
    for (const object of fed) touch(object);
    for (const relation of relations("feeds").filter((r) => r.from === circuit.id)) touch(relation);
    const allowed = [
      ...new Set(
        fed.flatMap((object) => {
          const text = object.attributes?.rcdTypes;
          return typeof text === "string"
            ? text
                .split(/[,;\s]+/)
                .filter(Boolean)
                .map((type) => type.toUpperCase())
            : [];
        }),
      ),
    ];
    const rcd = entry.rcd ? (items.get(entry.rcd) as CatalogItem) : undefined;
    if (allowed.length || rcd) {
      const rcdType = rcd?.attributes?.rcdType;
      let verdict: Verdict;
      let note: string;
      if (!allowed.length) {
        verdict = "not-evaluated";
        note = "The fed equipment states no allowed RCD types (attribute rcdTypes).";
      } else if (!rcd) {
        verdict = "fail";
        note = `The equipment allows RCD types ${allowed.join(", ")}; no RCD is named.`;
      } else if (typeof rcdType !== "string") {
        verdict = "unknown";
        note = `${rcd.orderCode} has no rcdType attribute.`;
      } else {
        verdict = allowed.includes(rcdType.trim().toUpperCase()) ? "pass" : "fail";
        note = `${rcd.orderCode} type ${rcdType}; the equipment allows ${allowed.join(", ")}.`;
      }
      add({ id: "rcd-type", title: "RCD type for the equipment", subject: circuit.id, verdict, note });
    }
    if (entry.residualCurrentMax !== undefined) {
      const limit = { value: entry.residualCurrentMax, unit: "mA" };
      if (!rcd)
        add({
          id: "rcd-sensitivity",
          title: "RCD sensitivity",
          subject: circuit.id,
          verdict: "fail",
          limit,
          note: "No RCD is named.",
        });
      else {
        const c = one(rcd, {
          id: "idn",
          parameter: "residualOperatingCurrent",
          op: "<=",
          value: { value: limit.value, unit: limit.unit },
        });
        const measured = c.measured && "value" in c.measured ? c.measured : undefined;
        add({
          id: "rcd-sensitivity",
          title: "RCD sensitivity",
          subject: circuit.id,
          verdict: toVerdict(c),
          ...(measured ? { measured: { value: measured.value, unit: measured.unit } } : {}),
          limit,
          note:
            c.verdict === "unknown"
              ? sentence(why(c, "rated residual operating current"))
              : `IΔn of ${rcd.orderCode}.${cite(c)}`,
        });
      }
    }
  }

  // ---- coordination tables --------------------------------------------------------------------------------------
  const kindOfTable = new Map(catalog.coordination.map((table) => [table.id, fold(table.kind)]));
  const lookup = (
    itemIds: string[],
    wanted: Conditions,
    tableKind: string,
  ): { applicable: ReturnType<typeof coordinationFor>["applicable"]; reasons: string[] } => {
    const answer = coordinationFor(catalog, stamp, itemIds, wanted);
    const applicable = answer.applicable.filter((entry) => fold(entry.kind) === tableKind);
    const reasons = answer.notApplicable
      .filter((entry) => kindOfTable.get(entry.table) === tableKind)
      .map((entry) => `${entry.table}: ${entry.reason}${entry.condition ? ` ${entry.condition}` : ""}`);
    return { applicable, reasons };
  };
  const notEvaluated = (what: string, reasons: string[]) =>
    `No ${what} table of catalog ${catalog.id} applies${reasons.length ? ` (${[...new Set(reasons)].slice(0, 8).join("; ")})` : ""}; coordination is never derived from curves.`;
  for (const pair of request.coordination ?? []) {
    const up = items.get(pair.upstreamItem) as CatalogItem;
    const down = items.get(pair.downstreamItem) as CatalogItem;
    const id = `${pair.kind}:${up.orderCode}/${down.orderCode}`;
    const title = `${pair.kind === "selectivity" ? "Selectivity" : "Cascading"} ${up.orderCode} / ${down.orderCode}`;
    const u = voltageOf.get(pair.downstream) ?? null;
    const ik = stored("ik3MaxStart", pair.downstream);
    const ikLimit = ik === null ? undefined : { value: sig(ik / 1000), unit: "kA" };
    const parameterName = pair.kind === "selectivity" ? "selectivityLimit" : "enhancedBreakingCapacity";
    if (u === null) {
      add({
        id,
        title,
        subject: pair.downstream,
        verdict: "unknown",
        note: "Downstream circuit voltage unknown.",
      });
      continue;
    }
    const { applicable, reasons } = lookup(
      [up.id, down.id],
      { voltage: { value: sig(u), unit: "V" } },
      pair.kind,
    );
    // Selectivity and cascading tables are directional: an entry applies only as [upstream, downstream].
    const directed = applicable.flatMap((entry) => {
      const rows = (catalog.coordination.find((table) => table.id === entry.table)?.entries ?? []).filter(
        (row) => row.items.length === 2 && row.items[0] === up.id && row.items[1] === down.id,
      );
      if (!rows.length) reasons.push(`${entry.table}: entry for the reverse direction only`);
      return rows.length ? [{ entry, rows }] : [];
    });
    if (!directed.length) {
      add({
        id,
        title,
        subject: pair.downstream,
        verdict: "not-evaluated",
        note: notEvaluated(pair.kind, reasons),
      });
      continue;
    }
    const sourceOf = new Map(catalog.sources.map((source) => [source.id, source]));
    const values = directed.flatMap(({ rows }) =>
      rows.flatMap((row) =>
        row.parameters
          .filter((parameter) => parameter.name === parameterName)
          .map((parameter) => ({
            ...parameter,
            source: {
              title: sourceOf.get(parameter.source.id)?.title ?? parameter.source.id,
              publisher: sourceOf.get(parameter.source.id)?.publisher,
              revision: sourceOf.get(parameter.source.id)?.revision,
            },
          })),
      ),
    );
    const confirmed = values.filter(
      (parameter) => parameter.status === "confirmed" && parameter.value !== null,
    );
    const unevaluated = [...new Set(directed.flatMap(({ entry }) => entry.unevaluated ?? []))];
    if (!confirmed.length || ik === null || unevaluated.length) {
      add({
        id,
        title,
        subject: pair.downstream,
        verdict: "unknown",
        ...(ikLimit ? { limit: ikLimit } : {}),
        note: !confirmed.length
          ? `The applicable table gives no confirmed ${parameterName}.`
          : ik === null
            ? "Downstream maximum fault current unknown."
            : `The table does not state ${unevaluated.join(", ")}.`,
      });
      continue;
    }
    const decisive = confirmed.reduce((best, next) =>
      base({ value: next.value as number, unit: next.unit }) <
      base({ value: best.value as number, unit: best.unit })
        ? next
        : best,
    );
    const limitValue = base({ value: decisive.value as number, unit: decisive.unit });
    sources.add(
      `${decisive.source.publisher ?? ""}: ${decisive.source.title}, ${decisive.source.revision ?? ""}`.slice(
        0,
        200,
      ),
    );
    add({
      id,
      title,
      subject: pair.downstream,
      verdict: atLeast(limitValue, ik) ? "pass" : "fail",
      measured: { value: decisive.value as number, unit: decisive.unit },
      ...(ikLimit ? { limit: ikLimit } : {}),
      note: `${parameterName} from table ${directed[0]?.entry.table} (${decisive.source.title}) for ${up.orderCode} upstream of ${down.orderCode}, against Ik3max at the downstream origin.`,
    });
  }
  for (const starter of request.starters ?? []) {
    const protection = items.get(starter.protection) as CatalogItem;
    const contactor = items.get(starter.contactor) as CatalogItem;
    const kind = KINDS[category(protection)];
    const tableKind = `${kind === "fuse" ? "fuse" : "breaker"} coordination type ${starter.type}`;
    const id = `starter-type-${starter.type}:${protection.orderCode}/${contactor.orderCode}`;
    const title = `Starter coordination type ${starter.type} ${protection.orderCode} / ${contactor.orderCode}`;
    const u = voltageOf.get(starter.circuit) ?? null;
    const ik = stored("ik3MaxStart", starter.circuit);
    if (!kind || u === null || ik === null) {
      add({
        id,
        title,
        subject: starter.circuit,
        verdict: kind ? "unknown" : "not-evaluated",
        note: !kind
          ? `${protection.orderCode} is not a fuse link or circuit breaker.`
          : u === null
            ? "Circuit voltage unknown."
            : "Maximum fault current unknown.",
      });
      continue;
    }
    const { applicable, reasons } = lookup(
      kind === "fuse" ? [contactor.id] : [protection.id, contactor.id],
      {
        voltage: { value: sig(u), unit: "V" },
        circuit: { text: "power" },
        prospectiveCurrent: { value: ik, unit: "A" },
      },
      tableKind,
    );
    if (!applicable.length) {
      add({
        id,
        title,
        subject: starter.circuit,
        verdict: "not-evaluated",
        note: notEvaluated(tableKind, reasons),
      });
      continue;
    }
    const unevaluated = [...new Set(applicable.flatMap((entry) => entry.unevaluated ?? []))];
    const open = unevaluated.length
      ? ` The table does not state ${unevaluated.join(", ")}: the combination is not established at Ik3max ${sig(ik / 1000)} kA.`
      : "";
    if (kind === "breaker") {
      add({
        id,
        title,
        subject: starter.circuit,
        verdict: unevaluated.length ? "unknown" : "pass",
        note: `Tested combination in table ${applicable[0]?.table}.${open}`,
      });
      continue;
    }
    const fuseClass = protection.attributes?.fuseClass;
    const ratings = applicable
      .flatMap((entry) => entry.parameters)
      .filter((parameter) => {
        const wanted = parameter.conditions?.fuseClass;
        return (
          parameter.name === "fuseRating" &&
          parameter.status === "confirmed" &&
          parameter.value !== null &&
          typeof fuseClass === "string" &&
          wanted !== undefined &&
          "text" in wanted &&
          fold(wanted.text) === fold(fuseClass)
        );
      });
    const rated = pick(protection, "ratedCurrent", "A", "high");
    if (!ratings.length || rated.value === null) {
      add({
        id,
        title,
        subject: starter.circuit,
        verdict: "unknown",
        note: !ratings.length
          ? `No confirmed fuseRating for fuse class ${typeof fuseClass === "string" ? fuseClass : "unknown"} in the applicable table.`
          : "Rated current of the fuse unknown.",
      });
      continue;
    }
    const decisive = ratings.reduce((best, next) =>
      base({ value: next.value as number, unit: next.unit }) <
      base({ value: best.value as number, unit: best.unit })
        ? next
        : best,
    );
    const ratingValue = base({ value: decisive.value as number, unit: decisive.unit });
    sources.add(
      `${decisive.source.publisher ?? ""}: ${decisive.source.title}, ${decisive.source.revision ?? ""}`.slice(
        0,
        200,
      ),
    );
    const within = atLeast(ratingValue, rated.value);
    add({
      id,
      title,
      subject: starter.circuit,
      verdict: !within ? "fail" : unevaluated.length ? "unknown" : "pass",
      measured: { value: sig(rated.value), unit: "A" },
      limit: { value: decisive.value as number, unit: decisive.unit },
      note: `${fuseClass} ${sig(rated.value)} A against the maximum ${fuseClass} rating of table ${applicable[0]?.table} (${decisive.source.title}).${within ? open : ""}`,
    });
  }

  // ---- finish ---------------------------------------------------------------------------------------------------
  let status: ElectricalResult["status"] = "completed";
  for (const [list, name] of [
    [intermediate, "intermediate values"],
    [criteria, "criteria"],
  ] as const)
    if (list.length > electricalLimits.resultList) {
      messages.unshift(
        `${list.length - electricalLimits.resultList} ${name} were left out (limit ${electricalLimits.resultList}); evaluate fewer candidates.`,
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
    producer: {
      plugin: "protection-coordination",
      operation: "protection",
      engine: { ...PROTECTION_ENGINE },
    },
    method: {
      ...PROTECTION_METHOD,
      reference:
        `IEC 60364-4-41/-4-43 checks as implemented; catalog ${stamp.id} ${stamp.version}; network run ${network.runId}`.slice(
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
      .map(([id, snapshot]) => ({ id, snapshot: snapshot as never })),
    assumptions: assumptions.map((text) => text.slice(0, 1000)),
    sources: [...sources].slice(0, electricalLimits.resultList),
    conditions,
    intermediate,
    criteria,
    limits,
    messages: messages.map((text) => text.slice(0, 1000)),
  };
}
