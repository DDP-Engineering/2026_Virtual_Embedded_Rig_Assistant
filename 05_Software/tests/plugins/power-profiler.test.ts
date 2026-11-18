// power-profiler (LAB-05, spec REQ-DATA-dd3e4fe1): both helpers run as real processes on the test Python. The live
// helper runs against the scripted pyjoulescope_driver stand-in in tests/fixtures/power-profiler/fake-driver - offline
// evidence of the helper's handling, never of a real JS220. The numeric fixtures have closed-form integrals
// (tests/fixtures/power-profiler/README.md). The opt-in VERA_POWER_REAL_PYTHON names a Python with the real
// pyjoulescope_driver 2.5.5 from PyPI: import, enumeration and a missing meter, nothing more.
// REQ-DATA-dd3e4fe1 REQ-DATA-f13cc264 REQ-SEC-71e25799 REQ-FUNC-72b39f27 REQ-FUNC-cd01d9d7 REQ-FUNC-3f8d4501
// REQ-SEC-f040d125 REQ-FUNC-a3c452bc REQ-REL-a711fe43 REQ-REL-6447ba8f REQ-FUNC-cd1e687f REQ-FUNC-4995f945
// REQ-REL-d02aa9e4 REQ-FUNC-02cea0ef REQ-FUNC-b22a6d3f REQ-SEC-cf1a9ecb REQ-FUNC-3ca637cb REQ-FUNC-9d7b62ea
// REQ-REL-a2fa28e4 REQ-FUNC-f22a86bb REQ-FUNC-93ac5faa REQ-FUNC-cdc1b00a REQ-FUNC-eda5feb3 REQ-PLAT-cd7e4f2c
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import {
  classifyCommand,
  type LabResource,
  labRegistrySchema,
  labResourceKeys,
  type PluginManifest,
  validatePluginManifest,
} from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { reportSkip } from "../support/skip-marker.js";

const software = fileURLToPath(new URL("../../", import.meta.url));
const plugins = join(software, "plugins");
const pluginFolder = join(plugins, "power-profiler");
const profileScript = join(pluginFolder, "scripts", "power_profile.py");
const analyzeScript = join(pluginFolder, "scripts", "power_analyze.py");
const labScript = join(plugins, "lab-validation", "scripts", "lab_validate.py");
const scpiScript = join(plugins, "scpi-instruments", "scripts", "scpi_tool.py");
const fixtures = fileURLToPath(new URL("../fixtures/power-profiler/", import.meta.url));
const fakeDriver = join(fixtures, "fake-driver");
const elfFolder = fileURLToPath(new URL("../fixtures/gdb-debug/firmware/", import.meta.url));
const windows = process.platform === "win32";
const python = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const METER = "u/js220/000415";

// biome-ignore lint/suspicious/noExplicitAny: result documents are checked field by field.
type Json = Record<string, any>;
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
  stderr: string;
}

