// The arduino-cli plugin. Default tests check the package, catalog, rules and skills, and every arduino-tool operation
// against a scripted fake arduino-cli (tests/support/fake-arduino-cli.py), including Stop through VERA's real runner.
// VERA_TEST_ARDUINO_CLI names a real arduino-cli 1.6 and VERA_ARDUINO_HOME an environment holding arduino:avr 1.8.8 and
// arduino:samd 1.8.14: then the real-tool tests compile the fixtures. VERA_TEST_ARDUINO_PORT and
// VERA_TEST_ARDUINO_IDENTITY name a connected AVR board: only then the upload and serial readback test runs.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import {
  chmod,
  cp,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterAll, describe, expect, it } from "vitest";
import { parse } from "yaml";
import { reportSkip } from "../support/skip-marker.js";

const plugins = new URL("../../plugins/", import.meta.url);
const source = fileURLToPath(new URL("arduino-cli/", plugins));
const scripts = join(source, "scripts");
const script = join(scripts, "arduino_tool.py");
const fixtures = fileURLToPath(new URL("../fixtures/arduino-cli/", import.meta.url));
const fake = fileURLToPath(new URL("../support/fake-arduino-cli.py", import.meta.url));
const windows = process.platform === "win32";
const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();
const realTool =
  process.env.VERA_TEST_ARDUINO_CLI &&
  existsSync(process.env.VERA_TEST_ARDUINO_CLI) &&
  process.env.VERA_ARDUINO_HOME
    ? process.env.VERA_TEST_ARDUINO_CLI
    : undefined;
const boardPort = process.env.VERA_TEST_ARDUINO_PORT;
const boardIdentity = process.env.VERA_TEST_ARDUINO_IDENTITY;

interface Problem {
  code: string;
  message: string;
  [key: string]: unknown;
}
interface Doc {
  status: string;
  operation: string;
  errors: Problem[];
  warnings: Problem[];
  runId?: string;
  [key: string]: unknown;
}
interface Call {
  argv: string[];
  config: string;
  sketchFiles?: string[];
}

const UNO = {
  name: "Arduino UNO",
  config_options: [],
  programmers: [{ id: "arduinoasisp", name: "Arduino as ISP" }],
};
const NANO = {
  name: "Arduino Nano",
  config_options: [
    {
      option: "cpu",
      option_label: "Processor",
      values: [{ value: "atmega328", selected: true }, { value: "atmega328old" }, { value: "atmega168" }],
    },
  ],
  programmers: [],
};
const BOARDS = {
  "arduino:avr:uno": UNO,
  "arduino:avr:nano": NANO,
  "arduino:avr:leonardo": { name: "Arduino Leonardo", config_options: [], programmers: [] },
  "arduino:avr:mega": { name: "Arduino Mega or Mega 2560", config_options: [], programmers: [] },
};
const UNO_SERIAL = "85735313";
const UNO_IDENTITY = `usb:2341:0043:${UNO_SERIAL}`;
const port = (
  address: string,
  properties: Record<string, string>,
  boards: { name: string; fqbn: string }[] = [],
) => ({
  port: { address, label: address, protocol: "serial", protocol_label: "Serial Port", properties },
  ...(boards.length ? { matching_boards: boards } : {}),
});
const UNO_PORT = port("COM5", { vid: "0x2341", pid: "0x0043", serialNumber: UNO_SERIAL }, [
  { name: "Arduino UNO", fqbn: "arduino:avr:uno" },
]);
const CH340 = (address: string) =>
  port(address, { vid: "0x1A86", pid: "0x7523" }, [{ name: "Clone Nano", fqbn: "arduino:avr:nano" }]);
const NETWORK = { port: { address: "192.168.1.20", label: "esp", protocol: "network", properties: {} } };

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true }).catch(() => {});
});

/** A workbench with the fixtures, a VERA Arduino home and a fake arduino-cli playing `scenario`. */
async function bench(scenario: Record<string, unknown> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "vera-arduino-")));
  roots.push(root);
  const work = join(root, "work");
  await cp(fixtures, work, { recursive: true });
  const home = join(root, "home");
  const scenarioPath = join(root, "scenario.json");
  const write = (next: Record<string, unknown>) =>
    writeFile(scenarioPath, JSON.stringify({ cores: { "arduino:avr": "1.8.8" }, boards: BOARDS, ...next }));
  await write(scenario);
  await mkdir(join(root, "bin"));
  const tool = join(root, "bin", windows ? "arduino-cli.cmd" : "arduino-cli");
  await writeFile(
    tool,
    windows ? `@"${python}" "${fake}" %*\r\n` : `#!/bin/sh\nexec "${python}" "${fake}" "$@"\n`,
  );
  if (!windows) await chmod(tool, 0o755);
  const env = (extra: Record<string, string> = {}) => ({
    ...process.env,
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONIOENCODING: "utf-8",
    VERA_ARDUINO_HOME: home,
    VERA_PROGRAM_ARDUINO_CLI: tool,
    VERA_FAKE_ARDUINO: scenarioPath,
    ...extra,
  });
  const run = (args: string[], extra: Record<string, string> = {}) => {
    const result = spawnSync(python, ["-I", script, ...args], {
      cwd: work,
      encoding: "utf8",
      env: env(extra),
    });
    let doc: Doc | undefined;
    try {
      doc = result.stdout.trim() ? (JSON.parse(result.stdout) as Doc) : undefined;
    } catch {
      doc = undefined;
    }
    return { code: result.status, stdout: result.stdout, stderr: result.stderr, doc: doc as Doc };
  };
  const calls = async (): Promise<Call[]> => {
    const path = `${scenarioPath}.calls.jsonl`;
    if (!existsSync(path)) return [];
    return (await readFile(path, "utf8"))
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Call);
  };
  const resetCalls = () => rm(`${scenarioPath}.calls.jsonl`, { force: true });
  return { root, work, home, tool, scenarioPath, env, run, calls, resetCalls, write };
}

async function tree(folder: string): Promise<Record<string, string>> {
  const found: Record<string, string> = {};
  for (const entry of await readdir(folder, { recursive: true, withFileTypes: true }))
    if (entry.isFile()) {
      const path = join(entry.parentPath, entry.name);
      found[path.slice(folder.length + 1).replaceAll("\\", "/")] = sha256(await readFile(path));
    }
  return found;
}
const codes = (doc: Doc) => doc.errors.map((error) => error.code);
const commands = (calls: Call[]) =>
  calls.map((call) =>
    call.argv
      .filter((arg) => arg !== "--json")
      .slice(0, 2)
      .join(" "),
  );

describe("package", { timeout: 30_000 }, () => {
  it("publishes arduino-cli pinned, every direct command blocked and arduino-tool at its effective risks (REQ-FUNC-5b49327c, REQ-SEC-93d5fc98)", async () => {
    const m: PluginManifest = parse(await readFile(join(source, "plugin.yaml"), "utf8"));
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(Object.keys(m.programs)).toEqual(["arduino-cli", "arduino-tool"]);
    expect(m.requires).toEqual(["serial-monitor"]);
    expect(m.programs["arduino-tool"]?.uses).toEqual(["arduino-cli"]);
    const install = m.programs["arduino-cli"]?.install as {
      download: Record<string, { url: string; sha256: string; bytes?: number; path: string }>;
      preferDownload: boolean;
    };
    expect(install.preferDownload).toBe(true);
    expect(install.download["windows-x64"]).toEqual({
      url: "https://github.com/arduino/arduino-cli/releases/download/v1.6.0/arduino-cli_1.6.0_Windows_64bit.zip",
      sha256: "2769b9b282ce597db9679d8ec14d726d57004ca4205ef4d7a795bf36b6cdc9d8",
      bytes: 20404890,
      path: "arduino-cli.exe",
    });
    expect(install.download["linux-x64"]).toEqual({
      url: "https://github.com/arduino/arduino-cli/releases/download/v1.6.0/arduino-cli_1.6.0_Linux_64bit.tar.gz",
      sha256: "321ee249f44c78053234fec0f36101092bc6021bf24939e15e0cc2449c5ed250",
      bytes: 20111675,
      path: "arduino-cli",
    });
    const version = m.programs["arduino-cli"]?.version;
    expect(version?.range).toBe(">=1.6,<2");
    expect(
      new RegExp(version?.match ?? "").exec(
        "arduino-cli  Version: 1.6.0 Commit: 50a0e80da Date: 2026-11-10T15:30:44Z",
      )?.[1],
    ).toBe("1.6.0");
    const risk = (program: string, args: string[]) => classifyCommand(m.rules ?? [], program, args).risk;
    for (const args of [
      ["version"],
      ["upload", "-p", "COM5"],
      ["daemon"],
      ["burn-bootloader"],
      ["monitor", "-p", "COM5"],
    ])
      expect(risk("arduino-cli", args), args.join(" ")).toBe("blocked");
    expect(risk("arduino-tool", ["--version"])).toBe("safe");
    expect(risk("arduino-tool", ["inspect", "--sketch", "Blink"])).toBe("safe");
    expect(risk("arduino-tool", ["boards", "details", "--fqbn", "arduino:avr:uno"])).toBe("safe");
    expect(risk("arduino-tool", ["boards", "search", "uno"])).toBe("safe");
    expect(risk("arduino-tool", ["cores", "list"])).toBe("safe");
    expect(risk("arduino-tool", ["libraries", "search", "servo"])).toBe("safe");
    expect(risk("arduino-tool", ["report", "--run", "x"])).toBe("safe");
    expect(risk("arduino-tool", ["clean"])).toBe("safe");
    expect(risk("arduino-tool", ["boards", "list"])).toBe("safe");
    // A compile runs the installed core's tools on this computer and writes a run folder: no approval.
    expect(risk("arduino-tool", ["compile", "--sketch", "Blink", "--fqbn", "arduino:avr:uno"])).toBe("safe");
    expect(risk("arduino-tool", ["compile", "--sketch", "Blink"])).toBe("safe");
    // A download or a change of sketch.yaml asks in Ask mode only.
    expect(risk("arduino-tool", ["install", "core", "arduino:avr"])).toBe("device-read");
    expect(risk("arduino-tool", ["install", "library", "Servo", "Adafruit BusIO"])).toBe("device-read");
    expect(risk("arduino-tool", ["install", "index"])).toBe("device-read");
    expect(risk("arduino-tool", ["attach", "--sketch", "Blink", "--fqbn", "arduino:avr:uno"])).toBe(
      "device-read",
    );
    // Whatever writes the board's flash asks.
    expect(risk("arduino-tool", ["upload", "--build", "r.json"])).toBe("device-write");
    expect(risk("arduino-tool", ["compile", "--sketch", "Blink", "--upload", "--watch", "5"])).toBe(
      "device-write",
    );
    expect(risk("arduino-tool", ["compile", "--upload", "--sketch", "Blink"])).toBe("device-write");
    for (const programmer of [["--programmer", "usbasp"], ["--programmer=usbasp"]]) {
      for (const base of [
        ["upload", "--build", "r.json", "--port", "COM5"],
        ["compile", "--sketch", "Blink", "--upload"],
      ]) {
        const result = classifyCommand(m.rules ?? [], "arduino-tool", [...base, ...programmer]);
        expect(result.risk, base.join(" ")).toBe("irreversible");
        expect(result.notes.join(" ")).toContain("bootloader");
      }
    }
    // Listing examples reads; a new sketch folder or removed run folders ask in Ask mode only.
    expect(risk("arduino-tool", ["examples", "list", "--library", "Servo"])).toBe("safe");
    expect(risk("arduino-tool", ["examples", "copy", "--library", "Servo", "--example", "Sweep"])).toBe(
      "device-read",
    );
    expect(risk("arduino-tool", ["clean", "--runs", "--keep", "3"])).toBe("device-read");
    // Any other arduino-cli command is passed on after approval; one that rewrites the bootloader needs the word.
    expect(risk("arduino-tool", ["cli", "--", "lib", "deps", "Servo"])).toBe("device-write");
    expect(risk("arduino-tool", ["cli", "--online", "--", "lib", "upgrade"])).toBe("device-write");
    expect(
      risk("arduino-tool", ["cli", "--", "burn-bootloader", "-b", "arduino:avr:uno", "-P", "usbasp"]),
    ).toBe("irreversible");
    const readme = await readFile(join(source, "README.md"), "utf8");
    for (const text of [
      "1.6.0",
      "2769b9b282ce597db9679d8ec14d726d57004ca4205ef4d7a795bf36b6cdc9d8",
      ".vera-arduino",
      "GPL-3.0",
    ])
      expect(readme).toContain(text);
  });

  it("is an official catalog plugin in the Arduino pack with three skills (REQ-FUNC-693a8fbf)", async () => {
    const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
    expect(catalog.official).toContain("arduino-cli");
    expect(catalog.metadata["arduino-cli"].activities).toEqual(["build", "flash"]);
    const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
    expect(packs.find((pack: { id: string }) => pack.id === "arduino")?.groups).toContainEqual({
      name: "Sketches (Arduino CLI)",
      plugins: ["arduino-cli"],
      default: true,
    });
    expect(await core.checkCatalogSource(fileURLToPath(plugins))).toEqual([]);
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-arduino-skill-")));
    roots.push(root);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(source);
    const installed = await store.load("arduino-cli");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const expected: Record<string, string[]> = {
      "arduino-build-fix": [
        "arduino-tool compile",
        "diagnostics",
        "never installs",
        "header-missing",
        "attach",
      ],
      "arduino-libraries": [
        "arduino-tool libraries search",
        "install library",
        "header-missing",
        "--no-deps",
      ],
      "arduino-test-sketch": ["VERA-FIXTURE", "--upload", "--watch", "boards list", "BUSY", "serial capture"],
    };
    for (const [name, texts] of Object.entries(expected)) {
      const content = (await skills.read("plugin", name)).content;
      for (const text of texts) expect(content, `${name}: ${text}`).toContain(text);
    }
  });

  it("carries workspace.py as a byte-identical copy of ngspice-tool's path rules", async () => {
    const ours = await readFile(join(scripts, "arduino_support", "workspace.py"));
    const theirs = await readFile(
      fileURLToPath(new URL("ngspice/scripts/ngspice_support/workspace.py", plugins)),
    );
    expect(sha256(ours)).toBe(sha256(theirs));
  });

  it("prints its version and lists its operations (REQ-SEC-93d5fc98)", async () => {
    const b = await bench();
    expect(spawnSync(python, ["-I", script, "--version"], { encoding: "utf8" }).stdout.trim()).toBe(
      "arduino-tool 0.3.0",
    );
    const help = spawnSync(python, ["-I", script, "--help"], { encoding: "utf8" }).stdout;
    for (const operation of [
      "inspect",
      "boards",
      "cores",
      "libraries",
      "examples",
      "install",
      "attach",
      "compile",
      "upload",
      "report",
      "clean",
      "cli",
    ])
      expect(help).toContain(operation);
    // What arduino-tool has no operation of its own for goes through `cli --`.
    for (const absent of ["daemon", "monitor", "burn", "fuse"])
      expect(help.toLowerCase()).not.toContain(absent);
    const network = b.run([
      "upload",
      "--build",
      "x.json",
      "--port",
      "COM5",
      "--identity",
      "x",
      "--protocol",
      "network",
    ]);
    expect(network.code).toBe(2);
    expect(codes(network.doc)).toEqual(["arguments"]);
    expect(await b.calls()).toEqual([]);
  });
});

