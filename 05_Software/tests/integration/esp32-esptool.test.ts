// The esp32-esptool plugin (plugins/esp32-esptool) without a board or the network. A fake uv installs a stub esptool
// (tests/fixtures/esp32-esptool/fake_esptool.py) as the pip entry point, so the real Provisioner installs, probes and
// resolves the program and the real runner starts it; serial-monitor runs its script against PLG-08's fake pyserial.

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  classifyCommand,
  type PermissionMode,
  type PluginManifest,
  type SessionEvent,
  validatePluginManifest,
} from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(software, "plugins/esp32-esptool");
const serialSource = join(software, "plugins/serial-monitor");
const fixtures = join(software, "tests/fixtures/esp32-esptool");
const fakePyserial = join(software, "tests/fixtures/serial-monitor/fake-pyserial");
const windows = process.platform === "win32";
/** The toolchain's Python (02_Tools requires 3.11+); VERA_TEST_PYTHON names another one. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();
const VERSION_5_6 = "esptool v5.6.0\n5.6.0";

let base: string;
let manifest: PluginManifest;
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/**
 * A uv stand-in. `tool install` writes the stub esptool into UV_TOOL_BIN_DIR (an .exe launcher from pip's distlib on
 * Windows, a shebang script elsewhere); `sync --script` succeeds; `run --quiet --offline --script` runs serial-monitor's
 * script in-process against the fake pyserial.
 */
