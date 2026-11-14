// The hil-testing plugin without a board: VERA's real runner (NodeProcessHost) runs a HIL plan whose operations are the
// real helpers of serial-monitor (fake pyserial), scpi-instruments (fake PyVISA, simulated DS1104Z), lab-validation and
// hil-testing, and a deterministic probe-rs stand-in (tests/fixtures/probe-rs/replay.mjs). Offline and real-process
// evidence of the orchestration, the reservations, the stop and the report - never of a real board, probe or
// instrument (spec REQ-DATA-5f714098).
// REQ-DATA-5f714098 REQ-FUNC-1a55eab5 REQ-DATA-07b67f33 REQ-REL-bddb3f0a REQ-FUNC-7ba90d50 REQ-FUNC-08e50f9f
// REQ-PLAT-759e6df8
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = fileURLToPath(new URL("../../", import.meta.url));
const plugins = join(software, "plugins");
const fixtures = join(software, "tests", "fixtures");
const windows = process.platform === "win32";
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
type Json = Record<string, unknown>;

const SCOPE = "TCPIP0::10.0.0.5::INSTR";
const FIRMWARE = "\u007fELF fixture image (not a real firmware)";
const target = { probe: "0483:374b:FIXTURE", chip: "STM32F401RETx" };
const SCRIPTS: Record<string, string> = {
  serial: join(plugins, "serial-monitor", "scripts", "serial_monitor.py"),
  scpi: join(plugins, "scpi-instruments", "scripts", "scpi_tool.py"),
  "lab-validate": join(plugins, "lab-validation", "scripts", "lab_validate.py"),
  hil: join(plugins, "hil-testing", "scripts", "hil_tool.py"),
};

function load(id: string): core.LoadedPlugin {
  const checked = validatePluginManifest(parse(readFileSync(join(plugins, id, "plugin.yaml"), "utf8")));
  if (!checked.manifest) throw Error(`${id}: ${JSON.stringify(checked.issues)}`);
  const manifest: PluginManifest = checked.manifest;
  return {
    folder: join(plugins, id),
    manifest,
    record: {
      format: 1,
      id,
      version: manifest.version,
      tier: "official",
      source: { kind: "folder", path: join(plugins, id) },
      sha256: sha(id),
      installedAt: "2026-11-14T00:00:00.000Z",
      programs: Object.fromEntries(Object.keys(manifest.programs).map((name) => [name, manifest.version])),
    },
  } as core.LoadedPlugin;
}

let root = "";
let runner: core.ProgramRunner;
let session: core.ProgramSession;
let approved: core.ProgramChangeRequest | undefined;
let ctx: Parameters<NonNullable<typeof core.runProgramTool.prepare>>[0];
let enabled: core.LoadedPlugin[];

beforeAll(() => {
  // The helpers must not leave bytecode caches in the plugin folders VERA hashes.
  process.env.PYTHONDONTWRITEBYTECODE = "1";
});
beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-hil-int-")));
  for (const folder of [".vera", "lab", "hil", "build"]) await mkdir(join(root, folder));
  await writeFile(join(root, "build", "app.elf"), FIRMWARE);
  await writeFile(
    join(root, "lab", "resources.json"),
    JSON.stringify({
      format: 1,
      resources: [{ alias: "scope", kind: "visa", resource: SCOPE, profile: "rigol-ds1000z" }],
    }),
  );
  await writeFile(
    join(root, "bench.json"),
    JSON.stringify({
      resources: {
        [SCOPE]: { model: "ds1104z", idn: "RIGOL TECHNOLOGIES,DS1104Z,DS1ZA1,00.04.04.SP4", faults: {} },
      },
    }),
  );
  await serialScenario(["boot\r\n", "READY\r\n", "pong\r\n"]);
  enabled = ["probe-rs", "serial-monitor", "scpi-instruments", "lab-validation", "hil-testing"].map(load);
  const leases = new core.ResourceLeases({ root: join(root, "leases"), app: "test" });
  runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep }, leases });
  session = new core.ProgramSession();
  approved = undefined;
  const resolver: core.ProgramResolver = {
    resolve: async (_plugin, program) => {
      if (program === "probe-rs")
        return { executable: process.execPath, prefix: [join(fixtures, "probe-rs", "replay.mjs")] };
      const script = SCRIPTS[program];
      if (!script) return undefined;
      return {
        executable: python,
        prefix: [script],
        env: {
          PYTHONDONTWRITEBYTECODE: "1",
          PYTHONPATH:
            program === "serial"
              ? join(fixtures, "serial-monitor", "fake-pyserial")
              : join(fixtures, "scpi-instruments", "fake-pyvisa"),
          FAKE_SERIAL_SCENARIO: join(root, "serial.json"),
          FAKE_VISA_BENCH: join(root, "bench.json"),
          FAKE_VISA_STATE: join(root, "fake-state.json"),
        },
      };
    },
  };
  ctx = {
    root,
    lastReads: new Map(),
    permissionMode: () => "ask",
    programs: {
      host: { runner, clock: { sleep }, plugins: async () => enabled, resolver },
      session,
      sessionId: "ses_int",
      turnId: "turn_1",
      callId: "call_1",
      consume: (request) => {
        if (
          request.risk !== "safe" &&
          (!approved || core.requestSha256(request) !== core.requestSha256(approved))
        )
          throw { code: "CONFLICT" };
      },
    },
  } as typeof ctx;
});
afterEach(async () => {
  await runner.stopAll();
  await rm(root, { recursive: true, force: true }).catch(() => {});
});

