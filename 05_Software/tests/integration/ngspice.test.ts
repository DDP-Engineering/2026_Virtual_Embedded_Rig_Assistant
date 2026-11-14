// The ngspice plugin. Default tests check the package, catalog and skill, and every refusal of ngspice-tool that
// comes before the engine (hostile netlists, missing models, pin counts, limits). Where an engine is available -
// VERA_TEST_NGSPICE names one, else the helper's own search - the real-engine tests run the fixtures of
// tests/fixtures/ngspice against the references its README derives. VERA_NGSPICE_UV names a real uv: the opt-in test
// installs the plugin through VERA's provisioner, downloading the pinned ngspice-47 7z on Windows, and runs it.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = fileURLToPath(new URL("ngspice/", plugins));
const scripts = join(source, "scripts");
const script = join(scripts, "ngspice_tool.py");
const fixtures = fileURLToPath(new URL("../fixtures/ngspice/", import.meta.url));
const windows = process.platform === "win32";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();
/** The engine for the real tests: VERA_TEST_NGSPICE, else what the helper finds itself. */
const engine = (() => {
  if (process.env.VERA_TEST_NGSPICE) return process.env.VERA_TEST_NGSPICE;
  for (const candidate of windows
    ? ["C:/Spice64/bin/ngspice_con.exe"]
    : ["/usr/bin/ngspice", "/usr/local/bin/ngspice"])
    if (existsSync(candidate)) return candidate;
  return undefined;
})();
const env = (extra: Record<string, string> = {}) => ({
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONIOENCODING: "utf-8",
  ...(engine ? { VERA_PROGRAM_NGSPICE: engine } : {}),
  ...extra,
});
interface Measured {
  id: string;
  status: string;
  value?: number;
  peakInstantaneous?: number;
  convention?: string;
}
function run(cwd: string, args: string[]) {
  const result = spawnSync(python, ["-I", script, ...args], { cwd, encoding: "utf8", env: env() });
  const doc = result.stdout.trim() ? JSON.parse(result.stdout) : undefined;
  return { code: result.status, stderr: result.stderr, stdout: result.stdout, doc };
}
const measured = (doc: { measurements?: Measured[] }, id: string) =>
  (doc.measurements ?? []).find((m) => m.id === id) as Measured;
async function bench() {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "vera-ngspice-")));
  await cp(fixtures, dir, { recursive: true });
  return dir;
}
async function hashes(dir: string) {
  const out: Record<string, string> = {};
  for (const entry of await readdir(dir, { withFileTypes: true, recursive: true }))
    if (entry.isFile() && !join(entry.parentPath, entry.name).includes("electronics-results"))
      out[join(entry.parentPath, entry.name)] = sha256(await readFile(join(entry.parentPath, entry.name)));
  return out;
}
function enginesRunning(): number {
  if (!windows) {
    const found = spawnSync("pgrep", ["-x", "ngspice"], { encoding: "utf8" });
    return found.stdout.trim() ? found.stdout.trim().split("\n").length : 0;
  }
  const found = spawnSync("tasklist", ["/FI", "IMAGENAME eq ngspice_con.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
  });
  return found.stdout.split("\n").filter((line) => line.includes("ngspice_con.exe")).length;
}

it("publishes the official ngspice package with a pinned engine, its rules, skill and pack (REQ-FUNC-3ed87802)", async () => {
  const m: PluginManifest = parse(await readFile(join(source, "plugin.yaml"), "utf8"));
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(Object.keys(m.programs)).toEqual(["ngspice", "ngspice-tool"]);
  expect(m.programs["ngspice-tool"]?.uses).toEqual(["ngspice"]);
  const install = m.programs.ngspice?.install as {
    download: Record<string, { url: string; sha256: string; path: string }>;
  };
  expect(install.download["windows-x64"]).toEqual({
    url: "https://downloads.sourceforge.net/project/ngspice/ng-spice-rework/47/ngspice-47_64.7z",
    sha256: "59225971bd68cdd1199443649aa4615a9e6d684933f205ab49006a3942518f5a",
    path: "Spice64/bin/ngspice_con.exe",
  });
  const risk = (program: string, args: string[]) => classifyCommand(m.rules ?? [], program, args).risk;
  expect(risk("ngspice", ["-v"])).toBe("blocked");
  expect(risk("ngspice", ["-b", "x.cir"])).toBe("blocked");
  expect(risk("ngspice", ["x.cir"])).toBe("blocked");
  expect(risk("ngspice-tool", ["run", "--input", "r.json"])).toBe("safe");
  expect(risk("ngspice-tool", ["validate", "--netlist", "a.cir"])).toBe("safe");
  const readme = await readFile(join(source, "README.md"), "utf8");
  for (const text of [
    "ngspice-47",
    "59225971bd68cdd1199443649aa4615a9e6d684933f205ab49006a3942518f5a",
    "Modified BSD",
    "LGPL",
    "apt install ngspice",
  ])
    expect(readme).toContain(text);
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("ngspice");
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs.find((pack: { id: string }) => pack.id === "electronics")?.groups).toContainEqual({
    name: "Simulation (ngspice)",
    plugins: ["ngspice"],
    default: true,
  });
  expect(await core.checkCatalogSource(fileURLToPath(plugins))).toEqual([]);
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-ngspice-skill-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const installed = await store.load("ngspice");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const skill = (await skills.read("plugin", "circuit-simulation")).content;
    for (const text of [
      "ngspice-tool run",
      "validate",
      "average-power",
      "thermal",
      "monteCarlo",
      "never retried",
      "not a measurement",
    ])
      expect(skill).toContain(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps the shared path module byte-identical in the electronics and lab plugins", async () => {
  const copies = await Promise.all(
    [
      "electronics-calc/scripts/elec_support",
      "kicad/scripts/kicad_support",
      "parts-search/scripts/parts_support",
      "ngspice/scripts/ngspice_support",
      "lab-validation/scripts/lab_validation",
    ].map((folder) => readFile(fileURLToPath(new URL(`${folder}/workspace.py`, plugins)))),
  );
  expect(new Set(copies.map(sha256)).size).toBe(1);
});