async function fakeUv(dir: string, version: string) {
  const file = join(dir, "fake_uv.py");
  const serialEnv = {
    FAKE_SERIAL_SCENARIO: join(dir, "scenario.json"),
    FAKE_SERIAL_RECORD: join(dir, "serial.jsonl"),
    PYTHONDONTWRITEBYTECODE: "1",
  };
  const config = { version, record: join(dir, "esptool.jsonl") };
  await writeFile(
    file,
    [
      "import json, os, runpy, sys",
      "sys.dont_write_bytecode = True",
      "args = sys.argv[1:]",
      `with open(${JSON.stringify(join(dir, "uv.jsonl"))}, "a") as log:`,
      '    log.write(json.dumps({"args": args, "bin": os.environ.get("UV_TOOL_BIN_DIR")}) + "\\n")',
      'if args[:2] == ["tool", "install"]:',
      '    assert args[2:] == ["esptool>=5,<6"], args',
      '    target = os.environ["UV_TOOL_BIN_DIR"]',
      "    os.makedirs(target, exist_ok=True)",
      `    with open(${JSON.stringify(join(fixtures, "fake_esptool.py"))}, encoding="utf-8") as stub:`,
      `        text = stub.read().replace('CONFIG = {"version": "esptool v5.6.0\\\\n5.6.0", "record": None}', "CONFIG = " + ${JSON.stringify(JSON.stringify(config))}, 1)`,
      '    assert "esptool.jsonl" in text',
      '    if os.name == "nt":',
      "        from pip._vendor.distlib.scripts import ScriptMaker",
      `        folder = ${JSON.stringify(join(dir, "esptool-source"))}`,
      "        os.makedirs(folder, exist_ok=True)",
      '        with open(os.path.join(folder, "esptool.py"), "w", encoding="utf-8") as out: out.write(text)',
      "        maker = ScriptMaker(folder, target)",
      "        maker.executable = sys.executable",
      '        maker.variants = {""}',
      '        maker.make("esptool.py")',
      "    else:",
      '        path = os.path.join(target, "esptool")',
      '        with open(path, "w", encoding="utf-8") as out: out.write("#!" + sys.executable + "\\n" + text)',
      "        os.chmod(path, 0o755)",
      "    sys.exit(0)",
      'if args[:2] == ["sync", "--script"]: sys.exit(0)',
      'assert args[:4] == ["run", "--quiet", "--offline", "--script"], args',
      `os.environ.update(${JSON.stringify(serialEnv)})`,
      `sys.path.insert(0, ${JSON.stringify(fakePyserial)})`,
      "sys.argv = args[4:]",
      'runpy.run_path(args[4], run_name="__main__")',
    ].join("\n"),
  );
  return file;
}
async function rig(version = VERSION_5_6) {
  const dir = await mkdtemp(join(base, "run-"));
  const store = new core.PluginStore({ root: join(dir, "plugins") });
  await store.install(serialSource);
  await store.install(source);
  const uv = await fakeUv(dir, version);
  const provisioner = new core.Provisioner({
    store,
    root: join(dir, "plugins", "runtime"),
    uv: { executable: python, prefix: [uv] },
    host: new core.NodeProcessHost(spawn),
    clock: { sleep },
    platform: core.pluginPlatform(process.platform, process.arch),
    // Local only: no test reaches the network.
    fetch: async () => new Response("offline", { status: 404 }),
    settings: () => undefined,
  });
  return { dir, store, provisioner };
}
async function lines(file: string): Promise<Record<string, unknown>[]> {
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
const bin = (dir: string) =>
  join(dir, "plugins", "runtime", "tools", "esp32-esptool", "bin", windows ? "esptool.exe" : "esptool");

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "vera-esp32-esptool-")));
  manifest = parse(await readFile(join(source, "plugin.yaml"), "utf8"));
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("the plugin package", () => {
  it("installs without issues and resolves esptool from uv tool install (REQ-FUNC-b0d7c102)", async () => {
    expect(validatePluginManifest(manifest).issues).toEqual([]);
    expect(manifest).toMatchObject({ id: "esp32-esptool", ecosystem: "esp32", requires: ["serial-monitor"] });
    const { dir, store, provisioner } = await rig();
    expect((await store.list()).map((p) => [p.id, p.issues])).toEqual([
      ["esp32-esptool", []],
      ["serial-monitor", []],
    ]);
    expect(await provisioner.resolve(await store.load("esp32-esptool"), "esptool")).toBeUndefined();
    expect(await provisioner.statuses("esp32-esptool")).toMatchObject([
      { name: "esptool", state: "missing" },
    ]);
    expect(await provisioner.install("esp32-esptool")).toEqual([
      { name: "esptool", kind: "pip", state: "ready", version: "5.6.0", range: ">=5,<6" },
    ]);
    expect(await provisioner.resolve(await store.load("esp32-esptool"), "esptool")).toMatchObject({
      executable: bin(dir),
      version: "5.6.0",
    });
    expect(await lines(join(dir, "uv.jsonl"))).toEqual([
      {
        args: ["tool", "install", "esptool>=5,<6"],
        bin: join(dir, "plugins", "runtime", "tools", "esp32-esptool", "bin"),
      },
    ]);
  });
  it("reads the version from esptool version (REQ-FUNC-3b4c7274)", async () => {
    expect(manifest.programs?.esptool?.version.args).toEqual(["version"]);
    const recorded = new RegExp(manifest.programs?.esptool?.version.match ?? "^$").exec(VERSION_5_6);
    expect(recorded?.[1]).toBe("5.6.0");
    const { dir, provisioner } = await rig();
    await provisioner.install("esp32-esptool");
    const probe = spawnSync(bin(dir), ["version"], { encoding: "utf8" });
    expect(probe.stdout.replaceAll("\r\n", "\n")).toBe(`${VERSION_5_6}\n`);
  });
  it("reports an esptool outside version 5 as unavailable (REQ-REL-a69bbfc4)", async () => {
    for (const [output, state, version] of [
      ["esptool.py v4.8.1\n4.8.1", "unavailable", "4.8.1"],
      ["esptool v6.0.0\n6.0.0", "unavailable", "6.0.0"],
      ["esptool v5.0.0\n5.0.0", "ready", "5.0.0"],
    ] as const) {
      const { store, provisioner } = await rig(output);
      const [status] = await provisioner.install("esp32-esptool");
      expect(status, output).toMatchObject({ name: "esptool", state, version, range: ">=5,<6" });
      if (state === "unavailable") {
        expect(status?.problem).toBe("range");
        expect(await provisioner.resolve(await store.load("esp32-esptool"), "esptool")).toBeUndefined();
      }
    }
  }, 30_000);
});