const serialScenario = (chunks: string[]) => writeFile(join(root, "serial.json"), JSON.stringify({ chunks }));
const validation = (frequency: string) => ({
  format: 1,
  title: "Scope CH1 frequency",
  decisionRule: "simple",
  missingData: "incomplete",
  sources: { scope: { importer: "scpi-capture", step: "cap", bandwidth: "100 MHz" } },
  signals: { ch1: { source: "scope", channel: "CHAN1" } },
  measurements: [{ id: "f", signal: "ch1", metric: "frequency", window: { from: "-590 us", to: "590 us" } }],
  criteria: [{ id: "C1", value: "f", op: "==", limit: frequency, tolerance: "1 %" }],
});
const plan = (fields: Json = {}) => ({
  format: 1,
  id: "fixture-smoke",
  title: "Fixture smoke test (no board)",
  setup: {
    board: "NUCLEO-F401RE (simulated by fixtures)",
    revision: "fixture",
    description: "probe-rs replay stand-in, fake pyserial on COM5, fake PyVISA DS1104Z as scope",
    wiring: ["scope CH1 -> PA5 (simulated)"],
    firmwareEffect: "device-read",
    effectNote: "Fixture firmware: prints READY and answers pong.",
  },
  firmware: { path: "build/app.elf", sha256: sha(FIRMWARE), format: "elf" },
  budget: { seconds: 120 },
  steps: [
    { id: "probe", phase: "setup", use: "probe-rs.list", expect: "0483:374b:FIXTURE" },
    { id: "flash", phase: "setup", use: "probe-rs.flash", with: target },
    { id: "verify", phase: "setup", use: "probe-rs.verify", with: target },
    {
      id: "boot-log",
      use: "serial.capture",
      background: true,
      with: { port: "COM5", baud: 115200, duration: 10, until: "^READY" },
    },
    { id: "reset", use: "probe-rs.reset", with: target },
    { id: "boot", use: "await", with: { step: "boot-log" } },
    {
      id: "ping",
      use: "serial.send",
      retries: 1,
      with: { port: "COM5", baud: 115200, text: "ping", until: "^pong", duration: 5 },
    },
    { id: "cap", use: "scpi.capture", with: { instrument: "scope", channel: "CHAN1" } },
    { id: "freq", use: "lab-validate.compare", with: { request: validation("10 kHz") } },
  ],
  cleanup: [{ id: "halt", use: "probe-rs.reset", with: target }],
  ...fields,
});
async function run(value: Json, background = false) {
  await writeFile(join(root, "hil", "plan.json"), JSON.stringify(value, null, 1));
  const prepared = await core.runProgramTool.prepare?.(
    ctx,
    { program: "hil", args: ["run", "hil/plan.json"], ...(background ? { background } : {}) },
    new AbortController().signal,
  );
  if (!prepared) throw Error("no prepare");
  approved = prepared.request as core.ProgramChangeRequest;
  return prepared.apply(new AbortController().signal) as Promise<Json>;
}
const resultJson = async (output: Json) =>
  JSON.parse(await readFile(join(root, output.result as string, "result.json"), "utf8"));

