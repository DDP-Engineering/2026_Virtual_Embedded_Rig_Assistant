// The ltspice plugin. Default tests check the package, catalog and skill, the raw-file parser on files LTspice 26.1.1
// wrote, the byte-identical modules shared with ngspice-tool, and every refusal of ltspice-tool that comes before the
// engine (hostile netlists, includes, schematics, limits). VERA_TEST_LTSPICE names the user's LTspice.exe: then the
// real-engine tests run the fixtures of tests/fixtures/ltspice against the references its README derives, and with
// VERA_TEST_NGSPICE also against ngspice-tool on the same requests.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = fileURLToPath(new URL("ltspice/", plugins));
const scripts = join(source, "scripts");
const script = join(scripts, "ltspice_tool.py");
const ngspiceScript = fileURLToPath(new URL("ngspice/scripts/ngspice_tool.py", plugins));
const fixtures = fileURLToPath(new URL("../fixtures/ltspice/", import.meta.url));
const windows = process.platform === "win32";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();
/** The user's LTspice for the real tests; without it they are skipped. */
const ltspice =
  process.env.VERA_TEST_LTSPICE && existsSync(process.env.VERA_TEST_LTSPICE)
    ? process.env.VERA_TEST_LTSPICE
    : undefined;
const ngspice =
  process.env.VERA_TEST_NGSPICE && existsSync(process.env.VERA_TEST_NGSPICE)
    ? process.env.VERA_TEST_NGSPICE
    : undefined;
const NO_LTSPICE = "LTspice not installed (set VERA_TEST_LTSPICE)";
/** No engine anywhere: the variable names a missing file and the install folders are empty. */
const nowhere = join(tmpdir(), "vera-ltspice-nowhere");
const env = (extra: Record<string, string> = {}) => ({
  ...process.env,
  PYTHONDONTWRITEBYTECODE: "1",
  PYTHONIOENCODING: "utf-8",
  VERA_PROGRAM_LTSPICE: ltspice ?? join(nowhere, "LTspice.exe"),
  ...(ltspice ? {} : { LOCALAPPDATA: nowhere, ProgramFiles: nowhere }),
  ...(ngspice ? { VERA_PROGRAM_NGSPICE: ngspice } : {}),
  ...extra,
});
interface Measured {
  id: string;
  status: string;
  value?: number;
}
interface Doc {
  status: string;
  errors?: { code: string; path: string; message: string }[];
  measurements?: Measured[];
  criteria?: { measurement: string; status: string }[];
  folder?: string;
  [key: string]: unknown;
}
function run(cwd: string, args: string[], extra: Record<string, string> = {}, tool = script) {
  const result = spawnSync(python, ["-I", tool, ...args], { cwd, encoding: "utf8", env: env(extra) });
  const doc = result.stdout.trim() ? (JSON.parse(result.stdout) as Doc) : undefined;
  return { code: result.status, stderr: result.stderr, stdout: result.stdout, doc: doc as Doc };
}
const measured = (doc: { measurements?: Measured[] }, id: string) =>
  (doc.measurements ?? []).find((m) => m.id === id) as Measured;
const close = (actual: number | undefined, expected: number, relative: number) => {
  expect(actual).toBeTypeOf("number");
  expect(Math.abs((actual as number) - expected)).toBeLessThanOrEqual(Math.abs(expected) * relative);
};
async function bench(name = "vera-ltspice-") {
  const dir = await realpath(await mkdtemp(join(tmpdir(), name)));
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
/** LTspice processes whose command line names `marker` (a test's own folder). */
function enginesIn(marker: string): number {
  if (!windows) return 0;
  const found = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"Name = 'LTspice.exe'\" | ForEach-Object { $_.CommandLine }",
    ],
    { encoding: "utf8" },
  );
  return found.stdout.split("\n").filter((line) => line.toLowerCase().includes(marker.toLowerCase())).length;
}

describe("package", () => {
  it("publishes the official ltspice package: find-only engine, blocked direct commands, Windows x64 only (REQ-FUNC-285b6fcc, REQ-PLAT-590b1e69)", async () => {
    const m: PluginManifest = parse(await readFile(join(source, "plugin.yaml"), "utf8"));
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m.platforms).toEqual(["windows-x64"]);
    expect(Object.keys(m.programs)).toEqual(["ltspice", "ltspice-tool"]);
    expect(m.programs["ltspice-tool"]?.uses).toEqual(["ltspice"]);
    const install = m.programs.ltspice?.install as {
      find: Record<string, string[]>;
      download?: unknown;
      hint: string;
    };
    expect(install.download).toBeUndefined();
    expect(install.find).toEqual({
      windows: ["%LOCALAPPDATA%/Programs/ADI/LTspice/LTspice.exe", "%ProgramFiles%/ADI/LTspice/LTspice.exe"],
    });
    expect(install.hint).toContain("analog.com/ltspice");
    const version = m.programs.ltspice?.version as { args: string[]; match: string; range: string };
    expect(version.args).toEqual(["-version"]);
    expect(new RegExp(version.match).exec("26.1.1\n")?.[1]).toBe("26");
    expect(version.range).toBe(">=26");
    const risk = (program: string, args: string[]) => classifyCommand(m.rules ?? [], program, args).risk;
    expect(risk("ltspice", ["-version"])).toBe("blocked");
    expect(risk("ltspice", ["-b", "x.cir"])).toBe("blocked");
    expect(risk("ltspice", ["x.asc"])).toBe("blocked");
    expect(risk("ltspice-tool", ["run", "--input", "r.json"])).toBe("safe");
    expect(risk("ltspice-tool", ["convert", "--schematic", "a.asc"])).toBe("safe");
    expect(risk("ltspice-tool", ["validate", "--netlist", "a.cir"])).toBe("safe");
    const readme = await readFile(join(source, "README.md"), "utf8");
    for (const text of ["Windows", "analog.com/ltspice", "License.txt", "2503", "never downloads"])
      expect(readme).toContain(text);
    const skill = await readFile(join(source, "skills", "ltspice-simulation", "SKILL.md"), "utf8");
    expect(skill).toContain("ltspice-tool");
    const catalog = parse(await readFile(fileURLToPath(new URL("catalog.yaml", plugins)), "utf8"));
    expect(catalog.official).toContain("ltspice");
    expect(catalog.metadata.ltspice.keywords).toContain("LTspice");
    const packs = parse(await readFile(fileURLToPath(new URL("packs.yaml", plugins)), "utf8")) as {
      id: string;
      groups: { name: string; plugins: string[]; default: boolean }[];
    }[];
    const group = packs
      .find((p) => p.id === "electronics")
      ?.groups.find((g) => g.plugins.includes("ltspice"));
    expect(group).toEqual({ name: "Simulation (LTspice, Windows)", plugins: ["ltspice"], default: false });
  });

  it("carries workspace.py, measure.py and sweep.py as byte-identical copies of ngspice-tool's (REQ-FUNC-52c19a19)", async () => {
    for (const name of ["workspace.py", "measure.py", "sweep.py"]) {
      const ours = await readFile(join(scripts, "ltspice_support", name));
      const theirs = await readFile(
        fileURLToPath(new URL(`ngspice/scripts/ngspice_support/${name}`, plugins)),
      );
      expect(sha256(ours), name).toBe(sha256(theirs));
    }
  });

  it("prints its version and help without an engine", () => {
    const version = spawnSync(python, ["-I", script, "--version"], { encoding: "utf8", env: env() });
    expect(version.stdout.trim()).toBe("ltspice-tool 1.0.0");
    const help = spawnSync(python, ["-I", script, "--help"], { encoding: "utf8", env: env() });
    expect(help.status).toBe(0);
    for (const op of ["validate", "convert", "run", "sweep", "measure", "compare", "report"])
      expect(help.stdout).toContain(op);
  });
});

