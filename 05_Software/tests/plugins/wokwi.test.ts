// The wokwi plugin's wokwi-tool against a scripted fake wokwi-cli (tests/support/fake-wokwi-cli.py), including Stop
// through VERA's real runner. No test reaches Wokwi's cloud and no Wokwi account or token is used: this is evidence
// for the helper's offline checks, job binding, token handling and outcome mapping, not for a cloud simulation, an
// electrical test or a real board. An opt-in block runs the real wokwi-cli 0.29.1 offline (VERA_TEST_WOKWI_CLI).
// The toolchain Python needs PyYAML 6.0.3 (environment.md).
// REQ-DATA-d985bb3d REQ-PLAT-59efa984 REQ-FUNC-718d9e1b REQ-FUNC-447f33d6 REQ-SEC-1b90a69a REQ-FUNC-380b0542
// REQ-FUNC-c9e7ad20 REQ-FUNC-0d39321d REQ-DATA-14b295ed REQ-SEC-11ca382d REQ-SEC-450de6ab REQ-SEC-fa87b102
// REQ-SEC-3ab66bb9 REQ-SEC-046ce69f REQ-SEC-c0479ece REQ-FUNC-4ba54556 REQ-REL-85779c4c REQ-REL-fb090330
// REQ-REL-88c06ac8 REQ-REL-6d7d4558 REQ-DATA-6e0fbd5a REQ-REL-01c5b557 REQ-FUNC-3c5b6470 REQ-FUNC-5576edcd
// REQ-FUNC-1b2f02bd REQ-TEST-dce7445c
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = fileURLToPath(new URL("../../", import.meta.url));
const pluginFolder = join(software, "plugins", "wokwi");
const script = join(pluginFolder, "scripts", "wokwi_tool.py");
const fake = join(software, "tests", "support", "fake-wokwi-cli.py");
const windows = process.platform === "win32";
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
const sha = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
// biome-ignore lint/suspicious/noExplicitAny: printed JSON documents, checked field by field.
type Json = Record<string, any>;

/** The toolchain's Python, which runs wokwi-tool and the fake CLI; it needs PyYAML 6.0.3. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-I", "-c", "import sys, yaml; print(sys.executable)"], {
    encoding: "utf8",
  });
  if (found.status !== 0)
    throw new Error(`These tests need Python 3.11+ with PyYAML 6.0.3 as ${name}: ${found.stderr}`);
  return found.stdout.trim();
})();

const TOKEN = "wk-ci-Tok3n-55160e0d-secret";
const HEX = ":100000000C9434000C943E000C943E000C943E0082\n:00000001FF\n";
const ELF = Buffer.concat([Buffer.from([0x7f, 0x45, 0x4c, 0x46, 1, 1, 1]), Buffer.alloc(57)]);
const DIAGRAM = {
  version: 1,
  author: "VERA test",
  editor: "wokwi",
  parts: [
    { type: "wokwi-arduino-uno", id: "uno", top: 0, left: 0, attrs: {} },
    { type: "wokwi-led", id: "led1", top: 0, left: 0, attrs: { color: "red" } },
    { type: "wokwi-pushbutton", id: "btn1", top: 0, left: 0, attrs: {} },
  ],
  connections: [
    ["uno:13", "led1:A", "green", []],
    ["led1:C", "uno:GND.1", "black", []],
    ["btn1:1.l", "uno:2", "blue", []],
    ["uno:0", "$serialMonitor:RX", "", []],
  ],
  dependencies: {},
};
const SCENARIO = [
  "name: Blink and button",
  "version: 1",
  "steps:",
  "  - wait-serial: ready",
  "  - set-control:",
  "      part-id: btn1",
  "      control: pressed",
  "      value: 1",
  "  - delay: 500ms",
  "  - expect-pin:",
  "      part-id: led1",
  "      pin: A",
  "      value: 1",
  "",
].join("\n");

const roots: string[] = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

/** A workbench `work/` with an Arduino Uno project whose firmware an arduino-tool compile run produced. */
async function bench(script_: Json = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-wokwi-")));
  roots.push(root);
  const work = join(root, "work");
  const project = join(work, "proj");
  const compile = join(work, "arduino-iot-results", "20261114T100000Z-compile-ab12");
  await mkdir(join(compile, "binary"), { recursive: true });
  await mkdir(project, { recursive: true });
  await writeFile(join(compile, "binary", "Blink.ino.hex"), HEX);
  await writeFile(join(compile, "binary", "Blink.ino.elf"), ELF);
  await writeFile(
    join(compile, "result.json"),
    JSON.stringify({
      format: 1,
      operation: "compile",
      fqbn: "arduino:avr:uno",
      binaries: [
        { path: "binary/Blink.ino.hex", sha256: sha(HEX), bytes: HEX.length },
        { path: "binary/Blink.ino.elf", sha256: sha(ELF), bytes: ELF.length },
      ],
    }),
  );
  await writeFile(join(project, "diagram.json"), JSON.stringify(DIAGRAM));
  await writeFile(join(project, "scenario.yaml"), SCENARIO);
  await writeFile(
    join(project, "wokwi.toml"),
    "[wokwi]\nversion = 1\nfirmware = '../arduino-iot-results/20261114T100000Z-compile-ab12/binary/Blink.ino.hex'\nelf = '../arduino-iot-results/20261114T100000Z-compile-ab12/binary/Blink.ino.elf'\n",
  );
  await mkdir(join(project, "sdcard"));
  await writeFile(join(project, "sdcard", "secret.txt"), "never sent");
  const scenarioPath = join(root, "scenario.json");
  const write = (next: Json) => writeFile(scenarioPath, JSON.stringify(next));
  await write(script_);
  await mkdir(join(root, "bin"));
  const tool = join(root, "bin", windows ? "wokwi-cli.cmd" : "wokwi-cli");
  await writeFile(
    tool,
    windows ? `@"${python}" "${fake}" %*\r\n` : `#!/bin/sh\nexec "${python}" "${fake}" "$@"\n`,
  );
  if (!windows) await chmod(tool, 0o755);
  const env = (extra: Json = {}) => ({
    ...process.env,
    PYTHONDONTWRITEBYTECODE: "1",
    VERA_PROGRAM_WOKWI_CLI: tool,
    VERA_FAKE_WOKWI: scenarioPath,
    ...extra,
  });
  const run = (args: string[], options: { input?: string; env?: Json } = {}) => {
    const result = spawnSync(python, ["-I", script, ...args], {
      cwd: work,
      encoding: "utf8",
      env: env(options.env),
      ...(options.input === undefined ? { stdio: ["ignore", "pipe", "pipe"] } : { input: options.input }),
    });
    let doc: Json = {};
    try {
      doc = JSON.parse(result.stdout) as Json;
    } catch {
      doc = {};
    }
    return { code: result.status, doc, stdout: result.stdout, stderr: result.stderr };
  };
  const calls = (): Json[] =>
    existsSync(`${scenarioPath}.calls.jsonl`)
      ? readFileSync(`${scenarioPath}.calls.jsonl`, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line))
      : [];
  const simulations = () => calls().filter((call) => call.argv[0] === "send");
  const prepare = (extra: string[] = ["--scenario", "proj/scenario.yaml"], runId = "job-1") =>
    run([
      "prepare-job",
      "--project",
      "proj",
      "--account",
      "ci",
      "--virtual-timeout-ms",
      "5000",
      "--run-id",
      runId,
      ...extra,
    ]);
  const line = (fields: Json = {}) =>
    `${JSON.stringify({ format: 1, scope: "wokwi", ref: "ci", password: TOKEN, ...fields })}\n`;
  /** `input` null starts the helper with stdin closed. */
  const simulate = (jobId = "job-1", runId = "run-1", input: string | null = line(), extra: string[] = []) =>
    run(
      [
        "run-scenario",
        "--job",
        `arduino-iot-results/${jobId}/job.json`,
        "--credential",
        "ci",
        "--run-id",
        runId,
        ...extra,
      ],
      input === null ? {} : { input },
    );
  return {
    root,
    work,
    project,
    compile,
    scenarioPath,
    write,
    tool,
    env,
    run,
    calls,
    simulations,
    prepare,
    line,
    simulate,
  };
}

