// The renode plugin (LAB-06). Default tests check the package and its rules, the profile and test-set validators, the
// firmware checks on committed fixture ELFs built with zig cc (tests/fixtures/renode/firmware/build.py, plus the
// LAB-04 RISC-V and Cortex-M0+ fixtures), and run renode-sim against an executable stand-in for the engine
// (tests/fixtures/renode/fake_renode.py): offline evidence of the helper's protocol, budgets, statuses, reports and
// lifecycle, never of Renode itself. One case runs the helper under VERA's real runner and stops it.
// VERA_RENODE_REAL names a real Renode 1.17.0 executable (the pinned portable package, extracted): the opt-in tests run
// the same operations on the real engine and the fixture firmware, check that its platform files match the profile's
// hashes and that the engine process listens on no socket.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { reportSkip } from "../support/skip-marker.js";

const software = fileURLToPath(new URL("../../", import.meta.url));
const plugins = join(software, "plugins");
const pluginFolder = join(plugins, "renode");
const simScript = join(pluginFolder, "scripts", "renode_sim.py");
const fixtures = fileURLToPath(new URL("../fixtures/renode/", import.meta.url));
const firmware = join(fixtures, "firmware");
const labFirmware = fileURLToPath(new URL("../fixtures/gdb-debug/firmware/", import.meta.url));
const windows = process.platform === "win32";
const python = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const OUTPUT_LIMIT = 11_000;
const PROFILE = "stm32f4-discovery";
const FIRMWARE_ARGS = ["--profile", PROFILE, "--arch", "cortex-m4", "--boot-address", "0x08000000"];

// biome-ignore lint/suspicious/noExplicitAny: the helper's JSON documents, checked field by field.
type Json = Record<string, any>;
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
  stderr: string;
}

let engine = "";
let engineFolder = "";
let root = "";
beforeAll(async () => {
  engineFolder = await realpath(await mkdtemp(join(tmpdir(), "vera-renode-engine-")));
  const made = spawnSync(python, [join(fixtures, "make_engine.py"), engineFolder], { encoding: "utf8" });
  expect(made.status, made.stderr).toBe(0);
  engine = JSON.parse(made.stdout).renode;
});
afterAll(async () => {
  await rm(engineFolder, { recursive: true, force: true });
});
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-renode-")));
  await mkdir(join(root, "build"));
  await mkdir(join(root, ".vera"));
  for (const name of [
    "demo.elf",
    "demo-wrong-version.elf",
    "demo-silent.elf",
    "demo-unmodeled.elf",
    "demo-ccm.elf",
  ])
    await copyFile(join(firmware, name), join(root, "build", name));
  await copyFile(join(labFirmware, "riscv.elf"), join(root, "build", "riscv.elf"));
  await copyFile(join(labFirmware, "fault-m0.elf"), join(root, "build", "fault-m0.elf"));
  await writeFile(join(root, "build", "notes.txt"), "not an ELF");
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 });
});

const calls = () => join(root, "calls.jsonl");
/** renode-sim passes the engine only system variables: the stand-in reads its settings from fake.json beside it. */
function configure(fields: Json = {}) {
  writeFileSync(join(engineFolder, "fake.json"), JSON.stringify({ calls: calls(), scenario: fields }));
}
function environment(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const { VERA_RUN_CONTROL: _a, VERA_PROGRAM_RENODE: _b, ...rest } = process.env;
  const { FAKE_RENODE_SCENARIO: fields, ...more } = extra;
  configure(fields ? JSON.parse(fields) : {});
  return { ...rest, PYTHONDONTWRITEBYTECODE: "1", VERA_PROGRAM_RENODE: engine, ...more };
}
function sim(args: string[], extra: Record<string, string> = {}): Run {
  const result = spawnSync(python, [simScript, ...args], {
    cwd: root,
    env: environment(extra),
    encoding: "utf8",
    timeout: 120_000,
  });
  const stdout = result.stdout ?? "";
  // No input may end in a traceback or in a document the runner would cut.
  expect([0, 1, 2, 3], `exit ${result.status}: ${(result.stderr ?? "").slice(-2000)}`).toContain(
    result.status,
  );
  expect(result.stderr ?? "").toBe("");
  expect(stdout.length).toBeLessThanOrEqual(OUTPUT_LIMIT);
  let json: Json = {};
  try {
    json = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}");
  } catch {
    json = { unparsed: stdout };
  }
  return { code: result.status, json, stdout, stderr: result.stderr ?? "" };
}
const scenario = (fields: Json) => ({ FAKE_RENODE_SCENARIO: JSON.stringify(fields) });
const op = (operation: string, elf: string, more: string[] = [], extra: Record<string, string> = {}) =>
  sim([operation, ...FIRMWARE_ARGS, "--firmware", `build/${elf}`, ...more], extra);
const test = (elf: string, more: string[] = [], extra: Record<string, string> = {}) =>
  op("test", elf, ["--test-set", "board-basics", ...more], extra);
