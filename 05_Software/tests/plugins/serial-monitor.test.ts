// The serial-monitor plugin (plugins/serial-monitor) without a board: its installed script runs under the
// toolchain's Python with a fake pyserial (tests/fixtures/serial-monitor/fake-pyserial). The real Provisioner
// installs and resolves it through a fake uv that runs the script the way `uv run --script` does.
import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { ReplayGateway } from "@vera/core/replay";
import {
  classifyCommand,
  type PluginManifest,
  type SessionEvent,
  validatePluginManifest,
} from "@vera/shared";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = join(dirname(fileURLToPath(import.meta.url)), "../..");
const source = join(software, "plugins/serial-monitor");
const fixtures = join(software, "tests/fixtures/serial-monitor");
const fakePyserial = join(fixtures, "fake-pyserial");
const windows = process.platform === "win32";
/** The toolchain's Python (02_Tools requires 3.11+); VERA_TEST_PYTHON names another one. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys; print(sys.executable)"], { encoding: "utf8" });
  if (found.status !== 0) throw new Error(`These tests need Python 3.11 or newer as ${name}.`);
  return found.stdout.trim();
})();

interface Port {
  device: string;
  vid?: number;
  pid?: number;
  serial_number?: string;
  description?: string;
}
interface Scenario {
  ports?: Port[];
  open_error?: { errno?: number; message: string };
  chunks?: (string | { error: string } | { os_error: string } | { hex: string })[];
  /** A port without DTR and RTS, as a simulator's pseudo-terminal is. */
  no_lines?: boolean;
  /** What the device prints at each baud rate; "other" is every rate not named. */
  chunks_by_baud?: Record<string, Scenario["chunks"]>;
  /** What the device prints after it was written the key. */
  replies?: Record<string, string>;
}
const S3: Port = {
  device: "COM7",
  vid: 0x303a,
  pid: 0x1001,
  serial_number: "F4:12:FA:00:11:22",
  description: "USB JTAG/serial debug unit (COM7)",
};
const CP210X: Port = {
  device: "COM4",
  vid: 0x10c4,
  pid: 0xea60,
  serial_number: "0001",
  description: "Silicon Labs CP210x USB to UART Bridge (COM4)",
};
const UART: Port = { device: "COM1", description: "Communications Port (COM1)" };