describe("environment and install", { timeout: 30_000 }, () => {
  it("runs arduino-cli only with VERA's own folders, offline outside install (REQ-FUNC-32924acc)", async () => {
    const b = await bench({ ports: [UNO_PORT] });
    expect(b.run(["inspect", "--sketch", "sketches/VeraBlink"]).code).toBe(0);
    expect(b.run(["boards", "list"]).code).toBe(0);
    expect(b.run(["install", "index"]).code).toBe(0);
    const calls = await b.calls();
    expect(commands(calls)).toEqual([
      "version",
      "core list",
      "lib list",
      "board list",
      "core update-index",
      "lib update-index",
    ]);
    const home = b.home.replaceAll("\\", "/");
    for (const call of calls) {
      expect(call.config).toContain(`data: "${home}/data"`);
      expect(call.config).toContain(`user: "${home}/user"`);
      expect(call.config).toContain(`downloads: "${home}/downloads"`);
      expect(call.config).not.toMatch(/Arduino15|Documents[\\/]Arduino/);
      expect(call.config.includes('proxy: "http://127.0.0.1:9"'), call.argv.join(" ")).toBe(
        !call.argv.includes("update-index"),
      );
    }
  });

  it("installs the latest or a named version, a library with its dependencies, without post-install scripts (REQ-FUNC-9fceeea6)", async () => {
    const deps = [
      { name: "Servo", version_required: "1.2.2", version_installed: "1.2.2" },
      { name: "Helper", version_required: "1.0.3" },
    ];
    const b = await bench({ cores: {}, deps, latest: { "arduino:avr": "1.8.8", Servo: "1.3.0" } });
    for (const args of [
      ["install", "core", "arduino:avr@latest"],
      ["install", "library", "Servo@latest"],
      ["install", "index", "--index-url", "http://example.com/package_x_index.json"],
      ["install", "index", "--index-url", "https://user:pw@example.com/i.json"],
    ]) {
      const refused = b.run(args);
      expect(refused.code, args.join(" ")).toBe(2);
    }
    expect(await b.calls()).toEqual([]);
    // The first install fetches the indexes by itself, and without a version the latest is installed.
    const first = b.run(["install", "core", "arduino:avr"]);
    expect(first.code, first.stdout).toBe(0);
    expect(first.doc.installed).toEqual([{ id: "arduino:avr", version: "1.8.8" }]);
    expect(commands(await b.calls())).toEqual([
      "core update-index",
      "lib update-index",
      "core list",
      "core install",
      "core list",
    ]);
    const index = b.run([
      "install",
      "index",
      "--index-url",
      "https://espressif.github.io/arduino-esp32/package_esp32_index.json",
    ]);
    expect(index.code).toBe(0);
    expect(JSON.parse(await readFile(join(b.home, "environment.json"), "utf8"))).toEqual({
      format: 1,
      indexUrls: ["https://espressif.github.io/arduino-esp32/package_esp32_index.json"],
    });
    await mkdir(join(b.home, "data"), { recursive: true });
    await writeFile(join(b.home, "data", "package_index.json"), "{}");
    await writeFile(join(b.home, "data", "library_index.json"), "{}");
    await b.resetCalls();
    const pinned = b.run(["install", "core", "arduino:avr@1.8.6"]);
    expect(pinned.code).toBe(0);
    expect(pinned.doc.installed).toEqual([{ id: "arduino:avr", version: "1.8.6", replaced: "1.8.8" }]);
    // A library comes with its dependencies; several are installed in one call.
    const library = b.run(["install", "library", "Servo", "VeraCounter@1.2.0"]);
    expect(library.code, library.stdout).toBe(0);
    expect(library.doc.installed).toEqual([
      { name: "Helper", version: "1.0.3" },
      { name: "Servo", version: "1.3.0" },
      { name: "VeraCounter", version: "1.2.0" },
    ]);
    expect(library.doc.warnings).toEqual([]);
    const alone = b.run(["install", "library", "Lonely@2.0.0", "--no-deps"]);
    expect(alone.code).toBe(0);
    expect(alone.doc.installed).toEqual([{ name: "Lonely", version: "2.0.0" }]);
    const installs = (await b.calls())
      .filter((call) => call.argv.includes("install"))
      .map((call) => call.argv);
    expect(installs).toEqual([
      ["core", "install", "arduino:avr@1.8.6", "--skip-post-install"],
      ["lib", "install", "Servo", "VeraCounter@1.2.0"],
      ["lib", "install", "Lonely@2.0.0", "--no-deps"],
    ]);
    // Only an install reaches the network.
    for (const call of await b.calls())
      if (call.argv.includes("install") || call.argv.includes("update-index"))
        expect(call.config, call.argv.join(" ")).not.toContain("proxy:");
  });
});

describe("queries", { timeout: 30_000 }, () => {
  it("inspects a sketch without changing it and reports an ignored sketch.yaml (REQ-FUNC-d02a9d01)", async () => {
    const b = await bench();
    const before = await tree(join(b.work, "sketches/VeraBlink"));
    const result = b.run(["inspect", "--sketch", "sketches/VeraBlink"]);
    expect(result.code).toBe(0);
    expect(result.doc.sketch).toMatchObject({ path: "sketches/VeraBlink", main: "VeraBlink.ino" });
    expect(result.doc.files).toEqual([
      { path: "VeraBlink.ino", sha256: before["VeraBlink.ino"], bytes: expect.any(Number) },
    ]);
    expect((result.doc.sketch as { ignored: unknown }).ignored).toEqual([
      {
        path: "sketch.yaml",
        keys: ["default_fqbn", "default_port", "default_profile", "profiles"],
        defaults: { fqbn: "arduino:avr:uno", port: "COM99" },
      },
    ]);
    // The board and port sketch.yaml names are used; its profiles are not.
    expect((result.doc.sketch as { defaults: unknown }).defaults).toEqual({
      fqbn: "arduino:avr:uno",
      port: "COM99",
    });
    expect(result.doc.warnings.map((warning) => warning.code)).toEqual(["sketch-profile-unused"]);
    expect(result.doc.arduinoCli).toEqual({ present: true, version: "1.6.0" });
    expect(await tree(join(b.work, "sketches/VeraBlink"))).toEqual(before);
    const misnamed = b.run(["inspect", "--sketch", "sketches/Misnamed"]);
    expect(misnamed.code).toBe(2);
    expect(codes(misnamed.doc)).toEqual(["sketch-invalid"]);
    const missing = b.run(["inspect", "--sketch", "sketches/VeraBlink"], {
      VERA_PROGRAM_ARDUINO_CLI: join(b.root, "none.exe"),
    });
    expect(missing.code).toBe(0);
    expect(missing.doc.arduinoCli).toEqual({ present: false, version: null });
    expect(missing.doc.files).toHaveLength(1);
  });

  it("lists serial ports by identity and never identifies a board behind a USB bridge (REQ-FUNC-cbd22972)", async () => {
    const b = await bench({ ports: [UNO_PORT, CH340("COM6"), NETWORK, port("COM3", {})] });
    const result = b.run(["boards", "list"]);
    expect(result.code).toBe(0);
    expect(result.doc.ignored).toBe(1);
    expect(result.doc.ports).toEqual([
      expect.objectContaining({
        address: "COM5",
        identity: UNO_IDENTITY,
        stable: true,
        identified: true,
        boards: [{ name: "Arduino UNO", fqbn: "arduino:avr:uno" }],
      }),
      expect.objectContaining({
        address: "COM6",
        identity: "usb:1a86:7523",
        stable: false,
        identified: false,
        boards: [],
        bridge: "WCH CH340",
        candidates: [{ name: "Clone Nano", fqbn: "arduino:avr:nano" }],
      }),
      expect.objectContaining({ address: "COM3", identity: "serial:COM3", stable: false, identified: false }),
    ]);
  });

  it("answers board, core and library queries offline (REQ-FUNC-91c2c9a8)", async () => {
    const b = await bench({ libraries: { Servo: "1.2.2" } });
    const details = b.run(["boards", "details", "--fqbn", "arduino:avr:nano"]);
    expect(details.code).toBe(0);
    expect(details.doc.board).toMatchObject({
      fqbn: "arduino:avr:nano",
      options: [{ option: "cpu", values: ["atmega328", "atmega328old", "atmega168"], default: "atmega328" }],
    });
    expect(b.run(["boards", "search", "uno"]).doc.boards).toContainEqual(
      expect.objectContaining({ fqbn: "arduino:avr:uno", platform: "arduino:avr" }),
    );
    expect(b.run(["cores", "list"]).doc.platforms).toEqual([
      { id: "arduino:avr", installed: "1.8.8", latest: "1.8.8" },
    ]);
    expect(b.run(["libraries", "list"]).doc.libraries).toEqual([
      { name: "Servo", version: "1.2.2", location: "index" },
    ]);
    expect(commands(await b.calls())).toEqual(["board details", "board listall", "core list", "lib list"]);
    for (const call of await b.calls()) expect(call.config).toContain('proxy: "http://127.0.0.1:9"');
  });
});

