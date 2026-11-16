// Power measurement files (spec REQ-DATA-4dc5e2c7 "Measurement file"): strict format-1 reading of a P/Q/S and
// harmonic profile with declared units and conventions, rows inline or in a CSV file, and host-scoped input access.
// Values are returned in fixed units: kW, kvar, kVA, V, A and shares (1) for factors, THD and harmonics.
import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import {
  type PowerMeasurements,
  powerMeasurementLimits,
  powerMeasurementsDir,
  powerMeasurementsSchema,
} from "@vera/shared";
import { z } from "zod";
import { PathGuard } from "../workbench/path-guard.js";
import { linkProblem } from "./catalog.js";
import { jsonPath, type ModelProblem, problemsText } from "./model.js";
import { toBaseUnit, unitDimension } from "./units.js";

const PROBLEM_LIMIT = 20;
const ID = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/;
const NUMBER = /^-?\d+(?:\.\d+)?(?:[eE][-+]?\d+)?$/;
const isoTime = z.iso.datetime({ offset: true });

/** The dimension, the allowed units and the fixed unit (with its base-unit factor) of each value quantity. */
const QUANTITY_UNITS: Readonly<Record<string, { dimension: string; to: number } | { ratio: true }>> = {
  activePower: { dimension: "power", to: 1e3 },
  reactivePower: { dimension: "reactive-power", to: 1e3 },
  apparentPower: { dimension: "apparent-power", to: 1e3 },
  voltage: { dimension: "voltage", to: 1 },
  current: { dimension: "current", to: 1 },
  powerFactor: { ratio: true },
  displacementFactor: { ratio: true },
  thdCurrent: { ratio: true },
  thdVoltage: { ratio: true },
  harmonicCurrent: { ratio: true },
  harmonicVoltage: { ratio: true },
};
const FACTOR_QUANTITIES = new Set(["powerFactor", "displacementFactor"]);

/** The key of a column's values: its quantity, or `<quantity>@<order>` for a harmonic. */
export const columnKey = (column: { quantity: string; order?: number | undefined }) =>
  column.order === undefined ? column.quantity : `${column.quantity}@${column.order}`;

export interface MeasurementSeries {
  file: Omit<PowerMeasurements, "rows">;
  /** ISO timestamps, strictly increasing. */
  times: string[];
  /** Values per `columnKey` in fixed units (kW, kvar, kVA, V, A, share 1); null = unknown. */
  values: Map<string, (number | null)[]>;
  intervalSeconds: number;
  /** Gaps between timestamps above 1.5 intervals. */
  gaps: number;
}
export interface MeasurementStamp {
  id: string;
  /** SHA-256 of the JSON file, followed by the CSV file when there is one. */
  sha256: string;
  path: string;
  rows: number;
  origin: PowerMeasurements["origin"];
}

type Cell = string | number | null;