describe("HIL plans with real helper processes", () => {
  it("flashes, waits for the boot event, talks to the UART, captures, judges and reports", async () => {
    const output = await run(plan());
    const result = await resultJson(output);
    expect(result.steps.map((step: Json) => [step.id, step.status])).toEqual([
      ["probe", "pass"],
      ["flash", "pass"],
      ["verify", "pass"],
      ["boot-log", "pass"],
      ["reset", "pass"],
      ["boot", "pass"],
      ["ping", "pass"],
      ["cap", "pass"],
      ["freq", "pass"],
    ]);
    expect(result).toMatchObject({
      status: "pass",
      physical: "confirmed",
      cleanup: [{ id: "halt", status: "pass" }],
    });
    expect(output).toMatchObject({ exitCode: 0, physical: "confirmed" });
    const folder = join(root, output.result as string);
    // The capture folder of this run fed lab-validate's verdict.
    const capture = result.steps[7].attempts[0].folder as string;
    expect(capture.startsWith(`${output.result}/steps/cap/`)).toBe(true);
    const verdict = JSON.parse(
      await readFile(join(root, result.steps[8].attempts[0].folder as string, "result.json"), "utf8"),
    );
    expect(verdict).toMatchObject({ kind: "lab-validation-result", verdict: "pass" });
    // Report files from the real helper; JUnit lists every step and the cleanup.
    for (const name of ["report.html", "report.md", "junit.xml", "events.jsonl", "plan.json"])
      expect(existsSync(join(folder, name)), name).toBe(true);
    const junit = readFileSync(join(folder, "junit.xml"), "utf8");
    expect(junit).toContain('<testsuite name="fixture-smoke" tests="10" failures="0" errors="0" skipped="0"');
    expect(readFileSync(join(folder, "report.html"), "utf8")).not.toMatch(/<script/i);
    expect(readFileSync(join(folder, "steps", "ping-1-1.log"), "utf8")).toContain("pong");
    // Every child run of the plan ended; nothing is left running.
    const runs = await runner.list(root);
    expect(runs.filter((entry) => entry.state === "running")).toEqual([]);
    // Eight step runs (the await runs nothing), the cleanup, the report and the plan itself.
    expect(runs).toHaveLength(11);
    expect(runs.filter((entry) => entry.program === "hil").map((entry) => entry.args[0])).toEqual([
      "report",
      "run",
    ]);
    // A second report is refused (exclusive files).
    const again = spawnSync(python, [SCRIPTS.hil as string, "report", "--run", output.result as string], {
      cwd: root,
      encoding: "utf8",
    });
    expect(again.status).toBe(2);
  }, 60_000);

  it("fails a violated criterion and a wrong UART answer, and blocks without the instrument", async () => {
    let output = await run(
      plan({
        steps: [
          ...plan().steps.slice(0, 7),
          plan().steps[7],
          { id: "freq", use: "lab-validate.compare", with: { request: validation("20 kHz") } },
        ],
      }),
    );
    let result = await resultJson(output);
    expect(result.status).toBe("fail");
    expect(result.steps[8].status).toBe("fail");
    await serialScenario(["boot\r\n", "READY\r\n", "pang\r\n"]);
    output = await run(plan({ steps: plan().steps.slice(0, 7) }));
    result = await resultJson(output);
    expect(result.status).toBe("fail");
    expect(result.steps[6].attempts.map((attempt: Json) => attempt.status)).toEqual(["fail", "fail"]);
    // The scope does not answer: identify in setup blocks the plan; nothing is flashed.
    await writeFile(
      join(root, "bench.json"),
      JSON.stringify({ resources: { [SCOPE]: { model: "ds1104z", idn: "x", faults: { absent: true } } } }),
    );
    output = await run(
      plan({
        steps: [
          { id: "scope-there", phase: "setup", use: "scpi.identify", with: { instrument: "scope" } },
          ...plan().steps.slice(1, 3),
          plan().steps[6],
        ],
      }),
    );
    result = await resultJson(output);
    expect(result.status).toBe("blocked");
    expect(result.steps.map((step: Json) => step.status)).toEqual([
      "blocked",
      "not-run",
      "not-run",
      "not-run",
    ]);
  }, 120_000);

  it("reserves the port for the plan and stops a running plan with its cleanup and no process left", async () => {
    await serialScenario(["boot\r\n"]);
    const soak = { id: "soak", use: "serial.capture", with: { port: "COM5", baud: 115200, duration: 60 } };
    const started = await run(plan({ steps: [plan().steps[0], soak] }), true);
    const hold = session.get(started.handle as string);
    if (!hold) throw Error("no plan handle");
    for (let i = 0; i < 200; i++) {
      if ((await runner.list(root)).some((entry) => entry.program === "serial" && entry.state === "running"))
        break;
      await sleep(25);
    }
    // Another session (or a second plan) naming COM5 or the scope gets BUSY while the plan holds them.
    await expect(
      runner.start({
        sessionId: "other",
        workbench: root,
        executable: python,
        args: [SCRIPTS.serial as string, "send", "--port", "COM5"],
      }),
    ).rejects.toMatchObject({ code: "BUSY" });
    const ended = await hold.stop();
    expect(ended).toMatchObject({ stopped: true, exitCode: 3 });
    const result = await resultJson(started);
    expect(result).toMatchObject({ status: "incomplete", state: "done", cleanup: [{ status: "pass" }] });
    expect(result.steps[1]).toMatchObject({ status: "incomplete", attempts: [{ stopped: true }] });
    const runs = await runner.list(root);
    expect(runs.filter((entry) => entry.state === "running")).toEqual([]);
    expect(runs.find((entry) => entry.program === "serial")?.state).toBe("stopped");
    expect((await readdir(join(root, "leases"))).filter((name) => name.endsWith(".lease"))).toEqual([]);
  }, 60_000);
});

