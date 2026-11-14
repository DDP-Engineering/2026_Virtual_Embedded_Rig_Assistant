// HIL plans in core (spec REQ-DATA-5f714098): compilation, approval binding and the executor's state machine on a
// scripted process host - offline evidence of the orchestration only, never of a board or a probe.
// REQ-DATA-5f714098 REQ-FUNC-ebe1fc9f REQ-SEC-2c37b88c REQ-SEC-a96b34b5 REQ-SEC-14e51eb1 REQ-SEC-6bac4741
// REQ-SEC-8e4ac170 REQ-FUNC-7ba90d50 REQ-FUNC-334a3066 REQ-FUNC-c8da1f45 REQ-FUNC-08e50f9f REQ-FUNC-c961e72f
// REQ-REL-bddb3f0a REQ-REL-e44e0013 REQ-DATA-07b67f33 REQ-FUNC-1a55eab5 REQ-FUNC-6b178f3a REQ-UX-c4be4a14
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { type PermissionMode, type PluginManifest, validatePluginManifest, veraError } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { requestSha256 } from "../../agent/approvals.js";
import type { ToolContext } from "../../tools/context.js";
import { FakeHost, type FakeProcess } from "../fake-process-host.test-support.js";
import { ResourceLeases } from "../leases.js";
import type { ProgramChangeRequest } from "../program-request.js";
import { type ProgramHost, ProgramSession, runProgramTool } from "../program-tools.js";
import { ProgramRunner } from "../runner.js";
import type { LoadedPlugin } from "../store.js";

const plugins = fileURLToPath(new URL("../../../../../../plugins/", import.meta.url));
function load(id: string, tier: "official" | "trial" = "official"): LoadedPlugin {
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
      tier,
      source: { kind: "folder", path: join(plugins, id) },
      sha256: createHash("sha256").update(id).digest("hex"),
      installedAt: "2026-11-14T00:00:00.000Z",
      programs: Object.fromEntries(Object.keys(manifest.programs).map((name) => [name, "1.0.0"])),
    },
  } as LoadedPlugin;
}

type Behavior = (program: string, args: readonly string[], process: FakeProcess) => void | Promise<void>;
/** A FakeHost whose processes finish by a script: exit 0 unless the test says otherwise. */
class ScriptedHost extends FakeHost {
  behave: Behavior = (_program, _args, process) => process.finish({ code: 0, signal: null });
  override spawn(...input: Parameters<FakeHost["spawn"]>) {
    const process = super.spawn(...input);
    const [executable, args] = input;
    if (!executable.endsWith("taskkill.exe") && process.pid !== undefined) {
      const program = executable.split("/").pop() as string;
      setTimeout(() => void this.behave(program, args, process), 2);
    }
    return process;
  }
}
const exit = (process: FakeProcess, code: number, text = "") => {
  if (text) process.print(text);
  process.finish({ code, signal: null });
};

const sha = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const FIRMWARE = "\u007fELF fake blinky image";
const PROBE = "0483:374b:066DFF";
const target = { probe: PROBE, chip: "STM32F401RETx" };
const registry = {
  format: 1,
  resources: [
    { alias: "scope", kind: "visa", resource: "TCPIP0::10.0.0.5::INSTR", profile: "rigol-ds1000z" },
    { alias: "psu", kind: "visa", resource: "USB0::0x1AB1::0x0E11::DP8C1::INSTR", profile: "rigol-dp800" },
  ],
};
const plan = (fields: Record<string, unknown> = {}) => ({
  format: 1,
  id: "blinky-smoke",
  title: "Blinky smoke test",
  setup: {
    board: "NUCLEO-F401RE",
    revision: "C-03",
    description: "ST-LINK V2-1 on USB, its VCP on COM5; scope CH1 on PA5",
    wiring: ["scope CH1 -> PA5"],
    firmwareEffect: "device-read",
    effectNote: "Toggles LD2 and answers on USART2.",
  },
  firmware: { path: "build/app.elf", sha256: sha(FIRMWARE), format: "elf" },
  budget: { seconds: 60 },
  steps: [
    { id: "probe", phase: "setup", use: "probe-rs.list", expect: "0483:374b" },
    { id: "flash", phase: "setup", use: "probe-rs.flash", with: target },
    {
      id: "ping",
      use: "serial.send",
      with: { port: "COM5", baud: 115200, text: "ping", until: "^pong$", duration: 2 },
    },
  ],
  cleanup: [{ id: "halt", use: "probe-rs.reset", with: target }],
  ...fields,
});

let root = "";
let host: ScriptedHost;
let runner: ProgramRunner;
let leases: ResourceLeases;
let mode: PermissionMode;
let approved: ProgramChangeRequest | undefined;
let enabled: LoadedPlugin[];
let ctx: ToolContext;
let session: ProgramSession;
const signal = () => new AbortController().signal;
const writePlan = (value: unknown) =>
  writeFile(join(root, "hil", "plan.json"), JSON.stringify(value, null, 1));