describe("risk rules", () => {
  const classify = (...args: string[]) => classifyCommand(manifest.rules ?? [], "esptool", args);
  const global = ["--chip", "esp32s3", "--port", "COM7", "--baud", "460800"];
  const bootloader = "Resets the chip into its bootloader.";

  it("classifies commands that touch no chip as safe (REQ-SEC-bfed58fa)", () => {
    for (const args of [
      ["version"],
      ["--help"],
      ["-h"],
      ["merge-bin", "-o", "merged.bin", "0x0", "build/bootloader/bootloader.bin"],
      ["--chip", "esp32s3", "merge_bin", "-o", "merged.bin", "0x0", "a.bin"],
      ["image-info", "build/app.bin"],
      ["elf2image", "build/app.elf"],
    ])
      expect(classify(...args).risk, args.join(" ")).toBe("safe");
    for (const args of [
      ["version", "--port", "COM7"],
      ["write-flash", "--help"],
    ])
      expect(classify(...args).risk, args.join(" ")).not.toBe("safe");
  });
  it("classifies commands that read the chip as device-read (REQ-SEC-c8cf4a75)", () => {
    const reads = [
      ["chip-id"],
      ["read-mac"],
      ["flash-id"],
      ["read-flash", "0x0", "0x400000", "dump.bin"],
      ["verify-flash", "0x10000", "build/app.bin"],
      ["read-mem", "0x3ff00050"],
      ["dump-mem", "0x3ff00000", "0x100", "mem.bin"],
      ["read-flash-status"],
      ["read-flash-sfdp", "0", "4"],
      ["get-security-info"],
      ["read-sdc-chip-info"],
      ["verify-sdc-certificate", "cert.bin"],
      ["run"],
    ];
    for (const args of reads)
      for (const line of [
        [...global, ...args],
        ["--port=COM7", ...args],
        [...global, (args[0] as string).replaceAll("-", "_").toUpperCase(), ...args.slice(1)],
      ]) {
        const result = classify(...line);
        expect(result.risk, line.join(" ")).toBe("device-read");
        expect(result.notes, line.join(" ")).toContain(bootloader);
        expect(result.confirm).toBeNull();
      }
    expect(classify("--port", "COM7", "chip_id")).toEqual(classify("--port", "COM7", "chip-id"));
    expect(classify("verify-flash", "--force", "0x0", "a.bin").risk).not.toBe("device-read");
  });
  it("classifies commands that write the flash as device-write (REQ-SEC-b3fe3c10)", () => {
    const overwrite = "Overwrites firmware or data stored on the chip.";
    for (const args of [
      ["--port", "COM7", "write-flash", "0x10000", "build/app.bin"],
      ["--port", "COM7", "write_flash", "0x10000", "build/app.bin"],
      [...global, "erase-flash"],
      ["erase_region", "0x9000", "0x6000"],
    ]) {
      const result = classify(...args);
      expect(result.risk, args.join(" ")).toBe("device-write");
      expect(result.notes, args.join(" ")).toEqual([overwrite]);
      expect(result.confirm).toBeNull();
    }
    const ram = classify("--port", "COM7", "load-ram", "build/ram.bin");
    expect(ram.risk).toBe("device-write");
    expect(ram.notes).toEqual([expect.stringMatching(/RAM/)]);
    expect(classify("frobnicate")).toEqual({ risk: "device-write", notes: [], confirm: null, timeout: null });
  });
  it("classifies permanent writes and --force as irreversible (REQ-SEC-d1d8978f)", () => {
    for (const [args, word] of [
      [["--port", "COM7", "write-mem", "0x6000801c", "1"], "write-mem"],
      [["write_flash_status", "--non-volatile", "0"], "write-flash-status"],
      [["--port", "COM7", "write-flash", "--force", "0x0", "a.bin"], "--force"],
      [["erase-flash", "--force"], "--force"],
      [["erase-region", "--force", "0x0", "0x1000"], "--force"],
    ] as const) {
      const result = classify(...args);
      expect(result.risk, args.join(" ")).toBe("irreversible");
      expect(result.confirm, args.join(" ")).toBe(word);
      expect(result.notes.join(" "), args.join(" ")).toMatch(/never|for good/);
    }
    expect(classify("write-flash", "0x0", "a.bin").risk).toBe("device-write");
  });
  it("names only esptool 5.6.0 commands and classifies every one (REQ-SEC-9c665082)", async () => {
    const help = await readFile(join(fixtures, "esptool-5.6.0-help.txt"), "utf8");
    const commands = [...help.matchAll(/^│ ([a-z][a-z0-9-]+) {2,}/gm)].map((m) => m[1] as string);
    expect(commands).toContain("write-flash");
    expect(commands).toContain("chip-id");
    expect(commands.length).toBeGreaterThanOrEqual(23);
    const rules = manifest.rules ?? [];
    // A rule matches when its marker note comes back; the platform default carries no note.
    const matches = (rule: (typeof rules)[number], args: string[]) =>
      classifyCommand([{ ...rule, note: "matched" }], "esptool", args).notes.length > 0;
    for (const name of commands)
      expect(
        rules.some((rule) => matches(rule, [name]) || matches(rule, ["--port", "COM7", name])),
        name,
      ).toBe(true);
    /** Command names a rule list spells out; options and wildcards are not commands. */
    const named = (list: { match: string }[]) =>
      list.flatMap((rule) =>
        rule.match
          .split(/\s+/)
          .slice(1)
          .flatMap((token) => token.replace(/^\{|\}$/g, "").split(","))
          .filter((token) => token !== "*" && !token.startsWith("-")),
      );
    expect(named(rules).length).toBeGreaterThan(0);
    for (const name of named(rules)) expect(commands, name).toContain(name);
    // A misspelt command in a rule is caught: the name is not in the help, and the real command loses its rule.
    const misspelt = rules.map((rule) => ({
      ...rule,
      match: rule.match.replace("write-flash-status", "write-flash-statuz"),
    }));
    expect(commands).not.toContain(named(misspelt).find((name) => name.endsWith("statuz")));
    expect(
      misspelt.some(
        (rule) =>
          matches(rule, ["write-flash-status"]) || matches(rule, ["--port", "COM7", "write-flash-status"]),
      ),
    ).toBe(false);
  });
  it("lets flash transfers run 1800 seconds (REQ-FUNC-a3a042ec)", () => {
    for (const name of [
      "write-flash",
      "erase-flash",
      "erase-region",
      "read-flash",
      "verify-flash",
      "dump-mem",
    ])
      expect(classify("--port", "COM7", name).timeout, name).toBe(1800);
    expect(classify("--port", "COM7", "chip-id").timeout).toBeNull();
    expect(manifest.programs?.esptool?.timeout).toBe(120);
  });
});