const folderOf = (run: Run) => join(root, dirname(run.json.result));
const resultOf = (run: Run): Json => JSON.parse(readFileSync(join(root, run.json.result), "utf8"));
const entries = (): Json[] =>
  existsSync(calls())
    ? readFileSync(calls(), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const sessions = () =>
  entries().filter((entry) => Array.isArray(entry.argv) && entry.argv[0] !== "--version");
const commands = () =>
  entries()
    .filter((entry) => typeof entry.command === "string")
    .map((e) => e.command);
const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
function expectNoEngineLeft() {
  for (const entry of entries())
    for (const pid of [entry.pid, entry.child].filter(Boolean))
      expect(alive(pid), `process ${pid}`).toBe(false);
}
async function workbenchProfile(id: string, files: Record<string, string>, profile: Json = {}) {
  const folder = join(root, "renode", "profiles", id);
  await mkdir(folder, { recursive: true });
  const base: Json = JSON.parse(
    readFileSync(join(pluginFolder, "profiles", PROFILE, "profile.json"), "utf8"),
  );
  await writeFile(join(folder, "profile.json"), JSON.stringify({ ...base, id, ...profile }));
  const defaults: Record<string, string> = Object.fromEntries(
    ["platform.repl", "stm32f4.repl", "machine.resc"].map((name) => [
      name,
      readFileSync(join(pluginFolder, "profiles", PROFILE, name), "utf8"),
    ]),
  );
  for (const [name, text] of Object.entries({ ...defaults, ...files }))
    await writeFile(join(folder, name), text);
}

describe("package", { timeout: 60_000 }, () => {
  it("publishes the official renode package with the pinned engine, its pack group, metadata and skill", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({
      id: "renode",
      version: "0.3.1",
      ecosystem: "lab",
      platforms: ["windows-x64", "linux-x64"],
    });
    const engineProgram = m.programs.renode;
    expect(engineProgram?.version).toMatchObject({ args: ["--version"], range: "==1.17.0" });
    const install = engineProgram?.install as Json;
    expect(install.download["windows-x64"]).toMatchObject({
      url: "https://github.com/renode/renode/releases/download/v1.17.0/renode-1.17.0.windows-portable.zip",
      sha256: "18bcf145422039e8702c3e5f9864c7787561bfd5deb7a3ee6e168ecf19e2b9db",
    });
    expect(install.download["linux-x64"]).toMatchObject({
      url: "https://github.com/renode/renode/releases/download/v1.17.0/renode-1.17.0.linux-portable.tar.gz",
      sha256: "4ba7c68b59e2447f188ef4b4b112fcccd2802582c460beedceb63b84e5605a5f",
    });
    expect(m.programs["renode-sim"]).toMatchObject({
      install: { script: "scripts/renode_sim.py" },
      uses: ["renode"],
    });
    expect(readFileSync(simScript, "utf8")).toContain("dependencies = []");
    const catalog = parse(readFileSync(join(plugins, "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("renode");
    expect(catalog.metadata.renode.activities).toEqual(["testing", "firmware-analysis"]);
    const packs = parse(readFileSync(join(plugins, "packs.yaml"), "utf8"));
    const lab = packs.find((pack: { id: string }) => pack.id === "lab");
    expect(lab.groups).toContainEqual({
      name: "Virtual boards (Renode)",
      plugins: ["renode"],
      default: true,
    });
    expect(await core.checkCatalogSource(plugins)).toEqual([]);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(pluginFolder);
    const installed = await store.load("renode");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const names = (await skills.list())
      .filter((skill) => skill.plugin === "renode")
      .map((skill) => skill.name);
    expect(names).toEqual(["virtual-boards"]);
    const usage = (await skills.read("plugin", "virtual-boards")).content;
    for (const text of [
      "renode-sim validate",
      "--boot-address",
      "board-basics",
      "virtual",
      "renode/profiles",
    ])
      expect(usage).toContain(text);
  });

  it("keeps workspace.py and elf.py byte-identical with the other lab plugins", async () => {
    const own = (name: string) => readFile(join(pluginFolder, "scripts", "renode_support", name));
    expect(sha256(await own("workspace.py"))).toBe(
      sha256(await readFile(join(plugins, "gdb-debug", "scripts", "gdb_support", "workspace.py"))),
    );
    expect(sha256(await own("elf.py"))).toBe(
      sha256(await readFile(join(plugins, "gdb-debug", "scripts", "gdb_support", "elf.py"))),
    );
  });
});

describe("risk of each operation (REQ-SEC-192d9739)", () => {
  it("blocks every direct engine call and rates the helper's operations safe", () => {
    const rules = manifest().rules;
    const cases: [string, string, string[]][] = [
      ["blocked", "renode", ["--version"]],
      ["blocked", "renode", ["--console", "-e", 'python "import os"']],
      ["blocked", "renode", ["scripts/single-node/stm32f4_discovery.resc"]],
      ["safe", "renode-sim", ["tools"]],
      ["safe", "renode-sim", ["profiles"]],
      ["safe", "renode-sim", ["validate", ...FIRMWARE_ARGS, "--firmware", "app.elf"]],
      ["safe", "renode-sim", ["run", ...FIRMWARE_ARGS, "--firmware", "app.elf"]],
      ["safe", "renode-sim", ["capture-uart", ...FIRMWARE_ARGS, "--firmware", "app.elf", "--until", "x"]],
      [
        "safe",
        "renode-sim",
        ["test", ...FIRMWARE_ARGS, "--firmware", "app.elf", "--test-set", "board-basics"],
      ],
      ["safe", "renode-sim", ["report", "--run", "embedded-lab-results/x"]],
      ["device-write", "renode-sim", ["unknown-operation"]],
    ];
    for (const [expected, program, args] of cases)
      expect(classifyCommand(rules, program, args).risk, `${program} ${args.join(" ")}`).toBe(expected);
    const simulation = classifyCommand(rules, "renode-sim", ["test", "--test-set", "x"]);
    expect(simulation.timeout).toBe(3600);
    expect(simulation.notes.join(" ")).toMatch(/Host simulation.*virtual evidence, not a hardware test/);
  });
});

describe("profiles (REQ-FUNC-0000b585, REQ-SEC-1190bf53)", { timeout: 60_000 }, () => {
  it("lists the plugin profile and a workbench profile with their facts, and a refused one with its reason", async () => {
    await workbenchProfile("my-board", {});
    await workbenchProfile("bad-board", { "machine.resc": 'mach create\npython "import os"\n' });
    const run = sim(["profiles"]);
    expect(run.code).toBe(0);
    const ids = run.json.profiles.map((p: Json) => `${p.origin}:${p.id}`);
    expect(ids).toEqual([`plugin:${PROFILE}`, "workbench:my-board"]);
    expect(run.json.profiles[0]).toMatchObject({
      engine: "1.17.0",
      verification: "unverified",
      stimuli: ["console-rx", "user-button"],
      observables: ["user-led"],
    });
    const plugin = sim(["profiles", "--profile", PROFILE]).json.profiles[0];
    expect(plugin).toMatchObject({
      engine: "1.17.0",
      verification: "unverified",
      cpu: { arch: "cortex-m4", isa: "v7E-M" },
      boot: "0x08000000",
      console: "usart2",
      stimuli: { "user-button": { kind: "button" }, "console-rx": { kind: "uart-input" } },
      observables: { "user-led": { kind: "led" } },
    });
    // The profile carries its own copies of Renode's platform files, without the CPU file's SVD download.
    expect(plugin.engineFiles).toEqual({});
    expect(Object.keys(plugin.files)).toEqual([
      "profile.json",
      "platform.repl",
      "stm32f4.repl",
      "machine.resc",
    ]);
    expect(readFileSync(join(pluginFolder, "profiles", PROFILE, "stm32f4.repl"), "utf8")).not.toMatch(
      /init:|https?:/,
    );
    expect(plugin.files["profile.json"]).toBe(
      sha256(readFileSync(join(pluginFolder, "profiles", PROFILE, "profile.json"))),
    );
    expect(plugin.unsupported.length).toBeGreaterThan(0);
    expect(run.json.refused).toEqual([
      expect.objectContaining({ id: "bad-board", origin: "workbench", code: "profile-refused", line: 2 }),
    ]);
  });

  it("refuses the stock Renode script and every disallowed include, script or host binding with its line", async () => {
    const stock = readFileSync(join(fixtures, "stock", "stm32f4_discovery.resc"), "utf8");
    const repl = (text: string) => ({ "platform.repl": `using "stm32f4.repl"\n${text}\n` });
    const resc = (text: string) => ({
      "machine.resc": `using sysbus\nmach create\nmachine LoadPlatformDescription @platform.repl\n${text}\n`,
    });
    const cases: [string, Record<string, string>, RegExp][] = [
      ["stock", { "machine.resc": stock }, /line \d+/],
      ["any-using", repl('using "../../secret.repl"'), /line 2: using/],
      ["abs-using", repl('using "C:/Renode/platforms/cpus/stm32f4.repl"'), /line 2: using/],
      ["init-block", repl("sram:\n    init:\n        sysbus WriteDoubleWord 0x0 0x1"), /init blocks/],
      [
        "python",
        repl('pp: Python.PythonPeripheral @ sysbus 0x50000000\n    script: "request.value = 1"'),
        /python/i,
      ],
      ["socket", repl("term: Backends.Terminals.ServerSocketTerminal @ sysbus"), /socket|terminal|backend/i],
      ["at-path", repl("rom: Memory.MappedMemory @ /etc/passwd"), /@ file paths/],
      [
        "host-path",
        repl('flash2: MTD.SPIFlash @ sysbus\n    image: "/home/user/flash.bin"'),
        /host file paths/,
      ],
      ["backslash", repl('x: Memory.MappedMemory @ sysbus 0x0\n    name: "a\\\\b"'), /backslashes/],
      ["include", resc("include @other.resc"), /line 4/],
      ["url", resc("sysbus LoadELF @https://dl.antmicro.com/x.elf"), /line 4/],
      ["switch", resc('emulation CreateSwitch "sw"'), /line 4/],
      ["gdb", resc("machine StartGdbServer 3333"), /line 4/],
      ["analyzer", resc("showAnalyzer sysbus.usart2"), /line 4/],
      ["logfile", resc("logFile @/tmp/x.log"), /line 4/],
      ["monitor-python", resc("python \"import os; os.system('calc')\""), /line 4/],
      [
        "other-platform",
        { "machine.resc": "mach create\nmachine LoadPlatformDescription @other.repl\n" },
        /may load only/,
      ],
      // A comment marker inside a string could hide the lines after it from the validator but not from the engine.
      [
        "quoted-comment",
        repl('x: Memory.MappedMemory @ sysbus 0x0\n    name: "/*"\nusing "/etc/a.repl"\n// */'),
        /comment marker inside a string/,
      ],
    ];
    for (const [id, files] of cases) await workbenchProfile(`p-${id}`, files);
    // Malformed profile.json shapes are refusals, never a traceback that hides the other profiles.
    const shapes: [string, Json][] = [
      ["console-list", { console: ["usart2"] }],
      ["arch-list", { cpu: { arch: ["cortex-m4"], isa: "v7E-M" } }],
      ["format-true", { format: true }],
      ["stimulus-kind", { stimuli: { b: { kind: { x: 1 }, target: "sysbus.x" } } }],
    ];
    for (const [id, fields] of shapes) await workbenchProfile(`s-${id}`, {}, fields);
    await mkdir(join(root, "renode", "profiles", "s-deep"), { recursive: true });
    await writeFile(join(root, "renode", "profiles", "s-deep", "profile.json"), "[".repeat(60_000));
    const run = sim(["profiles"]);
    expect(run.json.profiles.map((p: Json) => p.id)).toEqual([PROFILE]);
    const refused = new Map(run.json.refused.map((entry: Json) => [entry.id, entry]));
    for (const [id, , reason] of cases) {
      const entry = refused.get(`p-${id}`) as Json | undefined;
      expect(entry, id).toBeDefined();
      expect(entry?.code, id).toBe("profile-refused");
      expect(entry?.reason, id).toMatch(reason);
    }
    for (const id of ["console-list", "arch-list", "format-true", "stimulus-kind", "deep"])
      expect((refused.get(`s-${id}`) as Json | undefined)?.code, id).toBe("profile-refused");
    // A refused profile never starts the engine.
    const blocked = op("run", "demo.elf", ["--virtual-budget", "0.1"]);
    expect(blocked.code).toBe(0);
    await rm(calls(), { force: true });
    const refusedRun = sim([
      "run",
      "--profile",
      "p-python",
      "--arch",
      "cortex-m4",
      "--boot-address",
      "0x08000000",
      "--firmware",
      "build/demo.elf",
    ]);
    expect(refusedRun.code).toBe(3);
    expect(refusedRun.json).toMatchObject({ status: "blocked", code: "profile-refused" });
    expect(sessions()).toEqual([]);
  });

  it("accepts ordinary words that only contain a denied word, and refuses the word in a CamelCase name", async () => {
    const repl = (text: string) => ({ "platform.repl": `using "stm32f4.repl"\n${text}\n` });
    await workbenchProfile(
      "plain-words",
      repl("emptyDescription: Memory.MappedMemory @ sysbus 0x60000000\n    size: 0x1000"),
    );
    await workbenchProfile("camel-word", repl("uartPtyBridge: Memory.MappedMemory @ sysbus 0x60000000"));
    const run = sim(["profiles"]);
    expect(run.json.profiles.map((p: Json) => p.id)).toContain("plain-words");
    expect(run.json.refused).toEqual([
      expect.objectContaining({ id: "camel-word", reason: expect.stringMatching(/'Pty' can bind/) }),
    ]);
  });

  it("refuses a profile id defined by both the plugin and the workbench", async () => {
    await workbenchProfile(PROFILE, {});
    const run = sim(["profiles"]);
    expect(run.json.refused).toContainEqual(
      expect.objectContaining({ id: PROFILE, code: "profile-duplicate" }),
    );
  });
});

describe("firmware validation (L06-C, REQ-FUNC-ebfa3d95, REQ-REL-0423211e)", { timeout: 60_000 }, () => {
  it("validates the fixture with its hash, build id, segments and vector table", () => {
    const run = sim(["validate", ...FIRMWARE_ARGS, "--firmware", "build/demo.elf"]);
    expect(run.code).toBe(0);
    const elf = readFileSync(join(firmware, "demo.elf"));
    expect(run.json.firmware).toMatchObject({
      status: "validated",
      sha256: sha256(elf),
      arch: "cortex-m4",
      isa: "v7E-M",
      bootAddress: "0x08000000",
      vectorTable: { initialSp: "0x20020000" },
    });
    expect(run.json.firmware.buildId).toMatch(/^[0-9a-f]{40}$/);
    expect(run.json.firmware.segments.map((s: Json) => s.region)).toContain("flash");
  });

  it("refuses foreign machines, other architectures, memory maps and boot addresses, never as validated", () => {
    const cases: [string, string[], string][] = [
      ["riscv.elf", FIRMWARE_ARGS, "machine"],
      ["fault-m0.elf", FIRMWARE_ARGS, "arch-mismatch"],
      ["demo-ccm.elf", FIRMWARE_ARGS, "memory-map"],
      ["notes.txt", FIRMWARE_ARGS, "elf"],
      [
        "demo.elf",
        ["--profile", PROFILE, "--arch", "cortex-m0plus", "--boot-address", "0x08000000"],
        "arch-mismatch",
      ],
      [
        "demo.elf",
        ["--profile", PROFILE, "--arch", "cortex-m4", "--boot-address", "0x00000000"],
        "boot-address",
      ],
    ];
    for (const [elf, args, code] of cases) {
      const run = sim(["validate", ...args, "--firmware", `build/${elf}`]);
      expect(run.code, elf).toBe(2);
      expect(run.json, `${elf} ${args.join(" ")}`).toMatchObject({ status: "refused", code });
      const blocked = sim(["test", ...args, "--firmware", `build/${elf}`, "--test-set", "board-basics"]);
      expect(blocked.code, elf).toBe(3);
      expect(blocked.json).toMatchObject({ status: "blocked", code });
      expect(resultOf(blocked).firmware.validation).toBe(`refused: ${code}`);
    }
    expect(sessions()).toEqual([]);
    // Missing explicit architecture or boot address: refused before anything is written.
    const missing = sim([
      "run",
      "--profile",
      PROFILE,
      "--firmware",
      "build/demo.elf",
      "--boot-address",
      "0x08000000",
    ]);
    expect(missing.code).toBe(2);
    expect(missing.json).toMatchObject({ status: "refused", code: "request" });
    expect(existsSync(join(root, "embedded-lab-results")) && missing.json.result === undefined).toBe(true);
  });

  it("refuses firmware paths outside the workbench and a results folder inside .vera with exit 2", () => {
    const outside = sim(["validate", ...FIRMWARE_ARGS, "--firmware", join(fixtures, "firmware", "demo.elf")]);
    expect(outside).toMatchObject({ code: 2, json: { code: "request" } });
    const vera = op("run", "demo.elf", ["--results-dir", ".vera/x"]);
    expect(vera).toMatchObject({ code: 2, json: { code: "request" } });
  });
});

describe("runs on the engine stand-in (offline evidence)", { timeout: 120_000 }, () => {
  it("boots the firmware headless and records its UART with virtual times (L06-A, REQ-FUNC-4bf35c2a)", () => {
    const run = op("run", "demo.elf", ["--virtual-budget", "0.35", "--run-id", "boot1"]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result).toMatchObject({
      kind: "renode-result",
      operation: "run",
      state: "done",
      status: "pass",
      runId: "boot1",
    });
    expect(result.engine).toMatchObject({ version: "1.17.0" });
    expect(result.uart.lines.slice(0, 2)).toEqual([
      { t: 0.01, text: "VERA-FW renode-demo" },
      { t: 0.01, text: "version 1.2.3" },
    ]);
    expect(result.uart.lines.filter((l: Json) => l.text.startsWith("TICK")).map((l: Json) => l.t)).toEqual([
      0.1, 0.2, 0.3,
    ]);
    const folder = folderOf(run);
    expect(sha256(readFileSync(join(folder, "firmware.elf")))).toBe(result.firmware.sha256);
    for (const name of [
      "engine.log",
      "monitor.log",
      "uart-usart2.log",
      "profile/profile.json",
      "profile/platform.repl",
      "profile/machine.resc",
    ])
      expect(existsSync(join(folder, name)), name).toBe(true);
    expect(result.artifacts["firmware.elf"]).toBe(result.firmware.sha256);
    expectNoEngineLeft();
  });

  it("starts the engine with fixed headless options and only templated commands on run-folder files (L06-D, REQ-SEC-01fae096)", () => {
    const run = test("demo.elf", ["--run-id", "cmds"]);
    expect(run.code).toBe(0);
    const folder = join(root, "embedded-lab-results", "cmds").replaceAll("\\", "/");
    expect(sessions().map((s) => s.argv)).toEqual([
      ["--disable-gui", "--console", "--plain", "--hide-log", "--config", `${folder}/renode.config`],
    ]);
    const allowed = [
      new RegExp(`^logFile @${folder}/engine\\.log true$`),
      /^using sysbus$/,
      new RegExp(`^mach create "${PROFILE}"$`),
      new RegExp(`^machine LoadPlatformDescription @${folder}/profile/platform\\.repl$`),
      /^sysbus\.cpu PerformanceInMips 125$/,
      new RegExp(`^sysbus LoadELF @${folder}/firmware\\.elf$`),
      /^sysbus\.cpu VectorTableOffset 0x08000000$/,
      new RegExp(`^sysbus\\.usart2 CreateFileBackend @${folder}/uart-usart2\\.[0-9]{5}\\.part true$`),
      new RegExp(`^sysbus\\.usart2 CloseFileBackend @${folder}/uart-usart2\\.[0-9]{5}\\.part$`),
      /^emulation RunFor "00:00:00\.010000"$/,
      /^sysbus\.usart2 WriteChar 0x[0-9a-f]{2}$/,
      /^sysbus\.gpioPortA\.UserButton (?:Press|Release)$/,
      /^sysbus\.gpioPortD\.UserLED State$/,
      /^emulation GetTimeSourceInfo$/,
      /^quit$/,
    ];
    const sent = commands();
    expect(sent.length).toBeGreaterThan(50);
    for (const command of sent)
      expect(
        allowed.some((pattern) => pattern.test(command)),
        command,
      ).toBe(true);
    expect(sent.join("\n")).not.toMatch(/https?:|python|include|Socket|Gdb|Tap|Switch|Pty/i);
  });

  it("captures the UART until a pattern, or reports a virtual timeout (REQ-FUNC-cea31393)", () => {
    const hit = op("capture-uart", "demo.elf", ["--until", "^version (\\d+\\.\\d+\\.\\d+)$"]);
    expect(hit.code).toBe(0);
    expect(resultOf(hit).capture).toMatchObject({ status: "pass" });
    expect(resultOf(hit).capture.detail).toContain("version 1.2.3");
    const miss = op("capture-uart", "demo.elf", ["--until", "^NEVER$", "--virtual-budget", "0.5"]);
    expect(miss.code).toBe(1);
    const result = resultOf(miss);
    expect(result).toMatchObject({ status: "timeout", code: "virtual-timeout" });
    expect(result.time.virtualSeconds).toBe(0.5);
  });

  it("runs the approved test set with declared stimuli and observables (L06-B, REQ-FUNC-d89b80fd)", () => {
    const run = test("demo.elf", ["--run-id", "basics"]);
    expect(run.code).toBe(0);
    const result = resultOf(run);
    expect(result.cases.map((c: Json) => [c.id, c.requirement, c.status])).toEqual([
      ["boot-version", "FW-BOOT", "pass"],
      ["uart-rx", "FW-UART-ECHO", "pass"],
      ["timer", "FW-TIMER-10HZ", "pass"],
      ["button-led", "FW-BUTTON-LED", "pass"],
    ]);
    const timer = result.cases[2];
    expect(timer.steps[1].detail).toMatch(/^10 lines matched/);
    expect(result.testSet).toMatchObject({
      id: "board-basics",
      origin: "plugin",
      params: { version: "1.2.3", ticks: "10" },
    });
    expect(readFileSync(join(folderOf(run), "junit.xml"), "utf8")).toContain(
      '<testsuite name="board-basics" tests="4"',
    );
    expect(sha256(readFileSync(join(folderOf(run), "testset.json")))).toBe(result.testSet.sha256);
    // A parameter changes the expectation: version 2.0.0 fails as an assertion.
    const other = test("demo.elf", ["--param", "version=2.0.0"]);
    expect(other.json).toMatchObject({ status: "fail", code: "assertion" });
    expect(test("demo.elf", ["--param", "version=x;y"]).json).toMatchObject({
      status: "refused",
      code: "param",
    });
    // An LED that never lights is a wrong value: an assertion, not a timeout.
    const stuck = test("demo.elf", [], scenario({ ledStuck: true }));
    expect(resultOf(stuck).cases.at(-1)).toMatchObject({
      id: "button-led",
      status: "fail",
      code: "assertion",
    });
  });

  it("checks stimulus text after parameters are inserted", async () => {
    const folder = join(root, "renode", "tests", "loose");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "testset.json"),
      JSON.stringify({
        format: 1,
        id: "loose",
        title: "x",
        profiles: [PROFILE],
        params: { word: { default: "ping", regex: ".*" } },
        cases: [
          {
            id: "a",
            requirement: "R1",
            hil: [],
            budget: 1,
            // biome-ignore lint/suspicious/noTemplateCurlyInString: a test-set parameter reference, sent literally.
            steps: [{ do: "stimulus", name: "console-rx", text: "${word}\r" }],
          },
        ],
      }),
    );
    expect(op("test", "demo.elf", ["--test-set", "loose"]).json).toMatchObject({ status: "pass" });
    for (const word of ["päng", "x".repeat(80), "a\u0007b"]) {
      const run = op("test", "demo.elf", ["--test-set", "loose", "--param", `word=${word}`]);
      expect(run.json, word).toMatchObject({ status: "blocked", code: "testset" });
    }
  });

  it("refuses a workbench test set with an undeclared stimulus before the engine starts", async () => {
    const folder = join(root, "renode", "tests", "mine");
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, "testset.json"),
      JSON.stringify({
        format: 1,
        id: "mine",
        title: "x",
        profiles: [PROFILE],
        params: {},
        cases: [
          {
            id: "a",
            requirement: "R1",
            hil: [],
            budget: 1,
            steps: [{ do: "stimulus", name: "usb-plug", action: "press" }],
          },
        ],
      }),
    );
    const run = op("test", "demo.elf", ["--test-set", "mine"]);
    expect(run.json).toMatchObject({ status: "blocked", code: "testset" });
    expect(run.json.reason).toContain("usb-plug");
    expect(sessions()).toEqual([]);
  });

  it("repeats a test with the same statuses, lines and virtual times (REQ-REL-a663fd2d)", () => {
    const view = (result: Json) => ({
      cases: result.cases.map((c: Json) => ({
        id: c.id,
        status: c.status,
        v: c.virtualSeconds,
        steps: c.steps.map((s: Json) => [s.status, s.virtual, s.detail]),
      })),
      lines: result.uart.lines,
      virtual: result.time.virtualSeconds,
    });
    const first = view(resultOf(test("demo.elf", ["--run-id", "rep1"])));
    const second = view(resultOf(test("demo.elf", ["--run-id", "rep2"])));
    expect(second).toEqual(first);
  });

  it("marks unmodeled peripheral accesses incomplete with the address, never pass (L06-C, REQ-REL-b66cb484)", () => {
    const run = test("demo-unmodeled.elf");
    expect(run.code).toBe(3);
    const result = resultOf(run);
    expect(result).toMatchObject({ status: "incomplete", code: "unmodeled-peripheral" });
    expect(result.unmodeled).toEqual([
      expect.objectContaining({ address: "0x40007400", access: "write", width: "DoubleWord", count: 1 }),
    ]);
    expect(result.cases[0]).toMatchObject({
      id: "boot-version",
      status: "incomplete",
      code: "unmodeled-peripheral",
    });
    expect(resultOf(test("demo.elf")).unmodeled).toEqual([]);
  });

  it("reports an assertion failure, a virtual timeout and a real timeout distinctly (L06-E, REQ-REL-884979c1)", () => {
    const fail = test("demo-wrong-version.elf", ["--run-id", "fail1"]);
    expect(fail.code).toBe(1);
    expect(resultOf(fail)).toMatchObject({ status: "fail", code: "assertion" });
    expect(resultOf(fail).cases[0].reason).toContain("version 9.9.9");
    const silent = test("demo-silent.elf", ["--run-id", "silent1"]);
    expect(silent.code).toBe(1);
    expect(resultOf(silent)).toMatchObject({ status: "timeout", code: "virtual-timeout" });
    expect(resultOf(silent).cases[0].virtualSeconds).toBe(0.2);
    const started = Date.now();
    const hung = test(
      "demo.elf",
      ["--real-timeout", "3", "--run-id", "hung1"],
      scenario({ hangAt: 0.3, spawnChild: true }),
    );
    expect(Date.now() - started).toBeLessThan(30_000);
    expect(hung.code).toBe(1);
    const result = resultOf(hung);
    expect(result).toMatchObject({ status: "timeout", code: "real-timeout", state: "done" });
    expect(result.cases.at(-1)).toMatchObject({ status: "incomplete", code: "not-run" });
    expectNoEngineLeft();
    for (const id of ["fail1", "silent1", "hung1"]) {
      const report = sim(["report", "--run", `embedded-lab-results/${id}`]);
      expect(report.code).toBe(1);
    }
    const junit = (id: string) => readFileSync(join(root, "embedded-lab-results", id, "junit.xml"), "utf8");
    expect(junit("fail1")).toContain("<failure message=");
    expect(junit("silent1")).toContain('<error message="timeout');
    expect(junit("hung1")).toContain("real-time budget");
  });

  it("reports engine failures as errors or blocked runs with a result (REQ-DATA-8a943977)", async () => {
    const crash = test("demo.elf", [], scenario({ crashAt: 0.2 }));
    expect(crash.code).toBe(3);
    expect(resultOf(crash)).toMatchObject({ status: "error", code: "engine" });
    const version = test("demo.elf", [], scenario({ version: "Renode v1.16.1.0" }));
    expect(version.json).toMatchObject({ status: "blocked", code: "engine-version" });
    const noVersion = test("demo.elf", [], scenario({ badVersionCommand: true }));
    expect(noVersion.json).toMatchObject({ status: "blocked", code: "engine" });
    const missing = test("demo.elf", [], { VERA_PROGRAM_RENODE: "" });
    expect(missing.json).toMatchObject({ status: "blocked", code: "engine-missing" });
    // Setup failures are errors whatever the engine's wording: an answer to a setup command, an [ERROR] log line.
    const load = test("demo.elf", [], scenario({ loadFails: true }));
    expect(resultOf(load)).toMatchObject({ status: "error", code: "engine" });
    expect(resultOf(load).reason).toContain("LoadELF");
    expect(resultOf(load).cases.map((c: Json) => c.code)).toEqual([
      "not-run",
      "not-run",
      "not-run",
      "not-run",
    ]);
    const logged = test("demo.elf", [], scenario({ logError: true }));
    expect(resultOf(logged)).toMatchObject({ status: "error", code: "engine" });
    expect(resultOf(logged).reason).toContain("CPU abort");
    // The start check: the logged initial PC and SP must be the validated vector table.
    const wrongStart = test("demo.elf", [], scenario({ badInitial: true }));
    expect(resultOf(wrongStart)).toMatchObject({ status: "error", code: "engine" });
    expect(resultOf(wrongStart).reason).toContain("not the validated vector table");
    const noStart = op("run", "demo.elf", ["--virtual-budget", "0.05"], scenario({ noInitial: true }));
    expect(resultOf(noStart)).toMatchObject({ status: "error", code: "engine" });
    expect(resultOf(noStart).reason).toContain("does not show the firmware starting");
    // A blocked run writes its JUnit view too.
    const blocked = test("demo.elf", [], scenario({ version: "Renode v1.16.1.0" }));
    expect(readFileSync(join(folderOf(blocked), "junit.xml"), "utf8")).toContain(
      '<property name="status" value="blocked"/>',
    );
    // A crash mid-test keeps every case: the remaining ones are not run.
    expect(resultOf(crash).cases.at(-1)).toMatchObject({ status: "incomplete", code: "not-run" });
    const ignored = test("demo.elf", [], scenario({ ignoreQuit: true }));
    expect(ignored.code).toBe(0);
    expectNoEngineLeft();
  });

  it("checks the engine's own platform files: hashes, and no download or monitor command hidden in them (L06-H)", async () => {
    const hashOf = (name: string) => sha256(readFileSync(join(fixtures, "engine", name)));
    const engineFiles = {
      "platforms/boards/stm32f4_discovery.repl": hashOf("platforms/boards/stm32f4_discovery.repl"),
      "platforms/cpus/stm32f4.repl": hashOf("platforms/cpus/stm32f4.repl"),
    };
    // Renode 1.17.0's own CPU file downloads an SVD file in an init block: a profile using it is blocked.
    await workbenchProfile(
      "vendor",
      { "platform.repl": 'using "platforms/boards/stm32f4_discovery.repl"\n' },
      { engineFiles },
    );
    const vendor = sim([
      "run",
      ...FIRMWARE_ARGS.map((a) => (a === PROFILE ? "vendor" : a)),
      "--firmware",
      "build/demo.elf",
    ]);
    expect(vendor.json).toMatchObject({ status: "blocked", code: "engine-files" });
    expect(vendor.json.reason).toMatch(
      /platforms\/cpus\/stm32f4\.repl line \d+ runs monitor commands or downloads/,
    );
    // A hash that differs from the engine's file blocks as well, before anything starts.
    await workbenchProfile(
      "changed",
      { "platform.repl": 'using "platforms/boards/stm32f4_discovery.repl"\n' },
      {
        engineFiles: { ...engineFiles, "platforms/boards/stm32f4_discovery.repl": "0".repeat(64) },
      },
    );
    const changed = sim([
      "run",
      ...FIRMWARE_ARGS.map((a) => (a === PROFILE ? "changed" : a)),
      "--firmware",
      "build/demo.elf",
    ]);
    expect(changed.json).toMatchObject({ status: "blocked", code: "engine-files" });
    expect(sessions()).toEqual([]);
  });

  it("reports the engine without simulating, and a missing engine as blocked (REQ-FUNC-70f62b22)", () => {
    const tools = sim(["tools"]);
    expect(tools.code).toBe(0);
    expect(tools.json).toMatchObject({ status: "pass", engine: { version: "1.17.0", path: engine } });
    expect(tools.json.engine.platforms).toBe(join(engineFolder, "platforms"));
    expect(sessions()).toEqual([]);
    expect(sim(["tools"], { VERA_PROGRAM_RENODE: "" })).toMatchObject({
      code: 3,
      json: { code: "engine-missing" },
    });
  });

  it("passes only paths the monitor can take: spaces use the short form or block the run", async () => {
    const run = op("run", "demo.elf", [
      "--virtual-budget",
      "0.05",
      "--results-dir",
      "results with space",
      "--run-id",
      "sp",
    ]);
    if (run.json.status === "blocked") expect(run.json.code).toBe("run-path");
    else expect(run.json.status).toBe("pass");
    // Every @path token is one word: nothing follows it but the end of the command or CreateFileBackend's flag.
    for (const command of commands()) expect(command, command).not.toMatch(/@\S*\s(?!true$)/);
  });

  it("keeps virtual and real time apart and says what a simulation does not show (L06-F, REQ-FUNC-9431b520)", () => {
    const result = resultOf(test("demo.elf", ["--real-timeout", "120"]));
    expect(result.budgets).toEqual({ virtualSeconds: 4, realSeconds: 120 });
    expect(result.time.virtualSeconds).toBeGreaterThan(1);
    expect(result.time.engineVirtual).toBeCloseTo(result.time.virtualSeconds, 6);
    expect(result.time.realSeconds).toBeGreaterThan(0);
    expect(result.time.realSeconds).not.toBe(result.time.virtualSeconds);
    for (const c of result.cases)
      expect(Object.keys(c)).toEqual(expect.arrayContaining(["virtualSeconds", "realSeconds"]));
    expect(result.coverage.evidence).toBe("virtual");
    expect(result.coverage.statement).toMatch(/neither is physical timing.*no power consumption/);
    expect(result.coverage.notCovered.join("\n")).toMatch(
      /electrical timing[\s\S]*power consumption[\s\S]*EMI[\s\S]*SPICE/,
    );
  });
});

