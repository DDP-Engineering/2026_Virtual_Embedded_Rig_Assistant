// Pure services of the electrical model (spec REQ-DATA-06c0bd54): strict reading, semantic validation, canonical
// serialization, entity hashes and completeness issues. Nothing here touches the filesystem.
import { createHash } from "node:crypto";
import {
  type ElectricalModel,
  type ElectricalObjectType,
  type ElectricalRelationType,
  electricalModelSchema,
} from "@vera/shared";
import type { z } from "zod";
import { unitProblem } from "./units.js";

export interface ModelProblem {
  path: string;
  message: string;
}
export interface ModelIssue {
  code: "unfed" | "unprotected";
  id: string;
  ref?: string;
  message: string;
}
const PROBLEM_LIMIT = 20;
const ANY: readonly ElectricalObjectType[] = [
  "source",
  "board",
  "busbar",
  "circuit",
  "cable",
  "load",
  "motor",
  "protection",
  "device",
  "terminal",
  "sensor",
  "actuator",
  "io",
  "tag",
  "document",
];
interface RelationRule {
  from: readonly ElectricalObjectType[];
  to: readonly ElectricalObjectType[];
  /** At most this many relations of the type end at one object. */
  maxIn?: number;
  /** At most this many relations of the type start at one object. */
  maxOut?: number;
}
/** Endpoint types and cardinalities per relation type (spec "Relations"). */
export const relationRules: Readonly<Record<ElectricalRelationType, RelationRule>> = {
  feeds: {
    from: ["source", "board", "busbar", "circuit"],
    to: ["board", "busbar", "circuit", "load", "motor"],
    maxIn: 1,
  },
  contains: {
    from: ["board", "device"],
    to: ["busbar", "circuit", "protection", "device", "terminal", "io"],
    maxIn: 1,
  },
  protects: { from: ["protection"], to: ["circuit", "cable", "load", "motor"] },
  routes: { from: ["cable"], to: ["circuit"], maxOut: 1 },
  controls: { from: ["device", "io"], to: ["motor", "load", "actuator", "device"] },
  signals: { from: ["sensor", "actuator", "device", "motor", "protection"], to: ["io"], maxIn: 1 },
  "tag-of": { from: ["tag"], to: ["io", "device", "sensor", "actuator", "motor", "load"], maxOut: 1 },
  connects: {
    from: ["cable", "terminal"],
    to: ["terminal", "device", "motor", "load", "sensor", "actuator", "io", "protection", "busbar"],
  },
  documents: { from: ["document"], to: ANY },
};

/** A JSON path such as `objects[3].properties.ratedPower.unit`. */
export function jsonPath(path: readonly PropertyKey[]): string {
  let out = "";
  for (const part of path)
    out += typeof part === "number" ? `[${part}]` : out ? `.${String(part)}` : String(part);
  return out || "(document)";
}
function zodProblems(error: z.ZodError): ModelProblem[] {
  return error.issues
    .slice(0, PROBLEM_LIMIT)
    .map((issue) => ({ path: jsonPath(issue.path), message: issue.message }));
}

