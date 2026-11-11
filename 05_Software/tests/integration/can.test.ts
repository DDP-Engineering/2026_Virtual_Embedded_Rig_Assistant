// The can-python and can-dbc plugins without a CAN adapter. Default tests check the packages, the risk rules, the
// can script against a fake python-can (tests/fixtures/can/fake-python-can) and the typed confirmation of a
// transmit through the real Provisioner with a fake uv. VERA_CAN_UV names a real uv: the opt-in test provisions
// python-can and cantools from PyPI and captures, transmits and decodes on a udp_multicast bus.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const fixtures = fileURLToPath(new URL("../fixtures/can/", import.meta.url));
const canScript = fileURLToPath(new URL("can-python/scripts/can_bus.py", plugins));
const decodeScript = fileURLToPath(new URL("can-dbc/scripts/can_decode.py", plugins));
const manifest = async (id: string): Promise<PluginManifest> =>
  parse(await readFile(new URL(`${id}/plugin.yaml`, plugins), "utf8"));
const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const evidence = process.env.VERA_TEST_EVIDENCE_DIR;

it("publishes the official can-python and can-dbc packages, their pack and three installed skills", async () => {
  const python = await manifest("can-python");
  const dbc = await manifest("can-dbc");
  for (const m of [python, dbc]) {
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({ ecosystem: "can", platforms: ["windows-x64", "linux-x64"] });
  }
  expect(python.programs.can?.install).toEqual({ script: "scripts/can_bus.py" });
  expect(python.programs.can?.version).toEqual({
    args: ["--version"],
    match: "^can-python (\\d+\\.\\d+\\.\\d+)",
  });
  expect(dbc.programs.cantools?.install).toEqual({ pip: "cantools>=45,<46" });
  expect(dbc.programs.cantools?.version).toMatchObject({ args: ["--version"], range: ">=45,<46" });
  expect(dbc.programs["can-decode"]?.install).toEqual({ script: "scripts/can_decode.py" });
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toEqual(expect.arrayContaining(["can-python", "can-dbc"]));
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs).toContainEqual({
    id: "can",
    name: "CAN",
    groups: [
      { name: "Bus capture and transmit", plugins: ["can-python"], default: true },
      { name: "DBC decoding", plugins: ["can-dbc"], default: true },
    ],
  });
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-can-skills-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    for (const id of ["can-python", "can-dbc"])
      await store.install(fileURLToPath(new URL(`${id}/`, plugins)));
    const installed = await Promise.all(["can-python", "can-dbc"].map((id) => store.load(id)));
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => installed.map((plugin) => ({ id: plugin.manifest.id, folder: plugin.folder })),
    });
    const listed = (await skills.list()).filter((skill) => skill.plugin?.startsWith("can-"));
    expect(listed.map((skill) => [skill.plugin, skill.name])).toEqual([
      ["can-python", "can-capture"],
      ["can-dbc", "can-decode"],
      ["can-python", "can-transmit"],
    ]);
    const read = async (name: string) => (await skills.read("plugin", name)).content;
    const capture = await read("can-capture");
    for (const text of [
      "can list",
      "--duration",
      "--max-messages",
      "--output captures/",
      "listen-only",
      "--active",
    ])
      expect(capture).toContain(text);
    const transmit = await read("can-transmit");
    for (const text of ["can send", "can replay", "typed", "--count", "--max-messages"])
      expect(transmit).toContain(text);
    const decode = await read("can-decode");
    for (const text of ["can-decode --dbc", "cantools dump", "--id", "--limit"])
      expect(decode).toContain(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("classifies CAN commands by their bus effect", async () => {
  const python = await manifest("can-python");
  const dbc = await manifest("can-dbc");
  const can = (args: string[]) => classifyCommand(python.rules, "can", args);
  const tools = (program: string, args: string[]) => classifyCommand(dbc.rules, program, args);
  const bus = ["--interface", "pcan", "--channel", "PCAN_USBBUS1", "--bitrate", "500000"];
  const cases = [
    ["safe", ["--version"]],
    ["safe", ["--help"]],
    ["safe", ["-h"]],
    ["safe", ["list"]],
    ["safe", ["list", "--interfaces", "pcan,slcan"]],
    ["device-read", ["capture", ...bus, "--duration", "10", "--output", "captures/bus.asc"]],
    ["device-read", ["capture", "--output", "send.asc", ...bus, "--max-messages", "100"]],
    ["device-write", ["capture", "--interface", "gs_usb", "--channel", "0", "--active", "--duration", "5"]],
    ["device-write", ["unknown"]],
    ["irreversible", ["send", ...bus, "--id", "0x100", "--data", "FA00"]],
    ["irreversible", ["replay", ...bus, "--input", "captures/bus.asc"]],
    ["irreversible", ["--", "send", ...bus, "--id", "0x100"]],
    ["irreversible", ["--", "replay", ...bus, "--input", "x.asc"]],
    ["irreversible", ["--help", "send"]],
  ] as const;
  for (const [risk, args] of cases) expect(can([...args]).risk, args.join(" ")).toBe(risk);
  for (const word of ["send", "replay"]) {
    expect(can([word, ...bus]).confirm).toBe(word);
    expect(can(["--", word, ...bus]).confirm).toBe(word);
  }
  expect(can(["capture", ...bus, "--duration", "1"]).notes.join(" ")).toContain("listen-only");
  const cantools = [
    ["safe", ["--version"]],
    ["safe", ["--help"]],
    ["safe", ["-h"]],
    ["safe", ["dump", "board.dbc"]],
    ["safe", ["-d", "dump", "board.dbc"]],
    ["safe", ["list", "board.dbc"]],
    ["safe", ["-d", "list", "board.dbc"]],
    ["safe", ["convert", "board.dbc", "board.kcd"]],
    ["safe", ["generate_c_source", "board.dbc"]],
    ["safe", ["-d", "convert", "board.dbc", "board.kcd"]],
    ["safe", ["-d", "generate_c_source", "board.dbc"]],
    ["safe", ["dump", "decode.dbc"]],
    ["blocked", ["decode", "board.dbc"]],
    ["blocked", ["-d", "decode", "board.dbc"]],
    ["blocked", ["plot", "board.dbc"]],
    ["blocked", ["monitor", "board.dbc"]],
    ["blocked", ["-d", "plot", "board.dbc"]],
    ["blocked", ["-d", "monitor", "board.dbc"]],
    ["device-write", ["unknown"]],
  ] as const;
  for (const [risk, args] of cantools) expect(tools("cantools", [...args]).risk, args.join(" ")).toBe(risk);
  expect(tools("cantools", ["decode", "board.dbc"]).notes.join(" ")).toContain("can-decode");
  for (const args of [["--dbc", "board.dbc", "--input", "bus.asc"], ["--version"], ["--help"]])
    expect(tools("can-decode", args).risk, args.join(" ")).toBe("safe");
});

/** The toolchain's Python, which runs the scripts against the fake python-can. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();

// Each case spawns Python processes; on a slow Windows host a dozen of them exceed the default 5 s.
describe("the can script with a fake python-can", { timeout: 60_000 }, () => {
  let base: string;
  beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), "vera-can-script-")));
  });
  afterAll(async () => {
    await rm(base, { recursive: true, force: true });
  });
  /** Runs a script in a fresh folder; FAKE_CAN_RECORD collects the Bus arguments and frames it produced. */
  const run = async (
    args: string[],
    options: { frames?: string[]; openError?: string; script?: string } = {},
  ) => {
    const dir = await mkdtemp(join(base, "run-"));
    const record = join(dir, "record.jsonl");
    const result = spawnSync(python, [options.script ?? canScript, ...args], {
      cwd: dir,
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONPATH: join(fixtures, "fake-python-can"),
        PYTHONDONTWRITEBYTECODE: "1",
        PYTHONUTF8: "1",
        FAKE_CAN_RECORD: record,
        FAKE_CAN_FRAMES: JSON.stringify(options.frames ?? []),
        FAKE_CAN_OPEN_ERROR: options.openError ?? "",
      },
    });
    const records = existsSync(record)
      ? (await readFile(record, "utf8"))
          .trim()
          .split("\n")
          .map((entry) => JSON.parse(entry) as Record<string, unknown>)
      : [];
    return { code: result.status, stdout: result.stdout, stderr: result.stderr, records, dir };
  };
  const pcan = ["--interface", "pcan", "--channel", "PCAN_USBBUS1", "--bitrate", "500000"];

  it("refuses a first argument that is not a command, before opening a bus", async () => {
    for (const args of [["--", "send", ...pcan, "--id", "0x1"], ["--", "replay"], [], ["--bogus", "list"]]) {
      const result = await run(args);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.stderr).toContain("first argument must be one of");
      expect(result.records).toEqual([]);
    }
  });

  it("lists every driver with its hint without opening a bus", async () => {
    const result = await run(["list"]);
    expect(result.code, result.stderr).toBe(0);
    const listed = JSON.parse(result.stdout) as {
      configs: unknown[];
      drivers: { interface: string; hint: string }[];
    };
    expect(listed.configs).toEqual([]);
    expect(listed.drivers.map((driver) => driver.interface)).toEqual([
      "pcan",
      "vector",
      "kvaser",
      "slcan",
      "gs_usb",
      "socketcan",
    ]);
    for (const driver of listed.drivers) expect(driver.hint.length).toBeGreaterThan(40);
    expect(result.records).toEqual([]);
  });

  it("opens each backend listen-only and records the frames with a summary", async () => {
    const backends = [
      [pcan, { state: "passive" }],
      [["--interface", "vector", "--channel", "0"], { listen_only: true }],
      [["--interface", "slcan", "--channel", "COM5", "--bitrate", "500000"], { listen_only: true }],
      [["--interface", "kvaser", "--channel", "0", "--bitrate", "250000"], { driver_mode: false }],
      [["--interface", "udp_multicast", "--channel", "239.74.163.9"], {}],
      [["--interface", "socketcan", "--channel", "vcan0"], {}],
    ] as const;
    for (const [bus, switches] of backends) {
      const result = await run(["capture", ...bus, "--max-messages", "2", "--output", "bus.log"], {
        frames: ["100#FA00F00A", "200#E80301", "300#01"],
      });
      expect(result.code, result.stderr).toBe(0);
      expect(result.records[0]).toEqual({
        bus: {
          interface: bus[1],
          // Digit-only channels reach python-can as numbers, as its own configuration casting would make them.
          channel: /^\d+$/.test(bus[3]) ? Number(bus[3]) : bus[3],
          ignore_config: true,
          ...(bus[5] ? { bitrate: Number(bus[5]) } : {}),
          ...switches,
        },
      });
      expect(await readFile(join(result.dir, "bus.log"), "utf8")).toBe("100#FA00F00A\n200#E80301\n");
      const mode = Object.keys(switches).length ? "listen-only" : "software bus";
      expect(result.stderr).toContain(
        `[can] 2 frames from ${bus[1]}:${bus[3]} (${mode}) to bus.log, stopped by max-messages`,
      );
    }
  });

  it("prints candump-style lines and stops by duration without --output", async () => {
    const result = await run(
      ["capture", "--interface", "udp_multicast", "--channel", "g", "--duration", "0.5"],
      {
        frames: ["100#FA00"],
      },
    );
    expect(result.code, result.stderr).toBe(0);
    expect(result.stdout).toMatch(/^\(\d+\.\d{6}\) - 100#FA00$/m);
    expect(result.stderr).toContain(
      "1 frames from udp_multicast:g (software bus) to stdout, stopped by duration",
    );
  });

  it("refuses a capture that cannot be listen-only unless --active is given", async () => {
    for (const bus of [
      ["--interface", "gs_usb", "--channel", "0"],
      ["--interface", "socketcan", "--channel", "can0"],
    ]) {
      const refused = await run(["capture", ...bus, "--duration", "1"]);
      expect(refused.code, bus.join(" ")).toBe(2);
      expect(refused.stderr).toContain("cannot be opened listen-only");
      expect(refused.records).toEqual([]);
    }
    const gsUsb = ["--interface", "gs_usb", "--channel", "0", "--bitrate", "500000"];
    const active = await run(["capture", ...gsUsb, "--duration", "0.3", "--active"]);
    expect(active.code, active.stderr).toBe(0);
    // The fake gs_usb Bus rejects a string channel, as the real backend does.
    expect(active.records[0]).toEqual({
      bus: { interface: "gs_usb", channel: 0, ignore_config: true, bitrate: 500000 },
    });
    expect(active.stderr).toContain("(active)");
  });

  it("rejects invalid capture arguments before opening a bus", async () => {
    const udp = ["--interface", "udp_multicast", "--channel", "g"];
    const cases: [string[], string][] = [
      [["capture", ...udp], "--duration or --max-messages"],
      [["capture", ...udp, "--duration", "1", "--output", "bus.txt"], "--output must end with"],
      [["capture", ...udp, "--duration", "nan"], "--duration"],
      [["capture", ...udp, "--duration", "-1"], "--duration"],
      [["capture", ...udp, "--max-messages", "0"], "--max-messages"],
      [["capture", "--interface", "pcan", "--channel", "PCAN_USBBUS1", "--duration", "1"], "give --bitrate"],
      [
        ["capture", "--interface", "gs_usb", "--channel", "0", "--duration", "1", "--active"],
        "give --bitrate",
      ],
      [["capture", ...udp, "--duration", "1", "--output", "missing/bus.asc"], "cannot write"],
    ];
    for (const [args, message] of cases) {
      const result = await run(args);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.stderr).toContain(message);
      expect(result.records).toEqual([]);
    }
    const dir = await mkdtemp(join(base, "exists-"));
    await writeFile(join(dir, "bus.asc"), "keep");
    const existing = spawnSync(
      python,
      [canScript, "capture", ...udp, "--duration", "1", "--output", "bus.asc"],
      {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, PYTHONPATH: join(fixtures, "fake-python-can") },
      },
    );
    expect(existing.status).toBe(2);
    expect(existing.stderr).toContain("already exists");
    expect(await readFile(join(dir, "bus.asc"), "utf8")).toBe("keep");
  });

  it("reports an interface that cannot be opened with its driver hint", async () => {
    const result = await run(["capture", ...pcan, "--duration", "1", "--output", "bus.asc"], {
      openError: "PCANBasic library not found",
    });
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("cannot open pcan channel PCAN_USBBUS1: PCANBasic library not found");
    expect(result.stderr).toContain("PEAK");
    expect(existsSync(join(result.dir, "bus.asc"))).toBe(false);
  });

  it("sends a validated frame the requested number of times", async () => {
    const udp = ["--interface", "udp_multicast", "--channel", "g"];
    const sent = await run([
      "send",
      ...udp,
      "--id",
      "0x100",
      "--data",
      "FA00F00A",
      "--count",
      "3",
      "--period-ms",
      "0",
    ]);
    expect(sent.code, sent.stderr).toBe(0);
    expect(sent.records.filter((entry) => "send" in entry)).toEqual(Array(3).fill({ send: "100#FA00F00A" }));
    expect(sent.stdout).toContain("[can] sent 3 frame(s) 100#FA00F00A on udp_multicast:g");
    const fd = await run(["send", ...udp, "--fd", "--brs", "--id", "0x1", "--data", "00".repeat(12)]);
    expect(fd.code, fd.stderr).toBe(0);
    expect(fd.stdout).toContain(`001##1${"00".repeat(12)}`);
    const cases: [string[], string][] = [
      [["--id", "0xZZ"], "--id must be hexadecimal"],
      [["--id", "0x800"], "outside 0..0x7FF"],
      [["--id", "0x20000000", "--extended"], "outside 0..0x1FFFFFFF"],
      [["--id", "0x1", "--data", "0G"], "--data must be hexadecimal"],
      [["--id", "0x1", "--data", "00".repeat(9)], "at most 8"],
      [["--id", "0x1", "--fd", "--data", "00".repeat(9)], "a CAN FD frame holds"],
      [["--id", "0x1", "--brs"], "--brs needs --fd"],
      [["--id", "0x1", "--count", "0"], "--count"],
      [["--id", "0x1", "--period-ms", "-1"], "--period-ms"],
    ];
    for (const [args, message] of cases) {
      const result = await run(["send", ...udp, ...args]);
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.stderr).toContain(message);
      expect(result.records).toEqual([]);
    }
  });

  it("replays a log file up to --max-messages and refuses a missing one", async () => {
    const udp = ["--interface", "udp_multicast", "--channel", "g"];
    const dir = await mkdtemp(join(base, "replay-"));
    const log = join(dir, "frames.txt");
    await writeFile(log, "200#E80301\n7FF#AA55\n200#000000\n");
    const replayed = await run(["replay", ...udp, "--input", log, "--max-messages", "2"]);
    expect(replayed.code, replayed.stderr).toBe(0);
    expect(replayed.records.filter((entry) => "send" in entry)).toEqual([
      { send: "200#E80301" },
      { send: "7FF#AA55" },
    ]);
    expect(replayed.stdout).toContain("[can] replayed 2 frame(s)");
    const missing = await run(["replay", ...udp, "--input", join(dir, "none.asc")]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toContain("no such log file");
    expect(missing.records).toEqual([]);
  });

  it("can-decode prints scaled values with full precision", () => {
    const code =
      "import sys; sys.path.insert(0, sys.argv[1]); from can_decode import value_text; " +
      "print(value_text(52.1234567, 'V'), value_text(123456.7, None), value_text(0.1 * 3, ''), value_text(3, 'rpm'))";
    const probe = spawnSync(python, ["-c", code, join(decodeScript, "..")], {
      encoding: "utf8",
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1" },
    });
    expect(probe.status, probe.stderr).toBe(0);
    expect(probe.stdout.trim()).toBe("52.1234567 V 123456.7 0.3 3 rpm");
  });

  it("can-decode refuses missing files before loading any database", async () => {
    const dbc = join(fixtures, "board.dbc");
    for (const args of [
      ["--dbc", dbc, "--input", "none.asc"],
      ["--dbc", "none.dbc", "--input", dbc],
    ]) {
      const result = await run(args, { script: decodeScript });
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.stderr).toContain("no such file");
    }
    const id = await run(["--dbc", dbc, "--input", dbc, "--id", "zz"], { script: decodeScript });
    expect(id.code).toBe(2);
    expect(id.stderr).toContain("--id must be hexadecimal");
  });
});

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
      `sys.path.insert(0, ${JSON.stringify(join(fixtures, "fake-python-can"))})`,
      "sys.argv = args[4:]",
      'runpy.run_path(args[4], run_name="__main__")',
    ].join("\n"),
  );
  return file;
}

