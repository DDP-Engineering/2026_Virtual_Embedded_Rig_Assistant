// The lab-validation plugin. Default tests check the package, catalog, pack and rules, and run the lab-validate script
// on the toolchain's Python against synthetic signals whose solutions tests/fixtures/lab-validation/README.md derives
// by hand, against a real scpi-instruments capture folder (the real scpi helper on its fake PyVISA, offline) and
// against ngspice-tool/ltspice-tool run folders written to their contract; a replay session runs it through the real
// store, provisioner (uv stand-in) and runner. VERA_LABVAL_UV names a real uv: the opt-in test provisions the script
// on uv's managed Python and runs compare offline.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const pluginFolder = fileURLToPath(new URL("lab-validation/", plugins));
const script = join(pluginFolder, "scripts", "lab_validate.py");
const fixtures = fileURLToPath(new URL("../fixtures/lab-validation/", import.meta.url));
const scpiScript = fileURLToPath(new URL("scpi-instruments/scripts/scpi_tool.py", plugins));
const fakePyvisa = fileURLToPath(new URL("../fixtures/scpi-instruments/fake-pyvisa", import.meta.url));
const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const OUTPUT_LIMIT = 11_000;

/** The toolchain's Python (3.11 or newer), which runs the script; the script itself needs no package. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();

// biome-ignore lint/suspicious/noExplicitAny: the helper's JSON documents, checked field by field.
type Json = Record<string, any>;
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
  stderr: string;
}

const baseEnv = (extra: Record<string, string> = {}): NodeJS.ProcessEnv => {
  const env: NodeJS.ProcessEnv = { ...process.env, PYTHONDONTWRITEBYTECODE: "1", ...extra };
  delete env.PYTHONUTF8;
  return env;
};
function lv(root: string, args: string[], extra: Record<string, string> = {}): Run {
  const result = spawnSync(python, [script, ...args], {
    cwd: root,
    env: baseEnv(extra),
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const stdout = result.stdout ?? "";
  // No input may end in a Python traceback or in a document the runner would cut.
  expect([0, 1, 2, 3], `exit ${result.status}: ${(result.stderr ?? "").slice(-1500)}`).toContain(
    result.status,
  );
  expect(stdout.length).toBeLessThanOrEqual(OUTPUT_LIMIT);
  let json: Json = {};
  try {
    json = JSON.parse(stdout);
  } catch {
    json = { unparsed: stdout };
  }
  return { code: result.status, json, stdout, stderr: result.stderr ?? "" };
}
const resultOf = (root: string, run: Run): Json =>
  JSON.parse(readFileSync(join(root, run.json.result), "utf8"));
const close = (actual: number, expected: number, rel: number) =>
  Math.abs(actual - expected) <= Math.max(Math.abs(expected) * rel, 1e-15);

// ---- Signals (closed forms of the fixture README; never computed by the plugin) ----
type Rows = number[][];
const grid = (start: number, dt: number, steps: number) =>
  Array.from({ length: steps + 1 }, (_, i) => start + i * dt);
const sine = (rate = 1e5, stop = 10e-3): Rows =>
  grid(0, 1 / rate, Math.round(stop * rate)).map((t) => [t, 2 * Math.sin(2 * Math.PI * 1000 * t)]);
const pwmValue = (i: number) => {
  const k = i % 1000;
  if (k <= 10) return (3.3 * k) / 10;
  if (k <= 300) return 3.3;
  if (k <= 310) return (3.3 * (310 - k)) / 10;
  return 0;
};
const pwm = (): Rows => Array.from({ length: 10001 }, (_, i) => [i * 1e-7, pwmValue(i)]);
const TAU = 10e-6;
const rcStep = (): Rows =>
  Array.from({ length: 2201 }, (_, i) => {
    const t = -20e-6 + i * 1e-7;
    return [t, i < 200 ? 0 : 5 * (1 - Math.exp((-(i - 200) * 1e-7) / TAU))];
  });
const secondOrder = (): Rows => {
  const zeta = 0.5;
  const wn = 2 * Math.PI * 10e3;
  const wd = wn * Math.sqrt(1 - zeta * zeta);
  return Array.from({ length: 5001 }, (_, i) => {
    const t = i * 1e-7;
    return [
      t,
      1 -
        Math.exp(-zeta * wn * t) *
          (Math.cos(wd * t) + (zeta / Math.sqrt(1 - zeta * zeta)) * Math.sin(wd * t)),
    ];
  });
};
const ripple = (): Rows =>
  Array.from({ length: 3001 }, (_, i) => {
    const k = i % 100;
    const tri = k <= 50 ? -0.01 + (0.02 * k) / 50 : 0.01 - (0.02 * (k - 50)) / 50;
    return [i * 1e-7, 3.3 + tri];
  });
const pulse = (t: number) => {
  if (t < 0) return 0;
  if (t <= 100e-6) return 5 * (1 - Math.exp(-t / TAU));
  return 5 * (1 - Math.exp(-100e-6 / TAU)) * Math.exp(-(t - 100e-6) / TAU);
};
const referenceGrid = () => [...grid(-50e-6, 1e-7, 2000), ...grid(150e-6, 5e-7, 300).slice(1)];

// ---- Files ----
async function writeText(root: string, rel: string, text: string) {
  await mkdir(dirname(join(root, rel)), { recursive: true });
  await writeFile(join(root, rel), text);
}
const csvText = (header: string[], rows: Rows, delimiter = ",") =>
  `${[header.join(delimiter), ...rows.map((row) => row.map((value) => String(value)).join(delimiter))].join("\n")}\n`;
/** An ngspice-tool or ltspice-tool run folder as spec REQ-DATA-29b9a988 section 6 describes it. */
async function spiceFolder(
  root: string,
  rel: string,
  options: { kind?: string; analysis?: string; columns: string[]; rows: Rows },
) {
  const series = csvText(
    options.columns,
    options.rows.map((row) => row),
  );
  await writeText(root, `${rel}/series.csv`, series);
  const result = {
    format: 1,
    kind: options.kind ?? "ngspice-tool-result",
    tool: {
      name: options.kind === "ltspice-tool-result" ? "ltspice-tool" : "ngspice-tool",
      version: "1.0.0",
    },
    operation: "run",
    runId: rel.split("/").at(-1),
    startedAt: "2026-11-13T10:00:00.000Z",
    status: "ok",
    analysis: options.analysis ?? ".tran 1e-07 0.0003 -5e-05",
    series: { file: "series.csv", rows: options.rows.length, columns: options.columns },
    artifacts: [
      { kind: "series-csv", path: `${rel}/series.csv`, bytes: series.length, sha256: sha256(series) },
    ],
  };
  await writeText(root, `${rel}/result.json`, `${JSON.stringify(result, null, 2)}\n`);
}
async function requestFile(root: string, rel: string, request: Json) {
  await writeText(root, rel, JSON.stringify(request, null, 1));
  return rel;
}
const base = (extra: Json): Json => ({
  format: 1,
  title: "Synthetic",
  decisionRule: "guarded",
  missingData: "incomplete",
  ...extra,
});
const csvSource = (path: string, columns: Json = { v: { column: "v", unit: "V" } }, extra: Json = {}) => ({
  importer: "csv",
  path,
  time: { column: "t", unit: "s" },
  columns,
  ...extra,
});
async function treeHashes(dir: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (folder: string, prefix: string) => {
    for (const entry of await readdir(folder, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(join(folder, entry.name), rel);
      else out[rel] = sha256(await readFile(join(folder, entry.name)));
    }
  };
  await walk(dir, "");
  return out;
}

// ---- A real scpi-instruments capture folder (fake PyVISA, offline) ----
const SCOPE = "TCPIP0::10.0.0.5::INSTR";
async function scpiCapture(root: string, runId: string, faults: Json = {}, expected = 0) {
  await writeText(
    root,
    "lab/resources.json",
    JSON.stringify({
      format: 1,
      resources: [{ alias: "scope", kind: "visa", resource: SCOPE, profile: "rigol-ds1000z" }],
    }),
  );
  await writeText(
    root,
    "bench.json",
    JSON.stringify({
      resources: {
        [SCOPE]: { model: "ds1104z", idn: "RIGOL TECHNOLOGIES,DS1104Z,DS1ZA1,00.04.04.SP4", faults },
      },
    }),
  );
  const run = scpiRun(root, ["capture", "--instrument", "scope", "--channel", "CHAN1", "--run-id", runId]);
  expect(run.status, run.stderr + run.stdout).toBe(expected);
  return `embedded-lab-results/${runId}`;
}
function scpiRun(root: string, args: string[]) {
  return spawnSync(python, [scpiScript, ...args], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...baseEnv(),
      PYTHONPATH: fakePyvisa,
      PYTHONUTF8: "1",
      SCPI_REGISTRY: join(root, "lab", "resources.json"),
      FAKE_VISA_BENCH: join(root, "bench.json"),
      FAKE_VISA_STATE: join(root, "fake-state.json"),
    },
  });
}
/** The fake scope's samples: raw 255 and 0, then 127 + round(50 sin(2 pi i / 100)); v = (raw - 127) * 0.04 V. */
const capturedVolts = (i: number) => {
  if (i === 0) return (255 - 127) * 0.04;
  if (i === 1) return (0 - 127) * 0.04;
  // Python's round() rounds halves to even; no sample of this sine sits on a half.
  return Math.round(50 * Math.sin((2 * Math.PI * i) / 100)) * 0.04;
};