describe("hil-testing package", () => {
  it("declares the plan program, its rules, catalog and pack entries and installs with its skill", async () => {
    const manifest = load("hil-testing").manifest;
    expect(manifest).toMatchObject({
      id: "hil-testing",
      version: "1.0.0",
      ecosystem: "lab",
      platforms: ["windows-x64", "linux-x64"],
    });
    expect(manifest.programs.hil).toMatchObject({ install: { script: "scripts/hil_tool.py" }, plan: "hil" });
    const risk = (args: string[]) => classifyCommand(manifest.rules, "hil", args).risk;
    expect(risk(["check", "hil/x.json"])).toBe("safe");
    expect(risk(["report", "--run", "x"])).toBe("safe");
    expect(risk(["run", "hil/x.json"])).toBe("device-read");
    const catalog = parse(readFileSync(join(plugins, "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("hil-testing");
    const packs = parse(readFileSync(join(plugins, "packs.yaml"), "utf8"));
    expect(packs.find((pack: Json) => pack.id === "lab").groups).toContainEqual({
      name: "Hardware-in-the-loop tests",
      plugins: ["hil-testing"],
      default: true,
    });
    expect(await core.checkCatalogSource(plugins)).toEqual([]);
    const temp = await realpath(await mkdtemp(join(tmpdir(), "vera-hil-pkg-")));
    try {
      const store = new core.PluginStore({ root: join(temp, "plugins") });
      await store.install(join(plugins, "hil-testing"));
      const installed = await store.load("hil-testing");
      const skills = new core.SkillCatalog({
        root: temp,
        disabled: () => [],
        plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
      });
      const planning = (await skills.read("plugin", "hil-planning")).content;
      for (const text of ["hil check", "hil run", "firmwareEffect", "cleanup", "await", "physical: unknown"])
        expect(planning).toContain(text);
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });

  it("refuses reports of unfinished, foreign or outside folders and never runs plans itself", async () => {
    const helper = (args: string[]) =>
      spawnSync(python, [SCRIPTS.hil as string, ...args], { cwd: root, encoding: "utf8" });
    expect(helper(["--version"]).stdout.trim()).toBe("hil-testing 1.0.0");
    expect(helper(["run", "hil/plan.json"]).status).toBe(2);
    await mkdir(join(root, "embedded-lab-results", "r1"), { recursive: true });
    await writeFile(
      join(root, "embedded-lab-results", "r1", "result.json"),
      JSON.stringify({ format: 1, kind: "hil-test-result", state: "running" }),
    );
    expect(helper(["report", "--run", "embedded-lab-results/r1"]).stdout).toContain("has not finished");
    await writeFile(
      join(root, "embedded-lab-results", "r1", "result.json"),
      JSON.stringify({ format: 1, kind: "scpi-result", state: "done" }),
    );
    expect(helper(["report", "--run", "embedded-lab-results/r1"]).status).toBe(2);
    expect(helper(["report", "--run", ".."]).status).toBe(2);
    expect(helper(["report", "--run", ".vera"]).status).toBe(2);
    expect(existsSync(join(root, "embedded-lab-results", "r1", "report.html"))).toBe(false);
  });
});