describe("report (L06-G, REQ-FUNC-ea40de9f, REQ-FUNC-31a21cb5)", { timeout: 120_000 }, () => {
  it("writes report.md, report.html and junit.xml naming what was simulated and what is not covered", () => {
    const run = test("demo.elf", ["--run-id", "rep"]);
    const report = sim(["report", "--run", "embedded-lab-results/rep"]);
    expect(report.code).toBe(0);
    expect(report.json.files.map((f: string) => f.split("/").at(-1))).toEqual([
      "report.md",
      "report.html",
      "junit.xml",
    ]);
    const folder = folderOf(run);
    const md = readFileSync(join(folder, "report.md"), "utf8");
    const result = resultOf(run);
    for (const text of [
      result.firmware.sha256,
      result.firmware.buildId,
      result.profile.sha256,
      "Renode v1.17.0",
      "Evidence: **virtual**",
      "EMI",
      "SPICE",
      "platforms/cpus/stm32f4.repl",
    ])
      expect(md).toContain(text);
    const junit = readFileSync(join(folder, "junit.xml"), "utf8");
    expect(junit).toContain('<testsuite name="board-basics" tests="4" failures="0" errors="0" skipped="0"');
    expect(junit).toContain('<property name="evidence" value="virtual"/>');
    expect(junit).toContain('<property name="runId" value="rep"/>');
    expect(junit).toContain('<property name="requirement" value="FW-TIMER-10HZ"/>');
    expect(readFileSync(join(folder, "report.html"), "utf8")).toContain("<!doctype html>");
  });

  it("lines up requirements with a HIL run in separate virtual and hardware columns", async () => {
    test("demo.elf", ["--run-id", "virt"]);
    const hil = join(root, "embedded-lab-results", "hil1");
    await mkdir(hil, { recursive: true });
    await writeFile(
      join(hil, "result.json"),
      JSON.stringify({
        format: 1,
        kind: "hil-test-result",
        runId: "hil1",
        state: "done",
        status: "fail",
        steps: [
          { id: "boot-banner", status: "pass" },
          { id: "tick-rate", status: "fail" },
        ],
      }),
    );
    const report = sim([
      "report",
      "--run",
      "embedded-lab-results/virt",
      "--hil",
      "embedded-lab-results/hil1",
    ]);
    expect(report.code).toBe(0);
    expect(report.json.comparison).toEqual([
      { requirement: "FW-BOOT", virtual: ["boot-version: pass"], hardware: ["boot-banner: pass"] },
      {
        requirement: "FW-UART-ECHO",
        virtual: ["uart-rx: pass"],
        hardware: ["uart-echo: not in the HIL run"],
      },
      { requirement: "FW-TIMER-10HZ", virtual: ["timer: pass"], hardware: ["tick-rate: fail"] },
      {
        requirement: "FW-BUTTON-LED",
        virtual: ["button-led: pass"],
        hardware: ["button-led: not in the HIL run"],
      },
    ]);
    const md = readFileSync(join(root, "embedded-lab-results", "virt", "report.md"), "utf8");
    expect(md).toContain("| Requirement | Virtual (simulation) | Hardware (HIL) |");
    expect(md).toContain("only the hardware column is evidence from the board");
    const wrong = sim(["report", "--run", "embedded-lab-results/virt", "--hil", "embedded-lab-results/virt"]);
    expect(wrong).toMatchObject({ code: 2, json: { code: "request" } });
  });
});

