// Pure services of the industrial catalog (spec REQ-DATA-d7e27def): strict reading, item lookup, selection by firm
// requirements and coordination lookup. Nothing here touches the filesystem or the network; the tool in
// catalog-tool.ts reads the files and passes their stamp.
import {
  type CatalogItem,
  type CatalogParameter,
  type CatalogRequirement,
  type CatalogSource,
  catalogRequirementSchema,
  type ElectricalCondition,
  type IndustrialCatalog,
  industrialCatalogSchema,
} from "@vera/shared";
import { jsonPath, type ModelProblem, problemsText } from "./model.js";
import { knownProperties, toBaseUnit, unitDimension, unitProblem } from "./units.js";

export type CatalogProblem = ModelProblem;
/** What a selection or coordination answer cites as its catalog; a result's `catalog` takes {id, version}. */
export interface CatalogStamp {
  id: string;
  version: string;
  sha256: string;
  path: string;
}
type Conditions = Record<string, ElectricalCondition>;

const PROBLEM_LIMIT = 20;
const LABEL = "industrial catalog";
const SECRET_NAME = /key|token|secret|passw|auth|sig|credential|session|sid|jwt|bearer|cookie/i;
const EPSILON = 1e-9;

/** Why a link may not be stored in a catalog: not http(s), user information or a credential-like query. */
export function linkProblem(uri: string): string | undefined {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return "is not a link";
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return "must be an https or http link";
  if (url.username || url.password) return "must not carry user information";
  for (const name of url.searchParams.keys())
    if (SECRET_NAME.test(name)) return `must not carry the query parameter ${name}`;
  for (const name of new URLSearchParams(url.hash.slice(1)).keys())
    if (SECRET_NAME.test(name)) return `must not carry the fragment parameter ${name}`;
  return undefined;
}

/** The dimension a condition key implies: `voltageMax` and `voltage` are voltages. */
function conditionProperty(key: string): string | undefined {
  if (knownProperties[key] !== undefined) return key;
  const base = key.replace(/(Min|Max)$/, "");
  return knownProperties[base] !== undefined ? base : undefined;
}

function semanticProblems(catalog: IndustrialCatalog, fileId: string | undefined): CatalogProblem[] {
  const problems: CatalogProblem[] = [];
  const add = (path: string, message: string) => {
    if (problems.length < PROBLEM_LIMIT) problems.push({ path, message });
  };
  if (fileId !== undefined && catalog.id !== fileId)
    add("id", `the catalog id ${catalog.id} differs from the file name ${fileId}`);
  const ids = new Map<string, string>([[catalog.id, "id"]]);
  const claim = (id: string, path: string) => {
    if (ids.has(id)) add(`${path}.id`, `ID ${id} is used more than once (also at ${ids.get(id)})`);
    else ids.set(id, path);
  };
  for (const [list, name] of [
    [catalog.sources, "sources"],
    [catalog.families, "families"],
    [catalog.items, "items"],
    [catalog.coordination, "coordination"],
  ] as const)
    for (const [index, entity] of list.entries()) claim(entity.id, `${name}[${index}]`);

  const sources = new Set(catalog.sources.map((source) => source.id));
  const families = new Map(catalog.families.map((family) => [family.id, family]));
  const items = new Set(catalog.items.map((item) => item.id));
  const link = (uri: string | undefined, path: string) => {
    const problem = uri === undefined ? undefined : linkProblem(uri);
    if (problem) add(path, problem);
  };
  const conditions = (record: Conditions | undefined, path: string) => {
    for (const [key, condition] of Object.entries(record ?? {}))
      if ("unit" in condition) {
        const problem = unitProblem(condition.unit, conditionProperty(key));
        if (problem) add(`${path}.${key}.unit`, problem);
      }
  };
  const parameter = (value: CatalogParameter, path: string) => {
    const problem = unitProblem(value.unit, value.name);
    if (problem) add(`${path}.unit`, problem);
    if (!sources.has(value.source.id)) add(`${path}.source.id`, `source ${value.source.id} does not exist`);
    conditions(value.conditions, `${path}.conditions`);
  };
  const item = (id: string, path: string) => {
    if (!items.has(id)) add(path, `item ${id} does not exist`);
  };

  for (const [index, source] of catalog.sources.entries()) link(source.uri, `sources[${index}].uri`);
  const codes = new Map<string, string>();
  catalog.items.forEach((entry, index) => {
    const path = `items[${index}]`;
    const family = families.get(entry.family);
    if (!family) add(`${path}.family`, `family ${entry.family} does not exist`);
    else {
      const code = `${family.manufacturer} ${entry.orderCode}`;
      if (codes.has(code))
        add(`${path}.orderCode`, `${code} is listed more than once (also at ${codes.get(code)})`);
      else codes.set(code, path);
    }
    for (const [at, value] of entry.parameters.entries()) parameter(value, `${path}.parameters[${at}]`);
    entry.accessories?.forEach((accessory, at) => {
      if (accessory.item === entry.id)
        add(`${path}.accessories[${at}].item`, "an item is not its own accessory");
      else item(accessory.item, `${path}.accessories[${at}].item`);
    });
    for (const [at, distributor] of (entry.distributors ?? []).entries())
      link(distributor.uri, `${path}.distributors[${at}].uri`);
  });
  catalog.coordination.forEach((table, index) => {
    const path = `coordination[${index}]`;
    conditions(table.conditions, `${path}.conditions`);
    table.entries.forEach((entry, at) => {
      const where = `${path}.entries[${at}]`;
      if (new Set(entry.items).size !== entry.items.length) add(`${where}.items`, "an item is named twice");
      for (const [n, id] of entry.items.entries()) item(id, `${where}.items[${n}]`);
      for (const [n, value] of entry.parameters.entries()) parameter(value, `${where}.parameters[${n}]`);
    });
  });
  return problems;
}