let base: string;
let installed: string;
let script: string;
let manifest: PluginManifest;
let boot: string;
let bootChunks: string[];
const env = (dir: string) => ({
  PYTHONPATH: fakePyserial,
  FAKE_SERIAL_SCENARIO: join(dir, "scenario.json"),
  FAKE_SERIAL_RECORD: join(dir, "record.jsonl"),
  PYTHONDONTWRITEBYTECODE: "1",
});
async function scenarioDir(scenario: Scenario) {
  const dir = await mkdtemp(join(base, "run-"));
  await writeFile(join(dir, "scenario.json"), JSON.stringify(scenario));
  return dir;
}
async function records(dir: string): Promise<Record<string, unknown>[]> {
  const file = join(dir, "record.jsonl");
  if (!existsSync(file)) return [];
  return (await readFile(file, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
/** Runs the installed script directly, as `uv run --script` would, against the fake pyserial. */
async function serial(args: string[], scenario: Scenario = {}, harness?: string[]) {
  const dir = await scenarioDir(scenario);
  const started = Date.now();
  const result = spawnSync(python, harness ?? [script, ...args], {
    env: { ...process.env, ...env(dir), PYTHONUTF8: "1" },
    encoding: "utf8",
  });
  // Text streams end lines with CR LF on Windows; console bytes on stdout stay exactly as read.
  return {
    code: result.status,
    stdout: result.stdout,
    stderr: result.stderr.replaceAll("\r\n", "\n"),
    ms: Date.now() - started,
    records: await records(dir),
  };
}
/** A uv stand-in: `sync --script` succeeds and `run --quiet --offline --script <file> …` runs the file. */
async function fakeUv(dir: string) {
  const file = join(dir, "fake_uv.py");
  await writeFile(
    file,
    [
      "import json, os, runpy, sys",
      "sys.dont_write_bytecode = True",
      `with open(${JSON.stringify(join(dir, "uv.jsonl"))}, "a") as log: log.write(json.dumps(sys.argv[1:]) + "\\n")`,
      "args = sys.argv[1:]",
      'if args[:2] == ["sync", "--script"]: sys.exit(0)',
      'assert args[:4] == ["run", "--quiet", "--offline", "--script"], args',
      `os.environ.update(${JSON.stringify(env(dir))})`,
      `sys.path.insert(0, ${JSON.stringify(fakePyserial)})`,
      "sys.argv = args[4:]",
      'runpy.run_path(args[4], run_name="__main__")',
    ].join("\n"),
  );
  return file;
}
async function provisioner(store: core.PluginStore, dir: string) {
  const uv = await fakeUv(dir);
  return {
    uv,
    provisioner: new core.Provisioner({
      store,
      root: join(dir, "plugins", "runtime"),
      uv: { executable: python, prefix: [uv] },
      host: new core.NodeProcessHost(spawn),
      clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
      platform: core.pluginPlatform(process.platform, process.arch),
      // Local only: no test reaches the network.
      fetch: async () => new Response("offline", { status: 404 }),
      settings: () => undefined,
    }),
  };
}

beforeAll(async () => {
  base = await realpath(await mkdtemp(join(tmpdir(), "vera-serial-monitor-")));
  const store = new core.PluginStore({ root: join(base, "plugins") });
  await store.install(source);
  installed = join(base, "plugins", "installed", "serial-monitor");
  script = join(installed, "scripts", "serial_monitor.py");
  manifest = parse(await readFile(join(source, "plugin.yaml"), "utf8"));
  boot = (await readFile(join(fixtures, "esp32s3-boot.log"), "utf8")).replaceAll("\n", "\r\n");
  bootChunks = boot.match(/[\s\S]{1,64}/g) ?? [];
});
afterAll(async () => {
  await rm(base, { recursive: true, force: true });
});

describe("the plugin package", () => {
  it("installs without issues and resolves serial through uv run --script (REQ-FUNC-b7ceddbc)", async () => {
    expect(validatePluginManifest(manifest).issues).toEqual([]);
    const dir = await scenarioDir({});
    const store = new core.PluginStore({ root: join(dir, "plugins") });
    await store.install(source);
    expect((await store.list()).map((p) => [p.id, p.issues])).toEqual([["serial-monitor", []]]);
    const { uv, provisioner: provision } = await provisioner(store, dir);
    const plugin = await store.load("serial-monitor");
    expect(await provision.resolve(plugin, "serial")).toBeUndefined();
    expect(await provision.statuses("serial-monitor")).toMatchObject([{ name: "serial", state: "missing" }]);
    expect(await provision.install("serial-monitor")).toEqual([
      { name: "serial", kind: "script", state: "ready", version: manifest.version },
    ]);
    const file = join(dir, "plugins", "installed", "serial-monitor", "scripts", "serial_monitor.py");
    expect(await provision.resolve(await store.load("serial-monitor"), "serial")).toMatchObject({
      executable: python,
      prefix: [uv, "run", "--quiet", "--offline", "--script", file],
      version: manifest.version,
    });
    const calls = (await readFile(join(dir, "uv.jsonl"), "utf8"))
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(calls[0]).toEqual(["sync", "--script", file]);
  });
  it("prints the manifest version for the probe (REQ-FUNC-3e33dbe8)", async () => {
    const result = await serial(["--version"]);
    expect(result.code).toBe(0);
    expect(result.stdout.replaceAll("\r\n", "\n")).toBe(`serial-monitor ${manifest.version}\n`);
    const match = new RegExp(manifest.programs?.serial?.version.match ?? "^$").exec(result.stdout);
    expect(match?.[1]).toBe(manifest.version);
  });
});

describe("risk rules", () => {
  const classify = (...args: string[]) => classifyCommand(manifest.rules ?? [], "serial", args);
  it("lists and prints help as safe (REQ-SEC-79b6adad)", () => {
    for (const args of [["list"], ["list", "--verbose"], ["--version"], ["--help"], ["-h"]])
      expect(classify(...args).risk, args.join(" ")).toBe("safe");
    expect(classify("--version", "capture", "--port", "COM3").risk).toBe("device-write");
    // Asking a command for its options opens nothing.
    const help = manifest.programs.serial?.subcommandHelp;
    for (const command of ["list", "capture", "send"])
      expect(classifyCommand(manifest.rules ?? [], "serial", [command, "--help"], undefined, help).risk).toBe(
        "safe",
      );
    expect(
      classifyCommand(
        manifest.rules ?? [],
        "serial",
        ["capture", "--port", "COM3", "--help"],
        undefined,
        help,
      ).risk,
    ).toBe("device-read");
  });
  it("lets a foreground capture run an hour and keeps the default for a send", () => {
    expect(classify("capture", "--port", "COM7", "--duration", "1800").timeout).toBe(3600);
    expect(classify("send", "--port", "COM7", "--text", "help").timeout).toBeNull();
  });
  it("captures as device-read with the reset note (REQ-SEC-22dd5e18)", () => {
    for (const args of [
      ["capture", "--port", "COM7"],
      ["capture", "--port", "/dev/serial/by-id/usb-x", "--reset", "--until", "boot:"],
      ["CAPTURE", "--port", "COM7"],
    ]) {
      const result = classify(...args);
      expect(result.risk).toBe("device-read");
      expect(result.notes).toEqual([
        expect.stringMatching(/reads the console.*--reset.*restarts the board/i),
      ]);
    }
  });
  it("sends as device-write; other commands keep the default (REQ-SEC-5fd0ed52)", () => {
    expect(classify("send", "--port", "COM7", "--text", "reboot")).toMatchObject({
      risk: "device-write",
      notes: [expect.stringMatching(/firmware decides/i)],
    });
    expect(classify("flash", "--port", "COM7")).toMatchObject({ risk: "device-write", notes: [] });
  });
});

describe("list", () => {
  it("prints every port as JSON without opening one (REQ-FUNC-e80e3dd7)", async () => {
    const result = await serial(["list"], { ports: [S3, CP210X, UART] });
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual([
      {
        port: "COM1",
        vid_pid: null,
        serial_number: null,
        family: null,
        description: "Communications Port (COM1)",
        by_id: null,
      },
      {
        port: "COM4",
        vid_pid: "10C4:EA60",
        serial_number: "0001",
        family: "Silicon Labs CP210x",
        description: "Silicon Labs CP210x USB to UART Bridge (COM4)",
        by_id: null,
      },
      {
        port: "COM7",
        vid_pid: "303A:1001",
        serial_number: "F4:12:FA:00:11:22",
        family: "Espressif native USB",
        description: "USB JTAG/serial debug unit (COM7)",
        by_id: null,
      },
    ]);
    expect(result.records).toEqual([]);
    expect(JSON.parse((await serial(["list"])).stdout)).toEqual([]);
  });
  it("names the family from the USB IDs (REQ-FUNC-742426ac)", async () => {
    const ids: [number, number, string | null][] = [
      [0x303a, 0x1001, "Espressif native USB"],
      [0x303a, 0x0002, "Espressif native USB"],
      [0x10c4, 0xea60, "Silicon Labs CP210x"],
      [0x1a86, 0x7523, "WCH CH340"],
      [0x1a86, 0x55d3, "WCH CH343"],
      [0x1a86, 0x55d4, "WCH CH9102"],
      [0x0403, 0x6001, "FTDI FT232R"],
      [0x0403, 0x6010, "FTDI FT2232H (ESP-Prog)"],
      [0x0403, 0x6014, "FTDI FT232H"],
      [0x0403, 0x6015, "FTDI FT231X"],
      [0x10c4, 0xea70, "Silicon Labs CP2105"],
      // Boards and debug probes other than ESP32 ones.
      [0x2341, 0x0043, "Arduino"],
      [0x2e8a, 0x000a, "Raspberry Pi Pico"],
      [0x0483, 0x374b, "ST-Link V2-1 virtual COM port"],
      [0x0483, 0x374e, "ST-Link V3 virtual COM port"],
      [0x1366, 0x0105, "SEGGER J-Link virtual COM port"],
      [0x0d28, 0x0204, "CMSIS-DAP (DAPLink) virtual COM port"],
      [0x0483, 0x3748, null],
      [0x1234, 0x5678, null],
    ];
    const ports = ids.map(([vid, pid], i) => ({ device: `COM${10 + i}`, vid, pid }));
    const result = await serial(["list"], { ports: [...ports, { device: "COM99" }] });
    const families = Object.fromEntries(
      JSON.parse(result.stdout).map((p: { port: string; family: string | null }) => [p.port, p.family]),
    );
    expect(families).toEqual({
      ...Object.fromEntries(ids.map(([, , family], i) => [`COM${10 + i}`, family])),
      COM99: null,
    });
  });
  it("reports the /dev/serial/by-id link of a Linux port (REQ-PLAT-19d5189a)", async () => {
    const folder = await mkdtemp(join(base, "by-id-"));
    const links = {
      "usb-Espressif_USB_JTAG_serial_debug_unit_F412FA001122-if00": "/dev/ttyACM0",
      "usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0": "/dev/ttyUSB0",
    };
    for (const name of Object.keys(links)) await writeFile(join(folder, name), "");
    const ports = [
      { device: "/dev/ttyACM0", vid: 0x303a, pid: 0x1001 },
      { device: "/dev/ttyUSB0", vid: 0x10c4, pid: 0xea60 },
      { device: "/dev/ttyS0" },
    ];
    const harness = [join(fixtures, "by_id.py"), script, folder, JSON.stringify(links)];
    const result = await serial([], { ports }, harness);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).map((p: { by_id: string | null }) => p.by_id)).toEqual([
      `${folder}/usb-Espressif_USB_JTAG_serial_debug_unit_F412FA001122-if00`,
      null,
      `${folder}/usb-Silicon_Labs_CP2102_USB_to_UART_Bridge_Controller_0001-if00-port0`,
    ]);
  });
});

describe("list on Linux", () => {
  it("leaves out legacy ports the kernel lists without hardware behind them", async () => {
    const folder = await mkdtemp(join(base, "sys-tty-"));
    // /sys/class/tty/<name>/type: 0 is an unknown UART (nothing there), 4 a 16550A.
    for (const [name, type] of [
      ["ttyS0", "0"],
      ["ttyS1", "0"],
      ["ttyS4", "4"],
    ] as const) {
      await mkdir(join(folder, name));
      await writeFile(join(folder, name, "type"), `${type}\n`);
    }
    const ports = ["/dev/ttyS0", "/dev/ttyS1", "/dev/ttyS4", "/dev/ttyUSB0"].map((device) => ({ device }));
    const harness = [join(fixtures, "by_id.py"), script, folder, "{}"];
    const result = await serial([], { ports }, harness);
    expect(result.code).toBe(0);
    expect(JSON.parse(result.stdout).map((p: { port: string }) => p.port)).toEqual([
      "/dev/ttyS4",
      "/dev/ttyUSB0",
    ]);
  });
});

describe("capture", () => {
  const until = "main_task: Calling app_main";
  it("streams the console until a line matches (REQ-FUNC-42818bb7)", async () => {
    const result = await serial(["capture", "--port", "COM7", "--until", until], { chunks: bootChunks });
    let expected = "";
    for (const chunk of bootChunks) {
      if (expected.includes(until)) break;
      expected += chunk;
    }
    expect(expected.length).toBeLessThan(boot.length);
    expect(result.code).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe(
      `[serial-monitor] COM7: ${Buffer.byteLength(expected)} bytes, stopped by until\n`,
    );
    expect(result.records).toEqual([
      {
        op: "open",
        port: "COM7",
        baudrate: 115200,
        dtr: true,
        rts: false,
        exclusive: windows ? null : true,
      },
      { op: "dtr", value: false },
      { op: "close" },
    ]);
  });
  it("searches lines without their CR, so $ anchors work", async () => {
    const chunks = ["I (322) main_task: Calling app_main()\r\n", "Hello world!\r\n"];
    const result = await serial(["capture", "--port", "COM7", "--until", "app_main\\(\\)$"], { chunks });
    expect(result).toMatchObject({ code: 0, stdout: chunks[0] });
  });
  it("searches only the last 4096 characters of an unfinished line", async () => {
    const args = ["capture", "--port", "COM7", "--duration", "0.3", "--until", "Ax"];
    const result = await serial(args, { chunks: [`A${"x".repeat(5000)}`] });
    expect(result.code).toBe(4);
  });
  it("matches a line split across reads", async () => {
    const chunks = ["I (322) main_ta", "sk: Calling app_main()\r\n", "Hello world!\r\n"];
    const result = await serial(["capture", "--port", "COM7", "--until", until], { chunks });
    expect(result).toMatchObject({ code: 0, stdout: `${chunks[0]}${chunks[1]}` });
  });
  it("finishes the line an expression matched before it was complete", async () => {
    // The value arrives in two USB packets: the match is in the first, the address ends in the second.
    const chunks = ["I (2532) esp_netif: sta ip: 192.1", "68.1.57, mask: 255.255.255.0\r\n", "later\r\n"];
    const result = await serial(["capture", "--port", "COM7", "--until", "sta ip: \\d+"], { chunks });
    expect(result).toMatchObject({ code: 0, stdout: `${chunks[0]}${chunks[1]}` });
    expect(result.stderr).toContain("stopped by until");
  });
  it("returns a prompt that never ends its line once the port falls silent", async () => {
    const chunks = ["MicroPython v1.22 on ESP32\r\n", ">>> "];
    const result = await serial(["capture", "--port", "COM7", "--until", ">>> $", "--duration", "5"], {
      chunks,
    });
    expect(result).toMatchObject({ code: 0, stdout: chunks.join("") });
    expect(result.stderr).toContain("stopped by until");
    // Silence ends the wait long before the duration.
    expect(result.ms).toBeLessThan(4000);
    // A match the duration cuts short is still a match.
    const cut = await serial(["capture", "--port", "COM7", "--until", ">>> $", "--duration", "0.05"], {
      chunks,
    });
    expect(cut.code).toBe(0);
  });
  it("starts every line with the seconds since reading began", async () => {
    const chunks = ["boot\r\nwifi ", "up\r\n", "ready"];
    const result = await serial(["capture", "--port", "COM7", "--timestamps", "--duration", "0.3"], {
      chunks,
    });
    expect(result.code).toBe(0);
    expect(result.stdout).toMatch(
      /^\[ {4}\d\.\d{3}\] boot\r\n\[ {4}\d\.\d{3}\] wifi up\r\n\[ {4}\d\.\d{3}\] ready$/,
    );
    // The count is of the board's bytes, not of the stamps.
    expect(result.stderr).toContain("COM7: 20 bytes");
    const both = await serial(["capture", "--port", "COM7", "--timestamps", "--hex"]);
    expect(both.code).toBe(2);
    expect(both.records).toEqual([]);
  });
  it("prints binary data as a dump and ends a row when the data pauses", async () => {
    const bytes = Array.from({ length: 20 }, (_, index) => index + 0x30);
    const hex = (values: number[]) => values.map((value) => value.toString(16).padStart(2, "0")).join("");
    const result = await serial(["capture", "--port", "COM7", "--hex", "--duration", "0.4"], {
      chunks: [{ hex: hex(bytes) }, { hex: "010304002afffe9b80" }],
    });
    expect(result.code).toBe(0);
    expect(result.stdout.replaceAll("\r\n", "\n")).toBe(
      [
        "00000000  30 31 32 33 34 35 36 37 38 39 3a 3b 3c 3d 3e 3f  |0123456789:;<=>?|",
        "00000010  40 41 42 43 01 03 04 00 2a ff fe 9b 80           |@ABC....*....|",
        "",
      ].join("\n"),
    );
    expect(result.stderr).toContain("COM7: 29 bytes");
  });
  it("opens the port with the frame format that was asked for", async () => {
    const args = ["capture", "--port", "COM7", "--duration", "0.1"];
    const framed = await serial([
      ...args,
      "--bytesize",
      "7",
      "--parity",
      "e",
      "--stopbits",
      "2",
      "--baud",
      "9600",
    ]);
    expect(framed.records[0]).toMatchObject({ op: "open", baudrate: 9600, frame: "7E2" });
    expect((await serial(args)).records[0]).not.toHaveProperty("frame");
    for (const bad of [
      ["--bytesize", "9"],
      ["--parity", "X"],
      ["--stopbits", "3"],
    ]) {
      const result = await serial([...args, ...bad]);
      expect(result.code, bad.join(" ")).toBe(2);
      expect(result.records).toEqual([]);
    }
  });
  it("reads a simulator's terminal and socket, which have no reset lines", async () => {
    const chunks = ["ESP-ROM:esp32s3-20210327\r\n"];
    const terminal = await serial(["capture", "--port", "/dev/pts/3", "--duration", "0.2"], {
      chunks,
      no_lines: true,
    });
    expect(terminal).toMatchObject({ code: 0, stdout: chunks[0] });
    const refused = await serial(["capture", "--port", "/dev/pts/3", "--reset"], { chunks, no_lines: true });
    expect(refused.code).toBe(3);
    expect(refused.stdout).toBe("");
    expect(refused.stderr).toContain("--reset needs the DTR and RTS lines");
    expect(refused.records.at(-1)).toEqual({ op: "close" });
    const socket = await serial(["capture", "--port", "socket://127.0.0.1:5555", "--duration", "0.2"], {
      chunks,
    });
    expect(socket).toMatchObject({ code: 0, stdout: chunks[0] });
    // A network port is not locked like a device file.
    expect(socket.records[0]).toMatchObject({ op: "open", port: "socket://127.0.0.1:5555", exclusive: null });
    expect((await serial(["capture", "--port", "socket://127.0.0.1:5555", "--reset"], { chunks })).code).toBe(
      3,
    );
    const closed = await serial(["capture", "--port", "socket://127.0.0.1:9"], {
      open_error: { errno: 111, message: "Could not open port socket://127.0.0.1:9: Connection refused" },
    });
    expect(closed.code).toBe(3);
    expect(closed.stderr).toContain("Start the simulator or the serial server first");
  });
  it("finds the baud rate at which the board prints text", async () => {
    const garbage = { hex: "ff80fee0c3f89e00ff80fe1cf8e0ff80fee0c3f89e00ff80" };
    const text = [
      "ets Jan  8 2013,rst cause:2, boot mode:(3,6)\r\n",
      "load 0x4010f000, len 3460, room 16\r\n",
    ];
    const args = ["capture", "--port", "COM7", "--baud", "auto", "--duration", "0.2"];
    const found = await serial(args, { chunks_by_baud: { "74880": text, other: [garbage] } });
    expect(found.code).toBe(0);
    expect(found.stdout).toBe(text.join(""));
    expect(found.stderr).toContain("[serial-monitor] baud rate 74880 detected (100% readable text)");
    // The usual rates are tried in order, and the port keeps the one that read as text.
    const rates = found.records.filter((r) => r.op === "baudrate").map((r) => r.value);
    expect(rates.slice(0, 4)).toEqual([115200, 9600, 57600, 74880]);
    expect(rates.at(-1)).toBe(74880);
    // The port is opened once: no extra reset of the board between rates.
    expect(found.records.filter((r) => r.op === "open")).toHaveLength(1);
    const binary = await serial(args, { chunks_by_baud: { other: [garbage] } });
    expect(binary.code).toBe(0);
    expect(binary.stderr).toContain("the data may be binary: look at it with --hex");
    const silent = await serial(args, {});
    expect(silent.code).toBe(3);
    expect(silent.stdout).toBe("");
    expect(silent.stderr).toContain("No bytes arrived at any baud rate");
    expect(silent.records.at(-1)).toEqual({ op: "close" });
    // A send speaks first, so its rate cannot be listened for.
    const send = await serial(["send", "--port", "COM7", "--baud", "auto", "--text", "x"]);
    expect(send.code).toBe(2);
  }, 60_000);
  it("stops at the byte limit and after the duration", async () => {
    const limited = await serial(["capture", "--port", "COM7", "--max-bytes", "10"], { chunks: bootChunks });
    expect(limited).toMatchObject({
      code: 0,
      stdout: boot.slice(0, 10),
      stderr: "[serial-monitor] COM7: 10 bytes, stopped by max-bytes\n",
    });
    const split = await serial(["capture", "--port", "COM7", "--max-bytes", "3"], {
      chunks: ["\u00e9\u00e9"],
    });
    expect(split).toMatchObject({ code: 0, stdout: "\u00e9\ufffd" });
    const silent = await serial(["capture", "--port", "COM7", "--duration", "0.3"]);
    expect(silent).toMatchObject({
      code: 0,
      stdout: "",
      stderr: "[serial-monitor] COM7: 0 bytes, stopped by duration\n",
    });
    expect(silent.ms).toBeGreaterThanOrEqual(300);
  });
  it("exits 4 when the until expression never matched (REQ-REL-46027e04)", async () => {
    const args = ["capture", "--port", "COM7", "--duration", "0.3"];
    const missed = await serial([...args, "--until", "Guru Meditation"], { chunks: bootChunks });
    expect(missed).toMatchObject({
      code: 4,
      stdout: boot,
      stderr: `[serial-monitor] COM7: ${Buffer.byteLength(boot)} bytes, stopped by duration\n`,
    });
    expect((await serial(args, { chunks: bootChunks })).code).toBe(0);
  });
  it("restarts the board through RTS with DTR released before reading (REQ-FUNC-3ee59f30)", async () => {
    const result = await serial(["capture", "--port", "COM7", "--reset", "--until", until], {
      chunks: bootChunks,
    });
    expect(result.code).toBe(0);
    expect(result.records).toEqual([
      expect.objectContaining({ op: "open", dtr: true, rts: false }),
      { op: "dtr", value: false },
      { op: "dtr", value: false },
      { op: "rts", value: true },
      { op: "dtr", value: false },
      { op: "reset_input_buffer" },
      { op: "rts", value: false },
      { op: "dtr", value: false },
      { op: "close" },
    ]);
  });
});

describe("send", () => {
  it("writes one line with CR LF and reads the reply (REQ-FUNC-6f7569e2)", async () => {
    const chunks = ["help\r\n", "Commands: help, version, reboot\r\n"];
    const result = await serial(["send", "--port", "COM7", "--text", "help", "--until", "Commands"], {
      chunks,
    });
    expect(result).toMatchObject({
      code: 0,
      stdout: chunks.join(""),
      stderr: `[serial-monitor] COM7: ${chunks.join("").length} bytes, stopped by until\n`,
    });
    expect(result.records).toEqual([
      expect.objectContaining({ op: "open", dtr: true, rts: false }),
      { op: "dtr", value: false },
      { op: "write", data: "help\r\n" },
      { op: "close" },
    ]);
    const bare = await serial([
      "send",
      "--port",
      "COM7",
      "--text",
      "help",
      "--eol",
      "none",
      "--duration",
      "0.2",
    ]);
    expect(bare.records).toContainEqual({ op: "write", data: "help" });
  });
  it("writes bytes given in hexadecimal and prints the reply as a dump", async () => {
    const result = await serial(
      ["send", "--port", "COM7", "--hex", "01 03 00 00 0x00,0x0A c5:cd", "--duration", "0.3"],
      { chunks: [{ hex: "010304002afffe9b80" }] },
    );
    expect(result.code).toBe(0);
    // No line end is added to bytes.
    expect(result.records).toContainEqual({ op: "write", hex: "01030000000ac5cd" });
    expect(result.stdout.replaceAll("\r\n", "\n")).toBe(
      "00000000  01 03 04 00 2a ff fe 9b 80                       |....*....|\n",
    );
    for (const bad of [
      ["--hex", "0"],
      ["--hex", "zz"],
      ["--hex", ""],
      ["--hex", "01", "--text", "x"],
      ["--hex", "01", "--escape"],
    ]) {
      const refused = await serial(["send", "--port", "COM7", ...bad]);
      expect(refused.code, bad.join(" ")).toBe(2);
      expect(refused.records).toEqual([]);
    }
  });
  it("sends control characters written as escapes only when asked to", async () => {
    const args = [
      "send",
      "--port",
      "COM7",
      "--duration",
      "0.1",
      "--eol",
      "none",
      "--text",
      "\\x03\\r\\t\\\\n\\q",
    ];
    const escaped = await serial([...args, "--escape"]);
    // Ctrl-C, carriage return, tab, a backslash followed by n, and an unknown escape left as written.
    expect(escaped.records).toContainEqual({ op: "write", data: "\u0003\r\t\\n\\q" });
    const literal = await serial(args);
    expect(literal.records).toContainEqual({ op: "write", data: "\\x03\\r\\t\\\\n\\q" });
  });
  it("goes through the capture that holds the port when no port is named", async () => {
    const temp = await mkdtemp(join(base, "tmp-"));
    const dir = await scenarioDir({
      chunks: ["I (300) app: ready\r\n"],
      replies: { "help\r\n": "Commands: help, version\r\n" },
    });
    // Both runs see the same temporary directory, where a capture leaves its address.
    const shared = { ...process.env, ...env(dir), PYTHONUTF8: "1", TEMP: temp, TMP: temp, TMPDIR: temp };
    const run = (args: string[]) => spawnSync(python, [script, ...args], { env: shared, encoding: "utf8" });
    const nobody = run(["send", "--text", "help"]);
    expect(nobody.status).toBe(3);
    expect(nobody.stderr).toContain("No capture is running to send through.");

    const capture = spawn(
      python,
      [script, "capture", "--port", "COM7", "--until", "Commands", "--duration", "20"],
      {
        env: shared,
      },
    );
    let output = "";
    let notes = "";
    capture.stdout.on("data", (chunk: Buffer) => {
      output += chunk.toString();
    });
    capture.stderr.on("data", (chunk: Buffer) => {
      notes += chunk.toString();
    });
    const ended = new Promise<number | null>((done) => capture.on("close", done));
    try {
      await expect.poll(() => output, { timeout: 15_000 }).toContain("ready");
      const sent = run(["send", "--text", "help", "--until", "Commands", "--duration", "10"]);
      expect(sent.status).toBe(0);
      expect(sent.stdout).toBe("Commands: help, version\r\n");
      expect(sent.stderr.trim()).toBe(
        "[serial-monitor] COM7 through its running capture: 25 bytes, stopped by until",
      );
      expect(await ended).toBe(0);
    } finally {
      capture.kill();
    }
    // The capture wrote the line itself and its own output holds the whole console.
    expect(await records(dir)).toContainEqual({ op: "write", data: "help\r\n" });
    expect(output).toBe("I (300) app: ready\r\nCommands: help, version\r\n");
    expect(notes).toContain("[serial-monitor] sent 6 bytes: b'help\\r\\n'");
    // The capture ended: nothing is left to send through.
    expect(run(["send", "--text", "help"]).status).toBe(3);
    for (const bad of [
      ["send", "--port", "COM7", "--capture", "bench", "--text", "x"],
      ["capture", "--port", "COM7", "--name", "com5"],
      ["capture", "--port", "COM7", "--name", "Bench A"],
    ])
      expect(run(bad).status, bad.join(" ")).toBe(2);
  }, 60_000);
  it("reads the reply for one second by default", async () => {
    const result = await serial(["send", "--port", "COM7", "--text", "version"]);
    expect(result).toMatchObject({
      code: 0,
      stderr: "[serial-monitor] COM7: 0 bytes, stopped by duration\n",
    });
    expect(result.ms).toBeGreaterThanOrEqual(1000);
  });
});

describe("failures", () => {
  it("explains the serial group on permission denied (REQ-PLAT-4013192c)", async () => {
    const message = "could not open port /dev/ttyUSB0: [Errno 13] Permission denied: '/dev/ttyUSB0'";
    const result = await serial(["capture", "--port", "/dev/ttyUSB0"], {
      open_error: { errno: 13, message },
    });
    expect(result.code).toBe(3);
    expect(result.stderr).toContain("/dev/ttyUSB0");
    expect(result.stderr).toContain("Debian, Ubuntu, Fedora: sudo usermod -aG dialout $USER");
    expect(result.stderr).toContain("Arch: sudo usermod -aG uucp $USER");
    expect(result.stderr).toContain("log out and in again");
    expect(result.records).toEqual([]);
    const other = await serial(["capture", "--port", "/dev/ttyUSB0"], {
      open_error: { errno: 2, message: "could not open port /dev/ttyUSB0: No such file or directory" },
    });
    expect(other.code).toBe(3);
    expect(other.stderr).not.toContain("usermod");
    expect(other.stderr).toContain("This port does not exist. List the ports again with: serial list.");
  });
  it("reports other port failures with a hint and keeps what was read (REQ-REL-3c25e5c0)", async () => {
    const missing = await serial(["capture", "--port", "COM9"], {
      open_error: {
        message: "could not open port 'COM9': FileNotFoundError(2, 'The system cannot find the file')",
      },
    });
    expect(missing.code).toBe(3);
    expect(missing.stderr).toContain("could not open port 'COM9'");
    expect(missing.stderr).toContain("List the ports again with: serial list.");
    const unplugged = await serial(["capture", "--port", "COM7"], {
      chunks: ["first\r\n", "second\r\n", { error: "device disconnected" }],
    });
    expect(unplugged).toMatchObject({ code: 3, stdout: "first\r\nsecond\r\n" });
    expect(unplugged.stderr).toContain("device disconnected");
    // pyserial's in_waiting is a bare ioctl on Linux: an unplugged device raises OSError, not SerialException.
    const gone = await serial(["capture", "--port", "/dev/ttyACM0"], {
      chunks: ["first\r\n", { os_error: "Input/output error" }],
    });
    expect(gone).toMatchObject({ code: 3, stdout: "first\r\n" });
    expect(gone.stderr).toContain("Input/output error");
    expect(gone.stderr).toContain("List the ports again");
  });
  it("refuses invalid arguments before opening a port (REQ-FUNC-0a001d5d)", async () => {
    for (const args of [
      ["flash"],
      ["capture", "--port", "COM7", "--duration", "0"],
      ["capture", "--port", "COM7", "--duration", "nan"],
      ["capture", "--port", "COM7", "--duration", "604801"],
      ["capture", "--port", "COM7", "--until", "a".repeat(1025)],
      ["capture", "--port", "COM7", "--max-bytes", "-1"],
      ["capture", "--port", "COM7", "--baud", "0"],
      ["capture", "--port", "COM7", "--until", "("],
      ["capture", "--port", "COM7", "--res"],
      ["capture"],
      ["send", "--port", "COM7"],
    ]) {
      const result = await serial(args, { chunks: bootChunks });
      expect(result.code, args.join(" ")).toBe(2);
      expect(result.records, args.join(" ")).toEqual([]);
    }
  });
});

describe("in VERA", () => {
  it("refuses a run naming the port of a background capture (REQ-SEC-016c9aad)", async () => {
    const dir = await scenarioDir({});
    const workbench = join(dir, "bench");
    await mkdir(join(workbench, ".vera"), { recursive: true });
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
    });
    const request = (args: string[], background = false) => ({
      sessionId: "s1",
      workbench,
      executable: python,
      args: [script, ...args],
      env: env(dir),
      background,
    });
    const capture = await runner.start(request(["capture", "--port", "COM7", "--duration", "30"], true));
    try {
      await expect(runner.start(request(["send", "--port", "COM7", "--text", "x"]))).rejects.toMatchObject({
        code: "BUSY",
        params: { handle: capture.id, port: "COM7" },
      });
    } finally {
      await runner.stopAll();
    }
  });

  it("sends through a background capture, which VERA does not count as a second run on the port", async () => {
    const dir = await scenarioDir({
      chunks: ["I (300) app: ready\r\n"],
      replies: { "version\r\n": "fw 1.4.2\r\n" },
    });
    const workbench = join(dir, "bench");
    await mkdir(join(workbench, ".vera"), { recursive: true });
    const temp = await mkdtemp(join(base, "tmp-"));
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
    });
    const request = (args: string[], background = false) => ({
      sessionId: "s1",
      workbench,
      executable: python,
      args: [script, ...args],
      env: { ...env(dir), TEMP: temp, TMP: temp, TMPDIR: temp },
      background,
    });
    const capture = await runner.start(request(["capture", "--port", "COM7", "--duration", "30"], true));
    try {
      await expect.poll(() => capture.read(false).output, { timeout: 15_000 }).toContain("ready");
      const send = await runner.start(
        request(["send", "--text", "version", "--until", "fw", "--duration", "10"]),
      );
      const sent = await send.done;
      expect(sent.exitCode).toBe(0);
      expect(sent.output).toContain("fw 1.4.2");
      expect(sent.output).toContain("COM7 through its running capture");
      // The capture wrote the line; its own output keeps the whole console and what was sent.
      await expect.poll(() => capture.read(false).output, { timeout: 15_000 }).toContain("fw 1.4.2");
      expect(capture.read(false).output).toContain("[serial-monitor] sent 9 bytes");
      expect(await records(dir)).toContainEqual({ op: "write", data: "version\r\n" });
      // Naming the port is still a second run on it.
      await expect(runner.start(request(["send", "--port", "COM7", "--text", "x"]))).rejects.toMatchObject({
        code: "BUSY",
      });
    } finally {
      await runner.stopAll();
    }
  }, 60_000);

  async function session(mode: "ask" | "read-only", enabled = true) {
    const dir = await scenarioDir({ ports: [S3, CP210X], chunks: bootChunks });
    const root = join(dir, "bench");
    await mkdir(join(root, ".vera"), { recursive: true });
    const store = new core.PluginStore({ root: join(dir, "plugins") });
    await store.install(source);
    const { provisioner: resolver } = await provisioner(store, dir);
    await resolver.install("serial-monitor");
    const runner = new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
    });
    const plugins = async () => (enabled ? [await store.load("serial-monitor")] : []);
    const programs: core.ProgramHost = {
      runner,
      clock: { sleep: (ms) => new Promise((done) => setTimeout(done, ms)) },
      plugins,
      resolver,
    };
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
    const run = (args: string[]) => ({
      toolCalls: [{ name: "run_program", args: { program: "serial", args } }],
    });
    const steps = [
      run(["list"]),
      run([
        "capture",
        "--port",
        "COM7",
        "--reset",
        "--until",
        "main_task: Calling app_main",
        "--duration",
        "10",
      ]),
      { text: "Done" },
    ];
    await writeFile(join(scripts, "boards.jsonl"), steps.map((s) => JSON.stringify(s)).join("\n"));
    const gateway = new ReplayGateway({ dir: scripts, now: () => Date.now() });
    await gateway.models("replay", new AbortController().signal);
    const service = new core.SessionService({
      root,
      db: handle.db,
      gateway,
      clock: { now: () => new Date(), sleep: async () => {} },
      model: () => "replay/boards",
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
    return { dir, service, created, events, programs, skills, close, handle };
  }
  const results = (events: SessionEvent[]) =>
    events.flatMap((e) => (e.type === "tool.done" ? [{ ok: e.ok, summary: e.summary }] : []));

  it("lists the boards without approval and captures after approval (REQ-TEST-4041b893)", async () => {
    const rig = await session("ask");
    try {
      rig.service.send(rig.created.id, "Identify the boards and capture the boot log");
      await expect
        .poll(() => rig.service.get(rig.created.id).snapshot.approvals.find((a) => !a.decision), {
          timeout: 15_000,
        })
        .toBeDefined();
      const pending = rig.service.get(rig.created.id).snapshot.approvals.find((a) => !a.decision);
      expect(pending?.program).toMatchObject({
        program: "serial",
        risk: "device-read",
        notes: [expect.stringMatching(/restarts the board/)],
      });
      const listed = JSON.parse(results(rig.events)[0]?.summary ?? "{}");
      expect(listed.risk).toBe("safe");
      expect(listed.output).toContain('"family": "Espressif native USB"');
      expect(listed.output).toContain('"family": "Silicon Labs CP210x"');
      rig.service.decideApproval({
        sessionId: rig.created.id,
        approvalId: pending?.approvalId as string,
        requestSha256: pending?.requestSha256 as string,
        decision: "approved",
      });
      expect(await rig.service.waitIdle(rig.created.id)).toEqual({ stopReason: "end" });
      const captured = results(rig.events)[1];
      expect(captured?.ok).toBe(true);
      expect(JSON.parse(captured?.summary ?? "{}")).toMatchObject({
        exitCode: 0,
        risk: "device-read",
        output: expect.stringContaining("I (322) main_task: Calling app_main()"),
      });
      expect(rig.handle.db.prepare("SELECT decided_by FROM approvals").all()).toEqual([
        { decided_by: "user" },
      ]);
      expect((await records(rig.dir)).map((r) => r.op)).toEqual([
        "open",
        "dtr",
        "dtr",
        "rts",
        "dtr",
        "reset_input_buffer",
        "rts",
        "dtr",
        "close",
      ]);
    } finally {
      await rig.close();
    }
  }, 30_000);
  it("refuses the capture in read-only without opening the port", async () => {
    const rig = await session("read-only");
    try {
      rig.service.send(rig.created.id, "Capture");
      await rig.service.waitIdle(rig.created.id);
      expect(results(rig.events)[1]).toMatchObject({
        ok: false,
        summary: expect.stringMatching(/device-read.*read-only/),
      });
      expect((await records(rig.dir)).map((r) => r.op)).toEqual([]);
    } finally {
      await rig.close();
    }
  }, 30_000);
  it("offers the plugin's skills and names them in the program entry (REQ-UX-7dc52524)", async () => {
    const rig = await session("ask");
    try {
      const skills = await rig.skills.list();
      const ours = skills.filter((s) => s.plugin === "serial-monitor");
      expect(ours.map((s) => [s.name, s.source, s.error])).toEqual([
        ["board-identify", "plugin", undefined],
        ["esp32-identify", "plugin", undefined],
        ["serial-console", "plugin", undefined],
      ]);
      expect(await core.programPromptEntries(rig.programs, skills)).toEqual([
        expect.objectContaining({
          name: "serial",
          plugin: "serial-monitor",
          version: manifest.version,
          skills: ["board-identify", "esp32-identify", "serial-console"],
        }),
      ]);
    } finally {
      await rig.close();
    }
    const disabled = await session("ask", false);
    try {
      expect((await disabled.skills.list()).filter((s) => s.plugin === "serial-monitor")).toEqual([]);
    } finally {
      await disabled.close();
    }
    const console = await readFile(join(source, "skills/serial-console/SKILL.md"), "utf8");
    const identify = await readFile(join(source, "skills/esp32-identify/SKILL.md"), "utf8");
    for (const text of ["serial list", "/dev/serial/by-id"]) {
      expect(console).toContain(text);
      expect(identify).toContain(text);
    }
    for (const id of ["303A", "10C4:EA60", "1A86:7523", "1A86:55D3", "1A86:55D4", "0403:6010"])
      expect(identify).toContain(id);
    expect(identify).toContain("esptool chip-id");
    const boards = await readFile(join(source, "skills/board-identify/SKILL.md"), "utf8");
    for (const word of ["serial list", "ST-Link", "Raspberry Pi Pico", "Arduino", "J-Link", "esp32-identify"])
      expect(boards).toContain(word);
    // The console skill says where a capture goes next: analysis of the run log and crash decoding.
    for (const word of [
      "parse_log",
      "esp32-panic",
      "crash-decode",
      "--timestamps",
      "--hex",
      "socket://",
      "--baud auto",
      "without `--port`",
    ])
      expect(console).toContain(word);
  }, 30_000);
});