describe("VERA's runner stopping a run (real processes, stand-in engine, L06-E, REQ-REL-c7579edf)", {
  timeout: 120_000,
}, () => {
  it("leaves no engine process and an identified partial result that report completes as stopped", async () => {
    configure({ hangAt: 0.5, spawnChild: true });
    const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
    try {
      const run = await runner.start({
        sessionId: "s1",
        workbench: root,
        executable: python,
        args: [
          simScript,
          "test",
          ...FIRMWARE_ARGS,
          "--firmware",
          "build/demo.elf",
          "--test-set",
          "board-basics",
          "--run-id",
          "stop1",
        ],
        env: { PYTHONDONTWRITEBYTECODE: "1", VERA_PROGRAM_RENODE: engine },
        background: true,
      });
      const resultPath = join(root, "embedded-lab-results", "stop1", "result.json");
      for (let i = 0; i < 400; i++) {
        if (existsSync(resultPath) && JSON.parse(readFileSync(resultPath, "utf8")).cases?.length >= 3) break;
        await sleep(50);
      }
      await sleep(500);
      const stopped = await run.stop();
      expect(stopped).toMatchObject({ stopped: true });
      for (let i = 0; i < 100 && entries().some((e) => [e.pid, e.child].filter(Boolean).some(alive)); i++)
        await sleep(100);
      expectNoEngineLeft();
      const partial = JSON.parse(await readFile(resultPath, "utf8"));
      expect(partial).toMatchObject({
        state: "running",
        runId: "stop1",
        firmware: { sha256: sha256(readFileSync(join(firmware, "demo.elf"))) },
      });
      expect(partial.cases.slice(0, 2).map((c: Json) => c.status)).toEqual(["pass", "pass"]);
      // A recent heartbeat means the run may still be going: report refuses.
      const early = sim(["report", "--run", "embedded-lab-results/stop1"]);
      if (early.code === 2) expect(early.json.code).toBe("running");
      partial.heartbeat = "2026-01-01T00:00:00.000Z";
      await writeFile(resultPath, JSON.stringify(partial));
      const report = sim(["report", "--run", "embedded-lab-results/stop1"]);
      expect(report.code).toBe(3);
      const done = JSON.parse(await readFile(resultPath, "utf8"));
      expect(done).toMatchObject({ state: "done", status: "stopped", code: "interrupted" });
      expect(done.cases.find((c: Json) => c.status === "stopped")).toMatchObject({
        id: "timer",
        code: "interrupted",
      });
      expect(readFileSync(join(root, "embedded-lab-results", "stop1", "report.md"), "utf8")).toContain(
        "stopped",
      );
    } finally {
      await runner.stopAll();
    }
  });
});