describe("ngspice-tool refusals before the engine", { timeout: 120_000 }, () => {
  let dir: string;
  beforeAll(async () => {
    dir = await bench();
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  it("refuses hostile netlists, missing models, pin mismatches and deep chains with exit 2 and changes nothing (E04-C, E04-E)", async () => {
    const before = await hashes(dir);
    const cases: [string, string, string][] = [
      ["hostile/control.cir", "directive", ".control"],
      ["hostile/exec.cir", "directive", ".exec"],
      ["hostile/osdi.cir", "directive", "pre_osdi"],
      ["hostile/outside.cir", "include", "inside the working directory"],
      ["hostile/nested.cir", "directive", "shell"],
      ["hostile/missing.cir", "include", "not an existing regular file"],
      ["hostile/deep.cir", "include", "deeper than 16"],
      ["missing-model.cir", "model", "DNOPE".toLowerCase()],
      ["pins.cir", "pins", "3 ports"],
      // ngspice runs a `*#` comment line as a control command, in the netlist and in its includes.
      ["hostile/star-hash.cir", "directive", "*#"],
      ["hostile/star-hash-include.cir", "directive", "*#"],
      // XSPICE code models can start programs (d_process), load libraries (d_cosim) or read files.
      ["hostile/xspice.cir", "element", "XSPICE"],
      // ngspice turns a leading ';' (and other punctuation) into '*': ';#' is a control line too.
      ["hostile/semi-hash.cir", "directive", "#"],
      ["hostile/semi-hash-include.cir", "directive", "#"],
      ["hostile/bang-hash.cir", "directive", "#"],
    ];
    for (const [netlist, code, text] of cases) {
      const validated = run(dir, ["validate", "--netlist", netlist]);
      expect(validated.code, netlist).toBe(2);
      expect(
        validated.doc.errors.some(
          (e: { code: string; message: string }) => e.code === code && e.message.includes(text),
        ),
        `${netlist}: ${validated.stdout}`,
      ).toBe(true);
      const ran = run(dir, [
        "run",
        "--json",
        JSON.stringify({ netlist, analysis: { kind: "op" }, vectors: ["v(a)"] }),
        "--run-id",
        "never",
      ]);
      expect(ran.code, netlist).toBe(2);
    }
    for (const outside of ["C:/Windows/win.ini", "//host/share/m.lib", "NUL"]) {
      await writeFile(join(dir, "abs.cir"), `abs\n.include "${outside}"\nV1 a 0 DC 1\nR1 a 0 1k\n.end\n`);
      expect(run(dir, ["validate", "--netlist", "abs.cir"]).code, outside).toBe(2);
    }
    expect(existsSync(join(dir, "electronics-results", "never"))).toBe(false);
    const after = await hashes(dir);
    delete after[join(dir, "abs.cir")];
    expect(after).toEqual(before);
  });
  it("refuses a request beyond its profile, unknown fields and bad vectors before the engine (REQ-REL-04095ce1)", () => {
    const base = { netlist: "slow.cir", vectors: ["v(c)"] };
    const big = run(dir, [
      "run",
      "--json",
      JSON.stringify({ ...base, analysis: { kind: "tran", step: "1 ns", stop: "2 ms" } }),
    ]);
    expect(big.code).toBe(2);
    expect(big.doc.errors[0]).toMatchObject({ code: "limit", path: "analysis" });
    const wrong = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        ...base,
        analysis: { kind: "spice" },
        vectors: ["v(c) ; shell"],
        extra: 1,
        timeLimit: "2000 s",
      }),
    ]);
    expect(wrong.code).toBe(2);
    expect(wrong.doc.errors.map((e: { path: string }) => e.path)).toEqual(
      expect.arrayContaining(["analysis.kind", "vectors.0", "extra", "timeLimit"]),
    );
  });
});