/** Semantic rules on a document that already has the schema's shape. */
function semanticProblems(model: ElectricalModel): ModelProblem[] {
  const problems: ModelProblem[] = [];
  const add = (path: string, message: string) => {
    if (problems.length < PROBLEM_LIMIT) problems.push({ path, message });
  };
  const ids = new Map<string, string>();
  const claim = (id: string, path: string) => {
    if (ids.has(id)) add(`${path}.id`, `ID ${id} is used more than once (also at ${ids.get(id)})`);
    else ids.set(id, path);
  };
  claim(model.project.id, "project");
  for (const [list, name] of [
    [model.sources, "sources"],
    [model.objects, "objects"],
    [model.relations, "relations"],
  ] as const)
    for (const [index, entity] of list.entries()) claim(entity.id, `${name}[${index}]`);

  const sources = new Set(model.sources.map((source) => source.id));
  const objects = new Map(model.objects.map((object) => [object.id, object]));
  const refs = new Map<string, string>();
  model.objects.forEach((object, index) => {
    const path = `objects[${index}]`;
    if (object.ref !== undefined) {
      if (refs.has(object.ref))
        add(
          `${path}.ref`,
          `reference ${object.ref} is used more than once (also at ${refs.get(object.ref)})`,
        );
      else refs.set(object.ref, path);
      if (ids.has(object.ref)) add(`${path}.ref`, `reference ${object.ref} equals an entity ID`);
    }
    for (const [name, quantity] of Object.entries(object.properties ?? {})) {
      const at = `${path}.properties.${name}`;
      const unit = unitProblem(quantity.unit, name);
      if (unit) add(`${at}.unit`, unit);
      for (const [condition, value] of Object.entries(quantity.conditions ?? {})) {
        const problem = "unit" in value ? unitProblem(value.unit) : undefined;
        if (problem) add(`${at}.conditions.${condition}.unit`, problem);
      }
      if (quantity.source && !sources.has(quantity.source.id))
        add(`${at}.source.id`, `source ${quantity.source.id} does not exist`);
    }
  });

  const seen = new Set<string>();
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, number>();
  const feeds = new Map<string, string[]>();
  for (const [index, relation] of model.relations.entries()) {
    const path = `relations[${index}]`;
    const rule = relationRules[relation.type];
    const from = objects.get(relation.from);
    const to = objects.get(relation.to);
    for (const [end, object] of [
      ["from", from],
      ["to", to],
    ] as const)
      if (!object)
        add(
          `${path}.${end}`,
          ids.has(relation[end])
            ? `${relation[end]} is not an object (relation ${relation.id})`
            : `object ${relation[end]} does not exist (relation ${relation.id})`,
        );
    if (!from || !to) continue;
    if (relation.from === relation.to) {
      add(path, `relation ${relation.id} joins ${relation.from} to itself`);
      continue;
    }
    if (!rule.from.includes(from.type) || !rule.to.includes(to.type)) {
      add(path, `relation ${relation.id}: ${relation.type} does not join a ${from.type} to a ${to.type}`);
      continue;
    }
    const key = `${relation.type}\u0000${relation.from}\u0000${relation.to}`;
    if (seen.has(key)) {
      add(path, `relation ${relation.id} repeats ${relation.type} ${relation.from} -> ${relation.to}`);
      continue;
    }
    seen.add(key);
    const inKey = `${relation.type}\u0000${relation.to}`;
    const outKey = `${relation.type}\u0000${relation.from}`;
    incoming.set(inKey, (incoming.get(inKey) ?? 0) + 1);
    outgoing.set(outKey, (outgoing.get(outKey) ?? 0) + 1);
    if (rule.maxIn !== undefined && (incoming.get(inKey) ?? 0) > rule.maxIn)
      add(
        path,
        `relation ${relation.id}: ${relation.to} already has ${rule.maxIn} incoming ${relation.type}`,
      );
    if (rule.maxOut !== undefined && (outgoing.get(outKey) ?? 0) > rule.maxOut)
      add(
        path,
        `relation ${relation.id}: ${relation.from} already has ${rule.maxOut} outgoing ${relation.type}`,
      );
    if (relation.type === "feeds")
      feeds.set(relation.from, [...(feeds.get(relation.from) ?? []), relation.to]);
  }

  // A feeds cycle: depth-first search with an on-stack mark.
  const state = new Map<string, 1 | 2>();
  const visit = (id: string, trail: string[]): string[] | undefined => {
    state.set(id, 1);
    for (const next of feeds.get(id) ?? []) {
      if (state.get(next) === 1) return [...trail, id, next];
      if (!state.has(next)) {
        const cycle = visit(next, [...trail, id]);
        if (cycle) return cycle;
      }
    }
    state.set(id, 2);
    return undefined;
  };
  for (const id of feeds.keys()) {
    if (state.has(id)) continue;
    const cycle = visit(id, []);
    if (cycle) {
      const start = cycle.indexOf(cycle[cycle.length - 1] as string);
      add("relations", `feeds relations form a cycle: ${cycle.slice(start).join(" -> ")}`);
      break;
    }
  }
  return problems;
}