describe("raw files (REQ-DATA-d4d85a22)", () => {
  interface Dumped {
    error?: string;
    message?: string;
    plot: string;
    flags: string[];
    names: string[];
    types: string[];
    points: number;
    axis: boolean;
    steps: number[];
    first: (number | number[])[];
    last: (number | number[])[];
    stepFirst: (number | number[])[][];
  }
  const dump = (file: string): Dumped => {
    const done = spawnSync(python, ["-I", join(fixtures, "raw_dump.py"), scripts, file], {
      encoding: "utf8",
      env: env(),
    });
    expect(done.stderr).toBe("");
    return JSON.parse(done.stdout) as Dumped;
  };
  const raw = (name: string) => join(fixtures, "raw", name);
  const column = (d: Dumped, name: string) =>
    d.names.findIndex((n) => n.toLowerCase() === name.toLowerCase());

  it("reads the real, double, complex, stepped, operating-point and noise files LTspice 26.1.1 wrote", () => {
    const tran = dump(raw("tran.raw"));
    expect(tran.plot).toBe("Transient Analysis");
    expect(tran.flags).toEqual(["forward", "real"]);
    expect(tran.names).toEqual(["time", "V(in)", "V(out)", "I(C1)", "I(R1)", "I(V1)"]);
    expect(tran.types.slice(0, 3)).toEqual(["time", "voltage", "voltage"]);
    expect(tran.axis).toBe(true);
    expect(tran.steps).toEqual([tran.points]);
    close(tran.last[0] as number, 2e-3, 1e-9);
    close(tran.last[column(tran, "V(out)")] as number, 1 - Math.exp(-2), 1e-4);
    const double = dump(raw("double.raw"));
    expect(double.flags).toEqual(["double", "forward", "real"]);
    // The same simulation stored as float64: equal to the float32 file within float32 precision.
    close(double.last[column(double, "V(out)")] as number, tran.last[column(tran, "V(out)")] as number, 1e-6);
    expect(double.points).toBe(tran.points);
    const ac = dump(raw("ac.raw"));
    expect(ac.flags).toEqual(["complex", "forward", "log"]);
    expect(ac.points).toBe(16);
    expect(ac.first[0]).toEqual([10, 0]);
    const out = ac.first[column(ac, "V(out)")] as number[];
    const w = 2 * Math.PI * 10 * 1e-3;
    close(out[0], 1 / (1 + w * w), 1e-6);
    close(out[1], -w / (1 + w * w), 1e-6);
    const steptran = dump(raw("steptran.raw"));
    expect(steptran.flags).toContain("stepped");
    expect(steptran.steps.length).toBe(2);
    expect(steptran.steps.reduce((a, b) => a + b, 0)).toBe(steptran.points);
    expect(steptran.stepFirst.map((s) => s[0])).toEqual([0, 0]);
    expect(steptran.stepFirst.map((s) => s[column(steptran, "V(out)")])).toEqual([5, 7.5]);
    const stepac = dump(raw("stepac.raw"));
    expect(stepac.flags).toEqual(["complex", "forward", "log", "stepped"]);
    expect(stepac.steps).toEqual([5, 5, 5]);
    const stepop = dump(raw("stepop.raw"));
    expect(stepop.plot).toBe("Operating Point");
    expect(stepop.axis).toBe(false);
    expect(stepop.names[0]).toBe("rb");
    expect(stepop.steps).toEqual([1, 1]);
    close(stepop.stepFirst[0]?.[column(stepop, "V(out)")] as number, 2.163934, 1e-6);
    close(stepop.stepFirst[1]?.[column(stepop, "V(out)")] as number, 6, 1e-6);
    const op = dump(raw("op.raw"));
    expect([op.axis, op.points, op.steps]).toEqual([false, 1, [1]]);
    close(op.first[column(op, "V(out)")] as number, 2.163934, 1e-6);
    const noise = dump(raw("noise.raw"));
    expect(noise.names).toEqual(["frequency", "gain", "v(R1)", "v(R2)", "v(onoise)", "v(inoise)"]);
    close(noise.first[column(noise, "v(onoise)")] as number, 2.8789e-9, 0.01);
  });

  it("reports cut, garbled and inconsistent files as partial or corrupt", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "vera-ltspice-raw-")));
    try {
      const data = await readFile(raw("tran.raw"));
      const marker = Buffer.from("Binary:\n", "utf16le");
      const body = data.indexOf(marker) + marker.length;
      const header = data.subarray(0, body).toString("utf16le");
      const write = async (name: string, bytes: Uint8Array) => {
        await writeFile(join(dir, name), bytes);
        return dump(join(dir, name));
      };
      expect((await write("cut.raw", data.subarray(0, data.length - 10))).error).toBe("partial");
      expect((await write("head.raw", data.subarray(0, body - 40))).error).toBe("partial");
      const garbled = Buffer.concat([
        Buffer.from(header.replace("No. Points:", "No. Pxints:"), "utf16le"),
        data.subarray(body),
      ]);
      expect((await write("garbled.raw", garbled)).error).toBe("corrupt");
      const count = Buffer.concat([
        Buffer.from(header.replace(/No\. Points:\s*\d+/, "No. Points: many"), "utf16le"),
        data.subarray(body),
      ]);
      expect((await write("count.raw", count)).error).toBe("corrupt");
      const backwards = Buffer.from(data);
      backwards.writeDoubleLE(0, body + 28 * 5);
      expect((await write("backwards.raw", backwards)).error).toBe("corrupt");
      expect((await write("text.raw", Buffer.from("not a raw file\n", "utf8"))).error).toBe("corrupt");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

const tranRc = { kind: "tran", step: "1 us", stop: "5 ms" };
const acRc = { kind: "ac", sweep: "dec", points: 100, start: "10 Hz", stop: "100 kHz" };
const corner = { id: "corner", kind: "value-at", vector: "vdb(out)", at: "159.155 Hz" };
/** A drive path (C:\ or C:/, also JSON-escaped C:\\) or a UNC path (\\server, JSON-escaped \\\\server). */
const absolutePath = /(?<![A-Za-z])[A-Za-z]:(?:\\|\/)|(?:^|[\s"'(])(?:\\\\){1,2}[A-Za-z0-9]/m;

describe("refusals before LTspice runs (offline)", { timeout: 120_000 }, () => {
  it("lists the chain, headers, subcircuits, models, dropped cards and options without the engine (REQ-FUNC-40bcbc04)", async () => {
    const dir = await bench();
    try {
      const done = run(dir, ["validate", "--netlist", "stage.cir"]);
      expect(done.code).toBe(0);
      const inputs = done.doc.inputs as { path: string; role: string; sha256: string; header?: string[] }[];
      expect(inputs.map((i) => [i.path, i.role])).toEqual([
        ["stage.cir", "netlist"],
        ["models/stage.lib", "include"],
        ["models/values.inc", "include"],
      ]);
      expect(inputs[1]?.header).toEqual([
        "RC stage, fictional model for ltspice-tool tests",
        "Licence: CC0 (written for VERA)",
      ]);
      expect(inputs[0]?.sha256).toBe(sha256(await readFile(join(dir, "stage.cir"))));
      expect(done.doc.subckts).toEqual({ rcstage: ["in", "out"] });
      expect(done.doc.models).toEqual(["dq"]);
      expect((done.doc.droppedCards as { card: string }[]).map((d) => d.card)).toEqual([".tran", ".meas"]);
      expect(done.doc.options).toEqual([".options reltol=1e-4"]);
      const options = run(dir, ["validate", "--netlist", "options-path.cir"]);
      expect(options.code, options.stdout).toBe(0);
      expect(JSON.stringify(options.doc.options)).not.toMatch(absolutePath);
      const milli = run(dir, ["validate", "--netlist", "milli.cir"]);
      expect(milli.code).toBe(0);
      expect(JSON.stringify(milli.doc.warnings)).toContain("milli");
      // A workbench library with sections: .lib FILE SECTION includes, .lib TT inside it starts a section.
      const sections = run(dir, ["validate", "--netlist", "sections.cir"]);
      expect(sections.code, sections.stdout).toBe(0);
      expect((sections.doc.inputs as { path: string }[]).map((i) => i.path)).toEqual([
        "sections.cir",
        "models/corners.lib",
      ]);
      const asc = run(dir, ["validate", "--netlist", "filter.asc"]);
      expect(asc.code).toBe(2);
      expect(asc.doc.errors?.[0]?.message).toContain("convert");
      expect(enginesIn(dir)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses every hostile netlist and include before LTspice runs, inputs unchanged (REQ-SEC-e5b9df02, REQ-SEC-c2953ca4)", async () => {
    const dir = await bench();
    try {
      const before = await hashes(dir);
      const cases: [string, string, string][] = [
        ["wave.cir", "file", "hostile/wave.cir:4"],
        ["fullwidth.cir", "file", "hostile/fullwidth.cir:4"],
        ["savebias.cir", "file", "hostile/savebias.cir:4"],
        ["loadbias.cir", "file", "hostile/loadbias.cir:4"],
        ["savestate.cir", "file", "hostile/savestate.cir:4"],
        ["loadstate.cir", "file", "hostile/loadstate.cir:4"],
        ["pwl-file.cir", "file", "hostile/pwl-file.cir:4"],
        ["wavefile.cir", "file", "hostile/wavefile.cir:4"],
        ["scopedata.cir", "file", "hostile/scopedata.cir:4"],
        ["tbl.cir", "file", "hostile/tbl.cir:4"],
        ["continuation.cir", "file", "hostile/continuation.cir:4"],
        ["table-include.cir", "file", "hostile/table-include.cir:4"],
        ["table-inc.cir", "file", "hostile/table-inc.cir:4"],
        ["table-lib.cir", "file", "hostile/table-lib.cir:4"],
        ["fastaccess.cir", "file", "hostile/fastaccess.cir:4"],
        ["fra.cir", "element", "hostile/fra.cir:4"],
        ["machine.cir", "card", "hostile/machine.cir:4"],
        ["unknown.cir", "card", "hostile/unknown.cir:4"],
        ["string.cir", "string", "hostile/string.cir:4"],
        ["nested.cir", "file", "hostile/nested.lib:3"],
        ["encrypted.cir", "encrypted", "hostile/encrypted.lib"],
        ["utf16.cir", "encoding", "hostile/utf16.cir"],
        ["outside.cir", "include", "hostile/outside.cir:4"],
        ["absolute.cir", "include", "hostile/absolute.cir:4"],
        ["unc.cir", "include", "hostile/unc.cir:4"],
        ["missing.cir", "include", "hostile/missing.cir:4"],
        ["lib-endl.cir", "include", "hostile/lib-endl.cir:4"],
        ["lib-quote.cir", "include", "hostile/lib-quote.cir:4"],
        ["cycle.cir", "include", "hostile/cycle.cir:4"],
        ["section.cir", "include", "hostile/section.lib:5"],
        ["lib-space.cir", "include", "hostile/lib-space.cir:4"],
        ["inc-semicolon.cir", "include", "hostile/inc-semicolon.cir:4"],
        ["ls-comment.cir", "encoding", "hostile/ls-comment.cir"],
        ["nel-element.cir", "encoding", "hostile/nel-element.cir"],
        ["ls-include.cir", "encoding", "hostile/ls-include.inc"],
        ["percent.cir", "include", "hostile/percent.cir:4"],
        ["unc-slash.cir", "include", "hostile/unc-slash.cir:4"],
        ["root.cir", "include", "hostile/root.cir:4"],
        ["file-noeq.cir", "file", "hostile/file-noeq.cir:4"],
        ["file-glued.cir", "file", "hostile/file-glued.cir:4"],
        ["scope-noeq.cir", "file", "hostile/scope-noeq.cir:4"],
        ["incl-abbrev.cir", "file", "hostile/incl-abbrev.cir:4"],
        ["inc-glued.cir", "file", "hostile/inc-glued.cir:4"],
        ["shy-file.cir", "encoding", "hostile/shy-file.cir"],
        ["zw-include.cir", "encoding", "hostile/zw-include.cir"],
        ["bom-file.cir", "encoding", "hostile/bom-file.cir"],
        ["shy-fastaccess.cir", "encoding", "hostile/shy-fastaccess.cir"],
        ["nfd-include.cir", "include", "hostile/nfd-include.cir:4"],
        // A folder name not in NFC (copied from a Mac): the copy's include line would name it and LTspice composes it.
        ["nfd-a\u0308/top.cir", "path", "hostile/nfd-a\u0308/top.cir"],
      ];
      for (const [file, code, path] of cases) {
        const done = run(dir, ["validate", "--netlist", `hostile/${file}`]);
        expect(done.code, file).toBe(2);
        expect(
          done.doc.errors?.map((e) => [e.code, e.path]),
          file,
        ).toContainEqual([code, path]);
        // A refused include written as an absolute path is shown by its file name (REQ-SEC-91ca52fe).
        for (const error of done.doc.errors ?? []) {
          expect(`${error.path} ${error.message}`, file).not.toMatch(absolutePath);
          expect(error.message, file).not.toContain("secret");
        }
        const ran = run(dir, [
          "run",
          "--json",
          JSON.stringify({ netlist: `hostile/${file}`, analysis: { kind: "op" }, vectors: ["v(out)"] }),
        ]);
        expect(ran.code, file).toBe(2);
      }
      // Every schematic of the folder is checked, in every encoding LTspice reads (UTF-16LE without BOM too).
      for (const file of ["abs/abs-symbol.asc", "up/up-symbol.asc", "u16/u16-symbol.asc", "sheets/top.asc"]) {
        const done = run(dir, ["convert", "--schematic", `schematics/${file}`]);
        expect(done.code, file).toBe(2);
        expect(done.doc.errors?.[0]?.code, file).toBe("symbol");
      }
      const nfd = run(dir, ["convert", "--schematic", "schematics/nfd-a\u0308/nfd.asc"]);
      expect(nfd.code).toBe(2);
      expect(nfd.doc.errors?.map((e) => [e.code, e.path])).toEqual([
        ["path", "schematics/nfd-a\u0308/nfd.asc"],
      ]);
      expect(existsSync(join(dir, "electronics-results"))).toBe(false);
      expect(await hashes(dir)).toEqual(before);
      expect(enginesIn(dir)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("refuses unknown parameters, single-step sweeps, profile limits and a missing LTspice before any run (REQ-FUNC-08dc4fb1, REQ-REL-517e9feb, REQ-REL-d17ee05f, REQ-FUNC-e90dd7e9)", async () => {
    const dir = await bench();
    try {
      const request = (extra: object) =>
        JSON.stringify({ netlist: "divider.cir", analysis: { kind: "op" }, vectors: ["v(out)"], ...extra });
      const code = (done: ReturnType<typeof run>) => [done.code, done.doc.errors?.[0]?.code];
      expect(code(run(dir, ["run", "--json", request({ parameters: { NOPE: "1" } })]))).toEqual([
        2,
        "parameter",
      ]);
      const cell = JSON.stringify({
        netlist: "subckt-param.cir",
        analysis: { kind: "op" },
        vectors: ["v(in)"],
        parameters: { RIN: "2k" },
      });
      expect(code(run(dir, ["run", "--json", cell]))).toEqual([2, "parameter"]);
      const long = request({ analysis: { kind: "tran", step: "1 ns", stop: "2 ms" } });
      expect(code(run(dir, ["run", "--json", long]))).toEqual([2, "limit"]);
      expect(
        code(run(dir, ["sweep", "--json", request({ sweep: { parameter: "RB", values: ["1k"] } })])),
      ).toEqual([2, "limit"]);
      expect(
        code(
          run(dir, ["sweep", "--json", request({ sweep: { parameter: "RB", values: ["1k", "1000"] } })]),
        )[0],
      ).toBe(2);
      const mc = {
        monteCarlo: {
          seed: 1,
          runs: 1,
          tolerances: { RB: { nominal: "1k", percent: 5, distribution: "uniform" } },
        },
      };
      expect(code(run(dir, ["sweep", "--json", request(mc)]))[0]).toBe(2);
      const missing = {
        VERA_PROGRAM_LTSPICE: join(nowhere, "LTspice.exe"),
        LOCALAPPDATA: nowhere,
        ProgramFiles: nowhere,
      };
      for (const args of [
        ["run", "--json", request({})],
        ["sweep", "--json", request({ sweep: { parameter: "RB", values: ["1k", "2k"] } })],
        ["convert", "--schematic", "filter.asc"],
      ]) {
        const done = run(dir, args, missing);
        expect(code(done)).toEqual([2, "engine"]);
        expect(done.doc.errors?.[0]?.message).toContain("analog.com/ltspice");
      }
      expect(run(dir, ["validate", "--netlist", "divider.cir"], missing).code).toBe(0);
      expect(existsSync(join(dir, "electronics-results"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

interface Result {
  format: number;
  kind: string;
  status: string;
  ltspice: { version: string; install: string };
  inputs: { path: string; role: string; bytes: number; sha256: string }[];
  engine: { exit: number; seconds: number; problems: { kind: string; line: string }[]; loaded: string[] };
  series?: { file: string; rows: number; columns: string[]; steps: number };
  measurements: Measured[];
  criteria: { measurement: string; status: string }[];
  warnings: string[];
  artifacts: { path: string }[];
  points?: { index: number; inputs: Record<string, number>; status: string; measurements: Measured[] }[];
  [key: string]: unknown;
}
const resultOf = async (dir: string, doc: Doc) =>
  JSON.parse(await readFile(join(dir, doc.folder as string, "result.json"), "utf8")) as Result;
const csvHeader = async (dir: string, doc: Doc, file = "series.csv") =>
  (await readFile(join(dir, doc.folder as string, file), "utf8")).split("\n")[0];
const slowSwitch = { kind: "tran", step: "10 us", stop: "100 ms", maxStep: "1 ns" };

describe.skipIf(!ltspice)("real LTspice runs", { timeout: 300_000 }, () => {
  it("identifies the installed LTspice as the manifest's version probe does (REQ-FUNC-285b6fcc)", async () => {
    const m: PluginManifest = parse(await readFile(join(source, "plugin.yaml"), "utf8"));
    const version = m.programs.ltspice?.version as { match: string };
    const probe = spawnSync(ltspice as string, ["-version"], { encoding: "utf8" });
    expect(Number(new RegExp(version.match, "m").exec(probe.stdout)?.[1])).toBeGreaterThanOrEqual(26);
  });

  it("runs the divider, RC transient, RC AC, DC sweep and noise on copies with ELEC-04 series names (REQ-FUNC-8e093f1b, REQ-FUNC-e6f31b12, REQ-DATA-0f9e36a3, REQ-REL-223a0738)", async () => {
    const dir = await bench();
    try {
      const before = await hashes(dir);
      const op = run(dir, [
        "run",
        "--run-id",
        "divider",
        "--json",
        JSON.stringify({
          netlist: "divider.cir",
          analysis: { kind: "op" },
          vectors: ["v(out)", "i(V1)"],
          measurements: [{ id: "out", kind: "final", vector: "v(out)" }],
        }),
      ]);
      expect(op.code, op.stdout).toBe(0);
      close(measured(op.doc, "out").value, (12 * 2.2) / 12.2, 1e-6);
      const result = await resultOf(dir, op.doc);
      expect([result.kind, result.status, result.ltspice.version]).toEqual([
        "ltspice-tool-result",
        "ok",
        "26.1.1",
      ]);
      expect(["per-user", "all-users", "other"]).toContain(result.ltspice.install);
      expect(result.format).toBe(1);
      expect(result.engine.exit).toBe(0);
      expect(result.engine.seconds).toBeTypeOf("number");
      expect(result.series).toMatchObject({
        file: "series.csv",
        rows: 1,
        steps: 1,
        columns: ["v(out)", "i(V1)"],
      });
      for (const artifact of result.artifacts)
        expect(existsSync(join(dir, artifact.path)), artifact.path).toBe(true);
      expect(result.artifacts.map((a) => a.path.split("/").pop()).sort()).toEqual([
        "plot.svg",
        "report.md",
        "series.csv",
      ]);
      expect(result.inputs[0]).toMatchObject({
        path: "divider.cir",
        role: "netlist",
        sha256: sha256(await readFile(join(dir, "divider.cir"))),
      });
      for (const name of [
        "effective.net",
        "effective.log",
        "effective.raw",
        "series.csv",
        "plot.svg",
        "report.md",
        "input/divider.cir",
      ])
        expect(existsSync(join(dir, op.doc.folder as string, name)), name).toBe(true);
      const effective = await readFile(join(dir, op.doc.folder as string, "effective.net"), "utf8");
      expect(effective.split("\n")[0]).toBe("* ltspice-tool effective netlist");
      expect(effective).toContain(".save V(out) I(V1)");
      expect(effective).not.toMatch(/^\.option/im);
      const warm = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "divider.cir",
          analysis: { kind: "op" },
          vectors: ["v(out)"],
          temperature: "50 °C",
        }),
      ]);
      expect(warm.code, warm.stdout).toBe(0);
      expect(await readFile(join(dir, warm.doc.folder as string, "effective.net"), "utf8")).toContain(
        "\n.temp 50\n",
      );
      const tran = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "rc.cir",
          analysis: tranRc,
          vectors: ["v(out)"],
          measurements: [{ id: "tau", kind: "value-at", vector: "v(out)", at: "1 ms" }],
        }),
      ]);
      expect(tran.code, tran.stdout).toBe(0);
      close(measured(tran.doc, "tau").value, 1 - Math.exp(-1), 0.002);
      expect(await csvHeader(dir, tran.doc)).toBe("time,v(out)");
      const ac = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "rc.cir",
          analysis: acRc,
          vectors: ["v(out)", "vdb(out)"],
          measurements: [corner, { id: "ten", kind: "value-at", vector: "v(out)", at: "10 Hz" }],
        }),
      ]);
      expect(ac.code, ac.stdout).toBe(0);
      expect(Math.abs((measured(ac.doc, "corner").value as number) + 3.0103)).toBeLessThanOrEqual(0.01);
      close(measured(ac.doc, "ten").value, 1 / Math.sqrt(1 + (2 * Math.PI * 10 * 1e-3) ** 2), 1e-6);
      expect(await csvHeader(dir, ac.doc)).toBe("frequency,v(out) re,v(out) im,vdb(out)");
      const dc = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "divider.cir",
          analysis: { kind: "dc", source: "V1", start: "0 V", stop: "12 V", step: "6 V" },
          vectors: ["v(out)", "v(in,out)"],
          measurements: [
            { id: "top", kind: "final", vector: "v(out)" },
            { id: "drop", kind: "final", vector: "v(in,out)" },
          ],
        }),
      ]);
      expect(dc.code, dc.stdout).toBe(0);
      // The CSV writer quotes a name with a comma, as ngspice-tool's series do.
      expect(await csvHeader(dir, dc.doc)).toBe('v-sweep,v(out),"v(in,out)"');
      close(measured(dc.doc, "top").value, (12 * 2.2) / 12.2, 1e-6);
      close(measured(dc.doc, "drop").value, (12 * 10) / 12.2, 1e-6);
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
      ]);
      expect(noise.code, noise.stdout).toBe(0);
      expect(await csvHeader(dir, noise.doc)).toBe("frequency,onoise_spectrum,inoise_spectrum");
      // Noise spectra are measured from a run folder (ngspice-tool's contract): measure gives the value at 100 Hz.
      const spectrum = run(dir, [
        "measure",
        "--run",
        noise.doc.folder as string,
        "--json",
        JSON.stringify({
          measurements: [{ id: "n", kind: "value-at", vector: "onoise_spectrum", at: "100 Hz" }],
        }),
      ]);
      expect(spectrum.code, spectrum.stdout).toBe(0);
      close(measured(spectrum.doc, "n").value, 2.8789e-9, 0.01);
      expect(await hashes(dir)).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("overrides a parameter by rewriting its assignment, runs includes, library models and a schematic (REQ-FUNC-08dc4fb1, REQ-SEC-c2953ca4, REQ-FUNC-0a9592c1)", async () => {
    const dir = await bench();
    try {
      const before = await hashes(dir);
      const rb = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "divider.cir",
          analysis: { kind: "op" },
          vectors: ["v(out)"],
          parameters: { RB: "10k" },
          measurements: [{ id: "out", kind: "final", vector: "v(out)" }],
        }),
      ]);
      expect(rb.code, rb.stdout).toBe(0);
      close(measured(rb.doc, "out").value, 6, 1e-6);
      expect(await readFile(join(dir, rb.doc.folder as string, "effective.net"), "utf8")).toMatch(
        /\.param RB=10000\b/,
      );
      const stage = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "stage.cir",
          analysis: acRc,
          vectors: ["vdb(out)"],
          measurements: [corner],
        }),
      ]);
      expect(stage.code, stage.stdout).toBe(0);
      expect(Math.abs((measured(stage.doc, "corner").value as number) + 3.0103)).toBeLessThanOrEqual(0.01);
      const staged = await resultOf(dir, stage.doc);
      expect(staged.warnings.join(" ")).toContain(".tran");
      expect(staged.options).toEqual([".options reltol=1e-4"]);
      expect(existsSync(join(dir, stage.doc.folder as string, "input/models/values.inc"))).toBe(true);
      // RV is assigned in a nested include: the copy of that include gets the new value; RV = 2k halves the corner.
      const rv = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "stage.cir",
          analysis: acRc,
          vectors: ["vdb(out)"],
          parameters: { RV: "2k" },
          measurements: [{ ...corner, at: "79.5775 Hz" }],
        }),
      ]);
      expect(rv.code, rv.stdout).toBe(0);
      expect(Math.abs((measured(rv.doc, "corner").value as number) + 3.0103)).toBeLessThanOrEqual(0.01);
      expect(await readFile(join(dir, rv.doc.folder as string, "input/models/values.inc"), "utf8")).toContain(
        ".param RV=2000",
      );
      expect(await readFile(join(dir, "models/values.inc"), "utf8")).toContain(".param RV=1k");
      // LTspice's library: a bare .lib LTC.lib and the absolute standard.dio path -netlist writes are library inputs.
      const ltc = run(dir, ["validate", "--netlist", "ltc.cir"]);
      expect(ltc.code, ltc.stdout).toBe(0);
      expect(ltc.doc.inputs).toContainEqual(
        expect.objectContaining({ path: "<LTspice library>/sub/LTC.lib", role: "library" }),
      );
      const diode = run(dir, ["convert", "--schematic", "diode/diode.asc"]);
      expect(diode.code, diode.stdout).toBe(0);
      const diodeResult = await resultOf(dir, diode.doc);
      expect(diodeResult.inputs).toContainEqual(
        expect.objectContaining({ path: "<LTspice library>/cmp/standard.dio", role: "library" }),
      );
      expect(JSON.stringify(diodeResult)).not.toMatch(absolutePath);
      const libraryFile = join(process.env.LOCALAPPDATA as string, "LTspice", "lib", "cmp", "standard.dio");
      const libraryHash = sha256(await readFile(libraryFile));
      const lib = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "library.cir",
          analysis: { kind: "op" },
          vectors: ["v(a)"],
          measurements: [{ id: "vf", kind: "final", vector: "v(a)" }],
        }),
      ]);
      expect(lib.code, lib.stdout).toBe(0);
      const vf = measured(lib.doc, "vf").value as number;
      expect(vf).toBeGreaterThanOrEqual(0.55);
      expect(vf).toBeLessThanOrEqual(0.8);
      const libResult = await resultOf(dir, lib.doc);
      expect(sha256(await readFile(libraryFile))).toBe(libraryHash);
      expect(libResult.inputs.find((i) => i.role === "library")?.sha256).toBe(libraryHash);
      // The library include names the exact file that was hashed (LTspice does not search again).
      const libEffective = await readFile(join(dir, lib.doc.folder as string, "effective.net"), "utf8");
      expect(libEffective).toContain(`.lib "${libraryFile}"`);
      expect(libEffective).not.toMatch(/^\.lib standard\.dio$/m);
      expect(libResult.inputs).toContainEqual(
        expect.objectContaining({ path: "<LTspice library>/cmp/standard.dio", role: "library" }),
      );
      expect(libResult.engine.loaded).toContain("<LTspice library>/cmp/standard.dio");
      const runFiles = await readdir(join(dir, lib.doc.folder as string), { recursive: true });
      expect(runFiles.some((f) => String(f).toLowerCase().endsWith("standard.dio"))).toBe(false);
      const asc = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "filter.asc",
          analysis: acRc,
          vectors: ["vdb(out)"],
          measurements: [corner],
        }),
      ]);
      expect(asc.code, asc.stdout).toBe(0);
      expect(Math.abs((measured(asc.doc, "corner").value as number) + 3.0103)).toBeLessThanOrEqual(0.01);
      const converted = run(dir, ["convert", "--schematic", "filter.asc"]);
      expect(converted.code, converted.stdout).toBe(0);
      const net = await readFile(join(dir, converted.doc.folder as string, "filter.net"), "utf8");
      expect(net).toContain("R1 out in 1k");
      expect(net).toContain("V1 in 0 AC 1");
      expect(net).toMatch(/^C1 out 0 1/m);
      expect(net).toContain(".ac dec 10 10 10k");
      expect(existsSync(join(dir, converted.doc.folder as string, "input/filter.asc"))).toBe(true);
      const bad = run(dir, ["convert", "--schematic", "schematics/nosymbol.asc"]);
      expect([bad.code, bad.doc.status]).toEqual([3, "failed"]);
      expect((await resultOf(dir, bad.doc)).engine.problems.map((p) => p.kind)).toEqual(["convert"]);
      const nel = run(dir, ["convert", "--schematic", "schematics/nel/nel-text.asc"]);
      expect([nel.code, nel.doc.errors?.[0]?.code]).toEqual([2, "encoding"]);
      const wave = run(dir, ["convert", "--schematic", "schematics/wave.asc"]);
      expect(wave.code).toBe(2);
      expect(wave.doc.errors?.[0]?.code).toBe("file");
      expect(await hashes(dir)).toEqual(before);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("measures average power and criteria on LTspice data as on ngspice's (REQ-FUNC-52bb81f2, REQ-FUNC-7785cea9)", async () => {
    const dir = await bench();
    try {
      const done = run(dir, [
        "run",
        "--json",
        JSON.stringify({
          netlist: "switch.cir",
          analysis: { kind: "tran", step: "100 ns", stop: "2 ms", maxStep: "100 ns" },
          vectors: ["v(a)", "i(Vsense)"],
          measurements: [
            {
              id: "loss",
              kind: "average-power",
              voltage: "v(a)",
              current: "i(Vsense)",
              window: { from: "1 ms", to: "2 ms" },
            },
          ],
          criteria: [
            { measurement: "loss", op: "<=", value: "8 W" },
            { measurement: "loss", op: "<=", value: "5 W" },
          ],
        }),
      ]);
      expect(done.code, done.stdout).toBe(0);
      const loss = measured(done.doc, "loss") as Measured & { peakInstantaneous: number };
      close(loss.value, 7.058, 0.005);
      close(loss.peakInstantaneous, 14.116, 0.005);
      expect(done.doc.criteria?.map((c) => c.status)).toEqual(["pass", "fail"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports model, subcircuit, singular, convergence and vector failures without any pass (REQ-REL-97287e21, REQ-SEC-91ca52fe)", async () => {
    const dir = await bench();
    try {
      const cases: [string, object, string][] = [
        ["missing-model.cir", { kind: "op" }, "model"],
        ["missing-subckt.cir", { kind: "op" }, "subckt"],
        ["singular.cir", { kind: "op" }, "singular"],
        ["loop.cir", { kind: "tran", step: "1 us", stop: "1 ms" }, "convergence"],
      ];
      for (const [netlist, analysis, kind] of cases) {
        const done = run(dir, [
          "run",
          "--json",
          JSON.stringify({
            netlist,
            analysis,
            vectors: ["v(a)"],
            measurements: [{ id: "m", kind: "final", vector: "v(a)" }],
            criteria: [{ measurement: "m", op: "<=", value: "100 V" }],
          }),
        ]);
        expect([done.code, done.doc.status], netlist).toEqual([3, "failed"]);
        const result = await resultOf(dir, done.doc);
        expect(
          result.engine.problems.map((p) => p.kind),
          netlist,
        ).toContain(kind);
        expect(result.measurements.map((m) => m.status)).toEqual(["not-evaluated"]);
        expect(result.criteria.map((c) => c.status)).toEqual(["not-evaluated"]);
        expect(JSON.stringify(result), netlist).not.toMatch(absolutePath);
        if (kind === "convergence")
          expect(result.engine.problems.map((p) => p.line).join(" ")).toContain("Time step too small");
        if (kind === "model")
          expect(result.engine.problems.find((p) => p.kind === "model")?.line).toMatch(
            /effective\.net\(\d+\): Undefined model/,
          );
        expect(existsSync(join(dir, done.doc.folder as string, "effective.log"))).toBe(true);
      }
      const vector = run(dir, [
        "run",
        "--json",
        JSON.stringify({ netlist: "divider.cir", analysis: { kind: "op" }, vectors: ["v(nonode)"] }),
      ]);
      expect([vector.code, vector.doc.status]).toEqual([3, "failed"]);
      expect((await resultOf(dir, vector.doc)).engine.problems.map((p) => p.kind)).toContain("vector");
      expect(enginesIn(dir)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("stops LTspice at its time limit and at the data limit, leaving no process (REQ-REL-517e9feb, REQ-REL-f14fbe8e)", async () => {
    const dir = await bench();
    try {
      const slow = (limit: string) =>
        JSON.stringify({ netlist: "switch.cir", analysis: slowSwitch, vectors: ["v(a)"], timeLimit: limit });
      const timed = run(dir, ["run", "--json", slow("2 s")]);
      expect([timed.code, timed.doc.status]).toEqual([3, "timeout"]);
      expect(existsSync(join(dir, timed.doc.folder as string, "effective.log"))).toBe(true);
      expect(existsSync(join(dir, timed.doc.folder as string, "effective.raw"))).toBe(true);
      expect(enginesIn(dir)).toBe(0);
      const limited = spawnSync(
        python,
        ["-I", join(fixtures, "limit.py"), scripts, "run", "--json", slow("60 s")],
        {
          cwd: dir,
          encoding: "utf8",
          env: env(),
        },
      );
      const doc = JSON.parse(limited.stdout) as Doc;
      expect([limited.status, doc.status]).toEqual([3, "failed"]);
      expect((await resultOf(dir, doc)).engine.problems.map((p) => p.kind)).toContain("limit");
      expect(enginesIn(dir)).toBe(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("leaves no LTspice process when VERA stops the helper's process tree (REQ-REL-f14fbe8e, REQ-TEST-c6909384)", async () => {
    const dir = await bench();
    try {
      const request = JSON.stringify({
        netlist: "switch.cir",
        analysis: slowSwitch,
        vectors: ["v(a)"],
        timeLimit: "60 s",
      });
      const child = spawn(python, ["-I", script, "run", "--run-id", "stopped", "--json", request], {
        cwd: dir,
        env: env(),
        stdio: "ignore",
      });
      const deadline = Date.now() + 20000;
      while (enginesIn(dir) === 0 && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 200));
      expect(enginesIn(dir)).toBe(1);
      const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
      spawnSync(taskkill, ["/T", "/F", "/PID", String(child.pid)]);
      await new Promise((resolve) => setTimeout(resolve, 1000));
      expect(enginesIn(dir)).toBe(0);
      expect(existsSync(join(dir, "electronics-results", "stopped", "result.json"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("removes a run whose input changed or whose report cannot be written (REQ-REL-d20f53a0)", async () => {
    const dir = await bench();
    try {
      await writeFile(
        join(dir, "request.json"),
        JSON.stringify({ netlist: "divider.cir", analysis: { kind: "op" }, vectors: ["v(out)"] }),
      );
      const hook = (name: string, id: string) =>
        spawnSync(
          python,
          ["-I", join(fixtures, name), scripts, "run", "--run-id", id, "--input", "request.json"],
          {
            cwd: dir,
            encoding: "utf8",
            env: env(),
          },
        );
      expect(hook("change_input.py", "changed").status).toBe(3);
      expect(existsSync(join(dir, "electronics-results", "changed"))).toBe(false);
      expect(hook("write_fail.py", "full").status).toBe(3);
      expect(existsSync(join(dir, "electronics-results", "full"))).toBe(false);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("sweeps a parameter, the temperature and seeded Monte Carlo draws in one .step run; compares, measures and reports (REQ-FUNC-e90dd7e9, REQ-FUNC-2aa76757, REQ-FUNC-457a6e05, REQ-FUNC-079e7b77)", async () => {
    const dir = await bench();
    try {
      const out = [{ id: "out", kind: "final", vector: "v(out)" }];
      const base = { analysis: { kind: "op" }, vectors: ["v(out)"], measurements: out };
      const load = run(dir, [
        "sweep",
        "--json",
        JSON.stringify({ netlist: "load.cir", ...base, sweep: { parameter: "RLOAD", values: ["1k", "3k"] } }),
      ]);
      expect(load.code, load.stdout).toBe(0);
      const loadPoints = (await resultOf(dir, load.doc)).points ?? [];
      close(measured(loadPoints[0] as { measurements: Measured[] }, "out").value, 5, 1e-5);
      close(measured(loadPoints[1] as { measurements: Measured[] }, "out").value, 7.5, 1e-5);
      const effective = await readFile(join(dir, load.doc.folder as string, "effective.net"), "utf8");
      expect(effective).toContain(".step param vera_point list 1 2");
      const temp = run(dir, [
        "sweep",
        "--json",
        JSON.stringify({
          netlist: "temp.cir",
          ...base,
          sweep: { parameter: "temperature", values: ["100 °C", "0 °C", "27 °C"] },
        }),
      ]);
      expect(temp.code, temp.stdout).toBe(0);
      const temps = (await resultOf(dir, temp.doc)).points ?? [];
      expect(await readFile(join(dir, temp.doc.folder as string, "effective.net"), "utf8")).toContain(
        ".step temp list 0 27 100",
      );
      expect(temps.map((p) => p.inputs.temperature)).toEqual([100, 0, 27]);
      for (const [point, expected] of [
        [0, 0.3663],
        [1, 0.578035],
        [2, 0.5],
      ] as const)
        close(measured(temps[point] as { measurements: Measured[] }, "out").value, expected, 1e-5);
      const mc = (seed: number, id: string) =>
        run(dir, [
          "sweep",
          "--run-id",
          id,
          "--json",
          JSON.stringify({
            netlist: "load.cir",
            ...base,
            monteCarlo: {
              seed,
              runs: 5,
              tolerances: { RLOAD: { nominal: "1k", percent: 10, distribution: "uniform" } },
            },
          }),
        ]);
      const a = mc(7, "mc7a");
      const b = mc(7, "mc7b");
      const c = mc(8, "mc8");
      expect([a.code, b.code, c.code]).toEqual([0, 0, 0]);
      const [ra, rb, rc] = await Promise.all([
        resultOf(dir, a.doc),
        resultOf(dir, b.doc),
        resultOf(dir, c.doc),
      ]);
      expect(rb.points?.map((p) => p.inputs)).toEqual(ra.points?.map((p) => p.inputs));
      expect(rb.points?.map((p) => measured(p, "out").value)).toEqual(
        ra.points?.map((p) => measured(p, "out").value),
      );
      expect(rc.points?.map((p) => p.inputs)).not.toEqual(ra.points?.map((p) => p.inputs));
      for (const p of ra.points ?? []) {
        const r = p.inputs.RLOAD as number;
        expect(r).toBeGreaterThanOrEqual(900);
        expect(r).toBeLessThanOrEqual(1100);
        close(measured(p, "out").value, (10 * r) / (1000 + r), 1e-5);
      }
      const compared = run(dir, [
        "compare",
        "--run",
        "electronics-results/mc7a",
        "--run",
        "electronics-results/mc8",
      ]);
      expect(compared.code).toBe(0);
      expect(JSON.stringify(compared.doc.differences)).toContain("seed");
      for (const point of [1, 2, 3, 4, 5])
        expect(JSON.stringify(compared.doc.differences)).toContain(`point ${point} RLOAD`);
      const ac = run(dir, [
        "run",
        "--run-id",
        "ac",
        "--json",
        JSON.stringify({
          netlist: "rc.cir",
          analysis: acRc,
          vectors: ["v(out)"],
          measurements: [{ id: "ten", kind: "value-at", vector: "v(out)", at: "10 Hz" }],
          criteria: [{ measurement: "ten", op: ">=", value: "0.99" }],
        }),
      ]);
      expect(ac.code).toBe(0);
      const ten = { measurements: [{ id: "ten", kind: "value-at", vector: "v(out)", at: "10 Hz" }] };
      const m = run(dir, ["measure", "--run", "electronics-results/ac", "--json", JSON.stringify(ten)]);
      expect(m.code, m.stdout).toBe(0);
      close(measured(m.doc, "ten").value, 1 / Math.sqrt(1 + (2 * Math.PI * 10 * 1e-3) ** 2), 1e-6);
      const failed = run(dir, [
        "run",
        "--run-id",
        "failed",
        "--json",
        JSON.stringify({
          netlist: "missing-model.cir",
          analysis: { kind: "op" },
          vectors: ["v(a)"],
          measurements: [{ id: "m", kind: "final", vector: "v(a)" }],
          criteria: [{ measurement: "m", op: "<=", value: "100 V" }],
        }),
      ]);
      expect(failed.code).toBe(3);
      const reported = run(dir, [
        "report",
        "--run",
        "electronics-results/ac",
        "--run",
        "electronics-results/failed",
      ]);
      expect(reported.code).toBe(0);
      const summary = JSON.parse(
        await readFile(join(dir, reported.doc.folder as string, "report.json"), "utf8"),
      ) as {
        runs: { runId: string; status: string; measurements: Measured[]; criteria: { status: string }[] }[];
      };
      expect(summary.runs.map((r) => [r.runId, r.status])).toEqual([
        ["ac", "ok"],
        ["failed", "failed"],
      ]);
      close(summary.runs[0]?.measurements[0]?.value, 1 / Math.sqrt(1 + (2 * Math.PI * 10 * 1e-3) ** 2), 1e-6);
      expect(summary.runs.map((r) => r.criteria.map((c) => c.status))).toEqual([["pass"], ["not-evaluated"]]);
      expect(await readFile(join(dir, reported.doc.folder as string, "report.md"), "utf8")).toContain(
        "failed",
      );
      // A series edited after the run is refused.
      await writeFile(
        join(dir, "electronics-results", "ac", "series.csv"),
        "frequency,v(out) re,v(out) im\n10,1,0\n",
      );
      const edited = run(dir, ["measure", "--run", "electronics-results/ac", "--json", JSON.stringify(ten)]);
      expect(edited.code).toBe(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("works in a folder with spaces and non-ASCII characters and writes no absolute path into results (REQ-SEC-91ca52fe)", async () => {
    const dir = await bench("vera ltspice \u0163 \u00fc-");
    try {
      const op = (netlist: string, vector: string) =>
        run(dir, ["run", "--json", JSON.stringify({ netlist, analysis: { kind: "op" }, vectors: [vector] })]);
      const done = op("library.cir", "v(a)");
      expect(done.code, done.stdout).toBe(0);
      expect(done.stdout).not.toMatch(absolutePath);
      expect(await readFile(join(dir, done.doc.folder as string, "result.json"), "utf8")).not.toMatch(
        absolutePath,
      );
      expect(await readFile(join(dir, done.doc.folder as string, "report.md"), "utf8")).not.toMatch(
        absolutePath,
      );
      const bad = op("missing-model.cir", "v(a)");
      expect(bad.code).toBe(3);
      expect(await readFile(join(dir, bad.doc.folder as string, "result.json"), "utf8")).not.toMatch(
        absolutePath,
      );
      const converted = run(dir, ["convert", "--schematic", "filter.asc"]);
      expect(converted.code).toBe(0);
      expect(await readFile(join(dir, converted.doc.folder as string, "result.json"), "utf8")).not.toMatch(
        absolutePath,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it.skipIf(!ngspice)(
    "matches ngspice-tool on the same requests within the README tolerances (REQ-TEST-99244ca8)",
    async () => {
      const dir = await bench();
      try {
        const noiseAnalysis = {
          kind: "noise",
          output: "v(out)",
          source: "V1",
          sweep: "dec",
          points: 5,
          start: "10 Hz",
          stop: "1 kHz",
        };
        const requests: [object, number, "relative" | "absolute"][] = [
          [
            {
              netlist: "divider.cir",
              analysis: { kind: "op" },
              vectors: ["v(out)"],
              measurements: [{ id: "m", kind: "final", vector: "v(out)" }],
            },
            1e-6,
            "relative",
          ],
          [
            {
              netlist: "rc.cir",
              analysis: tranRc,
              vectors: ["v(out)"],
              measurements: [{ id: "m", kind: "value-at", vector: "v(out)", at: "1 ms" }],
            },
            0.002,
            "relative",
          ],
          [
            {
              netlist: "rc.cir",
              analysis: acRc,
              vectors: ["vdb(out)"],
              measurements: [{ ...corner, id: "m" }],
            },
            0.01,
            "absolute",
          ],
          [{ netlist: "noise.cir", analysis: noiseAnalysis, vectors: ["v(out)"] }, 0.01, "relative"],
        ];
        const spectrum = JSON.stringify({
          measurements: [{ id: "m", kind: "value-at", vector: "onoise_spectrum", at: "100 Hz" }],
        });
        for (const [request, tolerance, how] of requests) {
          let lt = run(dir, ["run", "--json", JSON.stringify(request)]);
          let ng = run(dir, ["run", "--json", JSON.stringify(request)], {}, ngspiceScript);
          expect([lt.code, ng.code], JSON.stringify(request)).toEqual([0, 0]);
          if (!("measurements" in request)) {
            lt = run(dir, ["measure", "--run", lt.doc.folder as string, "--json", spectrum]);
            ng = run(
              dir,
              ["measure", "--run", ng.doc.folder as string, "--json", spectrum],
              {},
              ngspiceScript,
            );
          }
          const [a, b] = [measured(lt.doc, "m").value as number, measured(ng.doc, "m").value as number];
          const allowed = how === "relative" ? Math.abs(b) * tolerance : tolerance;
          expect(Math.abs(a - b), `LTspice ${a} vs ngspice ${b}`).toBeLessThanOrEqual(allowed);
        }
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    },
  );
});

it.skipIf(ltspice)(`skips the real-engine tests: ${NO_LTSPICE}`, () => {
  expect(ltspice).toBeUndefined();
});
