// The electronics-calc plugin. Default tests check the package, its catalog registration, the rules and the
// elec-calc script on the toolchain's Python against hand-derived fixtures (tests/fixtures/electronics-calc), a
// report in a temporary working directory, the unchanged installed copy and a replay session through the real
// store, provisioner (uv stand-in) and runner. VERA_ELEC_UV names a real uv: the opt-in test provisions the
// script on uv's managed Python and runs it offline.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = fileURLToPath(new URL("electronics-calc/", plugins));
const script = join(source, "scripts", "elec_calc.py");
const fixtures = fileURLToPath(new URL("../fixtures/electronics-calc/", import.meta.url));
const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("electronics-calc/plugin.yaml", plugins), "utf8"));

/** The toolchain's Python (3.11 or newer), which runs the script; the script itself needs no package. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();

interface Quantity {
  value: number;
  unit: string;
  text: string;
}
interface Check {
  id: string;
  status: string;
  detail: string;
}
interface Problem {
  code: string;
  path: string;
  message: string;
}
interface ResultDocument {
  format: number;
  kind: string;
  tool: { name: string; version: string };
  operation: string;
  model?: string;
  runId: string;
  startedAt: string;
  finishedAt: string;
  status: string;
  request: { origin: string; path?: string; sha256: string };
  inputs: Array<Record<string, unknown> & { name: string }>;
  assumptions: string[];
  formulas: string[];
  results: Record<string, Quantity>;
  details: Record<string, unknown>;
  checks: Check[];
  warnings: string[];
  limits: string[];
  artifacts: Array<{ kind: string; path: string; bytes: number; sha256: string }>;
  errors?: Problem[];
  calculations?: Array<Record<string, unknown>>;
}

/** The environment of a run from the source tree: the bytecode switch only keeps the repository clean. */
const sourceEnv = () => {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: "1" };
  // Without PYTHONUTF8 the script itself must emit UTF-8 (spec §1).
  delete env.PYTHONUTF8;
  return env;
};
/** VERA's runner keeps the last 12 000 characters of a run; every document stays below that (spec §4). */
const STDOUT_LIMIT = 11_000;
/** Runs the script; `doc` is its standard output parsed as JSON when it is JSON. */
const calc = (args: string[], options: { cwd?: string; file?: string; env?: NodeJS.ProcessEnv } = {}) => {
  const result = spawnSync(python, [options.file ?? script, ...args], {
    cwd: options.cwd ?? fixtures,
    encoding: "utf8",
    env: options.env ?? sourceEnv(),
    maxBuffer: 64 * 1024 * 1024,
  });
  // No input may end in a Python traceback (exit 1) or in a document the runner would cut.
  expect([0, 2, 3], `exit ${result.status}: ${result.stderr.slice(-600)}`).toContain(result.status);
  expect(result.stdout.length, args.join(" ").slice(0, 200)).toBeLessThanOrEqual(STDOUT_LIMIT);
  let doc: ResultDocument | undefined;
  try {
    doc = JSON.parse(result.stdout) as ResultDocument;
  } catch {
    doc = undefined;
  }
  return { code: result.status, stdout: result.stdout, stderr: result.stderr, doc };
};
const inline = (operation: string, input: unknown, more: string[] = [], cwd?: string) =>
  calc([operation, "--json", JSON.stringify(input), ...more], cwd === undefined ? {} : { cwd });
/** Relative comparison with a small absolute floor for expected zeros. */
const close = (actual: number, expected: number, rel: number) =>
  Math.abs(actual - expected) <= Math.max(Math.abs(expected) * rel, 1e-12);