describe("query hardening", { timeout: 30_000 }, () => {
  it("refuses search text, names and versions that arduino-cli would read as options (REQ-SEC-93d5fc98)", async () => {
    const b = await bench();
    for (const args of [
      ["libraries", "search", "--", "--log-file=outside.log"],
      ["cores", "search", "--", "-v"],
      ["boards", "search", "--", "--log-file=outside.log"],
    ]) {
      const refused = b.run(args);
      expect(refused.code, args.join(" ")).toBe(2);
      expect(codes(refused.doc), args.join(" ")).toEqual(["arguments"]);
    }
    for (const args of [
      ["install", "library", "--", "-x@1.0.0"],
      ["install", "core", "--", "-x:avr@1.0.0"],
      ["compile", "--sketch", "sketches/VeraBlink", "--fqbn=-x:avr:uno"],
    ]) {
      const refused = b.run(args);
      expect(refused.code, args.join(" ")).toBe(2);
      expect(codes(refused.doc), args.join(" ")).toEqual([
        args[0] === "compile" ? "fqbn-invalid" : "version-invalid",
      ]);
    }
    expect(await b.calls()).toEqual([]);
    expect(existsSync(join(b.work, "outside.log"))).toBe(false);
  });

  it("searches the downloaded indexes itself, so a stale index never blocks a search (REQ-FUNC-91c2c9a8)", async () => {
    const b = await bench();
    await mkdir(join(b.home, "data"), { recursive: true });
    const release = (version: string) => ({
      name: "Arduino AVR Boards",
      version,
      boards: [{ name: "Arduino UNO" }],
    });
    await writeFile(
      join(b.home, "data", "package_index.json"),
      JSON.stringify({
        packages: [
          {
            name: "arduino",
            platforms: [
              { architecture: "avr", ...release("1.8.6") },
              { architecture: "avr", ...release("1.8.10") },
              {
                architecture: "samd",
                name: "Arduino SAMD Boards",
                version: "1.8.14",
                boards: [{ name: "Arduino Zero" }],
              },
            ],
          },
        ],
      }),
    );
    await writeFile(
      join(b.home, "data", "library_index.json"),
      JSON.stringify({
        libraries: [
          {
            name: "Servo",
            version: "1.2.2",
            sentence: "Allows Arduino boards to control servo motors.",
            architectures: ["*"],
          },
          {
            name: "Servo",
            version: "1.10.0",
            sentence: "Allows Arduino boards to control servo motors.",
            architectures: ["*"],
          },
          { name: "Stepper", version: "1.1.3", sentence: "Drive stepper motors.", architectures: ["*"] },
        ],
      }),
    );
    const cores = b.run(["cores", "search", "AVR"]);
    expect(cores.code).toBe(0);
    expect(cores.doc.platforms).toEqual([
      { id: "arduino:avr", name: "Arduino AVR Boards", latest: "1.8.10", installed: "1.8.8" },
    ]);
    const libraries = b.run(["libraries", "search", "servo motors"]);
    expect(libraries.code).toBe(0);
    expect(libraries.doc.libraries).toEqual([
      {
        name: "Servo",
        latest: "1.10.0",
        sentence: "Allows Arduino boards to control servo motors.",
        architectures: ["*"],
      },
    ]);
    expect(commands(await b.calls())).toEqual(["core list"]);
    const missing = await bench();
    const none = missing.run(["libraries", "search", "servo"]);
    expect(none.code).toBe(2);
    expect(codes(none.doc)).toEqual(["index-missing"]);
  });

  it.runIf(windows)("refuses a sketch that holds a junction (REQ-FUNC-d02a9d01)", async () => {
    const b = await bench();
    await mkdir(join(b.root, "secret"));
    await writeFile(join(b.root, "secret", "passwords.txt"), "x");
    await symlink(join(b.root, "secret"), join(b.work, "sketches", "VeraBlink", "inner"), "junction");
    const result = b.run(["inspect", "--sketch", "sketches/VeraBlink"]);
    expect(result.code).toBe(2);
    expect(codes(result.doc)).toEqual(["sketch-invalid"]);
    expect(result.stdout).not.toContain("passwords");
  });

  it("reports a failed arduino-cli call as an error, not a refusal (REQ-DATA-e444904d)", async () => {
    const b = await bench({ fail: ["core list"] });
    const result = b.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:uno"]);
    expect(result.code).toBe(3);
    expect(result.doc.status).toBe("error");
    expect(codes(result.doc)).toEqual(["tool-failed"]);
    await b.write({ fail: ["board list"] });
    const listed = b.run(["boards", "list"]);
    expect(listed.code).toBe(3);
    expect(listed.doc.status).toBe("error");
    expect(codes(listed.doc)).toEqual(["tool-failed"]);
  });
});

