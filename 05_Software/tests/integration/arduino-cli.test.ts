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
      download: Record<string, { url: string; sha256: string; path: string }>;
      preferDownload: boolean;
    };
    expect(install.preferDownload).toBe(true);
    expect(install.download["windows-x64"]).toEqual({
      url: "https://github.com/arduino/arduino-cli/releases/download/v1.6.0/arduino-cli_1.6.0_Windows_64bit.zip",
      sha256: "2769b9b282ce597db9679d8ec14d726d57004ca4205ef4d7a795bf36b6cdc9d8",
      path: "arduino-cli.exe",
    });
    expect(install.download["linux-x64"]).toEqual({
      url: "https://github.com/arduino/arduino-cli/releases/download/v1.6.0/arduino-cli_1.6.0_Linux_64bit.tar.gz",
      sha256: "321ee249f44c78053234fec0f36101092bc6021bf24939e15e0cc2449c5ed250",
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
    expect(risk("arduino-tool", ["boards", "list"])).toBe("device-read");
    expect(risk("arduino-tool", ["compile", "--sketch", "Blink", "--fqbn", "arduino:avr:uno"])).toBe(
      "device-read",
    );
    expect(risk("arduino-tool", ["install", "core", "arduino:avr@1.8.8"])).toBe("device-write");
    expect(risk("arduino-tool", ["install", "index"])).toBe("device-write");
    expect(risk("arduino-tool", ["upload", "--build", "r.json", "--port", "COM5", "--identity", "x"])).toBe(
      "device-write",
    );
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
      "arduino-build-fix": ["arduino-tool compile", "diagnostics", "never installs", "--core"],
      "arduino-libraries": [
        "arduino-tool libraries search",
        "install library",
        "--library",
        "undeclared-library",
      ],
      "arduino-test-sketch": ["VERA-FIXTURE", "serial capture", "--identity", "boards list", "BUSY"],
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

  it("prints its version and offers no daemon, monitor, bootloader or OTA operation (REQ-SEC-93d5fc98)", async () => {
    const b = await bench();
    expect(spawnSync(python, ["-I", script, "--version"], { encoding: "utf8" }).stdout.trim()).toBe(
      "arduino-tool 1.0.0",
    );
    const help = spawnSync(python, ["-I", script, "--help"], { encoding: "utf8" }).stdout;
    for (const operation of [
      "inspect",
      "boards",
      "cores",
      "libraries",
      "install",
      "compile",
      "upload",
      "report",
      "clean",
    ])
      expect(help).toContain(operation);
    for (const absent of ["daemon", "monitor", "burn", "bootloader", "fuse", "ota", "network"])
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

  it("installs exactly the named versions, without post-install scripts or library dependencies (REQ-FUNC-9fceeea6)", async () => {
    const deps = [
      { name: "Servo", version_required: "1.2.2", version_installed: "1.2.2" },
      { name: "Helper", version_required: "1.0.0" },
    ];
    const b = await bench({ deps });
    const early = b.run(["install", "core", "arduino:avr@1.8.8"]);
    expect(early.code).toBe(2);
    expect(codes(early.doc)).toEqual(["index-missing"]);
    for (const args of [
      ["install", "core", "arduino:avr"],
      ["install", "core", "arduino:avr@latest"],
      ["install", "library", "Servo@latest"],
      ["install", "library", "Servo"],
      ["install", "index", "--index-url", "http://example.com/package_x_index.json"],
      ["install", "index", "--index-url", "https://user:pw@example.com/i.json"],
    ]) {
      const refused = b.run(args);
      expect(refused.code, args.join(" ")).toBe(2);
    }
    expect(await b.calls()).toEqual([]);
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
    await b.write({ cores: { "arduino:avr": "1.8.6" }, deps });
    const core_ = b.run(["install", "core", "arduino:avr@1.8.8"]);
    expect(core_.code).toBe(0);
    expect(core_.doc.platform).toEqual({ id: "arduino:avr", version: "1.8.8", replaced: "1.8.6" });
    const library = b.run(["install", "library", "Servo@1.2.2"]);
    expect(library.code).toBe(0);
    expect(library.doc.warnings.map((warning) => warning.code)).toEqual(["dependency-missing"]);
    const installs = (await b.calls())
      .filter((call) => call.argv.includes("install"))
      .map((call) => call.argv);
    expect(installs).toContainEqual(["core", "install", "arduino:avr@1.8.8", "--skip-post-install"]);
    expect(installs).toContainEqual(["lib", "install", "Servo@1.2.2", "--no-deps"]);
    for (const call of await b.calls())
      if (call.argv.includes("update-index"))
        expect(call.config).toContain('"https://espressif.github.io/arduino-esp32/package_esp32_index.json"');
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
      { path: "sketch.yaml", keys: ["default_fqbn", "default_port", "default_profile", "profiles"] },
    ]);
    expect(result.doc.warnings.map((warning) => warning.code)).toEqual(["sketch-yaml-ignored"]);
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
        args[0] === "compile" ? "fqbn-invalid" : "version-required",
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

  it("refuses a core with local overrides and records the hooks of a build (REQ-SEC-8faa1e1d)", async () => {
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
    const refused = b.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:uno"]);
    expect(refused.code).toBe(2);
    expect(codes(refused.doc)).toEqual(["local-override"]);
    expect(commands(await b.calls())).not.toContain("compile --fqbn");
    expect(
      b.run([
        "compile",
        "--sketch",
        "sketches/VeraBlink",
        "--fqbn",
        "arduino:avr:uno",
        "--build-property",
        "x=y",
      ]).code,
    ).toBe(2);
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
    expect(saved.libraries).toEqual([
      { name: "SPI", version: "1.0", location: "platform", declared: true, platform: "arduino:avr@1.8.8" },
      {
        name: "VeraCounter",
        version: "1.0.0",
        location: "local",
        declared: true,
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
    expect(Object.keys(await tree(join(run, "libraries", "VeraCounter")))).toContain("src/VeraCounter.cpp");
    for (const name of ["result.json", "report.md", "compile.log"]) {
      const text = await readFile(join(run, name), "utf8");
      expect(text).not.toContain(b.root);
      expect(text).not.toContain(b.root.replaceAll("\\", "/"));
      expect(text).not.toContain(b.root.replaceAll("\\", "\\\\"));
    }
    expect(await readFile(join(run, "report.md"), "utf8")).toContain(
      "| VeraCounter | 1.0.0 | local | True |",
    );
    expect(await tree(join(b.work, "sketches"))).toEqual(before);
    expect(await readdir(join(b.home, "staging"))).toEqual([]);
    const call = (await b.calls()).find((entry) => entry.argv[0] === "compile") as Call;
    expect(call.argv).toContain("--build-path");
    expect(call.argv[call.argv.indexOf("--build-path") + 1]).toContain(join(b.home, "staging"));
    expect(call.argv.at(-1)).toBe(join(run, "sketch", "VeraLibrary"));
    const yaml = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--run-id",
      "blink",
    ]);
    expect(yaml.doc.warnings.map((warning) => warning.code)).toEqual(["sketch-yaml-ignored"]);
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

  it("fails a build that used an undeclared index library and warns of an ambiguous choice (REQ-SEC-37d5b2a2)", async () => {
    const servo = [{ name: "Servo", version: "1.2.2", location: "user" }];
    const b = await bench({ libraries: { Servo: "1.2.2" }, compile: { used_libraries: servo } });
    const undeclared = b.run(["compile", "--sketch", "sketches/VeraBlink", "--fqbn", "arduino:avr:uno"]);
    expect(undeclared.code).toBe(3);
    expect(undeclared.doc.status).toBe("fail");
    expect(undeclared.doc.errors).toContainEqual(
      expect.objectContaining({
        code: "undeclared-library",
        message: expect.stringContaining("Servo 1.2.2"),
      }),
    );
    const declared = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--library",
      "Servo@1.2.2",
    ]);
    expect(declared.code).toBe(0);
    await b.write({
      libraries: { Servo: "1.2.2" },
      compile: {
        used_libraries: servo,
        compiler_out: 'Multiple libraries were found for "Servo.h"\n Used: x\n',
      },
    });
    const ambiguous = b.run([
      "compile",
      "--sketch",
      "sketches/VeraBlink",
      "--fqbn",
      "arduino:avr:uno",
      "--library",
      "Servo@1.2.2",
    ]);
    expect(ambiguous.code).toBe(0);
    expect(ambiguous.doc.warnings.map((warning) => warning.code)).toContain("library-ambiguous");
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

  it("refuses a missing, changed, ambiguous or mismatched board identity before uploading (REQ-SEC-77af299d)", async () => {
    const b = await built({ ports: [UNO_PORT] });
    const absent = b.run(["upload", "--build", b.result, "--port", "COM9", "--identity", UNO_IDENTITY]);
    expect(absent.doc.errors[0]).toMatchObject({ code: "port-missing", now: ["COM5"] });
    expect(codes(b.run(upload(["--programmer", "usbtiny"])).doc)).toEqual(["programmer-unknown"]);
    const otherUno = port("COM5", { vid: "0x2341", pid: "0x0043", serialNumber: "OTHER" }, [
      { name: "Arduino UNO", fqbn: "arduino:avr:uno" },
    ]);
    const ours = port("COM8", { vid: "0x2341", pid: "0x0043", serialNumber: UNO_SERIAL }, [
      { name: "Arduino UNO", fqbn: "arduino:avr:uno" },
    ]);
    await b.write({ ports: [otherUno, ours] });
    const mismatch = b.run(upload());
    expect(mismatch.doc.errors[0]).toMatchObject({ code: "identity-mismatch", now: ["COM8"] });
    await b.write({ ports: [CH340("COM5"), CH340("COM6")] });
    const ambiguous = b.run([
      "upload",
      "--build",
      b.result,
      "--port",
      "COM5",
      "--identity",
      "usb:1a86:7523",
      "--board-unverified",
    ]);
    expect(codes(ambiguous.doc)).toEqual(["identity-ambiguous"]);
    await b.write({
      ports: [
        port("COM5", { vid: "0x2341", pid: "0x8036", serialNumber: UNO_SERIAL }, [
          { name: "Arduino Leonardo", fqbn: "arduino:avr:leonardo" },
        ]),
      ],
    });
    const leonardo = b.run([
      "upload",
      "--build",
      b.result,
      "--port",
      "COM5",
      "--identity",
      `usb:2341:8036:${UNO_SERIAL}`,
    ]);
    expect(codes(leonardo.doc)).toEqual(["board-mismatch"]);
    await b.write({ ports: [CH340("COM5")] });
    const unverified = b.run([
      "upload",
      "--build",
      b.result,
      "--port",
      "COM5",
      "--identity",
      "usb:1a86:7523",
    ]);
    expect(unverified.code).toBe(2);
    expect(codes(unverified.doc)).toEqual(["board-unverified"]);
    expect(commands(await b.calls()).filter((call) => call.startsWith("upload"))).toEqual([]);
    const accepted = b.run([
      "upload",
      "--build",
      b.result,
      "--port",
      "COM5",
      "--identity",
      "usb:1a86:7523",
      "--board-unverified",
    ]);
    expect(accepted.code, accepted.stdout).toBe(0);
    expect(accepted.doc.board).toEqual({ identified: false, names: [], bridge: "WCH CH340" });
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
        expect.objectContaining({ name: "SPI", location: "platform", declared: true }),
        expect.objectContaining({ name: "VeraCounter", version: "1.0.0", location: "local", declared: true }),
      ]);
      expect(await tree(join(r.work, "sketches"))).toEqual(before);
    },
    600_000,
  );

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
