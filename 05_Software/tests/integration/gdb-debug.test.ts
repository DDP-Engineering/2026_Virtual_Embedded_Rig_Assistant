// The gdb-debug plugin without GDB, OpenOCD, a probe or a board (LAB-04). Default tests check the package and its
// rules, run gdb-elf on committed fixture ELFs built with zig cc (tests/fixtures/gdb-debug/firmware/build.py), run the
// Python unit checks (internals.py) and run gdb-debug against executable stand-ins for GDB and OpenOCD
// (fake_gdb.py, fake_openocd.py): offline evidence of the helper's protocol handling and lifecycle, never of a real
// GDB, OpenOCD or target. One case runs the helper under VERA's real runner and stops it. VERA_GDB_ORACLE_PYTHON names a
// Python with pyelftools 0.32: the opt-in test checks gdb-elf's facts against that independent reader.
// VERA_GDB_REAL_GDB names a real arm-none-eabi-gdb (12 or newer): the opt-in tests run gdb-debug with it against the
// OpenOCD stand-in's remote-protocol target (real GDB/MI output, still no OpenOCD, probe or board). VERA_GDB_REAL_OPENOCD
// names a real OpenOCD (0.12.0 or newer): the opt-in test starts it with a probe serial no probe has, so it parses every
// configuration command and then finds no adapter; it never opens a board.
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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = fileURLToPath(new URL("../../", import.meta.url));
const plugins = join(software, "plugins");
const pluginFolder = join(plugins, "gdb-debug");
const scripts = join(pluginFolder, "scripts");
const elfScript = join(scripts, "gdb_elf.py");
const debugScript = join(scripts, "gdb_debug.py");
const fixtures = fileURLToPath(new URL("../fixtures/gdb-debug/", import.meta.url));
const firmware = join(fixtures, "firmware");
const windows = process.platform === "win32";
const python = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const PROBE = "0483:374b:066DFF485153826687243634";
const OUTPUT_LIMIT = 11_000;
const COMMANDS = new Set([
  "-gdb-set",
  "-file-exec-and-symbols",
  "-interpreter-exec",
  "-target-select",
  "-data-read-memory-bytes",
  "-data-list-register-names",
  "-data-list-register-values",
  "-stack-info-depth",
  "-stack-list-frames",
  "-stack-list-variables",
  "-data-evaluate-expression",
  "-break-insert",
  "-break-delete",
  "-exec-continue",
  "-exec-interrupt",
  "-exec-step",
  "-exec-step-instruction",
  "-target-detach",
  "-gdb-exit",
]);
const CONSOLE =
  /^(?:mem 0x[0-9a-f]{8} 0x[0-9a-f]{8} (?:ro|rw)|set mem inaccessible-by-default on|whatis [A-Za-z_][\w.[\]]*)$/;

// biome-ignore lint/suspicious/noExplicitAny: the helpers' JSON documents, checked field by field.
type Json = Record<string, any>;
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
  stderr: string;
}

let tools: { gdb: string; openocd: string };
let toolFolder = "";
let root = "";
beforeAll(async () => {
  toolFolder = await realpath(await mkdtemp(join(tmpdir(), "vera-gdb-tools-")));
  const made = spawnSync(python, [join(fixtures, "make_tools.py"), toolFolder], { encoding: "utf8" });
  expect(made.status, made.stderr).toBe(0);
  const parsed = JSON.parse(made.stdout);
  tools = { gdb: parsed["arm-none-eabi-gdb"], openocd: parsed.openocd };
});
afterAll(async () => {
  await rm(toolFolder, { recursive: true, force: true });
});

const fault = {
  cpuid: "0x410fc241",
  // CPUID, then CFSR = DIVBYZERO at 0x28 and HFSR = FORCED at 0x2c.
  scb: `41c20f41${"00".repeat(36)}0000000200000040${"00".repeat(16)}`,
  registers: {
    r0: "0x1",
    r1: "0x0",
    sp: "0x20017fb8",
    lr: "0xfffffff9",
    pc: "0x08000114",
    xpsr: "0x01000003",
    msp: "0x20017fb8",
    psp: "0x0",
  },
  ram: [
    // The stacked frame: r0..r3, r12, lr = sample+8, pc = compute_ratio+6, xpsr.
    { addr: "0x20017fb8", hex: `01000000${"00".repeat(16)}350100081e01000800000001` },
    { addr: "0x20000004", hex: "07000000" },
  ],
  frames: [
    { level: "0", addr: "0x08000114", func: "HardFault_Handler", file: "startup.c", line: "22" },
    { level: "1", addr: "0xfffffff9", func: "<signal handler called>" },
    { level: "2", addr: "0x0800011e", func: "compute_ratio", file: "fault.c", line: "23" },
    { level: "3", addr: "0x08000134", func: "sample", file: "fault.c", line: "26" },
  ],
  variables: [
    { name: "value", arg: "1", type: "int32_t", value: "1" },
    { name: "scaled", type: "int32_t", value: "<optimized out>" },
  ],
  symbols: {
    counter: { addr: "0x20000004", size: 4, type: "volatile uint32_t" },
    big_table: { addr: "0x2000001c", size: 640, type: "uint32_t [160]" },
    gpio_odr: { addr: "0x40020014", size: 4, type: "volatile uint32_t" },
  },
};

const paths = () => ({
  registry: join(root, "lab", "resources.json"),
  scenario: join(root, "scenario.json"),
  ocdScenario: join(root, "openocd-scenario.json"),
  gdbLog: join(root, "gdb.log"),
  ocdLog: join(root, "openocd.log"),
});
async function scenario(fields: Json = {}, openocd: Json = {}) {
  await writeFile(
    paths().scenario,
    JSON.stringify({ flash: join(root, "build", "app.elf"), ...fault, ...fields }),
  );
  await writeFile(paths().ocdScenario, JSON.stringify(openocd));
}
function environment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { VERA_RUN_CONTROL: _a, VERA_REGISTRY_SHA256: _b, ...rest } = process.env;
  return { ...rest, PYTHONDONTWRITEBYTECODE: "1", ...ownEnv(), ...extra };
}
const ownEnv = (): Record<string, string> => ({
  GDB_DEBUG_REGISTRY: paths().registry,
  VERA_PROGRAM_ARM_NONE_EABI_GDB: tools.gdb,
  VERA_PROGRAM_OPENOCD: tools.openocd,
  FAKE_GDB_SCENARIO: paths().scenario,
  FAKE_GDB_LOG: paths().gdbLog,
  FAKE_GDB_PLUGIN: scripts,
  FAKE_OPENOCD_SCENARIO: paths().ocdScenario,
  FAKE_OPENOCD_LOG: paths().ocdLog,
});
function helper(script: string, args: string[], extra: Record<string, string> = {}): Run {
  const result = spawnSync(python, [script, ...args], {
    cwd: root,
    env: environment(extra),
    encoding: "utf8",
    timeout: 120_000,
  });
  const stdout = result.stdout ?? "";
  // No input may end in a traceback or in a document the runner would cut.
  expect([0, 2, 3], `exit ${result.status}: ${(result.stderr ?? "").slice(-2000)}`).toContain(result.status);
  expect(stdout.length).toBeLessThanOrEqual(OUTPUT_LIMIT);
  let json: Json = {};
  try {
    json = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
  } catch {
    json = { unparsed: stdout };
  }
  return { code: result.status, json, stdout, stderr: result.stderr ?? "" };
}
const elfTool = (args: string[]) => helper(elfScript, args);
const debug = (args: string[], extra: Record<string, string> = {}) => helper(debugScript, args, extra);
const live = (operation: string, more: string[] = [], onExit = "halted") =>
  debug([
    operation,
    "--probe",
    "stlink1",
    "--elf",
    "build/app.elf",
    "--firmware-effect",
    "none",
    "--on-exit",
    onExit,
    ...more,
  ]);