describe("compile", { timeout: 30_000 }, () => {
  const library = ["--library-dir", "libraries/VeraCounter"];
  const used = [
    { name: "SPI", version: "1.0", location: "platform", container_platform: "arduino:avr@1.8.8" },
    { name: "VeraCounter", version: "1.0.0", location: "unmanaged" },
  ];

  it("refuses a missing or different core or library before compiling, installing nothing (REQ-REL-c731bd06)", async () => {
    const b = await bench({ cores: { "arduino:avr": "1.8.6" } });
    const version = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--core",
      "arduino:avr@1.8.8",
    ]);
    expect(version.code).toBe(2);
    expect(codes(version.doc)).toEqual(["core-version"]);
    expect(version.doc.errors[0]?.message).toContain("arduino-tool install core arduino:avr@1.8.8");
    const missing = b.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:samd:mkrzero"]);
    expect(codes(missing.doc)).toEqual(["core-missing"]);
    const lib = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--library",
      "Servo@1.2.2",
    ]);
    expect(lib.code).toBe(2);
    expect(codes(lib.doc)).toEqual(["library-missing"]);
    const calls = commands(await b.calls());
    expect(calls).not.toContain("compile --fqbn");
    expect(calls.some((call) => call.includes("install"))).toBe(false);
    expect(existsSync(join(b.work, "arduino-iot-results"))).toBe(false);
  });

  it("refuses an unknown board or option instead of correcting it (REQ-SEC-f5477b64)", async () => {
    const b = await bench();
    const board = b.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:unoo"]);
    expect(board.code).toBe(2);
    expect(board.doc.errors[0]).toMatchObject({ code: "fqbn-unknown" });
    expect(board.doc.errors[0]?.candidates).toContain("arduino:avr:uno");
    const option = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:nano:cpu=atmega9",
    ]);
    expect(option.code).toBe(2);
    expect(option.doc.errors[0]).toMatchObject({
      code: "fqbn-option",
      declared: ["atmega328", "atmega328old", "atmega168"],
    });
    expect(
      b.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:nano:speed=1"]).doc
        .errors[0],
    ).toMatchObject({ code: "fqbn-option" });
    expect(commands(await b.calls())).not.toContain("compile --fqbn");
  });

  it("warns of a core with local overrides and records the hooks of a build (REQ-SEC-8faa1e1d)", async () => {
    const hook = "recipe.hooks.prebuild.1.pattern=echo prebuild";
    const b = await bench({ compile: { build_properties: [hook, "recipe.c.o.pattern=avr-gcc"] } });
    const passed = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--run-id",
      "hooks",
    ]);
    expect(passed.code).toBe(0);
    expect((passed.doc.platform as { hooks: string[] }).hooks).toEqual([hook]);
    const folder = join(b.home, "data", "packages", "arduino", "hardware", "avr", "1.8.8");
    await mkdir(folder, { recursive: true });
    await writeFile(join(folder, "platform.local.txt"), "recipe.hooks.prebuild.9.pattern=curl evil\n");
    await b.resetCalls();
    const overridden = b.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:uno"]);
    expect(overridden.code).toBe(0);
    expect(overridden.doc.warnings.map((warning) => warning.code)).toContain("local-override");
    expect(commands(await b.calls())).toContain("compile --fqbn");
  });

  it("compiles a copy into a new run folder with a traceable result and no absolute path (REQ-FUNC-6678cab1, REQ-DATA-e444904d)", async () => {
    const b = await bench({ compile: { used_libraries: used } });
    const before = await tree(join(b.work, "sketches"));
    const result = b.run([
      "compile",
      "--sketch",
      "sketches/VeraLibrary",
      "--fqbn",
      "arduino:avr:uno",
      "--core",
      "arduino:avr@1.8.8",
      ...library,
      "--run-id",
      "lib1",
    ]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    const run = join(b.work, "arduino-iot-results", "lib1");
    const saved = JSON.parse(await readFile(join(run, "result.json"), "utf8")) as Doc;
    expect(saved).toMatchObject({
      format: 1,
      kind: "arduino-tool-result",
      operation: "compile",
      status: "pass",
      fqbn: "arduino:avr:uno",
      board: "Arduino UNO",
      platform: { id: "arduino:avr", version: "1.8.8" },
      arduinoCli: { version: "1.6.0" },
      log: "arduino-iot-results/lib1/compile.log",
      sizes: [
        { section: "text", bytes: 1880, maxBytes: 32256 },
        { section: "data", bytes: 190, maxBytes: 2048 },
      ],
    });
    expect(saved).toMatchObject({ fqbnFrom: "argument", incremental: true });
    expect(saved.profile).toContain("fqbn: arduino:avr:uno");
    expect(await readFile(join(run, "profile.yaml"), "utf8")).toBe(`${saved.profile}\n`);
    expect(saved.libraries).toEqual([
      { name: "SPI", version: "1.0", location: "platform", platform: "arduino:avr@1.8.8" },
      {
        name: "VeraCounter",
        version: "1.0.0",
        location: "local",
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);
    const source = saved.source as {
      path: string;
      sha256: string;
      files: { path: string; sha256: string }[];
    };
    expect(source.path).toBe("sketches/VeraLibrary");
    expect(source.files.map((file) => file.path)).toEqual(["VeraLibrary.ino", "counter_note.h"]);
    for (const file of source.files) expect(file.sha256).toBe(before[`VeraLibrary/${file.path}`]);
    for (const binary of saved.binaries as { path: string; sha256: string }[])
      expect(sha256(await readFile(join(run, binary.path)))).toBe(binary.sha256);
    expect(await tree(join(run, "sketch", "VeraLibrary"))).toEqual({
      "VeraLibrary.ino": before["VeraLibrary/VeraLibrary.ino"],
      "counter_note.h": before["VeraLibrary/counter_note.h"],
    });
    for (const name of ["result.json", "report.md", "compile.log"]) {
      const text = await readFile(join(run, name), "utf8");
      expect(text).not.toContain(b.root);
      expect(text).not.toContain(b.root.replaceAll("\\", "/"));
      expect(text).not.toContain(b.root.replaceAll("\\", "\\\\"));
    }
    expect(await readFile(join(run, "report.md"), "utf8")).toContain("| VeraCounter | 1.0.0 | local |");
    expect(await tree(join(b.work, "sketches"))).toEqual(before);
    expect(await readdir(join(b.home, "staging"))).toEqual([]);
    const call = (await b.calls()).find((entry) => entry.argv[0] === "compile") as Call;
    expect(call.argv).toContain("--build-path");
    // arduino-cli builds in the folder VERA keeps for this sketch and board, from the copy of the sources there.
    const [kept] = await readdir(join(b.home, "builds"));
    expect(kept).toMatch(/^VeraLibrary-[0-9a-f]{16}$/);
    const keptFolder = join(b.home, "builds", kept as string);
    expect(call.argv[call.argv.indexOf("--build-path") + 1]).toBe(join(keptFolder, "build"));
    expect(call.argv.at(-1)).toBe(join(keptFolder, "sketch", "VeraLibrary"));
    expect(call.argv[call.argv.indexOf("--library") + 1]).toBe(join(keptFolder, "libraries", "VeraCounter"));
    expect(Object.keys(await tree(join(keptFolder, "libraries", "VeraCounter")))).toContain(
      "src/VeraCounter.cpp",
    );
    expect(existsSync(join(keptFolder, "owner.json"))).toBe(false);
    const yaml = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--run-id",
      "blink",
    ]);
    expect(yaml.doc.warnings.map((warning) => warning.code)).toEqual(["sketch-profile-unused"]);
    expect(
      existsSync(join(b.work, "arduino-iot-results", "blink", "sketch", "VeraBlink", "sketch.yaml")),
    ).toBe(false);
    const again = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--run-id",
      "blink",
    ]);
    expect(again.code).toBe(2);
    expect(codes(again.doc)).toEqual(["run-exists"]);
    const vera = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--results-dir",
      ".vera/out",
    ]);
    expect(vera.code).toBe(2);
    expect(codes(vera.doc)).toEqual(["path"]);
  });

  it("reports compile errors as sketch diagnostics with no binary (REQ-REL-6b92ea2f)", async () => {
    const sep = windows ? "\\" : "/";
    const b = await bench({
      compile: {
        success: false,
        compiler_err: `{sketch}${sep}VeraBroken.ino: In function 'void setup()':\r\n{sketch}${sep}VeraBroken.ino:2:3: error: 'undeclaredThing' was not declared in this scope\r\n   undeclaredThing = 3;\r\n`,
      },
    });
    const result = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBroken",
      "--fqbn",
      "arduino:avr:uno",
      "--run-id",
      "broken",
    ]);
    expect(result.code).toBe(3);
    expect(result.doc.status).toBe("fail");
    expect(result.doc.diagnostics).toEqual([
      {
        severity: "error",
        file: "VeraBroken.ino",
        line: 2,
        column: 3,
        message: "'undeclaredThing' was not declared in this scope",
      },
    ]);
    expect(result.doc.binaries).toEqual([]);
    expect(existsSync(join(b.work, "arduino-iot-results", "broken", "binary"))).toBe(false);
  });

  it("records the index libraries a build used, checks a named version and warns of an ambiguous choice (REQ-SEC-37d5b2a2)", async () => {
    const servo = [{ name: "Servo", version: "1.2.2", location: "user" }];
    const b = await bench({ libraries: { Servo: "1.2.2" }, compile: { used_libraries: servo } });
    // A build needs no declaration of what it uses: the result records it.
    const plain = b.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:uno"]);
    expect(plain.code, plain.stdout).toBe(0);
    expect(plain.doc.libraries).toEqual([{ name: "Servo", version: "1.2.2", location: "index" }]);
    // --library is a check: this library, in this version when one is named, must be installed.
    const pin = (library: string) =>
      b.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:uno", "--library", library]);
    expect(pin("Servo@1.2.2").code).toBe(0);
    expect(pin("Servo").code).toBe(0);
    expect(codes(pin("Servo@1.2.0").doc)).toEqual(["library-version"]);
    expect(codes(pin("Stepper").doc)).toEqual(["library-missing"]);
    await b.write({
      libraries: { Servo: "1.2.2" },
      compile: {
        used_libraries: servo,
        compiler_out: 'Multiple libraries were found for "Servo.h"\n Used: x\n',
      },
    });
    const ambiguous = pin("Servo@1.2.2");
    expect(ambiguous.code).toBe(0);
    expect(ambiguous.doc.warnings.map((warning) => warning.code)).toContain("library-ambiguous");
  });

  it("takes the board from sketch.yaml or the one connected board when the call names none", async () => {
    const b = await bench({ ports: [UNO_PORT] });
    // VeraBlink's sketch.yaml names arduino:avr:uno.
    const fromSketch = b.run(["compile", "--sketch", "sketches/VeraBlink"]);
    expect(fromSketch.code, fromSketch.stdout).toBe(0);
    expect(fromSketch.doc).toMatchObject({ fqbn: "arduino:avr:uno", fqbnFrom: "sketch.yaml" });
    expect(commands(await b.calls())).not.toContain("board list");
    await b.resetCalls();
    // VeraLibrary has no sketch.yaml: the one board that identifies itself is the board.
    const fromBoard = b.run(["compile", "--sketch", "sketches/VeraLibrary"]);
    expect(fromBoard.code, fromBoard.stdout).toBe(0);
    expect(fromBoard.doc).toMatchObject({ fqbn: "arduino:avr:uno", fqbnFrom: "connected board" });
    expect(commands(await b.calls())[0]).toBe("board list");
    await b.write({ ports: [CH340("COM7")] });
    const unknown = b.run(["compile", "--sketch", "sketches/VeraLibrary"]);
    expect(unknown.code).toBe(2);
    expect(codes(unknown.doc)).toEqual(["fqbn-required"]);
    expect(unknown.doc.errors[0]?.message).toContain("arduino-tool attach --sketch sketches/VeraLibrary");
    // attach writes the board into sketch.yaml with arduino-cli itself; the next compile finds it there.
    const attached = b.run([
      "attach",
      "--sketch",
      "sketches/VeraLibrary",
      "--fqbn",
      "arduino:avr:nano:cpu=atmega328old",
    ]);
    expect(attached.code, attached.stdout).toBe(0);
    expect((attached.doc.sketch as { defaults: unknown }).defaults).toEqual({
      fqbn: "arduino:avr:nano:cpu=atmega328old",
    });
    expect(await readFile(join(b.work, "sketches/VeraLibrary/sketch.yaml"), "utf8")).toContain(
      "default_fqbn: arduino:avr:nano:cpu=atmega328old",
    );
    const remembered = b.run(["compile", "--sketch", "sketches/VeraLibrary"]);
    expect(remembered.doc).toMatchObject({
      status: "pass",
      fqbn: "arduino:avr:nano:cpu=atmega328old",
      fqbnFrom: "sketch.yaml",
    });
    expect(codes(b.run(["attach", "--sketch", "sketches/VeraLibrary"]).doc)).toEqual(["arguments"]);
    expect(
      codes(b.run(["attach", "--sketch", "sketches/VeraLibrary", "--fqbn", "arduino:avr:nano:cpu=z80"]).doc),
    ).toEqual(["fqbn-option"]);
  });

  it("keeps a build folder per sketch and board, so a later compile rebuilds only what changed", async () => {
    const b = await bench();
    const compile = (...extra: string[]) =>
      b.run(["compile", "--sketch", "sketches/VeraLibrary", "--fqbn", "arduino:avr:uno", ...extra]);
    expect(compile().code).toBe(0);
    const [kept] = await readdir(join(b.home, "builds"));
    const copy = join(b.home, "builds", kept as string, "sketch", "VeraLibrary");
    const untouched = (await stat(join(copy, "counter_note.h"))).mtimeMs;
    const edited = (await stat(join(copy, "VeraLibrary.ino"))).mtimeMs;
    await new Promise((done) => setTimeout(done, 1100));
    await writeFile(
      join(b.work, "sketches/VeraLibrary/VeraLibrary.ino"),
      `${await readFile(join(b.work, "sketches/VeraLibrary/VeraLibrary.ino"), "utf8")}\n// edited\n`,
    );
    await writeFile(join(b.work, "sketches/VeraLibrary/extra.h"), "#define EXTRA 1\n");
    const second = compile();
    expect(second.doc).toMatchObject({ status: "pass", incremental: true });
    // The same folders again; only the changed file was rewritten there, and the new one added.
    const builds = (await b.calls()).filter((call) => call.argv[0] === "compile");
    expect(builds).toHaveLength(2);
    expect(builds[1]?.argv.at(-1)).toBe(builds[0]?.argv.at(-1));
    expect(builds[1]?.argv[builds[1].argv.indexOf("--build-path") + 1]).toBe(
      builds[0]?.argv[builds[0].argv.indexOf("--build-path") + 1],
    );
    expect((await stat(join(copy, "counter_note.h"))).mtimeMs).toBe(untouched);
    expect((await stat(join(copy, "VeraLibrary.ino"))).mtimeMs).toBeGreaterThan(edited);
    expect((await readdir(copy)).sort()).toEqual(["VeraLibrary.ino", "counter_note.h", "extra.h"]);
    await rm(join(b.work, "sketches/VeraLibrary/extra.h"));
    expect(compile("--clean").doc).toMatchObject({ status: "pass", incremental: false });
    expect((await readdir(copy)).sort()).toEqual(["VeraLibrary.ino", "counter_note.h"]);
    // Another board is another build folder; clean removes them all.
    expect(b.run(["compile", "--sketch", "sketches/VeraLibrary", "--fqbn", "arduino:avr:nano"]).code).toBe(0);
    expect(await readdir(join(b.home, "builds"))).toHaveLength(2);
    expect((b.run(["clean"]).doc.clean as { buildsRemoved: number }).buildsRemoved).toBe(2);
    expect(await readdir(join(b.home, "builds"))).toEqual([]);
  });

  it("names the libraries that provide a header the compiler did not find", async () => {
    const sep = windows ? "\\" : "/";
    const b = await bench({
      compile: {
        success: false,
        compiler_err: `{sketch}${sep}VeraMissingLib.ino:2:10: fatal error: Servo.h: No such file or directory\n #include <Servo.h>\n`,
      },
    });
    await mkdir(join(b.home, "data"), { recursive: true });
    await writeFile(
      join(b.home, "data", "library_index.json"),
      JSON.stringify({
        libraries: [
          { name: "Servo", version: "1.2.0", providesIncludes: ["Servo.h"], types: ["Arduino"] },
          { name: "Servo", version: "1.3.0", providesIncludes: ["Servo.h"], types: ["Arduino"] },
          { name: "ESP32Servo", version: "3.0.0", providesIncludes: ["ESP32Servo.h", "Servo.h"] },
          { name: "Stepper", version: "1.1.3", providesIncludes: ["Stepper.h"] },
        ],
      }),
    );
    const failed = b.run(["compile", "--sketch", "sketches/VeraMissingLib", "--fqbn", "arduino:avr:uno"]);
    expect(failed.code).toBe(3);
    expect(codes(failed.doc)).toEqual(["compile-failed", "header-missing"]);
    expect(failed.doc.errors[1]).toMatchObject({
      header: "Servo.h",
      libraries: [
        { name: "Servo", latest: "1.3.0" },
        { name: "ESP32Servo", latest: "3.0.0" },
      ],
    });
    expect(failed.doc.errors[1]?.message).toContain('arduino-tool install library "Servo"');
  });
});

