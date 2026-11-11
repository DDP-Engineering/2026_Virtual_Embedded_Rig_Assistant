// The microchip-pymcuprog plugin without a board. Default tests check the package, the rules over pymcuprog's
// parsed arguments and the typed confirmation of a fuse write through a replay session with a stub resolver.
// VERA_MCU_UV names a real uv: the opt-in test provisions pymcuprog from PyPI and runs it without hardware.
import { spawn, spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";

const plugins = new URL("../../plugins/", import.meta.url);
const source = new URL("microchip-pymcuprog/", plugins);
const hex = fileURLToPath(new URL("../fixtures/microchip/app.hex", import.meta.url));
const manifest = async (): Promise<PluginManifest> =>
  parse(await readFile(new URL("plugin.yaml", source), "utf8"));
const windows = process.platform === "win32";
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const evidence = process.env.VERA_TEST_EVIDENCE_DIR;
const actions = [
  "ping",
  "erase",
  "read",
  "write",
  "verify",
  "getvoltage",
  "getsupplyvoltage",
  "reboot-debugger",
  "setsupplyvoltage",
  "getusbvoltage",
  "reset",
  "makeuf2",
];

it("publishes the official pip package, its pack and two installed skills", async () => {
  const m = await manifest();
  expect(validatePluginManifest(m).issues).toEqual([]);
  expect(m).toMatchObject({
    id: "microchip-pymcuprog",
    ecosystem: "microchip",
    platforms: ["windows-x64", "linux-x64"],
  });
  expect(m.programs.pymcuprog).toMatchObject({
    install: { pip: "pymcuprog>=3.19,<4" },
    version: { args: ["--version"], match: "^pymcuprog version (\\d+(?:\\.\\d+)+)", range: ">=3.19,<4" },
    optionSyntax: "pymcuprog",
  });
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("microchip-pymcuprog");
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs).toContainEqual({
    id: "microchip",
    name: "Microchip (AVR, PIC)",
    groups: [{ name: "Programming (pymcuprog)", plugins: ["microchip-pymcuprog"], default: true }],
  });
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-mcu-skills-")));
  try {
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(source));
    const plugin = await store.load("microchip-pymcuprog");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: plugin.manifest.id, folder: plugin.folder }],
    });
    const listed = (await skills.list()).filter((skill) => skill.plugin === "microchip-pymcuprog");
    expect(listed.map((skill) => skill.name)).toEqual(["microchip-flash", "microchip-fuses"]);
    const flash = (await skills.read("plugin", "microchip-flash")).content;
    for (const text of ["pymcuprog ping", "--verify", "-f ", "read -m flash", "write"])
      expect(flash).toContain(text);
    const fuses = (await skills.read("plugin", "microchip-fuses")).content;
    for (const text of ["read -m fuses", "write -m fuses -o", "lockbits", "one fuse", "typed"])
      expect(fuses).toContain(text);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("classifies pymcuprog commands from their parsed arguments", async () => {
  const m = await manifest();
  const classify = (args: string[]) =>
    classifyCommand(m.rules, "pymcuprog", args, m.programs.pymcuprog?.optionSyntax);
  const kit = ["-t", "uart", "-u", "COM5", "-d", "attiny416"];
  const cases = [
    // Information and offline conversion.
    ["safe", ["--version"]],
    ["safe", ["-V"]],
    ["safe", ["-R"]],
    ["safe", ["--release-info"]],
    ["safe", ["--vers"]],
    ["safe", ["--help"]],
    ["safe", ["-h"]],
    ["safe", ["-f", "app.hex", "makeuf2"]],
    ["safe", ["makeuf2", "-f", "app.hex"]],
    ["safe", ["makeuf2", "-f", "app.hex", "--uf2file", "app.uf2"]],
    // Reads touch the target.
    ["device-read", ["ping", ...kit]],
    ["device-read", [...kit, "ping"]],
    ["device-read", ["read", "-m", "flash", "-o", "0x80", "-b", "64", ...kit]],
    ["device-read", ["read", "-m", "fuses", ...kit]],
    ["device-read", ["read", "-f", "dump.hex", ...kit]],
    ["device-read", ["verify", "-f", "app.hex", ...kit]],
    ["device-read", ["getvoltage"]],
    ["device-read", ["getsupplyvoltage"]],
    ["device-read", ["getusbvoltage"]],
    ["device-read", ["reset", ...kit]],
    ["device-read", ["-xv", "info", "ping"]],
    ["device-read", ["-d", "attiny416", "read", "-m", "flash", "-o", "-1"]],
    ["device-read", ["-t", "uart", "verify", "-f", "app.hex"]],
    ["device-read", ["-t", "nedbg", "getvoltage"]],
    ["device-read", ["-x", "getsupplyvoltage"]],
    ["device-read", ["-v", "info", "getusbvoltage"]],
    ["device-read", ["-t", "uart", "reset"]],
    // Ordinary writes and erases.
    ["device-write", ["write", "-m", "flash", "-o", "0", "-l", "0x01", "0x02", ...kit]],
    ["device-write", ["write", "-m", "eeprom", "-l", "0x01"]],
    ["device-write", ["write", "--memory=user_row", "-l", "0x01"]],
    ["device-write", ["write", "-meeprom", "-l", "0x01"]],
    ["device-write", ["write", "-m", "flash", "-f", "app.bin"]],
    ["device-write", ["erase", ...kit]],
    ["device-write", ["erase", "-m", "eeprom", ...kit]],
    ["device-write", ["erase", "--chip-erase-locked-device", ...kit]],
    ["device-write", ["erase", "-C"]],
    ["device-write", ["write", "-m", "user_row", "-U", "-l", "0x01"]],
    ["device-write", ["reboot-debugger"]],
    ["device-write", ["-t", "pickit4", "reboot-debugger"]],
    ["device-write", ["-d", "attiny416", "erase"]],
    ["device-write", ["write", "-m=eeprom", "-l=0x01"]],
    ["device-write", ["write", "-m", "fuses", "-m", "eeprom", "-l", "0x01"]],
    ["device-write", ["write", "-m", "flash", "-l", "-1"]],
    ["device-write", ["ping", "--no-such-option"]],
    ["device-write", ["ping", "--ver"]],
    ["device-write", ["ping", "-m"]],
    ["device-write", ["flash"]],
    ["device-write", ["-l", "0x01", "write"]],
    ["device-write", []],
    // Protection memories, the default memory and hex files.
    ["irreversible", ["write", "-m", "fuses", "-o", "1", "-l", "0xE0", ...kit]],
    ["irreversible", ["write", "-mfuses", "-l", "0xE0"]],
    ["irreversible", ["write", "--memory", "lockbits", "-l", "0x00"]],
    ["irreversible", ["write", "--memory=config_words", "-l", "0x00"]],
    ["irreversible", ["write", "--mem", "FUSES", "-l", "0x00"]],
    ["irreversible", ["write", "-xmfuses", "-l", "0x00"]],
    ["irreversible", ["write", "-m=fuses", "-o", "1", "-l", "0xE0"]],
    ["irreversible", ["write", "-m=lockbits", "-l", "0x00"]],
    ["irreversible", ["write", "-xm=fuses", "-l", "0x00"]],
    ["irreversible", ["write", "-m", "flash", "-m=fuses", "-l", "0x00"]],
    ["irreversible", ["erase", "-m=config_words"]],
    ["irreversible", ["erase", "-m", "config_words"]],
    ["irreversible", ["-l=0x01", "write"]],
    ["irreversible", ["write", "-f=app.hex"]],
    ["irreversible", ["write", "-fapp.hex"]],
    ["irreversible", ["-t", "nedbg", "setsupplyvoltage", "-l", "3.3"]],
    ["irreversible", ["ping", "-H=tool-toggle-power"]],
    ["irreversible", ["-m", "lockbits", "-l", "0x00", "-t", "uart", "write"]],
    ["irreversible", ["write", "-m", "all", "-l", "0x00"]],
    ["irreversible", ["write", "-l", "0x00"]],
    ["irreversible", ["-l0x01", "write"]],
    ["irreversible", ["--literal=0x01", "write"]],
    ["irreversible", ["--lit", "0x01", "0x02", "-t", "uart", "write"]],
    ["irreversible", ["write", "-f", "app.hex", ...kit]],
    ["irreversible", ["write", "-f", "APP.HEX", "--erase", "--verify"]],
    ["irreversible", ["write", "--filename=build/app.hex", "--verify"]],
    ["irreversible", ["erase", "-m", "fuses"]],
    ["irreversible", ["erase", "--memory", "lockbits"]],
    ["irreversible", ["-V", "write", "-m", "fuses", "-l", "0x00"]],
    // After -- every word is positional: a second positional is an argparse error, so nothing runs.
    ["device-write", ["write", "-m", "flash", "-l", "0x01", "--", "-m"]],
    ["device-read", ["--", "ping"]],
    // Physical outputs.
    ["irreversible", ["setsupplyvoltage", "-l", "3.3"]],
    ["irreversible", ["ping", "-H", "tool-toggle-power", ...kit]],
    ["irreversible", ["read", "--high-voltage", "simple-unsafe-pulse", "-m", "flash"]],
    ["irreversible", ["ping", "--high", "user-toggle-power"]],
    ["irreversible", ["ping", "-xHsimple-unsafe-pulse"]],
  ] as const;
  for (const [risk, args] of cases) expect(classify([...args]).risk, args.join(" ")).toBe(risk);
  for (const action of ["write", "erase"]) expect(classify([action, "-m", "fuses"]).confirm).toBe(action);
  expect(classify(["setsupplyvoltage", "-l", "3.3"]).confirm).toBe("setsupplyvoltage");
  for (const action of actions) expect(classify([action, "-H", "tool-toggle-power"]).confirm).toBe(action);
  expect(classify(["write", "-f", "app.hex"]).notes.join(" ")).toContain("hex file");
  expect(classify(["write", "-m", "lockbits", "-l", "0"]).notes.join(" ")).toContain("lock");
});