const lines = (file: string): Json[] =>
  existsSync(file)
    ? readFileSync(file, "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const gdbEntries = () => lines(paths().gdbLog);
/** The stand-ins' start records of real sessions (not the `--version` probes). */
const gdbSession = () => gdbEntries().find((entry) => entry.argv?.includes("--interpreter=mi3"));
const ocdSession = () => lines(paths().ocdLog).find((entry) => entry.argv.includes("-f"));
const gdbCommands = () => gdbEntries().filter((entry) => entry.cmd);
const sent = (command: string) => gdbCommands().filter((entry) => entry.cmd === command);
const resultOf = (run: Run): Json => JSON.parse(readFileSync(join(root, run.json.result), "utf8"));
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
/** The stand-ins' own Python processes are gone once the helper has exited. */
function expectNoToolLeft() {
  const pids = [...gdbEntries(), ...lines(paths().ocdLog)]
    .filter((entry) => entry.pid)
    .map((entry) => entry.pid);
  for (const pid of pids) expect(alive(pid), `process ${pid}`).toBe(false);
}
/** Every command the helper sent belongs to its fixed set; console commands only to their fixed forms. */
function expectFixedCommands() {
  for (const entry of gdbCommands()) {
    expect(COMMANDS.has(entry.cmd), entry.cmd).toBe(true);
    if (entry.cmd === "-interpreter-exec")
      expect(JSON.parse(entry.args.slice("console ".length))).toMatch(CONSOLE);
  }
  expect(gdbEntries().filter((entry) => entry.raw)).toEqual([]);
}

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-gdb-")));
  await mkdir(join(root, "lab"));
  await mkdir(join(root, "build"));
  await mkdir(join(root, ".vera"));
  await copyFile(join(firmware, "fault-m4.elf"), join(root, "build", "app.elf"));
  await writeFile(
    paths().registry,
    JSON.stringify({
      format: 1,
      resources: [
        { alias: "stlink1", kind: "probe", resource: PROBE, profile: "stm32f4-stlink" },
        { alias: "jlink", kind: "probe", resource: "1366:0105:000123456789", profile: "stm32f4-stlink" },
        {
          alias: "psu",
          kind: "visa",
          resource: "USB0::0x1AB1::0x0E11::DP8C1::INSTR",
          profile: "rigol-dp800",
        },
      ],
    }),
  );
  await scenario();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("package", () => {
  it("publishes the official gdb-debug package, its pack group, metadata, skill and two unverified profiles", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({
      id: "gdb-debug",
      version: "1.0.0",
      ecosystem: "lab",
      platforms: ["windows-x64", "linux-x64"],
    });
    expect(m.programs["gdb-debug"]).toMatchObject({
      install: { script: "scripts/gdb_debug.py" },
      uses: ["arm-none-eabi-gdb", "openocd"],
      // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest placeholder, compared literally.
      env: { GDB_DEBUG_REGISTRY: "${workbench}/lab/resources.json" },
      resources: { option: "--probe", kinds: ["probe"], grace: 30, cleanup: ["release"], cleanupTimeout: 30 },
    });
    expect(m.programs["gdb-elf"]).toMatchObject({ install: { script: "scripts/gdb_elf.py" } });
    expect(m.programs["gdb-elf"]?.uses).toBeUndefined();
    for (const name of ["arm-none-eabi-gdb", "openocd"]) {
      const program = m.programs[name];
      expect(program && "find" in program.install && !("download" in program.install), name).toBe(true);
    }
    expect(readFileSync(elfScript, "utf8")).toContain("dependencies = []");
    expect(readFileSync(debugScript, "utf8")).toContain("dependencies = []");
    const catalog = parse(readFileSync(join(plugins, "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("gdb-debug");
    expect(catalog.metadata["gdb-debug"].activities).toEqual(["debug", "firmware-analysis"]);
    const packs = parse(readFileSync(join(plugins, "packs.yaml"), "utf8"));
    const lab = packs.find((pack: { id: string }) => pack.id === "lab");
    expect(lab.groups).toContainEqual({
      name: "Debugging (GDB and OpenOCD)",
      plugins: ["gdb-debug"],
      default: true,
    });
    expect(await core.checkCatalogSource(plugins)).toEqual([]);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(pluginFolder);
    const installed = await store.load("gdb-debug");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const names = (await skills.list())
      .filter((skill) => skill.plugin === "gdb-debug")
      .map((skill) => skill.name);
    expect(names).toEqual(["debug-sessions"]);
    const usage = (await skills.read("plugin", "debug-sessions")).content;
    for (const text of [
      "gdb-elf inspect",
      "--firmware-effect",
      "--on-exit",
      "mismatched",
      "lab/resources.json",
    ])
      expect(usage).toContain(text);
  });

  it("keeps the shared path module byte-identical with the other lab plugins", async () => {
    const copies = await Promise.all(
      [
        "gdb-debug/scripts/gdb_support",
        "lab-validation/scripts/lab_validation",
        "scpi-instruments/scripts/scpi_support",
      ].map((folder) => readFile(join(plugins, folder, "workspace.py"))),
    );
    expect(new Set(copies.map(sha256)).size).toBe(1);
  });
});

describe("risk of each operation (REQ-SEC-00f3d2b9, REQ-SEC-ad412ce8)", () => {
  it("rates offline work safe, execution control device-write, actuating firmware irreversible, the tools blocked", () => {
    const rules = manifest().rules;
    const live = ["--probe", "stlink1", "--elf", "app.elf", "--on-exit", "halted"];
    const cases: [string, string, string[]][] = [
      ["safe", "gdb-elf", ["inspect", "build/app.elf"]],
      ["safe", "gdb-elf", ["diagnose", "embedded-lab-results/x"]],
      ["safe", "gdb-debug", ["tools"]],
      ["safe", "gdb-debug", ["release", "--probe", "stlink1"]],
      ["device-write", "gdb-debug", ["snapshot", ...live, "--firmware-effect", "none"]],
      [
        "device-write",
        "gdb-debug",
        ["break", ...live, "--firmware-effect", "none", "--at", "main", "--timeout", "5"],
      ],
      ["device-write", "gdb-debug", ["step", ...live, "--firmware-effect", "none", "--count", "2"]],
      ["irreversible", "gdb-debug", ["snapshot", ...live, "--firmware-effect", "actuates"]],
      ["irreversible", "gdb-debug", ["step", "--firmware-effect=actuates", ...live, "--count", "1"]],
      [
        "irreversible",
        "gdb-debug",
        ["break", ...live, "--firmware_effect", "actuates", "--at", "f", "--timeout", "1"],
      ],
      ["device-write", "gdb-debug", ["unknown-operation"]],
      ["blocked", "arm-none-eabi-gdb", ["--batch", "-ex", "monitor reset"]],
      ["blocked", "arm-none-eabi-gdb", ["--version"]],
      ["blocked", "openocd", ["-f", "board/st_nucleo_f4.cfg"]],
    ];
    for (const [expected, program, args] of cases)
      expect(classifyCommand(rules, program, args).risk, `${program} ${args.join(" ")}`).toBe(expected);
    expect(classifyCommand(rules, "gdb-debug", ["break", ...live, "--at", "f"]).timeout).toBe(3600);
    // The probe-rs plugin keeps its interactive and server commands blocked: LAB-04 adds no generic unblocking.
    const probeRs: PluginManifest = parse(readFileSync(join(plugins, "probe-rs", "plugin.yaml"), "utf8"));
    for (const command of ["gdb", "debug", "dap-server", "serve"])
      expect(
        classifyCommand(probeRs.rules, "probe-rs", [command, "--chip", "STM32F401RE"]).risk,
        command,
      ).toBe("blocked");
  });

  it("refuses a live operation without --firmware-effect or --on-exit before anything starts", () => {
    for (const args of [
      ["snapshot", "--probe", "stlink1", "--elf", "build/app.elf", "--on-exit", "halted"],
      ["snapshot", "--probe", "stlink1", "--elf", "build/app.elf", "--firmware-effect", "none"],
      [
        "snapshot",
        "--probe",
        "stlink1",
        "--elf",
        "build/app.elf",
        "--firmware-effect",
        "maybe",
        "--on-exit",
        "halted",
      ],
      ["snapshot", "--probe", "stlink1", "--elf", "build/app.elf", "--firm", "none", "--on-exit", "halted"],
    ]) {
      const run = debug(args);
      expect(run.code, args.join(" ")).toBe(2);
      expect(run.json.status).toBe("refused");
    }
    expect(gdbEntries()).toEqual([]);
    expect(lines(paths().ocdLog)).toEqual([]);
  });
});

describe("gdb-elf offline inspection (L04-A, REQ-FUNC-0c6807c8)", () => {
  it("identifies architecture, hash, symbols and debug information of real compiler output", () => {
    const run = elfTool(["inspect", "build/app.elf"]);
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({
      kind: "elf-inspection",
      file: { path: "build/app.elf", sha256: sha256(readFileSync(join(firmware, "fault-m4.elf"))) },
      elf: {
        class: 32,
        endian: "little",
        type: "EXEC",
        machine: "arm",
        machineCode: 40,
        entry: "0x08000085",
        float: "hard",
      },
      arm: { cpuName: "cortex-m4", arch: "v7E-M", profile: "M" },
      symbols: { functions: 6, objects: 6 },
      debug: { present: true, dwarfVersions: [4], units: 2, languages: ["C11"], optimization: "unknown" },
    });
    expect(run.json.buildId).toMatch(/^[0-9a-f]{40}$/);
    expect(run.json.debug.producers[0]).toContain("clang version 18.1.6");
    expect(run.json.limits.join(" ")).toContain("-grecord-command-line");
    expect(run.json.segments.filter((s: Json) => s.type === "LOAD").map((s: Json) => s.vaddr)).toEqual([
      "0x08000000",
      "0x08000084",
      "0x20000000",
    ]);
  });

  it("reports an ELF without debug information and a RISC-V image as they are", async () => {
    await copyFile(join(firmware, "fault-m0.elf"), join(root, "build", "m0.elf"));
    await copyFile(join(firmware, "riscv.elf"), join(root, "build", "rv.elf"));
    const m0 = elfTool(["inspect", "build/m0.elf"]);
    expect(m0.json).toMatchObject({
      arm: { cpuName: "cortex-m0plus", arch: "v6S-M", profile: "M" },
      elf: { float: "soft" },
    });
    expect(m0.json.debug).toMatchObject({ present: false, units: 0 });
    expect(m0.json.limits.join(" ")).toContain("no DWARF debug information");
    const rv = elfTool(["inspect", "build/rv.elf"]);
    expect(rv.json.elf).toMatchObject({ machine: "riscv", machineCode: 243, float: "n/a" });
    expect(rv.json.arm).toBeUndefined();
    expect(rv.json.debug.present).toBe(true);
  });

  it("refuses paths outside the workbench, folders, truncated ELFs and other files with exit 2 (REQ-SEC-e1493c9b)", async () => {
    const elf = readFileSync(join(firmware, "fault-m4.elf"));
    await writeFile(join(root, "build", "cut.elf"), elf.subarray(0, 300));
    await writeFile(join(root, "build", "notes.txt"), "not an ELF\n");
    for (const target of [
      "../outside.elf",
      join(firmware, "fault-m4.elf"),
      "build",
      "build/cut.elf",
      "build/notes.txt",
      "build/none.elf",
    ]) {
      const run = elfTool(["inspect", target]);
      expect(run.code, target).toBe(2);
      expect(run.json.status).toBe("refused");
    }
  });
});

describe("gdb_support internals (MI parser, session tokens, faults, validation, profiles)", () => {
  it("passes every unit check of internals.py", async () => {
    const scratch = join(root, "internals");
    await mkdir(scratch);
    const run = spawnSync(python, [join(fixtures, "internals.py"), scripts, tools.gdb, scratch, firmware], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
      timeout: 60_000,
    });
    expect(run.status, run.stderr).toBe(0);
    const out = JSON.parse(run.stdout);
    expect(out).toMatchObject({ mi: "ok", validate: "ok", faults: "ok", elf: "ok", profileRefusals: 9 });
    expect(out.profiles).toEqual([
      ["stm32f4-stlink", "unverified", "cortex-m4", "v7m"],
      ["stm32g0-stlink", "unverified", "cortex-m0+", "v6m"],
    ]);
  });
});

describe("gdb-debug sessions against the GDB and OpenOCD stand-ins (offline evidence)", {
  timeout: 120_000,
}, () => {
  it("snapshots a HardFault with decoded causes, symbols, variables and a confirmed exit (REQ-FUNC-9ab9965c)", () => {
    const run = live("snapshot", ["--read", "counter", "--frames", "3"]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result).toMatchObject({
      kind: "gdb-debug-result",
      operation: "snapshot",
      status: "pass",
      firmwareEffect: "none",
      onExit: "halted",
      probe: { alias: "stlink1", resource: PROBE, profile: "stm32f4-stlink", profileStatus: "unverified" },
      tools: { gdb: { version: "15.2", target: "arm-none-eabi" }, openocd: { version: "0.12.0" } },
      elf: { path: "build/app.elf", match: "matched", arch: "v7E-M", debug: true },
      target: { core: "cortex-m4", partno: "0xc24", state: "halted", after: "halted" },
      lifecycle: { phases: ["start", "identified", "acting", "cleaning", "released"], physical: "confirmed" },
    });
    expect(result.elf.sections.map((s: Json) => [s.name, s.status])).toEqual([
      [".isr_vector", "matched"],
      [".note.gnu.build-id", "matched"],
      [".text", "matched"],
    ]);
    const { snapshot } = result;
    expect(snapshot.fault.exception).toEqual({ number: 3, name: "HardFault" });
    expect(snapshot.fault.causes.map((c: Json) => c.name)).toEqual(["DIVBYZERO", "FORCED"]);
    expect(snapshot.fault).toMatchObject({ stack: "msp", cfsr: "0x02000000", hfsr: "0x40000000" });
    expect(snapshot.fault.sites).toContainEqual({
      role: "stacked-pc",
      addr: "0x0800011e",
      symbol: "compute_ratio",
      offset: 6,
    });
    expect(snapshot.fault.sites).toContainEqual({
      role: "stacked-lr",
      addr: "0x08000135",
      symbol: "sample",
      offset: 8,
    });
    expect(snapshot.frames).toHaveLength(3);
    expect(snapshot.depthTruncated).toBe(true);
    expect(snapshot.frames[2]).toEqual({
      level: 2,
      addr: "0x0800011e",
      func: "compute_ratio",
      file: "fault.c",
      line: "23",
    });
    expect(snapshot.reads).toEqual([
      {
        name: "counter",
        type: "volatile uint32_t",
        address: "0x20000004",
        size: 4,
        bytes: "07000000",
        value: 7,
      },
    ]);
    expect(snapshot.locals).toContainEqual({
      name: "scaled",
      arg: false,
      type: "int32_t",
      value: "<optimized out>",
    });
    expect(result.limits.join("\n")).toMatch(/scaled is optimised out/);
    expect(result.limits.join("\n")).toMatch(/No RTOS awareness/);
    expect(result.limits.join("\n")).toMatch(/Profile stm32f4-stlink is unverified/);
    expect(result.artifacts.map((a: Json) => a.path.split("/").at(-1)).sort()).toEqual([
      "mi.log",
      "openocd.log",
    ]);
    const times = result.events.map((e: Json) => e.t);
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(new Set(times).size).toBe(times.length);
    expect(run.json.result).toBe(`embedded-lab-results/${result.runId}/result.json`);
    expectFixedCommands();
    expectNoToolLeft();
  });

  it("starts GDB without init files, auto-load, debuginfod or history (REQ-SEC-b50cb2e8)", async () => {
    await writeFile(join(root, ".gdbinit"), "shell echo pwned\n");
    const run = live("snapshot");
    expect(run.code).toBe(0);
    const start = gdbSession() as Json;
    expect(start.argv.slice(0, 3)).toEqual(["--interpreter=mi3", "-nx", "-q"]);
    for (const setting of [
      "set auto-load off",
      "set debuginfod enabled off",
      "set history save off",
      "set confirm off",
      "set trust-readonly-sections off",
      "set may-call-functions off",
    ])
      expect(start.argv).toContain(setting);
    expect(start.cwd.replaceAll("\\", "/")).toMatch(/embedded-lab-results\/[0-9A-Z]{26}\/gdb$/);
    expect(JSON.stringify(gdbEntries())).not.toContain(".gdbinit");
  });

  it("starts OpenOCD from the profile, for the declared serial, on 127.0.0.1 only (REQ-SEC-593220cf)", () => {
    const run = live("snapshot");
    const result = resultOf(run);
    const argv: string[] = (ocdSession() as Json).argv;
    expect(argv.slice(0, 4)).toEqual([
      "-f",
      "interface/stlink.cfg",
      "-c",
      "adapter serial 066DFF485153826687243634",
    ]);
    expect(argv.filter((_arg, i) => argv[i - 1] === "-f")).toEqual([
      "interface/stlink.cfg",
      "target/stm32f4x.cfg",
    ]);
    for (const command of [
      "bindto 127.0.0.1",
      `gdb_port ${result.server.port}`,
      "telnet_port disabled",
      "tcl_port disabled",
      "gdb_flash_program disable",
      "gdb_breakpoint_override hard",
      "[target current] configure -event gdb-attach { halt }",
    ])
      expect(argv).toContain(command);
    expect(argv.some((arg) => arg.includes("gdb-detach") && arg.includes("catch {halt}"))).toBe(true);
    expect(argv).not.toContain("-s");
    // OpenOCD looks for -f scripts in its working folder first: an empty folder outside the workbench, removed after.
    const cwd = String((ocdSession() as Json).cwd);
    expect(cwd.replaceAll("\\", "/").startsWith(root.replaceAll("\\", "/"))).toBe(false);
    expect(existsSync(cwd)).toBe(false);
    expect(result.server).toMatchObject({ address: "127.0.0.1" });
    expect(sent("-target-select")[0]?.args).toBe(`remote 127.0.0.1:${result.server.port}`);
    // GDB may read only the profile's flash and RAM and the fault registers.
    const consoles = sent("-interpreter-exec").map((entry) => JSON.parse(entry.args.slice(8)));
    expect(consoles.filter((text: string) => text.startsWith("mem") || text.startsWith("set mem"))).toEqual([
      "mem 0x08000000 0x08200000 ro",
      "mem 0x20000000 0x20030000 ro",
      "mem 0xe000ed00 0xe000ed40 ro",
      "set mem inaccessible-by-default on",
    ]);
  });

  it("resumes the core at exit only when asked, and confirms it from OpenOCD (REQ-REL-d5f06a9b)", () => {
    const run = live("snapshot", [], "resume");
    const result = resultOf(run);
    expect(result).toMatchObject({
      onExit: "resume",
      target: { after: "running" },
      lifecycle: { physical: "confirmed" },
    });
    const argv: string[] = (ocdSession() as Json).argv;
    expect(argv.some((arg) => arg.includes("gdb-detach") && arg.includes("catch {resume}"))).toBe(true);
    expect(sent("-target-detach")).toHaveLength(1);
    expect(sent("-exec-continue")).toHaveLength(0);
  });

  it("withholds symbols, sources and variables when the ELF does not match the flash (L04-B, REQ-SEC-7e237fa9)", async () => {
    await scenario({ flash: join(firmware, "fault-m4-v2.elf") });
    const run = live("snapshot", ["--read", "counter"]);
    expect(run.code).toBe(3);
    const result = resultOf(run);
    expect(result.status).toBe("incomplete");
    expect(result.elf.match).toBe("mismatched");
    expect(result.elf.firstDifference).toMatch(/^0x080000/);
    expect(result.problems.map((p: Json) => p.code)).toContain("elf-mismatch");
    for (const frame of result.snapshot.frames) expect(Object.keys(frame).sort()).toEqual(["addr", "level"]);
    for (const site of result.snapshot.fault.sites) expect(site.symbol).toBeUndefined();
    expect(result.snapshot.locals).toEqual([]);
    expect(result.snapshot.reads).toEqual([
      { name: "counter", refused: "the ELF is not verified against the target" },
    ]);
    // The decoded cause is a register fact, kept; only the attribution is withheld.
    expect(result.snapshot.fault.causes.map((c: Json) => c.name)).toEqual(["DIVBYZERO", "FORCED"]);
    expect(sent("-data-evaluate-expression")).toEqual([]);
    expect(sent("-stack-list-variables")).toEqual([]);
    // Offline re-diagnosis of this mismatched run attributes nothing either (REQ-FUNC-ccbd4442).
    const diagnosis = elfTool(["diagnose", run.json.result.replace(/\/result\.json$/, "")]);
    expect(diagnosis.code).toBe(0);
    expect(diagnosis.json).toMatchObject({ match: "mismatched", elf: { same: true } });
    for (const site of diagnosis.json.sites) expect(site.symbol).toBeUndefined();
    expect(diagnosis.json.limits.join(" ")).toMatch(/did not match the target's flash/);
  });

  it("names symbols for a partly compared ELF only with a stated limit, and none when nothing compared (REQ-SEC-7e237fa9)", async () => {
    await scenario({ unreadable: [{ addr: "0x08000084", size: 4 }] });
    let run = live("snapshot", ["--read", "counter"]);
    expect(run.code).toBe(0);
    let result = resultOf(run);
    expect(result.elf).toMatchObject({ match: "unchecked", compared: 100 });
    expect(result.elf.matchNote).toMatch(/\.text could not be read/);
    expect(result.problems.map((p: Json) => p.code)).toEqual(["elf-unchecked"]);
    expect(result.limits.join(" | ")).toMatch(/attributions are not fully verified/);
    expect(result.snapshot.fault.sites).toContainEqual({
      role: "stacked-pc",
      addr: "0x0800011e",
      symbol: "compute_ratio",
      offset: 6,
    });
    await scenario({ unreadable: [{ addr: "0x08000000", size: 0x200000 }] });
    run = live("snapshot", ["--read", "counter"]);
    result = resultOf(run);
    expect(result.elf).toMatchObject({ match: "unchecked", compared: 0 });
    expect(result.limits.join(" | ")).toMatch(/no address is attributed/);
    for (const site of result.snapshot.fault.sites) expect(site.symbol).toBeUndefined();
    for (const frame of result.snapshot.frames) expect(frame.func).toBeUndefined();
    expect(result.snapshot.reads).toEqual([
      { name: "counter", refused: "the ELF is not verified against the target" },
    ]);
    // Offline re-diagnosis of a run that compared nothing attributes nothing either (REQ-FUNC-ccbd4442).
    const diagnosis = elfTool(["diagnose", run.json.result.replace(/\/result\.json$/, "")]);
    expect(diagnosis.json).toMatchObject({ match: "unchecked", elf: { same: true } });
    for (const site of diagnosis.json.sites) expect(site.symbol).toBeUndefined();
    expect(diagnosis.json.limits.join(" ")).toMatch(/no address is attributed/);
  });

  it("blocks after identification when the CPUID is not the profile's core (REQ-SEC-7e237fa9)", async () => {
    await scenario({ cpuid: "0x411fc272" });
    const run = live("snapshot");
    expect(run.code).toBe(3);
    const result = resultOf(run);
    expect(result).toMatchObject({
      status: "blocked",
      target: { partno: "0xc27", detected: "cortex-m7", after: "halted" },
    });
    expect(result.snapshot).toBeUndefined();
    expect(sent("-data-list-register-names")).toEqual([]);
    expect(sent("-target-detach")).toHaveLength(1);
    expectNoToolLeft();
  });

  it("blocks when this GDB does not know the profile's architecture (REQ-FUNC-36c45a10)", async () => {
    await scenario({ architectures: ["armv6-m"] });
    const run = live("snapshot");
    const result = resultOf(run);
    expect(result).toMatchObject({ status: "blocked", lifecycle: { physical: "unchanged" } });
    expect(result.problems[0].code).toBe("architecture");
    expect(sent("-target-select")).toEqual([]);
  });

  it("reads variables only inside the profile's RAM and up to 256 bytes (REQ-SEC-7f9bd395)", () => {
    const run = live("snapshot", ["--read", "gpio_odr", "--read", "big_table", "--read", "missing"]);
    expect(run.code).toBe(0);
    const reads = resultOf(run).snapshot.reads;
    expect(reads[0]).toMatchObject({
      name: "gpio_odr",
      address: "0x40020014",
      refused: "outside the profile's RAM",
    });
    expect(reads[1]).toMatchObject({ name: "big_table", size: 640, refused: "larger than 256 bytes" });
    expect(reads[2].error).toMatch(/No symbol/);
    const addresses = sent("-data-read-memory-bytes").map((entry) => entry.args.split(" ")[0]);
    expect(addresses).not.toContain("0x40020014");
    expect(addresses).not.toContain("0x2000001c");
  });

  it("keeps a snapshot when GDB cannot list locals, unwind the stack or read a variable (REQ-FUNC-9ab9965c)", async () => {
    await scenario({
      commands: {
        "-stack-list-variables": { error: "No symbol table info available." },
        "-stack-info-depth": { error: "Cannot access memory at address 0x20018000" },
      },
      symbols: { ...fault.symbols, ghost: { addr: "0x20010000", size: 4, type: "int" } },
    });
    const run = live("snapshot", ["--read", "ghost"]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result.status).toBe("pass");
    expect(result.snapshot).toMatchObject({ frames: [], locals: [] });
    expect(result.snapshot.reads[0]).toMatchObject({ name: "ghost", address: "0x20010000" });
    expect(result.snapshot.reads[0].error).toMatch(/Cannot access memory/);
    expect(result.snapshot.fault.causes.map((c: Json) => c.name)).toEqual(["DIVBYZERO", "FORCED"]);
    expect(result.limits.join(" | ")).toMatch(/No backtrace: Cannot access memory/);
    expect(result.limits.join(" | ")).toMatch(/No local variables: No symbol table/);
  });

  it("refuses side-effect expressions, raw commands, bad locations and foreign images before any process (L04-D)", async () => {
    await copyFile(join(firmware, "riscv.elf"), join(root, "build", "rv.elf"));
    await copyFile(join(firmware, "fault-m0.elf"), join(root, "build", "m0.elf"));
    const base = ["--probe", "stlink1", "--firmware-effect", "none", "--on-exit", "halted"];
    const cases: string[][] = [
      ...[
        "counter = 0",
        "reset()",
        "x++",
        "*ptr",
        "$pc",
        "$sp = 0",
        "p->next",
        "monitor reset",
        "shell ls",
        "python print(1)",
      ].map((value) => ["snapshot", ...base, "--elf", "build/app.elf", "--read", value]),
      ...["monitor reset halt", "main if 1", "*0x40000000", "f()", "fault.c:0"].map((value) => [
        "break",
        ...base,
        "--elf",
        "build/app.elf",
        "--at",
        value,
        "--timeout",
        "5",
      ]),
      ["snapshot", ...base, "--elf", "build/rv.elf"],
      ["snapshot", ...base, "--elf", "../app.elf"],
      ["snapshot", ...base, "--elf", join(firmware, "fault-m4.elf")],
      ["snapshot", ...base, "--elf", "build"],
      [
        "snapshot",
        "--probe",
        "psu",
        "--elf",
        "build/app.elf",
        "--firmware-effect",
        "none",
        "--on-exit",
        "halted",
      ],
      [
        "snapshot",
        "--probe",
        "jlink",
        "--elf",
        "build/app.elf",
        "--firmware-effect",
        "none",
        "--on-exit",
        "halted",
      ],
      [
        "snapshot",
        "--probe",
        "nope",
        "--elf",
        "build/app.elf",
        "--firmware-effect",
        "none",
        "--on-exit",
        "halted",
      ],
      ["step", ...base, "--elf", "build/app.elf", "--count", "0"],
      ["step", ...base, "--elf", "build/app.elf", "--count", "101"],
      ["break", ...base, "--elf", "build/app.elf", "--at", "main", "--timeout", "0"],
      [
        "snapshot",
        ...base,
        "--elf",
        "build/app.elf",
        ...Array.from({ length: 9 }, (_, i) => ["--read", `v${i}`]).flat(),
      ],
    ];
    for (const args of cases) {
      const run = debug(args);
      expect(run.code, args.join(" ")).toBe(2);
      expect(run.json.status, args.join(" ")).toBe("refused");
    }
    // An ARMv7E-M image is refused for the Cortex-M0+ profile; the v6-M image would run on the M4.
    const registry = JSON.parse(readFileSync(paths().registry, "utf8"));
    registry.resources[0].profile = "stm32g0-stlink";
    await writeFile(paths().registry, JSON.stringify(registry));
    expect(debug(["snapshot", ...base, "--elf", "build/app.elf"]).json.problems[0].message).toMatch(/v7E-M/);
    expect(gdbEntries()).toEqual([]);
    expect(lines(paths().ocdLog)).toEqual([]);
    expect(existsSync(join(root, "embedded-lab-results"))).toBe(false);
  });

  it("refuses a results folder below a file with exit 2", async () => {
    await writeFile(join(root, "notes.txt"), "a file\n");
    const run = live("snapshot", ["--results-dir", "notes.txt/results"]);
    expect(run).toMatchObject({ code: 2, json: { status: "refused" } });
    expect(gdbSession()).toBeUndefined();
  });

  it("refuses a registry that differs from the approved one", () => {
    const run = debug(
      [
        "snapshot",
        "--probe",
        "stlink1",
        "--elf",
        "build/app.elf",
        "--firmware-effect",
        "none",
        "--on-exit",
        "halted",
      ],
      { VERA_REGISTRY_SHA256: "0".repeat(64) },
    );
    expect(run.code).toBe(2);
    expect(run.json.problems[0].message).toMatch(/changed after the approval/);
  });

  it("stops at the requested hardware breakpoint and removes it (L04-C, REQ-FUNC-e539c51f)", () => {
    const run = live("break", ["--at", "compute_ratio", "--timeout", "10"]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result.breakpoint).toMatchObject({
      location: "compute_ratio",
      number: "1",
      hit: true,
      reason: "breakpoint-hit",
    });
    expect(result.snapshot.registers.pc).toBe("0x08000114");
    expect(sent("-break-insert")[0]?.args).toBe("-h compute_ratio");
    expect(sent("-break-delete")[0]?.args).toBe("1");
    const order = gdbCommands().map((entry) => entry.cmd);
    expect(order.indexOf("-exec-continue")).toBeGreaterThan(order.indexOf("-break-insert"));
    expect(order.indexOf("-break-delete")).toBeLessThan(order.indexOf("-target-detach"));
    expectNoToolLeft();
  });

  it("interrupts at the timeout and never calls another stop a hit (REQ-FUNC-e539c51f, REQ-REL-afd24ad4)", async () => {
    await scenario({ continue: { never: true } });
    let run = live("break", ["--at", "fault.c:23", "--timeout", "1"]);
    expect(run.code).toBe(3);
    let result = resultOf(run);
    expect(result).toMatchObject({ status: "incomplete", breakpoint: { hit: false, reason: "timeout" } });
    expect(sent("-exec-interrupt")).toHaveLength(1);
    expect(result.snapshot).toBeDefined();
    await rm(paths().gdbLog);
    await scenario({ continue: { after: 0.1, stop: { reason: "breakpoint-hit", bkptno: "7" } } });
    run = live("break", ["--at", "*0x08000118", "--timeout", "5"]);
    result = resultOf(run);
    expect(result).toMatchObject({
      status: "incomplete",
      breakpoint: { hit: false, reason: "breakpoint-hit" },
    });
    await scenario({
      continue: { after: 0.1, stop: { reason: "signal-received", "signal-name": "SIGTRAP" } },
    });
    run = live("break", ["--at", "main", "--timeout", "5"]);
    result = resultOf(run);
    expect(result).toMatchObject({
      status: "incomplete",
      breakpoint: { hit: false, reason: "signal-received" },
      target: { stopReason: "signal-received", state: "halted" },
    });
  });

  it("steps lines and instructions and stops early on a step that never ends (L04-C, REQ-FUNC-bf57be4d)", async () => {
    let run = live("step", ["--count", "3"]);
    expect(run.code).toBe(0);
    let result = resultOf(run);
    expect(result.steps.map((s: Json) => [s.index, s.reason, s.line])).toEqual([
      [1, "end-stepping-range", "31"],
      [2, "end-stepping-range", "32"],
      [3, "end-stepping-range", "33"],
    ]);
    expect(sent("-exec-step")).toHaveLength(3);
    await rm(paths().gdbLog);
    run = live("step", ["--count", "2", "--instruction"]);
    expect(resultOf(run).steps).toHaveLength(2);
    expect(sent("-exec-step-instruction")).toHaveLength(2);
    await scenario({ step: { never: true } });
    run = live("step", ["--count", "5"]);
    result = resultOf(run);
    expect(result).toMatchObject({ status: "incomplete", steps: [{ index: 1, reason: "timeout" }] });
    expect(sent("-exec-interrupt")).toHaveLength(1);
  });

  it("keeps the target state explicit after an MI timeout, a lost connection and a GDB crash (L04-E, REQ-REL-afd24ad4)", async () => {
    await scenario({ commands: { "-data-list-register-values": { silent: true } } });
    let run = live("snapshot");
    expect(run.code).toBe(3);
    let result = resultOf(run);
    expect(result).toMatchObject({ status: "error", target: { state: "unknown" } });
    expect(result.problems[0].code).toBe("timeout");
    // GDB was killed; its closed connection still made OpenOCD apply the exit policy.
    expect(result.lifecycle.physical).toBe("confirmed");
    expect(sent("-target-detach")).toEqual([]);
    expectNoToolLeft();
    await rm(paths().gdbLog);
    await scenario({ continue: { after: 0.2, disconnect: true } });
    run = live("break", ["--at", "main", "--timeout", "10"]);
    result = resultOf(run);
    expect(result).toMatchObject({
      status: "error",
      target: { state: "disconnected" },
      breakpoint: { hit: false },
    });
    expect(result.problems[0].code).toBe("disconnected");
    expectNoToolLeft();
    await scenario({ commands: { "-stack-info-depth": { exit: true } } });
    run = live("snapshot");
    result = resultOf(run);
    expect(result).toMatchObject({ status: "error", target: { state: "disconnected" } });
    expectNoToolLeft();
  });

  it("ignores untokened and foreign results and records async stops as events (REQ-FUNC-74347f3b)", async () => {
    await scenario({
      commands: {
        "-data-list-register-names": { untokened: true, asyncBefore: ['77^done,register-names=["evil"]'] },
        "-stack-info-depth": { asyncBefore: ['*stopped,reason="signal-received",signal-name="SIGTRAP"'] },
      },
    });
    const run = live("snapshot");
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result.snapshot.registers.pc).toBe("0x08000114");
    const kinds = result.events.map((e: Json) => e.kind);
    expect(kinds).toContain("untokened");
    expect(kinds).toContain("stale");
    expect(result.events.some((e: Json) => e.kind === "async" && e.text.includes("SIGTRAP"))).toBe(true);
  });

  it("reports missing tool executables and a GDB that dies at start as errors with a result (REQ-REL-afd24ad4)", async () => {
    let run = debug(
      [
        "snapshot",
        "--probe",
        "stlink1",
        "--elf",
        "build/app.elf",
        "--firmware-effect",
        "none",
        "--on-exit",
        "halted",
      ],
      { VERA_PROGRAM_OPENOCD: join(root, "missing", "openocd.exe") },
    );
    expect(run.code).toBe(3);
    let result = resultOf(run);
    expect(result).toMatchObject({
      status: "error",
      lifecycle: { physical: "unchanged" },
      tools: { openocd: { version: null } },
    });
    expect(result.problems[0]).toMatchObject({ code: "openocd" });
    run = debug(
      [
        "snapshot",
        "--probe",
        "stlink1",
        "--elf",
        "build/app.elf",
        "--firmware-effect",
        "none",
        "--on-exit",
        "halted",
      ],
      { VERA_PROGRAM_ARM_NONE_EABI_GDB: join(root, "missing", "gdb.exe") },
    );
    result = resultOf(run);
    expect(result).toMatchObject({ status: "error", lifecycle: { physical: "unchanged" } });
    expect(result.problems[0]).toMatchObject({ code: "gdb" });
    await scenario({ exitAtStart: true });
    run = live("snapshot");
    result = resultOf(run);
    expect(result).toMatchObject({
      status: "error",
      target: { state: "unknown" },
      lifecycle: { physical: "unchanged" },
    });
    expect(result.problems[0].code).toBe("gdb");
    expectNoToolLeft();
  });

  it("refuses a malformed ELF table with exit 2, never a traceback (REQ-SEC-e1493c9b)", async () => {
    const data = Buffer.from(readFileSync(join(firmware, "fault-m4.elf")));
    const marker = data.indexOf(Buffer.from("aeabi\0"));
    // The last byte of the .ARM.attributes section becomes a ULEB128 continuation byte.
    const end = data.indexOf(Buffer.from("A"), marker - 6) + data.readUInt32LE(marker - 4) + 1;
    data[end - 1] = 0x80;
    await writeFile(join(root, "build", "bad.elf"), data);
    expect(elfTool(["inspect", "build/bad.elf"])).toMatchObject({ code: 2, json: { status: "refused" } });
    const run = debug([
      "snapshot",
      "--probe",
      "stlink1",
      "--elf",
      "build/bad.elf",
      "--firmware-effect",
      "none",
      "--on-exit",
      "halted",
    ]);
    expect(run).toMatchObject({ code: 2, json: { status: "refused" } });
    expect(existsSync(join(root, "embedded-lab-results"))).toBe(false);
  });

  it("reports OpenOCD failures and an unconfirmed exit honestly (REQ-REL-d5f06a9b)", async () => {
    await scenario({}, { fail: true });
    let run = live("snapshot");
    let result = resultOf(run);
    expect(result).toMatchObject({ status: "error", lifecycle: { physical: "unchanged" } });
    expect(result.problems[0].code).toBe("openocd");
    expect(gdbSession()).toBeUndefined();
    await scenario({}, { noMarker: true });
    run = live("snapshot");
    result = resultOf(run);
    expect(result).toMatchObject({
      status: "pass",
      target: { after: "unknown" },
      lifecycle: { physical: "unknown" },
    });
    expect(result.problems.map((p: Json) => p.code)).toEqual(["exit-unconfirmed"]);
    expectNoToolLeft();
  });

  it("reports the tools and their architecture support without opening a probe (REQ-FUNC-36c45a10)", async () => {
    let run = debug(["tools"]);
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({
      kind: "gdb-debug-tools",
      gdb: { version: "15.2", target: "arm-none-eabi" },
      openocd: { version: "0.12.0" },
    });
    expect(run.json.profiles.map((p: Json) => [p.id, p.gdbSupports, p.status])).toEqual([
      ["stm32f4-stlink", true, "unverified"],
      ["stm32g0-stlink", true, "unverified"],
    ]);
    await scenario({ architectures: ["armv7e-m"] });
    run = debug(["tools"]);
    expect(run.json.profiles.map((p: Json) => p.gdbSupports)).toEqual([true, false]);
    expect(lines(paths().ocdLog).every((entry) => entry.argv.includes("--version"))).toBe(true);
    expect(gdbCommands()).toEqual([]);
  });

  it("releases without starting anything and reports the state unknown", () => {
    const run = debug(["release", "--probe", "stlink1"]);
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({ kind: "gdb-debug-release", physical: "unknown" });
    expect(gdbEntries()).toEqual([]);
    expect(lines(paths().ocdLog)).toEqual([]);
  });

  it("re-diagnoses a saved snapshot offline and refuses attribution for another ELF (REQ-FUNC-ccbd4442)", async () => {
    const run = live("snapshot", ["--run-id", "fault1"]);
    expect(run.code).toBe(0);
    let diagnosis = elfTool(["diagnose", "embedded-lab-results/fault1"]);
    expect(diagnosis.code).toBe(0);
    expect(diagnosis.json).toMatchObject({
      kind: "gdb-debug-diagnosis",
      match: "matched",
      elf: { same: true },
    });
    expect(diagnosis.json.fault.causes.map((c: Json) => c.name)).toEqual(["DIVBYZERO", "FORCED"]);
    expect(diagnosis.json.sites).toContainEqual({
      role: "stacked-pc",
      addr: "0x0800011e",
      symbol: "compute_ratio",
      offset: 6,
    });
    await copyFile(join(firmware, "fault-m4-v2.elf"), join(root, "build", "v2.elf"));
    diagnosis = elfTool(["diagnose", "embedded-lab-results/fault1", "--elf", "build/v2.elf"]);
    expect(diagnosis.json.elf.same).toBe(false);
    for (const site of diagnosis.json.sites) expect(site.symbol).toBeUndefined();
    expect(diagnosis.json.limits.join(" ")).toMatch(/differs from the one the snapshot recorded/);
    expect(elfTool(["diagnose", "build"]).code).toBe(2);
  });

  it("leaves a mixed registry readable by the scpi-instruments helper", () => {
    const run = spawnSync(
      python,
      [join(plugins, "scpi-instruments", "scripts", "scpi_tool.py"), "discover-configured"],
      {
        cwd: root,
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", SCPI_REGISTRY: paths().registry },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    expect(run.status, run.stdout).toBe(0);
    const json = JSON.parse(run.stdout.trim().split("\n").at(-1) ?? "{}");
    expect(JSON.stringify(json)).toContain('"psu"');
    expect(JSON.stringify(json)).not.toContain("stlink1");
  });
});

describe("VERA's runner supervising the helper (real processes, stand-ins)", { timeout: 120_000 }, () => {
  it("applies the exit policy on Stop during a breakpoint wait and leaves no process or lease (L04-F)", async () => {
    await scenario({ continue: { never: true } });
    const leases = new core.ResourceLeases({ root: join(root, "leases"), app: "test" });
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      leases,
    });
    const keys = labResourceKeys(
      labRegistrySchema.parse({
        format: 1,
        resources: [{ alias: "stlink1", kind: "probe", resource: PROBE, profile: "stm32f4-stlink" }],
      }).resources[0] as LabResource,
    );
    try {
      const run = await runner.start({
        sessionId: "s1",
        workbench: root,
        executable: python,
        args: [
          debugScript,
          "break",
          "--probe",
          "stlink1",
          "--elf",
          "build/app.elf",
          "--firmware-effect",
          "none",
          "--on-exit",
          "halted",
          "--at",
          "main",
          "--timeout",
          "600",
          "--run-id",
          "stopped1",
        ],
        env: { ...ownEnv(), PYTHONDONTWRITEBYTECODE: "1" },
        background: true,
        lease: {
          claims: [{ kind: "probe", alias: "stlink1", resource: PROBE, keys, actuates: true }],
          graceMs: 30_000,
          cleanup: {
            args: [debugScript, "release", "--probe", "stlink1"],
            shown: ["release", "--probe", "stlink1"],
            timeoutMs: 30_000,
          },
        },
      });
      for (let i = 0; i < 400 && sent("-exec-continue").length === 0; i++) await sleep(50);
      expect(sent("-exec-continue")).toHaveLength(1);
      // The probe is BUSY for probe-rs while the session holds it.
      await expect(
        runner.start({
          sessionId: "s2",
          workbench: root,
          executable: python,
          args: ["-c", "0", "--probe", "0483:374b"],
        }),
      ).rejects.toMatchObject({ code: "BUSY" });
      const stopped = await run.stop();
      expect(stopped).toMatchObject({ stopped: true, physical: "confirmed", cleanup: "none" });
      const result = JSON.parse(
        await readFile(join(root, "embedded-lab-results", "stopped1", "result.json"), "utf8"),
      );
      expect(result).toMatchObject({
        status: "incomplete",
        target: { after: "halted" },
        lifecycle: { physical: "confirmed" },
      });
      expect(result.problems.map((p: Json) => p.code)).toContain("stopped");
      expect(sent("-exec-interrupt")).toHaveLength(1);
      expect(sent("-target-detach")).toHaveLength(1);
      expectNoToolLeft();
      expect((await readdir(join(root, "leases"))).filter((name) => name.endsWith(".lease"))).toEqual([]);
    } finally {
      await runner.stopAll();
    }
  });
});

const realGdb = process.env.VERA_GDB_REAL_GDB ?? "";
const realOpenOcd = process.env.VERA_GDB_REAL_OPENOCD ?? "";

describe.skipIf(!realGdb)(
  "gdb-debug with a real GDB against the stand-in's remote-protocol target (opt-in)",
  {
    timeout: 120_000,
  },
  () => {
    const withGdb = { VERA_PROGRAM_ARM_NONE_EABI_GDB: realGdb };
    const target = async (fields: Json = {}) =>
      writeFile(
        paths().ocdScenario,
        JSON.stringify({
          target: {
            elf: join(root, "build", "app.elf"),
            scb: fault.scb,
            registers: fault.registers,
            ram: fault.ram,
            ...fields,
          },
        }),
      );
    const real = (operation: string, more: string[] = [], onExit = "halted") =>
      debug(
        [
          operation,
          "--probe",
          "stlink1",
          "--elf",
          "build/app.elf",
          "--firmware-effect",
          "none",
          "--on-exit",
          onExit,
          ...more,
        ],
        withGdb,
      );
    const writes = () => lines(paths().ocdLog).filter((entry) => entry.write);
    const funcs = (result: Json) => result.snapshot.frames.map((frame: Json) => frame.func);

    it("reports the real GDB's version and target and the profile architectures it supports", () => {
      const run = debug(["tools"], withGdb);
      expect(run.code).toBe(0);
      expect(run.json.gdb.version).toMatch(/^\d+\.\d+/);
      expect(Number.parseInt(run.json.gdb.version, 10)).toBeGreaterThanOrEqual(12);
      expect(run.json.gdb.target).toBeTruthy();
      expect(run.json.profiles.map((p: Json) => [p.architecture, p.gdbSupports])).toEqual([
        ["armv7e-m", true],
        ["armv6-m", true],
      ]);
    });

    it("snapshots the HardFault with the real GDB's own unwinding, locals and reads", async () => {
      await target();
      const run = real("snapshot", ["--read", "counter", "--read", "sensor_state.raw"]);
      expect(run.code, run.stdout).toBe(0);
      const result = resultOf(run);
      expect(result).toMatchObject({
        status: "pass",
        elf: { match: "matched", compared: 446 },
        target: { cpuid: "0x410fc241", detected: "cortex-m4", state: "halted", after: "halted" },
        lifecycle: { physical: "confirmed" },
      });
      expect(funcs(result).slice(0, 4)).toEqual([
        "HardFault_Handler",
        "<signal handler called>",
        "compute_ratio",
        "sample",
      ]);
      expect(result.snapshot.frames[2]).toMatchObject({ file: "fault.c", line: "23" });
      expect(result.snapshot.fault.causes.map((c: Json) => c.name)).toEqual(["DIVBYZERO", "FORCED"]);
      expect(result.snapshot.fault.sites).toContainEqual({
        role: "stacked-pc",
        addr: "0x0800011e",
        symbol: "compute_ratio",
        offset: 6,
      });
      expect(result.snapshot.reads.map((r: Json) => [r.name, r.type, r.value])).toEqual([
        ["counter", "volatile uint32_t", 7],
        ["sensor_state.raw", "uint16_t", 0],
      ]);
      expect(writes()).toEqual([]);
    });

    it("stops at hardware breakpoints the real GDB places and reports their locals", async () => {
      await target();
      let result = resultOf(real("break", ["--at", "sample", "--timeout", "10"]));
      expect(result).toMatchObject({ status: "pass", breakpoint: { hit: true, reason: "breakpoint-hit" } });
      expect(result.breakpoint.address).toMatch(/^0x0800012[c-f]$/);
      expect(funcs(result)[0]).toBe("sample");
      result = resultOf(real("break", ["--at", "fault.c:23", "--timeout", "10"]));
      expect(result).toMatchObject({ status: "pass", breakpoint: { hit: true, address: "0x08000118" } });
      expect(result.snapshot.locals).toContainEqual({
        name: "value",
        arg: true,
        type: "int32_t",
        value: "1",
      });
      expect(writes()).toEqual([]);
    });

    it("interrupts a core that never reaches the breakpoint", async () => {
      await target({ hang: true });
      const run = real("break", ["--at", "sample", "--timeout", "1"]);
      expect(run.code).toBe(3);
      const result = resultOf(run);
      expect(result).toMatchObject({
        status: "incomplete",
        breakpoint: { hit: false, reason: "timeout" },
        target: { state: "halted", after: "halted" },
      });
      expect(result.snapshot).toBeDefined();
      expect(lines(paths().ocdLog).filter((entry) => entry.interrupt)).toHaveLength(1);
    });

    it("steps single instructions and withholds every name for a rebuilt ELF", async () => {
      await target();
      let result = resultOf(real("step", ["--instruction", "--count", "2"]));
      expect(result.steps.map((s: Json) => [s.reason, s.addr, s.func])).toEqual([
        ["end-stepping-range", "0x08000114", "HardFault_Handler"],
        ["end-stepping-range", "0x08000114", "HardFault_Handler"],
      ]);
      await copyFile(join(firmware, "fault-m4-v2.elf"), join(root, "build", "app.elf"));
      await target({ elf: join(firmware, "fault-m4.elf") });
      const run = real("snapshot");
      expect(run.code).toBe(3);
      result = resultOf(run);
      expect(result).toMatchObject({ status: "incomplete", elf: { match: "mismatched" } });
      expect(result.problems.map((p: Json) => p.code)).toEqual(["elf-mismatch"]);
      for (const frame of result.snapshot.frames) expect(frame.func).toBeUndefined();
      expect(writes()).toEqual([]);
    });
  },
);

describe.skipIf(!realOpenOcd)(
  "gdb-debug with a real OpenOCD and no probe (opt-in)",
  { timeout: 120_000 },
  () => {
    it("accepts every configuration command, finds no probe and ends with the target untouched", async () => {
      // A serial no probe has: a board that happens to be attached is never opened.
      await writeFile(
        paths().registry,
        JSON.stringify({
          format: 1,
          resources: [
            {
              alias: "stlink1",
              kind: "probe",
              resource: "0483:374b:VERA-NO-SUCH-PROBE",
              profile: "stm32f4-stlink",
            },
          ],
        }),
      );
      const listed = debug(["tools"], { VERA_PROGRAM_OPENOCD: realOpenOcd });
      expect(listed.json.openocd.version).toMatch(/^0\.(1[2-9])\.|^[1-9]/);
      const run = debug(
        [
          "snapshot",
          "--probe",
          "stlink1",
          "--elf",
          "build/app.elf",
          "--firmware-effect",
          "none",
          "--on-exit",
          "halted",
        ],
        { VERA_PROGRAM_OPENOCD: realOpenOcd },
      );
      expect(run.code).toBe(3);
      const result = resultOf(run);
      expect(result).toMatchObject({
        status: "error",
        problems: [{ code: "openocd" }],
        lifecycle: { physical: "unchanged" },
      });
      expect(gdbSession()).toBeUndefined();
      const log = readFileSync(join(root, "embedded-lab-results", result.runId, "openocd.log"), "utf8");
      // Every -c command ran before init: an error in one would end OpenOCD before it looked for the adapter.
      expect(log).toMatch(/force hard breakpoints/);
      expect(log).toMatch(/tcl server disabled/);
      expect(log).toMatch(/telnet server disabled/);
      expect(log).not.toMatch(/invalid command|wrong # args|unknown command|syntax error/i);
      expect(log).not.toMatch(/Listening on port/);
      expectNoToolLeft();
    });
  },
);

describe.skipIf(!process.env.VERA_GDB_ORACLE_PYTHON)(
  "gdb-elf against pyelftools 0.32 (opt-in oracle)",
  () => {
    it("agrees with an independent ELF/DWARF reader on every fixture", () => {
      const oracle = `
import json, sys
from elftools.elf.elffile import ELFFile
out = {}
for name in sys.argv[1:]:
    f = ELFFile(open(name, "rb"))
    attrs = {}
    a = f.get_section_by_name(".ARM.attributes")
    if a:
        for sub in a.iter_subsections():
            for ss in sub.iter_subsubsections():
                for x in ss.iter_attributes():
                    attrs[x.tag] = x.value
    syms = [s for s in f.get_section_by_name(".symtab").iter_symbols() if s["st_info"]["type"] in ("STT_FUNC", "STT_OBJECT")]
    cus = list(f.get_dwarf_info().iter_CUs()) if f.has_dwarf_info() else []
    out[name] = {"entry": f.header.e_entry, "machine": f.header.e_machine, "cpu": attrs.get("TAG_CPU_NAME"),
        "arch": attrs.get("TAG_CPU_ARCH"), "functions": sum(s["st_info"]["type"] == "STT_FUNC" for s in syms),
        "objects": sum(s["st_info"]["type"] == "STT_OBJECT" for s in syms), "units": len(cus),
        "versions": sorted({cu.header.version for cu in cus}),
        "producers": sorted({cu.get_top_DIE().attributes["DW_AT_producer"].value.decode() for cu in cus})}
print(json.dumps(out))
`;
      const names = ["fault-m4.elf", "fault-m4-v2.elf", "fault-m0.elf", "riscv.elf"].map((name) =>
        join(firmware, name),
      );
      const reference = spawnSync(
        process.env.VERA_GDB_ORACLE_PYTHON as string,
        ["-I", "-c", oracle, ...names],
        {
          encoding: "utf8",
        },
      );
      expect(reference.status, reference.stderr).toBe(0);
      const expected = JSON.parse(reference.stdout);
      const archNames: Record<number, string> = { 12: "v6S-M", 13: "v7E-M" };
      for (const name of names) {
        const ours = spawnSync(python, [elfScript, "inspect", name.replace(`${fixtures}`, "")], {
          cwd: fixtures,
          encoding: "utf8",
        });
        const facts = JSON.parse(ours.stdout);
        const ref = expected[name];
        expect(Number.parseInt(facts.elf.entry, 16), name).toBe(ref.entry);
        expect(facts.elf.machine, name).toBe(ref.machine === "EM_ARM" ? "arm" : "riscv");
        expect(facts.symbols.functions, name).toBe(ref.functions);
        expect(facts.symbols.objects, name).toBe(ref.objects);
        expect(facts.debug.units, name).toBe(ref.units);
        expect(facts.debug.dwarfVersions, name).toEqual(ref.versions);
        expect([...facts.debug.producers].sort(), name).toEqual(ref.producers);
        if (ref.cpu) {
          expect(facts.arm.cpuName, name).toBe(ref.cpu);
          expect(facts.arm.arch, name).toBe(archNames[ref.arch]);
        }
      }
    });
  },
);