/** The series, or its problems (at most 20). `fileId` is the file name the id must equal. */
export function checkMeasurements(
  raw: unknown,
  csvText: string | undefined,
  fileId?: string,
): { series: MeasurementSeries } | { problems: ModelProblem[] } {
  const parsed = powerMeasurementsSchema.safeParse(raw);
  if (!parsed.success)
    return {
      problems: parsed.error.issues
        .slice(0, PROBLEM_LIMIT)
        .map((issue) => ({ path: jsonPath(issue.path), message: issue.message })),
    };
  const file = parsed.data;
  const problems: ModelProblem[] = [];
  const add = (path: string, message: string) => {
    if (problems.length < PROBLEM_LIMIT) problems.push({ path, message });
  };
  if (fileId !== undefined && file.id !== fileId)
    add("id", `the id ${file.id} differs from the file name ${fileId}`);
  if (file.source.uri) {
    const issue = linkProblem(file.source.uri);
    if (issue) add("source.uri", issue);
  }
  if (unitDimension(file.nominalVoltage.unit) !== "voltage")
    add("nominalVoltage.unit", `unit ${file.nominalVoltage.unit} is not a unit of voltage`);
  if (file.csv !== undefined && file.csv !== `${file.id}.csv`)
    add("csv", `the CSV file must be named ${file.id}.csv`);
  const seen = new Set<string>();
  const names = new Set<string>();
  file.columns.forEach((column, index) => {
    const path = `columns[${index}]`;
    if (names.has(column.name)) add(`${path}.name`, `the column name ${column.name} is used twice`);
    names.add(column.name);
    if ((column.quantity === "time") !== (index === 0))
      add(`${path}.quantity`, "the first column and only the first is the time column");
    const key = columnKey(column);
    if (seen.has(key)) add(`${path}.quantity`, `${key} is given twice`);
    seen.add(key);
    const harmonic = column.quantity === "harmonicCurrent" || column.quantity === "harmonicVoltage";
    if (harmonic !== (column.order !== undefined))
      add(
        `${path}.order`,
        harmonic ? "a harmonic column needs its order 2..50" : "only harmonic columns take an order",
      );
    if (column.quantity === "time") {
      if (column.unit !== undefined) add(`${path}.unit`, "the time column takes no unit");
      return;
    }
    const rule = QUANTITY_UNITS[column.quantity];
    if (column.unit === undefined) add(`${path}.unit`, "a value column needs a unit");
    else if (rule && "ratio" in rule) {
      const allowed = FACTOR_QUANTITIES.has(column.quantity) ? ["1"] : ["1", "%"];
      if (!allowed.includes(column.unit))
        add(`${path}.unit`, `unit ${column.unit} is not one of ${allowed.join(", ")} for ${column.quantity}`);
    } else if (rule && unitDimension(column.unit) !== rule.dimension)
      add(`${path}.unit`, `unit ${column.unit} is not a unit of ${rule.dimension}`);
  });
  if (problems.length) return { problems };

  // Rows, from the JSON or the CSV text.
  let cells: Cell[][];
  if (file.rows) cells = file.rows;
  else {
    if (csvText === undefined) return { problems: [{ path: "csv", message: "the CSV text is missing" }] };
    const lines = csvText.split(/\r?\n/);
    if (lines.at(-1) === "") lines.pop();
    const header = lines.shift() ?? "";
    const expected = file.columns.map((column) => column.name).join(",");
    if (header.replace(/^﻿/, "") !== expected)
      return { problems: [{ path: "csv", message: `the header must be ${expected}` }] };
    if (!lines.length) return { problems: [{ path: "csv", message: "the CSV file has no rows" }] };
    if (lines.length > powerMeasurementLimits.rows)
      return { problems: [{ path: "csv", message: `more than ${powerMeasurementLimits.rows} rows` }] };
    cells = lines.map((line) => line.split(","));
  }
  const times: string[] = [];
  const values = new Map<string, (number | null)[]>(
    file.columns.slice(1).map((column) => [columnKey(column), []]),
  );
  let previous = Number.NEGATIVE_INFINITY;
  cells.forEach((row, index) => {
    const at = `row ${index + 1}`;
    if (row.length !== file.columns.length) {
      add(`rows[${index}]`, `${at} has ${row.length} cells, expected ${file.columns.length} cells`);
      return;
    }
    const time = row[0];
    if (typeof time !== "string" || !isoTime.safeParse(time).success) {
      add(`rows[${index}]`, `${at}: the time is not an ISO 8601 time with offset`);
      return;
    }
    const instant = Date.parse(time);
    if (!(instant > previous)) add(`rows[${index}]`, `${at}: timestamps must be strictly increasing`);
    previous = instant;
    times.push(time);
    file.columns.slice(1).forEach((column, offset) => {
      const cell = row[offset + 1];
      let value: number | null;
      if (cell === null || cell === undefined || cell === "") value = null;
      else if (typeof cell === "number") value = cell;
      else if (NUMBER.test(cell)) value = Number(cell);
      else {
        add(`rows[${index}]`, `${at}: ${column.name} is not a number`);
        value = null;
      }
      if (value !== null && !Number.isFinite(value)) {
        add(`rows[${index}]`, `${at}: ${column.name} is not a finite number`);
        value = null;
      }
      const rule = QUANTITY_UNITS[column.quantity];
      if (value !== null && rule) {
        const unit = column.unit as string;
        if ("ratio" in rule) value = unit === "%" ? value / 100 : value;
        else value = toBaseUnit(value, unit) / rule.to;
        if (FACTOR_QUANTITIES.has(column.quantity) && Math.abs(value) > 1)
          add(`rows[${index}]`, `${at}: ${column.name} must lie within -1..1`);
        if (
          !FACTOR_QUANTITIES.has(column.quantity) &&
          ("ratio" in rule ||
            column.quantity === "voltage" ||
            column.quantity === "current" ||
            column.quantity === "apparentPower") &&
          value < 0
        )
          add(`rows[${index}]`, `${at}: ${column.name} must not be negative`);
      }
      values.get(columnKey(column))?.push(value);
    });
  });
  if (problems.length) return { problems };
  const intervalSeconds = toBaseUnit(file.interval.value, file.interval.unit);
  let gaps = 0;
  for (let index = 1; index < times.length; index += 1)
    if (
      (Date.parse(times[index] as string) - Date.parse(times[index - 1] as string)) / 1000 >
      1.5 * intervalSeconds
    )
      gaps += 1;
  const { rows: _rows, ...header } = file;
  return { series: { file: header, times, values, intervalSeconds, gaps } };
}