describe("upload", { timeout: 30_000 }, () => {
  async function built(scenario: Record<string, unknown> = {}) {
    const b = await bench({ ports: [UNO_PORT], ...scenario });
    const compiled = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--run-id",
      "build",
    ]);
    expect(compiled.code, compiled.stdout).toBe(0);
    await b.resetCalls();
    return { ...b, result: "arduino-iot-results/build/result.json", run: b.run };
  }
  const upload = (extra: string[] = []) => [
    "upload",
    "--build",
    "arduino-iot-results/build/result.json",
    "--port",
    "COM5",
    "--identity",
    UNO_IDENTITY,
    ...extra,
  ];

  it("uploads the verified copy of the build's binary to the named port (REQ-FUNC-f2b3eb7d)", async () => {
    const b = await built({ upload: { updated: { address: "COM5", protocol: "serial" } } });
    const result = b.run(upload(["--run-id", "up"]));
    expect(result.code, result.stdout).toBe(0);
    const calls = await b.calls();
    expect(commands(calls)).toEqual(["board list", "upload --fqbn", "board list"]);
    const argv = (calls[1] as Call).argv;
    expect(argv.slice(0, 7)).toEqual([
      "upload",
      "--fqbn",
      "arduino:avr:uno",
      "--port",
      "COM5",
      "--protocol",
      "serial",
    ]);
    const input = argv[argv.indexOf("--input-dir") + 1] as string;
    expect(input.startsWith(join(b.home, "staging"))).toBe(true);
    const compile = JSON.parse(await readFile(join(b.work, b.result), "utf8")) as Doc;
    const hex = (compile.binaries as { path: string; sha256: string }[]).find((item) =>
      item.path.endsWith(".hex"),
    );
    expect(result.doc).toMatchObject({
      status: "pass",
      fqbn: "arduino:avr:uno",
      identity: UNO_IDENTITY,
      binary: { path: "arduino-iot-results/build/binary/VeraBlink.ino.hex", sha256: hex?.sha256 },
      build: { path: b.result, sha256: sha256(await readFile(join(b.work, b.result))) },
      port: { before: "COM5", after: "COM5" },
      board: { identified: true, names: ["Arduino UNO"] },
      verified: false,
    });
    expect(existsSync(join(b.work, "arduino-iot-results", "up", "upload.log"))).toBe(true);
    expect(await readdir(join(b.home, "staging"))).toEqual([]);
    expect((calls[1] as Call).sketchFiles).toEqual(["VeraBlink.ino"]);
    expect((calls[1] as Call).argv.at(-1)?.startsWith(join(b.home, "staging"))).toBe(true);
  });

  it("uploads with the recorded sketch files only, never a sketch.yaml added to the run folder (REQ-SEC-ea1a5b7d)", async () => {
    const b = await built();
    const copy = join(b.work, "arduino-iot-results/build/sketch/VeraBlink");
    await writeFile(join(copy, "sketch.yaml"), "default_programmer: usbasp\ndefault_profile: x\n");
    const result = b.run(upload());
    expect(result.code, result.stdout).toBe(0);
    const call = (await b.calls()).find((entry) => entry.argv[0] === "upload") as Call;
    expect(call.sketchFiles).toEqual(["VeraBlink.ino"]);
    expect(call.argv).not.toContain("--programmer");
    await b.resetCalls();
    await writeFile(join(copy, "extra.h"), "#define EXTRA 1\n");
    const added = b.run(upload());
    expect(added.code).toBe(2);
    expect(codes(added.doc)).toEqual(["conflict"]);
    expect(commands(await b.calls())).toEqual([]);
  });

  it("re-binds the identity to the port it returns on after the upload (REQ-FUNC-165776d6)", async () => {
    const moved = port("COM7", { vid: "0x2341", pid: "0x0043", serialNumber: UNO_SERIAL }, [
      { name: "Arduino UNO", fqbn: "arduino:avr:uno" },
    ]);
    const b = await built({
      portsAfter: [moved],
      upload: { updated: { address: "COM7", protocol: "serial" } },
    });
    const result = b.run(upload());
    expect(result.code).toBe(0);
    expect(result.doc.port).toEqual({ before: "COM5", after: "COM7", reported: "COM7" });
    const gone = await built({ portsAfter: [] });
    const lost = gone.run(upload());
    expect(lost.code).toBe(0);
    expect(lost.doc.port).toMatchObject({ before: "COM5", after: null });
    expect(lost.doc.warnings.map((warning) => warning.code)).toEqual(["identity-not-found"]);
  });

  it("keeps an upload's outcome when the ports cannot be listed after it, with the port unknown (REQ-FUNC-165776d6)", async () => {
    const unlisted = await built({ failAfterUpload: ["board list"] });
    const kept = unlisted.run(upload(["--run-id", "kept"]));
    expect(kept.code, kept.stdout).toBe(0);
    expect(kept.doc.port).toMatchObject({ before: "COM5", after: null });
    expect(kept.doc.warnings.map((warning) => warning.code)).toEqual(["ports-unlisted"]);
    const keptRecord = JSON.parse(
      await readFile(join(unlisted.work, "arduino-iot-results/kept/result.json"), "utf8"),
    ) as Doc;
    expect(keptRecord.status).toBe("pass");
  });

  it("refuses a failed build or any changed binary or sketch before arduino-cli runs (REQ-SEC-ea1a5b7d)", async () => {
    const b = await built();
    const result = join(b.work, b.result);
    const saved = await readFile(result, "utf8");
    await writeFile(result, saved.replace('"status": "pass"', '"status": "fail"'));
    expect(codes(b.run(upload()).doc)).toEqual(["build-failed"]);
    await writeFile(result, saved);
    const hex = join(b.work, "arduino-iot-results/build/binary/VeraBlink.ino.hex");
    const bytes = await readFile(hex);
    await writeFile(hex, Buffer.concat([bytes, Buffer.from("\n")]));
    const changed = b.run(upload());
    expect(changed.code).toBe(2);
    expect(changed.doc.errors[0]).toMatchObject({ code: "conflict", file: "binary/VeraBlink.ino.hex" });
    await writeFile(hex, bytes);
    const ino = join(b.work, "sketches/VeraBlink/VeraBlink.ino");
    const code = await readFile(ino, "utf8");
    await writeFile(ino, `${code}// edited after the build\n`);
    expect(codes(b.run(upload()).doc)).toEqual(["conflict"]);
    await rm(join(b.work, "sketches/VeraBlink"), { recursive: true });
    expect(codes(b.run(upload()).doc)).toEqual(["conflict"]);
    expect(await b.calls()).toEqual([]);
  });

  it("finds the port by itself, checks a named identity and warns of a board it cannot confirm (REQ-SEC-77af299d)", async () => {
    const b = await built({ ports: [UNO_PORT] });
    const plain = ["upload", "--build", b.result];
    // One port holds the build's board: no --port and no --identity are needed.
    const alone = b.run(plain);
    expect(alone.code, alone.stdout).toBe(0);
    expect(alone.doc).toMatchObject({ identity: UNO_IDENTITY, port: { before: "COM5" }, warnings: [] });
    const absent = b.run([...plain, "--port", "COM9", "--identity", UNO_IDENTITY]);
    expect(absent.doc.errors[0]).toMatchObject({ code: "port-missing", now: ["COM5"] });
    expect(codes(b.run(upload(["--programmer", "usbtiny"])).doc)).toEqual(["programmer-unknown"]);
    const otherUno = port("COM5", { vid: "0x2341", pid: "0x0043", serialNumber: "OTHER" }, [
      { name: "Arduino UNO", fqbn: "arduino:avr:uno" },
    ]);
    const ours = port("COM8", { vid: "0x2341", pid: "0x0043", serialNumber: UNO_SERIAL }, [
      { name: "Arduino UNO", fqbn: "arduino:avr:uno" },
    ]);
    await b.write({ ports: [otherUno, ours] });
    // A named identity is still checked: the port now carries another board.
    const mismatch = b.run(upload());
    expect(mismatch.doc.errors[0]).toMatchObject({ code: "identity-mismatch", now: ["COM8"] });
    // The identity alone finds its port; two boards of the build's model need a choice.
    expect(b.run([...plain, "--identity", UNO_IDENTITY]).doc.port).toMatchObject({ before: "COM8" });
    const choice = b.run(plain);
    expect(choice.code).toBe(2);
    expect(choice.doc.errors[0]).toMatchObject({ code: "port-required", ports: ["COM5", "COM8"] });
    await b.write({ ports: [CH340("COM5"), CH340("COM6")] });
    expect(codes(b.run([...plain, "--identity", "usb:1a86:7523"]).doc)).toEqual(["identity-ambiguous"]);
    await b.resetCalls();
    // A board behind a USB bridge cannot be identified: the upload goes ahead and says so.
    const bridge = b.run([...plain, "--port", "COM6"]);
    expect(bridge.code, bridge.stdout).toBe(0);
    expect(bridge.doc.warnings.map((warning) => warning.code)).toEqual(["board-unverified"]);
    expect(bridge.doc.board).toEqual({ identified: false, names: [], bridge: "WCH CH340" });
    expect(commands(await b.calls())).toContain("upload --fqbn");
    await b.write({ ports: [CH340("COM5")] });
    expect(b.run(plain).doc.port).toMatchObject({ before: "COM5" });
    await b.write({
      ports: [
        port("COM5", { vid: "0x2341", pid: "0x8036", serialNumber: UNO_SERIAL }, [
          { name: "Arduino Leonardo", fqbn: "arduino:avr:leonardo" },
        ]),
      ],
    });
    // A port that identifies as another model is a warning too: compatible boards report borrowed identities.
    const leonardo = b.run(plain);
    expect(leonardo.code).toBe(0);
    expect(leonardo.doc.warnings.map((warning) => warning.code)).toEqual(["board-mismatch"]);
    await b.write({ ports: [] });
    expect(codes(b.run(plain).doc)).toEqual(["port-required"]);
  });

  it("uploads over the network to the address the call names", async () => {
    const b = await built({ ports: [NETWORK] });
    await writeFile(join(b.work, "ota.txt"), "fixture-ota-word\n");
    const result = b.run([
      "upload",
      "--build",
      b.result,
      "--network",
      "--port",
      "192.168.1.20",
      "--password-file",
      "ota.txt",
    ]);
    expect(result.code, result.stdout).toBe(0);
    const calls = await b.calls();
    // No serial port is looked for, before or after.
    expect(commands(calls)).toEqual(["upload --fqbn"]);
    expect(calls[0]?.argv.slice(0, 9)).toEqual([
      "upload",
      "--fqbn",
      "arduino:avr:uno",
      "--port",
      "192.168.1.20",
      "--protocol",
      "network",
      "--upload-field",
      "password=fixture-ota-word",
    ]);
    expect(result.doc).toMatchObject({
      status: "pass",
      identity: "network:192.168.1.20",
      port: { before: "192.168.1.20", after: "192.168.1.20", protocol: "network" },
    });
    expect(JSON.stringify(result.doc)).not.toContain("fixture-ota-word");
    // Without a password file the field is empty; what belongs to a serial upload is refused.
    await b.resetCalls();
    expect(b.run(["upload", "--build", b.result, "--network", "--port", "esp-kitchen.local"]).code).toBe(0);
    expect((await b.calls())[0]?.argv).toContain("password=");
    for (const extra of [
      ["--network"],
      ["--network", "--port", "192.168.1.20", "--watch", "5"],
      ["--network", "--port", "192.168.1.20", "--identity", "usb:1:2"],
      ["--port", "COM5", "--password-file", "ota.txt"],
    ])
      expect(codes(b.run(["upload", "--build", b.result, ...extra]).doc), extra.join(" ")).toEqual([
        "arguments",
      ]);
    // The boards the discovery tools see on the network are listed for it.
    expect(b.run(["boards", "list"]).doc.network).toEqual([
      { address: "192.168.1.20", label: "esp", boards: [] },
    ]);
  });
  it("compiles, uploads and reads what the board prints in one call", async () => {
    const banner = "VERA-FIXTURE arduino-cli blink 1.0.0\r\nvalue=42\r\n";
    const b = await bench({ ports: [UNO_PORT], monitor: { text: banner } });
    const result = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--upload",
      "--watch",
      "2",
      "--run-id",
      "one",
    ]);
    expect(result.code, result.stdout + result.stderr).toBe(0);
    expect(commands(await b.calls())).toEqual([
      "core list",
      "board details",
      "compile --fqbn",
      "version",
      "board list",
      "upload --fqbn",
      "board list",
      "monitor --port",
    ]);
    expect(result.doc).toMatchObject({
      operation: "compile",
      status: "pass",
      runId: "one",
      fqbnFrom: "sketch.yaml",
      upload: {
        status: "pass",
        port: { before: "COM5", after: "COM5" },
        identity: UNO_IDENTITY,
        serial: {
          port: "COM5",
          baud: 115200,
          seconds: 2,
          text: "VERA-FIXTURE arduino-cli blink 1.0.0\nvalue=42\n",
        },
      },
    });
    const sent = result.doc.upload as { runId: string; serial: { log: string } };
    expect(await readFile(join(b.work, sent.serial.log), "utf8")).toBe(banner);
    expect(sent.serial.log).toBe(`arduino-iot-results/${sent.runId}/serial.log`);
    const monitor = (await b.calls()).at(-1) as Call;
    expect(monitor.argv).toEqual([
      "monitor",
      "--port",
      "COM5",
      "--protocol",
      "serial",
      "--config",
      "baudrate=115200",
      "--quiet",
    ]);
    expect(monitor.config).toContain('proxy: "http://127.0.0.1:9"');
    expect(await readdir(join(b.home, "staging"))).toEqual([]);
    // A board that prints nothing is a warning with the baud rate to check; --baud names another one.
    await b.write({ ports: [UNO_PORT], monitor: { text: "" } });
    const silent = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--upload",
      "--watch",
      "1",
      "--baud",
      "9600",
    ]);
    expect(silent.code).toBe(0);
    expect(silent.doc.warnings.map((warning) => warning.code)).toContain("serial-silent");
    expect((silent.doc.upload as { serial: { baud: number } }).serial.baud).toBe(9600);
    // Without a board the build stays and the call says why nothing was uploaded.
    await b.write({ ports: [] });
    const unsent = b.run(["compile", "--sketch", "sketches/VeraBlink", "--upload", "--run-id", "kept"]);
    expect(unsent.code).toBe(2);
    expect(unsent.doc).toMatchObject({ status: "blocked", upload: { status: "blocked" } });
    expect(codes(unsent.doc)).toEqual(["port-required"]);
    expect(
      JSON.parse(await readFile(join(b.work, "arduino-iot-results/kept/result.json"), "utf8")),
    ).toMatchObject({ status: "pass", operation: "compile" });
    // The upload options belong to an upload.
    expect(codes(b.run(["compile", "--sketch", "sketches/VeraBlink", "--watch", "5"]).doc)).toEqual([
      "arguments",
    ]);
    expect(
      codes(b.run(["upload", "--build", "arduino-iot-results/kept/result.json", "--watch", "500"]).doc),
    ).toEqual(["arguments"]);
  });

  it("summarizes run folders in a report and refuses a folder without a result (REQ-FUNC-e2eea361)", async () => {
    const b = await built();
    expect(b.run(upload(["--run-id", "up"])).code).toBe(0);
    const summary = b.run([
      "report",
      "--run",
      "arduino-iot-results/build",
      "--run",
      "arduino-iot-results/up",
      "--run-id",
      "sum",
    ]);
    expect(summary.code).toBe(0);
    expect(summary.doc.runs).toEqual([
      expect.objectContaining({
        path: "arduino-iot-results/build",
        operation: "compile",
        status: "pass",
        fqbn: "arduino:avr:uno",
        binarySha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
      expect.objectContaining({
        path: "arduino-iot-results/up",
        operation: "upload",
        status: "pass",
        fqbn: "arduino:avr:uno",
      }),
    ]);
    expect(await readFile(join(b.work, "arduino-iot-results/sum/report.md"), "utf8")).toContain(
      "| `arduino-iot-results/up` | upload | pass |",
    );
    const invalid = b.run(["report", "--run", "sketches/VeraBlink"]);
    expect(invalid.code).toBe(2);
    expect(codes(invalid.doc)).toEqual(["run-invalid"]);
  });
});