/** The model, or the problems that make it invalid (at most 20, each with its JSON path). */
export function checkModel(raw: unknown): { model: ElectricalModel } | { problems: ModelProblem[] } {
  const parsed = electricalModelSchema.safeParse(raw);
  if (!parsed.success) return { problems: zodProblems(parsed.error) };
  const problems = semanticProblems(parsed.data);
  return problems.length ? { problems } : { model: parsed.data };
}
export function problemsText(label: string, problems: readonly ModelProblem[]): string {
  return [`Invalid ${label}:`, ...problems.map((problem) => `${problem.path}: ${problem.message}`)].join(
    "\n",
  );
}
/** Strictly reads a model document from JSON text; throws `Invalid <label>:` with its problems. */
export function parseModel(text: string, label = "electrical model"): ElectricalModel {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error(problemsText(label, [{ path: "(document)", message: "is not JSON" }]));
  }
  const checked = checkModel(raw);
  if ("problems" in checked) throw Error(problemsText(label, checked.problems));
  return checked.model;
}

function sortedRecord<T>(record: Record<string, T> | undefined, map: (value: T) => T = (value) => value) {
  if (record === undefined) return undefined;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, map(record[key] as T)]),
  );
}
/** Canonical bytes: schema key order, record keys sorted, two-space indentation and a final newline. */
export function serializeModel(model: ElectricalModel): string {
  const parsed = electricalModelSchema.parse(model);
  const canonical = {
    ...parsed,
    objects: parsed.objects.map((object) => {
      const out = { ...object };
      if (object.attributes) out.attributes = sortedRecord(object.attributes);
      if (object.properties)
        out.properties = sortedRecord(object.properties, (quantity) =>
          quantity.conditions ? { ...quantity, conditions: sortedRecord(quantity.conditions) } : quantity,
        );
      return out;
    }),
  };
  return `${JSON.stringify(canonical, null, 2)}\n`;
}

/** JSON with every object's keys sorted and no whitespace: the input of entity hashes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value !== null && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}
export function entityHash(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
/** Every entity of the model by ID: the project, sources, objects and relations. */
export function modelEntities(model: ElectricalModel): Map<string, unknown> {
  return new Map<string, unknown>([
    [model.project.id, model.project],
    ...model.sources.map((source) => [source.id, source] as const),
    ...model.objects.map((object) => [object.id, object] as const),
    ...model.relations.map((relation) => [relation.id, relation] as const),
  ]);
}

/** Valid but incomplete parts: unfed boards, circuits, loads and motors, and unprotected circuits and motors. */
export function modelIssues(model: ElectricalModel): ModelIssue[] {
  const fed = new Map<string, string>();
  const protectedIds = new Set<string>();
  for (const relation of model.relations) {
    if (relation.type === "feeds") fed.set(relation.to, relation.from);
    if (relation.type === "protects") protectedIds.add(relation.to);
  }
  const types = new Map(model.objects.map((object) => [object.id, object.type]));
  const issues: ModelIssue[] = [];
  for (const object of model.objects) {
    const ref = object.ref !== undefined ? { ref: object.ref } : {};
    const label = object.ref ?? object.id;
    if (["board", "circuit", "load", "motor"].includes(object.type) && !fed.has(object.id))
      issues.push({ code: "unfed", id: object.id, ...ref, message: `${label} has no feeds relation` });
    const feeder = fed.get(object.id);
    const viaCircuit = feeder !== undefined && types.get(feeder) === "circuit" && protectedIds.has(feeder);
    if (
      (object.type === "circuit" && !protectedIds.has(object.id)) ||
      (object.type === "motor" && !protectedIds.has(object.id) && !viaCircuit)
    )
      issues.push({ code: "unprotected", id: object.id, ...ref, message: `${label} has no protection` });
  }
  return issues;
}