const prepare = (op: "check" | "run", extra: Record<string, unknown> = {}) =>
  runProgramTool.prepare?.(
    ctx,
    { program: "hil", args: [op, "hil/plan.json"], ...extra },
    signal(),
  ) as Promise<{
    request: ProgramChangeRequest;
    apply(signal: AbortSignal): Promise<Record<string, unknown>>;
  }>;
async function check(value: unknown) {
  await writePlan(value);
  const prepared = await prepare("check");
  const result = await prepared.apply(signal());
  return { exitCode: result.exitCode as number, json: JSON.parse(result.output as string) };
}
async function run(value: unknown, extra: Record<string, unknown> = {}) {
  await writePlan(value);
  const prepared = await prepare("run", extra);
  approved = prepared.request;
  const result = await prepared.apply(signal());
  return { request: prepared.request, result };
}
async function resultOf(output: Record<string, unknown>) {
  const folder = join(root, output.result as string);
  return { folder, json: JSON.parse(await readFile(join(folder, "result.json"), "utf8")) };
}
const spawned = (program: string) =>
  host.programs.filter((process) => process.executable === `/opt/${program}`).map((process) => process.args);

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-hil-")));
  await mkdir(join(root, ".vera"));
  await mkdir(join(root, "lab"));
  await mkdir(join(root, "hil"));
  await mkdir(join(root, "build"));
  await writeFile(join(root, "lab", "resources.json"), JSON.stringify(registry));
  await writeFile(join(root, "build", "app.elf"), FIRMWARE);
  host = new ScriptedHost();
  leases = new ResourceLeases({ root: join(root, "leases"), app: "test", pid: 4242, alive: () => true });
  runner = new ProgramRunner({ host, clock: { sleep: async () => {} }, leases, killGraceMs: 5 });
  mode = "ask";
  approved = undefined;
  enabled = [
    "probe-rs",
    "serial-monitor",
    "esp32-esptool",
    "scpi-instruments",
    "lab-validation",
    "hil-testing",
  ].map((id) => load(id));
  session = new ProgramSession();
  const programHost: ProgramHost = {
    runner,
    clock: { sleep: async () => {} },
    plugins: async () => enabled,
    resolver: { resolve: async (_plugin, program) => ({ executable: `/opt/${program}` }) },
  };
  ctx = {
    root,
    lastReads: new Map(),
    permissionMode: () => mode,
    programs: {
      host: programHost,
      session,
      sessionId: "ses_1",
      turnId: "turn_1",
      callId: "call_1",
      consume: (request) => {
        if (request.risk !== "safe" && (!approved || requestSha256(request) !== requestSha256(approved)))
          throw veraError("CONFLICT");
      },
    },
  };
});
afterEach(async () => {
  for (const process of host.programs) process.finish({ code: 0, signal: null });
  await runner.stopAll();
  await rm(root, { recursive: true, force: true });
});