/** Checks a parsed document; `fileId` is the file name without `.json` and must equal the catalog id. */
export function checkCatalog(
  raw: unknown,
  fileId?: string,
): { catalog: IndustrialCatalog } | { problems: CatalogProblem[] } {
  const parsed = industrialCatalogSchema.safeParse(raw);
  if (!parsed.success)
    return {
      problems: parsed.error.issues
        .slice(0, PROBLEM_LIMIT)
        .map((issue) => ({ path: jsonPath(issue.path), message: issue.message })),
    };
  const problems = semanticProblems(parsed.data, fileId);
  return problems.length > 0 ? { problems } : { catalog: parsed.data };
}

/** Strictly reads a catalog from JSON text; throws `Invalid industrial catalog:` with its problems. */
export function parseCatalog(text: string, fileId?: string): IndustrialCatalog {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error(problemsText(LABEL, [{ path: "(document)", message: "is not JSON" }]));
  }
  const checked = checkCatalog(raw, fileId);
  if ("problems" in checked) throw Error(problemsText(LABEL, checked.problems));
  return checked.catalog;
}

const fold = (text: string) => text.trim().replace(/\s+/g, " ").toLowerCase();
const compareText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

export interface CatalogCitedValue {
  value: number | null;
  unit: string;
  conditions?: Conditions;
  status: CatalogParameter["status"];
  source: CatalogSource & { page?: string; table?: string };
}
function cite(catalog: IndustrialCatalog, parameter: CatalogParameter): CatalogCitedValue {
  const source = catalog.sources.find((entry) => entry.id === parameter.source.id) as CatalogSource;
  return {
    value: parameter.value,
    unit: parameter.unit,
    ...(parameter.conditions ? { conditions: parameter.conditions } : {}),
    status: parameter.status,
    source: {
      ...source,
      ...(parameter.source.page ? { page: parameter.source.page } : {}),
      ...(parameter.source.table ? { table: parameter.source.table } : {}),
    },
  };
}

interface ItemHeader {
  id: string;
  orderCode: string;
  manufacturer: string;
  family: string;
  category: string;
  name?: string;
  variant?: { base: string; label: string };
  accessories: { item: string; orderCode: string; role: string; note?: string }[];
  distributors: NonNullable<CatalogItem["distributors"]>;
}
function header(catalog: IndustrialCatalog, item: CatalogItem): ItemHeader {
  const family = catalog.families.find((entry) => entry.id === item.family);
  return {
    id: item.id,
    orderCode: item.orderCode,
    manufacturer: family?.manufacturer ?? "",
    family: item.family,
    category: family?.category ?? "",
    ...(item.name ? { name: item.name } : {}),
    ...(item.variant ? { variant: item.variant } : {}),
    accessories: (item.accessories ?? []).map((accessory) => ({
      item: accessory.item,
      orderCode: catalog.items.find((entry) => entry.id === accessory.item)?.orderCode ?? "",
      role: accessory.role,
      ...(accessory.note ? { note: accessory.note } : {}),
    })),
    distributors: item.distributors ?? [],
  };
}
const byOrderCode = <T extends { orderCode: string; id: string }>(a: T, b: T) =>
  compareText(a.orderCode, b.orderCode) || compareText(a.id, b.id);