/** `details.worstCase` keys are output names, which may contain a dot; this resolver tries the longest key first. */
const detail = (details: Record<string, unknown>, path: string): unknown => {
  const parts = path.split(".");
  const walk = (node: unknown, index: number): unknown => {
    if (index === parts.length) return node;
    if (node === null || typeof node !== "object") return undefined;
    const record = node as Record<string, unknown>;
    for (let end = parts.length; end > index; end -= 1) {
      const key = parts.slice(index, end).join(".");
      if (key in record) {
        const found = walk(record[key], end);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  };
  return walk(details, 0);
};

it("publishes the official electronics-calc package, its pack, activity and two installed skills", async () => {
  // REQ-FUNC-5ddc54a6, REQ-DATA-0f278063, REQ-UX-e13eef8a
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    id: "electronics-calc",
    version: "1.0.0",
    ecosystem: "electronics",
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(m.requires ?? []).toEqual([]);
  expect(Object.keys(m.programs)).toEqual(["elec-calc"]);
  expect(m.programs["elec-calc"]?.install).toEqual({ script: "scripts/elec_calc.py" });
  expect(m.programs["elec-calc"]?.version).toEqual({
    args: ["--version"],
    match: "^elec-calc (\\d+\\.\\d+\\.\\d+)",
  });
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("electronics-calc");
  expect(catalog.metadata["electronics-calc"].activities).toEqual(["design"]);
  expect(catalog.metadata["electronics-calc"].keywords.length).toBeGreaterThan(3);
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  const electronics = packs.find((pack: { id: string }) => pack.id === "electronics");
  expect(electronics?.name).toBe("Electronics design");
  expect(electronics?.groups).toContainEqual({
    name: "Calculations",
    plugins: ["electronics-calc"],
    default: true,
  });
  expect(await core.checkCatalogSource(fileURLToPath(plugins))).toEqual([]);
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-elec-skills-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const installed = await store.load("electronics-calc");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const listed = (await skills.list()).filter((skill) => skill.plugin === "electronics-calc");
    expect(listed.map((skill) => [skill.name, skill.source])).toEqual([
      ["electronics-sizing", "plugin"],
      ["thermal-analysis", "plugin"],
    ]);
    const read = async (name: string) => (await skills.read("plugin", name)).content;
    const sizing = await read("electronics-sizing");
    for (const text of [
      "elec-calc",
      "--json",
      "--input",
      "neglectIq",
      "conditions",
      "source",
      "tolerance",
      "monteCarlo",
      "report",
      "Never invent",
    ])
      expect(sizing, text).toContain(text);
    const thermal = await read("thermal-analysis");
    for (const text of [
      "elec-calc thermal",
      "thetaJA",
      "junction-case-sink",
      "conditions",
      "foster",
      "tJunctionMax",
      "report",
      "Never invent",
    ])
      expect(thermal, text).toContain(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("classifies every elec-calc command as a safe host calculation", async () => {
  // REQ-SEC-79d36216
  const m = await manifest();
  const risk = (args: string[]) => classifyCommand(m.rules, "elec-calc", args);
  const request = JSON.stringify({ model: "ohm", voltage: "5 V", current: "10 mA" });
  for (const args of [
    ["--version"],
    ["--help"],
    ["-h"],
    ["dc", "--json", request],
    ["divider", "--input", "calc/divider.json"],
    ["rc", "--json", request, "--run-id", "r1"],
    ["losses", "--json", request],
    ["thermal", "--input", "calc/thermal.json"],
    ["tolerance", "--input", "calc/tolerance.json"],
    ["report", "--input", "calc/report.json"],
    ["report", "--input", "calc/report.json", "--results-dir", "results", "--run-id", "r1"],
    ["dc", "--help"],
  ])
    expect(risk(args).risk, args.join(" ")).toBe("safe");
  expect(risk(["report", "--input", "calc/report.json"]).notes.join(" ")).toMatch(/new .*folder/);
  // A large Monte Carlo run and a report of many calculations get more than the program's 120 s.
  expect(m.programs["elec-calc"]?.timeout).toBe(120);
  expect(risk(["losses", "--json", request]).timeout).toBeNull();
  expect(risk(["tolerance", "--input", "calc/tolerance.json"]).timeout).toBe(600);
  expect(risk(["report", "--input", "calc/report.json"]).timeout).toBe(1800);
  for (const args of [["simulate"], ["--input", "calc/report.json", "report"], []])
    expect(risk(args).risk, args.join(" ")).toBe("device-write");
});

interface FixtureCase {
  name: string;
  operation: string;
  input: unknown;
  results?: Record<string, number>;
  units?: Record<string, string>;
  rel?: number;
  checks?: Record<string, string>;
  assumptions?: string[];
  warnings?: string[];
  details?: Record<string, number | string>;
  inputs?: Record<string, Record<string, unknown>>;
  absent?: string[];
  texts?: Record<string, string>;
  error?: { code: string; path?: string; message?: string };
  errors?: Array<{ code: string; path?: string }>;
}
interface FixtureGroup {
  requirement: string;
  title: string;
  cases: FixtureCase[];
}
const groups = (
  JSON.parse(await readFile(join(fixtures, "cases.json"), "utf8")) as { groups: FixtureGroup[] }
).groups;

const regulator = { model: "linear-regulator", vin: "12 V", vout: "3.3 V", iout: "0.3 A", neglectIq: true };
const divider = { model: "resistive", vin: "5 V", rTop: "10 kΩ", rBottom: "10 kΩ" };

// Every case starts one Python process; a slow Windows host needs more than the default 5 s per test.
describe("the elec-calc script", { timeout: 120_000 }, () => {
  let base: string;
  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "vera-elec-script-")));
  });
  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });
  const folder = () => mkdtemp(join(base, "run-"));

  it("prints its version and refuses unusable arguments with the usage text (REQ-FUNC-5ddc54a6)", async () => {
    const version = calc(["--version"]);
    expect(version.code).toBe(0);
    expect(version.stdout.trim()).toBe(`elec-calc ${(await manifest()).version}`);
    expect(calc(["--help"]).code).toBe(0);
    const request = JSON.stringify(regulator);
    for (const args of [
      [],
      ["simulate", "--json", request],
      ["losses"],
      ["losses", "--json", request, "--input", "cases.json"],
      ["losses", "--js", request],
      ["--json", request, "losses"],
      ["losses", "--json", request, "--results-dir", "x"],
      ["losses", "--json", request, "--run-id", "../x"],
      ["losses", "--json", request, "--run-id", ".hidden"],
      ["losses", "--json", request, "--run-id", "a."],
      ["losses", "--json", request, "--run-id", "NUL"],
      ["losses", "--json", request, "--run-id", "com1.txt"],
      ["losses", "--json", request, "--json", request],
      ["losses", "--json", request, "--run-id", "a", "--run-id", "b"],
    ]) {
      const refused = calc(args);
      expect(refused.code, args.join(" ")).toBe(2);
      expect(refused.doc, args.join(" ")).toBeUndefined();
      expect(refused.stderr, args.join(" ")).toContain("usage:");
    }
  });

  it("returns one format 1 result document (REQ-DATA-3d15fdfc)", async () => {
    const input = {
      ...regulator,
      neglectIq: undefined,
      iq: {
        value: 5,
        unit: "mA",
        source: "Datasheet rev. D, table 6.5",
        conditions: "IOUT = 300 mA, TJ = 25 °C",
      },
    };
    const text = JSON.stringify(input);
    const run = calc(["losses", "--json", text, "--run-id", "t1"]);
    expect(run.code).toBe(0);
    expect(run.stderr).toBe("");
    const doc = run.doc as ResultDocument;
    expect(doc).toMatchObject({
      format: 1,
      kind: "elec-calc-result",
      tool: { name: "elec-calc", version: "1.0.0" },
      operation: "losses",
      model: "linear-regulator",
      runId: "t1",
      status: "ok",
      request: { origin: "inline", sha256: sha256(text) },
      artifacts: [],
    });
    expect(doc.request).not.toHaveProperty("path");
    for (const stamp of [doc.startedAt, doc.finishedAt])
      expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    expect(Date.parse(doc.finishedAt)).toBeGreaterThanOrEqual(Date.parse(doc.startedAt));
    expect(doc.inputs.map((item) => item.name)).toEqual(["vin", "vout", "iout", "iq"]);
    expect(doc.inputs[3]).toEqual({
      name: "iq",
      given: "5 mA",
      value: 0.005,
      unit: "A",
      source: "Datasheet rev. D, table 6.5",
      conditions: "IOUT = 300 mA, TJ = 25 °C",
    });
    expect(doc.inputs[0]).toEqual({ name: "vin", given: "12 V", value: 12, unit: "V" });
    expect(doc.results.pDissipated).toEqual({ value: 2.67, unit: "W", text: "2.670 W" });
    expect(doc.formulas.join("\n")).toContain("P_diss = (V_in - V_out) * I_out + V_in * I_q");
    expect(doc.assumptions.length).toBeGreaterThan(0);
    expect(doc.limits.length).toBeGreaterThan(0);
    expect(doc.checks).toEqual([{ id: "dropout", status: "not-evaluated", detail: expect.any(String) }]);
    expect(doc.warnings).toEqual([]);
    expect(Object.keys(doc)).toEqual([
      "format",
      "kind",
      "tool",
      "operation",
      "model",
      "runId",
      "startedAt",
      "finishedAt",
      "status",
      "request",
      "inputs",
      "assumptions",
      "formulas",
      "results",
      "details",
      "checks",
      "warnings",
      "limits",
      "artifacts",
    ]);
    // A generated run id; a request file names its path and hashes its bytes.
    const dir = await folder();
    await mkdir(join(dir, "calc"));
    const bytes = Buffer.from(`${JSON.stringify(regulator, null, 2)}\n`, "utf8");
    await writeFile(join(dir, "calc", "ldo.json"), bytes);
    const fromFile = calc(["losses", "--input", "calc/ldo.json"], { cwd: dir });
    expect(fromFile.code).toBe(0);
    expect(fromFile.doc?.runId).toMatch(/^\d{8}T\d{6}Z-[0-9a-f]{8}$/);
    expect(fromFile.doc?.request).toEqual({ origin: "file", path: "calc/ldo.json", sha256: sha256(bytes) });
    expect(fromFile.doc?.results.pDissipated?.value).toBe(2.61);
    expect(await readFile(join(dir, "calc", "ldo.json"))).toEqual(bytes);
    expect(await readdir(dir)).toEqual(["calc"]);
    // Engineering text: prefixes by powers of 1000, four significant digits, the temperature unit unprefixed.
    const texts = inline("rc", { model: "time-constant", resistance: "10 kΩ", capacitance: "100 nF" }).doc
      ?.results;
    expect(texts?.tau?.text).toBe("1.000 ms");
    expect(texts?.cutoffFrequency?.text).toBe("159.2 Hz");
    const hot = inline("thermal", {
      model: "junction-ambient",
      power: "1 W",
      tAmbient: "40 °C",
      thetaJA: "50 K/W",
    });
    expect(hot.doc?.results.tJunction).toEqual({ value: 90, unit: "°C", text: "90.00 °C" });
    expect(hot.stdout).toContain("°C");
  });

  for (const group of groups)
    it(`${group.title} (${group.requirement})`, () => {
      for (const item of group.cases) {
        const label = `${group.title}: ${item.name}`;
        const run = inline(item.operation, item.input);
        const doc = run.doc;
        expect(doc, `${label}: ${run.stderr || run.stdout}`).toBeDefined();
        if (!doc) continue;
        const expectedErrors = item.errors ?? (item.error ? [item.error] : undefined);
        if (expectedErrors) {
          expect(run.code, label).toBe(2);
          expect(doc.status, label).toBe("error");
          expect(doc, label).toMatchObject({
            format: 1,
            kind: "elec-calc-result",
            operation: item.operation,
          });
          for (const key of ["results", "inputs", "details", "checks"])
            expect(doc, label).not.toHaveProperty(key);
          const problems = doc.errors ?? [];
          for (const problem of problems) {
            expect(typeof problem.message, label).toBe("string");
            expect(problem.message.length, label).toBeGreaterThan(0);
          }
          for (const expected of expectedErrors) {
            const found = problems.find(
              (problem) =>
                problem.code === expected.code &&
                (expected.path === undefined || problem.path === expected.path),
            );
            expect(found, `${label}: ${JSON.stringify(problems)}`).toBeDefined();
            if (item.error?.message) expect(found?.message, label).toContain(item.error.message);
          }
          if (!item.errors) expect(problems, `${label}: ${JSON.stringify(problems)}`).toHaveLength(1);
          continue;
        }
        expect(run.code, `${label}: ${run.stdout}`).toBe(0);
        expect(doc.status, label).toBe("ok");
        const rel = item.rel ?? 1e-9;
        for (const [key, expected] of Object.entries(item.results ?? {})) {
          const actual = doc.results[key];
          expect(actual, `${label}: result ${key} in ${Object.keys(doc.results).join(", ")}`).toBeDefined();
          if (!actual) continue;
          expect(
            close(actual.value, expected, rel),
            `${label}: ${key} = ${actual.value}, expected ${expected}`,
          ).toBe(true);
          expect(typeof actual.text, label).toBe("string");
        }
        for (const [key, unit] of Object.entries(item.units ?? {}))
          expect(doc.results[key]?.unit, label).toBe(unit);
        for (const key of item.absent ?? [])
          expect(doc.results, `${label}: ${key}`).not.toHaveProperty([key]);
        for (const [key, text] of Object.entries(item.texts ?? {}))
          expect(doc.results[key]?.text, `${label}: text of ${key}`).toBe(text);
        for (const [id, status] of Object.entries(item.checks ?? {}))
          expect(doc.checks.find((check) => check.id === id)?.status, `${label}: check ${id}`).toBe(status);
        for (const text of item.assumptions ?? []) expect(doc.assumptions.join("\n"), label).toContain(text);
        for (const text of item.warnings ?? []) expect(doc.warnings.join("\n"), label).toContain(text);
        for (const [path, expected] of Object.entries(item.details ?? {})) {
          const actual = detail(doc.details, path);
          if (typeof expected === "number")
            expect(
              typeof actual === "number" && close(actual, expected, rel),
              `${label}: details.${path} = ${String(actual)}, expected ${expected}`,
            ).toBe(true);
          else expect(actual, `${label}: details.${path}`).toBe(expected);
        }
        for (const [name, expected] of Object.entries(item.inputs ?? {}))
          expect(
            doc.inputs.find((entry) => entry.name === name),
            `${label}: input ${name}`,
          ).toMatchObject(expected);
        expect(doc.formulas.length, label).toBeGreaterThan(0);
        expect(doc.limits.length, label).toBeGreaterThan(0);
      }
    });

  it("refuses text that is not one JSON object with unique keys and finite numbers (REQ-REL-6c99b9c7, REQ-REL-61e234ea)", () => {
    const refused = (text: string, code: string, path?: string) => {
      const run = calc(["dc", "--json", text]);
      expect(run.code, text).toBe(2);
      expect(run.doc?.status, text).toBe("error");
      expect(run.doc, text).not.toHaveProperty("results");
      const problem = run.doc?.errors?.[0];
      expect(problem?.code, `${text}: ${run.stdout}`).toBe(code);
      // A refusal of the JSON text itself names no field.
      expect(problem?.path, text).toBe(path ?? (code === "json" ? "" : problem?.path));
    };
    refused('{"model": "ohm", "voltage": "5 V"', "json");
    refused("not json", "json");
    refused("", "json");
    refused('[{"model": "ohm"}]', "json");
    refused('"ohm"', "json");
    refused('{"model": "ohm", "voltage": "5 V", "voltage": "6 V", "current": "1 A"}', "json");
    refused('{"model": "ohm", "voltage": {"value": NaN, "unit": "V"}, "current": "1 A"}', "json");
    refused('{"model": "ohm", "voltage": {"value": Infinity, "unit": "V"}, "current": "1 A"}', "json");
    refused('{"model": "ohm", "voltage": {"value": -Infinity, "unit": "V"}, "current": "1 A"}', "json");
    refused('{"model": "ohm", "voltage": {"value": 1e999, "unit": "V"}, "current": "1 A"}', "json");
    refused('{"model": "ohm", "voltage": "NaN V", "current": "1 A"}', "number", "voltage");
    refused('{"model": "ohm", "voltage": "inf V", "current": "1 A"}', "number", "voltage");
    refused(
      '{"model": "ohm", "voltage": {"value": true, "unit": "V"}, "current": "1 A"}',
      "number",
      "voltage",
    );
  });

  it("refuses text that cannot be written back as UTF-8 or read as numbers (REQ-REL-6c99b9c7)", async () => {
    const lone = String.raw`{"model": "ohm", "voltage": {"value": 1, "unit": "V", "note": "\ud800"}, "current": "1 A"}`;
    for (const text of [
      lone,
      String.raw`{"model": "ohm", "volt\udfffage": "1 V", "current": "1 A"}`,
      String.raw`{"model": "ohm", "voltage": "1 \ud800V", "current": "1 A"}`,
    ]) {
      const run = calc(["dc", "--json", text]);
      expect(run.code, text).toBe(2);
      expect(run.doc?.errors?.[0]?.code, run.stdout).toBe("json");
    }
    const small = calc([
      "dc",
      "--json",
      '{"model": "ohm", "voltage": {"value": 1e-400, "unit": "V"}, "current": "1 A"}',
    ]);
    expect(small.doc?.errors?.[0], small.stdout).toMatchObject({ code: "json", path: "" });
    const dir = await folder();
    await writeFile(
      join(dir, "long.json"),
      `{"model": "ohm", "voltage": "5 V", "current": "1 A", "x": ${"9".repeat(5000)}}`,
    );
    await writeFile(
      join(dir, "latin1.json"),
      Buffer.from('{"model": "ohm", "voltage": "5 V", "current": "1 A", "note": "caf\u00e9"}', "latin1"),
    );
    await writeFile(
      join(dir, "bom.json"),
      `\ufeff${JSON.stringify({ model: "ohm", voltage: "5 V", current: "1 A" })}`,
    );
    for (const file of ["long.json", "latin1.json"]) {
      const run = calc(["dc", "--input", file], { cwd: dir });
      expect(run.code, file).toBe(2);
      expect(run.doc?.errors?.[0]?.code, `${file}: ${run.stdout}`).toBe("json");
      expect(run.doc?.request, file).toMatchObject({ origin: "file", path: file });
    }
    expect(calc(["dc", "--input", "bom.json"], { cwd: dir }).doc?.results.resistance?.value).toBe(5);
    // Text from the request comes back in messages: it must stay valid and bounded.
    const echoed = calc([
      "dc",
      "--json",
      JSON.stringify({ model: "ohm", voltage: `5 ${"x".repeat(3000)}`, current: "1 A" }),
    ]);
    expect(echoed.doc?.errors?.[0]).toMatchObject({ code: "number", path: "voltage" });
    expect(echoed.stdout.length).toBeLessThan(2000);
  });

  it("keeps every document within the runner's output limit (REQ-REL-c46a7e47)", async () => {
    const shed = (doc: ResultDocument | undefined, word: string) =>
      expect(doc?.warnings.join("\n"), JSON.stringify(doc?.warnings)).toContain(word);
    // A Foster table of 64 rows and a 64-resistor string: tables, then inputs, give way; results stay.
    const foster = {
      model: "foster",
      power: "10 W",
      tReference: "25 °C",
      stages: Array.from({ length: 16 }, (_, index) => ({ resistance: "1 K/W", tau: `${index + 1} ms` })),
      times: Array.from({ length: 64 }, (_, index) => `${index + 1} ms`),
    };
    const transient = inline("thermal", foster);
    expect(transient.code, transient.stdout.slice(0, 300)).toBe(0);
    expect(transient.doc?.results.zthSteady).toMatchObject({ value: 16, unit: "K/W" });
    expect(transient.doc?.details).toEqual({});
    shed(transient.doc, "detail tables");
    const series = {
      model: "series",
      resistances: Array.from({ length: 64 }, () => "1 kΩ"),
      voltage: "3.2 V",
    };
    const string = inline("dc", series);
    expect(string.doc?.results.totalResistance?.value).toBe(64000);
    expect(string.doc?.details).toEqual({});
    expect(string.doc?.inputs).toHaveLength(65);
    shed(string.doc, "detail tables");
    // A small request keeps its tables.
    const small = inline("dc", { model: "series", resistances: ["1 kΩ", "2 kΩ"], voltage: "3 V" });
    expect(small.doc?.warnings).toEqual([]);
    expect(small.doc?.details.elements).toHaveLength(2);
    // The full tables are in the report file, and a summary too long for the limit drops its result texts.
    const dir = await folder();
    const corners = {
      target: { operation: "divider", input: divider },
      outputs: ["vout", "voutUnloaded", "currentTop", "powerTop", "powerBottom", "theveninResistance"],
      parameters: { rTop: { tolerance: "1 %" }, rBottom: { tolerance: "1 %" } },
    };
    const many = {
      title: "Large report",
      calculations: [
        { id: "string", operation: "dc", input: series },
        { id: "transient", operation: "thermal", input: foster },
        ...Array.from({ length: 30 }, (_, index) => ({
          id: `corners-${index}`,
          operation: "tolerance",
          input: corners,
        })),
      ],
    };
    await writeFile(join(dir, "many.json"), JSON.stringify(many));
    const summary = calc(["report", "--input", "many.json", "--run-id", "big"], { cwd: dir });
    expect(summary.code, summary.stdout.slice(0, 400)).toBe(0);
    expect(summary.doc?.calculations).toHaveLength(32);
    expect(summary.doc?.calculations?.[0]).toEqual({
      id: "string",
      operation: "dc",
      model: "series",
      checks: { pass: 0, fail: 0, unknown: 0, notEvaluated: 0 },
    });
    shed(summary.doc, "report.json");
    const written = JSON.parse(await readFile(join(dir, "electronics-results/big/report.json"), "utf8"));
    expect(written.calculations[0].result.details.elements).toHaveLength(64);
    expect(written.calculations[1].result.details.response).toHaveLength(64);
    expect(written.calculations[0].result.warnings).toEqual([]);
    // Many problems at once: the list is cut and says so.
    const broken = inline("dc", {
      model: "series",
      resistances: Array.from({ length: 64 }, () => `1 ${"k".repeat(60)}`),
    });
    expect(broken.code).toBe(2);
    const problems = broken.doc?.errors ?? [];
    expect(problems.length).toBeLessThan(64);
    expect(problems[0]).toMatchObject({ code: "unit", path: "resistances.0" });
    expect(problems.at(-1)).toMatchObject({
      code: "limit",
      message: expect.stringMatching(/more problems are not shown/),
    });
    // Text a document repeats from its request is bounded, however long a request file makes it.
    const long = 20000;
    const files: Record<string, [string, unknown, string]> = {
      "key.json": ["dc", { model: "ohm", voltage: "5 V", current: "1 A", ["k".repeat(long)]: 1 }, "schema"],
      "digits.json": ["dc", { model: "ohm", voltage: `${"1".repeat(long)} V`, current: "1 A" }, "number"],
      "zeros.json": [
        "dc",
        { model: "ohm", voltage: "5 V", resistance: `-${"0".repeat(long)}1 Ohm` },
        "number",
      ],
      "unit.json": [
        "dc",
        { model: "ohm", voltage: { value: 5, unit: "V".repeat(long) }, current: "1 A" },
        "unit",
      ],
      "name.json": [
        "tolerance",
        {
          target: { operation: "divider", input: divider },
          outputs: ["vout"],
          parameters: { ["p".repeat(long)]: { tolerance: "1 %" } },
        },
        "schema",
      ],
      "output.json": [
        "tolerance",
        {
          target: { operation: "divider", input: divider },
          outputs: ["o".repeat(long)],
          parameters: { rTop: { tolerance: "1 %" } },
        },
        "schema",
      ],
    };
    for (const [name, [operation, body, code]] of Object.entries(files)) {
      await writeFile(join(dir, name), JSON.stringify(body));
      const run = calc([operation, "--input", name], { cwd: dir });
      expect(run.code, name).toBe(2);
      expect(run.doc?.errors, `${name}: ${run.stdout.slice(0, 300)}`).toHaveLength(1);
      expect(run.doc?.errors?.[0]?.code, name).toBe(code);
      expect(run.stdout.length, name).toBeLessThan(1500);
      expect((run.doc?.errors?.[0]?.path ?? "").length, name).toBeLessThanOrEqual(200);
      expect((run.doc?.errors?.[0]?.message ?? "").length, name).toBeLessThanOrEqual(600);
    }
    // Second step: with the tables gone and the document still too long, the input list goes too.
    const loads = Array.from({ length: 64 }, (_, index) => ({
      name: `load ${index}`,
      voltage: { value: 3.3, unit: "V", conditions: "c".repeat(480), source: "s".repeat(480) },
      current: "1 A",
    }));
    await writeFile(join(dir, "loads.json"), JSON.stringify({ model: "power-budget", loads }));
    const budget = calc(["losses", "--input", "loads.json"], { cwd: dir });
    expect(budget.code, budget.stdout.slice(0, 300)).toBe(0);
    expect(budget.doc?.results.pLoads?.value).toBe(211.2);
    expect(budget.doc?.details).toEqual({});
    expect(budget.doc?.inputs).toEqual([]);
    shed(budget.doc, "detail tables");
    shed(budget.doc, "list of 128 inputs");
    // The largest tolerance document: six outputs with Monte Carlo and limits keep all 76 results.
    const mosfet = {
      model: "mosfet",
      current: { shape: "pulse", peak: "4 A", duty: 0.25 },
      rdsOn: { value: 50, unit: "mΩ", conditions: "c".repeat(500), source: "s".repeat(500) },
      frequency: "100 kHz",
      switching: { method: "energy", eOn: "100 µJ", eOff: "150 µJ" },
      gateDrive: { qg: "50 nC", vDrive: "10 V" },
    };
    const names = [
      "current.peak",
      "current.duty",
      "rdsOn",
      "frequency",
      "switching.eOn",
      "switching.eOff",
      "gateDrive.qg",
      "gateDrive.vDrive",
    ];
    const powers = ["pConduction", "pSwitching", "pDevice", "pGateDrive"];
    await writeFile(
      join(dir, "worst.json"),
      JSON.stringify({
        target: { operation: "losses", input: mosfet },
        outputs: [...powers, "currentRms", "currentAverage"],
        parameters: Object.fromEntries(
          names.map((name) => [name, { tolerance: "10 %", distribution: "normal", sigmas: 3 }]),
        ),
        monteCarlo: { samples: 200, seed: 1 },
        limits: Object.fromEntries(powers.map((name) => [name, { min: "0 W", max: "100 W" }])),
      }),
    );
    const worst = calc(["tolerance", "--input", "worst.json"], { cwd: dir });
    expect(worst.code, worst.stdout.slice(0, 300)).toBe(0);
    expect(Object.keys(worst.doc?.results ?? {})).toHaveLength(6 * 3 + 6 * 9 + 4);
    expect(worst.doc?.checks.map((check) => check.id)).toEqual(["monotonic"]);
    // The runner counts UTF-16 units: text beyond the Basic Multilingual Plane counts twice. (The helper
    // `calc` measures every document in that unit as well.)
    const emoji = "\u{1f600}".repeat(500);
    const marked = (value: number, unit: string) => ({
      value,
      unit,
      source: emoji,
      conditions: emoji,
      note: emoji,
    });
    await writeFile(
      join(dir, "emoji.json"),
      JSON.stringify({
        model: "junction-ambient",
        power: marked(1, "W"),
        tAmbient: marked(40, "°C"),
        thetaJA: marked(50, "K/W"),
        tJunctionMax: marked(125, "°C"),
      }),
    );
    const wide = calc(["thermal", "--input", "emoji.json"], { cwd: dir });
    expect(wide.code, wide.stdout.slice(0, 300)).toBe(0);
    expect(wide.doc?.results.tJunction?.value).toBe(90);
    expect(wide.doc?.inputs).toEqual([]);
    shed(wide.doc, "list of 4 inputs");
    await writeFile(
      join(dir, "emoji-keys.json"),
      JSON.stringify({
        model: "ohm",
        voltage: "5 V",
        current: "1 A",
        ...Object.fromEntries(
          Array.from({ length: 64 }, (_, index) => [`${"\u{1f600}".repeat(200)}${index}`, 1]),
        ),
      }),
    );
    const keys = calc(["dc", "--input", "emoji-keys.json"], { cwd: dir });
    expect(keys.code).toBe(2);
    expect(keys.doc?.errors?.at(-1)).toMatchObject({ code: "limit" });
    // Third step, and the bound at the largest result with long request text: through `contract.fitted`,
    // because no request reaches it without a path of a thousand characters.
    const helper = spawnSync(python, [join(fixtures, "internals.py"), join(source, "scripts"), "fit"], {
      encoding: "utf8",
    });
    expect(helper.status, helper.stderr).toBe(0);
    const fit = JSON.parse(helper.stdout) as {
      limit: number;
      units: number;
      results: number;
      checks: number;
      emptied: string[];
      warnings: string[];
      wideUnits: number;
      wideInputs: number;
      clippedUnits: number;
      clippedEnd: string;
    };
    expect(fit.limit).toBe(STDOUT_LIMIT);
    expect(fit.units).toBeLessThanOrEqual(STDOUT_LIMIT);
    expect(fit).toMatchObject({
      results: 78,
      checks: 1,
      emptied: ["details", "inputs", "formulas", "assumptions", "limits"],
      wideInputs: 0,
      clippedEnd: "...",
    });
    expect(fit.warnings.join("\n")).toContain("Formulas, assumptions and limits were left out");
    expect(fit.warnings).toHaveLength(5);
    // 6000 emoji are 6000 characters but 12 000 UTF-16 units: counted in characters the inputs would stay.
    expect(fit.wideUnits).toBeLessThanOrEqual(STDOUT_LIMIT);
    expect(fit.clippedUnits).toBeLessThanOrEqual(600);
    expect(fit.clippedUnits).toBeGreaterThan(590);
    // The report refuses more Monte Carlo work than its timeout allows.
    const heavy = {
      ...corners,
      parameters: { rTop: { tolerance: "1 %", distribution: "uniform" } },
      monteCarlo: { samples: 100000, seed: 1 },
    };
    const tooMuch = calc(
      [
        "report",
        "--json",
        JSON.stringify({
          title: "Too much",
          calculations: Array.from({ length: 11 }, (_, index) => ({
            id: `mc-${index}`,
            operation: "tolerance",
            input: heavy,
          })),
        }),
        "--run-id",
        "heavy",
      ],
      { cwd: dir },
    );
    expect(tooMuch.code).toBe(2);
    expect(tooMuch.doc?.errors?.[0]).toMatchObject({ code: "limit", path: "calculations" });
    expect(await readdir(join(dir, "electronics-results"))).toEqual(["big"]);
  });

  it("lists every model and field in the operation help (REQ-UX-b186323e)", () => {
    const models: Record<string, string[]> = {
      dc: ["ohm", "series", "parallel", "shunt"],
      divider: ["resistive"],
      rc: ["time-constant", "filter", "waveform"],
      losses: ["linear-regulator", "resistor", "mosfet", "diode", "capacitor", "inductor", "power-budget"],
      thermal: ["junction-ambient", "junction-case-sink", "foster"],
      tolerance: [
        "target",
        "outputs",
        "parameters",
        "monteCarlo",
        "limits",
        "tolerance",
        "distribution",
        "sigmas",
        "samples",
        "seed",
      ],
      report: ["title", "notes", "calculations", "id", "operation", "input", "note"],
    };
    // Every field name a fixture request uses must be named in the help of its operation.
    const metadata = new Set(["value", "unit", "source", "conditions", "note"]);
    const used = new Map<string, Set<string>>();
    const collect = (operation: string, node: unknown) => {
      if (Array.isArray(node)) for (const item of node) collect(operation, item);
      else if (node !== null && typeof node === "object")
        for (const [key, value] of Object.entries(node)) {
          if (!metadata.has(key)) used.set(operation, (used.get(operation) ?? new Set()).add(key));
          collect(operation, value);
        }
    };
    for (const group of groups)
      for (const item of group.cases)
        if (!item.error && !item.errors && item.operation !== "tolerance")
          collect(item.operation, item.input);
    const helps = new Map<string, string>();
    for (const [operation, names] of Object.entries(models)) {
      const help = calc([operation, "--help"]);
      expect(help.code, operation).toBe(0);
      helps.set(operation, help.stdout);
      for (const name of [...names, "--json", "--input", "--run-id", "source", "conditions"])
        expect(help.stdout, `${operation} --help: ${name}`).toContain(name);
      for (const field of used.get(operation) ?? [])
        expect(help.stdout, `${operation} --help: field ${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }
    // Each field is listed under the model that takes it: the model's line and its indented continuation.
    const block = (help: string, model: string) => {
      const lines = help.split("\n");
      const start = lines.findIndex((line) => new RegExp(`^  ${model}\\s`).test(line));
      let end = start + 1;
      while (start >= 0 && end < lines.length && /^ {3,}\S/.test(lines[end] ?? "")) end += 1;
      return start < 0 ? "" : lines.slice(start, end).join("\n");
    };
    let checked = 0;
    for (const group of groups)
      for (const item of group.cases) {
        const input = item.input as { model?: string };
        if (item.error || item.errors || item.operation === "tolerance" || !input.model) continue;
        const help = helps.get(item.operation) ?? "";
        const own = block(help, input.model);
        expect(own, `${item.operation} --help: model ${input.model}`).not.toBe("");
        // The forms of a current are described once, below the models of `losses`.
        const text = `${own}
${help.slice(help.indexOf("A current is one of"))}`;
        const fields = new Set<string>();
        const walk = (node: unknown) => {
          if (Array.isArray(node)) for (const entry of node) walk(entry);
          else if (node !== null && typeof node === "object")
            for (const [key, value] of Object.entries(node)) {
              if (!metadata.has(key)) fields.add(key);
              walk(value);
            }
        };
        walk(input);
        fields.delete("model");
        for (const field of fields) {
          expect(text, `${item.operation} ${input.model}: field ${field}`).toMatch(
            new RegExp(`\\b${field}\\b`),
          );
          checked += 1;
        }
      }
    expect(checked).toBeGreaterThan(300);
    expect(used.get("losses")?.size).toBeGreaterThan(25);
    expect(calc(["report", "--help"]).stdout).toContain("--results-dir");
    expect(calc(["--help"]).stdout).toContain("elec-calc <operation> --help");
  });

  describe("Monte Carlo (REQ-FUNC-4ac67c0d)", () => {
    const request = (distribution: Record<string, unknown>, seed: number, samples = 20000) => ({
      target: { operation: "divider", input: divider },
      outputs: ["vout"],
      parameters: {
        rTop: { tolerance: "1 %", ...distribution },
        rBottom: { tolerance: "1 %", ...distribution },
      },
      monteCarlo: { samples, seed },
      limits: { vout: { min: "2.49 V", max: "2.51 V" } },
    });
    const value = (doc: ResultDocument | undefined, key: string) => {
      const found = doc?.results[key]?.value;
      if (found === undefined) throw Error(`No result ${key} in ${JSON.stringify(doc)}`);
      return found;
    };
    // First-order values derived in the fixture README: sd = 2.5 * sqrt(2) * sd(delta) / 2.
    const uniformSd = 0.010206207261597;
    const normalSd = 0.0058925565098879;

    it("matches the analytic moments of two uniform 1 % resistors and keeps the corners", () => {
      const run = inline("tolerance", request({ distribution: "uniform" }, 12345));
      expect(run.code, run.stdout).toBe(0);
      const doc = run.doc;
      expect(Math.abs(value(doc, "vout.mean") - 2.5)).toBeLessThan(2.5 * 0.0002);
      expect(Math.abs(value(doc, "vout.stdDev") / uniformSd - 1)).toBeLessThan(0.03);
      expect(Math.abs(value(doc, "vout.fractionWithin") - 0.64)).toBeLessThan(0.02);
      // The corners are evaluated as well, and no uniform sample leaves them.
      expect(value(doc, "vout.min")).toBe(2.475);
      expect(value(doc, "vout.max")).toBe(2.525);
      expect(value(doc, "vout.sampleMin")).toBeGreaterThanOrEqual(2.475);
      expect(value(doc, "vout.sampleMax")).toBeLessThanOrEqual(2.525);
      expect(Math.abs(value(doc, "vout.p50") - 2.5)).toBeLessThan(0.0005);
      // Percentiles of the triangular first-order distribution: 2.5 -+ 0.025 * (1 - sqrt(2 p)).
      expect(Math.abs(value(doc, "vout.p05") - (2.5 - 0.025 * (1 - Math.sqrt(0.1))))).toBeLessThan(0.0007);
      expect(Math.abs(value(doc, "vout.p95") - (2.5 + 0.025 * (1 - Math.sqrt(0.1))))).toBeLessThan(0.0007);
      expect(value(doc, "vout.p01")).toBeLessThan(value(doc, "vout.p05"));
      expect(value(doc, "vout.p99")).toBeGreaterThan(value(doc, "vout.p95"));
      expect(doc?.results["vout.mean"]?.unit).toBe("V");
      expect(doc?.results["vout.fractionWithin"]?.unit).toBe("1");
      expect(doc?.details.monteCarlo).toMatchObject({
        generator: expect.stringContaining("random.Random"),
        seed: 12345,
        samples: 20000,
        python: expect.stringMatching(/^\d+\.\d+\.\d+/),
      });
      expect(doc?.warnings.join("\n")).toContain("corner");
      expect(doc?.checks.find((check) => check.id === "monotonic")?.status).toBe("pass");
    });

    it("equals an independent implementation of the documented algorithm", () => {
      const reference = (...args: string[]) => {
        const run = spawnSync(python, [join(fixtures, "montecarlo_reference.py"), ...args], {
          encoding: "utf8",
        });
        expect(run.status, run.stderr).toBe(0);
        return JSON.parse(run.stdout) as Record<string, number>;
      };
      for (const [distribution, seed, samples, more] of [
        [{ distribution: "uniform" }, 12345, 20000, []],
        [{ distribution: "uniform" }, 7, 101, []],
        [{ distribution: "normal", sigmas: 3 }, 2026, 5000, ["3"]],
        [{ distribution: "normal", sigmas: 2.5 }, 99, 1000, ["2.5"]],
      ] as const) {
        const doc = inline("tolerance", request(distribution, seed, samples)).doc;
        const expected = reference(distribution.distribution, String(seed), String(samples), ...more);
        expect(Object.keys(expected)).toHaveLength(10);
        for (const [key, number] of Object.entries(expected))
          expect(
            close(value(doc, key), number, 1e-11),
            `${distribution.distribution} seed ${seed}: ${key} = ${value(doc, key)}, reference ${number}`,
          ).toBe(true);
      }
    });

    it("repeats exactly with the same seed and differs within tolerance with another", () => {
      const first = inline("tolerance", request({ distribution: "uniform" }, 12345)).doc;
      const again = inline("tolerance", request({ distribution: "uniform" }, 12345)).doc;
      expect(again?.results).toEqual(first?.results);
      expect(again?.details).toEqual(first?.details);
      const other = inline("tolerance", request({ distribution: "uniform" }, 54321)).doc;
      expect(value(other, "vout.sampleMin")).not.toBe(value(first, "vout.sampleMin"));
      expect(value(other, "vout.mean")).not.toBe(value(first, "vout.mean"));
      expect(Math.abs(value(other, "vout.mean") - 2.5)).toBeLessThan(2.5 * 0.0002);
      expect(Math.abs(value(other, "vout.stdDev") / uniformSd - 1)).toBeLessThan(0.03);
    });

    it("draws normal distributions from the declared sigma level", () => {
      const doc = inline("tolerance", request({ distribution: "normal", sigmas: 3 }, 2026)).doc;
      expect(Math.abs(value(doc, "vout.mean") - 2.5)).toBeLessThan(2.5 * 0.0002);
      expect(Math.abs(value(doc, "vout.stdDev") / normalSd - 1)).toBeLessThan(0.03);
      // An untruncated normal distribution is narrower than the uniform one but may pass the corners.
      expect(value(doc, "vout.stdDev")).toBeLessThan(uniformSd);
      expect(doc?.assumptions.join("\n")).toContain("not truncated");
    });
  });

  describe("report", () => {
    const calculations = [
      { id: "ldo", operation: "losses", input: regulator, note: "3.3 V rail regulator" },
      {
        id: "switch",
        operation: "losses",
        input: {
          model: "mosfet",
          current: { rms: "2 A" },
          rdsOn: {
            value: 50,
            unit: "mΩ",
            conditions: "VGS = 10 V, Tj = 125 °C",
            source: "Datasheet rev. C, table 4",
          },
        },
      },
      {
        id: "junction",
        operation: "thermal",
        input: {
          model: "junction-ambient",
          power: "1 W",
          tAmbient: "40 °C",
          thetaJA: { value: 50, unit: "K/W", conditions: "JEDEC 2s2p board, still air" },
          tJunctionMax: "125 °C",
        },
      },
    ];
    const reportRequest = { title: "Power stage review", notes: ["Bench revision B"], calculations };

    it("writes report.json and report.md into a new run folder and keeps its input (REQ-FUNC-a39b04ed)", async () => {
      const dir = await folder();
      const bytes = Buffer.from(JSON.stringify(reportRequest, null, 1), "utf8");
      await writeFile(join(dir, "request.json"), bytes);
      const run = calc(["report", "--input", "request.json", "--run-id", "r1"], { cwd: dir });
      expect(run.code, run.stdout + run.stderr).toBe(0);
      const summary = run.doc as ResultDocument;
      expect(summary).toMatchObject({
        format: 1,
        kind: "elec-calc-report-summary",
        operation: "report",
        runId: "r1",
        status: "ok",
        request: { origin: "file", path: "request.json", sha256: sha256(bytes) },
      });
      expect(summary.artifacts.map((artifact) => [artifact.kind, artifact.path])).toEqual([
        ["report-json", "electronics-results/r1/report.json"],
        ["report-markdown", "electronics-results/r1/report.md"],
      ]);
      expect(await readdir(join(dir, "electronics-results", "r1"))).toEqual(["report.json", "report.md"]);
      for (const artifact of summary.artifacts) {
        const file = await readFile(join(dir, artifact.path));
        expect(artifact.bytes).toBe(file.length);
        expect(artifact.sha256).toBe(sha256(file));
      }
      expect(summary.calculations).toMatchObject([
        { id: "ldo", operation: "losses", model: "linear-regulator", results: { pDissipated: "2.610 W" } },
        {
          id: "switch",
          operation: "losses",
          model: "mosfet",
          checks: { pass: 1, fail: 0, unknown: 0, notEvaluated: 0 },
        },
        { id: "junction", operation: "thermal", results: { tJunction: "90.00 °C" }, checks: { pass: 2 } },
      ]);
      const report = JSON.parse(await readFile(join(dir, "electronics-results/r1/report.json"), "utf8"));
      expect(report).toMatchObject({
        format: 1,
        kind: "elec-calc-report",
        tool: { name: "elec-calc", version: "1.0.0" },
        runId: "r1",
        title: "Power stage review",
        notes: ["Bench revision B"],
        request: { origin: "file", path: "request.json", sha256: sha256(bytes) },
      });
      expect(report.calculations.map((entry: { id: string }) => entry.id)).toEqual([
        "ldo",
        "switch",
        "junction",
      ]);
      expect(report.calculations[0]).toMatchObject({
        note: "3.3 V rail regulator",
        result: {
          format: 1,
          kind: "elec-calc-result",
          status: "ok",
          results: { pDissipated: { value: 2.61 } },
        },
      });
      for (const entry of report.calculations)
        for (const key of ["inputs", "assumptions", "formulas", "results", "checks", "warnings", "limits"])
          expect(entry.result, `${entry.id}.${key}`).toHaveProperty(key);
      const markdown = await readFile(join(dir, "electronics-results/r1/report.md"), "utf8");
      for (const text of [
        "# Power stage review",
        "Bench revision B",
        "## ldo",
        "3.3 V rail regulator",
        "P_diss = (V_in - V_out) * I_out + V_in * I_q",
        "P_cond = I_rms^2 * R_DS(on)",
        "T_J = T_A + P * theta_JA",
        "Datasheet rev. C, table 4",
        "VGS = 10 V, Tj = 125 °C",
        "JEDEC 2s2p board, still air",
        "neglected",
        "2.610 W",
        "90.00 °C",
        "junction-limit",
        "Limits",
        "Assumptions",
        sha256(bytes),
      ])
        expect(markdown, text).toContain(text);
      expect(markdown).not.toContain("\r");
      expect(await readFile(join(dir, "request.json"))).toEqual(bytes);
      expect((await readdir(dir)).sort()).toEqual(["electronics-results", "request.json"]);
      // An inline request, a generated run id and another results directory.
      const second = calc(
        ["report", "--json", JSON.stringify(reportRequest), "--results-dir", "out/reports"],
        {
          cwd: dir,
        },
      );
      expect(second.code, second.stdout).toBe(0);
      expect(second.doc?.artifacts[0]?.path).toBe(`out/reports/${second.doc?.runId}/report.json`);
      expect(existsSync(join(dir, "out", "reports", second.doc?.runId as string, "report.md"))).toBe(true);
    });

    it("writes nothing for an existing run folder or a refused calculation (REQ-REL-8c73edc4)", async () => {
      const dir = await folder();
      const text = JSON.stringify(reportRequest);
      expect(calc(["report", "--json", text, "--run-id", "r1"], { cwd: dir }).code).toBe(0);
      const files = ["report.json", "report.md"].map((name) => join(dir, "electronics-results", "r1", name));
      const before = await Promise.all(files.map((file) => readFile(file)));
      const repeated = calc(["report", "--json", text, "--run-id", "r1"], { cwd: dir });
      expect(repeated.code).toBe(2);
      expect(repeated.doc).toMatchObject({
        status: "error",
        kind: "elec-calc-report-summary",
        errors: [{ code: "output" }],
      });
      expect(await Promise.all(files.map((file) => readFile(file)))).toEqual(before);
      expect(await readdir(join(dir, "electronics-results"))).toEqual(["r1"]);
      const broken = {
        title: "Broken",
        calculations: [
          calculations[0],
          { id: "bad", operation: "losses", input: { ...regulator, vin: "12 A" } },
        ],
      };
      const refused = calc(["report", "--json", JSON.stringify(broken), "--run-id", "r2"], { cwd: dir });
      expect(refused.code).toBe(2);
      expect(refused.doc?.errors).toEqual([
        { code: "unit", path: "calculations.1.input.vin", message: expect.any(String) },
      ]);
      expect(await readdir(join(dir, "electronics-results"))).toEqual(["r1"]);
      for (const [request, code, path] of [
        [{ title: "Empty", calculations: [] }, "limit", "calculations"],
        [{ calculations }, "schema", "title"],
        [{ title: "Twice", calculations: [calculations[0], calculations[0]] }, "schema", "calculations.1.id"],
        [
          { title: "Nested", calculations: [{ id: "again", operation: "report", input: {} }] },
          "schema",
          "calculations.0.operation",
        ],
        [
          { title: "Id", calculations: [{ ...calculations[0], id: "Not Valid" }] },
          "schema",
          "calculations.0.id",
        ],
      ] as const) {
        const run = calc(["report", "--json", JSON.stringify(request), "--run-id", "r3"], { cwd: dir });
        expect(run.code, JSON.stringify(request)).toBe(2);
        expect(run.doc?.errors?.[0], run.stdout).toMatchObject({ code, path });
      }
      expect(await readdir(join(dir, "electronics-results"))).toEqual(["r1"]);
    });

    it("confines inputs and report outputs to the working directory (REQ-SEC-6c075f30)", async () => {
      const outer = await folder();
      const dir = join(outer, "bench");
      await mkdir(join(dir, "sub"), { recursive: true });
      const text = JSON.stringify(reportRequest);
      await writeFile(join(outer, "outside.json"), JSON.stringify(regulator));
      await writeFile(join(dir, "inside.json"), JSON.stringify(regulator));
      await writeFile(join(dir, "big.json"), `{"model": "ohm", "pad": "${"x".repeat(1024 * 1024)}"}`);
      const refusedInput = (file: string) => {
        const run = calc(["losses", "--input", file], { cwd: dir });
        expect(run.code, file).toBe(2);
        expect(run.doc?.errors?.[0]?.code, `${file}: ${run.stdout}`).toBe("path");
        expect(run.doc, file).not.toHaveProperty("results");
      };
      for (const file of ["../outside.json", join(outer, "outside.json"), "sub", "missing.json", "big.json"])
        refusedInput(file);
      expect(calc(["losses", "--input", join(dir, "inside.json")], { cwd: dir }).doc?.request).toMatchObject({
        origin: "file",
        path: "inside.json",
      });
      for (const target of [
        "..",
        join(outer, "elsewhere"),
        ".vera/x",
        ".VERA",
        "sub/.vera",
        ".vera./x",
        ".vera::$DATA/x",
        "inside.json",
      ]) {
        const run = calc(["report", "--json", text, "--run-id", "r1", "--results-dir", target], { cwd: dir });
        expect(run.code, target).toBe(2);
        expect(run.doc?.errors?.[0]?.code, `${target}: ${run.stdout}`).toBe("path");
      }
      expect((await readdir(outer)).sort()).toEqual(["bench", "outside.json"]);
      expect((await readdir(dir)).sort()).toEqual(["big.json", "inside.json", "sub"]);
      expect(await readdir(join(dir, "sub"))).toEqual([]);
    });

    it("follows links before it judges a path and never asks the system about a path outside (REQ-SEC-6c075f30)", async () => {
      const outer = await folder();
      const dir = join(outer, "bench");
      await mkdir(join(dir, ".vera"), { recursive: true });
      await mkdir(join(outer, "elsewhere"));
      await writeFile(join(outer, "elsewhere", "request.json"), JSON.stringify(regulator));
      await writeFile(join(dir, "inside.json"), JSON.stringify(regulator));
      // A junction needs no privilege on Windows; elsewhere a directory symlink.
      const link = (target: string, name: string) =>
        symlink(target, join(dir, name), windows ? "junction" : "dir");
      await link(join(outer, "elsewhere"), "away");
      await link(join(dir, ".vera"), "alias");
      const text = JSON.stringify(reportRequest);
      const refused = (args: string[], word?: string) => {
        const run = calc(args, { cwd: dir });
        expect(run.code, args.join(" ")).toBe(2);
        expect(run.doc?.errors?.[0]?.code, `${args.join(" ")}: ${run.stdout}`).toBe("path");
        if (word) expect(run.doc?.errors?.[0]?.message, args.join(" ")).toContain(word);
      };
      refused(["losses", "--input", "away/request.json"]);
      for (const target of ["away", "away/reports", "alias", "alias/reports", "inside.json/reports"])
        refused(["report", "--json", text, "--run-id", "r1", "--results-dir", target]);
      // Judged from the text alone: nothing is resolved, so no network or device is touched.
      for (const target of ["//192.0.2.1/share/x.json", "\\\\192.0.2.1\\share\\x.json", "//./NUL"]) {
        refused(["losses", "--input", target], "network");
        refused(["report", "--json", text, "--run-id", "r1", "--results-dir", target], "network");
      }
      if (windows) {
        // NUL is a device path by its text on Windows: outside the working directory, never opened.
        for (const target of ["NUL", "sub/nul"]) {
          refused(["losses", "--input", target]);
          refused(["report", "--json", text, "--run-id", "r1", "--results-dir", target]);
        }
      } else {
        // Elsewhere the same names are ordinary files and folders.
        await mkdir(join(dir, "aux"));
        await writeFile(join(dir, "aux", "con.json"), JSON.stringify(regulator));
        expect(calc(["losses", "--input", "aux/con.json"], { cwd: dir }).doc?.request).toMatchObject({
          path: "aux/con.json",
        });
        await rm(join(dir, "aux"), { recursive: true });
      }
      refused(["losses", "--input", `${"d/".repeat(600)}x.json`]);
      refused(["report", "--json", text, "--run-id", "r1", "--results-dir", "r".repeat(1025)]);
      if (windows) {
        refused(["losses", "--input", "C:inside.json"]);
        refused(["losses", "--input", `${dir.slice(0, 2)}inside.json`]);
        refused(["report", "--json", text, "--run-id", "r1", "--results-dir", `${dir.slice(0, 2)}reports`]);
      }
      const long = "a".repeat(300);
      refused(["losses", "--input", long]);
      refused(["losses", "--input", ""]);
      expect(await readdir(join(outer, "elsewhere"))).toEqual(["request.json"]);
      expect(await readdir(join(dir, ".vera"))).toEqual([]);
      expect((await readdir(dir)).sort()).toEqual([".vera", "alias", "away", "inside.json"]);
    });

    it("accepts the working directory under the name it was entered by (REQ-SEC-6c075f30)", async () => {
      const outer = await folder();
      const real = join(outer, "real");
      const linked = join(outer, "linked");
      await mkdir(real);
      await writeFile(join(real, "inside.json"), JSON.stringify(regulator));
      await writeFile(join(outer, "other.json"), JSON.stringify(regulator));
      await symlink(real, linked, windows ? "junction" : "dir");
      // A shell names the directory it entered in PWD; Windows keeps the entered name as the current directory.
      const options = { cwd: linked, env: { ...sourceEnv(), PWD: linked } };
      for (const file of ["inside.json", join(linked, "inside.json"), join(real, "inside.json")]) {
        const run = calc(["losses", "--input", file], options);
        expect(run.code, `${file}: ${run.stdout}`).toBe(0);
        expect(run.doc?.request).toMatchObject({ origin: "file", path: "inside.json" });
      }
      const text = JSON.stringify(reportRequest);
      const report = calc(
        ["report", "--json", text, "--run-id", "r1", "--results-dir", join(linked, "out")],
        options,
      );
      expect(report.code, report.stdout).toBe(0);
      expect(report.doc?.artifacts[0]?.path).toBe("out/r1/report.json");
      expect(await readdir(join(real, "out", "r1"))).toEqual(["report.json", "report.md"]);
      // Neither name widens the directory.
      for (const file of [join(outer, "other.json"), join(linked, "..", "other.json")]) {
        const run = calc(["losses", "--input", file], options);
        expect(run.code, file).toBe(2);
        expect(run.doc?.errors?.[0]?.code, file).toBe("path");
      }
      // A PWD whose text collapses to another folder is ignored as well: `link/../c` behind a link is the
      // working directory for the system, while its text names a sibling of the link.
      if (!windows) {
        const tree = join(outer, "pw");
        await mkdir(join(tree, "real", "c"), { recursive: true });
        await mkdir(join(tree, "real", "sub"));
        await mkdir(join(tree, "c"));
        await symlink(join(tree, "real", "sub"), join(tree, "link"), "dir");
        await writeFile(join(tree, "real", "c", "ldo.json"), JSON.stringify(regulator));
        await writeFile(join(tree, "c", "ldo.json"), JSON.stringify({ ...regulator, iout: "10 A" }));
        const through = calc(["losses", "--input", "ldo.json"], {
          cwd: join(tree, "real", "c"),
          env: { ...sourceEnv(), PWD: `${join(tree, "link")}/../c` },
        });
        expect(through.doc?.results.pDissipated?.value, through.stdout).toBe(2.61);
        const beside = calc(["losses", "--input", join(tree, "c", "ldo.json")], {
          cwd: join(tree, "real", "c"),
          env: { ...sourceEnv(), PWD: `${join(tree, "link")}/../c` },
        });
        expect(beside.doc?.errors?.[0]?.code, beside.stdout).toBe("path");
      }
      // A PWD that names another folder is ignored.
      const lying = calc(["losses", "--input", join(outer, "other.json")], {
        cwd: real,
        env: { ...sourceEnv(), PWD: outer },
      });
      expect(lying.doc?.errors?.[0]?.code, lying.stdout).toBe("path");
    });

    it("refuses a request file whose name is not valid Unicode text (REQ-SEC-6c075f30)", async () => {
      const dir = await folder();
      const helper = spawnSync(python, [join(fixtures, "odd_name.py"), script], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(helper.status, helper.stderr).toBe(0);
      const outcome = JSON.parse(helper.stdout) as {
        skipped?: string;
        dc: { code: number; stdout: string; stderr: string };
        report: { code: number; stdout: string; stderr: string };
        folders: string[];
      };
      // A file system that cannot hold such a name has nothing to refuse.
      if (outcome.skipped) return;
      for (const run of [outcome.dc, outcome.report]) {
        expect(run.code, run.stderr).toBe(2);
        expect(run.stdout.length).toBeLessThanOrEqual(STDOUT_LIMIT);
        const doc = JSON.parse(run.stdout) as ResultDocument;
        expect(doc.errors).toEqual([{ code: "path", path: "", message: expect.stringContaining("Unicode") }]);
      }
      expect(outcome.folders).toEqual([]);
    });

    it("refuses path text that grows when a document repeats it (REQ-SEC-6c075f30, REQ-REL-c46a7e47)", async () => {
      const dir = await folder();
      await writeFile(join(dir, "inside.json"), JSON.stringify(regulator));
      // A control character in a path option is refused by its text, before the file system is asked (the
      // resolved form, judged after a file-system call, has a message of its own).
      for (const args of [
        ["losses", "--input", "in\u0001side.json"],
        [
          "report",
          "--json",
          JSON.stringify(reportRequest),
          "--run-id",
          "r1",
          "--results-dir",
          "out\u001fput",
        ],
      ]) {
        const run = calc(args, { cwd: dir });
        expect(run.code, run.stdout).toBe(2);
        expect(run.doc?.errors).toEqual([
          {
            code: "path",
            path: "",
            message: expect.stringContaining("takes a path without control characters"),
          },
        ]);
      }
      expect(await readdir(dir)).toEqual(["inside.json"]);
      // A link may resolve to a name a Linux file system holds: the relative path a document repeats is
      // measured as JSON writes it (a quotation mark or backslash takes two units, a control character six).
      // The helper makes `os.path.realpath` return such names in-process, so the check runs on every platform.
      const helper = spawnSync(python, [join(fixtures, "internals.py"), join(source, "scripts"), "escape"], {
        cwd: dir,
        encoding: "utf8",
      });
      expect(helper.status, helper.stderr).toBe(0);
      const probes = JSON.parse(helper.stdout) as Record<string, { admitted: boolean; units?: number }>;
      expect(probes).toEqual({
        plain: { admitted: true, units: 1024 },
        quotes: { admitted: true, units: 1024 },
        longQuotes: { admitted: false },
        control: { admitted: false },
      });
    });

    it("discards a report when its results directory is replaced by a link meanwhile (REQ-REL-fd2fa08d)", async () => {
      // A command line reaches this state only by racing a slow report, so the helper makes the link from
      // inside the computation, after the directory was checked and before the run folder is created.
      const outer = await folder();
      const dir = join(outer, "bench");
      await mkdir(join(outer, "elsewhere"));
      await mkdir(dir);
      const helper = spawnSync(
        python,
        [join(fixtures, "internals.py"), join(source, "scripts"), "swap", join(outer, "elsewhere")],
        { cwd: dir, encoding: "utf8" },
      );
      expect(helper.status, helper.stderr).toBe(0);
      const outcome = JSON.parse(helper.stdout) as {
        failure: string | null;
        outside: string[];
        here: string[];
      };
      expect(outcome.failure).toContain("results directory changed");
      // Nothing was written through the link, and the link, which the run did not create, stays.
      expect(outcome.outside).toEqual([]);
      expect(outcome.here).toEqual(["electronics-results"]);
    });

    it("discards a report whose input changes while it runs (REQ-REL-fd2fa08d)", async () => {
      const dir = await folder();
      // The helper runs the real command line and appends a space to the request while the first calculation
      // is computed: after the run read it and before it reads it again, with no timing involved.
      const body = JSON.stringify({
        title: "Changing input",
        calculations: [{ id: "ldo", operation: "losses", input: regulator }],
      });
      const file = join(dir, "request.json");
      await writeFile(file, body);
      const args = ["report", "--input", "request.json", "--run-id", "r1", "--results-dir", "out/reports"];
      const changed = spawnSync(
        python,
        [join(fixtures, "internals.py"), join(source, "scripts"), "change", ...args],
        {
          cwd: dir,
          encoding: "utf8",
          env: sourceEnv(),
        },
      );
      expect(changed.status, changed.stderr).toBe(3);
      expect(changed.stdout.length).toBeLessThanOrEqual(STDOUT_LIMIT);
      expect(await readFile(file, "utf8")).toBe(`${body} `);
      const doc = JSON.parse(changed.stdout) as ResultDocument;
      expect(doc).toMatchObject({ status: "error", kind: "elec-calc-report-summary", runId: "r1" });
      expect(doc.errors).toEqual([
        { code: "output", path: "", message: expect.stringContaining("input file changed") },
      ]);
      // Nothing the run created stays: neither the run folder nor the results directory it made.
      expect(await readdir(dir)).toEqual(["request.json"]);
      // The same request, left alone, succeeds afterwards.
      await writeFile(file, body);
      const again = calc(args, { cwd: dir });
      expect(again.code, again.stdout).toBe(0);
      expect(await readdir(join(dir, "out", "reports", "r1"))).toEqual(["report.json", "report.md"]);
      // A run folder that cannot be created: an invalid name on Windows, a read-only parent elsewhere.
      const small = JSON.stringify({
        title: "Unwritable",
        calculations: [{ id: "ldo", operation: "losses", input: regulator }],
      });
      const blocked = join(dir, "blocked");
      if (!windows) await mkdir(blocked, { mode: 0o555 });
      // The superuser may write into a read-only folder.
      if (windows || process.getuid?.() !== 0) {
        const target = windows ? "fresh/deeper/o*t" : "blocked/reports";
        const failed = calc(["report", "--json", small, "--run-id", "r2", "--results-dir", target], {
          cwd: dir,
        });
        expect(failed.code, failed.stdout).toBe(3);
        expect(failed.doc?.errors).toEqual([{ code: "output", path: "", message: expect.any(String) }]);
        expect(existsSync(join(dir, "fresh"))).toBe(false);
        if (!windows) expect(await readdir(blocked)).toEqual([]);
      }
    }, 180_000);
  });
});

/** Every file below a folder, relative and sorted. */
const tree = async (folder: string): Promise<string[]> =>
  (await readdir(folder, { recursive: true, withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) =>
      join(entry.parentPath, entry.name)
        .slice(folder.length + 1)
        .replaceAll("\\", "/"),
    )
    .sort();

it("leaves the installed package unchanged by a run (REQ-REL-29808598)", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-elec-installed-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const installed = await store.load("electronics-calc");
    const before = await tree(installed.folder);
    expect(before).toContain("scripts/elec_calc.py");
    expect(before.some((file) => file.startsWith("scripts/elec_support/"))).toBe(true);
    const bench = join(root, "bench");
    await mkdir(bench);
    // No PYTHONDONTWRITEBYTECODE here: the script itself must keep Python from caching its support package.
    const env: NodeJS.ProcessEnv = { ...process.env };
    delete env.PYTHONDONTWRITEBYTECODE;
    delete env.PYTHONPYCACHEPREFIX;
    const file = join(installed.folder, "scripts", "elec_calc.py");
    const one = calc(["losses", "--json", JSON.stringify(regulator)], { cwd: bench, file, env });
    expect(one.code, one.stderr).toBe(0);
    expect(one.doc?.results.pDissipated?.value).toBe(2.61);
    const report = calc(
      [
        "report",
        "--json",
        JSON.stringify({
          title: "Installed",
          calculations: [{ id: "ldo", operation: "losses", input: regulator }],
        }),
        "--run-id",
        "r1",
      ],
      { cwd: bench, file, env },
    );
    expect(report.code, report.stderr).toBe(0);
    const tolerance = calc(
      [
        "tolerance",
        "--json",
        JSON.stringify({
          target: { operation: "divider", input: divider },
          outputs: ["vout"],
          parameters: { rTop: { tolerance: "1 %" } },
        }),
      ],
      { cwd: bench, file, env },
    );
    expect(tolerance.code, tolerance.stderr).toBe(0);
    expect(await tree(installed.folder)).toEqual(before);
    expect(before.some((name) => name.includes("__pycache__") || name.endsWith(".pyc"))).toBe(false);
    await expect(store.load("electronics-calc")).resolves.toMatchObject({
      manifest: { id: "electronics-calc" },
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}, 60_000);

/** A uv stand-in that logs its arguments; `sync --script` succeeds and `run ... --script <file>` runs the file. */
async function fakeUv(dir: string) {
  const file = join(dir, "fake_uv.py");
  await writeFile(
    file,
    [
      "import json, runpy, sys",
      "sys.dont_write_bytecode = True",
      `with open(${JSON.stringify(join(dir, "uv.jsonl"))}, "a") as log: log.write(json.dumps(sys.argv[1:]) + "\\n")`,
      "args = sys.argv[1:]",
      'if args[:2] == ["sync", "--script"]: sys.exit(0)',
      'assert args[:4] == ["run", "--quiet", "--offline", "--script"], args',
      "sys.argv = args[4:]",
      'runpy.run_path(args[4], run_name="__main__")',
    ].join("\n"),
  );
  return file;
}

it("runs from an ask-mode session without approval through the real runner (REQ-TEST-f4cf8c66)", async () => {
  // Also REQ-FUNC-5ddc54a6: the provisioner records the version and resolves uv's offline script run.
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-elec-session-")));
  const bench = join(root, "bench");
  const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
  let service: core.SessionService | undefined;
  let database: Awaited<ReturnType<typeof core.openDb>> | undefined;
  let provisioner: core.Provisioner | undefined;
  try {
    await mkdir(join(bench, ".vera"), { recursive: true });
    await mkdir(join(root, "scripts"));
    const args = ["losses", "--json", JSON.stringify(regulator), "--run-id", "s1"];
    await writeFile(
      join(root, "scripts/calc.jsonl"),
      [{ toolCalls: [{ name: "run_program", args: { program: "elec-calc", args } }] }, { text: "2.61 W." }]
        .map((item) => JSON.stringify(item))
        .join("\n"),
    );
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    provisioner = new core.Provisioner({
      store,
      root: join(root, "plugins", "runtime"),
      uv: { executable: python, prefix: [await fakeUv(root)] },
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      platform: core.pluginPlatform(process.platform, process.arch),
      fetch: async () => new Response("offline", { status: 404 }),
      settings: () => undefined,
    });
    expect(await provisioner.install("electronics-calc")).toEqual([
      { name: "elec-calc", kind: "script", state: "ready", version: "1.0.0" },
    ]);
    const plugin = await store.load("electronics-calc");
    const resolved = await provisioner.resolve(plugin, "elec-calc");
    expect(resolved?.prefix?.slice(-5)).toEqual([
      "run",
      "--quiet",
      "--offline",
      "--script",
      join(plugin.folder, "scripts", "elec_calc.py"),
    ]);
    const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
    await gateway.models("replay", new AbortController().signal);
    database = await core.openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
    service = new core.SessionService({
      root: bench,
      db: database.db,
      gateway,
      clock: { now: () => new Date(), sleep },
      model: () => "replay/calc",
      prompt: () => "Use the electronics-calc plugin",
      programs: { runner, clock: { sleep }, plugins: async () => [plugin], resolver: provisioner },
    });
    await service.waitReady();
    const session = service.create(null, "ask");
    const outputs: { ok: boolean; summary: string }[] = [];
    service.subscribe(session.id, 0, (_seq, event) => {
      if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
    });
    service.send(session.id, "How much does the regulator dissipate?");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    expect(outputs).toHaveLength(1);
    expect(outputs[0]?.ok).toBe(true);
    const done = JSON.parse(outputs[0]?.summary ?? "{}") as {
      exitCode: number;
      risk: string;
      output: string;
    };
    expect(done).toMatchObject({ exitCode: 0, risk: "safe" });
    const doc = JSON.parse(done.output) as ResultDocument;
    expect(doc).toMatchObject({
      status: "ok",
      runId: "s1",
      results: { pDissipated: { value: 2.61, unit: "W" } },
    });
    expect(service.get(session.id).snapshot.approvals).toEqual([]);
    expect(database.db.prepare("SELECT count(*) AS n FROM approvals").get()).toEqual({ n: 0 });
    // The run left the installed package as the store hashed it.
    await expect(store.load("electronics-calc")).resolves.toBeDefined();
  } finally {
    await service?.close();
    await runner.stopAll();
    provisioner?.close();
    database?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

const uv = process.env.VERA_ELEC_UV;
// Explicit real acceptance: VERA_ELEC_UV names a uv executable. Provisioning is a user action that may download
// uv's managed CPython; the default tests need neither uv nor the network.
it.skipIf(!uv)(
  "runs offline through a real uv on its managed Python (REQ-PLAT-c87a001f)",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-elec-real-")));
    const host = new core.NodeProcessHost(spawn);
    let provisioner: core.Provisioner | undefined;
    try {
      const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(root, "release"));
      expect(release.issues).toEqual([]);
      const store = new core.PluginStore({ root: join(root, "plugins") });
      await store.install(join(root, "release/electronics-calc-1.0.0.zip"));
      provisioner = new core.Provisioner({
        store,
        root: join(root, "runtime"),
        uv: { executable: uv as string },
        host,
        platform: core.pluginPlatform(process.platform, process.arch),
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("No download program in this package");
        },
      });
      expect(await provisioner.install("electronics-calc")).toEqual([
        { name: "elec-calc", kind: "script", state: "ready", version: "1.0.0" },
      ]);
      const plugin = await store.load("electronics-calc");
      const resolved = await provisioner.resolve(plugin, "elec-calc");
      if (!resolved) throw Error("elec-calc did not resolve");
      expect(resolved.prefix).toContain("--offline");
      const bench = join(root, "bench");
      await mkdir(bench);
      const run = (args: string[]) => {
        const result = spawnSync(resolved.executable, [...(resolved.prefix ?? []), ...args], {
          cwd: bench,
          encoding: "utf8",
          env: { ...process.env, ...resolved.env },
        });
        return {
          code: result.status,
          stderr: result.stderr,
          doc: JSON.parse(result.stdout) as ResultDocument,
        };
      };
      const loss = run(["losses", "--json", JSON.stringify(regulator)]);
      expect(loss.code, loss.stderr).toBe(0);
      expect(loss.doc.results.pDissipated).toMatchObject({ value: 2.61, unit: "W" });
      const junction = run([
        "thermal",
        "--json",
        JSON.stringify({ model: "junction-ambient", power: "1 W", tAmbient: "40 °C", thetaJA: "50 K/W" }),
      ]);
      expect(junction.doc.results.tJunction).toMatchObject({ value: 90, unit: "°C" });
      const report = run([
        "report",
        "--json",
        JSON.stringify({
          title: "Real uv",
          calculations: [{ id: "ldo", operation: "losses", input: regulator }],
        }),
        "--run-id",
        "real",
      ]);
      expect(report.code, report.stderr).toBe(0);
      expect(await readdir(join(bench, "electronics-results", "real"))).toEqual(["report.json", "report.md"]);
      await expect(store.load("electronics-calc")).resolves.toBeDefined();
      const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await writeFile(
          join(evidence, `electronics-calc-${process.platform}.json`),
          JSON.stringify({
            platform: process.platform,
            arch: process.arch,
            loss: loss.doc,
            junction: junction.doc,
          }),
        );
      }
    } finally {
      provisioner?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  600_000,
);