/** The toolchain's Python, which runs a fake pymcuprog that only records its arguments. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();

const step = (args: readonly string[]) => ({
  toolCalls: [{ name: "run_program", args: { program: "pymcuprog", args } }],
});
const script = (items: unknown[]) => items.map((item) => JSON.stringify(item)).join("\n");

it("waits for the typed word before a fuse write starts", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-mcu-gate-")));
  const bench = join(root, "bench");
  const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
  let service: core.SessionService | undefined;
  let database: Awaited<ReturnType<typeof core.openDb>> | undefined;
  try {
    await mkdir(join(bench, ".vera"), { recursive: true });
    await mkdir(join(root, "scripts"));
    const record = join(root, "runs.jsonl");
    const fake = join(root, "fake_pymcuprog.py");
    await writeFile(
      fake,
      [
        "import json, sys",
        `with open(${JSON.stringify(record)}, "a") as log: log.write(json.dumps(sys.argv[1:]) + "\\n")`,
        'print("Pinging device...")',
      ].join("\n"),
    );
    const write = [
      "write",
      "-m",
      "fuses",
      "-o",
      "1",
      "-l",
      "0xE0",
      "-t",
      "uart",
      "-u",
      "COM5",
      "-d",
      "attiny416",
    ];
    const ping = ["ping", "-t", "uart", "-u", "COM5", "-d", "attiny416"];
    await writeFile(
      join(root, "scripts/fuse.jsonl"),
      script([step(ping), step(write), { text: "Fuse written." }]),
    );
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(fileURLToPath(source));
    const plugin = await store.load("microchip-pymcuprog");
    const resolver: core.ProgramResolver = { resolve: async () => ({ executable: python, prefix: [fake] }) };
    const runs = async () =>
      (await readFile(record, "utf8").catch(() => ""))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
    const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
    await gateway.models("replay", new AbortController().signal);
    database = await core.openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
    service = new core.SessionService({
      root: bench,
      db: database.db,
      gateway,
      clock: { now: () => new Date(), sleep },
      model: () => "replay/fuse",
      prompt: () => "Use the Microchip plugin",
      programs: { runner, clock: { sleep }, plugins: async () => [plugin], resolver },
    });
    await service.waitReady();
    const session = service.create(null, "auto-edit");
    service.send(session.id, "Ping the board and set fuse 1 to 0xE0.");
    const pending = () => service?.get(session.id).snapshot.approvals.find((item) => !item.decision);
    await expect.poll(pending, { timeout: 60_000 }).toBeDefined();
    const approval = pending();
    if (!approval) throw Error("Expected the fuse write approval");
    // auto-edit runs the device-read ping by mode; the irreversible write still waits for the word.
    expect(await runs()).toEqual([ping]);
    expect(approval.program).toMatchObject({
      program: "pymcuprog",
      risk: "irreversible",
      confirm: "write",
      args: write,
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
    expect(() => decide("fuses")).toThrow();
    expect(await runs()).toEqual([ping]);
    decide("write");
    expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
    expect(await runs()).toEqual([ping, write]);
  } finally {
    await service?.close();
    await runner.stopAll();
    database?.close();
    await rm(root, { recursive: true, force: true });
  }
}, 120_000);

const uv = process.env.VERA_MCU_UV;
// Explicit real acceptance: VERA_MCU_UV names a uv executable. This user-action provisioning downloads Python and
// pymcuprog; no step touches hardware (makeuf2 converts a file; the ping names a serial port that does not exist).
it.skipIf(!uv)(
  "provisions real pymcuprog, converts a hex file and fails a ping without a board",
  async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-mcu-real-")));
    const bench = join(root, "bench");
    const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
    let service: core.SessionService | undefined;
    let database: Awaited<ReturnType<typeof core.openDb>> | undefined;
    let provisioner: core.Provisioner | undefined;
    const receipts: Record<string, unknown> = {};
    try {
      await mkdir(join(bench, ".vera"), { recursive: true });
      await copyFile(hex, join(bench, "app.hex"));
      const release = await core.buildCatalogRelease(fileURLToPath(plugins), join(root, "release"));
      expect(release.issues).toEqual([]);
      const store = new core.PluginStore({ root: join(root, "plugins") });
      await store.install(join(root, "release/microchip-pymcuprog-1.0.0.zip"));
      provisioner = new core.Provisioner({
        store,
        root: join(root, "runtime"),
        uv: { executable: uv as string },
        host: new core.NodeProcessHost(spawn),
        platform: core.pluginPlatform(process.platform, process.arch),
        clock: { sleep },
        settings: () => undefined,
        fetch: async () => {
          throw Error("No download program in this package");
        },
      });
      const statuses = await provisioner.install("microchip-pymcuprog");
      receipts.install = statuses;
      expect(statuses).toEqual([
        expect.objectContaining({
          name: "pymcuprog",
          kind: "pip",
          state: "ready",
          version: expect.stringMatching(/^3\.19\./),
        }),
      ]);
      const plugin = await store.load("microchip-pymcuprog");
      const missing = windows ? "COM250" : "/dev/ttyVERA250";
      const ping = ["ping", "-t", "uart", "-u", missing, "-d", "attiny416"];
      await mkdir(join(root, "scripts"));
      await writeFile(
        join(root, "scripts/real.jsonl"),
        script([
          step(["--version"]),
          step(["makeuf2", "-f", "app.hex", "--uf2file", "app.uf2"]),
          step(ping),
          { text: "Done." },
        ]),
      );
      const gateway = new ReplayGateway({ dir: join(root, "scripts"), now: Date.now });
      await gateway.models("replay", new AbortController().signal);
      database = await core.openDb(join(bench, ".vera/vera.db"), { workbenchId: "wb_test", appVersion: "0" });
      service = new core.SessionService({
        root: bench,
        db: database.db,
        gateway,
        clock: { now: () => new Date(), sleep },
        model: () => "replay/real",
        prompt: () => "Use the Microchip plugin",
        programs: { runner, clock: { sleep }, plugins: async () => [plugin], resolver: provisioner },
      });
      await service.waitReady();
      const session = service.create(null, "ask");
      const outputs: { ok: boolean; summary: string }[] = [];
      service.subscribe(session.id, 0, (_seq, event) => {
        if (event.type === "tool.done") outputs.push({ ok: event.ok, summary: event.summary });
      });
      service.send(session.id, "Convert the image and ping the board.");
      const pending = () => service?.get(session.id).snapshot.approvals.find((item) => !item.decision);
      await expect.poll(pending, { timeout: 120_000 }).toBeDefined();
      const approval = pending();
      if (!approval) throw Error("Expected the ping approval");
      expect(approval.program).toMatchObject({ risk: "device-read", args: ping });
      // The safe version and conversion ran before the approval.
      expect(outputs).toHaveLength(2);
      service.decideApproval({
        sessionId: session.id,
        approvalId: approval.approvalId,
        requestSha256: approval.requestSha256,
        decision: "approved",
      });
      expect(await service.waitIdle(session.id)).toEqual({ stopReason: "end" });
      const results = outputs.map(
        (output) => JSON.parse(output.summary) as { exitCode: number; output: string },
      );
      receipts.results = results;
      expect(results[0]?.output).toMatch(/pymcuprog version 3\.19\./);
      expect(results[1]?.exitCode, results[1]?.output).toBe(0);
      expect(results[1]?.output).toContain("Converted app.hex to app.uf2");
      expect((await readFile(join(bench, "app.uf2"))).byteLength % 512).toBe(0);
      expect(results[2]?.exitCode).not.toBe(0);
      expect(results[2]?.output).toMatch(/could not open port|Unable to open serial port/i);
    } finally {
      await service?.close();
      await runner.stopAll();
      provisioner?.close();
      database?.close();
      await rm(root, { recursive: true, force: true });
      if (evidence)
        try {
          await mkdir(evidence, { recursive: true });
          await writeFile(
            join(evidence, `${process.platform}-mcu-real.json`),
            JSON.stringify(receipts, null, 2),
          );
        } catch (error) {
          console.warn("Could not write Microchip evidence", error);
        }
    }
  },
  900_000,
);
