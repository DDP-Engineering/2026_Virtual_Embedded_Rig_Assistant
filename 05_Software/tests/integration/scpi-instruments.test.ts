// The scpi-instruments plugin without instruments. Default tests check the package, the risk rules, the helper against
// a fake PyVISA (tests/fixtures/scpi-instruments/fake-pyvisa: simulated DP832, DS1104Z, 34461A - offline evidence
// only, never proof of a real instrument), VERA's real runner supervising real helper processes (stop request, kill,
// cleanup run, unknown state) and a lease held by another Node process. VERA_SCPI_UV names a real uv: the opt-in test
// installs the pinned PyVISA/pyvisa-py from PyPI and talks to a local SCPI socket server over TCPIP SOCKET.
// REQ-DATA-4451f705 REQ-SEC-f9f009d9 REQ-SEC-8737759e REQ-SEC-9524d2c9 REQ-FUNC-b1ab08fd REQ-FUNC-712a3679
// REQ-REL-4f6d4a31 REQ-FUNC-f682af02 REQ-FUNC-a8dcf154 REQ-DATA-b3e2930f REQ-SEC-371cdb26 REQ-FUNC-3bf3d5bc
// REQ-REL-3817f2fd REQ-FUNC-d4b72e6b REQ-FUNC-e4ca09ad REQ-REL-52212fce REQ-TEST-2d32cd86
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = fileURLToPath(new URL("../../", import.meta.url));
const pluginFolder = join(software, "plugins", "scpi-instruments");
const script = join(pluginFolder, "scripts", "scpi_tool.py");
const fixtures = fileURLToPath(new URL("../fixtures/scpi-instruments/", import.meta.url));
const fakePyvisa = join(fixtures, "fake-pyvisa");
const windows = process.platform === "win32";
const python = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));

const PSU = "USB0::0x1AB1::0x0E11::DP8C1::INSTR";
const SCOPE = "TCPIP0::10.0.0.5::INSTR";
const DMM = "USB0::0x2A8D::0x1301::MY1::INSTR";
const IDN = {
  psu: "RIGOL TECHNOLOGIES,DP832,DP8C1,00.01.16",
  scope: "RIGOL TECHNOLOGIES,DS1104Z,DS1ZA1,00.04.04.SP4",
  dmm: "Keysight Technologies,34461A,MY1,A.03.01-02.40-03.01-00.52-02-01",
};
const registry = {
  format: 1,
  resources: [
    {
      alias: "psu",
      kind: "visa",
      resource: PSU,
      serial: "DP8C1",
      profile: "rigol-dp800",
      limits: { CH1: { voltage: 5.5 } },
    },
    { alias: "scope", kind: "visa", resource: SCOPE, profile: "rigol-ds1000z" },
    { alias: "dmm", kind: "visa", resource: DMM, profile: "keysight-34461a" },
  ],
};
type Bench = Record<string, { model: string; idn: string; faults?: Record<string, unknown> }>;
const bench = (
  faults: Partial<Record<"psu" | "scope" | "dmm", Record<string, unknown>>> = {},
  idn: Partial<typeof IDN> = {},
): Bench => ({
  [PSU]: { model: "dp832", idn: idn.psu ?? IDN.psu, faults: faults.psu ?? {} },
  [SCOPE]: { model: "ds1104z", idn: idn.scope ?? IDN.scope, faults: faults.scope ?? {} },
  [DMM]: { model: "34461a", idn: idn.dmm ?? IDN.dmm, faults: faults.dmm ?? {} },
});

let root = "";
const paths = () => ({
  registry: join(root, "lab", "resources.json"),
  bench: join(root, "bench.json"),
  state: join(root, "fake-state.json"),
  log: join(root, "fake-visa.log"),
});
async function setBench(value: Bench | Record<string, unknown>) {
  await writeFile(paths().bench, JSON.stringify("resources" in value ? value : { resources: value }));
}
function environment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { VERA_RUN_CONTROL: _a, VERA_RESOURCE_STATE: _b, ...rest } = process.env;
  return {
    ...rest,
    PYTHONPATH: fakePyvisa,
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    SCPI_REGISTRY: paths().registry,
    FAKE_VISA_BENCH: paths().bench,
    FAKE_VISA_STATE: paths().state,
    FAKE_VISA_LOG: paths().log,
    ...extra,
  };
}
// biome-ignore lint/suspicious/noExplicitAny: the helper's printed JSON documents, checked field by field.
type Json = Record<string, any>;
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
}
function scpi(args: string[], extra: Record<string, string> = {}): Run {
  const result = spawnSync(python, [script, ...args], {
    cwd: root,
    env: environment(extra),
    encoding: "utf8",
    timeout: 60_000,
  });
  const stdout = result.stdout ?? "";
  let json: Json = {};
  try {
    json = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
  } catch {
    json = { unparsed: stdout, stderr: result.stderr };
  }
  return { code: result.status, json, stdout };
}
const transcript = () =>
  existsSync(paths().log) ? readFileSync(paths().log, "utf8").trim().split("\n").filter(Boolean) : [];
const sent = () =>
  transcript()
    .filter((line) => line.startsWith("W "))
    .map((line) => line.slice(2));