const step = (program: string, args: readonly string[], extra: Record<string, unknown> = {}) => ({
  toolCalls: [{ name: "run_program", args: { program, args, ...extra } }],
});
const script = (items: unknown[]) => items.map((item) => JSON.stringify(item)).join("\n");

it("waits for the typed word before a transmit starts", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-can-gate-")));
  const bench = join(root, "bench");
  const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
  let service: core.SessionService | undefined;
  let database: Awaited<ReturnType<typeof core.openDb>> | undefined;
  let provisioner: core.Provisioner | undefined;
  try {
    await mkdir(join(bench, ".vera"), { recursive: true });
    await mkdir(join(root, "scripts"));
    const send = ["send", "--interface", "virtual", "--channel", "gate", "--id", "0x100", "--data", "01"];
    await writeFile(join(root, "scripts/send.jsonl"), script([step("can", send), { text: "Sent." }]));
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(new URL("can-python/", plugins)));
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
    expect(await provisioner.install("can-python")).toEqual([
      { name: "can", kind: "script", state: "ready", version: "1.0.0" },
    ]);
    const plugin = await store.load("can-python");
    const runs = async () =>
      (await readFile(join(root, "uv.jsonl"), "utf8"))
        .trim()
        .split("\n")
        .map((line) => JSON.parse(line) as string[])
        .filter((args) => args[0] === "run" && args.includes("send"));
    const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
    await gateway.models("replay", new AbortController().signal);
    database = await core.openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
    service = new core.SessionService({
      root: bench,
      db: database.db,
      gateway,
      clock: { now: () => new Date(), sleep },
      model: () => "replay/send",
      prompt: () => "Use the CAN plugin",
      programs: { runner, clock: { sleep }, plugins: async () => [plugin], resolver: provisioner },
    });
    await service.waitReady();
    const session = service.create(null, "ask");
    const outputs: { ok: boolean; summary: string }[] = [];
    service.subscribe(session.id, 0, (_seq, event) => {
      if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
    });
    service.send(session.id, "Send one frame.");
    const pending = () => service?.get(session.id).snapshot.approvals.find((item) => !item.decision);
    await expect.poll(pending, { timeout: 60_000 }).toBeDefined();
    const approval = pending();
    if (!approval) throw Error("Expected the transmit approval");
    expect(approval.program).toMatchObject({
      program: "can",
      risk: "irreversible",
      confirm: "send",
      args: send,
    });
    const decide = (confirmation?: string) =>
      service?.decideApproval({
        sessionId: session.id,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision: "approved",
        ...(confirmation === undefined ? {} : { confirmation }),
      });
    expect(() => decide()).toThrow();
    expect(() => decide("replay")).toThrow();
    expect(await runs()).toEqual([]);
    decide("send");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    expect(await runs()).toHaveLength(1);
    expect(JSON.parse(outputs[0]?.summary ?? "{}")).toMatchObject({ exitCode: 0 });
  } finally {
    await service?.close();
    await runner.stopAll();
    provisioner?.close();
    database?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

const uv = process.env.VERA_CAN_UV;
// Explicit real acceptance: VERA_CAN_UV names a uv executable. This user-action provisioning downloads Python,
// python-can and cantools; default tests have no network or hardware dependency.
it.skipIf(!uv)(
  "captures, transmits after the typed word and decodes on a udp_multicast bus",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-can-real-")));
    const bench = join(root, "bench");
    const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
    const opened: core.SessionService[] = [];
    let database: Awaited<ReturnType<typeof core.openDb>> | undefined;
    let provisioner: core.Provisioner | undefined;
    const receipts: Record<string, unknown> = {};
    try {
      await mkdir(join(bench, ".vera"), { recursive: true });
      await mkdir(join(bench, "captures"));
      await mkdir(join(bench, "fixtures"));
      for (const name of ["board.dbc", "frames.log"])
        await copyFile(join(fixtures, name), join(bench, "fixtures", name));
      const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(root, "release"));
      expect(release.issues).toEqual([]);
      const store = new core.PluginStore({ root: join(root, "plugins") });
      for (const id of ["can-python", "can-dbc"]) await store.install(join(root, `release/${id}-1.0.0.zip`));
      provisioner = new core.Provisioner({
        store,
        root: join(root, "runtime"),
        uv: { executable: uv as string },
        host: new core.NodeProcessHost(spawn),
        platform: core.pluginPlatform(process.platform, process.arch),
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("No download program in these packages");
        },
      });
      receipts.install = [
        ...(await provisioner.install("can-python")),
        ...(await provisioner.install("can-dbc")),
      ];
      for (const status of receipts.install as { state: string }[]) expect(status.state).toBe("ready");
      const loaded = [await store.load("can-python"), await store.load("can-dbc")];
      // A group of its own keeps other multicast traffic on the segment out of the exact counts.
      const group = `239.74.${1 + Math.floor(Math.random() * 254)}.${1 + Math.floor(Math.random() * 254)}`;
      const bus = ["--interface", "udp_multicast", "--channel", group];
      const capture = (file: string) => [
        "capture",
        ...bus,
        "--max-messages",
        "5",
        "--duration",
        "90",
        "--output",
        file,
      ];
      const send = [
        "send",
        ...bus,
        "--id",
        "0x100",
        "--data",
        "FA00F00A",
        "--count",
        "2",
        "--period-ms",
        "100",
      ];
      const replay = ["replay", ...bus, "--input", "fixtures/frames.log"];
      const decode = (file: string, ...more: string[]) => [
        "--dbc",
        "fixtures/board.dbc",
        "--input",
        file,
        ...more,
      ];
      await mkdir(join(root, "scripts"));
      await writeFile(
        join(root, "scripts/capture.jsonl"),
        script([
          step("can", capture("captures/bus.asc"), { background: true }),
          step("can", capture("captures/bus.blf"), { background: true }),
          { text: "Capturing." },
        ]),
      );
      await writeFile(
        join(root, "scripts/transmit.jsonl"),
        script([step("can", send), step("can", replay), { text: "Sent." }]),
      );
      await writeFile(
        join(root, "scripts/decode.jsonl"),
        script([
          step("can", ["list"]),
          step("can-decode", decode("captures/bus.asc")),
          step("can-decode", decode("captures/bus.blf")),
          step("can-decode", decode("captures/bus.asc", "--id", "0x200", "--limit", "1", "--no-choices")),
          step("cantools", ["dump", "fixtures/board.dbc"]),
          { text: "Decoded." },
        ]),
      );
      await writeFile(
        join(root, "scripts/refuse.jsonl"),
        script([
          step("can", ["capture", "--interface", "gs_usb", "--channel", "0", "--duration", "1"]),
          step("can", [
            "capture",
            "--interface",
            "pcan",
            "--channel",
            "PCAN_USBBUS9",
            "--bitrate",
            "500000",
            "--duration",
            "1",
          ]),
          { text: "Refused." },
        ]),
      );
      const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
      await gateway.models("replay", new AbortController().signal);
      database = await core.openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
      let model = "";
      const service = new core.SessionService({
        root: bench,
        db: database.db,
        gateway,
        clock: { now: () => new Date(), sleep },
        model: () => model,
        prompt: () => "Use the CAN plugins",
        programs: { runner, clock: { sleep }, plugins: async () => loaded, resolver: provisioner },
      });
      opened.push(service);
      await service.waitReady();
      const run = (name: string, mode: "ask" | "bypass", text: string) => {
        model = `replay/${name}`;
        const session = service.create(null, mode);
        const outputs: { ok: boolean; summary: string }[] = [];
        service.subscribe(session.id, 0, (_seq, event) => {
          if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
        });
        service.send(session.id, text);
        const pending = () => service.get(session.id).snapshot.approvals.find((item) => !item.decision);
        const approve = async (confirmation?: string) => {
          await expect.poll(pending, { timeout: 60_000 }).toBeDefined();
          const approval = pending();
          if (!approval) throw Error(`Expected an approval in ${name}`);
          service.decideApproval({
            sessionId: session.id,
            approvalId: approval.approvalId,
            requestSha256: approval.requestSha256,
            decision: "approved",
            ...(confirmation === undefined ? {} : { confirmation }),
          });
          return approval.program;
        };
        return { id: session.id, outputs, approve };
      };
      const results = (outputs: { summary: string }[]) =>
        outputs.map((output) => JSON.parse(output.summary) as { exitCode: number; output: string });

      const listening = run("capture", "ask", "Capture the bus.");
      expect(await listening.approve()).toMatchObject({
        risk: "device-read",
        args: capture("captures/bus.asc"),
      });
      expect(await listening.approve()).toMatchObject({
        risk: "device-read",
        args: capture("captures/bus.blf"),
      });
      expect(await service.waitIdle(listening.id)).toEqual({ stopReason: "end" });
      const logs = listening.outputs.map((output) => (JSON.parse(output.summary) as { log: string }).log);
      expect(logs).toHaveLength(2);
      // The script creates each file just before it joins the group, so the file only bounds readiness from
      // below; the sender still needs a fresh uv and Python start after the typed word.
      for (const file of ["bus.asc", "bus.blf"])
        await expect.poll(() => existsSync(join(bench, "captures", file)), { timeout: 60_000 }).toBe(true);
      const transmit = run("transmit", "ask", "Send the status frames and replay the motor log.");
      expect(await transmit.approve("send")).toMatchObject({
        risk: "irreversible",
        confirm: "send",
        args: send,
      });
      expect(await transmit.approve("replay")).toMatchObject({ risk: "irreversible", confirm: "replay" });
      expect(await service.waitIdle(transmit.id)).toEqual({ stopReason: "end" });
      const sent = results(transmit.outputs);
      receipts.transmit = sent;
      expect(sent.map((result) => result.exitCode)).toEqual([0, 0]);
      expect(sent[0]?.output).toContain("sent 2 frame(s) 100#FA00F00A");
      expect(sent[1]?.output).toContain("replayed 3 frame(s)");
      const summaries: string[] = [];
      for (const log of logs) {
        await expect
          .poll(async () => readFile(join(bench, log), "utf8").catch(() => ""), { timeout: 60_000 })
          .toContain("stopped by max-messages");
        summaries.push(await readFile(join(bench, log), "utf8"));
      }
      receipts.captures = summaries;
      for (const [index, file] of ["captures/bus.asc", "captures/bus.blf"].entries())
        expect(summaries[index]).toContain(
          `[can] 5 frames from udp_multicast:${group} (software bus) to ${file}`,
        );

      const decoded = run("decode", "ask", "Decode the capture.");
      expect(await service.waitIdle(decoded.id)).toEqual({ stopReason: "end" });
      const [listed, asc, blf, filtered, dump] = results(decoded.outputs);
      receipts.decode = { listed, asc, blf, filtered, dump };
      expect(listed?.exitCode, listed?.output).toBe(0);
      const drivers = JSON.parse(listed?.output.slice(listed.output.indexOf("{")) ?? "{}") as {
        drivers: { interface: string; hint: string }[];
      };
      expect(drivers.drivers.map((driver) => driver.interface)).toEqual([
        "pcan",
        "vector",
        "kvaser",
        "slcan",
        "gs_usb",
        "socketcan",
      ]);
      for (const result of [asc, blf]) {
        expect(result?.exitCode, result?.output).toBe(0);
        expect(result?.output).toMatch(/100 BoardStatus Temperature=25 degC Voltage=2800 mV/);
        expect(result?.output).toMatch(/200 MotorCommand Speed=1000 rpm Enable=On/);
        expect(result?.output).toContain("BoardStatus: 2 decoded");
        expect(result?.output).toContain("MotorCommand: 2 decoded");
        expect(result?.output).toContain("unknown 7FF: 1");
      }
      expect(filtered?.exitCode, filtered?.output).toBe(0);
      expect(filtered?.output).toMatch(/200 MotorCommand Speed=1000 rpm Enable=1\r?\n/);
      expect(filtered?.output).not.toContain("BoardStatus");
      expect(filtered?.output).toContain("(printed 1 of 2 decoded frames");
      expect(dump?.exitCode, dump?.output).toBe(0);
      expect(dump?.output).toContain("BoardStatus");

      const refused = run("refuse", "bypass", "Capture without listen-only.");
      expect(await service.waitIdle(refused.id)).toEqual({ stopReason: "end" });
      const [active, missing] = results(refused.outputs);
      receipts.refuse = { active, missing };
      expect(active?.exitCode).toBe(2);
      expect(active?.output).toContain("--active");
      expect(missing?.exitCode).toBe(3);
      expect(missing?.output).toContain("PEAK");
    } finally {
      for (const service of opened) await service.close();
      await runner.stopAll();
      provisioner?.close();
      database?.close();
      await rm(root, { recursive: true, force: true });
      if (evidence)
        try {
          await mkdir(evidence, { recursive: true });
          await writeFile(
            join(evidence, `${process.platform}-can-real.json`),
            JSON.stringify(receipts, null, 2),
          );
        } catch (error) {
          console.warn("Could not write CAN evidence", error);
        }
    }
  },
  900_000,
);