describe.skipIf(!engine)("ngspice-tool with the real engine", { timeout: 300_000 }, () => {
  let dir: string;
  beforeAll(async () => {
    dir = await bench();
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
  const close = (value: number | undefined, expected: number, relative: number) =>
    expect(Math.abs((value as number) - expected) / Math.abs(expected)).toBeLessThanOrEqual(relative);

  it("matches the analytic references of the README (E04-A)", () => {
    const before = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "divider.cir",
        analysis: { kind: "op" },
        vectors: ["v(out)"],
        measurements: [{ id: "v", kind: "final", vector: "v(out)" }],
      }),
      "--run-id",
      "div",
    ]);
    expect(before.code, before.stdout).toBe(0);
    close(measured(before.doc, "v").value, 2.163934, 1e-6);
    const altered = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "divider.cir",
        analysis: { kind: "op" },
        vectors: ["v(out)"],
        parameters: { RB: "10k" },
        measurements: [{ id: "v", kind: "final", vector: "v(out)" }],
      }),
      "--run-id",
      "div-rb",
    ]);
    close(measured(altered.doc, "v").value, 6, 1e-6);
    const tran = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "rc.cir",
        analysis: { kind: "tran", step: "1 us", stop: "5 ms" },
        vectors: ["v(out)"],
        measurements: [{ id: "tau", kind: "value-at", vector: "v(out)", at: "1 ms" }],
      }),
      "--run-id",
      "rc",
    ]);
    close(measured(tran.doc, "tau").value, 1 - Math.exp(-1), 0.002);
    const ac = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "rc.cir",
        analysis: { kind: "ac", sweep: "dec", points: 100, start: "10 Hz", stop: "10 kHz" },
        vectors: ["vdb(out)"],
        measurements: [{ id: "corner", kind: "value-at", vector: "vdb(out)", at: "159.155 Hz" }],
      }),
      "--run-id",
      "rc-ac",
    ]);
    expect(Math.abs((measured(ac.doc, "corner").value as number) + 3.0103)).toBeLessThanOrEqual(0.01);
    const rect = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "rectifier.cir",
        analysis: { kind: "tran", step: "10 us", stop: "40 ms" },
        vectors: ["v(out)"],
        measurements: [
          { id: "peak", kind: "max", vector: "v(out)" },
          { id: "avg", kind: "average", vector: "v(out)", window: { from: "20 ms", to: "40 ms" } },
        ],
      }),
      "--run-id",
      "rect",
    ]);
    const peak = measured(rect.doc, "peak").value as number;
    expect(peak).toBeGreaterThanOrEqual(9.0);
    expect(peak).toBeLessThanOrEqual(9.6);
    close(measured(rect.doc, "avg").value, peak / Math.PI, 0.05);
    // DC sweep: v(out) at 12 V is the divider value; complex AC vectors keep real and imaginary columns.
    const dc = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "divider.cir",
        analysis: { kind: "dc", source: "V1", start: "0 V", stop: "12 V", step: "6 V" },
        vectors: ["v(out)"],
        measurements: [
          { id: "end", kind: "final", vector: "v(out)" },
          { id: "low", kind: "min", vector: "v(out)" },
        ],
      }),
      "--run-id",
      "dc",
    ]);
    expect(dc.code, dc.stdout).toBe(0);
    close(measured(dc.doc, "end").value, 2.163934, 1e-6);
    expect(measured(dc.doc, "low").value).toBe(0);
    const complex = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "rc.cir",
        analysis: { kind: "ac", sweep: "dec", points: 10, start: "10 Hz", stop: "1 kHz" },
        vectors: ["v(out)"],
      }),
      "--run-id",
      "rc-complex",
    ]);
    expect(complex.doc.status).toBe("ok");
    // RC step: min 0, max = peak-to-peak = ripple = 1 - e^-5, no overshoot, settled within 2 % at -ln(0.026603) ms.
    const step = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "rc.cir",
        analysis: { kind: "tran", step: "1 us", stop: "5 ms" },
        vectors: ["v(out)"],
        measurements: [
          { id: "min", kind: "min", vector: "v(out)" },
          { id: "p2p", kind: "peak-to-peak", vector: "v(out)" },
          { id: "ripple", kind: "ripple", vector: "v(out)", window: { from: "0 s", to: "5 ms" } },
          { id: "over", kind: "overshoot", vector: "v(out)" },
          { id: "settle", kind: "settling", vector: "v(out)", band: "2 %" },
          { id: "outside", kind: "max", vector: "v(out)", window: { from: "6 ms", to: "7 ms" } },
        ],
      }),
      "--run-id",
      "rc-step",
    ]);
    expect(Math.abs(measured(step.doc, "min").value as number)).toBeLessThanOrEqual(1e-6);
    close(measured(step.doc, "p2p").value, 1 - Math.exp(-5), 0.002);
    close(measured(step.doc, "ripple").value, 1 - Math.exp(-5), 0.002);
    expect(measured(step.doc, "over").value).toBe(0);
    close(measured(step.doc, "settle").value, -Math.log(0.026603) * 1e-3, 0.005);
    expect(measured(step.doc, "outside")).toMatchObject({ status: "unknown" });
    const noise = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "noise.cir",
        analysis: {
          kind: "noise",
          output: "v(out)",
          source: "V1",
          sweep: "dec",
          points: 5,
          start: "10 Hz",
          stop: "1 kHz",
        },
        vectors: ["v(out)"],
      }),
      "--run-id",
      "noise",
    ]);
    expect(noise.code, noise.stdout).toBe(0);
  });

  it("writes the run folder, adds no solver option and reads the noise series (REQ-FUNC-f1347188, REQ-REL-223a0738)", async () => {
    const folder = join(dir, "electronics-results", "noise");
    expect((await readdir(folder)).sort()).toEqual([
      "effective.cir",
      "input",
      "ngspice.log",
      "plot.svg",
      "report.md",
      "result.json",
      "series.csv",
      "series.dat",
    ]);
    const complexCsv = await readFile(join(dir, "electronics-results", "rc-complex", "series.csv"), "utf8");
    expect(complexCsv.split("\n")[0]).toBe("frequency,v(out) re,v(out) im");
    const csv = (await readFile(join(folder, "series.csv"), "utf8")).split("\n");
    expect(csv[0]).toBe("frequency,onoise_spectrum,inoise_spectrum");
    const first = Number(csv[1]?.split(",")[1]);
    expect(Math.abs(first - 2.8789e-9) / 2.8789e-9).toBeLessThanOrEqual(0.01);
    const effective = await readFile(join(folder, "effective.cir"), "utf8");
    expect(effective).not.toMatch(/^\s*\.options?\b/im);
    expect(effective.match(/^\.control$/gm)).toHaveLength(1);
    await writeFile(join(dir, "opts.cir"), "options\n.option reltol=1e-4\nV1 a 0 DC 1\nR1 a 0 1k\n.end\n");
    const opts = run(dir, [
      "run",
      "--json",
      JSON.stringify({ netlist: "opts.cir", analysis: { kind: "op" }, vectors: ["v(a)"] }),
      "--run-id",
      "opts",
    ]);
    const result = JSON.parse(
      await readFile(join(dir, "electronics-results", "opts", "result.json"), "utf8"),
    );
    expect(opts.code).toBe(0);
    expect(result.options).toEqual([".option reltol=1e-4"]);
    expect(result.inputs).toEqual([expect.objectContaining({ path: "opts.cir", role: "netlist" })]);
  });

  it("averages power with its sign convention and matches the steady-state thermal calculation (E04-B)", () => {
    const power = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "switch.cir",
        analysis: { kind: "tran", step: "100 ns", stop: "2 ms" },
        vectors: ["v(a)", "v(b)", "i(Vsense)"],
        measurements: [
          {
            id: "p",
            kind: "average-power",
            voltage: "v(a)",
            current: "i(Vsense)",
            window: { from: "1 ms", to: "2 ms" },
          },
        ],
        criteria: [{ measurement: "p", op: "<=", value: "8 W" }],
      }),
      "--run-id",
      "switch",
    ]);
    expect(power.code, power.stdout).toBe(0);
    const p = measured(power.doc, "p");
    close(p.value, 7.058, 0.005);
    close(p.peakInstantaneous, 14.116, 0.005);
    expect(p.convention).toContain("absorbs power");
    expect(power.doc.criteria).toEqual([expect.objectContaining({ status: "pass" })]);
    const thermal = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "thermal.cir",
        analysis: { kind: "tran", step: "1 ms", stop: "10 s" },
        vectors: ["v(tj)"],
        measurements: [{ id: "tj", kind: "final", vector: "v(tj)" }],
      }),
      "--run-id",
      "thermal",
    ]);
    close(measured(thermal.doc, "tj").value, 90, 0.001);
  });

  it("fails a singular circuit and a missing vector without passing any criterion (E04-C)", () => {
    const singular = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "singular.cir",
        analysis: { kind: "op" },
        vectors: ["v(a)"],
        measurements: [{ id: "v", kind: "final", vector: "v(a)" }],
        criteria: [{ measurement: "v", op: ">=", value: "0 V" }],
      }),
      "--run-id",
      "singular",
    ]);
    expect(singular.code).toBe(3);
    expect(singular.doc.status).toBe("failed");
    expect(singular.doc.engine.problems[0]).toMatchObject({ kind: "singular" });
    expect(singular.doc.criteria).toEqual([expect.objectContaining({ status: "not-evaluated" })]);
    const vector = run(dir, [
      "run",
      "--json",
      JSON.stringify({ netlist: "divider.cir", analysis: { kind: "op" }, vectors: ["v(nonode)"] }),
      "--run-id",
      "novector",
    ]);
    expect(vector.code).toBe(3);
    expect(vector.doc.engine.problems).toEqual([expect.objectContaining({ kind: "vector" })]);
  });

  it("sweeps reproducibly, compares runs, re-measures a run and reports (E04-D)", async () => {
    const base = {
      netlist: "load.cir",
      analysis: { kind: "op" },
      vectors: ["v(out)"],
      measurements: [{ id: "v", kind: "final", vector: "v(out)" }],
    };
    const values = run(dir, [
      "sweep",
      "--json",
      JSON.stringify({ ...base, sweep: { parameter: "RLOAD", values: ["1k", "3k"] } }),
      "--run-id",
      "sweep",
    ]);
    expect(values.code, values.stdout).toBe(0);
    const swept = JSON.parse(
      await readFile(join(dir, "electronics-results", "sweep", "result.json"), "utf8"),
    );
    expect(
      swept.points.map((p: { measurements: Measured[] }) => Number(p.measurements[0]?.value?.toFixed(6))),
    ).toEqual([5, 7.5]);
    const mc = (seed: number, id: string) =>
      run(dir, [
        "sweep",
        "--json",
        JSON.stringify({
          ...base,
          monteCarlo: {
            seed,
            runs: 5,
            tolerances: { RLOAD: { nominal: "1k", percent: 10, distribution: "uniform" } },
          },
        }),
        "--run-id",
        id,
      ]);
    expect([mc(7, "mc-a").code, mc(7, "mc-b").code, mc(8, "mc-c").code]).toEqual([0, 0, 0]);
    const read = async (id: string) =>
      JSON.parse(await readFile(join(dir, "electronics-results", id, "result.json"), "utf8"));
    const [a, b, c] = [await read("mc-a"), await read("mc-b"), await read("mc-c")];
    const drawn = (doc: { points: { inputs: { RLOAD: number } }[] }) => doc.points.map((p) => p.inputs.RLOAD);
    expect(drawn(a)).toEqual(drawn(b));
    expect(drawn(a)).not.toEqual(drawn(c));
    for (const value of drawn(a)) expect(value >= 900 && value <= 1100).toBe(true);
    const compared = run(dir, [
      "compare",
      "--run",
      "electronics-results/div",
      "--run",
      "electronics-results/div-rb",
      "--run-id",
      "cmp",
    ]);
    expect(compared.code, compared.stdout).toBe(0);
    expect(compared.doc.differences).toEqual([{ field: "parameter RB", a: null, b: 10000 }]);
    const same = run(dir, [
      "compare",
      "--run",
      "electronics-results/div",
      "--run",
      "electronics-results/div",
      "--run-id",
      "cmp-same",
    ]);
    expect(same.doc.differences).toEqual([]);
    const remeasured = run(dir, [
      "measure",
      "--run",
      "electronics-results/rc",
      "--json",
      JSON.stringify({ measurements: [{ id: "tau", kind: "value-at", vector: "v(out)", at: "1 ms" }] }),
      "--run-id",
      "remeasure",
    ]);
    expect(remeasured.code, remeasured.stdout).toBe(0);
    close(measured(remeasured.doc, "tau").value, 1 - Math.exp(-1), 0.002);
    await writeFile(join(dir, "electronics-results", "rc", "series.csv"), "time,v(out)\n0,1\n1,1\n");
    expect(
      run(dir, [
        "measure",
        "--run",
        "electronics-results/rc",
        "--json",
        JSON.stringify({ measurements: [{ id: "x", kind: "final", vector: "v(out)" }] }),
      ]).code,
    ).toBe(2);
    const reported = run(dir, [
      "report",
      "--run",
      "electronics-results/switch",
      "--run",
      "electronics-results/singular",
      "--run-id",
      "rep",
    ]);
    expect(reported.code, reported.stdout).toBe(0);
    const markdown = await readFile(join(dir, "electronics-results", "rep", "report.md"), "utf8");
    expect(markdown).toContain("switch (run): ok");
    expect(markdown).toContain("singular (run): failed");
  });

  it("stops an engine past its time limit and leaves none running (REQ-REL-04095ce1, REQ-REL-adcd1fc1)", async () => {
    const slow = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "slow.cir",
        analysis: { kind: "tran", step: "0.2 ns", stop: "1 ms" },
        vectors: ["v(c)"],
        profile: "long",
        timeLimit: "1 s",
      }),
      "--run-id",
      "slow",
    ]);
    expect(slow.code, slow.stdout).toBe(3);
    expect(slow.doc.status).toBe("timeout");
    expect(enginesRunning()).toBe(0);
    // Stop as VERA's runner does it: the helper's process tree is ended while the engine runs.
    const child = spawn(
      python,
      [
        "-I",
        script,
        "run",
        "--json",
        JSON.stringify({
          netlist: "slow.cir",
          analysis: { kind: "tran", step: "0.2 ns", stop: "1 ms" },
          vectors: ["v(c)"],
          profile: "long",
          timeLimit: "600 s",
        }),
        "--run-id",
        "stopped",
      ],
      { cwd: dir, env: env(), detached: !windows, stdio: "ignore" },
    );
    for (let i = 0; i < 100 && enginesRunning() === 0; i++)
      await new Promise((done) => setTimeout(done, 100));
    expect(enginesRunning()).toBeGreaterThan(0);
    if (windows) spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)]);
    else process.kill(-(child.pid as number), "SIGKILL");
    for (let i = 0; i < 50 && enginesRunning() > 0; i++) await new Promise((done) => setTimeout(done, 100));
    expect(enginesRunning()).toBe(0);
  });

  it("discards a run whose request file changes while it runs (REQ-REL-815f4ded)", async () => {
    const body = JSON.stringify({ netlist: "divider.cir", analysis: { kind: "op" }, vectors: ["v(out)"] });
    await writeFile(join(dir, "changing.json"), body);
    const helper = join(fixtures, "change_input.py");
    const changed = spawnSync(
      python,
      [helper, scripts, "run", "--input", "changing.json", "--run-id", "changed"],
      { cwd: dir, encoding: "utf8", env: env() },
    );
    expect(changed.status, changed.stderr + changed.stdout).toBe(3);
    expect(existsSync(join(dir, "electronics-results", "changed"))).toBe(false);
    // A request file deleted during the run is a changed input too: exit 3 and no run folder left behind.
    await writeFile(join(dir, "vanishing.json"), body);
    const vanished = spawnSync(
      python,
      [helper, scripts, "run", "--input", "vanishing.json", "--run-id", "vanished"],
      { cwd: dir, encoding: "utf8", env: env({ CHANGE_MODE: "delete" }) },
    );
    expect(vanished.status, vanished.stderr + vanished.stdout).toBe(3);
    expect(existsSync(join(dir, "electronics-results", "vanished"))).toBe(false);
  });
});