const fakeState = () => JSON.parse(readFileSync(paths().state, "utf8"));
const resultOf = (run: Run) => JSON.parse(readFileSync(join(root, run.json.result), "utf8"));
async function clearLog() {
  await rm(paths().log, { force: true });
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-scpi-")));
  await mkdir(join(root, "lab"));
  await mkdir(join(root, ".vera"));
  await writeFile(paths().registry, JSON.stringify(registry));
  await setBench(bench());
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("package", () => {
  it("publishes the official scpi-instruments package, its pack, metadata and two skills", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({
      id: "scpi-instruments",
      version: "1.0.0",
      ecosystem: "lab",
      platforms: ["windows-x64", "linux-x64"],
    });
    expect(m.programs.scpi).toMatchObject({
      install: { script: "scripts/scpi_tool.py" },
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest placeholder, compared literally.
      env: { SCPI_REGISTRY: "${workbench}/lab/resources.json" },
      resources: {
        option: "--instrument",
        kinds: ["visa"],
        grace: 10,
        cleanup: ["close"],
        cleanupTimeout: 60,
      },
    });
    const header = readFileSync(script, "utf8");
    expect(header).toContain(
      'dependencies = ["pyvisa==1.16.2", "pyvisa-py==0.8.1", "pyserial==3.5", "pyusb==1.3.1"]',
    );
    const catalog = parse(readFileSync(join(software, "plugins", "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("scpi-instruments");
    expect(catalog.metadata["scpi-instruments"].activities).toEqual(["measurement"]);
    const packs = parse(readFileSync(join(software, "plugins", "packs.yaml"), "utf8"));
    expect(packs).toContainEqual({
      id: "lab",
      name: "Embedded lab",
      groups: [{ name: "Bench instruments (SCPI)", plugins: ["scpi-instruments"], default: true }],
    });
    expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(pluginFolder);
    const installed = await store.load("scpi-instruments");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const names = (await skills.list())
      .filter((skill) => skill.plugin === "scpi-instruments")
      .map((skill) => skill.name);
    expect(names.sort()).toEqual(["bench-instruments", "instrument-profiles"]);
    const usage = (await skills.read("plugin", "bench-instruments")).content;
    for (const text of [
      "lab/resources.json",
      "scpi output",
      "--hold",
      "program_stop",
      "state-unknown",
      "BUSY",
    ])
      expect(usage).toContain(text);
  });

  it("ships three valid profiles, each marked unverified until a real instrument run", () => {
    const run = spawnSync(
      python,
      [
        "-c",
        `import sys; sys.dont_write_bytecode=True; sys.path.insert(0, r"${join(pluginFolder, "scripts")}"); from scpi_support import profiles; print(",".join(p.id + ":" + p.kind + ":" + p.data["verification"]["status"] for p in profiles.all_profiles()))`,
      ],
      { encoding: "utf8" },
    );
    expect(run.stdout.trim()).toBe(
      "keysight-34461a:dmm:unverified,rigol-dp800:psu:unverified,rigol-ds1000z:scope:unverified",
    );
  });
});

describe("risk of each operation (L01-C)", () => {
  it("classifies by the first argument and never lets an option hide an output", () => {
    const rules = manifest().rules;
    const risk = (args: string[]) => classifyCommand(rules, "scpi", args);
    const cases: [string, string[]][] = [
      ["safe", ["--version"]],
      ["safe", ["capabilities", "--profile", "rigol-dp800"]],
      ["safe", ["discover-configured"]],
      ["device-read", ["discover-configured", "--list-local"]],
      ["safe", ["decode", "--capture", "embedded-lab-results/x"]],
      ["device-read", ["identify", "--instrument", "psu"]],
      ["device-read", ["read", "--instrument", "dmm"]],
      ["device-read", ["capture", "--instrument", "scope", "--channel", "CHAN1"]],
      ["device-read", ["status", "--instrument", "psu"]],
      ["device-write", ["configure", "--instrument", "psu", "--set", "CH1.voltage=3"]],
      ["device-write", ["close", "--instrument", "psu"]],
      [
        "irreversible",
        [
          "output",
          "--instrument",
          "psu",
          "--channel",
          "CH1",
          "--voltage",
          "3",
          "--current",
          "0.1",
          "--hold",
          "5",
        ],
      ],
      ["irreversible", ["output", "--hold", "5", "--instrument", "psu"]],
      ["device-write", ["--", "output", "--instrument", "psu"]],
      ["device-write", ["unknown", "--instrument", "psu"]],
    ];
    for (const [expected, args] of cases) expect(risk(args).risk, args.join(" ")).toBe(expected);
    expect(risk(["output", "--instrument", "psu"]).confirm).toBe("output");
    expect(risk(["output", "--instrument", "psu"]).timeout).toBe(3600);
    // The helper takes the operation only from the first argument and refuses anything else there.
    for (const args of [
      ["--", "output", "--instrument", "psu"],
      ["read", "output"],
      ["identify", "--instrument", "psu", "--set", "CH1.voltage=3"],
      ["read", "--instrument", "psu", "--hold", "5"],
    ]) {
      const run = scpi(args);
      expect(run.code, args.join(" ")).toBe(2);
      expect(run.json.status).toBe("error");
    }
    expect(transcript()).toEqual([]);
  });
});

describe("the helper against a fake PyVISA (offline evidence)", { timeout: 60_000 }, () => {
  it("identifies by profile and serial number and refuses a wrong model before any other command (L01-A)", async () => {
    const ok = scpi(["identify", "--instrument", "psu"]);
    expect(ok.code).toBe(0);
    expect(resultOf(ok)).toMatchObject({
      status: "pass",
      instrument: {
        alias: "psu",
        profile: { id: "rigol-dp800", verification: { status: "unverified" } },
        identity: {
          manufacturer: "RIGOL TECHNOLOGIES",
          model: "DP832",
          serial: "DP8C1",
          firmware: "00.01.16",
        },
      },
      lifecycle: { physical: "unchanged" },
    });
    for (const idn of [
      "RIGOL TECHNOLOGIES,DP711,DP7A1,00.01.02",
      "RIGOL TECHNOLOGIES,DP832,DP8C999,00.01.16",
    ]) {
      await setBench(bench({}, { psu: idn }));
      await clearLog();
      for (const args of [
        [
          "output",
          "--instrument",
          "psu",
          "--channel",
          "CH1",
          "--voltage",
          "3",
          "--current",
          "0.1",
          "--hold",
          "1",
        ],
        ["configure", "--instrument", "psu", "--set", "CH1.voltage=3"],
      ]) {
        const refused = scpi(args);
        expect(refused.code).toBe(2);
        expect(refused.json.status).toBe("blocked");
        expect(refused.json.problems[0].code).toBe("identity-mismatch");
      }
      expect(sent()).toEqual(["*IDN?", "*IDN?"]);
    }
    await setBench(bench({}, { psu: "ACME,PS-1,1,1.0" }));
    const unknown = scpi(["identify", "--instrument", "psu"]);
    expect(unknown.code).toBe(2);
    expect(resultOf(unknown).instrument).toMatchObject({
      identity: { model: "PS-1" },
      matchingProfile: null,
    });
  });

  it("refuses channels, values, holds and settings outside the profile and bench limits before opening (L01-C)", () => {
    const refused = [
      [
        "output",
        "--instrument",
        "psu",
        "--channel",
        "CH4",
        "--voltage",
        "3",
        "--current",
        "0.1",
        "--hold",
        "5",
      ],
      [
        "output",
        "--instrument",
        "psu",
        "--channel",
        "CH2",
        "--voltage",
        "31",
        "--current",
        "0.1",
        "--hold",
        "5",
      ],
      [
        "output",
        "--instrument",
        "psu",
        "--channel",
        "CH1",
        "--voltage",
        "6",
        "--current",
        "0.1",
        "--hold",
        "5",
      ],
      [
        "output",
        "--instrument",
        "psu",
        "--channel",
        "CH1",
        "--voltage",
        "3",
        "--current",
        "0.1",
        "--hold",
        "0",
      ],
      [
        "output",
        "--instrument",
        "psu",
        "--channel",
        "CH1",
        "--voltage",
        "3",
        "--current",
        "0.1",
        "--hold",
        "3501",
      ],
      [
        "output",
        "--instrument",
        "psu",
        "--channel",
        "CH1",
        "--voltage",
        "nan",
        "--current",
        "0.1",
        "--hold",
        "5",
      ],
      ["configure", "--instrument", "psu", "--set", "CH1.power=3"],
      ["configure", "--instrument", "dmm", "--set", "function=capacitance"],
      ["configure", "--instrument", "dmm", "--set", "function=voltage-dc", "--set", "range=20"],
      ["configure", "--instrument", "dmm", "--set", "range=0.5"],
      ["configure", "--instrument", "scope", "--set", "CHAN1.scale=1000"],
      [
        "output",
        "--instrument",
        "dmm",
        "--channel",
        "main",
        "--voltage",
        "1",
        "--current",
        "0.1",
        "--hold",
        "1",
      ],
      ["capture", "--instrument", "psu", "--channel", "CH1"],
      ["identify", "--instrument", "nobody"],
    ];
    for (const args of refused) {
      const run = scpi(args);
      expect(run.code, args.join(" ")).toBe(2);
      expect(run.json.status, args.join(" ")).toBe("error");
    }
    expect(transcript()).toEqual([]);
  });

  it("reads multimeter and power supply values with units and only measurement queries", () => {
    const volts = scpi(["read", "--instrument", "dmm"]);
    expect(resultOf(volts).values).toEqual([
      {
        quantity: "voltage-dc",
        function: "VOLT",
        channel: "main",
        value: 1.234567,
        unit: "V",
        raw: "+1.23456700E+00",
      },
    ]);
    expect(
      scpi(["configure", "--instrument", "dmm", "--set", "function=resistance", "--set", "range=10000"]).code,
    ).toBe(0);
    const ohms = scpi(["read", "--instrument", "dmm"]);
    expect(resultOf(ohms).values[0]).toMatchObject({ quantity: "resistance", value: 4701.2, unit: "Ohm" });
    const psu = scpi(["read", "--instrument", "psu", "--channel", "CH1"]);
    expect(resultOf(psu).values).toEqual([
      { quantity: "voltage", channel: "CH1", value: 0, unit: "V", raw: "0.000" },
      { quantity: "current", channel: "CH1", value: 0, unit: "A", raw: "0.0000" },
    ]);
    expect(resultOf(psu).commands).toEqual(["*IDN?", ":MEAS:VOLT? CH1", ":MEAS:CURR? CH1"]);
  });

  it("reports a multimeter overload as no value, never a number", async () => {
    await setBench(bench({ dmm: { overload: true } }));
    const run = scpi(["read", "--instrument", "dmm"]);
    expect(resultOf(run).values[0]).toMatchObject({ value: null, overload: true, raw: "+9.90000000E+37" });
  });

  it("captures a waveform with its preamble, keeps the raw block and decodes it again identically (L01-B, offline)", async () => {
    const run = scpi(["capture", "--instrument", "scope", "--channel", "CHAN1", "--run-id", "cap1"]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result.series[0]).toMatchObject({
      channel: "CHAN1",
      points: 1200,
      xIncrement: 1e-6,
      xOrigin: -6e-4,
      clipped: 2,
      unit: "V",
    });
    expect(result.conditions).toMatchObject({
      scale: 1,
      offset: 0,
      probe: 10,
      bandwidthLimit: "OFF",
      timebase: 1e-4,
      trigger: "STOP",
    });
    expect(result.commands.slice(-5)).toEqual([
      ":WAV:SOUR CHAN1",
      ":WAV:MODE NORM",
      ":WAV:FORM BYTE",
      ":WAV:PRE?",
      ":WAV:DATA?",
    ]);
    const csv = readFileSync(join(root, "embedded-lab-results", "cap1", "waveform-CHAN1.csv"), "utf8")
      .trim()
      .split("\n");
    expect(csv[0]).toBe("time_s,volts");
    // Raw 255 and 0 (clipped), then 127 + round(50 sin(2 pi i / 100)): v = (raw - 0 - 127) * 0.04, t = i * 1e-6 - 6e-4.
    expect(csv[1]).toBe("-0.0006,5.12");
    expect(csv[2]).toBe("-0.000599,-5.08");
    const i = 25;
    const raw = 127 + Math.round(50 * Math.sin((2 * Math.PI * i) / 100));
    const [time, volts] = (csv[i + 1] as string).split(",").map(Number);
    expect(time).toBeCloseTo(i * 1e-6 - 6e-4, 12);
    expect(volts).toBeCloseTo((raw - 127) * 0.04, 9);
    expect(csv).toHaveLength(1201);
    for (const index of [600, 1199]) {
      const sample = 127 + Math.round(50 * Math.sin((2 * Math.PI * index) / 100));
      const [t, v] = (csv[index + 1] as string).split(",").map(Number);
      expect(t).toBeCloseTo(index * 1e-6 - 6e-4, 12);
      expect(v).toBeCloseTo((sample - 127) * 0.04, 9);
    }
    for (const artifact of result.artifacts)
      expect(
        createHash("sha256")
          .update(readFileSync(join(root, artifact.path)))
          .digest("hex"),
      ).toBe(artifact.sha256);
    const decoded = scpi(["decode", "--capture", "embedded-lab-results/cap1", "--run-id", "dec1"]);
    expect(decoded.code).toBe(0);
    expect(readFileSync(join(root, "embedded-lab-results", "dec1", "waveform-CHAN1.csv"))).toEqual(
      readFileSync(join(root, "embedded-lab-results", "cap1", "waveform-CHAN1.csv")),
    );
  });

  it("decodes only the capture's own raw files and channel names, never a path a preamble names", async () => {
    expect(scpi(["capture", "--instrument", "scope", "--channel", "CHAN1", "--run-id", "cap2"]).code).toBe(0);
    const folder = join(root, "embedded-lab-results", "cap2");
    const record = JSON.parse(readFileSync(join(folder, "preamble-CHAN1.json"), "utf8"));
    const outside = join(tmpdir(), `vera-scpi-outside-${Date.now()}.bin`);
    await writeFile(outside, Buffer.alloc(1200, 1));
    try {
      const hostile = [
        { ...record, raw: { ...record.raw, file: outside } },
        { ...record, raw: { ...record.raw, file: "../../lab/resources.json" } },
        { ...record, channel: "x/../../../planted" },
      ];
      for (const [index, value] of hostile.entries()) {
        await writeFile(join(folder, "preamble-CHAN1.json"), JSON.stringify(value));
        const run = scpi(["decode", "--capture", "embedded-lab-results/cap2", "--run-id", `bad${index}`]);
        expect(run.code, JSON.stringify(value.raw ?? value.channel)).toBe(2);
        expect(run.json.status).toBe("error");
      }
      expect(existsSync(join(root, "planted.csv"))).toBe(false);
      // A raw file larger than the profile's points is refused, even with a matching hash.
      const bigger = Buffer.concat([readFileSync(join(folder, "raw-CHAN1.bin")), Buffer.from([1])]);
      await writeFile(join(folder, "raw-CHAN1.bin"), bigger);
      await writeFile(
        join(folder, "preamble-CHAN1.json"),
        JSON.stringify({
          ...record,
          raw: { ...record.raw, sha256: createHash("sha256").update(bigger).digest("hex") },
        }),
      );
      const big = scpi(["decode", "--capture", "embedded-lab-results/cap2", "--run-id", "big"]);
      expect(big.code).toBe(2);
      expect(big.json.problems[0].message).toMatch(/larger than 1200 bytes/);
      expect(existsSync(join(root, "embedded-lab-results", "planted.csv"))).toBe(false);
    } finally {
      await rm(outside, { force: true });
    }
  });

  it("refuses a registry that differs from the approved one before opening anything", () => {
    const run = scpi(["identify", "--instrument", "psu"], { VERA_REGISTRY_SHA256: "0".repeat(64) });
    expect(run.code).toBe(2);
    expect(run.json.problems[0]).toMatchObject({ code: "registry-changed" });
    expect(transcript()).toEqual([]);
    const sha = createHash("sha256").update(readFileSync(paths().registry)).digest("hex");
    expect(scpi(["identify", "--instrument", "psu"], { VERA_REGISTRY_SHA256: sha }).code).toBe(0);
  });

  it("parses blocks, sample widths and endianness and refuses truncated or malformed blocks", () => {
    const run = spawnSync(python, [join(fixtures, "internals.py"), join(pluginFolder, "scripts")], {
      encoding: "utf8",
    });
    const out = JSON.parse(run.stdout);
    expect(out.header).toBe(1200);
    expect(out.short).toBe(5);
    expect(out.truncated).toMatch(/cut short/);
    expect(out.indefinite).toMatch(/indefinite/);
    expect(out.noHash).toMatch(/not an IEEE 488.2 block/);
    expect(out.little).toEqual([-2, 0, 300]);
    expect(out.big).toEqual([-2, 0, 300]);
    expect(out.odd).toMatch(/whole number/);
    expect(out.series).toEqual([
      [-1e-6, 0],
      [0, 2],
      [1e-6, -2],
    ]);
  });

  it("gives truncated transfers, timeouts, absent instruments, missing drivers and lost connections distinct codes and closes every session (L01-F)", async () => {
    const cases: [
      Partial<Record<"psu" | "scope" | "dmm", Record<string, unknown>>>,
      string[],
      string,
      string,
      number,
    ][] = [
      [
        { scope: { truncate: true } },
        ["capture", "--instrument", "scope", "--channel", "CHAN1"],
        "incomplete",
        "truncated-transfer",
        3,
      ],
      [{ dmm: { timeoutOn: "READ?" } }, ["read", "--instrument", "dmm"], "incomplete", "visa-timeout", 3],
      [
        { scope: { oversize: true } },
        ["capture", "--instrument", "scope", "--channel", "CHAN1"],
        "incomplete",
        "limit",
        3,
      ],
      [{ psu: { absent: true } }, ["identify", "--instrument", "psu"], "blocked", "instrument-absent", 2],
      [{ psu: { driverMissing: true } }, ["identify", "--instrument", "psu"], "blocked", "driver-missing", 2],
      [{ dmm: { dropAfter: 1 } }, ["read", "--instrument", "dmm"], "incomplete", "connection-lost", 3],
    ];
    for (const [faults, args, status, code, exit] of cases) {
      await setBench(bench(faults));
      await rm(paths().state, { force: true });
      await clearLog();
      const run = scpi(args);
      expect(run.code, code).toBe(exit);
      expect(run.json.status, code).toBe(status);
      expect(
        run.json.problems.map((problem: { code: string }) => problem.code),
        code,
      ).toContain(code);
      const lines = transcript();
      const count = (prefix: string) => lines.filter((line) => line.startsWith(prefix)).length;
      expect(count("OPEN "), code).toBe(count("CLOSE "));
      expect(count("RM "), code).toBe(count("RMCLOSE"));
    }
    await setBench({ noBackend: true, resources: bench() });
    expect(scpi(["identify", "--instrument", "psu"]).json.problems[0].code).toBe("driver-missing");
    const noPyvisa = scpi(["identify", "--instrument", "psu"], { PYTHONPATH: join(root, "empty") });
    expect(noPyvisa.code).toBe(2);
    expect(noPyvisa.json.problems[0].code).toBe("driver-missing");
  });

  it("powers an output for the hold, measures it and confirms the off state by readback", () => {
    const run = scpi([
      "output",
      "--instrument",
      "psu",
      "--channel",
      "CH1",
      "--voltage",
      "3.3",
      "--current",
      "0.2",
      "--hold",
      "2",
    ]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result).toMatchObject({
      status: "pass",
      lifecycle: { physical: "confirmed" },
      hold: { seconds: 2, stopped: false },
    });
    // Measured at 0, 1 and 2 s: the output stays on for --hold seconds by the clock, not per loop step.
    expect(result.hold.samples).toBe(3);
    const started = Date.parse(result.started);
    expect(Date.parse(result.finished) - started).toBeLessThan(4000);
    const commands: string[] = result.commands;
    expect(commands.slice(0, 8)).toEqual([
      "*IDN?",
      ":OUTP? CH1",
      ":SOUR1:VOLT 3.3",
      ":SOUR1:CURR 0.2",
      ":SOUR1:VOLT?",
      ":SOUR1:CURR?",
      ":OUTP CH1,ON",
      ":OUTP? CH1",
    ]);
    expect(commands.slice(8, -2)).toEqual(Array(3).fill([":MEAS:VOLT? CH1", ":MEAS:CURR? CH1"]).flat());
    expect(commands.slice(-2)).toEqual([":OUTP CH1,OFF", ":OUTP? CH1"]);
    expect(fakeState()[PSU].channels["1"]).toMatchObject({ v: 3.3, on: false });
  });

  it("reports fail and an unknown state when the output does not read back off", async () => {
    await setBench(bench({ psu: { ignoreOff: true } }));
    const run = scpi([
      "output",
      "--instrument",
      "psu",
      "--channel",
      "CH1",
      "--voltage",
      "3.3",
      "--current",
      "0.2",
      "--hold",
      "1",
    ]);
    expect(run.code).toBe(1);
    expect(resultOf(run)).toMatchObject({ status: "fail", lifecycle: { physical: "unknown" } });
    expect(resultOf(run).problems.map((problem: { code: string }) => problem.code)).toContain(
      "readback-mismatch",
    );
  });

  it("switches off after reconnecting when the connection drops during the hold", async () => {
    await setBench(bench({ psu: { dropAfter: 10 } }));
    const run = scpi([
      "output",
      "--instrument",
      "psu",
      "--channel",
      "CH1",
      "--voltage",
      "3.3",
      "--current",
      "0.2",
      "--hold",
      "5",
    ]);
    expect(run.code).toBe(3);
    const result = resultOf(run);
    expect(result.problems.map((problem: { code: string }) => problem.code)).toEqual(
      expect.arrayContaining(["connection-lost", "reconnected"]),
    );
    expect(result.lifecycle.physical).toBe("confirmed");
    expect(fakeState()[PSU].channels["1"].on).toBe(false);
  });

  it("refuses set-points while the output is on", async () => {
    await writeFile(
      paths().state,
      JSON.stringify({
        [PSU]: {
          channels: {
            1: { v: 3, i: 0.1, on: true },
            2: { v: 0, i: 0.1, on: false },
            3: { v: 0, i: 0.1, on: false },
          },
        },
      }),
    );
    const run = scpi(["configure", "--instrument", "psu", "--set", "CH1.voltage=5"]);
    expect(run.code).toBe(2);
    expect(run.json.problems[0].code).toBe("output-on");
    expect(resultOf(run).commands).toEqual(["*IDN?", ":OUTP? CH1"]);
  });

  it("blocks configure and output while the physical state is unknown; close confirms it", () => {
    const unknown = JSON.stringify({
      psu: { state: "unknown", since: "2026-11-13T10:00:00Z", runId: "LOST", reason: "holder-lost" },
    });
    for (const args of [
      [
        "output",
        "--instrument",
        "psu",
        "--channel",
        "CH1",
        "--voltage",
        "3",
        "--current",
        "0.1",
        "--hold",
        "1",
      ],
      ["configure", "--instrument", "psu", "--set", "CH1.voltage=3"],
    ]) {
      const run = scpi(args, { VERA_RESOURCE_STATE: unknown });
      expect(run.code).toBe(2);
      expect(run.json.problems[0]).toMatchObject({ code: "state-unknown" });
    }
    expect(transcript()).toEqual([]);
    const close = scpi(["close", "--instrument", "psu"], { VERA_RESOURCE_STATE: unknown });
    expect(close.code).toBe(0);
    expect(resultOf(close).lifecycle.physical).toBe("confirmed");
    expect(scpi(["read", "--instrument", "psu"], { VERA_RESOURCE_STATE: unknown }).code).toBe(0);
  });

  it("discovers the registry and, on request, only local serial ports and USBTMC devices, never through VISA", async () => {
    const listed = scpi(["discover-configured"]);
    expect(listed.json.entries.map((entry: { alias: string }) => entry.alias)).toEqual([
      "psu",
      "scope",
      "dmm",
    ]);
    expect(transcript()).toEqual([]);
    await setBench({
      resources: bench(),
      local: {
        serial: ["COM3", "/dev/ttyUSB0"],
        usb: [
          { vid: 0x1ab1, pid: 0x0e11, serial: "DP8C1", class: 0xfe, subclass: 3 },
          { vid: 0x046d, pid: 0xc52b, serial: "MOUSE", class: 3, subclass: 1 },
        ],
      },
    });
    const local = scpi(["discover-configured", "--list-local"]);
    expect(transcript()).toEqual(["LOCAL serial", "LOCAL usb"]);
    expect(local.json.local).toEqual([
      "ASRL/dev/ttyUSB0::INSTR",
      "ASRL3::INSTR",
      "USB0::0x1AB1::0x0E11::DP8C1::INSTR",
    ]);
    await setBench({ resources: bench(), local: { serial: [], noLibusb: true } });
    const noLibusb = scpi(["discover-configured", "--list-local"]);
    expect(noLibusb.code).toBe(0);
    expect(noLibusb.json.problems[0]).toMatchObject({ code: "driver-missing" });
  });

  it("writes new run folders outside .vera and bounds what it prints", () => {
    expect(scpi(["identify", "--instrument", "psu", "--results-dir", ".vera/x"]).code).toBe(2);
    expect(scpi(["identify", "--instrument", "psu", "--run-id", "same"]).code).toBe(0);
    expect(scpi(["identify", "--instrument", "psu", "--run-id", "same"]).code).toBe(2);
    const big = scpi(["capture", "--instrument", "scope", "--channel", "CHAN1"]);
    expect(big.stdout.length).toBeLessThan(11_000);
    const result = resultOf(big);
    for (const artifact of result.artifacts) expect(existsSync(join(root, artifact.path))).toBe(true);
    expect(result).toMatchObject({
      format: 1,
      kind: "scpi-result",
      tool: { name: "scpi-instruments", version: "1.0.0" },
    });
  });
});

describe("VERA's runner supervising real helper processes", { timeout: 90_000 }, () => {
  let leaseRoot = "";
  let runner: core.ProgramRunner;
  let leases: core.ResourceLeases;
  beforeEach(async () => {
    leaseRoot = join(root, "leases");
    leases = new core.ResourceLeases({ root: leaseRoot, app: "test" });
    runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep }, leases });
  });
  afterEach(async () => {
    await runner.stopAll();
  });
  const env = () => {
    const e = environment();
    return Object.fromEntries(
      Object.entries(e).filter(
        ([name]) =>
          ["PYTHONPATH", "PYTHONDONTWRITEBYTECODE", "SCPI_REGISTRY"].includes(name) ||
          name.startsWith("FAKE_VISA"),
      ),
    ) as Record<string, string>;
  };
  const claim = {
    kind: "visa",
    alias: "psu",
    resource: PSU,
    keys: ["usb:1ab1:0e11:dp8c1", "serial-number:dp8c1"],
    actuates: true,
  };
  const output = (hold: number, graceMs = 8000) =>
    runner.start({
      sessionId: "s1",
      workbench: root,
      executable: python,
      args: [
        script,
        "output",
        "--instrument",
        "psu",
        "--channel",
        "CH1",
        "--voltage",
        "3.3",
        "--current",
        "0.2",
        "--hold",
        String(hold),
        "--run-id",
        `out-${Date.now()}`,
      ],
      env: env(),
      background: true,
      lease: {
        claims: [claim],
        graceMs,
        cleanup: {
          args: [script, "close", "--instrument", "psu"],
          shown: ["close", "--instrument", "psu"],
          timeoutMs: 30_000,
        },
      },
    });
  async function poweredOn() {
    for (let i = 0; i < 300; i++) {
      if (existsSync(paths().state) && fakeState()[PSU]?.channels?.["1"]?.on) return;
      await sleep(50);
    }
    throw Error("the output never switched on");
  }

  it("asks the helper to stop: it switches off itself and the physical state is confirmed (L01-E)", async () => {
    const run = await output(600);
    await poweredOn();
    const result = await run.stop();
    expect(result).toMatchObject({ stopped: true, physical: "confirmed", cleanup: "none" });
    expect(fakeState()[PSU].channels["1"].on).toBe(false);
    expect(result.output).toContain('"stopped"');
    expect((await readdir(leaseRoot)).filter((name) => name.endsWith(".lease"))).toEqual([]);
  });

  it("kills a helper stuck in a VISA call after the grace period and runs the authorized cleanup", async () => {
    await setBench(bench({ psu: { hangOn: ":MEAS:VOLT?" } }));
    const run = await output(600, 1500);
    await poweredOn();
    const result = await run.stop();
    expect(result).toMatchObject({ stopped: true, physical: "confirmed", cleanup: "separate" });
    expect(fakeState()[PSU].channels["1"].on).toBe(false);
    const log = await readFile(join(root, result.log), "utf8");
    expect(log).toContain("[VERA] Cleanup: close --instrument psu");
    expect(log).toContain("[VERA] Physical state: confirmed");
  });

  it("cleans up after a helper crash with the output on", async () => {
    await setBench(bench({ psu: { exitOn: ":OUTP CH1,ON" } }));
    const run = await output(600);
    const result = await run.done;
    expect(result).toMatchObject({ exitCode: 9, physical: "confirmed", cleanup: "separate" });
    expect(fakeState()[PSU].channels["1"].on).toBe(false);
  });

  it("records an unknown state when cleanup cannot confirm, then blocks output until close confirms", async () => {
    await setBench(bench({ psu: { exitOn: ":OUTP CH1,ON", ignoreOff: true } }));
    const result = await (await output(600)).done;
    expect(result).toMatchObject({ physical: "unknown", cleanup: "failed" });
    await setBench(bench());
    const blocked = await (await output(1)).done;
    expect(blocked.exitCode).toBe(2);
    expect(blocked.output).toContain("state-unknown");
    const close = await runner.run({
      sessionId: "s1",
      workbench: root,
      executable: python,
      args: [script, "close", "--instrument", "psu"],
      env: env(),
      lease: { claims: [claim], graceMs: 5000 },
    });
    expect(close).toMatchObject({ exitCode: 0, physical: "confirmed" });
    const after = await (await output(1)).done;
    expect(after).toMatchObject({ exitCode: 0, physical: "confirmed" });
  });

  it("refuses a resource another VERA process holds and recovers it when that process is gone (L01-D)", async () => {
    const holder: ChildProcess = spawn(
      process.execPath,
      [join(fixtures, "hold-lease.mjs"), leaseRoot, "serial-number:dp8c1", "psu", "true"],
      { cwd: software, stdio: ["ignore", "pipe", "inherit"] },
    );
    try {
      await new Promise<void>((done, fail) => {
        holder.stdout?.on("data", (chunk) => String(chunk).includes("held") && done());
        holder.on("exit", (code) => fail(Error(`holder exited ${code}`)));
      });
      await expect(output(1)).rejects.toMatchObject({
        code: "BUSY",
        params: { resource: "psu", holder: `process ${holder.pid}` },
      });
      expect(transcript()).toEqual([]);
    } finally {
      holder.kill();
    }
    await new Promise((done) => holder.once("exit", done));
    // The lost holder could actuate: its lease is stale and the state unknown, so output is blocked before any I/O.
    const run = await (await output(1)).done;
    expect(run.exitCode).toBe(2);
    expect(run.output).toContain('"code": "state-unknown"');
    expect(run.output).toContain("OTHERPROCESSRUN");
  });
});