describe("hil check", () => {
  it("expands a plan into its operations without starting anything", async () => {
    const checked = await check(
      plan({
        steps: [
          { id: "probe", phase: "setup", use: "probe-rs.list" },
          { id: "flash", phase: "setup", use: "probe-rs.flash", with: target },
          {
            id: "log",
            use: "serial.capture",
            background: true,
            with: { port: "COM5", baud: 115200, duration: 5, until: "READY" },
          },
          { id: "reset", use: "probe-rs.reset", with: target },
          { id: "boot", use: "await", with: { step: "log" } },
          { id: "cap", use: "scpi.capture", with: { instrument: "scope", channel: "CHAN1" } },
          {
            id: "led",
            use: "lab-validate.compare",
            with: { request: { format: 1, sources: { scope: { importer: "scpi-capture", step: "cap" } } } },
          },
        ],
      }),
    );
    expect(checked.exitCode).toBe(0);
    expect(host.programs).toHaveLength(0);
    const { json } = checked;
    expect(json).toMatchObject({ kind: "hil-plan-check", valid: true, risk: "device-write", confirm: null });
    const run = json.plan.path;
    expect(run).toBe("hil/plan.json");
    const steps = json.steps as { id: string; args?: string[]; risk: string; program?: string }[];
    expect(steps.find((step) => step.id === "flash")).toMatchObject({
      program: "probe-rs",
      risk: "device-write",
      args: [
        "download",
        "--probe",
        PROBE,
        "--chip",
        "STM32F401RETx",
        "--non-interactive",
        "--binary-format",
        "elf",
        "build/app.elf",
      ],
    });
    expect(steps.find((step) => step.id === "log")).toMatchObject({
      program: "serial",
      risk: "device-read",
      background: true,
    });
    expect(steps.find((step) => step.id === "cap")?.args).toEqual(
      expect.arrayContaining(["capture", "--instrument", "scope", "--channel", "CHAN1", "--results-dir"]),
    );
    expect(json.resources).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "registry", name: "scope" }),
        expect.objectContaining({ kind: "serial", name: "COM5", keys: ["serial:COM5"] }),
        expect.objectContaining({ kind: "probe", keys: [`probe:${PROBE.toLowerCase()}`] }),
      ]),
    );
    expect(json.files).toEqual(
      expect.arrayContaining([
        { path: "hil/plan.json", sha256: expect.any(String), use: "plan" },
        { path: "build/app.elf", sha256: sha(FIRMWARE), use: "firmware" },
      ]),
    );
  });

  it("refuses unknown and unsafe plans before any process or approval", async () => {
    const cases: [Record<string, unknown>, string][] = [
      [plan({ steps: [{ id: "x", use: "shell", with: { command: "rm -rf /" } }] }), "steps.0.use"],
      [
        plan({
          steps: [
            { id: "f", use: "probe-rs.flash", with: target, retries: 2 },
            { id: "t", use: "probe-rs.list" },
          ],
        }),
        "steps.0",
      ],
      [
        plan({ steps: [{ id: "c", use: "scpi.capture", with: { instrument: "scope2", channel: "CHAN1" } }] }),
        "steps.0",
      ],
      [
        plan({
          steps: [
            { id: "p", use: "serial.send", with: { port: "COM5", baud: 9600, duration: 1, text: "--reset" } },
          ],
        }),
        "steps.0.with.text",
      ],
      [
        plan({
          steps: [
            {
              id: "p",
              use: "serial.send",
              with: { port: "COM5", baud: 9600, duration: 1, text: "a", extra: 1 },
            },
          ],
        }),
        "steps.0.with.extra",
      ],
      [plan({ steps: [{ id: "l", use: "probe-rs.list", timeout: 3600 }] }), "steps.0.timeout"],
      [
        plan({ firmware: { path: "build/app.elf", sha256: "b".repeat(64), format: "elf" } }),
        "firmware.sha256",
      ],
      [
        plan({ firmware: { path: "build/missing.elf", sha256: "b".repeat(64), format: "elf" } }),
        "firmware.path",
      ],
      [
        plan({ steps: [{ id: "f", use: "esptool.flash", with: { port: "COM5", chip: "esp32" } }] }),
        "steps.0",
      ],
      [plan({ steps: [{ id: "b", use: "await", with: { step: "nothing" } }] }), "steps.0.with.step"],
    ];
    for (const [value, path] of cases) {
      const checked = await check(value);
      expect(checked.exitCode, JSON.stringify(value.steps)).toBe(2);
      expect(checked.json.valid).toBe(false);
      expect(checked.json.problems.map((problem: { path: string }) => problem.path)).toContain(path);
      await writePlan(value);
      await expect(prepare("run")).rejects.toThrow(/refused before any approval/);
    }
    expect(host.programs).toHaveLength(0);
  });

  it("compiles every adapter with the program the target plugin declares", async () => {
    const elf = await check(
      plan({
        steps: [
          { id: "list", use: "probe-rs.list" },
          { id: "flash", use: "probe-rs.flash", with: target },
          { id: "verify", use: "probe-rs.verify", with: target },
          { id: "reset", use: "probe-rs.reset", with: target },
          { id: "esp", use: "esptool.identify", with: { port: "COM7" } },
          { id: "log", use: "serial.capture", with: { port: "COM5", baud: 9600, duration: 1, reset: true } },
          {
            id: "send",
            use: "serial.send",
            with: { port: "COM5", baud: 9600, duration: 1, text: "ping", eol: "lf" },
          },
          { id: "idn", use: "scpi.identify", with: { instrument: "scope" } },
          { id: "status", use: "scpi.status", with: { instrument: "psu" } },
          { id: "read", use: "scpi.read", with: { instrument: "psu", channel: "CH1" } },
          { id: "cap", use: "scpi.capture", with: { instrument: "scope", channel: "CHAN1" } },
          {
            id: "cfg",
            use: "scpi.configure",
            with: { instrument: "psu", set: ["CH1.voltage=3.3", "CH1.current=0.1"] },
          },
          {
            id: "power",
            use: "scpi.output",
            with: { instrument: "psu", channel: "CH1", voltage: 3.3, current: 0.1, hold: 5 },
          },
          {
            id: "eval",
            use: "lab-validate.compare",
            with: { request: { sources: { s: { importer: "scpi-capture", step: "cap" } } } },
          },
        ],
        cleanup: [{ id: "off", use: "scpi.close", with: { instrument: "psu" } }],
      }),
    );
    expect(elf.exitCode).toBe(0);
    const programs = (elf.json.steps as { id: string; program: string; risk: string; args: string[] }[]).map(
      (step) => [step.id, step.program, step.risk, step.args[0] === "--port" ? step.args[2] : step.args[0]],
    );
    expect(programs).toEqual([
      ["list", "probe-rs", "safe", "list"],
      ["flash", "probe-rs", "device-write", "download"],
      ["verify", "probe-rs", "device-read", "verify"],
      ["reset", "probe-rs", "device-read", "reset"],
      ["esp", "esptool", "device-read", "chip-id"],
      ["log", "serial", "device-read", "capture"],
      ["send", "serial", "device-write", "send"],
      ["idn", "scpi", "device-read", "identify"],
      ["status", "scpi", "device-read", "status"],
      ["read", "scpi", "device-read", "read"],
      ["cap", "scpi", "device-read", "capture"],
      ["cfg", "scpi", "device-write", "configure"],
      ["power", "scpi", "irreversible", "output"],
      ["eval", "lab-validate", "safe", "compare"],
    ]);
    expect(elf.json).toMatchObject({
      risk: "irreversible",
      confirm: "blinky-smoke",
      cleanup: [{ program: "scpi", risk: "device-write" }],
    });
    // esptool writes a bin image at its address.
    await writeFile(join(root, "build", "app.bin"), FIRMWARE);
    const bin = await check(
      plan({
        firmware: { path: "build/app.bin", sha256: sha(FIRMWARE), format: "bin", address: "0x10000" },
        steps: [
          { id: "flash", use: "esptool.flash", with: { port: "COM7", chip: "esp32s3" } },
          { id: "verify", use: "esptool.verify", with: { port: "COM7", chip: "esp32s3" } },
        ],
        cleanup: [],
      }),
    );
    expect(bin.exitCode).toBe(0);
    expect(bin.json.steps.map((step: { args: string[]; risk: string }) => [step.risk, ...step.args])).toEqual(
      [
        ["device-write", "--chip", "esp32s3", "--port", "COM7", "write-flash", "0x10000", "build/app.bin"],
        ["device-read", "--chip", "esp32s3", "--port", "COM7", "verify-flash", "0x10000", "build/app.bin"],
      ],
    );
    // An invalid expect and a firmware path that reads as an option are refused before anything runs.
    const invalid = await check(
      plan({
        steps: [{ id: "list", use: "probe-rs.list", expect: "(" }],
        cleanup: [{ id: "halt", use: "probe-rs.reset", with: target, expect: "(?i)ok" }],
      }),
    );
    expect(invalid.json.problems.map((problem: { path: string }) => problem.path)).toEqual([
      "steps.0.expect",
      "cleanup.0.expect",
    ]);
    await writeFile(join(root, "-erase.elf"), FIRMWARE);
    const option = await check(
      plan({ firmware: { path: "-erase.elf", sha256: sha(FIRMWARE), format: "elf" } }),
    );
    expect(option.json.problems.map((problem: { path: string }) => problem.path)).toContain("firmware.path");
    expect(host.programs).toHaveLength(0);
  });

  it("refuses a step that interleaves with a running background step on its resource", async () => {
    const log = {
      id: "log",
      use: "serial.capture",
      background: true,
      with: { port: "COM5", baud: 9600, duration: 5 },
    };
    const send = {
      id: "send",
      use: "serial.send",
      with: { port: "COM5", baud: 9600, duration: 1, text: "ping" },
    };
    const before = await check(
      plan({ steps: [log, send, { id: "w", use: "await", with: { step: "log" } }] }),
    );
    expect(before.exitCode).toBe(2);
    expect(before.json.problems[0].message).toMatch(/serial:COM5.*background step log/);
    const after = await check(plan({ steps: [log, { id: "w", use: "await", with: { step: "log" } }, send] }));
    expect(after.exitCode).toBe(0);
  });

  it("rates the plan at its highest operation and the firmware's effect when it starts the firmware", async () => {
    const reads = [
      { id: "id", use: "scpi.identify", with: { instrument: "scope" } },
      { id: "log", use: "serial.capture", with: { port: "COM5", baud: 9600, duration: 1 } },
    ];
    const irreversible = {
      ...plan().setup,
      firmwareEffect: "irreversible",
      effectNote: "Drives the motor relay.",
    };
    const quiet = await check(plan({ setup: irreversible, steps: reads, cleanup: [] }));
    expect(quiet.json).toMatchObject({ risk: "device-read", confirm: null, startsFirmware: false });
    const started = await check(
      plan({
        setup: irreversible,
        steps: [...reads, { id: "reset", use: "probe-rs.reset", with: target }],
        cleanup: [],
      }),
    );
    expect(started.json).toMatchObject({
      risk: "irreversible",
      confirm: "blinky-smoke",
      startsFirmware: true,
    });
    await writePlan(
      plan({
        setup: irreversible,
        steps: [...reads, { id: "reset", use: "probe-rs.reset", with: target }],
        cleanup: [],
      }),
    );
    const prepared = await prepare("run");
    expect(prepared.request).toMatchObject({ risk: "irreversible", confirm: "blinky-smoke" });
    // read-only refuses every plan that touches hardware; a trial plugin among the steps makes the plan trial.
    mode = "read-only";
    await expect(prepare("run")).rejects.toThrow(/do not run in read-only mode/);
    mode = "ask";
    enabled = enabled.map((plugin) =>
      plugin.manifest.id === "serial-monitor" ? load("serial-monitor", "trial") : plugin,
    );
    expect((await prepare("run")).request.trial).toBe(true);
  });
});