describe("beyond build and upload", { timeout: 30_000 }, () => {
  const base = ["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:uno"];

  it("lists the examples of installed libraries and copies one as a new sketch", async () => {
    const b = await bench();
    const library = join(b.root, "libraries", "Servo");
    for (const name of ["Sweep", "Knob"]) {
      await mkdir(join(library, "examples", name), { recursive: true });
      await writeFile(join(library, "examples", name, `${name}.ino`), "void setup() {}\nvoid loop() {}\n");
    }
    await writeFile(join(library, "examples", "Sweep", "notes.h"), "// notes\n");
    await b.write({
      examples: [
        {
          library: { name: "Servo", version: "1.2.2", location: "user", install_dir: library },
          examples: [join(library, "examples", "Knob"), join(library, "examples", "Sweep")],
        },
        {
          library: { name: "Bare", version: "1.0.0", location: "user", install_dir: join(b.root, "bare") },
          examples: [],
        },
      ],
    });
    const listed = b.run(["examples", "list", "--library", "Servo"]);
    expect(listed.code, listed.stdout).toBe(0);
    expect(listed.doc.examples).toEqual([
      { library: "Servo", version: "1.2.2", location: "index", examples: ["Knob", "Sweep"] },
    ]);
    expect((await b.calls()).at(-1)?.argv).toEqual(["lib", "examples", "Servo"]);
    const copy = ["examples", "copy", "--library", "Servo", "--example", "sweep", "--to", "sketches/Arm"];
    const copied = b.run(copy);
    expect(copied.code, copied.stdout).toBe(0);
    expect(copied.doc.sketch).toEqual({ path: "sketches/Arm", main: "Arm.ino", files: 2 });
    expect(copied.doc.example).toEqual({ library: "Servo", version: "1.2.2", name: "Sweep" });
    // The main file follows the new folder's name, so the copy is a sketch arduino-tool compiles.
    expect((await readdir(join(b.work, "sketches/Arm"))).sort()).toEqual(["Arm.ino", "notes.h"]);
    expect(b.run(["compile", "--sketch", "sketches/Arm", "--fqbn", "arduino:avr:uno"]).code).toBe(0);
    // Nothing is overwritten, and the library's own folder is unchanged.
    expect(codes(b.run(copy).doc)).toEqual(["exists"]);
    expect((await readdir(join(library, "examples", "Sweep"))).sort()).toEqual(["Sweep.ino", "notes.h"]);
    expect(codes(b.run(["examples", "copy", "--library", "Servo", "--example", "Blink"]).doc)).toEqual([
      "example-unknown",
    ]);
    expect(
      codes(b.run(["examples", "copy", "--library", "Servo", "--example", "Knob", "--to", ".vera/Knob"]).doc),
    ).toEqual(["path"]);
  });

  it("passes defines and build properties to the compile, each variant in its own build folder", async () => {
    const database = [{ directory: "/x", file: "VeraBlink.ino.cpp", arguments: ["avr-g++", "-DDEBUG=1"] }];
    const b = await bench({ compile: { database } });
    const result = b.run([
      ...base,
      "--define",
      "DEBUG=1",
      "--define",
      "BANNER=two words",
      "--define",
      "QUIET",
      "--build-property",
      "build.f_cpu=8000000L",
      "--compile-commands",
    ]);
    expect(result.code, result.stdout).toBe(0);
    const argv = (await b.calls()).find((call) => call.argv[0] === "compile")?.argv ?? [];
    // A value that is more than one word is quoted the way arduino-cli splits a property.
    const flags = "-DDEBUG=1 '-DBANNER=two words' -DQUIET";
    expect(argv.filter((_, index) => argv[index - 1] === "--build-property")).toEqual([
      "build.f_cpu=8000000L",
      `compiler.c.extra_flags=${flags}`,
      `compiler.cpp.extra_flags=${flags}`,
    ]);
    expect(result.doc).toMatchObject({
      defines: ["DEBUG=1", "BANNER=two words", "QUIET"],
      buildProperties: ["build.f_cpu=8000000L"],
      compileCommands: `arduino-iot-results/${result.doc.runId}/compile_commands.json`,
    });
    expect(JSON.parse(await readFile(join(b.work, result.doc.compileCommands as string), "utf8"))).toEqual(
      database,
    );
    // Other defines are another build folder, so switching between a debug and a plain build stays incremental.
    expect(b.run(base).code).toBe(0);
    expect(await readdir(join(b.home, "builds"))).toHaveLength(2);
    for (const [extra, code] of [
      [["--define", "1BAD"], "define-invalid"],
      [["--define", "A=it's"], "define-invalid"],
      [["--build-property", "novalue"], "property-invalid"],
      [["--define", "A", "--build-property", "compiler.cpp.extra_flags=-Os"], "property-invalid"],
      [["--symbols", "0"], "arguments"],
    ] as const)
      expect(codes(b.run([...base, ...extra]).doc), extra.join(" ")).toEqual([code]);
  });

  it("reports the largest symbols on request and when a sketch does not fit", async () => {
    const b = await bench();
    const tools = join(b.root, "toolchain");
    await mkdir(tools);
    await writeFile(
      join(tools, "nm.txt"),
      [
        "00000068 00004e20 t big2",
        "0000a12a 000001b2 T main",
        "0080019f 0000009d b Serial",
        "00800116 00000080 D table",
        "00000000 00000010 ? odd",
        "",
      ].join("\n"),
    );
    const nm = join(tools, windows ? "fake-nm.cmd" : "fake-nm");
    await writeFile(nm, windows ? '@type "%~dp0nm.txt"\r\n' : '#!/bin/sh\ncat "$(dirname "$0")/nm.txt"\n');
    if (!windows) await chmod(nm, 0o755);
    // The toolchain's nm is found next to the size tool the core's recipes name.
    const properties = [`compiler.path=${tools}${windows ? "\\" : "/"}`, "compiler.size.cmd=fake-size"];
    await b.write({ compile: { build_properties: properties } });
    const asked = b.run([...base, "--symbols", "2"]);
    expect(asked.code, asked.stdout).toBe(0);
    expect(asked.doc.symbols).toEqual({
      flash: [
        { name: "big2", bytes: 20000, kind: "text" },
        { name: "main", bytes: 434, kind: "text" },
      ],
      ram: [
        { name: "Serial", bytes: 157, kind: "bss" },
        { name: "table", bytes: 128, kind: "data" },
      ],
    });
    expect(b.run(base).doc.symbols).toBeUndefined();
    // A sketch that does not fit says what takes the space without being asked.
    await b.write({
      compile: {
        build_properties: properties,
        success: false,
        linked: true,
        error: "Error during build: text section exceeds available space in board",
        compiler_out:
          "Sketch uses 41888 bytes (129%) of program storage space. Maximum is 32256 bytes.\nGlobal variables use 316 bytes (15%) of dynamic memory, leaving 1732 bytes for local variables. Maximum is 2048 bytes.\n",
      },
    });
    const fat = b.run(base);
    expect(fat.code).toBe(3);
    expect(fat.doc.sizes).toEqual([
      { section: "text", bytes: 41888, maxBytes: 32256 },
      { section: "data", bytes: 316, maxBytes: 2048 },
    ]);
    expect((fat.doc.symbols as { flash: unknown[] }).flash[0]).toEqual({
      name: "big2",
      bytes: 20000,
      kind: "text",
    });
    expect(fat.doc.binaries).toEqual([]);
    // Without the toolchain's nm the build stands and a warning says why there are no symbols.
    await b.write({});
    const none = b.run([...base, "--symbols", "5"]);
    expect(none.code).toBe(0);
    expect(none.doc.warnings.map((warning) => warning.code)).toContain("symbols-unavailable");
  });

  it("runs any other arduino-cli command in VERA's own environment", async () => {
    const b = await bench({ deps: [{ name: "Helper", version_required: "1.0.3" }] });
    const deps = b.run(["cli", "--", "lib", "deps", "Servo"]);
    expect(deps.code, deps.stdout + deps.stderr).toBe(0);
    expect(deps.doc).toMatchObject({
      operation: "cli",
      status: "pass",
      command: ["arduino-cli", "lib", "deps", "Servo"],
      exitCode: 0,
    });
    expect(deps.doc.output).toContain("Helper");
    const [call] = await b.calls();
    expect(call?.argv).toEqual(["lib", "deps", "Servo"]);
    expect(call?.config).toContain('proxy: "http://127.0.0.1:9"');
    expect(call?.config).toContain(b.home.replaceAll("\\", "/"));
    await b.resetCalls();
    // --online lets the command reach the network.
    expect(b.run(["cli", "--online", "--", "core", "update-index"]).code).toBe(0);
    expect((await b.calls())[0]?.config).not.toContain("proxy:");
    const failed = b.run(["cli", "--", "burn-bootloader", "-b", "arduino:avr:uno"]);
    expect(failed.code).toBe(3);
    expect(failed.doc).toMatchObject({ status: "fail", exitCode: 1 });
    expect(codes(failed.doc)).toEqual(["command-failed"]);
    for (const args of [
      ["cli"],
      ["cli", "--"],
      ["cli", "--", "daemon"],
      ["cli", "--", "lib", "list", "--config-file", "mine.yaml"],
    ])
      expect(codes(b.run(args).doc), args.join(" ")).toEqual(["arguments"]);
    expect(await readdir(join(b.home, "staging"))).toEqual([]);
  });

  it("removes old run folders of the workbench and leaves everything else there", async () => {
    const b = await bench();
    for (const id of ["a", "b", "c"]) expect(b.run([...base, "--run-id", `run-${id}`]).code).toBe(0);
    const results = join(b.work, "arduino-iot-results");
    await mkdir(join(results, "job-1"));
    await writeFile(
      join(results, "job-1", "result.json"),
      JSON.stringify({ format: 1, kind: "wokwi-tool-result" }),
    );
    await mkdir(join(results, "notes"));
    await writeFile(join(results, "keep.txt"), "mine");
    const cleaned = b.run(["clean", "--runs", "--keep", "1"]);
    expect(cleaned.code, cleaned.stdout).toBe(0);
    expect(cleaned.doc.clean).toEqual({
      runs: {
        folder: "arduino-iot-results",
        kept: 1,
        removed: 2,
        bytesFreed: expect.any(Number),
        failed: [],
      },
    });
    // Only arduino-tool's own run folders go: another tool's folder and the user's files stay.
    expect((await readdir(results)).sort()).toEqual(["job-1", "keep.txt", "notes", "run-c"]);
    // VERA's kept build folder is not part of the workbench: the next compile is still incremental.
    expect(await readdir(join(b.home, "builds"))).toHaveLength(1);
    expect(codes(b.run(["clean", "--runs", "--keep=-1"]).doc)).toEqual(["arguments"]);
  });
});