export interface CatalogItemQuery {
  orderCode?: string | undefined;
  sku?: string | undefined;
  family?: string | undefined;
  category?: string | undefined;
}
export interface CatalogFoundItem extends ItemHeader {
  match?: "order-code" | "distributor-sku";
  attributes: Record<string, string | boolean>;
  parameters: ({ name: string } & CatalogCitedValue)[];
}
/** Items by exact order code or distributor SKU (never confusing the two), family or category. */
export function findItems(catalog: IndustrialCatalog, query: CatalogItemQuery): CatalogFoundItem[] {
  const orderCode = query.orderCode?.trim();
  const sku = query.sku?.trim();
  const found: CatalogFoundItem[] = [];
  for (const item of catalog.items) {
    const head = header(catalog, item);
    if (query.family !== undefined && item.family !== query.family) continue;
    if (query.category !== undefined && head.category !== query.category) continue;
    if (orderCode !== undefined && item.orderCode !== orderCode) continue;
    if (sku !== undefined && !(item.distributors ?? []).some((entry) => entry.sku === sku)) continue;
    found.push({
      ...head,
      ...(orderCode !== undefined ? { match: "order-code" as const } : {}),
      ...(sku !== undefined ? { match: "distributor-sku" as const } : {}),
      attributes: item.attributes ?? {},
      parameters: item.parameters.map((parameter) => ({ name: parameter.name, ...cite(catalog, parameter) })),
    });
  }
  return found.sort(byOrderCode);
}

/** Whether a value's (or table's) conditions cover the requested conditions (spec "Selection algorithm" 2). */
export function covers(offered: Conditions, requested: Conditions): boolean {
  for (const [key, want] of Object.entries(requested)) {
    const exact = offered[key];
    const low = offered[`${key}Min`];
    const high = offered[`${key}Max`];
    if ("text" in want) {
      if (!exact || !("text" in exact) || fold(exact.text) !== fold(want.text)) return false;
      continue;
    }
    if (!exact && !low && !high) return false;
    const dimension = unitDimension(want.unit);
    const value = toBaseUnit(want.value, want.unit);
    const near = (bound: ElectricalCondition | undefined, check: (base: number) => boolean) =>
      bound === undefined ||
      ("unit" in bound &&
        unitDimension(bound.unit) === dimension &&
        check(toBaseUnit(bound.value, bound.unit)));
    const tolerance = (base: number) => EPSILON * Math.max(1, Math.abs(base));
    if (!near(exact, (base) => Math.abs(base - value) <= tolerance(base))) return false;
    if (!near(low, (base) => value >= base - tolerance(base))) return false;
    if (!near(high, (base) => value <= base + tolerance(base))) return false;
  }
  return true;
}

export type CatalogVerdict = "pass" | "fail" | "unknown";
export type CatalogUnknownReason = "absent" | "conditions" | "unconfirmed";
export interface CatalogCriterion {
  requirement: string;
  verdict: CatalogVerdict;
  reason?: CatalogUnknownReason;
  measured?: { value: number; unit: string } | { text: string };
  limit: { op: CatalogRequirement["op"]; value: number; unit: string } | { op: "=="; text: string };
  available?: Conditions[];
  evidence?: CatalogCitedValue;
}
export interface CatalogSelectedItem extends ItemHeader {
  outcome: "eligible" | "unknown" | "eliminated";
  criteria: CatalogCriterion[];
}
export interface CatalogSelectionRequest {
  family?: string | undefined;
  category?: string | undefined;
  requirements: CatalogRequirement[];
}
export interface CatalogSelection {
  catalog: CatalogStamp;
  requirements: CatalogRequirement[];
  counts: { eligible: number; unknown: number; eliminated: number };
  items: CatalogSelectedItem[];
  commercial: string;
}
const COMMERCIAL =
  "Distributor SKUs and capture times are as recorded in the catalog; nothing was looked up live. Price, stock and similar names are not evidence of equivalence.";