describe("hil run approval", () => {
  it("shows the expansion and binds the plan, firmware, registry and operations", async () => {
    await writePlan(
      plan({
        steps: [
          { id: "flash", phase: "setup", use: "probe-rs.flash", with: target },
          { id: "cap", use: "scpi.capture", with: { instrument: "scope", channel: "CHAN1" } },
        ],
      }),
    );
    const { request } = await prepare("run");
    expect(request).toMatchObject({
      tool: "run_program",
      program: "hil",
      args: ["run", "hil/plan.json"],
      risk: "device-write",
    });
    expect(request.files).toEqual([{ arg: 1, path: "hil/plan.json", sha256: expect.any(String) }]);
    expect(request.resources?.map((resource) => resource.alias)).toEqual(["scope"]);
    const notes = request.notes.join("\n");
    for (const expected of [
      /HIL plan blinky-smoke \(hil\/plan\.json, sha256 [0-9a-f]{64}\)/,
      /Setup: NUCLEO-F401RE revision C-03/,
      /Wiring: scope CH1 -> PA5/,
      /Firmware effect: device-read \(the plan starts the firmware\)/,
      /Firmware: build\/app\.elf \(elf\) sha256/,
      /Budget: 60 s/,
      /Step 1 flash \[setup\] device-write: probe-rs download/,
      /Step 2 cap \[test\] device-read: scpi capture --instrument scope/,
      /Cleanup 1 halt \[cleanup\] device-read: probe-rs reset/,
      /File: build\/app\.elf [0-9a-f]{64} \(firmware\)/,
      /Reserved probe: 0483:374b:066dff/,
    ])
      expect(notes).toMatch(expected);
    expect(notes.indexOf("Setup:")).toBeLessThan(notes.indexOf("Step 1"));
    expect(notes.indexOf("Step 2")).toBeLessThan(notes.indexOf("Cleanup 1"));
  });

  it("refuses with CONFLICT when the firmware or the plan changes after the approval was asked", async () => {
    for (const change of [
      () => writeFile(join(root, "build", "app.elf"), `${FIRMWARE}!`),
      () => writeFile(join(root, "hil", "plan.json"), JSON.stringify(plan({ title: "Changed" }))),
    ]) {
      await writeFile(join(root, "build", "app.elf"), FIRMWARE);
      await writePlan(plan());
      const prepared = await prepare("run");
      approved = prepared.request;
      await change();
      await expect(prepared.apply(signal())).rejects.toThrow(/changed after approval/);
    }
    expect(host.programs).toHaveLength(0);
  });
});