let root = "";
beforeAll(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-labval-")));
  await mkdir(join(root, ".vera"));
  await writeText(root, "data/sine.csv", csvText(["t", "v"], sine()));
  await writeText(root, "data/sine3k.csv", csvText(["t", "v"], sine(3000, 10e-3)));
  await writeText(root, "data/pwm.csv", csvText(["t", "v"], pwm()));
  await writeText(
    root,
    "data/pwm-mv.csv",
    csvText(
      ["time_ms", "out_mV"],
      pwm().map(([t, v]) => [(t as number) * 1e3, -(v as number) * 1e3]),
    ),
  );
  await writeText(root, "data/rc.csv", csvText(["t", "v"], rcStep()));
  await writeText(root, "data/second.csv", csvText(["t", "v"], secondOrder()));
  await writeText(root, "data/ripple.csv", csvText(["t", "v"], ripple()));
  await writeText(
    root,
    "data/const.csv",
    csvText(
      ["t", "v"],
      grid(0, 1e-6, 1000).map((t) => [t, 1]),
    ),
  );
  await writeText(
    root,
    "data/gap.csv",
    csvText(
      ["t", "v"],
      grid(0, 1e-6, 1000)
        .filter((t) => t < 400e-6 - 1e-12 || t > 600e-6 + 1e-12)
        .map((t) => [t, 1]),
    ),
  );
  await writeText(
    root,
    "data/measured-pulse.csv",
    csvText(
      ["t", "v"],
      grid(-50e-6, 1e-7, 3500).map((t) => [t, pulse(t - 30e-6)]),
    ),
  );
  await spiceFolder(root, "electronics-results/sim1", {
    columns: ["time", "v(out)", "i(Vsense)"],
    rows: referenceGrid().map((t) => [t, pulse(t), pulse(t) / 1000]),
  });
  await spiceFolder(root, "electronics-results/lt1", {
    kind: "ltspice-tool-result",
    analysis: ".tran 0 300u -50u",
    columns: ["time", "V(out)"],
    rows: referenceGrid().map((t) => [t, pulse(t)]),
  });
  // A simulation that starts at t = 0, as ngspice and LTspice runs do.
  await spiceFolder(root, "electronics-results/sim0", {
    analysis: ".tran 1e-07 0.0003",
    columns: ["time", "v(out)"],
    rows: [...grid(0, 1e-7, 1500), ...grid(150e-6, 5e-7, 300).slice(1)].map((t) => [t, pulse(t)]),
  });
  // Two steps of one source: in 0 -> 10 V at 20 us, out 0 -> 1 V at 50 us, the same RC shape (tau 10 us).
  const rc = (t: number, start: number, high: number) =>
    t < start ? 0 : high * (1 - Math.exp(-(t - start) / TAU));
  await writeText(
    root,
    "data/delay.csv",
    csvText(
      ["t", "in", "out"],
      Array.from({ length: 2001 }, (_, i) => [i * 1e-7, rc(i * 1e-7, 20e-6, 10), rc(i * 1e-7, 50e-6, 1)]),
    ),
  );
  // 1000 samples, a 20 s gap, 1000 more: the correlation work must not grow with the gap.
  await writeText(
    root,
    "data/xgap.csv",
    csvText(
      ["t", "v"],
      [...grid(0, 1e-6, 999), ...grid(20, 1e-6, 999)].map((t) => [t, Math.sin(2 * Math.PI * 7e3 * t)]),
    ),
  );
  // 5 V plus a 1 uV sine at 10 kHz; m lags r by 40 us.
  await writeText(
    root,
    "data/dc.csv",
    csvText(
      ["t", "m", "r"],
      grid(0, 1e-6, 2000).map((t) => [
        t,
        5 + 1e-6 * Math.sin(2 * Math.PI * 1e4 * (t - 40e-6)),
        5 + 1e-6 * Math.sin(2 * Math.PI * 1e4 * t),
      ]),
    ),
  );
  await writeText(root, "data/bom.csv", '\ufefft,v\r\n0,"1"\r\n0.001,1\r\n0.002,-nan\r\n0.003,1\r\n');
  await writeText(root, "data/huge.csv", "t,v\n0,1e200\n1,1\n");
  await writeText(root, "data/sigrok0.csv", "; Samplerate: 0 Hz\nA0\n1\n2\n");
  await writeText(root, "odd/result.json", "[1, 2]");
  await spiceFolder(root, "electronics-results/ac1", {
    analysis: ".ac dec 10 1 1e6",
    columns: ["frequency", "v(out) re", "v(out) im"],
    rows: [
      [1, 1, 0],
      [10, 0.9, -0.1],
    ],
  });
});
afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("package", () => {
  it("publishes the official lab-validation package, its pack, activity and two skills (REQ-DATA-e63e58bc)", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({
      id: "lab-validation",
      version: "1.0.0",
      ecosystem: "lab",
      platforms: ["windows-x64", "linux-x64"],
    });
    expect(m.programs["lab-validate"]).toMatchObject({ install: { script: "scripts/lab_validate.py" } });
    const header = readFileSync(script, "utf8");
    expect(header).toContain('requires-python = ">=3.11"');
    expect(header).toContain("dependencies = []");
    const catalog = parse(readFileSync(fileURLToPath(new URL("catalog.yaml", plugins)), "utf8"));
    expect(catalog.official).toContain("lab-validation");
    expect(catalog.metadata["lab-validation"].activities).toEqual(["measurement"]);
    const packs = parse(readFileSync(fileURLToPath(new URL("packs.yaml", plugins)), "utf8"));
    const lab = packs.find((pack: Json) => pack.id === "lab");
    expect(lab.groups).toContainEqual({
      name: "Measurement validation",
      plugins: ["lab-validation"],
      default: true,
    });
    expect(await core.checkCatalogSource(fileURLToPath(plugins))).toEqual([]);
    const temp = await realpath(await mkdtemp(join(tmpdir(), "vera-labval-pkg-")));
    try {
      const store = new core.PluginStore({ root: join(temp, "plugins") });
      await store.install(pluginFolder);
      const installed = await store.load("lab-validation");
      const skills = new core.SkillCatalog({
        root: temp,
        disabled: () => [],
        plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
      });
      const names = (await skills.list())
        .filter((skill) => skill.plugin === "lab-validation")
        .map((skill) => skill.name);
      expect(names.sort()).toEqual(["difference-explanation", "validation-planning"]);
      const planning = (await skills.read("plugin", "validation-planning")).content;
      for (const text of [
        "lab-validate compare",
        "decisionRule",
        "missingData",
        "window",
        "maxLag",
        "uncertainty",
      ])
        expect(planning).toContain(text);
      const explaining = (await skills.read("plugin", "difference-explanation")).content;
      for (const text of ["incomplete", "clipped", "bandwidth-limited", "lag-unjudged"])
        expect(explaining).toContain(text);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("classifies every lab-validate operation as safe (REQ-SEC-d84c7986)", () => {
    const rules = manifest().rules;
    for (const args of [
      ["--version"],
      ["--help"],
      ["inspect", "--path", "data/x.csv"],
      ["normalize", "--request", "v.json"],
      ["measure", "--request", "v.json"],
      ["align", "--request", "v.json"],
      ["compare", "--request", "v.json", "--run-id", "a"],
      ["report", "--run", "embedded-lab-results/a"],
    ]) {
      const decision = classifyCommand(rules, "lab-validate", args);
      expect(decision.risk, args.join(" ")).toBe("safe");
      if (args[0] !== "--version" && args[0] !== "--help") expect(decision.notes.join(" ")).not.toBe("");
    }
    // An unknown first argument matches no rule and falls to the default, which is not safe.
    expect(classifyCommand(rules, "lab-validate", ["shell"]).risk).toBe("device-write");
  });

  it("keeps the shared path module byte-identical to the electronics plugins' copy (REQ-SEC-68c33dd4)", async () => {
    const mine = await readFile(join(pluginFolder, "scripts", "lab_validation", "workspace.py"));
    const theirs = await readFile(
      fileURLToPath(new URL("ngspice/scripts/ngspice_support/workspace.py", plugins)),
    );
    expect(sha256(mine)).toBe(sha256(theirs));
  });

  it("imports no network or process module in its support package (REQ-SEC-58dd05f7)", async () => {
    const folder = join(pluginFolder, "scripts", "lab_validation");
    for (const name of await readdir(folder)) {
      if (!name.endsWith(".py") || name === "workspace.py") continue;
      const text = await readFile(join(folder, name), "utf8");
      for (const module of ["socket", "subprocess", "urllib", "http", "ssl", "asyncio", "multiprocessing"])
        expect(text, `${name} imports ${module}`).not.toMatch(
          new RegExp(`^\\s*(import|from)\\s+${module}\\b`, "m"),
        );
    }
  });
});

describe("command line and request (REQ-DATA-53797d16)", { timeout: 120_000 }, () => {
  it("prints its version and the registered importers and metrics", () => {
    const version = spawnSync(python, [script, "--version"], { encoding: "utf8", env: baseEnv() });
    expect(version.stdout.trim()).toMatch(/^lab-validate 1\.0\.0$/);
    const help = spawnSync(python, [script, "--help"], { encoding: "utf8", env: baseEnv() });
    expect(help.status).toBe(0);
    for (const name of [
      "scpi-capture",
      "csv",
      "sigrok-csv",
      "spice",
      "rms",
      "frequency",
      "duty-cycle",
      "rise-time",
      "fall-time",
      "overshoot",
      "settling-time",
      "ripple",
      "delay",
    ])
      expect(help.stdout).toContain(name);
    const unknown = lv(root, ["shell"]);
    expect(unknown.code).toBe(2);
  });

  it("refuses invalid requests with exit 2, the field named and no folder", async () => {
    const good = base({
      sources: { s: csvSource("data/const.csv") },
      signals: { v: { source: "s", channel: "v" } },
      measurements: [{ id: "m", signal: "v", metric: "mean", window: { from: "0 s", to: "1 ms" } }],
      criteria: [{ id: "C", value: "m", op: "<=", limit: "2 V", uncertainty: "0 V" }],
    });
    const cases: [Json, string][] = [
      [{ ...good, decisionRule: undefined }, "decisionRule"],
      [{ ...good, missingData: undefined }, "missingData"],
      [{ ...good, extra: 1 }, "extra"],
      [{ ...good, format: 2 }, "format"],
      [{ ...good, signals: { v: { source: "nope", channel: "v" } } }, "signals.v.source"],
      [{ ...good, measurements: [good.measurements[0], good.measurements[0]] }, "measurements[1].id"],
      [{ ...good, criteria: [{ id: "C", value: "m", op: "<=", limit: "2 s" }] }, "criteria[0].limit"],
      [{ ...good, criteria: [{ id: "C", value: "m", op: "==", limit: "1 V" }] }, "criteria[0].tolerance"],
      [{ ...good, criteria: [{ id: "C", value: "zz", op: "<=", limit: "1 V" }] }, "criteria[0].value"],
      [
        {
          ...good,
          measurements: [{ id: "m", signal: "v", metric: "mean", window: { from: "1 ms", to: "0 s" } }],
        },
        "measurements[0].window",
      ],
      [
        {
          ...good,
          measurements: [{ id: "m", signal: "v", metric: "magic", window: good.measurements[0].window }],
        },
        "metric",
      ],
    ];
    for (const [index, [request, field]] of cases.entries()) {
      const copy = JSON.parse(JSON.stringify(request));
      const rel = await requestFile(root, `requests/bad${index}.json`, copy);
      const run = lv(root, ["compare", "--request", rel, "--run-id", `bad${index}`]);
      expect(run.code, JSON.stringify(run.json)).toBe(2);
      expect(run.json.status).toBe("blocked");
      expect(JSON.stringify(run.json.problems)).toContain(field);
      expect(existsSync(join(root, "embedded-lab-results", `bad${index}`))).toBe(false);
    }
    await writeText(root, "requests/dup.json", '{"format": 1, "format": 1}');
    expect(lv(root, ["compare", "--request", "requests/dup.json"]).code).toBe(2);
    const noCriteria = await requestFile(root, "requests/nocrit.json", { ...good, criteria: [] });
    expect(lv(root, ["compare", "--request", noCriteria]).code).toBe(2);
    expect(lv(root, ["measure", "--request", noCriteria, "--run-id", "nocrit"]).code).toBe(0);
  });

  it("confines paths to the working directory and keeps results out of .vera (REQ-SEC-68c33dd4)", async () => {
    const outside = await realpath(await mkdtemp(join(tmpdir(), "vera-labval-out-")));
    try {
      await writeText(outside, "x.csv", csvText(["t", "v"], [[0, 1]]));
      const request = (path: string) =>
        base({
          sources: { s: csvSource(path) },
          signals: { v: { source: "s", channel: "v" } },
          measurements: [{ id: "m", signal: "v", metric: "mean", window: { from: "0 s", to: "1 ms" } }],
        });
      for (const [index, path] of [join(outside, "x.csv"), "../x.csv"].entries()) {
        const rel = await requestFile(root, `requests/out${index}.json`, request(path));
        const run = lv(root, ["measure", "--request", rel]);
        expect(run.code).toBe(2);
        expect(run.json.problems[0].code).toBe("path");
      }
      expect(lv(root, ["inspect", "--path", join(outside, "x.csv")]).code).toBe(2);
      const inside = await requestFile(root, "requests/in.json", request("data/const.csv"));
      const vera = lv(root, ["measure", "--request", inside, "--results-dir", ".vera/results"]);
      expect(vera.code).toBe(2);
      expect(vera.json.problems[0].code).toBe("path");
      const run = lv(root, ["report", "--run", outside]);
      expect(run.code).toBe(2);
      expect(run.json.problems[0].code).toBe("path");
      expect(existsSync(join(root, ".vera", "results"))).toBe(false);
      if (!windows) {
        await symlink(join(outside, "x.csv"), join(root, "data", "link.csv"));
        const linked = await requestFile(root, "requests/link.json", request("data/link.csv"));
        expect(lv(root, ["measure", "--request", linked]).code).toBe(2);
      }
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });
});

describe("importers", { timeout: 120_000 }, () => {
  it("imports a real scpi-instruments capture with its clipping and captured conditions (REQ-FUNC-8342826a)", async () => {
    const capture = await scpiCapture(root, "cap1");
    const request = await requestFile(
      root,
      "requests/capture.json",
      base({
        sources: { scope: { importer: "scpi-capture", path: capture, bandwidth: "100 MHz" } },
        signals: { ch1: { source: "scope", channel: "CHAN1" } },
        measurements: [
          { id: "f", signal: "ch1", metric: "frequency", window: { from: "-590 us", to: "590 us" } },
          { id: "vrms", signal: "ch1", metric: "rms", window: { from: "-500 us", to: "500 us" } },
          { id: "early", signal: "ch1", metric: "max", window: { from: "-600 us", to: "-500 us" } },
        ],
      }),
    );
    const run = lv(root, ["measure", "--request", request, "--run-id", "m-cap"]);
    const result = resultOf(root, run);
    expect(result.kind).toBe("lab-validation-result");
    const signal = result.signals.find((s: Json) => s.id === "ch1");
    expect(signal).toMatchObject({ points: 1200, unit: "V", uniform: true, clipped: 2 });
    expect(signal.rate).toBeCloseTo(1e6, 3);
    const source = result.sources.find((s: Json) => s.id === "scope");
    expect(source.captured).toMatchObject({ probe: 10, bandwidthLimit: "OFF" });
    expect(source.identity).toMatchObject({ model: "DS1104Z" });
    expect(source.timeZero).toContain("trigger");
    const byId = Object.fromEntries(result.measurements.map((m: Json) => [m.id, m]));
    expect(close(byId.f.value, 10_000, 1e-6)).toBe(true);
    let sum = 0;
    for (let i = 100; i < 1100; i += 1) sum += capturedVolts(i) ** 2;
    expect(close(byId.vrms.value, Math.sqrt(sum / 1000), 1e-9)).toBe(true);
    expect(byId.f.diagnostics).toEqual([]);
    expect(byId.early.diagnostics).toContain("clipped");
    expect(run.code).toBe(3);
    // A folder of another kind is refused.
    await spiceFolder(root, "embedded-lab-results/not-a-capture", {
      columns: ["time", "v(a)"],
      rows: [[0, 0]],
    });
    const wrong = await requestFile(
      root,
      "requests/wrongkind.json",
      base({
        sources: { scope: { importer: "scpi-capture", path: "embedded-lab-results/not-a-capture" } },
        signals: { ch1: { source: "scope", channel: "CHAN1" } },
      }),
    );
    expect(lv(root, ["normalize", "--request", wrong]).code).toBe(2);
  });

  it("imports CSV with a declared mapping, a tab export and a sigrok-cli CSV (REQ-FUNC-0c057a2b)", async () => {
    await writeText(
      root,
      "data/lt-export.txt",
      csvText(
        ["time", "V(out)"],
        referenceGrid().map((t) => [t, pulse(t)]),
        "\t",
      ),
    );
    await writeText(
      root,
      "data/sigrok.csv",
      [
        "; CSV generated by libsigrok 0.5.2 from demo",
        "; Channels (1/1): A0",
        "; Samplerate: 100 kHz",
        "A0",
        ...sine().map(([, v]) => String(v)),
        "",
      ].join("\n"),
    );
    await writeText(root, "data/missing.csv", "t,v\n0,1\n0.001,\n0.002,nan\n0.003,1\n");
    await writeText(root, "data/text.csv", "t,v\n0,1\n0.001,high\n");
    await writeText(root, "data/back.csv", "t,v\n0,1\n0.002,1\n0.001,1\n");
    const request = await requestFile(
      root,
      "requests/csv.json",
      base({
        sources: {
          lt: {
            importer: "csv",
            path: "data/lt-export.txt",
            delimiter: "\t",
            uniform: false,
            time: { column: "time", unit: "s" },
            columns: { out: { column: "V(out)", unit: "V" } },
          },
          sr: {
            importer: "sigrok-csv",
            path: "data/sigrok.csv",
            columns: { a0: { column: "A0", unit: "V" } },
          },
          miss: csvSource("data/missing.csv"),
        },
        signals: {
          lt: { source: "lt", channel: "out" },
          sr: { source: "sr", channel: "a0" },
          miss: { source: "miss", channel: "v" },
        },
        measurements: [
          { id: "f", signal: "sr", metric: "frequency", window: { from: "0.25 ms", to: "5.25 ms" } },
        ],
      }),
    );
    const run = lv(root, ["measure", "--request", request, "--run-id", "csv1"]);
    expect(run.code, JSON.stringify(run.json)).toBe(0);
    const result = resultOf(root, run);
    const signals = Object.fromEntries(result.signals.map((s: Json) => [s.id, s]));
    expect(signals.lt).toMatchObject({ points: referenceGrid().length, uniform: false });
    expect(signals.sr).toMatchObject({ points: 1001, uniform: true });
    expect(signals.sr.rate).toBeCloseTo(1e5, 3);
    expect(signals.miss.points).toBe(2);
    expect(signals.miss.gaps).toEqual([[0, 0.003]]);
    expect(close(result.measurements[0].value, 1000, 1e-6)).toBe(true);
    for (const [file, text] of [
      ["data/text.csv", "row 3"],
      ["data/back.csv", "row 4"],
    ]) {
      const bad = await requestFile(
        root,
        "requests/badcsv.json",
        base({ sources: { s: csvSource(file as string) }, signals: { v: { source: "s", channel: "v" } } }),
      );
      const refused = lv(root, ["normalize", "--request", bad]);
      expect(refused.code).toBe(2);
      expect(JSON.stringify(refused.json.problems)).toContain(text);
    }
  });

  it("imports ngspice and ltspice run folders without either plugin and refuses AC data (REQ-FUNC-b1992f05, REQ-REL-47103659)", async () => {
    const request = await requestFile(
      root,
      "requests/spice.json",
      base({
        sources: {
          ng: { importer: "spice", path: "electronics-results/sim1" },
          lt: { importer: "spice", path: "electronics-results/lt1" },
        },
        signals: {
          out: { source: "ng", channel: "v(out)" },
          cur: { source: "ng", channel: "i(Vsense)" },
          lt: { source: "lt", channel: "V(out)" },
        },
        measurements: [{ id: "vmax", signal: "lt", metric: "max", window: { from: "0 s", to: "200 us" } }],
      }),
    );
    const run = lv(root, ["measure", "--request", request, "--run-id", "spice1"]);
    expect(run.code, JSON.stringify(run.json)).toBe(0);
    const result = resultOf(root, run);
    const signals = Object.fromEntries(result.signals.map((s: Json) => [s.id, s]));
    expect(signals.out).toMatchObject({ unit: "V", uniform: false });
    expect(signals.cur.unit).toBe("A");
    expect(result.sources.find((s: Json) => s.id === "ng")).toMatchObject({
      bandwidth: "unlimited",
      domain: "time",
    });
    expect(close(result.measurements[0].value, pulse(100e-6), 1e-12)).toBe(true);
    const ac = await requestFile(
      root,
      "requests/ac.json",
      base({
        sources: { ac: { importer: "spice", path: "electronics-results/ac1" } },
        signals: { out: { source: "ac", channel: "v(out) re" } },
      }),
    );
    const refused = lv(root, ["normalize", "--request", ac]);
    expect(refused.code).toBe(2);
    expect(refused.json.problems[0].code).toBe("domain");
    const mixed = await requestFile(
      root,
      "requests/mixed.json",
      base({
        sources: { ng: { importer: "spice", path: "electronics-results/sim1" } },
        signals: { out: { source: "ng", channel: "v(out)" }, cur: { source: "ng", channel: "i(Vsense)" } },
        comparisons: [
          {
            id: "x",
            signal: "out",
            reference: "cur",
            window: { from: "0 s", to: "1 us" },
            alignment: { method: "none" },
          },
        ],
      }),
    );
    expect(lv(root, ["align", "--request", mixed]).json.problems[0].code).toBe("quantity");
    const clock = await requestFile(
      root,
      "requests/clock.json",
      base({
        sources: {
          ng: { importer: "spice", path: "electronics-results/sim1" },
          m: csvSource("data/measured-pulse.csv"),
        },
        signals: { out: { source: "ng", channel: "v(out)" }, meas: { source: "m", channel: "v" } },
        measurements: [
          {
            id: "d",
            signal: "meas",
            metric: "delay",
            reference: "out",
            window: { from: "0 s", to: "200 us" },
          },
        ],
      }),
    );
    expect(lv(root, ["measure", "--request", clock]).json.problems[0].code).toBe("clock");
  });

  it("refuses a source that differs from its recorded or requested hash (REQ-REL-586aef68)", async () => {
    const capture = await scpiCapture(root, "cap-tamper");
    const csvPath = join(root, capture, "waveform-CHAN1.csv");
    const text = readFileSync(csvPath, "utf8");
    await writeFile(csvPath, text.replace("\n-0.0006,", "\n-0.0006,0"));
    const tampered = await requestFile(
      root,
      "requests/tamper.json",
      base({
        sources: { scope: { importer: "scpi-capture", path: capture } },
        signals: { ch1: { source: "scope", channel: "CHAN1" } },
      }),
    );
    const run = lv(root, ["normalize", "--request", tampered, "--run-id", "tamper"]);
    expect(run.code).toBe(2);
    expect(run.json.problems[0].code).toBe("source-changed");
    expect(existsSync(join(root, "embedded-lab-results", "tamper"))).toBe(false);
    const wrongHash = await requestFile(
      root,
      "requests/wronghash.json",
      base({
        sources: { s: csvSource("data/const.csv", undefined, { sha256: "0".repeat(64) }) },
        signals: { v: { source: "s", channel: "v" } },
      }),
    );
    expect(lv(root, ["normalize", "--request", wrongHash]).json.problems[0].code).toBe("source-changed");
    const rightHash = await requestFile(
      root,
      "requests/righthash.json",
      base({
        sources: {
          s: csvSource("data/const.csv", undefined, {
            sha256: sha256(readFileSync(join(root, "data/const.csv"))),
          }),
        },
        signals: { v: { source: "s", channel: "v" } },
      }),
    );
    expect(lv(root, ["normalize", "--request", rightHash]).code).toBe(0);
  });
});

describe("normalization and metrics (L02-A, L02-B)", { timeout: 120_000 }, () => {
  it("normalizes mV/V and ms/s with an explicit sign and reports the mapping (REQ-FUNC-c19cf2d1)", async () => {
    const request = await requestFile(
      root,
      "requests/units.json",
      base({
        sources: {
          si: csvSource("data/pwm.csv"),
          milli: {
            importer: "csv",
            path: "data/pwm-mv.csv",
            time: { column: "time_ms", unit: "ms" },
            columns: { out: { column: "out_mV", unit: "mV" } },
          },
        },
        signals: { si: { source: "si", channel: "v" }, milli: { source: "milli", channel: "out", sign: -1 } },
        measurements: ["si", "milli"].flatMap((signal) => [
          { id: `${signal}-f`, signal, metric: "frequency", window: { from: "50 us", to: "950 us" } },
          { id: `${signal}-d`, signal, metric: "duty-cycle", window: { from: "50 us", to: "950 us" } },
        ]),
      }),
    );
    const run = lv(root, ["normalize", "--request", request, "--run-id", "units"]);
    expect(run.code, JSON.stringify(run.json)).toBe(0);
    const si = readFileSync(join(root, "embedded-lab-results/units/series-si.csv"), "utf8")
      .trim()
      .split("\n");
    const milli = readFileSync(join(root, "embedded-lab-results/units/series-milli.csv"), "utf8")
      .trim()
      .split("\n");
    expect(si[0]).toBe("time_s,si_V");
    expect(milli[0]).toBe("time_s,milli_V");
    expect(milli).toHaveLength(si.length);
    for (const index of [1, 6, 150, 305, 9000]) {
      const [ta, va] = (si[index] as string).split(",").map(Number);
      const [tb, vb] = (milli[index] as string).split(",").map(Number);
      expect(close(tb as number, ta as number, 1e-12)).toBe(true);
      expect(Math.abs((vb as number) - (va as number))).toBeLessThan(1e-12);
    }
    const result = resultOf(root, run);
    const milliSignal = result.signals.find((s: Json) => s.id === "milli");
    expect(milliSignal).toMatchObject({ channel: "out", unit: "V", sign: -1, scale: 1 });
    expect(milliSignal.mapping).toMatchObject({
      column: "out_mV",
      unit: "mV",
      time: { column: "time_ms", unit: "ms" },
    });
    const report = readFileSync(join(root, "embedded-lab-results/units/report.md"), "utf8");
    expect(report).toContain("out_mV");
    expect(report).toContain("sign -1");
    const measured = lv(root, ["measure", "--request", request, "--run-id", "units-m"]);
    const byId = Object.fromEntries(resultOf(root, measured).measurements.map((m: Json) => [m.id, m.value]));
    for (const signal of ["si", "milli"]) {
      expect(close(byId[`${signal}-f`], 10_000, 1e-6)).toBe(true);
      expect(close(byId[`${signal}-d`], 30, 1e-6)).toBe(true);
    }
  });

  it("computes the metrics against the README's independent solutions (REQ-FUNC-a9ddc5de, L02-A)", async () => {
    const request = await requestFile(
      root,
      "requests/metrics.json",
      base({
        sources: {
          sine: csvSource("data/sine.csv"),
          pwm: csvSource("data/pwm.csv", undefined, { bandwidth: "100 MHz" }),
          rc: csvSource("data/rc.csv", undefined, { bandwidth: "100 MHz" }),
          second: csvSource("data/second.csv"),
          ripple: csvSource("data/ripple.csv"),
        },
        signals: Object.fromEntries(
          ["sine", "pwm", "rc", "second", "ripple"].map((id) => [id, { source: id, channel: "v" }]),
        ),
        measurements: [
          { id: "sine-rms", signal: "sine", metric: "rms", window: { from: "0.25 ms", to: "5.25 ms" } },
          { id: "sine-mean", signal: "sine", metric: "mean", window: { from: "0.25 ms", to: "5.25 ms" } },
          { id: "sine-f", signal: "sine", metric: "frequency", window: { from: "0.25 ms", to: "5.25 ms" } },
          { id: "pwm-f", signal: "pwm", metric: "frequency", window: { from: "50 us", to: "950 us" } },
          { id: "pwm-d", signal: "pwm", metric: "duty-cycle", window: { from: "50 us", to: "950 us" } },
          { id: "pwm-tr", signal: "pwm", metric: "rise-time", window: { from: "50 us", to: "950 us" } },
          { id: "pwm-tf", signal: "pwm", metric: "fall-time", window: { from: "50 us", to: "950 us" } },
          {
            id: "rc-tr",
            signal: "rc",
            metric: "rise-time",
            window: { from: "-20 us", to: "200 us" },
            levels: { low: "0 V", high: "5 V" },
          },
          {
            id: "rc-ts",
            signal: "rc",
            metric: "settling-time",
            window: { from: "-20 us", to: "200 us" },
            levels: { low: "0 V", high: "5 V" },
            band: "2 %",
          },
          {
            id: "rc-ts-short",
            signal: "rc",
            metric: "settling-time",
            window: { from: "-20 us", to: "30 us" },
            levels: { low: "0 V", high: "5 V" },
            band: "100 mV",
          },
          {
            id: "os",
            signal: "second",
            metric: "overshoot",
            window: { from: "0 s", to: "500 us" },
            levels: { low: "0 V", high: "1 V" },
          },
          { id: "rip", signal: "ripple", metric: "ripple", window: { from: "100 us", to: "200 us" } },
          { id: "rip-mean", signal: "ripple", metric: "mean", window: { from: "100 us", to: "200 us" } },
          { id: "outside", signal: "sine", metric: "max", window: { from: "9 ms", to: "11 ms" } },
        ],
      }),
    );
    const run = lv(root, ["measure", "--request", request, "--run-id", "metrics"]);
    const result = resultOf(root, run);
    const m = Object.fromEntries(result.measurements.map((x: Json) => [x.id, x]));
    const expectClose = (id: string, expected: number, rel: number) =>
      expect(close(m[id].value, expected, rel), `${id}: ${m[id].value} vs ${expected}`).toBe(true);
    expectClose("sine-rms", 2 / Math.SQRT2, 1e-6);
    expect(Math.abs(m["sine-mean"].value)).toBeLessThan(1e-9);
    expectClose("sine-f", 1000, 1e-6);
    expectClose("pwm-f", 10_000, 1e-6);
    expectClose("pwm-d", 30, 1e-6);
    expectClose("pwm-tr", 0.8e-6, 1e-6);
    expectClose("pwm-tf", 0.8e-6, 1e-6);
    expect(m["pwm-tr"].levels).toMatchObject({
      low: 0,
      high: 3.3,
      source: expect.stringContaining("derived"),
    });
    expectClose("rc-tr", TAU * Math.log(9), 1e-4);
    expect(m["rc-tr"].levels.source).toBe("declared");
    expectClose("rc-ts", TAU * Math.log(25), 1e-4);
    expect(m["rc-ts"].status).toBe("ok");
    expect(m["rc-ts-short"].status).toBe("bound");
    expectClose("rc-ts-short", 30e-6 - TAU * Math.LN2, 1e-4);
    expect(Math.abs(m.os.value - 100 * Math.exp((-0.5 * Math.PI) / Math.sqrt(0.75)))).toBeLessThan(0.001);
    expectClose("rip", 0.02, 1e-6);
    expectClose("rip-mean", 3.3, 1e-6);
    expect(m.outside).toMatchObject({ status: "unknown", value: null });
    expect(m.outside.reason).toContain("window");
    for (const id of ["pwm-tr", "rc-tr", "rc-ts", "os", "rip", "sine-f"]) expect(m[id].unit).toBeDefined();
    expect(m["pwm-d"].unit).toBe("%");
    expect(m["rc-tr"].unit).toBe("s");
    expect(result.definitions["rise-time"]).toContain("10");
    expect(result.definitions.ripple).toContain("steady state");
    expect(run.code).toBe(3);
  });

  it("resamples and filters only as declared and reports each step (REQ-FUNC-257ed295)", async () => {
    const request = await requestFile(
      root,
      "requests/pre.json",
      base({
        sources: {
          gap: csvSource("data/gap.csv"),
          pwm: csvSource("data/pwm.csv", undefined, { bandwidth: "100 MHz" }),
        },
        signals: {
          gap: {
            source: "gap",
            channel: "v",
            preprocess: [{ resample: { method: "linear", rate: "2 MHz" } }],
          },
          pwm: {
            source: "pwm",
            channel: "v",
            preprocess: [{ filter: { kind: "moving-average", width: "0.5 us" } }],
          },
          down: {
            source: "pwm",
            channel: "v",
            preprocess: [{ resample: { method: "linear", rate: "1 MHz" } }],
          },
        },
        measurements: [
          { id: "tr", signal: "pwm", metric: "rise-time", window: { from: "50 us", to: "950 us" } },
        ],
      }),
    );
    const run = lv(root, ["normalize", "--request", request, "--run-id", "pre"]);
    const result = resultOf(root, run);
    const signals = Object.fromEntries(result.signals.map((s: Json) => [s.id, s]));
    expect(signals.gap.preprocessing[0]).toMatchObject({ step: "resample", method: "linear", rate: 2e6 });
    const rows = readFileSync(join(root, "embedded-lab-results/pre/series-gap.csv"), "utf8")
      .trim()
      .split("\n")
      .slice(1);
    const times = rows.map((row) => Number(row.split(",")[0]));
    expect(times.some((t) => t > 400e-6 + 1e-9 && t < 600e-6 - 1e-9)).toBe(false);
    expect(signals.gap.gaps).toHaveLength(1);
    expect(signals.pwm.preprocessing[0]).toMatchObject({
      step: "filter",
      kind: "moving-average",
      samples: 5,
    });
    expect(signals.pwm.preprocessing[0].firstNull).toBeCloseTo(2e6, 0);
    expect(signals.pwm.preprocessing[0].cutoff3dB).toBeCloseTo(0.443 / 0.5e-6, 0);
    expect(signals.pwm.points).toBe(10001 - 4);
    expect(signals.down.diagnostics).toContain("aliasing-risk");
    const report = readFileSync(join(root, "embedded-lab-results/pre/report.md"), "utf8");
    expect(report).toContain("moving-average");
    expect(report).toContain("resample");
    const irregular = await requestFile(
      root,
      "requests/irregular.json",
      base({
        sources: { ng: { importer: "spice", path: "electronics-results/sim1" } },
        signals: {
          out: {
            source: "ng",
            channel: "v(out)",
            preprocess: [{ filter: { kind: "moving-average", width: "1 us" } }],
          },
        },
      }),
    );
    const refused = lv(root, ["normalize", "--request", irregular]);
    expect(refused.code).toBe(2);
    expect(JSON.stringify(refused.json.problems)).toContain("resample");
  });
});

describe("alignment, decisions and diagnostics", { timeout: 180_000 }, () => {
  const pulseRequest = (extra: Json = {}) =>
    base({
      requirement: "REQ-DEMO-1",
      sources: {
        meas: csvSource("data/measured-pulse.csv", undefined, { conditions: { load: "1 kohm" } }),
        sim: { importer: "spice", path: "electronics-results/sim1", conditions: { load: "1000 ohm" } },
      },
      conditions: { load: "1 kohm" },
      signals: { out: { source: "meas", channel: "v" }, ref: { source: "sim", channel: "v(out)" } },
      comparisons: [
        {
          id: "xc",
          signal: "out",
          reference: "ref",
          window: { from: "0 s", to: "250 us" },
          alignment: { method: "cross-correlation", maxLag: "100 us" },
        },
        {
          id: "raw",
          signal: "out",
          reference: "ref",
          window: { from: "0 s", to: "250 us" },
          alignment: { method: "none" },
        },
      ],
      criteria: [
        { id: "shape", value: "xc.max-abs", op: "<=", limit: "50 mV", uncertainty: "1 mV" },
        { id: "lag", value: "xc.lag", op: "==", limit: "0 s", tolerance: "10 us", uncertainty: "0.1 us" },
        { id: "unaligned", value: "raw.max-abs", op: "<=", limit: "50 mV", uncertainty: "1 mV" },
      ],
      ...extra,
    });

  it("keeps a lag above its limit failing although cross-correlation aligns the curves (REQ-FUNC-2f239a32, REQ-FUNC-698c34a2, L02-D)", async () => {
    const request = await requestFile(root, "requests/pulse.json", pulseRequest());
    const run = lv(root, ["compare", "--request", request, "--run-id", "lag"]);
    expect(run.code).toBe(1);
    expect(run.json.verdict).toBe("fail");
    const result = resultOf(root, run);
    const comparison = Object.fromEntries(result.comparisons.map((c: Json) => [c.id, c]));
    expect(Math.abs(comparison.xc.alignment.lag - 30e-6)).toBeLessThan(0.1e-6);
    expect(comparison.xc.statistics["max-abs"]).toBeLessThan(5e-3);
    expect(comparison.xc.statistics.correlation).toBeGreaterThan(0.999);
    expect(comparison.raw.statistics["max-abs"]).toBeGreaterThan(4);
    expect(comparison.raw.alignment.note).toContain("own time zero");
    const criteria = Object.fromEntries(result.criteria.map((c: Json) => [c.id, c]));
    expect(criteria.shape.status).toBe("pass");
    expect(criteria.lag.status).toBe("fail");
    expect(criteria.lag.limit).toBe("0 s");
    expect(criteria.lag.tolerance).toBe("10 us");
    expect(criteria.unaligned.status).toBe("fail");
    for (const file of ["compare-xc.csv", "compare-xc.svg", "compare-raw.csv", "report.md", "result.json"])
      expect(existsSync(join(root, "embedded-lab-results/lag", file)), file).toBe(true);
    const csv = readFileSync(join(root, "embedded-lab-results/lag/compare-xc.csv"), "utf8").split("\n");
    expect(csv[0]).toBe("time_s,measured,reference,difference");
    // Without a criterion on its lag, a cross-correlation adds lag-unjudged; a bound at maxLag gives lag-at-limit.
    const unjudged = await requestFile(
      root,
      "requests/unjudged.json",
      pulseRequest({
        criteria: [{ id: "shape", value: "xc.max-abs", op: "<=", limit: "50 mV", uncertainty: "1 mV" }],
      }),
    );
    const passRun = lv(root, ["compare", "--request", unjudged, "--run-id", "unjudged"]);
    expect(passRun.json.verdict).toBe("pass");
    expect(resultOf(root, passRun).diagnostics.map((d: Json) => d.code)).toContain("lag-unjudged");
    const bounded = pulseRequest();
    bounded.comparisons[0].alignment.maxLag = "20 us";
    bounded.criteria = [{ id: "shape", value: "xc.max-abs", op: "<=", limit: "50 mV", uncertainty: "1 mV" }];
    const atLimit = lv(root, [
      "compare",
      "--request",
      await requestFile(root, "requests/bound.json", bounded),
      "--run-id",
      "bound",
    ]);
    expect(atLimit.json.verdict).toBe("incomplete");
    expect(resultOf(root, atLimit).comparisons[0].diagnostics).toContain("lag-at-limit");
  });

  it("aligns by declared markers on each source's own signal, never across sources (REQ-FUNC-2f239a32)", async () => {
    const marker = pulseRequest({
      comparisons: [
        {
          id: "mk",
          signal: "out",
          reference: "ref",
          window: { from: "0 s", to: "250 us" },
          alignment: {
            method: "marker",
            // One absolute level on both sides: a percentage is of each signal's own derived levels, which differ.
            measured: { signal: "out", level: "2.5 V", edge: "rising" },
            reference: { signal: "ref", level: "2.5 V", edge: "rising" },
          },
        },
      ],
      criteria: [{ id: "shape", value: "mk.max-abs", op: "<=", limit: "50 mV", uncertainty: "1 mV" }],
    });
    const run = lv(root, [
      "compare",
      "--request",
      await requestFile(root, "requests/marker.json", marker),
      "--run-id",
      "marker",
    ]);
    const result = resultOf(root, run);
    expect(Math.abs(result.comparisons[0].alignment.lag - 30e-6)).toBeLessThan(0.01e-6);
    expect(result.comparisons[0].alignment.measured).toMatchObject({
      signal: "out",
      levelValue: 2.5,
      edge: "rising",
    });
    expect(result.criteria[0].status).toBe("pass");
    marker.comparisons[0].alignment.measured.signal = "ref";
    const refused = lv(root, [
      "compare",
      "--request",
      await requestFile(root, "requests/marker2.json", marker),
    ]);
    expect(refused.code).toBe(2);
    expect(refused.json.problems[0].code).toBe("clock");
  });

  it("decides each criterion by its rule, uncertainty and tolerance (REQ-FUNC-698c34a2)", async () => {
    const request = await requestFile(
      root,
      "requests/decide.json",
      base({
        sources: { s: csvSource("data/const.csv") },
        signals: { v: { source: "s", channel: "v" } },
        measurements: [
          { id: "m", signal: "v", metric: "mean", window: { from: "0 s", to: "1 ms" } },
          {
            id: "ts",
            signal: "v",
            metric: "settling-time",
            window: { from: "0 s", to: "1 ms" },
            band: "1 mV",
            final: "2 V",
            from: "0 s",
          },
        ],
        criteria: [
          { id: "g-pass", value: "m", op: "<=", limit: "1.05 V", uncertainty: "0.02 V" },
          { id: "g-straddle", value: "m", op: "<=", limit: "1.01 V", uncertainty: "0.02 V" },
          { id: "s-straddle", value: "m", op: "<=", limit: "1.01 V", uncertainty: "0.02 V", rule: "simple" },
          { id: "g-fail", value: "m", op: "<=", limit: "0.97 V", uncertainty: "0.02 V" },
          { id: "g-none", value: "m", op: "<=", limit: "2 V" },
          { id: "s-none", value: "m", op: "<=", limit: "2 V", rule: "simple" },
          { id: "ge", value: "m", op: ">=", limit: "0.5 V", uncertainty: "2 %" },
          { id: "eq", value: "m", op: "==", limit: "1.02 V", tolerance: "1 %", rule: "simple" },
          { id: "eq-in", value: "m", op: "==", limit: "1 V", tolerance: "10 mV", uncertainty: "1 mV" },
          { id: "bound-fail", value: "ts", op: "<=", limit: "100 us", uncertainty: "0 s" },
          { id: "bound-open", value: "ts", op: "<=", limit: "5 ms", uncertainty: "0 s" },
          { id: "on-limit", value: "m", op: "<=", limit: "1 V", uncertainty: "0 V" },
          { id: "on-limit-ge", value: "m", op: ">=", limit: "1 V", rule: "simple" },
          { id: "on-limit-u", value: "m", op: "<=", limit: "1 V", uncertainty: "1 mV" },
        ],
      }),
    );
    const run = lv(root, ["compare", "--request", request, "--run-id", "decide"]);
    const result = resultOf(root, run);
    const status = Object.fromEntries(result.criteria.map((c: Json) => [c.id, c.status]));
    expect(status).toEqual({
      "g-pass": "pass",
      "g-straddle": "incomplete",
      "s-straddle": "pass",
      "g-fail": "fail",
      "g-none": "incomplete",
      "s-none": "pass",
      ge: "pass",
      eq: "fail",
      "eq-in": "pass",
      "bound-fail": "fail",
      "bound-open": "incomplete",
      "on-limit": "pass",
      "on-limit-ge": "pass",
      "on-limit-u": "incomplete",
    });
    const reasons = Object.fromEntries(result.criteria.map((c: Json) => [c.id, c.reasons.join(" ")]));
    expect(reasons["g-none"]).toContain("uncertainty");
    expect(result.verdict).toBe("fail");
    expect(run.code).toBe(1);
    expect(result.measurements.find((x: Json) => x.id === "ts").status).toBe("bound");
  });

  it("limits the verdict on gaps, clipping, aliasing, band and conditions (REQ-REL-851774fc, L02-E)", async () => {
    const capture = await scpiCapture(root, "cap-diag");
    const request = await requestFile(
      root,
      "requests/diag.json",
      base({
        conditions: { vin: "5 V" },
        sources: {
          gap: csvSource("data/gap.csv", undefined, { conditions: { vin: "5 V" } }),
          scope: {
            importer: "scpi-capture",
            path: capture,
            bandwidth: "100 MHz",
            conditions: { vin: "5 V" },
          },
          slow: csvSource("data/sine3k.csv", undefined, { conditions: { vin: "5 V" } }),
          nobw: csvSource("data/pwm.csv", undefined, { conditions: { vin: "5 V" } }),
          lowbw: csvSource("data/pwm.csv", undefined, { bandwidth: "1 MHz", conditions: { vin: "5 V" } }),
          okbw: csvSource("data/pwm.csv", undefined, { bandwidth: "100 MHz", conditions: { vin: "5 V" } }),
          nocond: csvSource("data/const.csv"),
          othercond: csvSource("data/const.csv", undefined, { conditions: { vin: "3.3 V" } }),
          samecond: csvSource("data/const.csv", undefined, { conditions: { vin: "5000 mV" } }),
        },
        signals: Object.fromEntries(
          ["gap", "slow", "nobw", "lowbw", "okbw", "nocond", "othercond", "samecond"]
            .map((id) => [id, { source: id, channel: "v" }])
            .concat([["ch1", { source: "scope", channel: "CHAN1" }]]),
        ),
        measurements: [
          { id: "gap-mean", signal: "gap", metric: "mean", window: { from: "0 s", to: "1 ms" } },
          { id: "clip-max", signal: "ch1", metric: "max", window: { from: "-600 us", to: "0 s" } },
          { id: "clean-max", signal: "ch1", metric: "max", window: { from: "-590 us", to: "0 s" } },
          { id: "alias-f", signal: "slow", metric: "frequency", window: { from: "0.25 ms", to: "5.25 ms" } },
          ...["nobw", "lowbw", "okbw"].map((id) => ({
            id: `${id}-tr`,
            signal: id,
            metric: "rise-time",
            window: { from: "50 us", to: "950 us" },
          })),
          ...["nocond", "othercond", "samecond"].map((id) => ({
            id: `${id}-mean`,
            signal: id,
            metric: "mean",
            window: { from: "0 s", to: "1 ms" },
          })),
        ],
        criteria: [
          { id: "gap", value: "gap-mean", op: "<=", limit: "2 V", uncertainty: "0 V" },
          { id: "clip", value: "clip-max", op: "<=", limit: "10 V", uncertainty: "0 V" },
          { id: "clean", value: "clean-max", op: "<=", limit: "10 V", uncertainty: "0 V" },
          { id: "alias", value: "alias-f", op: "<=", limit: "2 kHz", uncertainty: "0 Hz" },
          { id: "nobw", value: "nobw-tr", op: "<=", limit: "1 us", uncertainty: "0 s" },
          { id: "lowbw", value: "lowbw-tr", op: "<=", limit: "1 us", uncertainty: "0 s" },
          { id: "okbw", value: "okbw-tr", op: "<=", limit: "1 us", uncertainty: "0 s" },
          { id: "nocond", value: "nocond-mean", op: "<=", limit: "2 V", uncertainty: "0 V" },
          { id: "othercond", value: "othercond-mean", op: "<=", limit: "2 V", uncertainty: "0 V" },
          { id: "samecond", value: "samecond-mean", op: "<=", limit: "2 V", uncertainty: "0 V" },
        ],
      }),
    );
    const run = lv(root, ["compare", "--request", request, "--run-id", "diag"]);
    const result = resultOf(root, run);
    const criteria = Object.fromEntries(result.criteria.map((c: Json) => [c.id, c]));
    const expectations: [string, string, string | null][] = [
      ["gap", "incomplete", "gap"],
      ["clip", "incomplete", "clipped"],
      ["clean", "pass", null],
      ["alias", "incomplete", "aliasing-suspect"],
      ["nobw", "incomplete", "bandwidth-unknown"],
      ["lowbw", "incomplete", "bandwidth-limited"],
      ["okbw", "pass", null],
      ["nocond", "incomplete", "conditions-unknown"],
      ["othercond", "incomplete", "conditions-differ"],
      ["samecond", "pass", null],
    ];
    for (const [id, status, code] of expectations) {
      expect(criteria[id].status, id).toBe(status);
      if (code) expect(criteria[id].diagnostics, id).toContain(code);
      else expect(criteria[id].diagnostics, id).toEqual([]);
    }
    expect(result.verdict).toBe("incomplete");
    expect(run.code).toBe(3);
    // missingData "exclude" computes the mean over the samples present and lets the gap stop limiting.
    const excluded = JSON.parse(readFileSync(join(root, request), "utf8"));
    excluded.missingData = "exclude";
    const second = lv(root, [
      "compare",
      "--request",
      await requestFile(root, "requests/diag2.json", excluded),
      "--run-id",
      "diag2",
    ]);
    const gapCriterion = resultOf(root, second).criteria.find((c: Json) => c.id === "gap");
    expect(gapCriterion.status).toBe("pass");
    const gapMeasurement = resultOf(root, second).measurements.find((m: Json) => m.id === "gap-mean");
    expect(gapMeasurement.value).toBe(1);
    // The gap runs from the last sample before (399 us) to the first after (601 us).
    expect(gapMeasurement.excluded).toBeCloseTo(202e-6, 9);
  });
});

describe("results and report", { timeout: 180_000 }, () => {
  it("writes format 1 results with sources, links and artifacts and refuses an existing run id (REQ-DATA-2083d1d1)", async () => {
    const request = "requests/pulse.json";
    const run = lv(root, ["compare", "--request", request, "--run-id", "docs"]);
    const result = resultOf(root, run);
    expect(result).toMatchObject({
      format: 1,
      kind: "lab-validation-result",
      tool: { name: "lab-validation", version: "1.0.0" },
      operation: "compare",
      runId: "docs",
      status: "fail",
      verdict: "fail",
    });
    expect(result.request).toMatchObject({
      path: request,
      sha256: sha256(readFileSync(join(root, request))),
    });
    expect(result.limits.join(" ")).toContain("calibration");
    for (const artifact of result.artifacts)
      expect(sha256(readFileSync(join(root, artifact.path)))).toBe(artifact.sha256);
    const sources = Object.fromEntries(result.sources.map((s: Json) => [s.id, s]));
    expect(sources.meas.sha256).toBe(sha256(readFileSync(join(root, "data/measured-pulse.csv"))));
    const report = readFileSync(join(root, "embedded-lab-results/docs/report.md"), "utf8");
    expect(report).toContain("../../data/measured-pulse.csv");
    expect(report).toContain("../../electronics-results/sim1");
    expect(report).toContain("REQ-DEMO-1");
    expect(report).toContain("cross-correlation");
    expect(report).toMatch(/fail/);
    expect(run.json.result).toBe("embedded-lab-results/docs/result.json");
    expect(run.json.criteria).toHaveLength(3);
    const again = lv(root, ["compare", "--request", request, "--run-id", "docs"]);
    expect(again.code).toBe(2);
    const align = lv(root, ["align", "--request", request, "--run-id", "align1"]);
    expect(align.json.verdict).toBeUndefined();
    expect(existsSync(join(root, "embedded-lab-results/align1/compare-xc.svg"))).toBe(true);
  });

  it("repeats identical metrics, comparisons, criteria and verdicts (REQ-FUNC-556c3680, L02-C)", async () => {
    const request = await requestFile(root, "requests/repeat.json", pulseRequestForRepeat());
    const one = resultOf(root, lv(root, ["compare", "--request", request, "--run-id", "rep1"]));
    const two = resultOf(root, lv(root, ["compare", "--request", request, "--run-id", "rep2"]));
    for (const key of ["measurements", "comparisons", "criteria", "verdict", "signals", "diagnostics"])
      expect(two[key], key).toEqual(one[key]);
    const report = readFileSync(join(root, "embedded-lab-results/rep1/report.md"), "utf8");
    for (const text of ["moving-average", "resample", "cross-correlation", "maxLag"])
      expect(report).toContain(text);
    // The same capture validated twice.
    const first = resultOf(
      root,
      lv(root, ["measure", "--request", "requests/capture.json", "--run-id", "rep-cap1"]),
    );
    const second = resultOf(
      root,
      lv(root, ["measure", "--request", "requests/capture.json", "--run-id", "rep-cap2"]),
    );
    expect(second.measurements).toEqual(first.measurements);
    expect(second.signals).toEqual(first.signals);
  });

  it("aggregates pass, fail and incomplete runs into one report and checks their hashes (REQ-FUNC-d46590e5, L02-H)", async () => {
    const pass = lv(root, ["compare", "--request", "requests/unjudged.json", "--run-id", "agg-pass"]);
    const fail = lv(root, ["compare", "--request", "requests/pulse.json", "--run-id", "agg-fail"]);
    const incomplete = lv(root, ["compare", "--request", "requests/bound.json", "--run-id", "agg-inc"]);
    expect([pass.json.verdict, fail.json.verdict, incomplete.json.verdict]).toEqual([
      "pass",
      "fail",
      "incomplete",
    ]);
    const runs = ["agg-pass", "agg-fail", "agg-inc"].flatMap((id) => ["--run", `embedded-lab-results/${id}`]);
    const report = lv(root, ["report", ...runs, "--title", "HIL step 3", "--run-id", "agg"]);
    expect(report.code).toBe(1);
    const document = JSON.parse(readFileSync(join(root, "embedded-lab-results/agg/report.json"), "utf8"));
    expect(document).toMatchObject({
      format: 1,
      kind: "lab-validation-report",
      verdict: "fail",
      title: "HIL step 3",
    });
    expect(document.runs.map((r: Json) => r.verdict)).toEqual(["pass", "fail", "incomplete"]);
    expect(document.runs[1].criteria).toMatchObject({ pass: 1, fail: 2, incomplete: 0 });
    expect(readFileSync(join(root, "embedded-lab-results/agg/report.md"), "utf8")).toContain("HIL step 3");
    await writeFile(join(root, "embedded-lab-results/agg-pass/report.md"), "edited\n");
    const tampered = lv(root, ["report", "--run", "embedded-lab-results/agg-pass", "--run-id", "agg2"]);
    expect(tampered.code).toBe(2);
    expect(tampered.json.problems[0].code).toBe("source-changed");
    // result.json is not among its own artifacts: an edited verdict must still be caught.
    lv(root, ["compare", "--request", "requests/pulse.json", "--run-id", "agg-edit"]);
    const edited = join(root, "embedded-lab-results/agg-edit/result.json");
    const forgedDocument = JSON.parse(readFileSync(edited, "utf8"));
    forgedDocument.verdict = "pass";
    forgedDocument.status = "pass";
    await writeFile(edited, JSON.stringify(forgedDocument));
    const forged = lv(root, ["report", "--run", "embedded-lab-results/agg-edit", "--run-id", "agg3"]);
    expect(forged.code).toBe(2);
    expect(forged.json.problems[0].code).toBe("source-changed");
  });

  it("describes sources without writing anything (REQ-FUNC-c87b216d)", async () => {
    const before = await treeHashes(root);
    const capture = lv(root, ["inspect", "--path", "embedded-lab-results/cap1"]);
    expect(capture.code).toBe(0);
    expect(capture.json.inspected).toMatchObject({ kind: "scpi-capture" });
    expect(capture.json.inspected.channels[0]).toMatchObject({ channel: "CHAN1", points: 1200, clipped: 2 });
    const csv = lv(root, ["inspect", "--path", "data/sigrok.csv"]);
    expect(csv.json.inspected.comments[2]).toContain("Samplerate");
    expect(csv.json.inspected.header).toEqual(["A0"]);
    const spice = lv(root, ["inspect", "--path", "electronics-results/sim1"]);
    expect(spice.json.inspected).toMatchObject({ kind: "spice", columns: ["time", "v(out)", "i(Vsense)"] });
    const request = lv(root, ["inspect", "--request", "requests/pulse.json"]);
    expect(request.code).toBe(0);
    expect(request.json.signals.map((s: Json) => s.id)).toEqual(["out", "ref"]);
    expect(await treeHashes(root)).toEqual(before);
  });

  it("computes offline without network or process access and leaves every input unchanged (REQ-SEC-58dd05f7, L02-G)", async () => {
    const before = await treeHashes(join(root, "data"));
    const sim = await treeHashes(join(root, "electronics-results"));
    const capture = await treeHashes(join(root, "embedded-lab-results", "cap1"));
    const guard = { PYTHONPATH: join(fixtures, "guard") };
    const probe = spawnSync(python, ["-c", "import socket; socket.socket()"], {
      env: baseEnv(guard),
      encoding: "utf8",
    });
    expect(probe.status).not.toBe(0);
    for (const [index, args] of [
      ["inspect", "--request", "requests/pulse.json"],
      ["normalize", "--request", "requests/pulse.json"],
      ["measure", "--request", "requests/metrics.json"],
      ["measure", "--request", "requests/capture.json"],
      ["align", "--request", "requests/pulse.json"],
      ["compare", "--request", "requests/pulse.json"],
      ["report", "--run", "embedded-lab-results/agg-fail"],
    ].entries()) {
      const run = lv(
        root,
        [...(args as string[]), ...(args[0] === "inspect" ? [] : ["--run-id", `guard${index}`])],
        guard,
      );
      expect(run.stderr).not.toContain("guard");
      expect([0, 1, 3]).toContain(run.code);
    }
    expect(await treeHashes(join(root, "data"))).toEqual(before);
    expect(await treeHashes(join(root, "electronics-results"))).toEqual(sim);
    expect(await treeHashes(join(root, "embedded-lab-results", "cap1"))).toEqual(capture);
  });
});

describe("review round 1 cases", { timeout: 180_000 }, () => {
  it("keeps a lag above its limit failing against a simulation that starts at t = 0 (REQ-FUNC-698c34a2, L02-D)", async () => {
    const request = await requestFile(
      root,
      "requests/sim0.json",
      base({
        sources: {
          meas: csvSource("data/measured-pulse.csv"),
          sim: { importer: "spice", path: "electronics-results/sim0" },
        },
        signals: { out: { source: "meas", channel: "v" }, ref: { source: "sim", channel: "v(out)" } },
        comparisons: [
          {
            id: "xc",
            signal: "out",
            reference: "ref",
            window: { from: "0 s", to: "250 us" },
            alignment: { method: "cross-correlation", maxLag: "100 us" },
          },
        ],
        criteria: [
          { id: "lag", value: "xc.lag", op: "<=", limit: "10 us", uncertainty: "0.1 us" },
          { id: "shape", value: "xc.max-abs", op: "<=", limit: "50 mV", uncertainty: "1 mV" },
        ],
      }),
    );
    const run = lv(root, ["compare", "--request", request, "--run-id", "sim0"]);
    expect(run.json.verdict).toBe("fail");
    const result = resultOf(root, run);
    expect(Math.abs(result.comparisons[0].lag - 30e-6)).toBeLessThan(0.1e-6);
    // The shifted reference starts 30 us into the window: the differences are limited, the found lag is not.
    expect(result.comparisons[0].diagnostics).toContain("reference-short");
    const status = Object.fromEntries(result.criteria.map((c: Json) => [c.id, c.status]));
    expect(status).toEqual({ lag: "fail", shape: "incomplete" });
  });

  it("aligns by a declared offset (REQ-FUNC-2f239a32)", async () => {
    const request = await requestFile(
      root,
      "requests/offset.json",
      base({
        sources: {
          meas: csvSource("data/measured-pulse.csv"),
          sim: { importer: "spice", path: "electronics-results/sim1" },
        },
        signals: { out: { source: "meas", channel: "v" }, ref: { source: "sim", channel: "v(out)" } },
        comparisons: [
          {
            id: "off",
            signal: "out",
            reference: "ref",
            window: { from: "0 s", to: "250 us" },
            alignment: { method: "offset", offset: "30 us" },
          },
        ],
      }),
    );
    const result = resultOf(root, lv(root, ["align", "--request", request, "--run-id", "offset"]));
    expect(result.comparisons[0].lag).toBeCloseTo(30e-6, 12);
    expect(result.comparisons[0].statistics["max-abs"]).toBeLessThan(5e-3);
    expect(result.comparisons[0].alignment).toMatchObject({ method: "offset", offset: "30 us" });
  });

  it("measures a delay with each signal's own levels (REQ-FUNC-a9ddc5de)", async () => {
    const request = await requestFile(
      root,
      "requests/delay.json",
      base({
        sources: {
          s: csvSource("data/delay.csv", {
            in: { column: "in", unit: "V" },
            out: { column: "out", unit: "V" },
          }),
        },
        signals: { in: { source: "s", channel: "in" }, out: { source: "s", channel: "out" } },
        measurements: [
          { id: "d", signal: "out", metric: "delay", reference: "in", window: { from: "0 s", to: "200 us" } },
          {
            id: "d-levels",
            signal: "out",
            metric: "delay",
            reference: "in",
            window: { from: "0 s", to: "200 us" },
            levels: { low: "0 V", high: "1 V" },
          },
          {
            id: "d-both",
            signal: "out",
            metric: "delay",
            reference: "in",
            window: { from: "0 s", to: "200 us" },
            levels: { low: "0 V", high: "1 V" },
            referenceLevels: { low: "0 V", high: "10 V" },
          },
        ],
      }),
    );
    const result = resultOf(root, lv(root, ["measure", "--request", request, "--run-id", "delay"]));
    const m = Object.fromEntries(result.measurements.map((x: Json) => [x.id, x]));
    // Derived levels: the medians of each window's states are not exactly 0/1 V and 0/10 V, so the derived case is
    // compared within 0.2 us; with every level declared the two 50 % points are 30 us apart exactly.
    expect(Math.abs(m.d.value - 30e-6)).toBeLessThan(0.2e-6);
    // With the out levels declared, the reference still uses its own (derived) levels, not 0/1 V.
    expect(Math.abs(m["d-levels"].value - 30e-6)).toBeLessThan(0.2e-6);
    expect(m["d-levels"].details.referenceLevels.source).toContain("derived");
    expect(Math.abs(m["d-both"].value - 30e-6)).toBeLessThan(1e-10);
  });

  it("refuses a decode folder and limits an incomplete capture (REQ-FUNC-8342826a, REQ-REL-851774fc)", async () => {
    const capture = await scpiCapture(root, "cap-dec");
    expect(scpiRun(root, ["decode", "--capture", capture, "--run-id", "dec1"]).status).toBe(0);
    const decoded = await requestFile(
      root,
      "requests/decoded.json",
      base({
        sources: { scope: { importer: "scpi-capture", path: "embedded-lab-results/dec1" } },
        signals: { ch1: { source: "scope", channel: "CHAN1" } },
      }),
    );
    const refused = lv(root, ["normalize", "--request", decoded]);
    expect(refused.code).toBe(2);
    expect(refused.json.problems[0].message).toContain("cap-dec");
    const short = await scpiCapture(root, "cap-short", { shortPoints: 1500 }, 3);
    const request = await requestFile(
      root,
      "requests/short.json",
      base({
        sources: { scope: { importer: "scpi-capture", path: short } },
        signals: { ch1: { source: "scope", channel: "CHAN1" } },
        measurements: [
          { id: "f", signal: "ch1", metric: "frequency", window: { from: "-590 us", to: "590 us" } },
        ],
        criteria: [{ id: "C", value: "f", op: "<=", limit: "20 kHz", uncertainty: "0 Hz" }],
      }),
    );
    const run = lv(root, ["compare", "--request", request, "--run-id", "short"]);
    expect(run.json.verdict).toBe("incomplete");
    expect(resultOf(root, run).criteria[0].diagnostics).toContain("source-incomplete");
  });

  it("bounds cross-correlation by the samples, not the time span (REQ-FUNC-2f239a32)", async () => {
    const request = await requestFile(
      root,
      "requests/xgap.json",
      base({
        sources: { a: csvSource("data/xgap.csv"), b: csvSource("data/xgap.csv") },
        signals: { a: { source: "a", channel: "v" }, b: { source: "b", channel: "v" } },
        comparisons: [
          {
            id: "x",
            signal: "a",
            reference: "b",
            window: { from: "0 s", to: "20.000999 s" },
            alignment: { method: "cross-correlation", maxLag: "10 us" },
          },
        ],
      }),
    );
    const started = Date.now();
    const result = resultOf(root, lv(root, ["align", "--request", request, "--run-id", "xgap"]));
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(Math.abs(result.comparisons[0].lag)).toBeLessThan(1e-7);
  });

  it("keeps the correlation within [-1, 1] on a large DC offset (REQ-FUNC-2f239a32)", async () => {
    const request = await requestFile(
      root,
      "requests/dc.json",
      base({
        sources: {
          s: csvSource("data/dc.csv", { m: { column: "m", unit: "V" }, r: { column: "r", unit: "V" } }),
        },
        signals: { m: { source: "s", channel: "m" }, r: { source: "s", channel: "r" } },
        comparisons: [
          {
            id: "x",
            signal: "m",
            reference: "r",
            window: { from: "500 us", to: "1500 us" },
            alignment: { method: "cross-correlation", maxLag: "50 us" },
          },
        ],
      }),
    );
    const comparison = resultOf(root, lv(root, ["align", "--request", request, "--run-id", "dc"]))
      .comparisons[0];
    expect(Math.abs(comparison.lag - 40e-6)).toBeLessThan(1e-6);
    expect(comparison.statistics.correlation).toBeLessThanOrEqual(1);
    expect(comparison.statistics.correlation).toBeGreaterThan(0.99);
  });

  it("refuses wrong JSON types, colliding ids and unusable data with exit 2 (REQ-DATA-53797d16, REQ-FUNC-0c057a2b)", async () => {
    const good = base({
      sources: { s: csvSource("data/const.csv") },
      signals: { v: { source: "s", channel: "v" } },
      measurements: [{ id: "m", signal: "v", metric: "mean", window: { from: "0 s", to: "1 ms" } }],
    });
    const cases: [Json, string][] = [
      [{ ...good, signals: { v: { source: ["s"], channel: "v" } } }, "signals.v.source"],
      [{ ...good, measurements: [{ ...good.measurements[0], metric: ["rms"] }] }, "metric"],
      [
        { ...good, signals: { v: { source: "s", channel: "v" }, V: { source: "s", channel: "v" } } },
        "letter case",
      ],
      [
        {
          ...good,
          signals: { v: { source: "s", channel: "v" }, w: { source: "s", channel: "v" } },
          comparisons: [
            {
              id: "c",
              signal: "v",
              reference: "w",
              window: { from: "0 s", to: "1 ms" },
              alignment: { method: "none" },
            },
          ],
          criteria: [{ id: "C", value: "c.correlation", op: ">=", limit: "0.9" }],
        },
        "correlation",
      ],
      [{ ...good, sources: { s: csvSource("data/huge.csv") } }, "1e200"],
      [
        {
          ...good,
          sources: {
            s: {
              importer: "sigrok-csv",
              path: "data/sigrok0.csv",
              columns: { v: { column: "A0", unit: "V" } },
            },
          },
        },
        "Samplerate",
      ],
    ];
    for (const [index, [request, text]] of cases.entries()) {
      const rel = await requestFile(root, `requests/odd${index}.json`, request);
      const run = lv(root, ["measure", "--request", rel, "--run-id", `odd${index}`]);
      expect(run.code, JSON.stringify(run.json)).toBe(2);
      expect(JSON.stringify(run.json.problems)).toContain(text);
      expect(existsSync(join(root, "embedded-lab-results", `odd${index}`))).toBe(false);
    }
    expect(lv(root, ["inspect", "--path", "odd"]).code).toBe(2);
    expect(lv(root, ["report", "--run", "embedded-lab-results/lag", "--title", "a\u0001b"]).code).toBe(2);
  });

  it("reads a CSV with BOM, CRLF, quoted cells and -nan, and quantities with a Greek mu (REQ-FUNC-0c057a2b)", async () => {
    const request = await requestFile(
      root,
      "requests/bom.json",
      base({
        sources: { s: csvSource("data/bom.csv") },
        signals: { v: { source: "s", channel: "v" } },
        measurements: [{ id: "m", signal: "v", metric: "max", window: { from: "0 \u03bcs", to: "3 ms" } }],
      }),
    );
    const result = resultOf(root, lv(root, ["measure", "--request", request, "--run-id", "bom"]));
    expect(result.signals[0]).toMatchObject({ points: 3, gaps: [[0.001, 0.003]] });
    expect(result.measurements[0].value).toBe(1);
  });

  it("derives the filter figures from the realized sample count (REQ-FUNC-257ed295)", async () => {
    const request = await requestFile(
      root,
      "requests/width.json",
      base({
        sources: { s: csvSource("data/gap.csv") },
        signals: {
          v: {
            source: "s",
            channel: "v",
            preprocess: [{ filter: { kind: "moving-average", width: "2.1 us" } }],
          },
        },
      }),
    );
    const step = resultOf(root, lv(root, ["normalize", "--request", request, "--run-id", "width"])).signals[0]
      .preprocessing[0];
    expect(step).toMatchObject({ samples: 3, width: 2.1e-6 });
    expect(step.effectiveWidth).toBeCloseTo(3e-6, 15);
    expect(step.riseTime1090).toBeCloseTo(2.4e-6, 15);
  });
});

function pulseRequestForRepeat(): Json {
  return base({
    sources: {
      meas: csvSource("data/measured-pulse.csv"),
      sim: { importer: "spice", path: "electronics-results/sim1" },
    },
    signals: {
      out: {
        source: "meas",
        channel: "v",
        preprocess: [{ filter: { kind: "moving-average", width: "0.3 us" } }],
      },
      ref: {
        source: "sim",
        channel: "v(out)",
        preprocess: [{ resample: { method: "linear", rate: "10 MHz" } }],
      },
    },
    measurements: [{ id: "tr", signal: "out", metric: "rise-time", window: { from: "0 s", to: "200 us" } }],
    comparisons: [
      {
        id: "xc",
        signal: "out",
        reference: "ref",
        window: { from: "0 s", to: "250 us" },
        alignment: { method: "cross-correlation", maxLag: "100 us" },
      },
    ],
    criteria: [
      { id: "shape", value: "xc.max-abs", op: "<=", limit: "50 mV", uncertainty: "1 mV" },
      { id: "lag", value: "xc.lag", op: "==", limit: "30 us", tolerance: "1 us", uncertainty: "0.1 us" },
    ],
  });
}

/** A uv stand-in that logs its arguments; `sync --script` succeeds and `run ... --script <file>` runs the file. */
async function fakeUv(dir: string) {
  const file = join(dir, "fake_uv.py");
  await writeFile(
    file,
    [
      "import runpy, sys",
      "sys.dont_write_bytecode = True",
      "args = sys.argv[1:]",
      'if args[:2] == ["sync", "--script"]: sys.exit(0)',
      'assert args[:4] == ["run", "--quiet", "--offline", "--script"], args',
      "sys.argv = args[4:]",
      'runpy.run_path(args[4], run_name="__main__")',
    ].join("\n"),
  );
  return file;
}

it("runs from an ask-mode session without approval through the real runner and leaves the package unchanged (REQ-SEC-d84c7986)", async () => {
  const temp = await realpath(await mkdtemp(join(tmpdir(), "vera-labval-session-")));
  const bench = join(temp, "bench");
  const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
  let service: core.SessionService | undefined;
  let database: Awaited<ReturnType<typeof core.openDb>> | undefined;
  let provisioner: core.Provisioner | undefined;
  try {
    await mkdir(join(bench, ".vera"), { recursive: true });
    await writeText(bench, "data/sine.csv", csvText(["t", "v"], sine()));
    await requestFile(
      bench,
      "validation/sine.json",
      base({
        sources: { s: csvSource("data/sine.csv") },
        signals: { v: { source: "s", channel: "v" } },
        measurements: [{ id: "rms", signal: "v", metric: "rms", window: { from: "0.25 ms", to: "5.25 ms" } }],
        criteria: [
          { id: "C1", value: "rms", op: "==", limit: "1.414 V", tolerance: "1 %", uncertainty: "1 mV" },
        ],
      }),
    );
    await mkdir(join(temp, "scripts"));
    const args = ["compare", "--request", "validation/sine.json", "--run-id", "s1"];
    await writeFile(
      join(temp, "scripts/run.jsonl"),
      [{ toolCalls: [{ name: "run_program", args: { program: "lab-validate", args } }] }, { text: "Pass." }]
        .map((item) => JSON.stringify(item))
        .join("\n"),
    );
    const store = new core.PluginStore({ root: join(temp, "plugins") });
    await store.install(pluginFolder);
    provisioner = new core.Provisioner({
      store,
      root: join(temp, "plugins", "runtime"),
      uv: { executable: python, prefix: [await fakeUv(temp)] },
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      platform: core.pluginPlatform(process.platform, process.arch),
      fetch: async () => new Response("offline", { status: 404 }),
      settings: () => undefined,
    });
    expect(await provisioner.install("lab-validation")).toEqual([
      { name: "lab-validate", kind: "script", state: "ready", version: "1.0.0" },
    ]);
    const plugin = await store.load("lab-validation");
    const gateway = new ReplayGateway({ dir: join(temp, "scripts"), now: Date.now });
    await gateway.models("replay", new AbortController().signal);
    database = await core.openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
    service = new core.SessionService({
      root: bench,
      db: database.db,
      gateway,
      clock: { now: () => new Date(), sleep },
      model: () => "replay/run",
      prompt: () => "Use the lab-validation plugin",
      programs: { runner, clock: { sleep }, plugins: async () => [plugin], resolver: provisioner },
    });
    await service.waitReady();
    const session = service.create(null, "ask");
    const outputs: { ok: boolean; summary: string }[] = [];
    service.subscribe(session.id, 0, (_seq, event) => {
      if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
    });
    service.send(session.id, "Does the sine meet its RMS requirement?");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    expect(outputs).toHaveLength(1);
    const done = JSON.parse(outputs[0]?.summary ?? "{}") as {
      exitCode: number;
      risk: string;
      output: string;
    };
    expect(done).toMatchObject({ exitCode: 0, risk: "safe" });
    expect(JSON.parse(done.output)).toMatchObject({ verdict: "pass", runId: "s1" });
    expect(existsSync(join(bench, "embedded-lab-results/s1/result.json"))).toBe(true);
    expect(service.get(session.id).snapshot.approvals).toEqual([]);
    // The run left the installed package as the store hashed it (no bytecode cache next to the support package).
    await expect(store.load("lab-validation")).resolves.toBeDefined();
  } finally {
    await service?.close();
    await runner.stopAll();
    provisioner?.close();
    database?.close();
    await rm(temp, { recursive: true, force: true });
  }
}, 120_000);

const uv = process.env.VERA_LABVAL_UV;
// Explicit real acceptance: VERA_LABVAL_UV names a uv executable whose managed CPython is installed. The default tests
// need neither uv nor the network.
it.skipIf(!uv)(
  "runs compare offline through a real uv on its managed Python (REQ-PLAT-72a7e11a)",
  async () => {
    const temp = await realpath(await mkdtemp(join(tmpdir(), "vera-labval-real-")));
    let provisioner: core.Provisioner | undefined;
    try {
      const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(temp, "release"));
      expect(release.issues).toEqual([]);
      const store = new core.PluginStore({ root: join(temp, "plugins") });
      await store.install(join(temp, "release/lab-validation-1.0.0.zip"));
      provisioner = new core.Provisioner({
        store,
        root: join(temp, "runtime"),
        uv: { executable: uv as string },
        host: new core.NodeProcessHost(spawn),
        platform: core.pluginPlatform(process.platform, process.arch),
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("No download program in this package");
        },
      });
      expect(await provisioner.install("lab-validation")).toEqual([
        { name: "lab-validate", kind: "script", state: "ready", version: "1.0.0" },
      ]);
      const plugin = await store.load("lab-validation");
      const resolved = await provisioner.resolve(plugin, "lab-validate");
      if (!resolved) throw Error("lab-validate did not resolve");
      expect(resolved.prefix).toContain("--offline");
      const bench = join(temp, "bench");
      await writeText(
        bench,
        "data/measured-pulse.csv",
        readFileSync(join(root, "data/measured-pulse.csv"), "utf8"),
      );
      await spiceFolder(bench, "electronics-results/sim1", {
        columns: ["time", "v(out)", "i(Vsense)"],
        rows: referenceGrid().map((t) => [t, pulse(t), pulse(t) / 1000]),
      });
      await requestFile(bench, "v.json", pulseRequestForRepeat());
      const run = spawnSync(
        resolved.executable,
        [...(resolved.prefix ?? []), "compare", "--request", "v.json", "--run-id", "real"],
        {
          cwd: bench,
          encoding: "utf8",
          env: { ...process.env, ...resolved.env },
        },
      );
      expect(run.status, run.stderr).toBe(0);
      expect(JSON.parse(run.stdout)).toMatchObject({ verdict: "pass" });
      const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await writeFile(
          join(evidence, `lab-validation-${process.platform}.json`),
          JSON.stringify({ platform: process.platform, arch: process.arch, output: JSON.parse(run.stdout) }),
        );
      }
    } finally {
      provisioner?.close();
      await rm(temp, { recursive: true, force: true });
    }
  },
  600_000,
);