const realEngine = process.env.VERA_RENODE_REAL ?? "";
reportSkip(!realEngine, "the real Renode tests", "set VERA_RENODE_REAL to a Renode 1.17.0 executable");

describe.skipIf(!realEngine)("the real Renode 1.17.0 (opt-in VERA_RENODE_REAL)", { timeout: 600_000 }, () => {
  const real = (args: string[]) => {
    const result = spawnSync(python, [simScript, ...args], {
      cwd: root,
      env: environment({ VERA_PROGRAM_RENODE: realEngine }),
      encoding: "utf8",
      timeout: 600_000,
    });
    expect([0, 1, 2, 3], result.stderr).toContain(result.status);
    return {
      code: result.status,
      json: JSON.parse((result.stdout ?? "").trim().split("\n").at(-1) ?? "{}"),
    } as Run;
  };

  it("reports Renode 1.17.0 and finds the profile's platform files unchanged (L06-H)", () => {
    const tools = real(["tools"]);
    expect(tools.json).toMatchObject({ status: "pass", engine: { version: "1.17.0" } });
    const engineRoot = dirname(tools.json.engine.platforms);
    // The profile's copies are the engine's own files with exactly the two documented edits.
    const lines = (path: string) => readFileSync(path, "utf8").replaceAll("\r\n", "\n").split("\n");
    const own = (name: string) => join(pluginFolder, "profiles", PROFILE, name);
    const cpu = lines(join(engineRoot, "platforms", "cpus", "stm32f4.repl"));
    const init = cpu.findIndex((line) => line === "sysbus:");
    expect(cpu[init + 2]).toContain("ApplySVD @https://dl.antmicro.com/");
    const code = (text: string[]) =>
      text
        .filter((line) => !line.startsWith("//"))
        .join("\n")
        .trim();
    expect(code(lines(own("stm32f4.repl")))).toBe(code(cpu.slice(0, init)));
    const board = lines(join(engineRoot, "platforms", "boards", "stm32f4_discovery.repl"));
    expect(code(lines(own("platform.repl")))).toBe(
      code(board).replace('using "platforms/cpus/stm32f4.repl"', 'using "stm32f4.repl"'),
    );
  });

  it("boots the fixture and passes board-basics twice with equal virtual results (L06-A, L06-B)", () => {
    const first = real([
      "test",
      ...FIRMWARE_ARGS,
      "--firmware",
      "build/demo.elf",
      "--test-set",
      "board-basics",
      "--run-id",
      "real1",
    ]);
    expect(first.code, JSON.stringify(first.json)).toBe(0);
    const second = real([
      "test",
      ...FIRMWARE_ARGS,
      "--firmware",
      "build/demo.elf",
      "--test-set",
      "board-basics",
      "--run-id",
      "real2",
    ]);
    expect(second.code).toBe(0);
    const view = (result: Json) => ({
      cases: result.cases.map((c: Json) => [c.id, c.status, c.steps.map((s: Json) => [s.status, s.virtual])]),
      lines: result.uart.lines,
    });
    const a = resultOf({ ...first, json: { result: "embedded-lab-results/real1/result.json" } } as Run);
    const b = resultOf({ ...second, json: { result: "embedded-lab-results/real2/result.json" } } as Run);
    expect(view(b)).toEqual(view(a));
    expect(a.uart.lines.slice(0, 2).map((l: Json) => l.text)).toEqual([
      "VERA-FW renode-demo",
      "version 1.2.3",
    ]);
    expect(a.unmodeled).toEqual([]);
    // Offline: the profile's own platform files trigger no download (the vendor CPU file's ApplySVD would).
    const log = readFileSync(join(root, "embedded-lab-results", "real1", "engine.log"), "utf8");
    expect(log).toContain("Setting initial values: PC = 0x80000F1, SP = 0x20020000");
    expect(log).not.toMatch(/Download|https?:\/\//i);
  });

  it("reports the wrong version as a failure, silence as a virtual timeout and the DAC as unmodeled (L06-C, L06-E)", () => {
    expect(
      real([
        "test",
        ...FIRMWARE_ARGS,
        "--firmware",
        "build/demo-wrong-version.elf",
        "--test-set",
        "board-basics",
      ]).json,
    ).toMatchObject({ status: "fail", code: "assertion" });
    expect(
      real(["test", ...FIRMWARE_ARGS, "--firmware", "build/demo-silent.elf", "--test-set", "board-basics"])
        .json,
    ).toMatchObject({ status: "timeout", code: "virtual-timeout" });
    const unmodeled = real([
      "run",
      ...FIRMWARE_ARGS,
      "--firmware",
      "build/demo-unmodeled.elf",
      "--virtual-budget",
      "0.2",
    ]);
    expect(unmodeled.json).toMatchObject({ status: "incomplete", code: "unmodeled-peripheral" });
    expect(unmodeled.json.unmodeled).toContainEqual(
      expect.objectContaining({ address: "0x40007400", access: "write" }),
    );
  });

  it("listens on no socket while it runs and leaves no process (L06-D)", async () => {
    // VERA's runner starts a helper in its own process group on POSIX and kills that group (or the tree on Windows).
    const child = spawn(
      python,
      [
        simScript,
        "run",
        ...FIRMWARE_ARGS,
        "--firmware",
        "build/demo.elf",
        "--virtual-budget",
        "30",
        "--run-id",
        "sock",
      ],
      {
        cwd: root,
        env: environment({ VERA_PROGRAM_RENODE: realEngine }),
        detached: !windows,
      },
    );
    const resultPath = join(root, "embedded-lab-results", "sock", "result.json");
    let pid = 0;
    for (let i = 0; i < 600 && !pid; i++) {
      await sleep(100);
      if (existsSync(resultPath)) pid = JSON.parse(readFileSync(resultPath, "utf8")).engine?.pid ?? 0;
    }
    expect(pid).toBeGreaterThan(0);
    await sleep(2000);
    const listening = windows
      ? spawnSync(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `@(Get-NetTCPConnection -OwningProcess ${pid} -ErrorAction SilentlyContinue).Count; @(Get-NetUDPEndpoint -OwningProcess ${pid} -ErrorAction SilentlyContinue).Count`,
          ],
          { encoding: "utf8" },
        )
          .stdout.trim()
          .split(/\s+/)
      : [
          spawnSync("sh", ["-c", `ss -H -tuap 2>/dev/null | grep -c "pid=${pid},"`], {
            encoding: "utf8",
          }).stdout.trim(),
        ];
    expect(listening.map(Number)).toEqual(listening.map(() => 0));
    // VERA's Stop: the helper's process tree (Windows) or process group (POSIX); the engine is part of it.
    const exited = new Promise((done) => child.on("exit", done));
    if (windows) spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"]);
    else process.kill(-(child.pid as number), "SIGKILL");
    await exited;
    for (let i = 0; i < 50 && alive(pid); i++) await sleep(100);
    expect(alive(pid)).toBe(false);
  });
});
