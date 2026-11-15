// Cable tables (spec REQ-DATA-42ce122f "Cable table file"): strict format-1 reading, lookups and the confined
// file access. A rating and its factors are looked up at the next tabulated value at or above the input, never
// interpolated; an input beyond the table is not covered.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { type CableTable, cableTableDir, cableTableLimits, cableTableSchema } from "@vera/shared";
import { PathGuard } from "../workbench/path-guard.js";
import { linkProblem } from "./catalog.js";
import { jsonPath, type ModelProblem, problemsText } from "./model.js";

const PROBLEM_LIMIT = 20;
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export interface CableTableStamp {
  id: string;
  version: string;
  sha256: string;
  path: string;
}

function semanticProblems(table: CableTable, fileId: string | undefined): ModelProblem[] {
  const problems: ModelProblem[] = [];
  const add = (path: string, message: string) => {
    if (problems.length < PROBLEM_LIMIT) problems.push({ path, message });
  };
  if (fileId !== undefined && table.id !== fileId)
    add("id", `the table id ${table.id} differs from the file name ${fileId}`);
  const linkIssue = linkProblem(table.source.uri);
  if (linkIssue) add("source.uri", linkIssue);
  if (table.cable.shortCircuitTemperature <= table.cable.maxConductorTemperature)
    add("cable.shortCircuitTemperature", "must be above the maximum conductor temperature");
  const sections = new Set<number>();
  let previous = 0;
  table.conductors.forEach((conductor, index) => {
    if (conductor.crossSection <= previous)
      add(`conductors[${index}].crossSection`, "cross-sections must be unique and ascending");
    previous = conductor.crossSection;
    sections.add(conductor.crossSection);
  });
  const methods = new Set<string>();
  table.methods.forEach((method, index) => {
    if (methods.has(method.id)) add(`methods[${index}].id`, `method ${method.id} is listed twice`);
    methods.add(method.id);
    const seen = new Set<string>();
    method.ratings.forEach((rating, row) => {
      const path = `methods[${index}].ratings[${row}]`;
      if (!sections.has(rating.crossSection))
        add(`${path}.crossSection`, `no conductor data for ${rating.crossSection} mm²`);
      const key = `${rating.crossSection}/${rating.loadedConductors}`;
      if (seen.has(key))
        add(
          path,
          `${rating.crossSection} mm² with ${rating.loadedConductors} loaded conductors is listed twice`,
        );
      seen.add(key);
    });
  });
  for (const [list, field] of [
    ["temperatureFactors", "ambient"],
    ["groupingFactors", "circuits"],
  ] as const) {
    const claimed = new Set<string>();
    table[list].forEach((entry, index) => {
      entry.methods.forEach((method, row) => {
        if (!methods.has(method)) add(`${list}[${index}].methods[${row}]`, `method ${method} does not exist`);
        else if (claimed.has(method))
          add(`${list}[${index}].methods[${row}]`, `method ${method} already has ${list}`);
        claimed.add(method);
      });
      let last = Number.NEGATIVE_INFINITY;
      entry.points.forEach((point, row) => {
        const value =
          field === "ambient"
            ? (point as { ambient: number }).ambient
            : (point as { circuits: number }).circuits;
        if (value <= last)
          add(`${list}[${index}].points[${row}].${field}`, `${field} must be strictly ascending`);
        last = value;
      });
    });
  }
  return problems;
}

/** The table, or its problems (at most 20). `fileId` is the file name the id must equal. */
export function checkCableTable(
  raw: unknown,
  fileId?: string,
): { table: CableTable } | { problems: ModelProblem[] } {
  const parsed = cableTableSchema.safeParse(raw);
  if (!parsed.success)
    return {
      problems: parsed.error.issues
        .slice(0, PROBLEM_LIMIT)
        .map((issue) => ({ path: jsonPath(issue.path), message: issue.message })),
    };
  const problems = semanticProblems(parsed.data, fileId);
  return problems.length ? { problems } : { table: parsed.data };
}

/** Parses a table document; throws `Invalid cable table:` lines. */
export function parseCableTable(text: string, fileId?: string): CableTable {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error("Invalid cable table: the file is not JSON.");
  }
  const checked = checkCableTable(raw, fileId);
  if ("problems" in checked) throw Error(problemsText("cable table", checked.problems));
  return checked.table;
}

/** Reads `electrical-automation-tables/<id>.json` strictly, confined to the workbench. */
export async function readCableTableFile(
  root: string,
  id: string,
): Promise<{ table: CableTable; stamp: CableTableStamp }> {
  if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(id) || id.length > 64)
    throw Error(`The cable table id ${JSON.stringify(id)} is not a valid id.`);
  const path = `${cableTableDir}/${id}.json`;
  const target = await (await PathGuard.create(root)).resolve(path);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(`The cable table ${path} does not exist.`);
    throw error;
  }
  if (!info.isFile()) throw Error("The cable table is not an ordinary file.");
  if (info.size > cableTableLimits.fileBytes) throw Error("The cable table is larger than 1 MiB.");
  const bytes = await readFile(target.absolute);
  const table = parseCableTable(bytes.toString("utf8"), id);
  return { table, stamp: { id: table.id, version: table.version, sha256: hash(bytes), path } };
}

/** The factor at the next tabulated point at or above `value`; undefined when the table does not cover it. */
function pointFactor<T>(
  points: readonly T[],
  key: (point: T) => number,
  factor: (point: T) => number,
  value: number,
) {
  const point = points.find((candidate) => key(candidate) >= value);
  return point === undefined ? undefined : factor(point);
}
export function temperatureFactor(table: CableTable, method: string, ambient: number): number | undefined {
  const entry = table.temperatureFactors.find((candidate) => candidate.methods.includes(method));
  return (
    entry &&
    pointFactor(
      entry.points,
      (point) => point.ambient,
      (point) => point.factor,
      ambient,
    )
  );
}
export function groupingFactor(table: CableTable, method: string, circuits: number): number | undefined {
  const entry = table.groupingFactors.find((candidate) => candidate.methods.includes(method));
  return (
    entry &&
    pointFactor(
      entry.points,
      (point) => point.circuits,
      (point) => point.factor,
      circuits,
    )
  );
}
export function tableRating(
  table: CableTable,
  method: string,
  crossSection: number,
  loadedConductors: 2 | 3,
): number | undefined {
  return table.methods
    .find((candidate) => candidate.id === method)
    ?.ratings.find(
      (rating) => rating.crossSection === crossSection && rating.loadedConductors === loadedConductors,
    )?.current;
}