/** Parses a measurement document (and its CSV text); throws `Invalid measurement file:` lines. */
export function parseMeasurements(
  text: string,
  csvText: string | undefined,
  fileId?: string,
): MeasurementSeries {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw Error("Invalid measurement file: the file is not JSON.");
  }
  const checked = checkMeasurements(raw, csvText, fileId);
  if ("problems" in checked) throw Error(problemsText("measurement file", checked.problems));
  return checked.series;
}

async function fileBytes(
  root: string,
  path: string,
  label: string,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
): Promise<Buffer> {
  const target = await (
    inputGuard ?? (await PathGuard.create(root, root, "workbench", undefined, excludedRoots))
  ).resolve(path);
  let info: Awaited<ReturnType<typeof lstat>>;
  try {
    info = await lstat(target.absolute);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw Error(`The ${label} ${path} does not exist.`);
    throw error;
  }
  if (!info.isFile()) throw Error(`The ${label} ${path} is not an ordinary file.`);
  if (info.size > powerMeasurementLimits.fileBytes) throw Error(`The ${label} ${path} is larger than 4 MiB.`);
  return readFile(target.absolute);
}

/** Reads `electrical-automation-measurements/<id>.json` (and its CSV) strictly, using the host input guard (confined by default). */
export async function readMeasurementFile(
  root: string,
  id: string,
  excludedRoots: readonly string[] = [],
  inputGuard?: PathGuard,
): Promise<{ series: MeasurementSeries; stamp: MeasurementStamp }> {
  if (!ID.test(id) || id.length > 64)
    throw Error(`The measurement id ${JSON.stringify(id)} is not a valid id.`);
  const path = `${powerMeasurementsDir}/${id}.json`;
  const json = await fileBytes(root, path, "measurement file", excludedRoots, inputGuard);
  let csvName: unknown;
  try {
    csvName = (JSON.parse(json.toString("utf8")) as { csv?: unknown }).csv;
  } catch {
    csvName = undefined;
  }
  const csv =
    typeof csvName === "string" && csvName === `${id}.csv`
      ? await fileBytes(
          root,
          `${powerMeasurementsDir}/${csvName}`,
          "measurement csv file",
          excludedRoots,
          inputGuard,
        )
      : undefined;
  const series = parseMeasurements(json.toString("utf8"), csv?.toString("utf8"), id);
  const sha256 = createHash("sha256")
    .update(json)
    .update(csv ?? Buffer.alloc(0))
    .digest("hex");
  const guard = inputGuard ?? (await PathGuard.create(root, root, "workbench", undefined, excludedRoots));
  return {
    series,
    stamp: {
      id,
      sha256,
      path: (await guard.resolve(path)).relative,
      rows: series.times.length,
      origin: series.file.origin,
    },
  };
}