describe("hil run execution", () => {
  it("runs a passing plan and writes the evidence folder", async () => {
    host.behave = (program, args, process) => {
      if (program === "probe-rs" && args[0] === "list")
        return exit(process, 0, `[0]: STLink V2-1 -- 0483:374b:066DFF\n`);
      if (program === "serial") return exit(process, 0, "pong\n");
      return exit(process, 0);
    };
    const { result } = await run(plan());
    expect(result).toMatchObject({ exitCode: 0, risk: "device-write", physical: "confirmed" });
    const { folder, json } = await resultOf(result);
    expect(json).toMatchObject({
      format: 1,
      kind: "hil-test-result",
      status: "pass",
      state: "done",
      physical: "confirmed",
    });
    expect(json.states.map((state: { state: string }) => state.state)).toEqual([
      "prepared",
      "awaiting-approval",
      "running",
      "cleaning-up",
      "done",
    ]);
    expect(json.steps.map((step: { status: string }) => step.status)).toEqual(["pass", "pass", "pass"]);
    expect(json.cleanup[0]).toMatchObject({ id: "halt", status: "pass" });
    expect(readFileSync(join(folder, "plan.json"), "utf8")).toBe(
      readFileSync(join(root, "hil", "plan.json"), "utf8"),
    );
    const events = (await readFile(join(folder, "events.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    for (let index = 1; index < events.length; index++)
      expect(events[index].t).toBeGreaterThan(events[index - 1].t);
    expect(events.map((event) => event.event)).toEqual(
      expect.arrayContaining(["state", "lease", "step-start", "step-end"]),
    );
    expect(await readdir(join(folder, "steps"))).toEqual(
      expect.arrayContaining(["probe-1-1.log", "flash-1-1.log", "ping-1-1.log", "halt-1-1.log"]),
    );
    expect(readFileSync(join(folder, "steps", "ping-1-1.log"), "utf8")).toContain("pong");
    // Children ran as children of the plan; the report ran last; the leases are released.
    expect(spawned("hil")).toEqual([["report", "--run", result.result]]);
    expect((await readdir(join(root, "leases"))).filter((name) => name.endsWith(".lease"))).toEqual([]);
  });

  it("judges assertions, preconditions and missing instruments distinctly and never passes an unrun test", async () => {
    // A wrong answer is a failed assertion; later tests still run.
    host.behave = (program, _args, process) => exit(process, program === "serial" ? 4 : 0, "0483:374b\n");
    let { result } = await run(
      plan({ steps: [...plan().steps, { id: "id", use: "scpi.identify", with: { instrument: "scope" } }] }),
    );
    let json = (await resultOf(result)).json;
    expect(json.status).toBe("fail");
    expect(result.exitCode).toBe(1);
    expect(json.steps.map((step: { status: string }) => step.status)).toEqual([
      "pass",
      "pass",
      "fail",
      "pass",
    ]);
    // An absent instrument in setup (scpi exit 2) blocks the plan; nothing after it runs.
    host.behave = (program, _args, process) => exit(process, program === "scpi" ? 2 : 0, "0483:374b\n");
    ({ result } = await run(
      plan({
        steps: [
          { id: "scope-there", phase: "setup", use: "scpi.identify", with: { instrument: "scope" } },
          ...plan().steps.slice(1),
        ],
      }),
    ));
    json = (await resultOf(result)).json;
    expect(json.status).toBe("blocked");
    expect(json.steps.map((step: { status: string }) => step.status)).toEqual([
      "blocked",
      "not-run",
      "not-run",
    ]);
    expect(json.cleanup[0].status).toBe("pass");
    // The same instrument absent in a test step is an error of that step (blocked means a failed precondition).
    ({ result } = await run(
      plan({ steps: [...plan().steps, { id: "id", use: "scpi.identify", with: { instrument: "scope" } }] }),
    ));
    expect((await resultOf(result)).json).toMatchObject({
      status: "error",
      steps: [{}, {}, {}, { status: "error", attempts: [{ status: "blocked" }] }],
    });
    // A failed expect in setup blocks; a skipped test step leaves the plan incomplete.
    host.behave = (_program, _args, process) => exit(process, 0, "no probes\n");
    ({ result } = await run(plan()));
    expect((await resultOf(result)).json).toMatchObject({
      status: "blocked",
      steps: [{ status: "blocked" }, {}, {}],
    });
    host.behave = (_program, _args, process) => exit(process, 0, "0483:374b\n");
    const sends = spawned("serial").length;
    ({ result } = await run(
      plan({ steps: [...plan().steps.slice(0, 2), { ...plan().steps[2], skip: "no UART today" }] }),
    ));
    json = (await resultOf(result)).json;
    expect(json.status).toBe("incomplete");
    expect(json.steps[2]).toMatchObject({ status: "skipped", reason: "no UART today", attempts: [] });
    expect(spawned("serial")).toHaveLength(sends);
  });

  it("retries only repeatable steps and never repeats a flash", async () => {
    let sends = 0;
    host.behave = (program, args, process) => {
      if (program === "serial") return exit(process, ++sends < 3 ? 4 : 0);
      if (program === "probe-rs" && args[0] === "download")
        return exit(process, 1, "Error: probe not found\n");
      return exit(process, 0, "0483:374b\n");
    };
    let { result } = await run(
      plan({
        steps: [
          { id: "probe", phase: "setup", use: "probe-rs.list" },
          { ...plan().steps[2], retries: 2, repeat: 1 },
        ],
      }),
    );
    let json = (await resultOf(result)).json;
    expect(json.status).toBe("pass");
    expect(json.steps[1].attempts.map((attempt: { status: string }) => attempt.status)).toEqual([
      "fail",
      "fail",
      "pass",
    ]);
    ({ result } = await run(
      plan({ steps: [{ id: "flash", use: "probe-rs.flash", with: target }, plan().steps[2]] }),
    ));
    json = (await resultOf(result)).json;
    expect(json.status).toBe("error");
    expect(json.steps[0].attempts).toHaveLength(1);
    expect(json.steps[1].status).toBe("not-run");
    expect(spawned("probe-rs").filter((args) => args[0] === "download")).toHaveLength(1);
  });

  it("waits for a background event and judges it, with the await's own timeout", async () => {
    const steps = (until: string, timeout?: number) => [
      {
        id: "log",
        use: "serial.capture",
        background: true,
        with: { port: "COM5", baud: 9600, duration: 5, until },
      },
      { id: "reset", use: "probe-rs.reset", with: target },
      { id: "boot", use: "await", with: { step: "log" }, ...(timeout ? { timeout } : {}) },
    ];
    host.behave = (program, args, process) => {
      if (program !== "serial") return exit(process, 0);
      // The capture ends once the firmware printed READY (after the reset), or never matches.
      if (args.includes("READY")) setTimeout(() => exit(process, 0, "boot\nREADY\n"), 30);
      else if (args.includes("NEVER")) setTimeout(() => exit(process, 4, "boot\n"), 30);
    };
    let { result } = await run(plan({ steps: steps("READY") }));
    let json = (await resultOf(result)).json;
    expect(json.steps.map((step: { status: string }) => step.status)).toEqual(["pass", "pass", "pass"]);
    ({ result } = await run(plan({ steps: steps("NEVER") })));
    json = (await resultOf(result)).json;
    expect(json.status).toBe("fail");
    expect(json.steps[2].status).toBe("fail");
    // A capture that hangs: the await times out, stops it and is incomplete.
    ({ result } = await run(plan({ steps: steps("HANG", 1) })));
    json = (await resultOf(result)).json;
    expect(json.steps[2]).toMatchObject({ status: "incomplete", attempts: [{ problem: "await-timeout" }] });
    expect(json.status).toBe("incomplete");
    expect(host.programs.filter((process) => !process.exited)).toHaveLength(0);
  });

  it("stops on Stop and on budget, runs the cleanup once and releases the plan", async () => {
    const hang = { id: "soak", use: "serial.capture", with: { port: "COM5", baud: 9600, duration: 30 } };
    host.behave = (program, _args, process) => {
      if (program !== "serial") exit(process, 0);
    };
    await writePlan(plan({ steps: [hang, plan().steps[2]] }));
    const prepared = await prepare("run", { background: true });
    approved = prepared.request;
    const started = await prepared.apply(signal());
    expect(started).toMatchObject({
      handle: expect.any(String),
      result: expect.stringMatching(/^embedded-lab-results\//),
    });
    // Another session cannot take the port while the plan holds it.
    await expect(
      runner.start({
        sessionId: "ses_2",
        workbench: root,
        executable: "/opt/serial",
        args: ["send", "--port", "COM5"],
      }),
    ).rejects.toMatchObject({ code: "BUSY" });
    const handle = session.get(started.handle as string);
    for (let i = 0; i < 100 && spawned("serial").length === 0; i++)
      await new Promise((done) => setTimeout(done, 5));
    const ended = await handle?.stop();
    expect(ended).toMatchObject({ exitCode: 3, stopped: true });
    let json = (await resultOf(started)).json;
    expect(json).toMatchObject({ status: "incomplete", state: "done" });
    expect(json.steps.map((step: { status: string }) => step.status)).toEqual(["incomplete", "not-run"]);
    expect(json.cleanup[0].status).toBe("pass");
    expect(host.programs.filter((process) => !process.exited)).toHaveLength(0);
    expect((await readdir(join(root, "leases"))).filter((name) => name.endsWith(".lease"))).toEqual([]);
    // The budget ends a hanging step the same way.
    const { result } = await run(plan({ budget: { seconds: 1 }, steps: [hang] }));
    json = (await resultOf(result)).json;
    expect(json).toMatchObject({ status: "incomplete", problems: [{ code: "budget" }] });
    expect(json.cleanup[0].status).toBe("pass");
    expect(host.programs.filter((process) => !process.exited)).toHaveLength(0);
    expect((await readdir(join(root, "leases"))).filter((name) => name.endsWith(".lease"))).toEqual([]);
  });

  it("stops a plan waiting on a background step and reserves its probe against direct runs", async () => {
    host.behave = (program, _args, process) => {
      if (program !== "serial") exit(process, 0, "0483:374b\n");
    };
    await writePlan(
      plan({
        steps: [
          { id: "flash", use: "probe-rs.flash", with: target },
          {
            id: "log",
            use: "serial.capture",
            background: true,
            with: { port: "COM5", baud: 9600, duration: 60 },
          },
          { id: "boot", use: "await", with: { step: "log" } },
        ],
      }),
    );
    const prepared = await prepare("run", { background: true });
    approved = prepared.request;
    const started = await prepared.apply(signal());
    for (let i = 0; i < 200 && spawned("serial").length === 0; i++)
      await new Promise((done) => setTimeout(done, 5));
    // A direct probe-rs run of another session naming the plan's probe is BUSY, in any spelling of its case.
    await expect(
      runner.start({
        sessionId: "ses_2",
        workbench: root,
        executable: "/opt/probe-rs",
        args: ["download", `--probe=${PROBE.toLowerCase()}`, "build/app.elf"],
      }),
    ).rejects.toMatchObject({ code: "BUSY", params: { resource: PROBE.toLowerCase() } });
    const ended = await session.get(started.handle as string)?.stop();
    expect(ended).toMatchObject({ stopped: true, exitCode: 3 });
    const { json } = await resultOf(started);
    // Stop lands either while the await waits (both incomplete) or just before it starts (the background step is
    // stopped by the plan and the await never runs); neither is ever a pass.
    expect([
      ["pass", "incomplete", "incomplete"],
      ["pass", "stopped", "not-run"],
    ]).toContainEqual(json.steps.map((step: { status: string }) => step.status));
    expect(json).toMatchObject({ status: "incomplete", cleanup: [{ status: "pass" }] });
    expect(host.programs.filter((process) => !process.exited)).toHaveLength(0);
    expect((await readdir(join(root, "leases"))).filter((name) => name.endsWith(".lease"))).toEqual([]);
  });

  it("classifies exit 3 and step timeouts by program", async () => {
    host.behave = (program, _args, process) => {
      if (program === "serial") return; // hangs until its step timeout
      exit(process, program === "scpi" || program === "lab-validate" ? 3 : 0, "0483:374b\n");
    };
    await writeFile(join(root, "sim.csv"), "t,v\n0,1\n");
    const request = { format: 1, sources: { sim: { importer: "csv", path: "sim.csv" } } };
    let { result } = await run(
      plan({
        steps: [
          { id: "check", use: "lab-validate.compare", with: { request } },
          { id: "id", use: "scpi.identify", with: { instrument: "scope" } },
        ],
      }),
    );
    let json = (await resultOf(result)).json;
    expect(json.steps.map((step: { status: string }) => step.status)).toEqual(["incomplete", "error"]);
    expect(json.status).toBe("error");
    ({ result } = await run(
      plan({
        steps: [
          { id: "soak", use: "serial.capture", timeout: 1, with: { port: "COM5", baud: 9600, duration: 30 } },
        ],
      }),
    ));
    json = (await resultOf(result)).json;
    expect(json.steps[0]).toMatchObject({
      status: "error",
      attempts: [{ status: "error", timedOut: true, problem: "step-timeout" }],
    });
    expect(json.cleanup[0].status).toBe("pass");
    expect(host.programs.filter((process) => !process.exited)).toHaveLength(0);
  });

  it("reports physical unknown when the cleanup fails and records it on the plan's resources", async () => {
    host.behave = (program, args, process) =>
      exit(process, program === "probe-rs" && args[0] === "reset" ? 1 : 0, "0483:374b pong\n");
    const { result } = await run(plan());
    const { json } = await resultOf(result);
    expect(result.physical).toBe("unknown");
    expect(json).toMatchObject({ status: "pass", physical: "unknown", cleanup: [{ status: "error" }] });
    const markers = (await readdir(join(root, "leases"))).filter((name) => name.endsWith(".state"));
    expect(markers.length).toBeGreaterThan(0);
    // The next claim of the plan's probe sees the unknown state.
    const key = `probe:${PROBE.toLowerCase()}`;
    const next = await leases.acquire(
      [{ kind: "probe", alias: "probe", resource: PROBE, keys: [key], actuates: true }],
      { sessionId: "ses_9", runId: "run_next" },
    );
    expect(next.states.probe).toMatchObject({ key, state: "unknown", reason: "hil-cleanup" });
    await next.release();
  });

  it("counts an interrupted flash as started firmware and reports irreversible firmware without cleanup unknown", async () => {
    host.behave = (program, args, process) => {
      if (program === "probe-rs" && args[0] === "download") return; // hangs until the budget kills it
      exit(process, 0, "0483:374b\n");
    };
    const irreversible = { ...plan().setup, firmwareEffect: "irreversible", effectNote: "Drives a relay." };
    const { result } = await run(
      plan({
        setup: irreversible,
        budget: { seconds: 1 },
        steps: [{ id: "flash", use: "probe-rs.flash", with: target }],
        cleanup: [],
      }),
    );
    const { json } = await resultOf(result);
    expect(json).toMatchObject({ status: "incomplete", physical: "unknown" });
    expect(json.steps[0].attempts[0]).toMatchObject({ status: "incomplete", stopped: true });
  });

  it("does not start an operation whose approved file changed while the plan ran", async () => {
    host.behave = (program, args, process) => {
      if (program === "probe-rs" && args[0] === "list")
        return void writeFile(join(root, "build", "app.elf"), "rebuilt").then(() =>
          exit(process, 0, "0483:374b\n"),
        );
      return exit(process, 0, "pong\n");
    };
    const { result } = await run(plan());
    const { json } = await resultOf(result);
    expect(json.status).toBe("error");
    expect(json.steps[1]).toMatchObject({
      status: "error",
      attempts: [{ status: "error", problem: "changed" }],
    });
    expect(json.steps[2].status).toBe("not-run");
    // The cleanup names no changed file of its own: it still runs after a rebuild.
    expect(json.cleanup[0].status).toBe("pass");
    expect(json.problems).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "changed", step: "flash" })]),
    );
    expect(spawned("probe-rs").filter((args) => args[0] === "download")).toHaveLength(0);
  });

  it("evaluates a capture of the same run with a generated lab-validate request", async () => {
    host.behave = async (program, args, process) => {
      if (program === "scpi" && args[0] === "capture") {
        const folder = args[args.indexOf("--results-dir") + 1] as string;
        await mkdir(join(root, folder, "20261114T000000Z-abcd0123"), { recursive: true });
        await writeFile(
          join(root, folder, "20261114T000000Z-abcd0123", "result.json"),
          JSON.stringify({ started: "2026-11-14T00:00:00Z" }),
        );
      }
      exit(process, 0, "0483:374b pong\n");
    };
    await writeFile(join(root, "sim.csv"), "t,v\n0,1\n");
    const request = {
      format: 1,
      sources: {
        scope: { importer: "scpi-capture", step: "cap" },
        sim: { importer: "csv", path: "sim.csv" },
      },
    };
    const { result } = await run(
      plan({
        steps: [
          { id: "cap", use: "scpi.capture", with: { instrument: "scope", channel: "CHAN1" } },
          { id: "led", use: "lab-validate.compare", with: { request } },
        ],
      }),
    );
    const { json } = await resultOf(result);
    expect(json.steps[0].attempts[0]).toMatchObject({
      folder: `${result.result}/steps/cap/20261114T000000Z-abcd0123`,
      deviceTimes: { started: "2026-11-14T00:00:00Z" },
    });
    const generated = JSON.parse(
      await readFile(join(root, result.result as string, "steps", "led.request.json"), "utf8"),
    );
    expect(generated.sources).toEqual({
      scope: { importer: "scpi-capture", path: `${result.result}/steps/cap/20261114T000000Z-abcd0123` },
      sim: { importer: "csv", path: "sim.csv", sha256: sha("t,v\n0,1\n") },
    });
    expect(spawned("lab-validate")[0]).toEqual([
      "compare",
      "--request",
      `${result.result}/steps/led.request.json`,
      "--results-dir",
      `${result.result}/steps/led`,
    ]);
  });
});