function checkRequirements(requirements: readonly CatalogRequirement[]) {
  const seen = new Set<string>();
  for (const raw of requirements) {
    const requirement = catalogRequirementSchema.parse(raw);
    const fail = (message: string): never => {
      throw Error(`requirement ${requirement.id}: ${message}`);
    };
    if (seen.has(requirement.id)) fail("the id is used twice");
    seen.add(requirement.id);
    if ("text" in requirement.value) {
      if (requirement.op !== "==") fail("a text requirement takes the operator ==");
    } else {
      const problem = unitProblem(requirement.value.unit, requirement.parameter);
      if (problem) fail(problem);
    }
    for (const [key, condition] of Object.entries(requirement.conditions ?? {}))
      if ("unit" in condition) {
        const problem = unitProblem(condition.unit, conditionProperty(key));
        if (problem) fail(`condition ${key}: ${problem}`);
      }
  }
}

function evaluate(
  catalog: IndustrialCatalog,
  item: CatalogItem,
  requirement: CatalogRequirement,
): CatalogCriterion {
  const want = requirement.value;
  if ("text" in want) {
    const limit = { op: "==" as const, text: want.text };
    const attribute = item.attributes?.[requirement.parameter];
    if (attribute === undefined)
      return { requirement: requirement.id, verdict: "unknown", reason: "absent", limit };
    const text = String(attribute);
    return {
      requirement: requirement.id,
      verdict: fold(text) === fold(want.text) ? "pass" : "fail",
      measured: { text },
      limit,
    };
  }
  const limit = { op: requirement.op, value: want.value, unit: want.unit };
  const unknown = (
    reason: CatalogUnknownReason,
    extra: Partial<CatalogCriterion> = {},
  ): CatalogCriterion => ({
    requirement: requirement.id,
    verdict: "unknown",
    reason,
    limit,
    ...extra,
  });
  const named = item.parameters.filter(
    (parameter) => parameter.name === requirement.parameter && parameter.value !== null,
  );
  if (named.length === 0) return unknown("absent");
  const dimension = unitDimension(want.unit);
  for (const parameter of named)
    if (unitDimension(parameter.unit) !== dimension)
      throw Error(
        `requirement ${requirement.id}: unit ${want.unit} is not a unit of ${unitDimension(parameter.unit)}`,
      );
  const covering = named.filter((parameter) =>
    covers(parameter.conditions ?? {}, requirement.conditions ?? {}),
  );
  if (covering.length === 0) {
    const available: Conditions[] = [];
    for (const parameter of named) {
      const conditions = parameter.conditions ?? {};
      if (!available.some((entry) => JSON.stringify(entry) === JSON.stringify(conditions)))
        available.push(conditions);
    }
    return unknown("conditions", { available: available.slice(0, 16) });
  }
  const confirmed = covering.filter((parameter) => parameter.status === "confirmed");
  if (confirmed.length === 0) return unknown("unconfirmed", { evidence: cite(catalog, covering[0]!) });
  const target = toBaseUnit(want.value, want.unit);
  const base = (parameter: CatalogParameter) => toBaseUnit(parameter.value as number, parameter.unit);
  const tolerance = EPSILON * Math.max(1, Math.abs(target));
  const passes = (parameter: CatalogParameter) => {
    const value = base(parameter);
    if (requirement.op === ">=") return value >= target - tolerance;
    if (requirement.op === "<=") return value <= target + tolerance;
    return Math.abs(value - target) <= tolerance;
  };
  // The most conservative value decides: the smallest for >=, the largest for <=, a differing one for ==.
  const deciding =
    requirement.op === ">="
      ? confirmed.reduce((best, next) => (base(next) < base(best) ? next : best))
      : requirement.op === "<="
        ? confirmed.reduce((best, next) => (base(next) > base(best) ? next : best))
        : (confirmed.find((parameter) => !passes(parameter)) ?? confirmed[0]!);
  return {
    requirement: requirement.id,
    verdict: passes(deciding) ? "pass" : "fail",
    measured: { value: deciding.value as number, unit: deciding.unit },
    limit,
    evidence: cite(catalog, deciding),
  };
}