describe("in VERA", () => {
  const S3 = {
    device: "COM7",
    vid: 0x303a,
    pid: 0x1001,
    serial_number: "F4:12:FA:00:11:22",
    description: "USB JTAG/serial debug unit (COM7)",
  };
  /** Offset and workbench path of each image, as esp32-flash reads them from build/flasher_args.json. */
  const IMAGES: [string, string][] = Object.entries(
    (
      JSON.parse(readFileSync(join(fixtures, "flasher_args.json"), "utf8")) as {
        flash_files: Record<string, string>;
      }
    ).flash_files,
  )
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([offset, file]) => [offset, `build/${file}`]);
  async function session(
    mode: PermissionMode,
    steps: object[],
    enabled = ["serial-monitor", "esp32-esptool"],
  ) {
    const { dir, store, provisioner } = await rig();
    const boot = (await readFile(join(software, "tests/fixtures/serial-monitor/esp32s3-boot.log"), "utf8"))
      .replaceAll("\n", "\r\n")
      .match(/[\s\S]{1,64}/g);
    await writeFile(join(dir, "scenario.json"), JSON.stringify({ ports: [S3], chunks: boot }));
    await provisioner.install("serial-monitor");
    await provisioner.install("esp32-esptool");
    const root = join(dir, "bench");
    await mkdir(join(root, ".vera"), { recursive: true });
    // A prebuilt ESP-IDF build: flasher_args.json and its images.
    await mkdir(join(root, "build", "bootloader"), { recursive: true });
    await mkdir(join(root, "build", "partition_table"), { recursive: true });
    await writeFile(
      join(root, "build", "flasher_args.json"),
      await readFile(join(fixtures, "flasher_args.json")),
    );
    for (const [index, [, file]] of IMAGES.entries())
      await writeFile(join(root, file), Buffer.alloc(4096 + index * 1000, index + 1));
    const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
    const plugins = async () => Promise.all(enabled.map((id) => store.load(id)));
    const programs: core.ProgramHost = { runner, clock: { sleep }, plugins, resolver: provisioner };
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => (await plugins()).map((p) => ({ id: p.manifest.id, folder: p.folder })),
    });
    const handle = await core.openDb(join(root, ".vera/vera.db"), {
      workbenchId: "wb_test",
      appVersion: "0",
    });
    const scripts = join(dir, "scripts");
    await mkdir(scripts);
    await writeFile(join(scripts, "flash.jsonl"), steps.map((s) => JSON.stringify(s)).join("\n"));
    const gateway = new ReplayGateway({ dir: scripts, now: () => Date.now() });
    await gateway.models("replay", new AbortController().signal);
    const service = new core.SessionService({
      root,
      db: handle.db,
      gateway,
      clock: { now: () => new Date(), sleep: async () => {} },
      model: () => "replay/flash",
      prompt: () => "Test",
      skills,
      programs,
    });
    await service.waitReady();
    const created = service.create(null, mode);
    const events: SessionEvent[] = [];
    service.subscribe(created.id, 0, (_seq, event) => events.push(event));
    const close = async () => {
      await service.close();
      await runner.stopAll();
      handle.close();
    };
    return { dir, root, service, created, events, programs, skills, handle, close };
  }
  type Rig = Awaited<ReturnType<typeof session>>;
  const run = (program: string, args: string[]) => ({
    toolCalls: [{ name: "run_program", args: { program, args } }],
  });
  const results = (events: SessionEvent[]) =>
    events.flatMap((e) => (e.type === "tool.done" ? [{ ok: e.ok, summary: e.summary }] : []));
  async function pending(rig: Rig) {
    await expect
      .poll(() => rig.service.get(rig.created.id).snapshot.approvals.find((a) => !a.decision), {
        timeout: 15_000,
      })
      .toBeDefined();
    return rig.service.get(rig.created.id).snapshot.approvals.find((a) => !a.decision);
  }
  function approve(rig: Rig, approval: Awaited<ReturnType<typeof pending>>) {
    rig.service.decideApproval({
      sessionId: rig.created.id,
      approvalId: approval?.approvalId as string,
      requestSha256: approval?.requestSha256 as string,
      decision: "approved",
    });
  }
  const sha256 = async (file: string) =>
    createHash("sha256")
      .update(await readFile(file))
      .digest("hex");
  const flash = [
    "--chip",
    "esp32s3",
    "--port",
    "COM7",
    "--baud",
    "460800",
    "--before",
    "default-reset",
    "--after",
    "hard-reset",
    "write-flash",
    "--flash-mode",
    "dio",
    "--flash-size",
    "2MB",
    "--flash-freq",
    "80m",
    ...IMAGES.flat(),
  ];

  it("identifies, flashes with the image hashes and captures the boot log (REQ-TEST-fe972de0, REQ-DATA-b4e317de)", async () => {
    // The boot-log capture is the one esp32-flash tells the agent to run.
    const skill = await readFile(join(source, "skills/esp32-flash/SKILL.md"), "utf8");
    const until = /serial capture --port P --reset --until "([^"]+)" --duration 10/.exec(skill)?.[1];
    expect(until).toBeDefined();
    const rig = await session("ask", [
      run("serial", ["list"]),
      run("esptool", ["--port", "COM7", "chip-id"]),
      run("esptool", flash),
      run("serial", ["capture", "--port", "COM7", "--reset", "--until", until as string, "--duration", "10"]),
      { text: "Flashed" },
    ]);
    try {
      expect(IMAGES).toEqual([
        ["0x0", "build/bootloader/bootloader.bin"],
        ["0x8000", "build/partition_table/partition-table.bin"],
        ["0x10000", "build/hello_world.bin"],
      ]);
      rig.service.send(rig.created.id, "Identify the board, flash the build and show the boot log");
      const identify = await pending(rig);
      expect(identify?.program).toMatchObject({
        pluginId: "esp32-esptool",
        program: "esptool",
        programVersion: "5.6.0",
        risk: "device-read",
        notes: ["Resets the chip into its bootloader."],
      });
      approve(rig, identify);
      const write = await pending(rig);
      expect(write?.approvalId).not.toBe(identify?.approvalId);
      expect(write?.program).toMatchObject({ risk: "device-write", args: flash, confirm: null });
      const hashes = await Promise.all(IMAGES.map(async ([, file]) => sha256(join(rig.root, file))));
      expect(write?.program?.files).toEqual(
        IMAGES.map(([, file], index) => ({ arg: flash.indexOf(file), path: file, sha256: hashes[index] })),
      );
      approve(rig, write);
      const capture = await pending(rig);
      expect(capture?.program).toMatchObject({
        pluginId: "serial-monitor",
        program: "serial",
        risk: "device-read",
      });
      approve(rig, capture);
      expect(await rig.service.waitIdle(rig.created.id)).toEqual({ stopReason: "end" });
      const done = results(rig.events);
      expect(JSON.parse(done[0]?.summary ?? "{}")).toMatchObject({ risk: "safe" });
      expect(JSON.parse(done[1]?.summary ?? "{}")).toMatchObject({
        exitCode: 0,
        risk: "device-read",
        output: expect.stringContaining("Chip type:          ESP32-S3"),
      });
      const flashed = JSON.parse(done[2]?.summary ?? "{}");
      expect(flashed).toMatchObject({ exitCode: 0, risk: "device-write" });
      expect(flashed.output.match(/Hash of data verified\./g)).toHaveLength(3);
      const booted = JSON.parse(done[3]?.summary ?? "{}");
      expect(booted).toMatchObject({ exitCode: 0, output: expect.stringContaining("rst:0x1 (POWERON)") });
      expect(booted.output).toContain("main_task: Calling app_main()");
      const runs = await lines(join(rig.dir, "esptool.jsonl"));
      expect(runs.map((r) => r.args)).toEqual([["--port", "COM7", "chip-id"], flash]);
      expect(runs[1]?.files).toEqual(Object.fromEntries(IMAGES.map(([, file], i) => [file, hashes[i]])));
      expect(rig.handle.db.prepare("SELECT decided_by FROM approvals").all()).toEqual([
        { decided_by: "user" },
        { decided_by: "user" },
        { decided_by: "user" },
      ]);
    } finally {
      await rig.close();
    }
  }, 60_000);
  it("needs a new approval for an image rebuilt after approval (REQ-SEC-f98d4fd3)", async () => {
    const rig = await session("ask", [run("esptool", flash), { text: "Stopped" }]);
    try {
      rig.service.send(rig.created.id, "Flash the build");
      const write = await pending(rig);
      await writeFile(join(rig.root, "build", "hello_world.bin"), Buffer.alloc(6000, 9));
      approve(rig, write);
      await rig.service.waitIdle(rig.created.id);
      expect(results(rig.events)[0]).toMatchObject({
        ok: false,
        summary: expect.stringMatching(/changed after approval/),
      });
      expect(await lines(join(rig.dir, "esptool.jsonl"))).toEqual([]);
    } finally {
      await rig.close();
    }
  }, 60_000);
  it("refuses chip-id in read-only without starting esptool (REQ-TEST-fe972de0)", async () => {
    const rig = await session("read-only", [run("esptool", ["--port", "COM7", "chip-id"]), { text: "No" }]);
    try {
      rig.service.send(rig.created.id, "Identify");
      await rig.service.waitIdle(rig.created.id);
      expect(results(rig.events)[0]).toMatchObject({
        ok: false,
        summary: expect.stringMatching(/device-read.*read-only/),
      });
      expect(await lines(join(rig.dir, "esptool.jsonl"))).toEqual([]);
    } finally {
      await rig.close();
    }
  }, 60_000);
  it("offers esp32-flash and names it in the esptool entry (REQ-UX-6a22c4dc)", async () => {
    const rig = await session("ask", [{ text: "Hi" }]);
    try {
      const skills = await rig.skills.list();
      expect(
        skills.filter((s) => s.plugin === "esp32-esptool").map((s) => [s.name, s.source, s.error]),
      ).toEqual([["esp32-flash", "plugin", undefined]]);
      expect(await core.programPromptEntries(rig.programs, skills)).toContainEqual(
        expect.objectContaining({
          name: "esptool",
          plugin: "esp32-esptool",
          version: "5.6.0",
          skills: ["esp32-flash"],
        }),
      );
    } finally {
      await rig.close();
    }
    const disabled = await session("ask", [{ text: "Hi" }], ["serial-monitor"]);
    try {
      expect((await disabled.skills.list()).filter((s) => s.plugin === "esp32-esptool")).toEqual([]);
    } finally {
      await disabled.close();
    }
    const skill = await readFile(join(source, "skills/esp32-flash/SKILL.md"), "utf8");
    for (const text of [
      "flasher_args.json",
      "flash_files",
      "--port",
      "--chip",
      "encrypted",
      "CONFIG_SECURE",
      "Hash of data verified",
      "verify-flash",
      "serial capture --port",
      "serial list",
    ])
      expect(skill, text).toContain(text);
  }, 60_000);
});