async function tree(folder: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    out[path.slice(folder.length)] = sha(await readFile(path));
  }
  return out;
}
const files = async (folder: string) =>
  Promise.all(
    (await readdir(folder, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => readFile(join(entry.parentPath, entry.name), "utf8")),
  );

describe("manifest", () => {
  it("pins wokwi-cli 0.29.1 by SHA-256, blocks it and rates only run-scenario irreversible (REQ-PLAT-59efa984, REQ-SEC-c0479ece)", () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues ?? []).toEqual([]);
    const cli = m.programs["wokwi-cli"] as Json;
    expect(cli.install.download["windows-x64"]).toEqual({
      url: "https://github.com/wokwi/wokwi-cli/releases/download/v0.29.1/wokwi-cli-win-x64.exe",
      sha256: "45292e3c4f32ba4cfbcc7a457a6df48aad95fdb3269a218cb83423da9dc483b2",
      path: "wokwi-cli.exe",
      bytes: 46728248,
    });
    expect(cli.install.download["linux-x64"].sha256).toBe(
      "3c9d6da007d008a3822ab468318037285440055132c59fd659d7306e40f14258",
    );
    expect(cli.install.preferDownload).toBe(true);
    const tool = m.programs["wokwi-tool"] as Json;
    expect(tool.uses).toEqual(["wokwi-cli"]);
    expect(tool.credentials).toEqual({ option: "--credential", scope: "wokwi" });
    const risk = (program: string, args: string[]) => classifyCommand(m.rules, program, args).risk;
    for (const args of [["lint", "x"], ["mcp"], ["."], ["init"]])
      expect(risk("wokwi-cli", args)).toBe("blocked");
    expect(risk("wokwi-tool", ["run-scenario", "--job", "x", "--credential", "y"])).toBe("irreversible");
    for (const operation of [
      "capabilities",
      "inspect-project",
      "validate-diagram",
      "prepare-job",
      "collect-results",
      "report",
    ])
      expect(risk("wokwi-tool", [operation, "--x", "y"])).toBe("safe");
    expect(risk("wokwi-tool", ["--version"])).toBe("safe");
    // An unknown subcommand matches no rule: VERA's default for unmatched commands applies, with no note.
    expect(classifyCommand(m.rules, "wokwi-tool", ["frobnicate"])).toMatchObject({
      risk: "device-write",
      notes: [],
    });
  });
  it("publishes the official package with its pinned helper, skills, catalog entry and pack group", async () => {
    const m = manifest();
    expect(Object.keys(m.programs)).toEqual(["wokwi-cli", "wokwi-tool"]);
    expect(readFileSync(script, "utf8")).toContain('dependencies = ["pyyaml==6.0.3"]');
    const catalog = parse(readFileSync(join(software, "plugins", "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("wokwi");
    expect(catalog.metadata.wokwi.keywords).toContain("Wokwi");
    const packs = parse(readFileSync(join(software, "plugins", "packs.yaml"), "utf8"));
    expect(packs.find((pack: { id: string }) => pack.id === "arduino").groups).toContainEqual({
      name: "Cloud simulation (Wokwi)",
      plugins: ["wokwi"],
      default: false,
    });
    expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-wokwi-store-")));
    roots.push(root);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(pluginFolder);
    const installed = await store.load("wokwi");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const names = (await skills.list())
      .filter((skill) => skill.plugin === "wokwi")
      .map((skill) => skill.name);
    expect(names.sort()).toEqual(["wokwi-scenarios", "wokwi-simulation"]);
    const usage = (await skills.read("plugin", "wokwi-simulation")).content;
    for (const text of [
      "job.md",
      "irreversible",
      "virtual-timeout",
      "not-started",
      "unknown",
      "not an electrical test",
    ])
      expect(usage).toContain(text);
  });
  it("carries workspace.py as a byte-identical copy", async () => {
    expect(await readFile(join(pluginFolder, "scripts", "wokwi_support", "workspace.py"))).toEqual(
      await readFile(join(software, "plugins", "mqtt-tools", "scripts", "mqtt_support", "workspace.py")),
    );
  });
});

describe("command line and engine", () => {
  it("lists its operations and refuses an unknown one with exit 2 (REQ-DATA-d985bb3d)", async () => {
    const b = await bench();
    const help = b.run(["--help"]);
    expect(help.code).toBe(0);
    for (const operation of [
      "capabilities",
      "inspect-project",
      "validate-diagram",
      "prepare-job",
      "run-scenario",
      "collect-results",
      "report",
    ])
      expect(help.stdout).toContain(operation);
    const option = b.run(["capabilities", "--bogus"]);
    expect([option.code, option.doc.errors[0].code]).toEqual([2, "usage"]);
    const unknown = b.run(["simulate-now"]);
    expect([unknown.code, unknown.doc.status, unknown.doc.errors[0].code]).toEqual([2, "blocked", "usage"]);
  });
  it("refuses a missing or other-version CLI (REQ-FUNC-718d9e1b)", async () => {
    const b = await bench({ version: "0.30.0 (abcdef123456)" });
    const missing = b.run(["capabilities"], { env: { VERA_PROGRAM_WOKWI_CLI: join(b.root, "none.exe") } });
    expect([missing.code, missing.doc.errors[0].code]).toEqual([2, "cli-unavailable"]);
    await b.write({ version: "0.29.1 (deadbeef0000)" });
    const build = b.run(["capabilities"]);
    expect([build.code, build.doc.errors[0].code]).toEqual([2, "cli-version"]);
    await b.write({ version: "0.30.0 (abcdef123456)" });
    const other = b.run(["capabilities"]);
    expect([other.code, other.doc.errors[0].code]).toEqual([2, "cli-version"]);
    await b.write({});
    const ok = b.run(["capabilities"]);
    expect([ok.code, ok.doc.cli.version, ok.doc.scenarioCommands]).toEqual([
      0,
      "0.29.1",
      ["delay", "wait-serial", "write-serial", "set-control", "expect-pin"],
    ]);
  });
});

describe("inspect-project", () => {
  it("reports firmware, ELF, origin and board offline and changes nothing (REQ-FUNC-447f33d6)", async () => {
    const b = await bench();
    const before = await tree(b.work);
    const result = b.run(["inspect-project", "--project", "proj"]);
    expect(result.code, result.stdout).toBe(0);
    const facts = result.doc.project;
    expect(facts.firmware).toMatchObject({
      form: "hex",
      sha256: sha(HEX),
      origin: { tool: "arduino-cli", run: "20261114T100000Z-compile-ab12", fqbn: "arduino:avr:uno" },
    });
    expect(facts.elf).toMatchObject({ form: "elf", sha256: sha(ELF) });
    expect(facts.buildMatch).toBe("same-run");
    expect(facts.diagram.boards).toEqual([{ id: "uno", type: "wokwi-arduino-uno" }]);
    expect(await tree(b.work)).toEqual(before);
    expect(b.calls()).toEqual([]);
  });
  it("names a PlatformIO environment as the origin", async () => {
    const b = await bench();
    await mkdir(join(b.project, ".pio", "build", "uno"), { recursive: true });
    await writeFile(join(b.project, ".pio", "build", "uno", "firmware.hex"), HEX);
    await writeFile(
      join(b.project, "wokwi.toml"),
      "[wokwi]\nversion = 1\nfirmware = '.pio/build/uno/firmware.hex'\n",
    );
    const result = b.run(["inspect-project", "--project", "proj"]);
    expect(result.doc.project.firmware.origin).toEqual({ tool: "platformio", environment: "uno" });
    expect(result.doc.project.elf).toBeNull();
  });
});

describe("firmware forms (REQ-FUNC-447f33d6, REQ-DATA-14b295ed, REQ-SEC-11ca382d)", () => {
  const ESP_DIAGRAM = {
    version: 1,
    parts: [{ type: "board-esp32-devkit-c-v4", id: "esp", attrs: {} }],
    connections: [["esp:TX", "$serialMonitor:RX", "", []]],
  };
  async function idf(b: Awaited<ReturnType<typeof bench>>, files: Record<string, string>) {
    const build = join(b.project, "build");
    await mkdir(join(build, "bootloader"), { recursive: true });
    await writeFile(join(build, "bootloader", "bootloader.bin"), "boot");
    await writeFile(join(build, "app.bin"), "application");
    await writeFile(join(build, "project_description.json"), JSON.stringify({ target: "esp32" }));
    await writeFile(join(build, "flasher_args.json"), JSON.stringify({ flash_files: files }));
    await writeFile(join(b.project, "diagram.json"), JSON.stringify(ESP_DIAGRAM));
    await rm(join(b.project, "wokwi.toml"));
  }
  it("prepares and runs an ESP-IDF flasher_args.json job with its flash files", async () => {
    const b = await bench();
    await idf(b, { "0x1000": "bootloader/bootloader.bin", "0x10000": "app.bin" });
    const inspected = b.run([
      "inspect-project",
      "--project",
      "proj",
      "--firmware",
      "proj/build/flasher_args.json",
    ]);
    expect(inspected.doc.project.firmware).toMatchObject({
      form: "esp-idf-flasher-args",
      origin: { tool: "esp-idf", target: "esp32" },
    });
    const prepared = b.prepare(["--expect-text", "ready", "--firmware", "proj/build/flasher_args.json"]);
    expect(prepared.code, prepared.stdout).toBe(0);
    const folder = join(b.work, "arduino-iot-results", "job-1");
    const job = JSON.parse(await readFile(join(folder, "job.json"), "utf8")) as Json;
    const roles = Object.fromEntries(
      (job.files as Json[]).map((entry) => [entry.path, [entry.role, entry.transmitted]]),
    );
    expect(roles).toEqual({
      "send/diagram.json": ["diagram", true],
      "send/flash/flasher_args.json": ["config", false],
      "send/flash/bootloader/bootloader.bin": ["flash", true],
      "send/flash/app.bin": ["flash", true],
      "send/wokwi.toml": ["config", false],
    });
    expect(job.board).toEqual({ id: "esp", type: "board-esp32-devkit-c-v4" });
    expect(await readFile(join(folder, "send", "wokwi.toml"), "utf8")).toContain(
      "firmware = 'flash/flasher_args.json'",
    );
    const run = b.simulate();
    expect(run.code, run.stdout).toBe(0);
    expect(b.simulations()[0]?.project).toEqual([
      "diagram.json",
      "flash/app.bin",
      "flash/bootloader/bootloader.bin",
      "flash/flasher_args.json",
      "wokwi.toml",
    ]);
  });
  it("refuses a flash file outside the flasher_args.json folder", async () => {
    const b = await bench();
    await idf(b, { "0x1000": "../outside.bin" });
    await writeFile(join(b.project, "outside.bin"), "x");
    const result = b.prepare(["--expect-text", "ready", "--firmware", "proj/build/flasher_args.json"]);
    expect([result.code, result.doc.errors[0].code]).toEqual([2, "firmware-invalid"]);
  });
  it("recognises .bin and .uf2 firmware and refuses a .uf2 without its magic", async () => {
    const b = await bench();
    await writeFile(join(b.project, "fw.bin"), "\u0001\u0002");
    await writeFile(join(b.project, "fw.uf2"), "UF2\nrest");
    await writeFile(join(b.project, "bad.uf2"), "nope");
    expect(
      b.run(["inspect-project", "--project", "proj", "--firmware", "proj/fw.bin"]).doc.project.firmware.form,
    ).toBe("bin");
    expect(
      b.run(["inspect-project", "--project", "proj", "--firmware", "proj/fw.uf2"]).doc.project.firmware.form,
    ).toBe("uf2");
    const bad = b.prepare(["--scenario", "proj/scenario.yaml", "--firmware", "proj/bad.uf2"]);
    expect([bad.code, bad.doc.errors[0].code]).toEqual([2, "firmware-invalid"]);
  });
});

describe("unsupported inputs (REQ-SEC-1b90a69a)", () => {
  it.each([
    ["[[chip]]\nname = 'x'\nbinary = 'x.wasm'\n", "unsupported-input"],
    ["[[sdcard]]\nfolder = 'sdcard'\n", "unsupported-input"],
    ["gdbServerPort = 3333\n", "unsupported-input"],
  ])("refuses wokwi.toml with %j before any run folder", async (extra, code) => {
    const b = await bench();
    const base =
      "[wokwi]\nversion = 1\nfirmware = '../arduino-iot-results/20261114T100000Z-compile-ab12/binary/Blink.ino.hex'\n";
    await writeFile(join(b.project, "wokwi.toml"), extra.startsWith("[[") ? base + extra : base + extra);
    const result = b.prepare();
    expect([result.code, result.doc.errors[0].code]).toEqual([2, code]);
    expect(existsSync(join(b.work, "arduino-iot-results", "job-1"))).toBe(false);
  });
  it("refuses an unknown firmware form, a .hex that is not Intel HEX, an --elf without the magic and two boards", async () => {
    const b = await bench();
    await writeFile(join(b.project, "fw.exe"), "MZ");
    expect(
      b.prepare(["--scenario", "proj/scenario.yaml", "--firmware", "proj/fw.exe"]).doc.errors[0].code,
    ).toBe("unsupported-input");
    await writeFile(join(b.project, "bad.hex"), "not hex");
    expect(
      b.prepare(["--scenario", "proj/scenario.yaml", "--firmware", "proj/bad.hex"]).doc.errors[0].code,
    ).toBe("firmware-invalid");
    await writeFile(join(b.project, "bad.elf"), "plain");
    expect(b.prepare(["--scenario", "proj/scenario.yaml", "--elf", "proj/bad.elf"]).doc.errors[0].code).toBe(
      "firmware-invalid",
    );
    const two = {
      ...DIAGRAM,
      parts: [...DIAGRAM.parts, { type: "board-esp32-devkit-c-v4", id: "esp", attrs: {} }],
    };
    await writeFile(join(b.project, "diagram.json"), JSON.stringify(two));
    const boards = b.prepare();
    expect([boards.code, boards.doc.errors[0].code]).toEqual([2, "unsupported-input"]);
  });
});

describe("validate-diagram (REQ-FUNC-380b0542)", () => {
  it("reports structural errors and runs the linter offline with no token", async () => {
    const b = await bench({
      lint: {
        stderr:
          '\u2717 [invalid-pin] Invalid pin "99" for part "uno" (type: wokwi-arduino-uno). Valid pins: 0, 1 (uno)\n\u26a0 [redundant-parts] Part "x1" has no connections (x1)\n',
        stdout: "\nFound 1 error(s), 1 warning(s)",
        code: 1,
      },
    });
    const broken = {
      ...DIAGRAM,
      parts: [...DIAGRAM.parts, { type: "wokwi-led", id: "led1" }],
      connections: [...DIAGRAM.connections, ["ghost:1", "uno:3", "red", []]],
    };
    await writeFile(join(b.project, "diagram.json"), JSON.stringify(broken));
    const result = b.run(["validate-diagram", "--diagram", "proj/diagram.json"], {
      env: { WOKWI_CLI_TOKEN: "outer" },
    });
    expect([result.code, result.doc.status]).toEqual([1, "fail"]);
    const issues = result.doc.diagram.issues as Json[];
    expect(issues.filter((issue) => issue.rule === "structure").map((issue) => issue.part)).toEqual([
      "led1",
      "ghost",
    ]);
    expect(issues.find((issue) => issue.rule === "invalid-pin")).toMatchObject({
      severity: "error",
      part: "uno",
    });
    expect(issues.find((issue) => issue.rule === "redundant-parts")).toMatchObject({
      severity: "warning",
      part: "x1",
    });
    const [call] = b.calls();
    expect(call?.argv.slice(0, 2)).toEqual(["lint", "--offline"]);
    expect(call?.env).toEqual({ NO_COLOR: "1" });
    await b.write({});
    await writeFile(join(b.project, "diagram.json"), JSON.stringify(DIAGRAM));
    expect(b.run(["validate-diagram", "--diagram", "proj/diagram.json"]).code).toBe(0);
  });
});

describe("scenario and assertions", () => {
  const variants: [string, string, string][] = [
    ["version 2", SCENARIO.replace("version: 1", "version: 2"), "scenario-invalid"],
    ["no name", SCENARIO.replace("name: Blink and button\n", ""), "scenario-invalid"],
    [
      "two commands",
      SCENARIO.replace("  - delay: 500ms", "  - delay: 500ms\n    wait-serial: x"),
      "scenario-invalid",
    ],
    ["delay without units", SCENARIO.replace("delay: 500ms", "delay: 500"), "scenario-invalid"],
    ["unknown part", SCENARIO.replace("part-id: btn1", "part-id: ghost"), "scenario-invalid"],
    [
      "take-screenshot",
      SCENARIO.replace("  - delay: 500ms", "  - take-screenshot:\n      part-id: uno"),
      "unsupported-input",
    ],
    ["touch", SCENARIO.replace("  - delay: 500ms", "  - touch:\n      part-id: uno"), "unsupported-input"],
  ];
  it.each(variants)(
    "refuses a scenario with %s before any run folder (REQ-FUNC-c9e7ad20)",
    async (_label, text, code) => {
      const b = await bench();
      await writeFile(join(b.project, "scenario.yaml"), text);
      const result = b.prepare();
      expect([result.code, result.doc.errors[0].code]).toEqual([2, code]);
      expect(existsSync(join(b.work, "arduino-iot-results", "job-1"))).toBe(false);
    },
  );
  it("needs a scenario or an expected text, not both (REQ-FUNC-0d39321d)", async () => {
    const b = await bench();
    expect([b.prepare([]).code, b.prepare([]).doc.errors[0].code]).toEqual([2, "assertion-missing"]);
    expect(b.prepare(["--scenario", "proj/scenario.yaml", "--expect-text", "ready"]).code).toBe(2);
    expect(b.prepare(["--scenario", "proj/scenario.yaml", "--expect-text", "ready"]).doc.errors[0].code).toBe(
      "unsupported-input",
    );
    expect(b.prepare(["--expect-text", "ready", "--fail-text", "panic"]).code).toBe(0);
  });
});

describe("prepare-job (REQ-DATA-14b295ed)", () => {
  it("writes exact copies, the send list, account, limits and budgets without touching the project", async () => {
    const b = await bench();
    const before = await tree(b.project);
    const result = b.prepare();
    expect(result.code, result.stdout).toBe(0);
    const folder = join(b.work, "arduino-iot-results", "job-1");
    const job = JSON.parse(await readFile(join(folder, "job.json"), "utf8")) as Json;
    expect(job).toMatchObject({
      format: 1,
      kind: "wokwi-job",
      account: "ci",
      endpoint: "wss://wokwi.com/api/ws/beta",
      cli: { version: "0.29.1", sha: "0aa185144b92" },
      board: { id: "uno", type: "wokwi-arduino-uno" },
      limits: { virtualTimeoutMs: 5000, realBudgetS: 60, attempts: 1 },
      firmware: { form: "hex", sha256: sha(HEX), elfSha256: sha(ELF), buildMatch: "same-run" },
      assertions: { scenario: { name: "Blink and button", steps: 4 }, expectText: null, failText: null },
    });
    expect(job.usage).toMatch(/plan/);
    const roles = Object.fromEntries(
      (job.files as Json[]).map((entry) => [entry.path, [entry.role, entry.transmitted]]),
    );
    expect(roles).toEqual({
      "send/diagram.json": ["diagram", true],
      "send/firmware.hex": ["firmware", true],
      "send/firmware.elf": ["elf", true],
      "send/scenario.yaml": ["scenario", false],
      "send/wokwi.toml": ["config", false],
    });
    for (const entry of job.files as Json[])
      expect(entry.sha256).toBe(sha(await readFile(join(folder, ...String(entry.path).split("/")))));
    expect(job.transmittedBytes).toBe(JSON.stringify(DIAGRAM).length + HEX.length + ELF.length);
    expect(await readFile(join(folder, "send", "wokwi.toml"), "utf8")).toMatch(
      /^# Generated[^\n]*\n\[wokwi\]\nversion = 1\nfirmware = 'firmware\.hex'\nelf = 'firmware\.elf'\n$/,
    );
    expect(await readFile(join(folder, "job.md"), "utf8")).toContain("Sent to Wokwi");
    expect(await tree(b.project)).toEqual(before);
    expect(b.prepare().doc.errors[0].code).toBe("run-exists");
  });
});

describe("run-scenario", () => {
  it("runs the CLI once on the job's own files with the token only in its environment (REQ-SEC-11ca382d, REQ-SEC-3ab66bb9)", async () => {
    const b = await bench({
      run: {
        serial: "ready\nLED on\n",
        stdout: "ready\n[Blink and button] Scenario completed successfully\n",
      },
    });
    expect(b.prepare().code).toBe(0);
    const result = b.run(
      [
        "run-scenario",
        "--job",
        "arduino-iot-results/job-1/job.json",
        "--credential",
        "ci",
        "--run-id",
        "run-1",
      ],
      {
        input: b.line(),
        env: { WOKWI_CLI_SERVER: "wss://evil.test/ws", WOKWI_X: "1" },
      },
    );
    expect([result.code, result.doc.status, result.doc.outcome], result.stdout).toEqual([
      0,
      "pass",
      "passed",
    ]);
    const [call] = b.simulations();
    expect(call?.project).toEqual([
      "diagram.json",
      "firmware.elf",
      "firmware.hex",
      "scenario.yaml",
      "wokwi.toml",
    ]);
    expect(call?.cwd.toLowerCase()).toBe(join(b.work, "arduino-iot-results", "job-1").toLowerCase());
    expect(call?.env).toEqual({ NO_COLOR: "1", WOKWI_CLI_TOKEN: TOKEN });
    const argv = call?.argv as string[];
    expect(argv.join(" ")).not.toContain(TOKEN);
    for (const expected of [
      "--no-sdcard",
      "--timeout",
      "5000",
      "--timeout-exit-code",
      "42",
      "--scenario",
      "scenario.yaml",
    ])
      expect(argv).toContain(expected);
    expect(argv[argv.indexOf("--serial-log-file") + 1]?.toLowerCase()).toBe(
      join(b.work, "arduino-iot-results", "run-1", "serial.log").toLowerCase(),
    );
    expect(result.doc).toMatchObject({
      kind: "wokwi-run",
      attempts: 1,
      api: "1.0.0-fake",
      remote: { state: "closed-by-client", confirmed: false },
      job: {
        runId: "job-1",
        sha256: sha(await readFile(join(b.work, "arduino-iot-results", "job-1", "job.json"))),
      },
    });
    expect((result.doc.artifacts as Json[]).map((entry) => entry.path)).toContain(
      "arduino-iot-results/run-1/serial.log",
    );
  });
  it.each([
    [
      "one changed byte",
      async (folder: string) => writeFile(join(folder, "send", "firmware.hex"), HEX.replace("82", "83")),
    ],
    ["a deleted file", async (folder: string) => rm(join(folder, "send", "diagram.json"))],
    ["an added file", async (folder: string) => writeFile(join(folder, "send", "extra.bin"), "x")],
  ])("refuses a job with %s before the token is read (REQ-SEC-450de6ab)", async (_label, change) => {
    const b = await bench();
    b.prepare();
    await change(join(b.work, "arduino-iot-results", "job-1"));
    const result = b.simulate();
    expect([result.code, result.doc.errors[0].code]).toEqual([2, "job-changed"]);
    expect(b.simulations()).toEqual([]);
    // A line of another scope would end credential-missing if it were read: the job check comes first.
    expect(b.simulate("job-1", "run-2", b.line({ scope: "mqtt" })).doc.errors[0].code).toBe("job-changed");
  });
  /** Rewrites a file of a prepared job and its job.json entry, so every hash matches again. */
  const tamper = async (folder: string, relative: string, content: string | Buffer, role = "config") => {
    const path = join(folder, ...relative.split("/"));
    await mkdir(join(path, ".."), { recursive: true });
    await writeFile(path, content);
    const job = JSON.parse(await readFile(join(folder, "job.json"), "utf8")) as Json;
    const bytes = Buffer.from(content);
    const entry = (job.files as Json[]).find((file) => file.path === relative);
    if (entry) Object.assign(entry, { sha256: sha(bytes), bytes: bytes.length });
    else
      (job.files as Json[]).push({
        role,
        path: relative,
        source: null,
        sha256: sha(bytes),
        bytes: bytes.length,
        transmitted: false,
      });
    await writeFile(join(folder, "job.json"), JSON.stringify(job));
    return job;
  };
  it.each([
    [
      "a wokwi.toml pointing outside send/",
      "send/wokwi.toml",
      "[wokwi]\nversion = 1\nfirmware = '../../secret.bin'\n",
      "job-changed",
    ],
    [
      "a wokwi.toml with a chip",
      "send/wokwi.toml",
      "[wokwi]\nversion = 1\nfirmware = 'firmware.hex'\n[[chip]]\nname = 'x'\nbinary = 'x.wasm'\n",
      "job-changed",
    ],
    [
      "a scenario step prepare-job refuses",
      "send/scenario.yaml",
      "name: x\nversion: 1\nsteps:\n  - take-screenshot:\n      part-id: uno\n",
      "unsupported-input",
    ],
    ["an extra listed file", "send/extra.bin", "x", "job-changed"],
  ])(
    "refuses a hand-written job with %s even when every hash matches",
    async (_label, relative, content, code) => {
      const b = await bench();
      b.prepare();
      await tamper(join(b.work, "arduino-iot-results", "job-1"), relative, content);
      const result = b.simulate();
      expect([result.code, result.doc.errors[0].code], result.stdout).toEqual([2, code]);
      expect(b.simulations()).toEqual([]);
    },
  );
  it("refuses a job whose assertions or outputs are not of their form", async () => {
    const b = await bench();
    b.prepare();
    const folder = join(b.work, "arduino-iot-results", "job-1");
    const job = JSON.parse(await readFile(join(folder, "job.json"), "utf8")) as Json;
    for (const broken of [
      { ...job, assertions: { ...job.assertions, failText: 42 } },
      { ...job, outputs: { ...job.outputs, screenshot: { part: "ghost", ms: 1 } } },
      { ...job, board: { id: "esp", type: "board-esp32-devkit-c-v4" } },
    ]) {
      await writeFile(join(folder, "job.json"), JSON.stringify(broken));
      const result = b.simulate();
      expect([result.code, result.doc.errors[0].code], result.stdout).toEqual([2, "job-invalid"]);
    }
    expect(b.simulations()).toEqual([]);
  });
  it("reads the token only for the job's account from a wokwi line (REQ-SEC-fa87b102)", async () => {
    const b = await bench();
    b.prepare();
    const other = b.run(
      [
        "run-scenario",
        "--job",
        "arduino-iot-results/job-1/job.json",
        "--credential",
        "lab",
        "--run-id",
        "r0",
      ],
      { input: b.line() },
    );
    expect(other.doc.errors[0].code).toBe("credential-mismatch");
    // With a line of another scope on stdin, the account check still answers first: stdin was not read yet.
    const first = b.run(
      [
        "run-scenario",
        "--job",
        "arduino-iot-results/job-1/job.json",
        "--credential",
        "lab",
        "--run-id",
        "r4",
      ],
      { input: b.line({ scope: "mqtt" }) },
    );
    expect(first.doc.errors[0].code).toBe("credential-mismatch");
    expect(b.simulate("job-1", "r1", null).doc.errors[0].code).toBe("credential-missing");
    expect(b.simulate("job-1", "r2", b.line({ scope: "mqtt" })).doc.errors[0].code).toBe(
      "credential-missing",
    );
    expect(b.simulate("job-1", "r3", b.line({ ref: "lab" })).doc.errors[0].code).toBe("credential-mismatch");
    expect(b.simulations()).toEqual([]);
  });
  it("keeps the token out of every file and document it writes (REQ-SEC-046ce69f)", async () => {
    const b = await bench({ run: { echoToken: true, serial: "ready\n" } });
    b.prepare();
    const result = b.simulate();
    expect(result.stdout).not.toContain(TOKEN);
    const run = join(b.work, "arduino-iot-results", "run-1");
    for (const text of await files(run)) expect(text).not.toContain(TOKEN);
    expect(await readFile(join(run, "cli-stderr.log"), "utf8")).toContain("[redacted]");
    const report = b.run(["report", "--run", "arduino-iot-results/run-1", "--run-id", "rep"]);
    expect(report.code).toBe(0);
    for (const text of await files(join(b.work, "arduino-iot-results", "rep")))
      expect(text).not.toContain(TOKEN);
  });
});

describe("redaction (REQ-SEC-046ce69f)", () => {
  it("never writes a token prefix, across chunk splits or at the output limit", () => {
    const support = join(pluginFolder, "scripts");
    const code = [
      "import os, random, sys, threading",
      `sys.path.insert(0, ${JSON.stringify(support)})`,
      "from pathlib import Path",
      "from wokwi_support.redact import Redactor",
      "from wokwi_support.run import Capture",
      `token = ${JSON.stringify(TOKEN)}`,
      "data = ('abc ' + token + ' def ' + token[:7] + ' ' + token + ' end').encode()",
      "random.seed(7)",
      "for _ in range(2000):",
      "    r, out, i = Redactor(token), b'', 0",
      "    while i < len(data):",
      "        n = random.randint(1, 9); out += r.feed(data[i:i + n]); i += n",
      "    out += r.flush()",
      "    assert token.encode() not in out and out.count(b'[redacted]') == 2, out",
      "folder = Path(sys.argv[1])",
      "read, write = os.pipe()",
      "capture = Capture(os.fdopen(read, 'rb'), folder / 'out.log', token, 64)",
      "capture.start()",
      "os.write(write, b'a' * 60 + token.encode() + b'tail')",
      "os.close(write)",
      "capture.join()",
      "text = (folder / 'out.log').read_bytes()",
      "assert capture.exceeded and token[:4].encode() not in text, text",
      "print('ok')",
    ].join("\n");
    const folder = mkdtempSync(join(tmpdir(), "vera-wokwi-redact-"));
    roots.push(folder);
    const probe = spawnSync(python, ["-I", "-B", "-c", code, folder], { encoding: "utf8" });
    expect(probe.stdout.trim(), probe.stderr).toBe("ok");
  });
});

describe("outcomes (REQ-FUNC-4ba54556, REQ-REL-85779c4c, REQ-DATA-6e0fbd5a, REQ-REL-01c5b557)", () => {
  const cases: [string, Json, number, string, string, string][] = [
    ["exit 0", { code: 0 }, 0, "pass", "passed", "closed-by-client"],
    [
      "virtual timeout",
      { code: 42, stderr: "\nTimeout: simulation did not finish in 5000ms\n" },
      1,
      "fail",
      "virtual-timeout",
      "closed-by-client",
    ],
    [
      "fail text",
      { code: 1, stderr: '\n\nError: Unexpected text found: "panic"\nTEST FAILED.\n' },
      1,
      "fail",
      "fail-text",
      "closed-by-client",
    ],
    [
      "assertion",
      {
        code: 1,
        stderr: "Error: [1500000000ns] GPIO led1:A expected to be 1 but was 0\n    at TestScenario.fail\n",
      },
      1,
      "fail",
      "assertion-failed",
      "closed-by-client",
    ],
    [
      "401",
      {
        connected: false,
        code: 1,
        stderr: "Error: Error connecting to wss://wokwi.com/api/ws/beta: 401 Unauthorized\n",
      },
      3,
      "error",
      "auth-failed",
      "not-started",
    ],
    [
      "dns",
      {
        connected: false,
        code: 1,
        stdout: "Will retry in 1000ms...\nWill retry in 2000ms...\n",
        stderr: "Error: Error connecting to wss://wokwi.com/api/ws/beta: getaddrinfo ENOTFOUND wokwi.com\n",
      },
      3,
      "error",
      "network-error",
      "not-started",
    ],
    [
      "lost",
      {
        code: 1,
        stderr: "API Error: Connection to wss://wokwi.com/api/ws/beta closed unexpectedly: code 1006\n",
      },
      3,
      "incomplete",
      "connection-lost",
      "unknown",
    ],
    [
      "api",
      { code: 1, stderr: "API Error: Simulation quota exceeded\n" },
      3,
      "error",
      "api-error",
      "unknown",
    ],
    [
      "giving up",
      {
        connected: false,
        code: 1,
        stdout: "Will retry in 1000ms...\nWill retry in 2000ms...\n",
        stderr: "Error: Failed to connect to wss://wokwi.com/api/ws/beta. Giving up.\n",
      },
      3,
      "error",
      "network-error",
      "not-started",
    ],
    [
      "missing token",
      { connected: false, code: 1, stderr: "Error: Missing WOKWI_CLI_TOKEN environment variable.\n" },
      2,
      "blocked",
      "credential-missing",
      "not-started",
    ],
    [
      "another failure",
      { code: 5, stderr: "Error: something unexpected\n" },
      3,
      "error",
      "cli-failed",
      "unknown",
    ],
    ["a crash code", { code: 139, stderr: "" }, 3, "incomplete", "stopped", "unknown"],
  ];
  it.each(cases)("maps %s to its own outcome", async (_label, run, code, status, outcome, remote) => {
    const b = await bench({ run });
    b.prepare();
    const result = b.simulate();
    expect(
      [result.code, result.doc.status, result.doc.outcome, result.doc.remote.state],
      result.stdout,
    ).toEqual([code, status, outcome, remote]);
    expect(result.doc.attempts).toBe(1);
    expect(b.simulations()).toHaveLength(1);
    expect(result.doc.time.real).toMatchObject({ budgetS: 60 });
    expect(typeof result.doc.time.real.elapsedS).toBe("number");
    if (outcome === "assertion-failed")
      expect(result.doc.time.virtual).toEqual({ timeoutMs: 5000, reachedNs: 1500000000 });
    if (outcome === "virtual-timeout") expect(result.doc.time.virtual.reachedNs).toBe(5_000_000_000);
    if (outcome === "network-error") expect(result.doc.connectRetries).toBe(2);
    if (remote === "not-started") expect(result.doc.remote.confirmed).toBe(true);
  });
});

describe("bounds and Stop", { timeout: 60_000 }, () => {
  it("ends a hanging run at its real-time budget (REQ-REL-fb090330)", async () => {
    const b = await bench({ run: { hang: true } });
    b.prepare(["--scenario", "proj/scenario.yaml", "--real-budget-s", "10"]);
    const started = Date.now();
    const result = b.simulate();
    expect(Date.now() - started).toBeLessThan(25_000);
    expect([result.doc.status, result.doc.outcome, result.doc.remote]).toEqual([
      "incomplete",
      "real-budget-exceeded",
      { state: "unknown", confirmed: false, cancel: "connection-closed-requested" },
    ]);
    const exit = JSON.parse(
      await readFile(join(b.work, "arduino-iot-results", "run-1", "exit.json"), "utf8"),
    ) as Json;
    expect(exit.reason).toBe("real-budget");
    const { pid } = JSON.parse(await readFile(`${b.scenarioPath}.running`, "utf8")) as { pid: number };
    expect(() => process.kill(pid, 0)).toThrow();
  });
  it("bounds the CLI's output (REQ-REL-6d7d4558)", async () => {
    const b = await bench({ run: { bigStdout: 5 * 1024 * 1024, hang: true } });
    b.prepare();
    const result = b.simulate();
    expect([result.doc.outcome, result.doc.remote.state]).toEqual(["output-limit", "unknown"]);
    const size = (await readFile(join(b.work, "arduino-iot-results", "run-1", "cli-stdout.log"))).length;
    expect(size).toBeLessThanOrEqual(4 * 1024 * 1024 + 100);
  });
  it.skipIf(windows)("stops on SIGTERM and reports the remote state unknown (REQ-REL-88c06ac8)", async () => {
    const b = await bench({ run: { hang: true } });
    b.prepare();
    const child = spawn(
      python,
      [
        "-I",
        script,
        "run-scenario",
        "--job",
        "arduino-iot-results/job-1/job.json",
        "--credential",
        "ci",
        "--run-id",
        "run-1",
      ],
      {
        cwd: b.work,
        env: b.env(),
      },
    );
    let out = "";
    child.stdout.on("data", (chunk) => {
      out += chunk;
    });
    child.stdin.end(b.line());
    for (let waited = 0; !existsSync(`${b.scenarioPath}.running`) && waited < 20_000; waited += 100)
      await sleep(100);
    child.kill("SIGTERM");
    const code = await new Promise<number | null>((done) => child.once("exit", done));
    const doc = JSON.parse(out) as Json;
    expect([code, doc.outcome, doc.remote.state, doc.remote.cancel]).toEqual([
      3,
      "stopped",
      "unknown",
      "connection-closed-requested",
    ]);
  });
  it("leaves a run stopped by VERA's runner incomplete, and collect-results reports it interrupted (REQ-REL-88c06ac8, REQ-FUNC-3c5b6470)", async () => {
    const b = await bench({ run: { hang: true } });
    b.prepare();
    await mkdir(join(b.work, ".vera"), { recursive: true });
    const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
    const env = b.env();
    const run = await runner.start({
      sessionId: "s1",
      workbench: b.work,
      executable: python,
      args: [
        "-I",
        script,
        "run-scenario",
        "--job",
        "arduino-iot-results/job-1/job.json",
        "--credential",
        "ci",
        "--run-id",
        "run-1",
      ],
      env: {
        VERA_PROGRAM_WOKWI_CLI: env.VERA_PROGRAM_WOKWI_CLI,
        VERA_FAKE_WOKWI: env.VERA_FAKE_WOKWI,
        PYTHONDONTWRITEBYTECODE: "1",
        ...(windows ? { ComSpec: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe" } : {}),
      },
      input: b.line(),
    });
    for (let waited = 0; !existsSync(`${b.scenarioPath}.running`) && waited < 20_000; waited += 100)
      await sleep(100);
    expect(existsSync(`${b.scenarioPath}.running`), (await run.stop()).output).toBe(true);
    const result = await run.stop();
    expect(result.stopped).toBe(true);
    expect(await readFile(join(b.work, result.log), "utf8")).not.toContain(TOKEN);
    const folder = join(b.work, "arduino-iot-results", "run-1");
    const stored = JSON.parse(await readFile(join(folder, "result.json"), "utf8")) as Json;
    if (windows) expect([stored.status, stored.outcome]).toEqual(["incomplete", "running"]);
    else expect([stored.status, stored.outcome]).toEqual(["incomplete", "stopped"]);
    if (windows) {
      const collected = b.run(["collect-results", "--run", "arduino-iot-results/run-1"]);
      expect([
        collected.code,
        collected.doc.status,
        collected.doc.outcome,
        collected.doc.remote.state,
      ]).toEqual([3, "incomplete", "interrupted", "unknown"]);
    }
    const { pid } = JSON.parse(await readFile(`${b.scenarioPath}.running`, "utf8")) as { pid: number };
    for (let waited = 0; waited < 10_000; waited += 100) {
      try {
        process.kill(pid, 0);
      } catch {
        break;
      }
      await sleep(100);
    }
    expect(() => process.kill(pid, 0)).toThrow();
  });
});

describe("collect-results, artifacts and report", () => {
  it("derives a run's outcome again and refuses another folder (REQ-FUNC-3c5b6470)", async () => {
    const b = await bench({ run: { code: 42, stderr: "\nTimeout: simulation did not finish in 5000ms\n" } });
    b.prepare();
    b.simulate();
    const path = join(b.work, "arduino-iot-results", "run-1", "result.json");
    const stored = JSON.parse(await readFile(path, "utf8")) as Json;
    await writeFile(path, JSON.stringify({ ...stored, status: "incomplete", outcome: "running" }));
    const again = b.run(["collect-results", "--run", "arduino-iot-results/run-1"]);
    expect([again.code, again.doc.outcome]).toEqual([1, "virtual-timeout"]);
    const other = b.run(["collect-results", "--run", "arduino-iot-results/job-1"]);
    expect([other.code, other.doc.errors[0].code]).toEqual([2, "run-invalid"]);
  });
  it("records VCD and screenshot outputs when asked and written (REQ-FUNC-5576edcd)", async () => {
    const b = await bench({ run: { vcd: true, screenshot: true } });
    b.prepare([
      "--scenario",
      "proj/scenario.yaml",
      "--vcd",
      "--screenshot-part",
      "uno",
      "--screenshot-ms",
      "1000",
    ]);
    const result = b.simulate();
    const argv = b.simulations()[0]?.argv as string[];
    expect(argv[argv.indexOf("--screenshot-time") + 1]).toBe("1000");
    expect(argv).toContain("--vcd-file");
    const listed = (result.doc.artifacts as Json[]).map((entry) => String(entry.path).split("/").pop());
    expect(listed).toEqual(expect.arrayContaining(["serial.log", "trace.vcd", "screenshot.png"]));
    await b.write({ run: {} });
    b.prepare(["--scenario", "proj/scenario.yaml", "--vcd"], "job-2");
    const none = b.simulate("job-2", "run-2");
    expect((none.doc.artifacts as Json[]).map((entry) => String(entry.path).split("/").pop())).not.toContain(
      "trace.vcd",
    );
  });
  it("writes JSON, Markdown, HTML and JUnit with one test case per run (REQ-FUNC-1b2f02bd)", async () => {
    const b = await bench({ run: { code: 0 } });
    b.prepare();
    b.simulate("job-1", "run-pass");
    await b.write({ run: { code: 42, stderr: "\nTimeout: simulation did not finish in 5000ms\n" } });
    b.simulate("job-1", "run-timeout");
    const result = b.run([
      "report",
      "--run",
      "arduino-iot-results/run-pass",
      "--run",
      "arduino-iot-results/run-timeout",
      "--run-id",
      "rep",
    ]);
    expect(result.code, result.stdout).toBe(0);
    const folder = join(b.work, "arduino-iot-results", "rep");
    const junit = await readFile(join(folder, "junit.xml"), "utf8");
    expect(junit.match(/<testcase /g)).toHaveLength(2);
    expect(junit).toContain('<failure type="virtual-timeout"');
    const markdown = await readFile(join(folder, "report.md"), "utf8");
    expect(markdown).toContain("run-pass");
    expect(markdown).toContain("not an electrical test or a test on the real board");
    expect(existsSync(join(folder, "report.html"))).toBe(true);
  });
});

const realCli = process.env.VERA_TEST_WOKWI_CLI;
describe.skipIf(!realCli)("the real wokwi-cli 0.29.1, offline only (REQ-TEST-dce7445c)", () => {
  it("reports its version and lints a diagram offline", async () => {
    const b = await bench();
    const env = { VERA_PROGRAM_WOKWI_CLI: realCli as string };
    expect(b.run(["capabilities"], { env }).doc.cli).toMatchObject({
      version: "0.29.1",
      sha: "0aa185144b92",
    });
    const bad = {
      ...DIAGRAM,
      parts: [...DIAGRAM.parts, { type: "wokwi-foo-bar", id: "x1", attrs: {} }],
      connections: [...DIAGRAM.connections, ["uno:99", "led1:Z", "red", []]],
    };
    await writeFile(join(b.project, "bad.json"), JSON.stringify(bad));
    const result = b.run(["validate-diagram", "--diagram", "proj/bad.json"], { env });
    expect(result.code).toBe(1);
    const rules = (result.doc.diagram.issues as Json[]).map((issue) => `${issue.severity}:${issue.rule}`);
    expect(rules).toEqual(
      expect.arrayContaining(["error:invalid-pin", "error:unknown-part-type", "warning:redundant-parts"]),
    );
    expect(b.run(["validate-diagram", "--diagram", "proj/diagram.json"], { env }).code).toBe(0);
  });
  it("accepts wokwi-tool's command line and stops at its own missing-token check without a token", async () => {
    const b = await bench();
    b.prepare([
      "--scenario",
      "proj/scenario.yaml",
      "--vcd",
      "--fail-text",
      "panic",
      "--screenshot-part",
      "uno",
      "--screenshot-ms",
      "1000",
    ]);
    const job = join(b.work, "arduino-iot-results", "job-1");
    const support = join(pluginFolder, "scripts");
    // The argv run-scenario would use, built by the helper's own function, run against the real CLI with no token.
    const code = [
      "import json, sys, subprocess, os",
      `sys.path.insert(0, ${JSON.stringify(support)})`,
      "from pathlib import Path",
      "from wokwi_support import run, engine",
      `job = json.load(open(${JSON.stringify(join(job, "job.json"))}))`,
      `argv = run.argv(${JSON.stringify(realCli)}, job, Path(${JSON.stringify(join(b.root, "out"))}))`,
      "env = engine.child_environment(None)",
      `done = subprocess.run(argv, cwd=${JSON.stringify(job)}, env=env, capture_output=True, stdin=subprocess.DEVNULL, timeout=60)`,
      "print(json.dumps({'code': done.returncode, 'err': done.stderr.decode('utf-8', 'replace'), 'argv': argv}))",
    ].join("\n");
    const probe = spawnSync(python, ["-I", "-B", "-c", code], {
      encoding: "utf8",
      env: { ...process.env, WOKWI_CLI_TOKEN: "" },
    });
    const result = JSON.parse(probe.stdout) as Json;
    expect(result.code).toBe(1);
    expect(result.err).toContain("Missing WOKWI_CLI_TOKEN");
    expect(result.err).not.toContain("unknown option");
  });
});