const RANK = { eligible: 0, unknown: 1, eliminated: 2 } as const;
/** Firm-requirement selection (spec "Selection algorithm"); throws on a malformed requirement. */
export function selectItems(
  catalog: IndustrialCatalog,
  stamp: CatalogStamp,
  request: CatalogSelectionRequest,
): CatalogSelection {
  checkRequirements(request.requirements);
  const items: CatalogSelectedItem[] = [];
  for (const item of catalog.items) {
    const head = header(catalog, item);
    if (request.family !== undefined && item.family !== request.family) continue;
    if (request.category !== undefined && head.category !== request.category) continue;
    const criteria = request.requirements.map((requirement) => evaluate(catalog, item, requirement));
    const outcome = criteria.some((criterion) => criterion.verdict === "fail")
      ? "eliminated"
      : criteria.some((criterion) => criterion.verdict === "unknown")
        ? "unknown"
        : "eligible";
    items.push({ ...head, outcome, criteria });
  }
  items.sort((a, b) => RANK[a.outcome] - RANK[b.outcome] || byOrderCode(a, b));
  const counts = { eligible: 0, unknown: 0, eliminated: 0 };
  for (const item of items) counts[item.outcome] += 1;
  return { catalog: stamp, requirements: request.requirements, counts, items, commercial: COMMERCIAL };
}

export interface CatalogCoordinationEntry {
  table: string;
  title: string;
  kind: string;
  items: string[];
  conditions: Conditions;
  parameters: ({ name: string } & CatalogCitedValue)[];
  /** Requested conditions the table does not name: the entry says nothing about them. */
  unevaluated?: string[];
  note?: string;
}
export interface CatalogCoordinationAnswer {
  catalog: CatalogStamp;
  items: string[];
  conditions: Conditions;
  applicable: CatalogCoordinationEntry[];
  notApplicable: {
    table: string;
    items: string[];
    reason: "other-products" | "conditions" | "missing-condition";
    condition?: string;
  }[];
}
/** Coordination entries for exactly these items under these conditions (spec "Coordination lookup"). */
export function coordinationFor(
  catalog: IndustrialCatalog,
  stamp: CatalogStamp,
  itemIds: readonly string[],
  conditions: Conditions | undefined = {},
): CatalogCoordinationAnswer {
  const known = new Set(catalog.items.map((item) => item.id));
  for (const id of itemIds)
    if (!known.has(id)) throw Error(`item ${id} does not exist in catalog ${catalog.id}`);
  for (const [key, condition] of Object.entries(conditions))
    if ("unit" in condition) {
      const problem = unitProblem(condition.unit, conditionProperty(key));
      if (problem) throw Error(`condition ${key}: ${problem}`);
    }
  const requested = [...new Set(itemIds)].sort();
  const result: CatalogCoordinationAnswer = {
    catalog: stamp,
    items: requested,
    conditions,
    applicable: [],
    notApplicable: [],
  };
  for (const table of catalog.coordination)
    for (const entry of table.entries) {
      const items = [...entry.items].sort();
      const same = items.length === requested.length && items.every((id, index) => id === requested[index]);
      if (!same) {
        if (items.some((id) => requested.includes(id)))
          result.notApplicable.push({ table: table.id, items, reason: "other-products" });
        continue;
      }
      const missing = Object.keys(table.conditions).find(
        (key) => conditions[key] === undefined && conditions[key.replace(/(Min|Max)$/, "")] === undefined,
      );
      if (missing !== undefined) {
        result.notApplicable.push({
          table: table.id,
          items,
          reason: "missing-condition",
          condition: missing,
        });
        continue;
      }
      const named = Object.fromEntries(
        Object.entries(conditions).filter(
          ([key]) => table.conditions[key] ?? table.conditions[`${key}Min`] ?? table.conditions[`${key}Max`],
        ),
      );
      if (!covers(table.conditions, named)) {
        result.notApplicable.push({ table: table.id, items, reason: "conditions" });
        continue;
      }
      result.applicable.push({
        table: table.id,
        title: table.title,
        kind: table.kind,
        items,
        conditions: table.conditions,
        parameters: entry.parameters.map((parameter) => ({
          name: parameter.name,
          ...cite(catalog, parameter),
        })),
        ...(Object.keys(conditions).length > Object.keys(named).length
          ? { unevaluated: Object.keys(conditions).filter((key) => !(key in named)) }
          : {}),
        ...(entry.note ? { note: entry.note } : {}),
      });
    }
  return result;
}