// Opt-in: the real PyVISA and pyvisa-py from PyPI (VERA_SCPI_UV = a real uv), through a real TCPIP SOCKET connection
// to a local SCPI server. This proves the library path, not any instrument.
describe.skipIf(!process.env.VERA_SCPI_UV)(
  "real PyVISA over TCPIP SOCKET (opt-in)",
  { timeout: 900_000 },
  () => {
    let server: Server;
    let port = 0;
    const state = { on: false, v: 0, i: 0.1 };
    beforeAll(async () => {
      server = createServer((socket) => {
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk.toString("latin1");
          let index = buffer.indexOf("\n");
          while (index >= 0) {
            const command = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            const reply = (() => {
              if (command === "*IDN?") return "RIGOL TECHNOLOGIES,DP832,DP8C1,00.01.16";
              if (command === ":OUTP? CH1") return state.on ? "ON" : "OFF";
              if (command === ":SOUR1:VOLT?") return state.v.toFixed(3);
              if (command === ":SOUR1:CURR?") return state.i.toFixed(4);
              if (command === ":MEAS:VOLT? CH1") return (state.on ? state.v : 0).toFixed(3);
              if (command === ":MEAS:CURR? CH1") return (state.on ? 0.01 : 0).toFixed(4);
              const set = /^:SOUR1:(VOLT|CURR) (\S+)$/.exec(command);
              if (set) state[set[1] === "VOLT" ? "v" : "i"] = Number(set[2]);
              const out = /^:OUTP CH1,(ON|OFF)$/.exec(command);
              if (out) state.on = out[1] === "ON";
              return undefined;
            })();
            if (reply !== undefined) socket.write(`${reply}\n`);
            index = buffer.indexOf("\n");
          }
        });
      });
      await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
      port = (server.address() as { port: number }).port;
    });
    afterAll(() => new Promise<void>((done) => server.close(() => done())));

    it("installs the pinned packages through VERA's provisioner and powers a simulated output over pyvisa-py", async () => {
      const data = join(root, "data");
      const store = new core.PluginStore({ root: join(data, "plugins") });
      await store.install(pluginFolder);
      const host = new core.NodeProcessHost(spawn);
      // VERA_SCPI_PYTHON_SEED: a uv python folder whose cpython-3.13.* install is copied in, so only PyPI is reached.
      const seed = process.env.VERA_SCPI_PYTHON_SEED;
      if (seed)
        for (const name of await readdir(seed))
          if (/^cpython-3\.13\.\d+-/.test(name))
            await cp(join(seed, name), join(data, "plugins", "runtime", "python", name), { recursive: true });
      const provisioner = new core.Provisioner({
        store,
        root: join(data, "plugins", "runtime"),
        uv: { executable: process.env.VERA_SCPI_UV as string, prefix: [] },
        host,
        clock: { sleep },
        platform: core.pluginPlatform(process.platform, process.arch),
        fetch: (url, init) => fetch(url, init.signal ? { signal: init.signal } : {}),
        settings: () => undefined,
      });
      const statuses = await provisioner.install("scpi-instruments");
      expect(statuses[0]?.state).toBe("ready");
      const plugin = await store.load("scpi-instruments");
      const resolved = await provisioner.resolve(plugin, "scpi");
      if (!resolved) throw Error("scpi did not resolve");
      await writeFile(
        paths().registry,
        JSON.stringify({
          format: 1,
          resources: [
            {
              alias: "psu",
              kind: "visa",
              resource: `TCPIP0::127.0.0.1::${port}::SOCKET`,
              profile: "rigol-dp800",
            },
          ],
        }),
      );
      const runner = new core.ProgramRunner({
        host,
        clock: { sleep },
        leases: new core.ResourceLeases({ root: join(root, "leases"), app: "test" }),
      });
      const result = await runner.run({
        sessionId: "s1",
        workbench: root,
        executable: resolved.executable,
        args: [
          ...(resolved.prefix ?? []),
          "output",
          "--instrument",
          "psu",
          "--channel",
          "CH1",
          "--voltage",
          "3.3",
          "--current",
          "0.2",
          "--hold",
          "2",
        ],
        env: { ...resolved.env, SCPI_REGISTRY: paths().registry },
        lease: {
          claims: [
            { kind: "visa", alias: "psu", resource: "socket", keys: [`tcpip:127.0.0.1`], actuates: true },
          ],
          graceMs: 10_000,
        },
      });
      expect(result).toMatchObject({ exitCode: 0, physical: "confirmed" });
      expect(result.output).toMatch(/"pyvisa": "1\.16\.2"/);
      expect(result.output).toMatch(/"pyvisaPy": "0\.8\.1"/);
      expect(state.on).toBe(false);

      // A simulated DS1104Z on a second socket: its block holds byte 10 (the line ending) in the data, so a reader
      // that stops at the termination character would truncate it.
      const raw = Buffer.from(Array.from({ length: 1200 }, (_, i) => (i % 100 === 7 ? 10 : 100 + (i % 50))));
      const scope = createServer((socket) => {
        let buffer = "";
        socket.on("data", (chunk) => {
          buffer += chunk.toString("latin1");
          let index = buffer.indexOf("\n");
          while (index >= 0) {
            const command = buffer.slice(0, index).trim();
            buffer = buffer.slice(index + 1);
            const replies: Record<string, string> = {
              "*IDN?": "RIGOL TECHNOLOGIES,DS1104Z,DS1ZA1,00.04.04.SP4",
              ":CHAN1:DISP?": "1",
              ":CHAN1:SCAL?": "5.000000e-01",
              ":CHAN1:OFFS?": "0.000000e+00",
              ":CHAN1:PROB?": "1.000000e+01",
              ":CHAN1:BWL?": "OFF",
              ":TIM:MAIN:SCAL?": "1.000000e-04",
              ":TRIG:STAT?": "STOP",
              ":WAV:PRE?": "0,0,1200,1,1.000000e-06,-6.000000e-04,0,2.000000e-02,0,127",
            };
            if (command === ":WAV:DATA?")
              socket.write(Buffer.concat([Buffer.from("#9000001200"), raw, Buffer.from("\n")]));
            else if (replies[command] !== undefined) socket.write(`${replies[command]}\n`);
            index = buffer.indexOf("\n");
          }
        });
      });
      await new Promise<void>((done) => scope.listen(0, "127.0.0.1", done));
      try {
        const scopePort = (scope.address() as { port: number }).port;
        await writeFile(
          paths().registry,
          JSON.stringify({
            format: 1,
            resources: [
              {
                alias: "psu",
                kind: "visa",
                resource: `TCPIP0::127.0.0.1::${port}::SOCKET`,
                profile: "rigol-dp800",
              },
              {
                alias: "scope",
                kind: "visa",
                resource: `TCPIP0::localhost::${scopePort}::SOCKET`,
                profile: "rigol-ds1000z",
              },
            ],
          }),
        );
        const run = (args: string[], keys: string[], actuates = false) =>
          runner.run({
            sessionId: "s1",
            workbench: root,
            executable: resolved.executable,
            args: [...(resolved.prefix ?? []), ...args],
            env: { ...resolved.env, SCPI_REGISTRY: paths().registry },
            lease: {
              claims: [{ kind: "visa", alias: args[2] as string, resource: "socket", keys, actuates }],
              graceMs: 10_000,
            },
          });
        expect(await run(["identify", "--instrument", "scope"], ["tcpip:localhost"])).toMatchObject({
          exitCode: 0,
        });
        const read = await run(["read", "--instrument", "psu", "--channel", "CH1"], ["tcpip:127.0.0.1"]);
        expect(read.exitCode).toBe(0);
        const capture = await run(
          ["capture", "--instrument", "scope", "--channel", "CHAN1", "--run-id", "real-capture"],
          ["tcpip:localhost"],
        );
        expect(capture.exitCode, capture.output).toBe(0);
        const csv = readFileSync(
          join(root, "embedded-lab-results", "real-capture", "waveform-CHAN1.csv"),
          "utf8",
        )
          .trim()
          .split("\n");
        expect(csv).toHaveLength(1201);
        expect(readFileSync(join(root, "embedded-lab-results", "real-capture", "raw-CHAN1.bin"))).toEqual(
          raw,
        );
        const [time, volts] = (csv[8] as string).split(",").map(Number);
        expect(time).toBeCloseTo(7e-6 - 6e-4, 12);
        expect(volts).toBeCloseTo((10 - 127) * 0.02, 9);
      } finally {
        await new Promise<void>((done) => scope.close(() => done()));
      }
    });
  },
);