describe("Stop and clean", () => {
  it("leaves no process after Stop, keeps the sketch and environment, and clean removes only ended staging (REQ-REL-fa13ca61)", async () => {
    const b = await bench({ sleep: { compile: 60 } });
    for (const folder of ["data", "downloads", "user"]) {
      await mkdir(join(b.home, folder), { recursive: true });
      await writeFile(join(b.home, folder, "keep.txt"), folder);
    }
    const before = await tree(join(b.work, "sketches"));
    const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));
    const runner = new core.ProgramRunner({ host: new core.NodeProcessHost(spawn), clock: { sleep } });
    await mkdir(join(b.work, ".vera"), { recursive: true });
    const env = b.env();
    const run = await runner.start({
      sessionId: "s1",
      workbench: b.work,
      executable: python,
      args: ["-I", script, "compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:uno"],
      env: {
        VERA_ARDUINO_HOME: env.VERA_ARDUINO_HOME,
        VERA_PROGRAM_ARDUINO_CLI: env.VERA_PROGRAM_ARDUINO_CLI,
        VERA_FAKE_ARDUINO: env.VERA_FAKE_ARDUINO,
        PYTHONDONTWRITEBYTECODE: "1",
        ...(windows ? { ComSpec: process.env.ComSpec ?? "C:\\Windows\\System32\\cmd.exe" } : {}),
      },
    });
    const marker = `${b.scenarioPath}.sleeping`;
    for (let waited = 0; !existsSync(marker) && waited < 30_000; waited += 100) await sleep(100);
    expect(existsSync(marker), (await run.stop()).output).toBe(true);
    const { pid, ppid } = JSON.parse(await readFile(marker, "utf8")) as { pid: number; ppid: number };
    const [staged] = await readdir(join(b.home, "staging"));
    const helper = (
      JSON.parse(await readFile(join(b.home, "staging", staged as string, "owner.json"), "utf8")) as {
        pid: number;
      }
    ).pid;
    const result = await run.stop();
    expect(result.stopped).toBe(true);
    const alive = (id: number) => {
      try {
        process.kill(id, 0);
        return true;
      } catch {
        return false;
      }
    };
    // The fake, its parent (the helper on Linux, the .cmd shell on Windows) and the helper itself.
    for (const id of new Set([pid, ppid, helper])) {
      for (let waited = 0; alive(id) && waited < 10_000; waited += 100) await sleep(100);
      expect(alive(id), `process ${id}`).toBe(false);
    }
    const [interrupted] = await readdir(join(b.work, "arduino-iot-results"));
    const record = JSON.parse(
      await readFile(join(b.work, "arduino-iot-results", interrupted as string, "result.json"), "utf8"),
    ) as Doc;
    expect(record.status).toBe("incomplete");
    expect(codes(record)).toEqual(["interrupted"]);
    expect(await tree(join(b.work, "sketches"))).toEqual(before);
    const left = await readdir(join(b.home, "staging"));
    expect(left).toHaveLength(1);
    const busy = join(b.home, "staging", "busy-run");
    await mkdir(busy);
    await writeFile(join(busy, "owner.json"), JSON.stringify({ format: 1, pid: process.pid }));
    const cleaned = b.run(["clean"]);
    expect(cleaned.code).toBe(0);
    expect(cleaned.doc.clean).toMatchObject({ staging: { removed: left, inUse: ["busy-run"], failed: [] } });
    expect(await readdir(join(b.home, "staging"))).toEqual(["busy-run"]);
    for (const folder of ["data", "downloads", "user"])
      expect(await readFile(join(b.home, folder, "keep.txt"), "utf8")).toBe(folder);
    // The cache stays while a staging folder is in use; a fresh folder without owner.json is never removed.
    await mkdir(join(b.home, "cache"), { recursive: true });
    await mkdir(join(b.home, "staging", "starting"));
    const second = b.run(["clean"]);
    expect(second.doc.clean).toMatchObject({ staging: { removed: [] }, cacheRemoved: false });
    expect((await readdir(join(b.home, "staging"))).sort()).toEqual(["busy-run", "starting"]);
    expect(existsSync(join(b.home, "cache"))).toBe(true);
  }, 60_000);
});

