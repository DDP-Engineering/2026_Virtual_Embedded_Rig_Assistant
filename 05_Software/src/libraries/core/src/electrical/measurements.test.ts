import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { powerMeasurementsDir } from "@vera/shared";
import { afterEach, expect, it } from "vitest";
import { columnKey, parseMeasurements, readMeasurementFile } from "./measurements.js";

const fixtures = join(import.meta.dirname, "../../../../../tests/fixtures/power-quality-pfc");
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const base = () => ({
  kind: "vera-power-measurements",
  format: 1,
  id: "meas-test",
  title: "Test profile",
  origin: "fictional",
  source: { title: "Made-up rows", license: "CC0-1.0", readAt: "2026-11-15" },
  board: "brd-main",
  interval: { value: 15, unit: "min" },
  conventions: {
    power: "load",
    reactive: "fundamental",
    reactiveSign: "inductive-positive",
    powerFactor: "unsigned",
  },
  nominalVoltage: { value: 400, unit: "V" },
  frequency: { value: 50, unit: "Hz" },
  columns: [
    { name: "time", quantity: "time" },
    { name: "P", quantity: "activePower", unit: "kW" },
    { name: "Q", quantity: "reactivePower", unit: "var" },
    { name: "U5", quantity: "harmonicVoltage", order: 5, unit: "%" },
  ],
});
const rows = [
  ["2026-11-02T00:00:00+01:00", 20, 15000, 1.5],
  ["2026-11-02T00:15:00+01:00", 22.5, null, 2],
  ["2026-11-02T01:00:00+01:00", 30, 20000, 2.5],
];
const csv =
  "time,P,Q,U5\r\n2026-11-02T00:00:00+01:00,20,15000,1.5\n2026-11-02T00:15:00+01:00,22.5,,2\n2026-11-02T01:00:00+01:00,30,20000,2.5\n";
const csvFile = () => ({ ...base(), csv: "meas-test.csv" });
const problem = (raw: unknown, text?: string) => {
  try {
    parseMeasurements(JSON.stringify(raw), text, "meas-test");
  } catch (error) {
    return (error as Error).message;
  }
  return "parsed";
};

it("reads inline rows and a CSV file to the same series in fixed units, empty cells unknown", () => {
  const inline = parseMeasurements(JSON.stringify({ ...base(), rows }), undefined, "meas-test");
  const fromCsv = parseMeasurements(JSON.stringify(csvFile()), csv, "meas-test");
  expect(fromCsv.times).toEqual(inline.times);
  expect([...fromCsv.values.entries()]).toEqual([...inline.values.entries()]);
  expect(inline.values.get("activePower")).toEqual([20, 22.5, 30]);
  expect(inline.values.get("reactivePower")).toEqual([15, null, 20]); // kvar
  expect(inline.values.get(columnKey({ quantity: "harmonicVoltage", order: 5 }))).toEqual([
    0.015, 0.02, 0.025,
  ]);
  expect(inline.gaps).toBe(1); // 00:15 -> 01:00 is 3 intervals
  expect(inline.intervalSeconds).toBe(900);
});

it("refuses units, columns, CSV headers, timestamps, numbers and sources with the path or row", () => {
  const withColumn = (column: Record<string, unknown>) => ({
    ...base(),
    columns: [...base().columns.slice(0, 3), column],
    rows,
  });
  expect(problem(withColumn({ name: "U5", quantity: "harmonicVoltage", order: 5, unit: "kW" }))).toMatch(
    /columns\[3\]\.unit/,
  );
  expect(problem(withColumn({ name: "U5", quantity: "harmonicVoltage", unit: "%" }))).toMatch(/order/);
  expect(problem(withColumn({ name: "S", quantity: "apparentPower", unit: "kvar" }))).toMatch(
    /apparent-power/,
  );
  expect(problem(withColumn({ name: "P", quantity: "voltage", unit: "V" }))).toMatch(/twice/);
  expect(problem({ ...base(), columns: [base().columns[1], base().columns[0]], rows })).toMatch(
    /first column/,
  );
  expect(problem(csvFile(), csv.replace("time,P,Q,U5", "time,P,Q,U7"))).toMatch(/header/);
  expect(problem(csvFile(), csv.replace("00:15:00", "00:00:00"))).toMatch(/row 2.*increasing/);
  expect(problem(csvFile(), csv.replace("22.5", "22,5"))).toMatch(/row 2/);
  expect(problem(csvFile(), csv.replace("22.5", "2x"))).toMatch(/row 2.*number/);
  expect(problem({ ...base(), rows: [["not a time", 1, 2, 3]] })).toMatch(/row 1.*time/);
  expect(problem({ ...base(), rows: [[rows[0]?.[0], 1, 2]] })).toMatch(/row 1.*4 cells/);
  const noLicense = { ...base(), rows, source: { title: "x" } };
  expect(problem(noLicense)).toMatch(/source\.license/);
  expect(problem({ ...base(), rows, source: { ...base().source, uri: "https://x.test/?token=1" } })).toMatch(
    /source\.uri/,
  );
  expect(problem({ ...base(), rows, extra: 1 })).toMatch(/extra|Unrecognized/);
  expect(problem({ ...base(), rows }, undefined)).toBe("parsed");
  expect(problem({ ...base(), id: "meas-other", rows })).toMatch(/file name/);
  expect(problem({ ...base(), rows, csv: "meas-test.csv" })).toMatch(/either rows or csv/);
  expect(problem({ ...base(), nominalVoltage: { value: 400, unit: "kW" }, rows })).toMatch(/nominalVoltage/);
  expect(
    problem({
      ...base(),
      columns: [...base().columns.slice(0, 3), { name: "PF", quantity: "powerFactor", unit: "1" }],
      rows: [[rows[0]?.[0], 1, 2, 1.2]],
    }),
  ).toMatch(/row 1.*PF/);
});

it("reads the fixture through the workbench folder and stamps both files", async () => {
  const root = await mkdtemp(join(tmpdir(), "vera-meas-"));
  roots.push(root);
  await mkdir(join(root, powerMeasurementsDir));
  for (const name of ["meas-fictional-mdb-day.json", "meas-fictional-mdb-day.csv"])
    await writeFile(join(root, powerMeasurementsDir, name), await readFile(join(fixtures, name)));
  const { series, stamp } = await readMeasurementFile(root, "meas-fictional-mdb-day");
  expect(series.file.origin).toBe("fictional");
  expect(series.times).toHaveLength(96);
  expect(stamp).toMatchObject({ id: "meas-fictional-mdb-day", rows: 96, origin: "fictional" });
  expect(stamp.sha256).toMatch(/^[0-9a-f]{64}$/);
  await expect(readMeasurementFile(root, "meas-missing")).rejects.toThrow(/does not exist/);
  await expect(readMeasurementFile(root, "../x")).rejects.toThrow(/not a valid id/);
  await rm(join(root, powerMeasurementsDir, "meas-fictional-mdb-day.csv"));
  await expect(readMeasurementFile(root, "meas-fictional-mdb-day")).rejects.toThrow(/csv.*does not exist/);
});