let root = "";
const paths = () => ({
  registry: join(root, "lab", "resources.json"),
  scenario: join(root, "fake-scenario.json"),
  log: join(root, "fake-driver.log"),
  state: join(root, "fake-state.json"),
});
const registry = {
  format: 1,
  resources: [
    { alias: "js1", kind: "power-monitor", resource: METER, profile: "joulescope-js220" },
    { alias: "stlink1", kind: "probe", resource: "0483:374b:066DFF", profile: "stm32f4-stlink" },
    { alias: "psu", kind: "visa", resource: "TCPIP0::10.0.0.9::5025::SOCKET", profile: "rigol-dp800" },
  ],
};
const sleepwake = {
  kind: "sleepwake",
  period: 0.05,
  active: 0.01,
  awake: 0.02,
  sleep: 1e-5,
  voltage: 3.0,
  marker: 0,
};

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-power-")));
  await mkdir(join(root, "lab"));
  await mkdir(join(root, "data"));
  await mkdir(join(root, "fw"));
  await writeFile(paths().registry, JSON.stringify(registry));
  for (const name of await readdir(fixtures))
    if (name.endsWith(".csv")) await copyFile(join(fixtures, name), join(root, "data", name));
  await copyFile(join(elfFolder, "fault-m4.elf"), join(root, "fw", "a.elf"));
  await copyFile(join(elfFolder, "fault-m4-v2.elf"), join(root, "fw", "b.elf"));
  await writeFile(join(root, "fw", "app.bin"), Buffer.from([1, 2, 3, 4]));
  await scenario({});
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function scenario(fields: Json) {
  await writeFile(
    paths().scenario,
    JSON.stringify({ devices: { [METER]: {} }, waveform: sleepwake, chunk: 100, ...fields }),
  );
}
const ownEnv = (): Record<string, string> => ({
  PYTHONPATH: fakeDriver,
  PYTHONDONTWRITEBYTECODE: "1",
  POWER_PROFILE_REGISTRY: paths().registry,
  FAKE_JSDRV: paths().scenario,
  FAKE_JSDRV_LOG: paths().log,
  FAKE_JSDRV_STATE: paths().state,
});
const last = (stdout: string): Json => JSON.parse(stdout.trim().split("\n").at(-1) || "{}");
function exec(script: string, args: string[], env: Record<string, string> = {}, executable = python): Run {
  const run = spawnSync(executable, [script, ...args], {
    cwd: root,
    encoding: "utf8",
    env: { ...process.env, ...ownEnv(), ...env },
    timeout: 60_000,
  });
  let json: Json = {};
  try {
    json = last(run.stdout);
  } catch {
    json = {};
  }
  return { code: run.status, json, stdout: run.stdout, stderr: run.stderr };
}
const live = (args: string[], env: Record<string, string> = {}) => exec(profileScript, args, env);
const analyze = (args: string[]) => exec(analyzeScript, args);
const validate = (args: string[]) => exec(labScript, args);
const driverLog = (): Json[] =>
  existsSync(paths().log)
    ? readFileSync(paths().log, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const published = () => driverLog().filter((entry) => entry.op === "publish");
const result = async (id: string): Promise<Json> =>
  JSON.parse(await readFile(join(root, "embedded-lab-results", id, "result.json"), "utf8"));
const close = (actual: number, expected: number, relative = 1e-9) =>
  expect(Math.abs(actual - expected), `${actual} vs ${expected}`).toBeLessThanOrEqual(
    relative * Math.abs(expected) + 1e-15,
  );

const importArgs = (file: string, id: string, extra: string[] = []) => [
  "import",
  "--csv",
  `data/${file}`,
  "--time-column",
  "t",
  "--time-unit",
  "s",
  ...(file.startsWith("sleepwake")
    ? ["--current-column", "i", "--current-unit", "A", "--power-column", "p", "--power-unit", "W"]
    : file === "nonuniform-ramp.csv"
      ? ["--current-column", "i", "--current-unit", "A", "--power-column", "p", "--power-unit", "W"]
      : ["--current-column", "i_mA", "--current-unit", "mA", "--power-column", "p_mW", "--power-unit", "mW"]),
  "--voltage-column",
  "v",
  "--voltage-unit",
  "V",
  ...(file.startsWith("sleepwake") ? ["--marker", "0=gpio"] : []),
  "--run-id",
  id,
  ...extra,
];
function imported(file: string, id: string, extra: string[] = []): Run {
  const run = analyze(importArgs(file, id, extra));
  expect([0, 3], run.stdout + run.stderr).toContain(run.code);
  return run;
}
const capture = (id: string, extra: string[] = []) =>
  live(["capture", "--meter", "js1", "--duration", "0.2", "--rate", "10000", "--run-id", id, ...extra]);

describe("package, catalog and skills", () => {
  it("validates the manifest, joins the lab pack and lists both skills", async () => {
    const checked = validatePluginManifest(manifest());
    expect(checked.issues).toEqual([]);
    expect(Object.keys(checked.manifest?.programs ?? {})).toEqual(["power-profile", "power-analyze"]);
    expect(checked.manifest?.programs["power-profile"]?.resources).toMatchObject({
      option: "--meter",
      kinds: ["power-monitor"],
      cleanup: ["release"],
    });
    const catalog = parse(readFileSync(join(plugins, "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("power-profiler");
    const packs = parse(readFileSync(join(plugins, "packs.yaml"), "utf8"));
    const lab = packs.find((pack: { id: string }) => pack.id === "lab");
    expect(lab.groups).toContainEqual({
      name: "Power profiling (Joulescope)",
      plugins: ["power-profiler"],
      default: true,
    });
    expect(await core.checkCatalogSource(plugins)).toEqual([]);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(pluginFolder);
    const installed = await store.load("power-profiler");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const names = (await skills.list())
      .filter((skill) => skill.plugin === "power-profiler")
      .map((s) => s.name);
    expect(names.sort()).toEqual(["energy-analysis", "power-measurement"]);
    const usage = (await skills.read("plugin", "power-measurement")).content;
    for (const text of ["power-monitor", "UART", "--firmware", "current path"]) expect(usage).toContain(text);
  });

  it("keeps series.py, elf.py and workspace.py byte-identical with lab-validation, gdb-debug and the lab plugins", async () => {
    const own = (name: string) => readFile(join(pluginFolder, "scripts", "power_support", name));
    expect(sha256(await own("series.py"))).toBe(
      sha256(await readFile(join(plugins, "lab-validation", "scripts", "lab_validation", "series.py"))),
    );
    expect(sha256(await own("elf.py"))).toBe(
      sha256(await readFile(join(plugins, "gdb-debug", "scripts", "gdb_support", "elf.py"))),
    );
    expect(sha256(await own("workspace.py"))).toBe(
      sha256(await readFile(join(plugins, "lab-validation", "scripts", "lab_validation", "workspace.py"))),
    );
  });

  it("rates offline work safe, identification and listing device-read, captures and the cleanup device-write", () => {
    const rules = manifest().rules;
    const cases: [string, string, string[]][] = [
      ["safe", "power-profile", ["tools"]],
      ["device-read", "power-profile", ["tools", "--list"]],
      ["device-read", "power-profile", ["identify", "--meter", "js1"]],
      ["device-write", "power-profile", ["capture", "--meter", "js1", "--duration", "1", "--rate", "1000"]],
      ["device-write", "power-profile", ["release", "--meter", "js1"]],
      [
        "safe",
        "power-analyze",
        ["acquisition", "--profile", "joulescope-js220", "--duration", "1", "--rate", "1"],
      ],
      ["safe", "power-analyze", ["measure-energy", "--capture", "x"]],
      ["safe", "power-analyze", ["segment", "--capture", "x", "--threshold", "0.001"]],
      ["safe", "power-analyze", ["compare", "--a", "x", "--b", "y"]],
      ["safe", "power-analyze", ["battery", "--profile", "x", "--battery", "b.json"]],
      ["safe", "power-analyze", ["report", "--run", "x"]],
    ];
    for (const [expected, program, args] of cases)
      expect(classifyCommand(rules, program, args).risk, `${program} ${args.join(" ")}`).toBe(expected);
    expect(classifyCommand(rules, "power-profile", ["capture", "--meter", "js1"]).timeout).toBe(3600);
  });
});

describe("acquisition plans (REQ-FUNC-3f8d4501)", () => {
  const acquisition = (extra: string[]) =>
    analyze(["acquisition", "--profile", "joulescope-js220", "--duration", "10", ...extra]);
  it("prints the effective settings, the sample budget and the burden", () => {
    const run = acquisition(["--rate", "100000", "--markers", "0,2", "--current-range", "18 mA"]);
    expect(run.code, run.stdout).toBe(0);
    expect(run.json).toMatchObject({
      kind: "power-acquisition",
      rate: 100000,
      samples: 1_000_000,
      currentRange: "18 mA",
      voltageRange: "unchanged",
      markers: [0, 2],
      profileStatus: "unverified",
    });
    expect(run.json.burden).toMatch(/series resistance/);
    expect(existsSync(join(root, "embedded-lab-results"))).toBe(false);
  });
  it("refuses a rate, budget, range or marker the profile does not support", () => {
    for (const extra of [
      ["--rate", "300000"],
      ["--rate", "1000000"],
      ["--rate", "1000", "--current-range", "5 A"],
      ["--rate", "1000", "--voltage-range", "5 V"],
      ["--rate", "1000", "--markers", "0,0"],
      ["--rate", "1000", "--markers", "7"],
    ]) {
      const run = acquisition(extra);
      expect(run.code, extra.join(" ")).toBe(2);
      expect(run.json.problems[0].code).toBe("request");
    }
  });
});

describe("integrals on offline fixtures (L05-B, REQ-FUNC-4995f945, REQ-REL-d02aa9e4, REQ-FUNC-f22a86bb)", () => {
  it("integrates a uniform constant load to its closed form in J and C", async () => {
    imported("uniform-constant.csv", "uc");
    const run = analyze(["measure-energy", "--capture", "embedded-lab-results/uc", "--run-id", "m-uc"]);
    expect(run.code, run.stdout).toBe(0);
    const metrics = (await result("m-uc")).metrics;
    close(metrics.energy.value, 0.033);
    close(metrics.charge.value, 0.01);
    close(metrics.current.mean, 0.01);
    close(metrics.power.mean, 0.033);
    expect(metrics.energy.unit).toBe("J");
    expect(metrics.charge.unit).toBe("C");
    expect(metrics.energySource).toBe("meter-power");
  });

  it("integrates a ramp on a non-uniform time axis exactly", async () => {
    const imp = imported("nonuniform-ramp.csv", "nr", ["--uniform", "false"]);
    expect(imp.code).toBe(0);
    expect((await result("nr")).timebase).toMatchObject({ clock: "file", uniform: false, samples: 101 });
    const run = analyze(["measure-energy", "--capture", "embedded-lab-results/nr", "--run-id", "m-nr"]);
    expect(run.code).toBe(0);
    const metrics = (await result("m-nr")).metrics;
    close(metrics.charge.value, 0.01);
    close(metrics.energy.value, 0.02);
    close(metrics.current.max, 0.02);
  });

  it("withholds energy and charge over a gap and reports only the covered values (never the gap as zero)", async () => {
    const imp = imported("gap.csv", "gp");
    expect(imp.code).toBe(3);
    expect((await result("gp")).gaps).toEqual([
      expect.objectContaining({ from: 400, samples: 50, cause: "empty" }),
    ]);
    const samples = await readFile(join(root, "embedded-lab-results", "gp", "samples.csv"), "utf8");
    expect(samples.split("\n")[401]).toBe("0.4,,,,m");
    const run = analyze(["measure-energy", "--capture", "embedded-lab-results/gp", "--run-id", "m-gp"]);
    expect(run.code).toBe(3);
    const doc = await result("m-gp");
    expect(doc.status).toBe("incomplete");
    expect(doc.metrics.energy.value).toBeNull();
    expect(doc.metrics.charge.value).toBeNull();
    close(doc.metrics.energy.covered, 0.033 * 0.949);
    close(doc.metrics.charge.covered, 0.01 * 0.949);
    close(doc.metrics.gapSeconds, 0.051, 1e-9);
    expect(doc.problems.map((p: Json) => p.code)).toContain("gaps");
    // Outside the gap the window is whole again.
    const after = analyze([
      "measure-energy",
      "--capture",
      "embedded-lab-results/gp",
      "--from",
      "0.5",
      "--run-id",
      "m-gp2",
    ]);
    expect(after.code).toBe(0);
    close((await result("m-gp2")).metrics.energy.value, 0.033 * 0.5);
  });

  it("applies a declared sign and offset, reports reverse current and recomputes power as v x i", async () => {
    imported("uniform-constant.csv", "uc");
    const reversed = analyze([
      "measure-energy",
      "--capture",
      "embedded-lab-results/uc",
      "--sign",
      "-1",
      "--run-id",
      "rev",
    ]);
    expect(reversed.code).toBe(0);
    const rev = (await result("rev")).metrics;
    close(rev.charge.value, -0.01);
    expect(rev.negative.samples).toBe(1001);
    close(rev.negative.charge, -0.01);
    expect(rev.energySource).toBe("v*i");
    const offset = analyze([
      "measure-energy",
      "--capture",
      "embedded-lab-results/uc",
      "--current-offset",
      "0.001",
      "--offset-source",
      "open-circuit capture",
      "--run-id",
      "off",
    ]);
    expect(offset.code).toBe(0);
    const off = await result("off");
    close(off.metrics.charge.value, 0.009);
    close(off.metrics.energy.value, 3.3 * 0.009);
    expect(off.corrections).toEqual({ sign: 1, currentOffset: 0.001, offsetSource: "open-circuit capture" });
    expect((await result("rev")).problems.map((p: Json) => p.code)).toContain("offset-not-corrected");
  });

  it("refuses an import with a time that does not increase or a cell that is not a number", async () => {
    await writeFile(join(root, "data", "bad.csv"), "t,i_mA,v,p_mW\n0,1,3,3\n0.002,1,3,3\n0.001,1,3,3\n");
    const order = analyze(importArgs("bad.csv", "bad"));
    expect(order.code).toBe(2);
    expect(order.json.problems[0].message).toMatch(/row 4/);
    await writeFile(join(root, "data", "bad.csv"), "t,i_mA,v,p_mW\n0,1,3,3\n0.001,x,3,3\n");
    const cell = analyze(importArgs("bad.csv", "bad2"));
    expect(cell.code).toBe(2);
    expect(cell.json.problems[0].message).toMatch(/row 3/);
    expect(existsSync(join(root, "embedded-lab-results", "bad"))).toBe(false);
  });

  it("refuses an import one row past the limit, before it reads the rest of the file", async () => {
    // The row after the limit is refused; the malformed rows behind it are never reached.
    const rows = Array.from({ length: 1_000_001 }, (_, k) => `${k},1,3,3`);
    await writeFile(join(root, "data", "long.csv"), `t,i_mA,v,p_mW\n${rows.join("\n")}\nx,y\nx,y\n`);
    const long = analyze(importArgs("long.csv", "long"));
    expect(long.code).toBe(2);
    expect(long.json.problems[0]).toMatchObject({
      code: "limit",
      message: "--csv holds more than 1000000 rows.",
    });
    expect(existsSync(join(root, "embedded-lab-results", "long"))).toBe(false);
  });

  it("records an import's meter identity as declared, never as measured", async () => {
    imported("uniform-constant.csv", "decl", ["--meter-model", "JS220", "--meter-serial", "000415"]);
    expect((await result("decl")).meter).toMatchObject({
      model: "JS220",
      serial: "000415",
      source: "declared",
    });
  });
});

describe("events and states (L05-C offline, REQ-FUNC-b22a6d3f, REQ-SEC-cf1a9ecb)", () => {
  const event = { charge: 0.0005 * (39 * 0.02 + (0.02 + 1e-5) / 2), duration: 0.02 };
  it("segments a sleep/wake profile by its marker with per-event energy, periods, states and the sync method", async () => {
    imported("sleepwake-a.csv", "a", ["--firmware", "fw/a.elf"]);
    const run = analyze([
      "segment",
      "--capture",
      "embedded-lab-results/a",
      "--markers",
      "0",
      "--event",
      "high",
      "--run-id",
      "seg",
    ]);
    expect(run.code, run.stdout).toBe(0);
    const doc = await result("seg");
    expect(doc.sync).toMatchObject({ method: "marker", channel: "gpi0", event: "high" });
    close(doc.sync.resolution, 0.0005);
    expect(doc.statistics.complete).toBe(9);
    expect(doc.partial).toBe(1);
    for (const row of doc.events) {
      close(row.charge, event.charge);
      close(row.energy, 3 * event.charge);
      close(row.duration, event.duration);
    }
    expect(doc.periods.n).toBe(8);
    close(doc.periods.current.mean, 0.004008);
    close(doc.periods.power.mean, 0.012024);
    close(doc.states.states.high.seconds, 0.2);
    close(doc.states.states.low.seconds, 0.7995);
    const csv = await readFile(join(root, "embedded-lab-results", "seg", "events.csv"), "utf8");
    expect(csv.split("\n")).toHaveLength(11);
    expect(doc.setup.firmware.sha256).toBe(sha256(await readFile(join(root, "fw", "a.elf"))));
  });

  it("finds the same events from the measured current and from timestamps on the capture's clock", async () => {
    imported("sleepwake-a.csv", "a");
    const threshold = analyze([
      "segment",
      "--capture",
      "embedded-lab-results/a",
      "--threshold",
      "0.001",
      "--states",
      "sleep:0.001,active",
      "--run-id",
      "thr",
    ]);
    expect(threshold.code, threshold.stdout).toBe(0);
    const thr = await result("thr");
    expect(thr.sync.method).toBe("threshold");
    expect(thr.statistics.complete).toBe(9);
    close(thr.statistics.energy.mean, 3 * event.charge);
    close(thr.states.states.active.seconds, 0.2);
    const captureSha = sha256(await readFile(join(root, "embedded-lab-results", "a", "result.json")));
    const events = Array.from({ length: 9 }, (_, m) => ({ from: (m + 1) * 0.1, to: (m + 1) * 0.1 + 0.02 }));
    const file = (clock: string, capture = captureSha) =>
      writeFile(
        join(root, "data", "ts.json"),
        JSON.stringify({
          format: 1,
          clock,
          capture,
          provenance: "firmware trace decoded on the meter clock",
          events,
        }),
      );
    await file("file");
    const stamped = analyze([
      "segment",
      "--capture",
      "embedded-lab-results/a",
      "--timestamps",
      "data/ts.json",
      "--run-id",
      "ts",
    ]);
    expect(stamped.code, stamped.stdout).toBe(0);
    const ts = await result("ts");
    expect(ts.sync).toMatchObject({
      method: "timestamps",
      provenance: "firmware trace decoded on the meter clock",
    });
    close(ts.statistics.energy.mean, 3 * event.charge);
    // The PC's arrival time of a UART line is not the meter's clock; another capture's timestamps neither.
    await file("host-receive");
    const uart = analyze([
      "segment",
      "--capture",
      "embedded-lab-results/a",
      "--timestamps",
      "data/ts.json",
      "--run-id",
      "u1",
    ]);
    expect(uart.code).toBe(2);
    expect(uart.json.problems[0].code).toBe("sync");
    await file("file", "0".repeat(64));
    const other = analyze([
      "segment",
      "--capture",
      "embedded-lab-results/a",
      "--timestamps",
      "data/ts.json",
      "--run-id",
      "u2",
    ]);
    expect(other.code).toBe(2);
    expect(other.json.problems[0].code).toBe("sync");
    expect(existsSync(join(root, "embedded-lab-results", "u1"))).toBe(false);
  });
});

describe("firmware A/B through lab-validate (L05-D, REQ-FUNC-3ca637cb, REQ-FUNC-cdc1b00a, REQ-FUNC-eda5feb3)", () => {
  async function segmented(file: string, id: string, extra: string[] = []) {
    imported(file, `c-${id}`, extra);
    const run = analyze([
      "segment",
      "--capture",
      `embedded-lab-results/c-${id}`,
      "--markers",
      "0",
      "--event",
      "high",
      "--run-id",
      `s-${id}`,
    ]);
    expect(run.code, run.stdout).toBe(0);
  }
  const compare = (a: string, b: string, id: string, extra: string[] = []) =>
    analyze([
      "compare",
      "--a",
      `embedded-lab-results/s-${a}`,
      "--b",
      `embedded-lab-results/s-${b}`,
      "--run-id",
      id,
      ...extra,
    ]);
  const board = ["--board", "node rev B", "--condition", "supply=battery"];

  it("attributes a difference to the firmware only on an equivalent setup, and lab-validate judges the limits", async () => {
    await segmented("sleepwake-a.csv", "a", ["--firmware", "fw/a.elf", ...board]);
    await segmented("sleepwake-b.csv", "b", ["--firmware", "fw/b.elf", ...board]);
    const run = compare("a", "b", "ab", ["--energy-limit", "0.0011"]);
    expect(run.code, run.stdout).toBe(0);
    const doc = await result("ab");
    expect(doc.comparison.classification).toBe("firmware-change");
    expect(doc.comparison.attribution).toBe("firmware");
    expect(doc.comparison.builds.a.sha256).not.toBe(doc.comparison.builds.b.sha256);
    expect(doc.comparison.builds.a.buildId).toBeTruthy();
    close(doc.comparison.difference.perEvent.value, -3.0e-4, 1e-9);
    const request = JSON.parse(
      await readFile(join(root, "embedded-lab-results", "ab", "lab-validation-request.json"), "utf8"),
    );
    expect(request.sources.A.importer).toBe("power-capture");
    const judged = validate([
      "compare",
      "--request",
      "embedded-lab-results/ab/lab-validation-request.json",
      "--run-id",
      "lv-ab",
    ]);
    expect(judged.code, judged.stdout).toBe(1);
    const verdict = await result("lv-ab");
    const status = Object.fromEntries(verdict.criteria.map((c: Json) => [c.id, c.status]));
    expect(status).toEqual({ "C-A-energy": "fail", "C-B-energy": "pass" });
    // The same numeric core: 8 periods of 1.2024 mJ (A) in both engines.
    const a = verdict.measurements.find((m: Json) => m.id === "A-energy");
    close(a.value, 8 * 0.1 * 0.012024);
  });

  it("classifies a supply difference as a setup difference, which lab-validate makes incomplete", async () => {
    await segmented("sleepwake-a.csv", "a", ["--firmware", "fw/a.elf", ...board]);
    await segmented("sleepwake-b-3v3.csv", "b3", ["--firmware", "fw/b.elf", ...board]);
    const run = compare("a", "b3", "ab3", ["--energy-limit", "0.0011"]);
    expect(run.code).toBe(0);
    const doc = await result("ab3");
    expect(doc.comparison.classification).toBe("setup-difference");
    expect(doc.comparison.attribution).toMatch(/not attributed/);
    expect(doc.comparison.setupDifferences.map((d: Json) => d.field)).toEqual(["supply"]);
    validate([
      "compare",
      "--request",
      "embedded-lab-results/ab3/lab-validation-request.json",
      "--run-id",
      "lv-ab3",
    ]);
    const verdict = await result("lv-ab3");
    expect(verdict.criteria.find((c: Json) => c.id === "C-B-energy").status).toBe("incomplete");
  });

  it("names the same build same-firmware and a capture without a build unidentified", async () => {
    await segmented("sleepwake-b.csv", "b", ["--firmware", "fw/b.elf", ...board]);
    await segmented("sleepwake-b.csv", "b2", ["--firmware", "fw/b.elf", ...board]);
    await segmented("sleepwake-a.csv", "n", board);
    compare("b", "b2", "same");
    expect((await result("same")).comparison.classification).toBe("same-firmware");
    compare("n", "b", "unid");
    expect((await result("unid")).comparison.classification).toBe("unidentified");
  });
});

describe("battery life (L05-E, REQ-FUNC-9d7b62ea, REQ-REL-a2fa28e4)", () => {
  async function profile(extra: string[] = []) {
    imported("sleepwake-a.csv", "a");
    const run = analyze([
      "segment",
      "--capture",
      "embedded-lab-results/a",
      "--markers",
      "0",
      "--event",
      "high",
      "--run-id",
      "p",
      ...extra,
    ]);
    expect([0, 3]).toContain(run.code);
  }
  const battery = async (document: Json, id: string) => {
    await writeFile(join(root, "data", `${id}.json`), JSON.stringify({ format: 1, ...document }));
    return analyze([
      "battery",
      "--profile",
      "embedded-lab-results/p",
      "--battery",
      `data/${id}.json`,
      "--run-id",
      id,
    ]);
  };
  const usable = { min: 0.8, max: 0.9 };
  const capacity = { min: 220, max: 240, unit: "mAh" };

  it("estimates a linear regulator in charge as an interval rounded outwards (hand-computed example)", async () => {
    await profile();
    const run = await battery(
      { capacity, usable, conversion: { kind: "linear", quiescent: { min: 1, max: 2, unit: "uA" } } },
      "lin",
    );
    expect(run.code, run.stdout).toBe(0);
    const estimate = (await result("lin")).estimate;
    // low = 0.8 x 792 C / (4.008 mA + 2 uA) = 158 005 s; high = 0.9 x 864 C / (4.008 mA + 1 uA) = 193 964 s.
    expect(estimate).toMatchObject({ domain: "charge", conversion: "linear" });
    expect(estimate.life).toMatchObject({
      min: 150000,
      max: 200000,
      minHours: 43,
      maxHours: 54,
      minDays: 1.8,
      maxDays: 2.3,
    });
    expect(estimate.assumptions.join(" ")).toMatch(/repeats unchanged/);
    expect(estimate.life).not.toHaveProperty("value");
  });

  it("estimates a buck converter in energy with efficiency, quiescent current and self-discharge", async () => {
    await profile();
    const run = await battery(
      {
        capacity,
        voltage: { min: 3.6, max: 3.8, unit: "V" },
        usable,
        conversion: {
          kind: "switching",
          efficiency: { min: 0.85, max: 0.9 },
          quiescent: { min: 2, max: 5, unit: "uA" },
        },
        selfDischarge: { min: 1, max: 3, unit: "%/month" },
      },
      "buck",
    );
    expect(run.code, run.stdout).toBe(0);
    const life = (await result("buck")).estimate.life;
    const month = 30.44 * 86400;
    const eLo = 220 * 3.6 * 3.6;
    const eHi = 240 * 3.6 * 3.8;
    const low = (0.8 * eLo) / (0.012024 / 0.85 + 3.8 * 5e-6 + (eLo * 0.03) / month);
    const high = (0.9 * eHi) / (0.012024 / 0.9 + 3.6 * 2e-6 + (eHi * 0.01) / month);
    const hours = (value: number, up: boolean) => {
      const scale = 10 ** (Math.floor(Math.log10(value / 3600)) - 1);
      return (up ? Math.ceil(value / 3600 / scale) : Math.floor(value / 3600 / scale)) * scale;
    };
    expect(life.minHours).toBeCloseTo(hours(low, false), 9);
    expect(life.maxHours).toBeCloseTo(hours(high, true), 9);
    expect(life.precision).toBe("two significant figures");
  });

  it("refuses an estimate a missing efficiency, voltage or event count cannot support", async () => {
    await profile();
    const cases: [Json, RegExp][] = [
      [{ capacity, usable, conversion: { kind: "switching" } }, /efficiency/],
      [
        { capacity, usable, conversion: { kind: "switching", efficiency: { min: 0.8, max: 0.9 } } },
        /battery voltage/,
      ],
      [
        { energy: { min: 0.8, max: 0.9, unit: "Wh" }, usable, conversion: { kind: "linear" } },
        /battery voltage/,
      ],
      [
        { capacity, usable, conversion: { kind: "linear", efficiency: { min: 0.8, max: 0.9 } } },
        /switching converter only/,
      ],
      [{ capacity, conversion: { kind: "direct" } }, /usable/],
      [{ capacity, usable: { min: 0.9, max: 0.8 }, conversion: { kind: "direct" } }, /min is larger/],
    ];
    for (const [document, reason] of cases) {
      const run = await battery(document, "bad");
      expect(run.code, JSON.stringify(document)).toBe(2);
      expect(run.json.problems[0]).toMatchObject({ code: "battery", message: expect.stringMatching(reason) });
    }
    expect(existsSync(join(root, "embedded-lab-results", "bad"))).toBe(false);
  });

  it("refuses a profile with fewer than three whole events", async () => {
    await profile(["--to", "0.25"]);
    const run = await battery({ capacity, usable, conversion: { kind: "direct" } }, "few");
    expect(run.code).toBe(2);
    expect(run.json.problems[0].message).toMatch(/at least three/);
  });
});

describe("the live helper against the fake driver (offline evidence; REQ-FUNC-a3c452bc, REQ-SEC-f040d125)", () => {
  it("captures on the meter clock, restores the settings and publishes only allowed topics", async () => {
    const run = capture("c1", [
      "--markers",
      "0",
      "--firmware",
      "fw/a.elf",
      "--condition",
      "supply=3.0V",
      "--board",
      "rev B",
    ]);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    const doc = await result("c1");
    expect(doc).toMatchObject({
      kind: "power-result",
      operation: "capture",
      status: "pass",
      meter: {
        alias: "js1",
        model: "js220",
        serial: "000415",
        source: "measured",
        versions: { firmware: "1.4.10" },
      },
      timebase: { clock: "meter", rate: 10000, samples: 2000, uniform: true, decimate: 100 },
      lifecycle: { physical: "confirmed" },
      conditions: { supply: "3.0V" },
      firmware: { format: "elf", machine: expect.stringMatching(/ARM/i) },
    });
    expect(doc.settings.previous["s/i/range/mode"]).toBe("auto");
    expect(doc.settings.applied["h/fs"]).toBe(10000);
    expect(doc.settings.restored["h/fs"]).toBe(1000000);
    expect(doc.lifecycle.phases).toEqual(["start", "identified", "acting", "cleaning", "released"]);
    expect(doc.missing).toEqual({ current: 0, voltage: 0, power: 0, range: 0, gpi0: 0 });
    const samples = await readFile(join(root, "embedded-lab-results", "c1", "samples.csv"));
    expect(doc.artifacts).toEqual([{ path: "samples.csv", bytes: samples.length, sha256: sha256(samples) }]);
    const rows = samples.toString("utf8").trim().split("\n");
    expect(rows[0]).toBe("t_s,current_A,voltage_V,power_W,range,gpi0,flags");
    expect(rows).toHaveLength(2001);
    // Row 0 is the first sample every signal covers; each row follows the meter clock and the marker.
    const base = doc.timebase.firstSampleId / doc.timebase.decimate;
    rows.slice(1).forEach((row, k) => {
      const on = (base + k) % 500 < 100;
      const [t, ...cells] = row.split(",");
      close(Number(t), k / 10000);
      expect(cells.join(","), `row ${k}`).toBe(on ? "0.02,3,0.06,1,1," : "1e-05,3,3e-05,5,0,");
    });
    const log = driverLog();
    expect(log.find((entry) => entry.op === "open")).toEqual({ op: "open", device: METER, mode: "restore" });
    const allowed =
      /^(?:h\/fs|s\/i\/range\/mode|s\/i\/range\/select|s\/v\/range\/(?:mode|select)|s\/(?:i|v|p)\/ctrl|s\/i\/range\/ctrl|s\/gpi\/[0-3]\/ctrl)$/;
    for (const entry of published()) expect(entry.topic).toMatch(allowed);
    // Option names go to the device as its values (metadata): mode off would be 0, and is never sent.
    expect(published().some((e) => e.topic === "s/i/range/mode" && [0, "off"].includes(e.value))).toBe(false);
  });

  it("keeps sample-id skips and NaN samples empty and flags overflow, so the capture is incomplete (REQ-REL-a711fe43)", async () => {
    await scenario({ skip: [[500, 30]], nan: [[1200, 5]], overflow: [900] });
    const run = capture("c2");
    expect(run.code).toBe(3);
    const doc = await result("c2");
    expect(doc.status).toBe("incomplete");
    // The fake's sample numbers are absolute; row 0 is the first sample every signal covers.
    const base = doc.timebase.firstSampleId / doc.timebase.decimate;
    expect(doc.gaps).toEqual([
      { from: 500 - base, samples: 30, seconds: 0.003, cause: "skip" },
      { from: 1200 - base, samples: 5, seconds: 0.0005, cause: "nan" },
    ]);
    expect(doc.overflow).toEqual({ current: 1, voltage: 0 });
    const rows = (await readFile(join(root, "embedded-lab-results", "c2", "samples.csv"), "utf8")).split(
      "\n",
    );
    expect(rows[501 - base]).toMatch(/^[\d.]+,,,,,m$/);
    expect(rows[1201 - base]).toMatch(/^[\d.]+,,/);
    expect(rows[901 - base]).toMatch(/,i$/);
    const at = (k: number) => String((k - base) / 10000);
    const measured = analyze([
      "measure-energy",
      "--capture",
      "embedded-lab-results/c2",
      "--from",
      at(860),
      "--to",
      at(960),
      "--run-id",
      "m2",
    ]);
    expect(measured.code).toBe(3);
    const m = await result("m2");
    expect(m.metrics.energy.value).toBeNull();
    expect(m.metrics.overflow.current).toBe(1);
    expect(m.metrics.current.bound).toBe(true);
    expect(m.problems.map((p: Json) => p.code)).toContain("overflow");
    expect(m.metrics.ranges.switches).toBeGreaterThan(0);
    // Auto-ranging: time per range code (by each interval's left sample) adds up to the window's sample intervals.
    const perRange = Object.values(m.metrics.ranges.seconds as Record<string, number>);
    expect(perRange.length).toBeGreaterThan(1);
    close(
      perRange.reduce((sum, value) => sum + value, 0),
      0.01,
      1e-6,
    );
  });

  it("never switches an open current path: blocked before any publish", async () => {
    await scenario({ devices: { [METER]: { settings: { "s/i/range/mode": 0 } } } });
    const run = capture("c3");
    expect(run.code).toBe(2);
    const doc = await result("c3");
    expect(doc).toMatchObject({ status: "blocked", lifecycle: { physical: "unchanged" } });
    expect(doc.problems[0].code).toBe("current-path-off");
    expect(published()).toEqual([]);
    expect(existsSync(join(root, "embedded-lab-results", "c3", "samples.csv"))).toBe(false);
    const ident = live(["identify", "--meter", "js1", "--run-id", "i3"]);
    expect(ident.code).toBe(0);
    expect((await result("i3")).currentPath).toBe("off");
  });

  it("identifies the meter, and a missing one is blocked with nothing opened (REQ-FUNC-72b39f27)", async () => {
    const ok = live(["identify", "--meter", "js1", "--run-id", "i1"]);
    expect(ok.code, ok.stdout).toBe(0);
    expect((await result("i1")).meter.versions).toEqual({
      hardware: "1.0.2",
      firmware: "1.4.10",
      fpga: "1.3.2",
    });
    expect(published()).toEqual([]);
    await scenario({ devices: { "u/js220/999999": {} } });
    const missing = live(["identify", "--meter", "js1", "--run-id", "i2"]);
    expect(missing.code).toBe(2);
    expect(await result("i2")).toMatchObject({ status: "blocked", lifecycle: { physical: "unchanged" } });
    expect((await result("i2")).problems[0].code).toBe("device-missing");
  });

  it("refuses an unknown alias, another kind or a firmware outside the workbench before any device call (REQ-SEC-71e25799)", async () => {
    for (const args of [
      ["identify", "--meter", "js9"],
      ["identify", "--meter", "stlink1"],
      ["capture", "--meter", "js1", "--duration", "1", "--rate", "1000", "--firmware", "../outside.elf"],
      ["capture", "--meter", "js1", "--duration", "1", "--rate", "300000"],
    ]) {
      const run = live([...args, "--run-id", "r"]);
      expect(run.code, args.join(" ")).toBe(2);
      expect(run.json.status).toBe("refused");
    }
    expect(driverLog()).toEqual([]);
    expect(existsSync(join(root, "embedded-lab-results", "r"))).toBe(false);
  });

  it("records a binary firmware by its content (REQ-FUNC-cd1e687f)", async () => {
    const run = capture("fw", ["--firmware", "fw/app.bin"]);
    expect(run.code).toBe(0);
    expect((await result("fw")).firmware).toEqual({
      path: "fw/app.bin",
      bytes: 4,
      sha256: sha256(Buffer.from([1, 2, 3, 4])),
      format: "bin",
      machine: null,
      buildId: null,
    });
  });

  it("reports the driver and USB prerequisites, and a missing driver (REQ-FUNC-cd01d9d7)", async () => {
    const tools = live(["tools", "--list"]);
    expect(tools.code).toBe(0);
    expect(tools.json).toMatchObject({ driver: { version: "2.5.5+fake" }, devices: [METER] });
    expect(tools.json.usb.platform).toBe(windows ? "windows" : "linux");
    await mkdir(join(root, "empty"));
    const none = live(["tools"], { PYTHONPATH: join(root, "empty") });
    expect(none.code).toBe(3);
    expect(none.json.driver.missing).toMatch(/pyjoulescope_driver/);
  });
});

describe("ends of a capture (L05-F, REQ-REL-6447ba8f)", { timeout: 60_000 }, () => {
  it("stops on VERA's stop request with the settings restored and the samples kept", async () => {
    await scenario({ speed: 1 });
    const control = join(root, "control");
    await mkdir(control);
    const child = spawn(
      python,
      [profileScript, "capture", "--meter", "js1", "--duration", "20", "--rate", "1000", "--run-id", "st"],
      {
        cwd: root,
        env: { ...process.env, ...ownEnv(), VERA_RUN_CONTROL: control },
      },
    );
    const done = new Promise<number | null>((resolve) => child.on("exit", resolve));
    for (let i = 0; i < 100 && !published().some((p) => p.topic === "s/i/ctrl"); i++) await sleep(50);
    await sleep(300);
    await writeFile(join(control, "stop"), "");
    expect(await done).toBe(3);
    const doc = await result("st");
    expect(doc.problems.map((p: Json) => p.code)).toContain("stopped");
    expect(doc.lifecycle.physical).toBe("confirmed");
    expect(doc.timebase.samples).toBeGreaterThan(0);
    expect(JSON.parse(await readFile(join(control, "state.json"), "utf8"))).toEqual({
      format: 1,
      phase: "released",
      physical: "confirmed",
    });
  });

  it("reports a removed meter as an error with the physical state unknown", async () => {
    await scenario({
      removeAt: 600,
      devices: { [METER]: { settings: { "s/i/range/mode": 2, "s/i/range/select": 2 } } },
    });
    const run = capture("rm");
    expect(run.code).toBe(4);
    const doc = await result("rm");
    expect(doc.status).toBe("error");
    expect(doc.problems.map((p: Json) => p.code)).toContain("device-removed");
    expect(doc.lifecycle.physical).toBe("unknown");
    expect(doc.timebase.samples).toBe(600 - doc.timebase.firstSampleId / doc.timebase.decimate);
  });

  it("returns an interrupted meter to auto-ranging in release, or reports unknown", async () => {
    await scenario({ devices: { [METER]: { settings: { "s/i/range/mode": 2, "s/i/range/select": 3 } } } });
    const ok = live(["release", "--meter", "js1"], { VERA_CLEANUP_OF: "01JRUN" });
    expect(ok.code, ok.stdout).toBe(0);
    expect(ok.json).toMatchObject({ kind: "power-release", physical: "confirmed", of: "01JRUN" });
    // "auto" goes to the device as its option value 1 (from the topic's metadata).
    expect(published().filter((p) => p.topic === "s/i/range/mode")).toEqual([
      { op: "publish", topic: "s/i/range/mode", value: 1 },
    ]);
    await rm(paths().state);
    await scenario({ devices: { [METER]: { settings: { "s/i/range/mode": 0 } } } });
    const off = live(["release", "--meter", "js1"]);
    expect(off.code).toBe(4);
    expect(off.json.physical).toBe("unknown");
    expect(off.json.problem).toMatch(/current-path-off/);
    await rm(paths().state);
    await scenario({ devices: {} });
    const gone = live(["release", "--meter", "js1"]);
    expect(gone.code).toBe(4);
    expect(gone.json.physical).toBe("unknown");
  });

  it("is supervised by VERA's runner: the meter is BUSY while held and Stop leaves no run or lease", async () => {
    await scenario({ speed: 1 });
    const leases = new core.ResourceLeases({ root: join(root, "leases"), app: "test" });
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      leases,
    });
    const keys = labResourceKeys(
      labRegistrySchema.parse({ format: 1, resources: [registry.resources[0]] }).resources[0] as LabResource,
    );
    const claim = { kind: "power-monitor" as const, alias: "js1", resource: METER, keys, actuates: true };
    try {
      const run = await runner.start({
        sessionId: "s1",
        workbench: root,
        executable: python,
        args: [
          profileScript,
          "capture",
          "--meter",
          "js1",
          "--duration",
          "30",
          "--rate",
          "1000",
          "--run-id",
          "sup",
        ],
        env: { ...ownEnv() },
        background: true,
        lease: {
          claims: [claim],
          graceMs: 10_000,
          cleanup: {
            args: [profileScript, "release", "--meter", "js1"],
            shown: ["release", "--meter", "js1"],
            timeoutMs: 30_000,
          },
        },
      });
      for (let i = 0; i < 200 && !published().some((p) => p.topic === "s/i/ctrl"); i++) await sleep(50);
      await expect(
        runner.start({
          sessionId: "s2",
          workbench: root,
          executable: python,
          args: ["-c", "0"],
          lease: { claims: [claim], graceMs: 1000 },
        }),
      ).rejects.toMatchObject({ code: "BUSY" });
      const stopped = await run.stop();
      expect(stopped).toMatchObject({ stopped: true, physical: "confirmed", cleanup: "none" });
      expect((await result("sup")).lifecycle.physical).toBe("confirmed");
      expect((await readdir(join(root, "leases"))).filter((name) => name.endsWith(".lease"))).toEqual([]);
    } finally {
      await runner.stopAll();
    }
  });
});

describe("lab-validate and reports read power captures as recorded (L05-G, REQ-FUNC-eda5feb3, REQ-FUNC-93ac5faa)", () => {
  const request = (source: string, measurements: Json[], criteria: Json[] = []) => ({
    format: 1,
    title: "power",
    decisionRule: "simple",
    missingData: "incomplete",
    sources: { cap: { importer: "power-capture", path: source } },
    signals: {
      p: { source: "cap", channel: "power" },
      i: { source: "cap", channel: "current" },
      m: { source: "cap", channel: "gpi0" },
    },
    measurements,
    criteria,
  });
  const measure = async (body: Json, id: string) => {
    await writeFile(join(root, "data", `${id}.json`), JSON.stringify(body));
    return validate(["compare", "--request", `data/${id}.json`, "--run-id", id]);
  };

  it("integrates a fake-driver capture to the same energy and charge as power-analyze, with scale and timebase kept", async () => {
    expect(capture("lv", ["--markers", "0"]).code).toBe(0);
    const ours = analyze(["measure-energy", "--capture", "embedded-lab-results/lv", "--run-id", "m-lv"]);
    expect(ours.code).toBe(0);
    const metrics = (await result("m-lv")).metrics;
    const window = { from: "0 s", to: "0.1999 s" };
    const run = await measure(
      request(
        "embedded-lab-results/lv",
        [
          { id: "e", signal: "p", metric: "integral", window },
          { id: "q", signal: "i", metric: "integral", window },
        ],
        [
          { id: "C1", value: "e", op: "<=", limit: "10 mJ" },
          { id: "C2", value: "q", op: "<=", limit: "1 mC" },
        ],
      ),
      "lv1",
    );
    expect(run.code, run.stdout).toBe(0);
    const lv = await result("lv1");
    close(lv.measurements.find((m: Json) => m.id === "e").value, metrics.energy.value);
    close(lv.measurements.find((m: Json) => m.id === "q").value, metrics.charge.value);
    expect(lv.measurements.find((m: Json) => m.id === "e").unit).toBe("J");
    expect(lv.measurements.find((m: Json) => m.id === "q").unit).toBe("C");
  });

  it("makes an integral over a gap unknown and an overflow window incomplete", async () => {
    imported("gap.csv", "gp");
    const gap = await measure(
      {
        ...request(
          "embedded-lab-results/gp",
          [{ id: "e", signal: "p", metric: "integral", window: { from: "0 s", to: "1 s" } }],
          [{ id: "C1", value: "e", op: "<=", limit: "1 J" }],
        ),
        signals: { p: { source: "cap", channel: "power" } },
      },
      "lv2",
    );
    expect(gap.code).toBe(3);
    const lv2 = await result("lv2");
    expect(lv2.measurements[0]).toMatchObject({ value: null, status: "unknown" });
    expect(lv2.criteria[0].status).toBe("incomplete");
    await scenario({ overflow: [900] });
    expect(capture("ov").code).toBe(3);
    const over = await measure(
      {
        ...request(
          "embedded-lab-results/ov",
          [{ id: "e", signal: "p", metric: "integral", window: { from: "0.08 s", to: "0.1 s" } }],
          [{ id: "C1", value: "e", op: "<=", limit: "1 J" }],
        ),
        signals: { p: { source: "cap", channel: "power" } },
      },
      "lv3",
    );
    expect(over.code).toBe(3);
    expect((await result("lv3")).criteria[0].status).toBe("incomplete");
  });

  it("refuses a capture whose samples changed, in lab-validate and in the report", async () => {
    expect(capture("ch").code).toBe(0);
    expect(analyze(["measure-energy", "--capture", "embedded-lab-results/ch", "--run-id", "chm"]).code).toBe(
      0,
    );
    expect(
      analyze(["segment", "--capture", "embedded-lab-results/ch", "--threshold", "0.001", "--run-id", "chs"])
        .code,
    ).toBe(0);
    const ok = analyze([
      "report",
      ...["ch", "chm", "chs"].flatMap((id) => ["--run", `embedded-lab-results/${id}`]),
      "--run-id",
      "rep",
    ]);
    expect(ok.code, ok.stdout).toBe(0);
    for (const name of ["report.md", "report.html", "current-0.svg"])
      expect(existsSync(join(root, "embedded-lab-results", "rep", name)), name).toBe(true);
    const md = await readFile(join(root, "embedded-lab-results", "rep", "report.md"), "utf8");
    for (const link of ["../ch/result.json", "../chm/result.json", "../chs/result.json"])
      expect(md).toContain(link);
    expect(md).toMatch(/energy per event mean/);
    expect(existsSync(join(root, "embedded-lab-results", "rep", "current-1.svg"))).toBe(false);
    const file = join(root, "embedded-lab-results", "ch", "samples.csv");
    await writeFile(file, `${await readFile(file, "utf8")}0.2,1,3,3,0,\n`);
    const changed = analyze(["report", "--run", "embedded-lab-results/ch", "--run-id", "rep2"]);
    expect(changed.code).toBe(2);
    expect(changed.json.problems[0].code).toBe("source-changed");
    const lv = await measure(
      request(
        "embedded-lab-results/ch",
        [{ id: "e", signal: "p", metric: "integral", window: { from: "0 s", to: "0.1 s" } }],
        [{ id: "C1", value: "e", op: "<=", limit: "1 J" }],
      ),
      "lv4",
    );
    expect(lv.code).toBe(2);
    expect(lv.json.problems?.[0]?.code ?? lv.stdout).toMatch(/source-changed/);
  });

  it("leaves the scpi helper reading a registry that declares a power monitor", () => {
    const run = exec(scpiScript, ["discover-configured"], { SCPI_REGISTRY: paths().registry });
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(run.stdout).toContain('"psu"');
    expect(run.stdout).not.toContain("js1");
  });
});

// Opt-in: VERA_POWER_REAL_PYTHON = a Python with pyjoulescope_driver 2.5.5 from PyPI (for example a uv venv). It proves
// the real driver imports and enumerates with no meter attached, and that a missing meter leaves the live evidence of
// L05-A, L05-C and L05-H explicitly unmet (blocked, device-missing), never a pass.
const realPython = process.env.VERA_POWER_REAL_PYTHON ?? "";
reportSkip(
  !realPython,
  "the real pyjoulescope_driver tests",
  "set VERA_POWER_REAL_PYTHON to a Python with pyjoulescope_driver 2.5.5",
);
describe.skipIf(!realPython)("the real pyjoulescope_driver 2.5.5 without a meter (REQ-PLAT-cd7e4f2c)", () => {
  const real = (args: string[]) => exec(profileScript, args, { PYTHONPATH: "", FAKE_JSDRV: "" }, realPython);
  it("imports and enumerates the driver and finds no meter", () => {
    const run = real(["tools", "--list"]);
    expect(run.code, run.stdout + run.stderr).toBe(0);
    expect(run.json.driver).toEqual({ package: "pyjoulescope_driver", version: "2.5.5" });
    expect(run.json.devices).toEqual([]);
    // Windows ships WinUSB; Linux needs the vendor udev rule, which VERA reports but never installs.
    if (process.platform === "win32") expect(run.json.usb.ok).toBe(true);
    else if (!run.json.usb.ok) expect(run.json.usb.hint).toContain("72-joulescope.rules");
  });
  it("blocks identify and capture with device-missing and changes nothing", async () => {
    const ident = real(["identify", "--meter", "js1", "--run-id", "real-i"]);
    expect(ident.code).toBe(2);
    expect(await result("real-i")).toMatchObject({
      status: "blocked",
      lifecycle: { physical: "unchanged" },
      tool: { driver: "2.5.5" },
    });
    const cap = real([
      "capture",
      "--meter",
      "js1",
      "--duration",
      "1",
      "--rate",
      "1000",
      "--run-id",
      "real-c",
    ]);
    expect(cap.code).toBe(2);
    const doc = await result("real-c");
    expect(doc.problems[0].code).toBe("device-missing");
    expect(doc.lifecycle.physical).toBe("unchanged");
    expect(existsSync(join(root, "embedded-lab-results", "real-c", "samples.csv"))).toBe(false);
  });
});

describe("review round 1 cases (REQ-SEC-f040d125, REQ-REL-a711fe43, REQ-REL-6447ba8f, REQ-FUNC-3ca637cb)", {
  timeout: 60_000,
}, () => {
  it("never takes an unnamed raw range mode for a closed current path: capture and release change nothing", async () => {
    await scenario({ noMetadata: true, devices: { [METER]: { settings: { "s/i/range/mode": 0 } } } });
    const run = capture("raw");
    expect(run.code).toBe(2);
    const doc = await result("raw");
    expect(doc).toMatchObject({ status: "blocked", lifecycle: { physical: "unchanged" } });
    expect(doc.problems[0].code).toBe("current-path-unknown");
    const release = live(["release", "--meter", "js1"]);
    expect(release.code).toBe(4);
    expect(release.json).toMatchObject({
      physical: "unknown",
      problem: expect.stringMatching(/current-path-unknown/),
    });
    expect(published().filter((p) => p.topic.startsWith("s/i/range/mode"))).toEqual([]);
  });

  it("flags samples missing only in the power channel and makes the capture incomplete", async () => {
    await scenario({ powerNan: [[700, 4]] });
    const run = capture("pn");
    expect(run.code).toBe(3);
    const doc = await result("pn");
    expect(doc.missing.power).toBe(4);
    expect(doc.problems.map((p: Json) => p.code)).toContain("channel-missing");
    const rows = (await readFile(join(root, "embedded-lab-results", "pn", "samples.csv"), "utf8")).split(
      "\n",
    );
    const base = doc.timebase.firstSampleId / doc.timebase.decimate;
    expect(rows[701 - base]).toMatch(/,,\d+,m$/);
  });

  it("keeps a result and restores the meter when the driver hands over a malformed message", async () => {
    await scenario({
      noneDataAt: 800,
      devices: { [METER]: { settings: { "s/i/range/mode": 2, "s/i/range/select": 2 } } },
    });
    const run = capture("bad");
    expect(run.code, run.stderr).toBe(4);
    expect(run.stderr).not.toMatch(/Traceback/);
    const doc = await result("bad");
    expect(doc.problems.map((p: Json) => p.code)).toContain("internal");
    expect(doc.lifecycle.physical).toBe("confirmed");
  });

  it("ends a stalled stream as an error with the samples kept and the settings restored", async () => {
    await scenario({ stallAt: 700 });
    const run = capture("stall");
    expect(run.code).toBe(4);
    const doc = await result("stall");
    expect(doc.problems.map((p: Json) => p.code)).toContain("stalled");
    expect(doc.lifecycle.physical).toBe("confirmed");
    expect(doc.timebase.samples).toBe(700 - doc.timebase.firstSampleId / doc.timebase.decimate);
  });

  it("stops at VERA's timeout through the stop request, restores the meter and leaves no lease", async () => {
    await scenario({ speed: 1 });
    const leases = new core.ResourceLeases({ root: join(root, "leases"), app: "test" });
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      leases,
    });
    const keys = labResourceKeys(
      labRegistrySchema.parse({ format: 1, resources: [registry.resources[0]] }).resources[0] as LabResource,
    );
    try {
      const run = await runner.start({
        sessionId: "s1",
        workbench: root,
        executable: python,
        args: [
          profileScript,
          "capture",
          "--meter",
          "js1",
          "--duration",
          "30",
          "--rate",
          "1000",
          "--run-id",
          "to",
        ],
        env: { ...ownEnv() },
        background: true,
        timeoutMs: 2500,
        lease: {
          claims: [{ kind: "power-monitor", alias: "js1", resource: METER, keys, actuates: true }],
          graceMs: 10_000,
          cleanup: {
            args: [profileScript, "release", "--meter", "js1"],
            shown: ["release", "--meter", "js1"],
            timeoutMs: 30_000,
          },
        },
      });
      const ended = await run.done;
      expect(ended).toMatchObject({ timedOut: true, physical: "confirmed", cleanup: "none" });
      const doc = await result("to");
      expect(doc.problems.map((p: Json) => p.code)).toContain("stopped");
      expect(doc.lifecycle.physical).toBe("confirmed");
      expect((await readdir(join(root, "leases"))).filter((name) => name.endsWith(".lease"))).toEqual([]);
    } finally {
      await runner.stopAll();
    }
  });

  it("separates captures that differ only in the meter's voltage range readback (setup-difference)", async () => {
    const segmentOf = async (id: string, select: number, firmware: string) => {
      await rm(paths().state, { force: true });
      // 1.8 V lies inside both the 15 V and the 2 V range (3.0 V would be voltage overflow on 2 V).
      await scenario({
        waveform: { ...sleepwake, voltage: 1.8 },
        devices: { [METER]: { settings: { "s/v/range/mode": 1, "s/v/range/select": select } } },
      });
      const captured = capture(`v-${id}`, ["--markers", "0", "--firmware", firmware]);
      expect(captured.code, captured.stdout).toBe(0);
      const run = analyze([
        "segment",
        "--capture",
        `embedded-lab-results/v-${id}`,
        "--markers",
        "0",
        "--event",
        "high",
        "--run-id",
        `vs-${id}`,
      ]);
      expect(run.code, run.stdout).toBe(0);
    };
    await segmentOf("a", 0, "fw/a.elf");
    await segmentOf("b", 1, "fw/b.elf");
    const run = analyze([
      "compare",
      "--a",
      "embedded-lab-results/vs-a",
      "--b",
      "embedded-lab-results/vs-b",
      "--run-id",
      "vab",
    ]);
    expect(run.code, run.stdout).toBe(0);
    const doc = await result("vab");
    expect(doc.comparison.classification).toBe("setup-difference");
    expect(doc.comparison.setupDifferences.map((d: Json) => d.field)).toEqual(["voltageRange"]);
  });

  it("withholds the energy of an event that spans a gap, and counts an event hidden by a missing marker as partial", async () => {
    await scenario({ skip: [[1020, 10]] });
    expect(capture("eg", ["--markers", "0"]).code).toBe(3);
    const doc = await result("eg");
    const base = doc.timebase.firstSampleId / doc.timebase.decimate;
    const sha = sha256(await readFile(join(root, "embedded-lab-results", "eg", "result.json")));
    const at = (k: number) => (k - base) / 10000;
    await writeFile(
      join(root, "data", "eg.json"),
      JSON.stringify({
        format: 1,
        clock: "meter",
        capture: sha,
        provenance: "test",
        events: [
          { from: at(1000), to: at(1100) },
          { from: at(1500), to: at(1600) },
        ],
      }),
    );
    const stamped = analyze([
      "segment",
      "--capture",
      "embedded-lab-results/eg",
      "--timestamps",
      "data/eg.json",
      "--run-id",
      "egs",
    ]);
    expect(stamped.code).toBe(3);
    const seg = await result("egs");
    expect(seg.events.map((e: Json) => [e.status, e.energy === null])).toEqual([
      ["incomplete", true],
      ["ok", false],
    ]);
    const marked = analyze([
      "segment",
      "--capture",
      "embedded-lab-results/eg",
      "--markers",
      "0",
      "--event",
      "high",
      "--run-id",
      "egm",
    ]);
    expect([0, 3]).toContain(marked.code);
    const byMarker = await result("egm");
    expect(byMarker.events.some((e: Json) => Math.abs(e.from - at(1000)) < 1e-9)).toBe(false);
    expect(byMarker.partial).toBeGreaterThanOrEqual(2);
  });

  it("inspects a capture without writing anything and refuses a profile with an unknown field", async () => {
    imported("uniform-constant.csv", "uc");
    const run = analyze(["inspect", "--capture", "embedded-lab-results/uc"]);
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({ kind: "power-inspection", rows: 1001, missing: 0, operation: "import" });
    expect(await readdir(join(root, "embedded-lab-results"))).toEqual(["uc"]);
    const profile = JSON.parse(readFileSync(join(pluginFolder, "profiles", "joulescope-js220.json"), "utf8"));
    const code = [
      "import json, sys",
      "sys.dont_write_bytecode = True",
      "sys.path.insert(0, sys.argv[1])",
      "from power_support import profiles",
      "from power_support.errors import Refused",
      "try:",
      "    profiles.parse(json.loads(sys.argv[2]), 'joulescope-js220')",
      "    print('accepted')",
      "except Refused as error:",
      "    print('refused', error.message)",
    ].join("\n");
    const check = spawnSync(
      python,
      ["-c", code, join(pluginFolder, "scripts"), JSON.stringify({ ...profile, extra: 1 })],
      {
        encoding: "utf8",
      },
    );
    expect(check.stdout).toMatch(/^refused .*exactly the fields/);
  });
});