reportSkip(
  !realTool,
  "the real arduino-cli tests",
  "set VERA_TEST_ARDUINO_CLI to an arduino-cli 1.6 and VERA_ARDUINO_HOME to its environment",
);
describe.skipIf(!realTool)("real arduino-cli (VERA_TEST_ARDUINO_CLI, VERA_ARDUINO_HOME)", () => {
  async function real() {
    const root = await realpath(await mkdtemp(join(tmpdir(), "vera-arduino-real-")));
    roots.push(root);
    const work = join(root, "work");
    await cp(fixtures, work, { recursive: true });
    const run = (args: string[]) => {
      const result = spawnSync(python, ["-I", script, ...args], {
        cwd: work,
        encoding: "utf8",
        env: { ...process.env, PYTHONDONTWRITEBYTECODE: "1", VERA_PROGRAM_ARDUINO_CLI: realTool as string },
      });
      return { code: result.status, doc: JSON.parse(result.stdout) as Doc, stdout: result.stdout };
    };
    return { root, work, run };
  }

  it.each([
    ["arduino:avr:uno", "arduino:avr@1.8.8", ".hex"],
    ["arduino:samd:mkrzero", "arduino:samd@1.8.14", ".bin"],
  ])(
    "compiles the fixtures for %s with traceable core, libraries and binary (REQ-FUNC-6678cab1, REQ-TEST-de25fd47)",
    async (fqbn, pinned, extension) => {
      const r = await real();
      const before = await tree(join(r.work, "sketches"));
      const blink = r.run([
        "compile",
        "--sketch",
        "sketches/VeraBlink",
        "--fqbn",
        fqbn,
        "--core",
        pinned,
        "--run-id",
        "blink",
      ]);
      expect(blink.code, blink.stdout).toBe(0);
      const [platform, version] = pinned.split("@");
      expect(blink.doc.platform).toMatchObject({ id: platform, version });
      expect(
        (blink.doc.binaries as { path: string }[]).some((item) =>
          item.path.endsWith(`VeraBlink.ino${extension}`),
        ),
      ).toBe(true);
      for (const binary of blink.doc.binaries as { path: string; sha256: string }[])
        expect(sha256(await readFile(join(r.work, "arduino-iot-results/blink", binary.path)))).toBe(
          binary.sha256,
        );
      const written = JSON.parse(
        await readFile(join(r.work, "arduino-iot-results/blink/result.json"), "utf8"),
      ) as Doc;
      expect(written).toMatchObject({ status: "pass", fqbn, arduinoCli: { version: "1.6.0" } });
      const sizes = written.sizes as { section: string; bytes: number; maxBytes: number }[];
      for (const section of ["text", "data"]) {
        const entry = sizes.find((item) => item.section === section);
        expect(entry?.bytes, section).toBeGreaterThan(0);
        expect(entry?.maxBytes, section).toBeGreaterThan(entry?.bytes ?? 0);
      }
      const library = r.run([
        "compile",
        "--sketch",
        "sketches/VeraLibrary",
        "--fqbn",
        fqbn,
        "--core",
        pinned,
        "--library-dir",
        "libraries/VeraCounter",
        "--run-id",
        "lib",
      ]);
      expect(library.code, library.stdout).toBe(0);
      expect(library.doc.libraries).toEqual([
        expect.objectContaining({ name: "SPI", location: "platform" }),
        expect.objectContaining({ name: "VeraCounter", version: "1.0.0", location: "local" }),
      ]);
      // The versions of this build as an Arduino build profile, and a second compile from the kept build folder.
      expect(blink.doc.profile).toContain(`platform: ${platform} (${version})`);
      const again = r.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", fqbn, "--run-id", "again"]);
      expect(again.doc).toMatchObject({ status: "pass", incremental: true });
      // The image that is uploaded is the same; the .elf beside it carries build-specific debug data.
      const image = (doc: Doc) =>
        (doc.binaries as { path: string; sha256: string }[]).find((item) =>
          item.path.endsWith(`VeraBlink.ino${extension}`),
        )?.sha256;
      expect(image(again.doc)).toBe(image(blink.doc));
      expect(await tree(join(r.work, "sketches"))).toEqual(before);
    },
    600_000,
  );

  it("copies a library example, reports its largest symbols and passes a command on", async () => {
    const r = await real();
    const listed = r.run(["examples", "list", "--fqbn", "arduino:avr:uno"]);
    expect(listed.code, listed.stdout).toBe(0);
    const eeprom = (listed.doc.examples as { library: string; location: string; examples: string[] }[]).find(
      (item) => item.library === "EEPROM",
    );
    expect(eeprom).toMatchObject({ location: "platform" });
    expect(eeprom?.examples).toContain("eeprom_read");
    const copied = r.run([
      "examples",
      "copy",
      "--library",
      "EEPROM",
      "--example",
      "eeprom_read",
      "--fqbn",
      "arduino:avr:uno",
      "--to",
      "sketches/Rom",
    ]);
    expect(copied.code, copied.stdout).toBe(0);
    const built = r.run([
      "compile",
      "--sketch",
      "sketches/Rom",
      "--fqbn",
      "arduino:avr:uno",
      "--symbols",
      "3",
      "--define",
      "VERA_PROBE=1",
      "--compile-commands",
    ]);
    expect(built.code, built.stdout).toBe(0);
    expect(built.doc.libraries).toContainEqual(expect.objectContaining({ name: "EEPROM" }));
    // The real toolchain's nm, largest first.
    const symbols = built.doc.symbols as { flash: { name: string; bytes: number }[]; ram: unknown[] };
    expect(symbols.flash).toHaveLength(3);
    expect(symbols.flash[0]?.bytes).toBeGreaterThanOrEqual(symbols.flash[2]?.bytes ?? 0);
    expect(symbols.ram.length).toBeGreaterThan(0);
    const database = JSON.parse(
      await readFile(join(r.work, built.doc.compileCommands as string), "utf8"),
    ) as { arguments: string[] }[];
    expect(database.some((entry) => entry.arguments.includes("-DVERA_PROBE=1"))).toBe(true);
    const passed = r.run(["cli", "--", "version"]);
    expect(passed.code).toBe(0);
    expect(passed.doc.output).toContain("1.6.0");
  }, 300_000);

  it("reports real compile errors, an unknown board and a missing library without a binary (REQ-REL-6b92ea2f, REQ-SEC-f5477b64)", async () => {
    const r = await real();
    const broken = r.run([
      "compile",
      "--sketch",
      "sketches/VeraBroken",
      "--fqbn",
      "arduino:avr:uno",
      "--run-id",
      "broken",
    ]);
    expect(broken.code).toBe(3);
    expect(broken.doc.diagnostics).toContainEqual(
      expect.objectContaining({ severity: "error", file: "VeraBroken.ino", line: 2, column: 3 }),
    );
    expect(broken.doc.binaries).toEqual([]);
    const missing = r.run([
      "compile",
      "--sketch",
      "sketches/VeraMissingLib",
      "--fqbn",
      "arduino:avr:uno",
      "--run-id",
      "miss",
    ]);
    expect(missing.code).toBe(3);
    expect(missing.doc.diagnostics).toContainEqual(
      expect.objectContaining({
        severity: "fatal error",
        file: "VeraMissingLib.ino",
        line: 1,
        message: expect.stringContaining("NoSuchVeraLibrary.h"),
      }),
    );
    // The missing header is named with the index libraries that provide it; none does here.
    expect(missing.doc.errors).toContainEqual(
      expect.objectContaining({ code: "header-missing", header: "NoSuchVeraLibrary.h", libraries: [] }),
    );
    const unknown = r.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:unoo"]);
    expect(unknown.code).toBe(2);
    expect(unknown.doc.errors[0]?.candidates).toContain("arduino:avr:uno");
    const option = r.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:nano:cpu=atmega9",
    ]);
    expect(option.doc.errors[0]).toMatchObject({
      code: "fqbn-option",
      declared: ["atmega328", "atmega328old", "atmega168"],
    });
  }, 600_000);

  it("searches and compiles offline with indexes older than a day (REQ-FUNC-91c2c9a8, REQ-FUNC-32924acc)", async () => {
    const r = await real();
    const data = join(process.env.VERA_ARDUINO_HOME as string, "data");
    const old = new Date(Date.now() - 3 * 24 * 3600 * 1000);
    for (const name of await readdir(data))
      if (name.endsWith(".json") || name.endsWith(".sig")) await utimes(join(data, name), old, old);
    const cores = r.run(["cores", "search", "avr"]);
    expect(cores.code, cores.stdout).toBe(0);
    expect(cores.doc.platforms).toContainEqual(
      expect.objectContaining({ id: "arduino:avr", installed: "1.8.8" }),
    );
    const libraries = r.run(["libraries", "search", "servo"]);
    expect(libraries.code, libraries.stdout).toBe(0);
    expect(libraries.doc.libraries).toContainEqual(expect.objectContaining({ name: "Servo" }));
    const compiled = r.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--run-id",
      "stale",
    ]);
    expect(compiled.code, compiled.stdout).toBe(0);
  }, 300_000);

  it("answers queries offline and its offline configuration cannot reach the network (REQ-FUNC-32924acc, REQ-FUNC-91c2c9a8)", async () => {
    const r = await real();
    const cores = r.run(["cores", "list"]);
    expect(cores.doc.platforms).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "arduino:avr", installed: "1.8.8" }),
        expect.objectContaining({ id: "arduino:samd", installed: "1.8.14" }),
      ]),
    );
    const details = r.run(["boards", "details", "--fqbn", "arduino:avr:nano"]);
    expect(
      (details.doc.board as { programmers: { id: string }[] }).programmers.map((item) => item.id),
    ).toContain("arduinoasisp");
    const listed = r.run(["boards", "list"]);
    expect(listed.code).toBe(0);
    for (const entry of listed.doc.ports as { identity: string; stable: boolean }[])
      if (entry.identity.startsWith("serial:")) expect(entry.stable).toBe(false);
    const config = spawnSync(
      python,
      [
        "-I",
        "-B",
        "-c",
        "import sys; sys.path.insert(0, sys.argv[1]); from arduino_support.environment import Environment; print(Environment().config(False), end='')",
        scripts,
      ],
      { encoding: "utf8", env: process.env },
    ).stdout;
    const path = join(r.root, "offline.yaml");
    await writeFile(path, config);
    const update = spawnSync(realTool as string, ["--config-file", path, "core", "update-index", "--json"], {
      encoding: "utf8",
    });
    expect(update.status).not.toBe(0);
    const started = Date.now();
    spawnSync(realTool as string, ["--config-file", path, "lib", "update-index", "--json"], {
      encoding: "utf8",
    });
    expect(Date.now() - started).toBeLessThan(30_000);
  }, 300_000);
});

reportSkip(
  !realTool || !boardPort || !boardIdentity,
  "the real board test",
  "needs the real arduino-cli and a connected board (set VERA_TEST_ARDUINO_PORT and VERA_TEST_ARDUINO_IDENTITY)",
);
describe.skipIf(!realTool || !boardPort || !boardIdentity)(
  "real board (VERA_TEST_ARDUINO_PORT, VERA_TEST_ARDUINO_IDENTITY)",
  () => {
    it("uploads the fixture to the identified board and reads its version banner (REQ-TEST-de25fd47)", async () => {
      const root = await realpath(await mkdtemp(join(tmpdir(), "vera-arduino-board-")));
      roots.push(root);
      const work = join(root, "work");
      await cp(fixtures, work, { recursive: true });
      const env = {
        ...process.env,
        PYTHONDONTWRITEBYTECODE: "1",
        VERA_PROGRAM_ARDUINO_CLI: realTool as string,
      };
      const tool = (args: string[]) =>
        spawnSync(python, ["-I", script, ...args], { cwd: work, encoding: "utf8", env });
      const fqbn = process.env.VERA_TEST_ARDUINO_FQBN ?? "arduino:avr:uno";
      expect(
        tool(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", fqbn, "--run-id", "b"]).status,
      ).toBe(0);
      const sent = tool([
        "upload",
        "--build",
        "arduino-iot-results/b/result.json",
        "--port",
        boardPort as string,
        "--identity",
        boardIdentity as string,
        "--verify",
        "--run-id",
        "u",
      ]);
      expect(sent.status, sent.stdout).toBe(0);
      const after = (JSON.parse(sent.stdout) as { port: { after: string } }).port.after;
      const serial = fileURLToPath(new URL("serial-monitor/scripts/serial_monitor.py", plugins));
      const capture = spawnSync(
        python,
        [serial, "capture", "--port", after, "--baud", "115200", "--duration", "4"],
        { encoding: "utf8", env },
      );
      expect(capture.stdout).toContain("VERA-FIXTURE arduino-cli blink 1.0.0");
      expect((await stat(join(work, "arduino-iot-results/u/result.json"))).isFile()).toBe(true);
    }, 600_000);
  },
);