describe.skipIf(!engine)("ngspice-tool review round 1 cases", { timeout: 300_000 }, () => {
  let dir: string;
  beforeAll(async () => {
    dir = await bench();
  });
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("never lets the title line act: an include written there is not read (REQ-SEC-a7ccca3e)", async () => {
    const validated = run(dir, ["validate", "--netlist", "hostile/title-include.cir"]);
    expect(validated.code, validated.stdout).toBe(0);
    const ran = run(dir, [
      "run",
      "--json",
      JSON.stringify({ netlist: "hostile/title-include.cir", analysis: { kind: "op" }, vectors: ["v(a)"] }),
      "--run-id",
      "title",
    ]);
    expect(ran.code, ran.stdout).toBe(0);
    const folder = join(dir, "electronics-results", "title");
    expect(await readFile(join(folder, "ngspice.log"), "utf8")).not.toContain("TITLE-INCLUDE-RAN");
    expect((await readFile(join(folder, "effective.cir"), "utf8")).split("\n")[0]).toBe(
      "ngspice-tool effective netlist",
    );
    const result = JSON.parse(await readFile(join(folder, "result.json"), "utf8"));
    expect(result.title).toBe(".include title-evil.cir");
    expect(result.limits.length).toBeGreaterThan(0);
  });

  it("measures AC and noise run folders, marks a noise run without noise not applicable, and plots extreme values", async () => {
    const ac = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "rc.cir",
        analysis: { kind: "ac", sweep: "dec", points: 10, start: "10 Hz", stop: "1 kHz" },
        vectors: ["v(out)"],
      }),
      "--run-id",
      "ac",
    ]);
    expect(ac.code).toBe(0);
    const remeasured = run(dir, [
      "measure",
      "--run",
      "electronics-results/ac",
      "--json",
      JSON.stringify({ measurements: [{ id: "low", kind: "value-at", vector: "v(out)", at: "10 Hz" }] }),
      "--run-id",
      "ac-measure",
    ]);
    expect(remeasured.code, remeasured.stdout).toBe(0);
    // |H(10 Hz)| = 1/sqrt(1 + (2 pi 10 x 1 ms)^2).
    const expected = 1 / Math.sqrt(1 + (2 * Math.PI * 10 * 1e-3) ** 2);
    expect(Math.abs((measured(remeasured.doc, "low").value as number) - expected)).toBeLessThanOrEqual(1e-6);
    const noise = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "noise.cir",
        analysis: {
          kind: "noise",
          output: "v(out)",
          source: "V1",
          sweep: "dec",
          points: 2,
          start: "10 Hz",
          stop: "100 Hz",
        },
        vectors: ["v(out)"],
      }),
      "--run-id",
      "noise",
    ]);
    const noiseMeasure = run(dir, [
      "measure",
      "--run",
      "electronics-results/noise",
      "--json",
      JSON.stringify({ measurements: [{ id: "n", kind: "max", vector: "onoise_spectrum" }] }),
      "--run-id",
      "noise-measure",
    ]);
    expect([noise.code, noiseMeasure.code]).toEqual([0, 0]);
    await writeFile(
      join(dir, "quiet.cir"),
      "No noise sources\nV1 in 0 DC 0 AC 1\nE1 out 0 in 0 2\nC1 out 0 1n\n.end\n",
    );
    const quiet = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "quiet.cir",
        analysis: {
          kind: "noise",
          output: "v(out)",
          source: "V1",
          sweep: "dec",
          points: 2,
          start: "10 Hz",
          stop: "100 Hz",
        },
        vectors: ["v(out)"],
      }),
      "--run-id",
      "quiet",
    ]);
    expect(quiet.code, quiet.stdout).toBe(0);
    expect(quiet.doc.status).toBe("not-applicable");
    await writeFile(
      join(dir, "huge.cir"),
      "Huge value\nV1 a 0 DC 1\nB1 b 0 V=1e32\nR1 a 0 1k\nR2 b 0 1k\n.end\n",
    );
    const huge = run(dir, [
      "run",
      "--json",
      JSON.stringify({ netlist: "huge.cir", analysis: { kind: "op" }, vectors: ["v(b)"] }),
      "--run-id",
      "huge",
    ]);
    expect(huge.code, huge.stderr + huge.stdout).toBe(0);
  });

  it("writes report.json with measurement values, compares sweeps by their draws and requires a ripple window", async () => {
    const one = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "divider.cir",
        analysis: { kind: "op" },
        vectors: ["v(out)"],
        measurements: [{ id: "v", kind: "final", vector: "v(out)" }],
      }),
      "--run-id",
      "one",
    ]);
    expect(one.code).toBe(0);
    const reported = run(dir, ["report", "--run", "electronics-results/one", "--run-id", "rep"]);
    expect(reported.code, reported.stdout).toBe(0);
    const folder = join(dir, "electronics-results", "rep");
    expect((await readdir(folder)).sort()).toEqual(["report.json", "report.md"]);
    expect(await readFile(join(folder, "report.md"), "utf8")).toContain("2.16393");
    const base = {
      netlist: "load.cir",
      analysis: { kind: "op" },
      vectors: ["v(out)"],
      measurements: [{ id: "v", kind: "final", vector: "v(out)" }],
    };
    const mc = (seed: number, id: string) =>
      run(dir, [
        "sweep",
        "--json",
        JSON.stringify({
          ...base,
          monteCarlo: {
            seed,
            runs: 3,
            tolerances: { RLOAD: { nominal: "1k", percent: 10, distribution: "uniform" } },
          },
        }),
        "--run-id",
        id,
      ]);
    expect([mc(7, "mc7").code, mc(8, "mc8").code]).toEqual([0, 0]);
    const compared = run(dir, [
      "compare",
      "--run",
      "electronics-results/mc7",
      "--run",
      "electronics-results/mc8",
      "--run-id",
      "mc-cmp",
    ]);
    expect(compared.code, compared.stdout).toBe(0);
    expect(compared.doc.differences.map((d: { field: string }) => d.field)).toEqual(
      expect.arrayContaining(["seed", "point 1 RLOAD"]),
    );
    expect(compared.doc.deltas).toEqual([expect.objectContaining({ id: "v (mean)" })]);
    const ripple = run(dir, [
      "run",
      "--json",
      JSON.stringify({ ...base, measurements: [{ id: "r", kind: "ripple", vector: "v(out)" }] }),
    ]);
    expect(ripple.code).toBe(2);
    expect(ripple.doc.errors[0]).toMatchObject({ path: "measurements.0.window" });
  });

  it("warns about SPICE suffixes read as milli and records each model file's header (REQ-FUNC-3121bea3)", async () => {
    await writeFile(
      join(dir, "suffix.cir"),
      "Suffix\n.include models/diodes.lib\nV1 a 0 DC 1\nR1 a b 1M\nR2 b 0 1MEG\nD1 b 0 D1N4148X\n.end\n",
    );
    const validated = run(dir, ["validate", "--netlist", "suffix.cir"]);
    expect(validated.code, validated.stdout).toBe(0);
    expect(validated.doc.warnings).toEqual([expect.stringContaining("1M is 1 milli")]);
    const library = validated.doc.inputs.find(
      (input: { path: string }) => input.path === "models/diodes.lib",
    );
    expect(library.header).toEqual(["fictional small-signal diode"]);
    // A successful validate lists subcircuit ports, models and the analysis cards it will not run.
    await writeFile(
      join(dir, "listed.cir"),
      "Listed\n.subckt AMP in out\nR1 in out 1k\n.ends\n.model DX D(Is=1e-14)\nV1 a 0 DC 1\nX1 a b AMP\nD1 b 0 DX\n.tran 1u 1m\n.end\n",
    );
    const listed = run(dir, ["validate", "--netlist", "listed.cir"]);
    expect(listed.doc).toMatchObject({
      subckts: { amp: ["in", "out"] },
      models: ["dx"],
      droppedCards: [{ file: "listed.cir", line: 9, card: ".tran" }],
    });
  });

  it("reverses the power sign with the orientation, reports failing and unknown criteria and the rms (REQ-FUNC-52bb81f2, REQ-FUNC-7785cea9)", () => {
    const window = { from: "1 ms", to: "2 ms" };
    const ran = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        netlist: "switch.cir",
        analysis: { kind: "tran", step: "100 ns", stop: "2 ms" },
        vectors: ["v(a)", "i(Vsense)", "v(vin)", "i(V1)"],
        measurements: [
          { id: "p", kind: "average-power", voltage: "v(a)", current: "i(Vsense)", window },
          { id: "supply", kind: "average-power", voltage: "v(vin)", current: "i(V1)", window },
          { id: "irms", kind: "rms", vector: "i(Vsense)", window },
          { id: "late", kind: "max", vector: "v(a)", window: { from: "3 ms", to: "4 ms" } },
        ],
        criteria: [
          { measurement: "p", op: "<=", value: "5 W" },
          { measurement: "late", op: "<=", value: "1 V" },
        ],
      }),
      "--run-id",
      "signs",
    ]);
    expect(ran.code, ran.stdout).toBe(0);
    // The supply delivers power: i(V1) flows out of its + node, so v x i is negative - 12 V x 12/10.1 A x 0.5.
    const supply = measured(ran.doc, "supply").value as number;
    expect(Math.abs(supply - -7.1287) / 7.1287).toBeLessThanOrEqual(0.005);
    // RMS of a 50 % square current of 12/10.1 A: I_on x sqrt(0.5).
    expect(
      Math.abs((measured(ran.doc, "irms").value as number) - (12 / 10.1) * Math.SQRT1_2) /
        ((12 / 10.1) * Math.SQRT1_2),
    ).toBeLessThanOrEqual(0.005);
    expect(ran.doc.criteria.map((c: { status: string }) => c.status)).toEqual(["fail", "unknown"]);
  });

  it("stops a sweep whose budget is spent and marks the remaining points not run", () => {
    const helper = join(fixtures, "budget.py");
    const request = {
      netlist: "load.cir",
      analysis: { kind: "op" },
      vectors: ["v(out)"],
      sweep: { parameter: "RLOAD", values: ["1k", "3k"] },
    };
    const spent = spawnSync(
      python,
      [helper, scripts, "sweep", "--json", JSON.stringify(request), "--run-id", "budget"],
      { cwd: dir, encoding: "utf8", env: env() },
    );
    expect(spent.status, spent.stderr + spent.stdout).toBe(3);
    const doc = JSON.parse(spent.stdout);
    expect(doc.status).toBe("timeout");
    expect(doc.warnings).toEqual(expect.arrayContaining([expect.stringContaining("budget")]));
  });

  it("refuses a results directory outside the working directory and a downward DC sweep (E04-E)", () => {
    const base = { netlist: "divider.cir", analysis: { kind: "op" }, vectors: ["v(out)"] };
    for (const where of ["../outside", "C:/Windows/Temp/vera"]) {
      const refused = run(dir, ["run", "--json", JSON.stringify(base), "--results-dir", where]);
      expect(refused.code, where).toBe(2);
      expect(refused.doc.errors[0].code).toBe("path");
    }
    const down = run(dir, [
      "run",
      "--json",
      JSON.stringify({
        ...base,
        analysis: { kind: "dc", source: "V1", start: "12 V", stop: "0 V", step: "6 V" },
      }),
    ]);
    expect(down.code).toBe(2);
    expect(down.doc.errors[0]).toMatchObject({ path: "analysis.stop" });
  });
});

const uv = process.env.VERA_NGSPICE_UV;
it.skipIf(!uv)(
  "installs the pinned engine through VERA's provisioner and runs ngspice-tool offline (REQ-PLAT-0887e4d4, REQ-TEST-66a3c460)",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-ngspice-real-")));
    const host = new core.NodeProcessHost(spawn);
    let provisioner: core.Provisioner | undefined;
    try {
      const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(root, "release"));
      expect(release.issues).toEqual([]);
      const store = new core.PluginStore({ root: join(root, "plugins") });
      await store.install(join(root, "release/ngspice-1.0.0.zip"));
      provisioner = new core.Provisioner({
        store,
        root: join(root, "runtime"),
        uv: { executable: uv as string },
        host,
        platform: core.pluginPlatform(process.platform, process.arch),
        clock: { sleep: (ms: number) => new Promise<void>((done) => setTimeout(done, ms)) },
        settings: () => undefined,
        // The suite's network guard refuses outbound connections: the pinned archive comes from VERA_NGSPICE_ARCHIVE
        // (the official ngspice-47_64.7z downloaded beforehand); its SHA-256 is still checked by the provisioner.
        fetch: async (url) => {
          const archive = process.env.VERA_NGSPICE_ARCHIVE;
          if (!archive || !url.endsWith("/ngspice-47_64.7z"))
            throw Error("No local archive for this download");
          return new Response(await readFile(archive));
        },
      });
      const statuses = await provisioner.install("ngspice");
      expect(statuses.map((s) => [s.name, s.state])).toEqual([
        ["ngspice", "ready"],
        ["ngspice-tool", "ready"],
      ]);
      const resolved = await provisioner.resolve(await store.load("ngspice"), "ngspice-tool");
      if (!resolved) throw Error("ngspice-tool did not resolve");
      expect(resolved.env?.VERA_PROGRAM_NGSPICE).toMatch(/ngspice/);
      const work = join(root, "bench");
      await mkdir(work);
      await cp(join(fixtures, "divider.cir"), join(work, "divider.cir"));
      const result = spawnSync(
        resolved.executable,
        [
          ...(resolved.prefix ?? []),
          "run",
          "--json",
          JSON.stringify({
            netlist: "divider.cir",
            analysis: { kind: "op" },
            vectors: ["v(out)"],
            measurements: [{ id: "v", kind: "final", vector: "v(out)" }],
          }),
          "--run-id",
          "real",
        ],
        { cwd: work, encoding: "utf8", env: { ...process.env, ...resolved.env } },
      );
      expect(result.status, result.stderr + result.stdout).toBe(0);
      const doc = JSON.parse(result.stdout);
      expect(doc.measurements[0].value).toBeCloseTo(2.163934, 5);
      const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
      if (evidence) {
        await mkdir(evidence, { recursive: true });
        await writeFile(
          join(evidence, "ngspice-provisioned.json"),
          JSON.stringify({ statuses, engine: resolved.env?.VERA_PROGRAM_NGSPICE, run: doc }, null, 2),
        );
      }
    } finally {
      provisioner?.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  900_000,
);
