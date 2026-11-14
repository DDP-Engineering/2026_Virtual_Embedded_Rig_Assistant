// The bus-tools plugin without a bus adapter. Default tests check the package, the risk rules and bus-tool against a
// simulated Bus Pirate 5 in BPIO2 mode: a fake pyserial (tests/fixtures/bus-tools/fake-serial) parses the helper's
// COBS/FlatBuffers requests with the official flatbuffers runtime and answers for a simulated BME280, I2C EEPROM, SPI
// flash and UART peer - offline evidence only, never proof of a real adapter. The runner block uses the real
// ProgramRunner, lease folder, Stop and cleanup run. VERA_TEST_BUS_PIRATE_PORT, VERA_TEST_BUS_PIRATE_TERMINAL and
// VERA_TEST_BUS_PIRATE_IDENTITY name a real adapter for the read-only hardware test.
// REQ-DATA-634d35da REQ-SEC-9350b6ae REQ-FUNC-4dadea40 REQ-FUNC-0163b91b REQ-SEC-1c72e308 REQ-FUNC-971cb423
// REQ-REL-793a44d8 REQ-REL-023c37ad REQ-FUNC-ebf73436 REQ-SEC-2ec2103d REQ-SEC-145e1953 REQ-FUNC-edb1741e
// REQ-REL-28754edd REQ-FUNC-e5a016ac REQ-SEC-b30461f8 REQ-SEC-a8f13a1a REQ-SEC-85225742 REQ-FUNC-1dcdbb05
// REQ-REL-077448a5 REQ-REL-87418271 REQ-REL-f430ec06 REQ-REL-737b96ec REQ-FUNC-3223c457 REQ-FUNC-d9a201a5
// REQ-REL-c63f36b2 REQ-REL-10ae6ea5 REQ-FUNC-cd3227bc REQ-SEC-e088558b REQ-SEC-d8671786 REQ-FUNC-e62ad15a
// REQ-SEC-f0aa9c76 REQ-FUNC-1f2ee7cc REQ-TEST-e0a0dfe1
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = fileURLToPath(new URL("../../", import.meta.url));
const pluginFolder = join(software, "plugins", "bus-tools");
const scripts = join(pluginFolder, "scripts");
const script = join(scripts, "bus_tool.py");
const fakeSerial = fileURLToPath(new URL("../fixtures/bus-tools/fake-serial/", import.meta.url));
const windows = process.platform === "win32";
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The toolchain's Python, which runs bus-tool against the fake pyserial; it needs flatbuffers 25.12.19. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(name, ["-c", "import sys, flatbuffers; print(sys.executable)"], {
    encoding: "utf8",
  });
  if (found.status !== 0)
    throw new Error(`These tests need Python 3.11+ with flatbuffers 25.12.19 as ${name}: ${found.stderr}`);
  return found.stdout.trim();
})();

const IDENTITY = "usb:1209:7331:BP5X0001";
const ADAPTER = {
  alias: "bp",
  kind: "bus-adapter",
  backend: "bus-pirate-bpio2",
  resource: "COM35",
  terminal: "COM34",
  identity: IDENTITY,
  power: { maxMv: 3300, maxMa: 100 },
};
// biome-ignore lint/suspicious/noExplicitAny: printed JSON documents and fixture data, checked field by field.
type Json = Record<string, any>;

let root = "";
const paths = () => ({
  registry: join(root, "lab", "resources.json"),
  bench: join(root, "bench.json"),
  state: join(root, "fake-state.json"),
  log: join(root, "fake-bus.log"),
});
const ports = () => [
  {
    device: "COM34",
    vid: 0x1209,
    pid: 0x7331,
    serial_number: "BP5X0001",
    role: "terminal",
    location: "1-4:x.0",
  },
  {
    device: "COM35",
    vid: 0x1209,
    pid: 0x7331,
    serial_number: "BP5X0001",
    role: "binary",
    location: "1-4:x.2",
  },
  { device: "COM9", vid: 0x10c4, pid: 0xea60, serial_number: "01", role: "other" },
];
const targets = () => ({
  i2c: {
    "0x76": { registers: { d0: "60", f3: "0c", fa: "655a" } },
    "0x50": { eeprom: true },
  },
  spi: { flash: { mode: [0, 0], commands: { "9f": "ef4018", "05": "00" } } },
  uart: { echo: true },
});
async function setBench(fields: Json = {}) {
  await writeFile(
    paths().bench,
    JSON.stringify({
      ports: fields.ports ?? ports(),
      adapter: { hardware: [5, 10], protocol: [2, 0], ...(fields.adapter ?? {}) },
      targets: fields.targets ?? targets(),
      faults: fields.faults ?? {},
    }),
  );
}
async function setRegistry(entry: Json = {}) {
  await writeFile(paths().registry, JSON.stringify({ format: 1, resources: [{ ...ADAPTER, ...entry }] }));
}
const i2cProfile = (fields: Json = {}): Json => ({
  format: 1,
  kind: "bus-tools-profile",
  name: "bench i2c",
  wiring: { commonGround: true, logicMv: 3300 },
  power: { source: "external" },
  bus: { mode: "i2c", speedHz: 100000, pullups: true },
  limits: { maxWriteBytes: 16, maxReadBytes: 32, timeoutMs: 1000 },
  devices: [
    {
      name: "bme280",
      address: "0x76",
      registers: [
        { name: "chip_id", write: "d0", read: 1, access: "read", expect: "60" },
        { name: "status", write: "f3", read: 1, access: "read-clears" },
        { name: "temp_raw", write: "fa", read: 8, access: "read" },
      ],
    },
    { name: "eeprom", address: "0x50", rawTransfer: true },
    {
      name: "ghost",
      address: "0x77",
      registers: [{ name: "chip_id", write: "d0", read: 1, access: "read" }],
    },
  ],
  ...fields,
});
const spiProfile = (cpol = 0, cpha = 0): Json => ({
  format: 1,
  kind: "bus-tools-profile",
  name: "bench spi",
  wiring: { commonGround: true, logicMv: 3300 },
  power: { source: "external" },
  bus: { mode: "spi", speedHz: 1000000, pullups: false, cpol, cpha, csIdle: "high", bitOrder: "msb" },
  limits: { maxWriteBytes: 8, maxReadBytes: 16, timeoutMs: 1000 },
  devices: [
    {
      name: "flash",
      rawTransfer: true,
      registers: [{ name: "jedec_id", write: "9f", read: 3, access: "read", expect: "ef4018" }],
    },
  ],
});
const uartProfile = (fields: Json = {}): Json => ({
  format: 1,
  kind: "bus-tools-profile",
  name: "bench uart",
  wiring: { commonGround: true, logicMv: 3300 },
  power: { source: "external" },
  bus: { mode: "uart", baud: 115200, dataBits: 8, parity: "none", stopBits: 1, pullups: false },
  limits: { maxWriteBytes: 16, maxReadBytes: 64, timeoutMs: 1000 },
  devices: [{ name: "console", rawTransfer: true }],
  ...fields,
});
async function profile(name: string, document: Json) {
  await writeFile(join(root, "bench", name), JSON.stringify(document));
  return `bench/${name}`;
}

function environment(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PYTHONPATH: fakeSerial,
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    BUS_REGISTRY: paths().registry,
    FAKE_BUS_BENCH: paths().bench,
    FAKE_BUS_STATE: paths().state,
    FAKE_BUS_LOG: paths().log,
    ...extra,
  };
}
interface Run {
  code: number | null;
  json: Json;
  stdout: string;
}
function bt(args: string[], extra: Record<string, string> = {}): Run {
  const { VERA_RUN_CONTROL: _a, VERA_RESOURCE_STATE: _b, VERA_REGISTRY_SHA256: _c, ...rest } = process.env;
  const result = spawnSync(python, [script, ...args], {
    cwd: root,
    env: { ...rest, ...environment(extra) },
    encoding: "utf8",
    timeout: 60_000,
  });
  let json: Json = {};
  try {
    json = JSON.parse(result.stdout ?? "{}");
  } catch {
    json = { unparsed: result.stdout, stderr: result.stderr };
  }
  return { code: result.status, json, stdout: result.stdout ?? "" };
}
const wire = (): Json[] =>
  existsSync(paths().log)
    ? readFileSync(paths().log, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line))
    : [];
const requests = (type?: string) =>
  wire().filter((entry) => entry.event === "request" && (type === undefined || entry.type === type));
const opened = () => wire().filter((entry) => entry.event === "open");
const fakeState = (): Json =>
  existsSync(paths().state) ? JSON.parse(readFileSync(paths().state, "utf8")) : { mode: "HiZ" };
const resultOf = (run: Run): Json => JSON.parse(readFileSync(join(root, run.json.resultPath), "utf8"));
const clearWire = () => rm(paths().log, { force: true });

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-bus-tools-")));
  await mkdir(join(root, "lab"));
  await mkdir(join(root, "bench"));
  await mkdir(join(root, ".vera"));
  await setRegistry();
  await setBench();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe("package", () => {
  it("publishes the official bus-tools package with one pinned helper, a supervised resource, skills, catalog and pack", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({ id: "bus-tools", version: "0.1.0", platforms: ["windows-x64", "linux-x64"] });
    expect(Object.keys(m.programs)).toEqual(["bus-tool"]);
    const program = m.programs["bus-tool"];
    expect(program?.install).toEqual({ script: "scripts/bus_tool.py" });
    expect(program?.resources).toEqual({
      option: "--adapter",
      kinds: ["bus-adapter"],
      grace: 5,
      cleanup: ["release"],
      cleanupTimeout: 30,
    });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest placeholder, compared literally.
    expect(program?.env).toEqual({ BUS_REGISTRY: "${workbench}/lab/resources.json" });
    expect(readFileSync(script, "utf8")).toContain(
      'dependencies = ["flatbuffers==25.12.19", "pyserial==3.5"]',
    );
    const catalog = parse(readFileSync(join(software, "plugins", "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("bus-tools");
    const packs = parse(readFileSync(join(software, "plugins", "packs.yaml"), "utf8"));
    const arduino = packs.find((pack: { id: string }) => pack.id === "arduino");
    expect(arduino.groups).toContainEqual({
      name: "Bus transactions (I2C, SPI, UART)",
      plugins: ["bus-tools"],
      default: true,
    });
    expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(pluginFolder);
    const installed = await store.load("bus-tools");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const names = (await skills.list())
      .filter((skill) => skill.plugin === "bus-tools")
      .map((skill) => skill.name);
    expect(names.sort()).toEqual(["bus-profiles", "bus-transactions"]);
    const transactions = (await skills.read("plugin", "bus-transactions")).content;
    for (const text of ["--clears", "--power", "sigrok", "nack", "unexpected-value", "BUSY", "release"])
      expect(transactions).toContain(text);
    const profiles = (await skills.read("plugin", "bus-profiles")).content;
    for (const text of ["commonGround", "read-clears", "rawTransfer", "no scan"])
      expect(profiles).toContain(text);
    for (const file of readdirSync(join(pluginFolder, "profiles"))) {
      await writeFile(join(root, "bench", file), readFileSync(join(pluginFolder, "profiles", file)));
      expect(bt(["capabilities", "--bus", `bench/${file}`]).code, file).toBe(0);
    }
  });

  it("classifies every operation at its highest effect and never calls a read safe", () => {
    const m = manifest();
    const risk = (line: string) => {
      const [program, ...args] = line.split(" ");
      return classifyCommand(m.rules ?? [], program as string, args).risk;
    };
    for (const line of [
      "bus-tool --version",
      "bus-tool devices",
      "bus-tool capabilities --bus p.json",
      "bus-tool report --run r",
    ])
      expect(risk(line)).toBe("safe");
    expect(risk("bus-tool identify --adapter bp")).toBe("device-read");
    for (const line of [
      "bus-tool configure-bus --adapter bp --bus p.json",
      "bus-tool read-register --adapter bp --bus p.json --device d --register r",
      "bus-tool read-register --adapter bp --bus p.json --device d --register r --clears",
      "bus-tool transfer --adapter bp --bus p.json --device d --write 00 --read 4",
      "bus-tool capture --adapter bp --bus p.json --duration 5",
      "bus-tool release --adapter bp",
    ])
      expect(risk(line), line).toBe("device-write");
    expect(risk("bus-tool read-register --adapter bp --bus p.json --device d --register r --power")).toBe(
      "irreversible",
    );
    expect(risk("bus-tool configure-bus --power --adapter bp --bus p.json")).toBe("irreversible");
    const notes = (m.rules ?? []).map((rule) => `${rule.match} ${rule.note ?? ""}`).join("\n");
    expect(notes).toMatch(/read-register.*writes the register address first and may clear flags/);
  });

  it("offers no terminal, scan or firmware operation and writes no forbidden BPIO2 field", () => {
    for (const args of [["terminal"], ["scan"], ["bootloader"], ["selftest"], ["script", "x"]]) {
      const run = bt(args);
      expect(run.code).toBe(2);
      expect(run.json).toMatchObject({ status: "blocked", errors: [{ code: "arguments" }] });
    }
    const source = readdirSync(join(scripts, "bus_support"))
      .filter((name) => name.endsWith(".py"))
      .map((name) => readFileSync(join(scripts, "bus_support", name), "utf8"))
      .join("\n");
    for (const field of [
      "hardware_bootloader",
      "hardware_reset",
      "hardware_selftest",
      "io_direction_mask",
      "io_value_mask",
      "print_string",
    ])
      expect(source).not.toContain(field);
    expect(bt(["--version"]).stdout.trim()).toBe("bus-tool 0.1.0");
  });

  it("carries workspace.py as a byte-identical copy of the shared path rules", async () => {
    const ours = await readFile(join(scripts, "bus_support", "workspace.py"));
    const theirs = await readFile(
      join(software, "plugins", "circuitpython", "scripts", "circuitpython_support", "workspace.py"),
    );
    expect(ours.equals(theirs)).toBe(true);
  });
});

describe("devices, identity and the backend", { timeout: 60_000 }, () => {
  it("lists ports by identity and groups the two ports of one adapter, without opening any", () => {
    const run = bt(["devices"]);
    expect(run.code).toBe(0);
    expect(run.json.ports.map((port: Json) => port.identity)).toEqual([
      IDENTITY,
      IDENTITY,
      "usb:10c4:ea60:01",
    ]);
    expect(run.json.ports[1]).toMatchObject({ address: "COM35", stable: true, location: "1-4:x.2" });
    expect(run.json.groups).toEqual([{ identity: IDENTITY.toLowerCase(), ports: ["COM34", "COM35"] }]);
    expect(run.stdout).not.toMatch(/Bus Pirate/);
    expect(opened()).toEqual([]);
  });

  it("identifies the adapter with one status request on the binary port only and records the run", () => {
    const run = bt(["identify", "--adapter", "bp", "--run-id", "id1"]);
    expect(run.code).toBe(0);
    expect(run.json).toMatchObject({
      format: 1,
      kind: "bus-tool-result",
      operation: "identify",
      status: "pass",
      adapter: {
        alias: "bp",
        hardware: "5 REV10",
        protocol: "2.0",
        firmware: "0.0",
        supported: true,
        mode: "HiZ",
      },
      lifecycle: { physical: "unchanged" },
    });
    expect(run.json.adapter.modes).toContain("I2C");
    expect(opened().map((entry) => entry.port)).toEqual(["COM35"]);
    expect(requests().map((entry) => entry.type)).toEqual(["status"]);
    expect(requests()[0]).toMatchObject({ versionMajor: 2, minimumMinor: 0 });
    expect(resultOf(run)).toMatchObject({ status: "pass", runId: "id1" });
    expect(readFileSync(join(root, "arduino-iot-results", "id1", "report.md"), "utf8")).toMatch(
      /Hardware 5 REV10/,
    );
    const again = bt(["identify", "--adapter", "bp", "--run-id", "id1"]);
    expect(again.code).toBe(2);
    expect(again.json.errors[0].code).toBe("run-exists");
  });

  it("refuses a port that does not answer BPIO2 after the one status request", async () => {
    for (const faults of [{ terminalText: true }, { silent: true }]) {
      await setBench({ faults });
      await clearWire();
      const run = bt(["identify", "--adapter", "bp"]);
      expect(run.code, JSON.stringify(faults)).toBe(2);
      expect(run.json.errors[0].code).toBe("not-bpio2");
      expect(requests().map((entry) => entry.type)).toEqual(["status"]);
    }
  });

  it("refuses an unsupported model or protocol and sends nothing else", async () => {
    for (const adapter of [{ hardware: [7, 1] }, { protocol: [3, 0] }] as Json[]) {
      await setBench({ adapter });
      await clearWire();
      const path = await profile("i2c.json", i2cProfile());
      const run = bt([
        "read-register",
        "--adapter",
        "bp",
        "--bus",
        path,
        "--device",
        "bme280",
        "--register",
        "chip_id",
      ]);
      expect(run.code).toBe(2);
      expect(run.json.errors[0].code).toBe("adapter-unsupported");
      expect(run.json.adapter.supported).toBe(false);
      expect(run.json.adapter.hardware).toBe(
        `${(adapter.hardware ?? [5, 10])[0]} REV${(adapter.hardware ?? [5, 10])[1]}`,
      );
      expect(run.json.adapter.protocol).toBe((adapter.protocol ?? [2, 0]).join("."));
      expect(requests().map((entry) => entry.type)).toEqual(["status"]);
    }
    await setBench({ faults: { packetError: "Version mismatch" } });
    expect(bt(["identify", "--adapter", "bp"]).json.errors[0].code).toBe("adapter-unsupported");
  });

  it("refuses missing ports, another identity and a changed registry before opening anything", async () => {
    await setBench({ ports: ports().filter((port) => port.device !== "COM34") });
    expect(bt(["identify", "--adapter", "bp"]).json.errors[0].code).toBe("port-missing");
    await setBench();
    await setRegistry({ identity: "usb:1209:7331:OTHER" });
    expect(bt(["identify", "--adapter", "bp"]).json.errors[0].code).toBe("identity-mismatch");
    await setRegistry();
    const changed = bt(["identify", "--adapter", "bp"], { VERA_REGISTRY_SHA256: "0".repeat(64) });
    expect(changed.json.errors[0].code).toBe("registry-changed");
    expect(bt(["identify", "--adapter", "nope"]).json.errors[0].code).toBe("adapter-unknown");
    expect(opened()).toEqual([]);
    const sha = createHash("sha256").update(readFileSync(paths().registry)).digest("hex");
    expect(bt(["identify", "--adapter", "bp"], { VERA_REGISTRY_SHA256: sha }).code).toBe(0);
  });

  it("reports the backend and a profile's devices without opening a port", async () => {
    const plain = bt(["capabilities"]);
    expect(plain.json.backend).toMatchObject({
      id: "bus-pirate-bpio2",
      hardwareMajors: [5, 6],
      protocolMajor: 2,
      modes: ["i2c", "spi", "uart"],
    });
    const path = await profile("i2c.json", i2cProfile());
    const described = bt(["capabilities", "--bus", path]);
    expect(described.json.profile.devices[0]).toMatchObject({ name: "bme280", address: "0x76" });
    expect(described.json.profile.limits).toEqual({ maxWriteBytes: 16, maxReadBytes: 32, timeoutMs: 1000 });
    const bad = await profile("bad.json", i2cProfile({ wiring: { commonGround: false, logicMv: 3300 } }));
    expect(bt(["capabilities", "--bus", bad]).json.errors[0].code).toBe("profile-invalid");
    expect(opened()).toEqual([]);
  });
});

describe("profiles and requests refused before the adapter", { timeout: 60_000 }, () => {
  it("refuses an invalid profile", async () => {
    const base = i2cProfile();
    const cases: Json[] = [
      { ...base, wiring: { commonGround: false, logicMv: 3300 } },
      { ...base, wiring: { commonGround: true, logicMv: 900 } },
      { ...base, bus: { mode: "i2c", speedHz: 2_000_000, pullups: true } },
      { ...base, devices: [{ name: "x", address: "0x78" }] },
      {
        ...base,
        devices: [
          {
            name: "x",
            address: "0x50",
            registers: [{ name: "r", write: "0102030405", read: 1, access: "read" }],
          },
        ],
      },
      { ...base, limits: { maxWriteBytes: 16, maxReadBytes: 4096, timeoutMs: 1000 } },
      { ...base, extra: true },
      { ...base, format: 2 },
    ];
    for (const [index, document] of cases.entries()) {
      const path = await profile(`bad${index}.json`, document);
      const run = bt(["configure-bus", "--adapter", "bp", "--bus", path]);
      expect(run.code, JSON.stringify(document).slice(0, 200)).toBe(2);
      expect(run.json.errors[0].code).toBe("profile-invalid");
    }
    expect(opened()).toEqual([]);
  });

  it("reads only declared registers and clearing registers on purpose", async () => {
    const path = await profile("i2c.json", i2cProfile());
    const read = (...rest: string[]) => bt(["read-register", "--adapter", "bp", "--bus", path, ...rest]);
    expect(read("--device", "bme280", "--register", "humidity_raw").code).toBe(2);
    expect(read("--device", "bme280", "--register", "humidity_raw").json.errors[0].code).toBe(
      "register-unknown",
    );
    expect(read("--device", "other", "--register", "chip_id").json.errors[0].code).toBe("register-unknown");
    expect(read("--device", "bme280", "--register", "status").json.errors[0].code).toBe("clears-flags");
    expect(opened()).toEqual([]);
    const cleared = read("--device", "bme280", "--register", "status", "--clears");
    expect(cleared.code).toBe(0);
    expect(cleared.json.register).toMatchObject({ name: "status", value: "0c" });
  });

  it("transfers only to devices that allow it and within the profile's and the adapter's limits", async () => {
    const path = await profile("i2c.json", i2cProfile());
    const transfer = (...rest: string[]) => bt(["transfer", "--adapter", "bp", "--bus", path, ...rest]);
    expect(transfer("--device", "bme280", "--read", "1").json.errors[0].code).toBe("transfer-not-allowed");
    expect(transfer("--device", "eeprom", "--read", "64").json.errors[0].code).toBe("limit");
    expect(transfer("--device", "eeprom", "--write", "0x10").json.errors[0].code).toBe("arguments");
    expect(transfer("--device", "eeprom").json.errors[0].code).toBe("arguments");
    expect(opened()).toEqual([]);
    await setBench({ adapter: { maxRead: 8 } });
    const small = transfer("--device", "eeprom", "--write", "00", "--read", "16");
    expect(small.code).toBe(2);
    expect(small.json.errors[0].code).toBe("limit");
    expect(requests("data")).toEqual([]);
    expect(small.json.final).toMatchObject({ declared: "release", physical: "confirmed" });
  });

  it("switches the adapter's supply on only when declared, named and within the bench limits", async () => {
    const powered = await profile("p.json", i2cProfile({ power: { source: "adapter", mv: 3300, ma: 50 } }));
    const configure = (path: string, ...rest: string[]) =>
      bt(["configure-bus", "--adapter", "bp", "--bus", path, ...rest]);
    expect(configure(powered).json.errors[0].code).toBe("power-not-allowed");
    await setRegistry({ power: undefined });
    expect(configure(powered, "--power").json.errors[0].code).toBe("power-not-allowed");
    await setRegistry({ power: { maxMv: 1800, maxMa: 100 } });
    expect(configure(powered, "--power").json.errors[0].code).toBe("power-not-allowed");
    const external = await profile("e.json", i2cProfile());
    expect(configure(external, "--power").json.errors[0].code).toBe("power-not-allowed");
    expect(opened()).toEqual([]);
    await setRegistry();
    const on = configure(powered, "--power");
    expect(on.code).toBe(0);
    expect(fakeState()).toMatchObject({ psu: true, psuMv: 3300, psuMa: 50 });
    expect(requests("configuration")[0]).toMatchObject({ psuEnable: true, psuSetMv: 3300, psuSetMa: 50 });
    await clearWire();
    expect(configure(external).code).toBe(0);
    expect(requests("configuration").every((entry) => entry.psuDisable && !entry.psuEnable)).toBe(true);
  });

  it("refuses bus operations while VERA records the adapter's state unknown", async () => {
    const path = await profile("i2c.json", i2cProfile());
    const unknown = JSON.stringify({
      bp: { state: "unknown", since: "2026-11-14T10:00:00Z", runId: "R1", reason: "holder-lost" },
    });
    const run = bt(
      ["read-register", "--adapter", "bp", "--bus", path, "--device", "bme280", "--register", "chip_id"],
      {
        VERA_RESOURCE_STATE: unknown,
      },
    );
    expect(run.code).toBe(2);
    expect(run.json.errors[0].code).toBe("state-unknown");
    expect(opened()).toEqual([]);
    expect(bt(["release", "--adapter", "bp"], { VERA_RESOURCE_STATE: unknown }).code).toBe(0);
  });
});

// Each case spawns several Python processes, some waiting out a reply timeout.
describe("transactions against the simulated adapter", { timeout: 60_000 }, () => {
  it("configures the bus, reads it back and leaves it configured", async () => {
    const path = await profile("i2c.json", i2cProfile());
    const run = bt(["configure-bus", "--adapter", "bp", "--bus", path]);
    expect(run.code).toBe(0);
    expect(run.json.configuration.readBack).toEqual({ mode: "I2C", pullups: true, psu: false });
    expect(run.json.final).toMatchObject({ declared: "configured", physical: "confirmed" });
    expect(fakeState()).toMatchObject({ mode: "I2C", pullups: true });
    expect(requests("configuration")[0]).toMatchObject({
      mode: "I2C",
      pullupEnable: true,
      modeConfiguration: { speed: 100000 },
    });
  });

  it("fails a configuration the adapter refuses or does not apply, with no data request and the final state", async () => {
    const path = await profile("i2c.json", i2cProfile());
    for (const [faults, code] of [
      [{ configError: "Invalid speed" }, "config-error"],
      [{ ignorePullups: true }, "config-mismatch"],
    ] as const) {
      await setBench({ faults });
      await clearWire();
      const run = bt([
        "read-register",
        "--adapter",
        "bp",
        "--bus",
        path,
        "--device",
        "bme280",
        "--register",
        "chip_id",
      ]);
      expect(run.code).toBe(1);
      expect(run.json.errors[0].code).toBe(code);
      expect(requests("data")).toEqual([]);
      expect(run.json.final).toMatchObject({ declared: "release", physical: "confirmed" });
    }
  });

  it("reads a declared I2C and SPI register in one transaction and releases the bus", async () => {
    const i2c = await profile("i2c.json", i2cProfile());
    const run = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      i2c,
      "--device",
      "bme280",
      "--register",
      "chip_id",
    ]);
    expect(run.code).toBe(0);
    expect(run.json.register).toEqual({
      device: "bme280",
      name: "chip_id",
      value: "60",
      expected: "60",
      matches: true,
    });
    expect(requests("data")).toHaveLength(1);
    expect(requests("data")[0]).toMatchObject({ startMain: true, write: "ecd0", read: 1, stopMain: true });
    expect(run.json.final).toEqual({
      declared: "release",
      state: { mode: "HiZ", pullups: false, psu: false },
      physical: "confirmed",
    });
    expect(fakeState()).toMatchObject({ mode: "HiZ", pullups: false, psu: false });
    await clearWire();
    const spi = await profile("spi.json", spiProfile());
    const flash = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      spi,
      "--device",
      "flash",
      "--register",
      "jedec_id",
    ]);
    expect(flash.code).toBe(0);
    expect(flash.json.register.value).toBe("ef4018");
    expect(requests("configuration")[0]).toMatchObject({
      mode: "SPI",
      bitorderMsb: true,
      modeConfiguration: { clockPolarity: false, clockPhase: false, chipSelectIdle: true },
    });
    expect(requests("data")).toEqual([
      expect.objectContaining({ startMain: true, write: "9f", read: 3, stopMain: true }),
    ]);
  });

  it("keeps the configured bus when the profile declares keep, and reports unknown when the release is not applied", async () => {
    const keep = await profile("keep.json", i2cProfile({ final: "keep" }));
    const run = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      keep,
      "--device",
      "bme280",
      "--register",
      "chip_id",
    ]);
    expect(run.json.final).toMatchObject({ declared: "keep", physical: "confirmed", state: { mode: "I2C" } });
    expect(fakeState().mode).toBe("I2C");
    const powered = await profile("p.json", i2cProfile({ power: { source: "adapter", mv: 3300, ma: 50 } }));
    await setBench({ faults: { keepPsu: true } });
    const stuck = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      powered,
      "--device",
      "bme280",
      "--register",
      "chip_id",
      "--power",
    ]);
    expect(stuck.json.final).toMatchObject({
      declared: "release",
      physical: "unknown",
      state: { psu: true },
    });
    expect(stuck.json.lifecycle.physical).toBe("unknown");
  });

  it("runs one bounded transfer on I2C, and one UART exchange", async () => {
    const i2c = await profile("i2c.json", i2cProfile());
    const write = bt([
      "transfer",
      "--adapter",
      "bp",
      "--bus",
      i2c,
      "--device",
      "eeprom",
      "--write",
      "10a1b2c3",
    ]);
    expect(write.code).toBe(0);
    const read = bt([
      "transfer",
      "--adapter",
      "bp",
      "--bus",
      i2c,
      "--device",
      "eeprom",
      "--write",
      "10",
      "--read",
      "3",
    ]);
    expect(read.json.transactions[0]).toMatchObject({
      device: "eeprom",
      write: "a010",
      readRequested: 3,
      read: "a1b2c3",
    });
    expect(requests("data").map((entry) => entry.write)).toEqual(["a010a1b2c3", "a010"]);
    const uart = await profile("uart.json", uartProfile());
    await clearWire();
    const echo = bt([
      "transfer",
      "--adapter",
      "bp",
      "--bus",
      uart,
      "--device",
      "console",
      "--write",
      "6869",
      "--read",
      "2",
    ]);
    expect(echo.code).toBe(0);
    expect(echo.json.transactions[0].read).toBe("6869");
    expect(requests("data")[0]).toMatchObject({ startMain: false, stopMain: false });
    expect(requests("configuration")[0]).toMatchObject({
      mode: "UART",
      modeConfiguration: { speed: 115200, dataBits: 8, stopBits: 1, parity: false },
    });
    const spi = await profile("spi.json", spiProfile());
    await clearWire();
    const status = bt([
      "transfer",
      "--adapter",
      "bp",
      "--bus",
      spi,
      "--device",
      "flash",
      "--write",
      "05",
      "--read",
      "1",
    ]);
    expect(status.code).toBe(0);
    expect(status.json.transactions[0]).toMatchObject({
      device: "flash",
      write: "05",
      readRequested: 1,
      read: "00",
    });
    expect(requests("data")).toEqual([
      expect.objectContaining({ startMain: true, write: "05", read: 1, stopMain: true }),
    ]);
  });

  it("reports a NACK, a missing answer and a short read after a single attempt", async () => {
    const path = await profile("i2c.json", i2cProfile());
    const nack = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      path,
      "--device",
      "ghost",
      "--register",
      "chip_id",
    ]);
    expect(nack.code).toBe(1);
    expect(nack.json.errors[0].code).toBe("nack");
    expect(requests("data")).toHaveLength(1);
    expect(nack.json.final.physical).toBe("confirmed");

    await setBench({ faults: { dropData: true } });
    await clearWire();
    const silent = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      path,
      "--device",
      "bme280",
      "--register",
      "chip_id",
    ]);
    expect(silent.code).toBe(3);
    expect(silent.json.errors[0].code).toBe("no-response");
    expect(requests("data")).toHaveLength(1);
    expect(silent.json.final.physical).toBe("confirmed");

    await setBench({ faults: { dropData: true, silentRelease: true } });
    const lost = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      path,
      "--device",
      "bme280",
      "--register",
      "chip_id",
    ]);
    expect(lost.json.final.physical).toBe("unknown");
    expect(lost.json.lifecycle.physical).toBe("unknown");

    await setBench({ faults: { shortRead: 2 } });
    await clearWire();
    const short = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      path,
      "--device",
      "bme280",
      "--register",
      "temp_raw",
    ]);
    expect(short.code).toBe(1);
    expect(short.json).toMatchObject({ errors: [{ code: "count-mismatch" }], requested: 8, received: 2 });
    expect(requests("data")).toHaveLength(1);
  });

  it("names the SPI mode when a register differs from its expected value", async () => {
    const path = await profile("spi3.json", spiProfile(1, 1));
    const run = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      path,
      "--device",
      "flash",
      "--register",
      "jedec_id",
    ]);
    expect(run.code).toBe(1);
    expect(run.json.errors[0].code).toBe("unexpected-value");
    expect(run.json.errors[0].message).toMatch(/ef4018.*SPI mode/);
    expect(run.json.register).toMatchObject({ expected: "ef4018", matches: false });
    expect(requests("data")).toHaveLength(1);
  });

  it("captures a UART for a bounded time and points I2C capture to sigrok", async () => {
    await setBench({ faults: { stream: ["626f6f74", "0d0a6f6b"] } });
    const uart = await profile("uart.json", uartProfile());
    const run = bt([
      "capture",
      "--adapter",
      "bp",
      "--bus",
      uart,
      "--duration",
      "1",
      "--write",
      "0d",
      "--run-id",
      "cap",
    ]);
    expect(run.code).toBe(0);
    expect(run.json.capture).toMatchObject({ bytes: 8, chunks: 2 });
    expect(readFileSync(join(root, "arduino-iot-results", "cap", "capture.bin")).toString("hex")).toBe(
      "626f6f740d0a6f6b",
    );
    const csv = readFileSync(join(root, "arduino-iot-results", "cap", "capture.csv"), "utf8")
      .trim()
      .split("\n");
    expect(csv[0]).toBe("offsetMs,hex");
    expect(csv).toHaveLength(3);
    expect(run.json.capture.durationS).toBe(1);
    const i2c = await profile("i2c.json", i2cProfile());
    await clearWire();
    const refused = bt(["capture", "--adapter", "bp", "--bus", i2c, "--duration", "1"]);
    expect(opened()).toEqual([]);
    expect(refused.code).toBe(2);
    expect(refused.json.errors[0]).toMatchObject({ code: "capture-mode" });
    expect(refused.json.errors[0].message).toMatch(/sigrok/);
  });

  it("reports a lost adapter as disconnected and sends nothing more", async () => {
    await setBench({ faults: { unplugAfterConfig: true } });
    const path = await profile("i2c.json", i2cProfile());
    const run = bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      path,
      "--device",
      "bme280",
      "--register",
      "chip_id",
    ]);
    expect(run.code).toBe(3);
    expect(run.json.errors[0].code).toBe("disconnected");
    expect(run.json.final.physical).toBe("unknown");
    expect(requests().map((entry) => entry.type)).toEqual(["status", "configuration"]);
  });

  it("releases the adapter and reports unknown when it cannot confirm", async () => {
    await writeFile(
      paths().state,
      JSON.stringify({
        mode: "SPI",
        pullups: true,
        psu: true,
        psuMv: 3300,
        psuMa: 50,
        cpol: false,
        cpha: false,
        eeprom: {},
      }),
    );
    const run = bt(["release", "--adapter", "bp"]);
    expect(run.code).toBe(0);
    expect(run.json.final).toMatchObject({ declared: "release", physical: "confirmed" });
    expect(fakeState()).toMatchObject({ mode: "HiZ", pullups: false, psu: false });
    await setBench({ faults: { silentRelease: true } });
    const silent = bt(["release", "--adapter", "bp"]);
    expect(silent.code).toBe(3);
    expect(silent.json.lifecycle.physical).toBe("unknown");
  });

  it("stops at the next safe point when VERA asks, applying the release", async () => {
    await setBench({ faults: { stream: ["41"] } });
    const control = join(root, "control");
    await mkdir(control);
    const uart = await profile("uart.json", uartProfile());
    const child = spawn(python, [script, "capture", "--adapter", "bp", "--bus", uart, "--duration", "30"], {
      cwd: root,
      env: { ...process.env, ...environment({ VERA_RUN_CONTROL: control }) },
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    const exit = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
    for (let tries = 0; tries < 100 && !existsSync(join(control, "state.json")); tries++) await sleep(50);
    await sleep(800);
    await writeFile(join(control, "stop"), "stop");
    const started = Date.now();
    expect(await exit).toBe(3);
    expect(Date.now() - started).toBeLessThan(5000);
    const json = JSON.parse(stdout);
    expect(json.errors[0].code).toBe("stopped");
    expect(json.final).toMatchObject({ declared: "release", physical: "confirmed" });
    expect(fakeState()).toMatchObject({ mode: "HiZ", pullups: false, psu: false });
    expect(JSON.parse(readFileSync(join(control, "state.json"), "utf8"))).toEqual({
      format: 1,
      phase: "released",
      physical: "confirmed",
    });
  });

  it("summarizes run folders and refuses a folder without a result", async () => {
    const path = await profile("i2c.json", i2cProfile());
    bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      path,
      "--device",
      "bme280",
      "--register",
      "chip_id",
      "--run-id",
      "ok",
    ]);
    bt([
      "read-register",
      "--adapter",
      "bp",
      "--bus",
      path,
      "--device",
      "ghost",
      "--register",
      "chip_id",
      "--run-id",
      "nack",
    ]);
    const run = bt(["report", "--run", "arduino-iot-results/ok", "--run", "arduino-iot-results/nack"]);
    expect(run.code).toBe(0);
    expect(
      run.json.runs.map((item: Json) => [
        item.operation,
        item.status,
        item.device,
        item.register,
        item.physical,
      ]),
    ).toEqual([
      ["read-register", "pass", "bme280", "chip_id", "confirmed"],
      ["read-register", "fail", "ghost", "chip_id", "confirmed"],
    ]);
    await mkdir(join(root, "empty"));
    expect(bt(["report", "--run", "empty"]).json.errors[0].code).toBe("run-invalid");
  });
});

describe("the runner reserves and supervises the adapter", { timeout: 60_000 }, () => {
  const program = () => manifest().programs["bus-tool"] as NonNullable<PluginManifest["programs"][string]>;
  const leaseFolder = () => join(root, "leases");
  const runner = () =>
    new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      leases: new core.ResourceLeases({ root: leaseFolder(), app: "test" }),
    });
  async function request(args: string[], timeoutMs?: number): Promise<core.RunRequest> {
    const claimed = await core.claimedResources(root, program(), args);
    if (!claimed) throw Error("no claim");
    return {
      sessionId: "s1",
      workbench: root,
      executable: python,
      args: [script, ...args],
      env: environment(),
      ...(timeoutMs ? { timeoutMs } : {}),
      background: true,
      lease: {
        claims: claimed.resources.map((resource) => ({ ...resource, actuates: true })),
        graceMs: 5000,
        cleanup: { args: [script, "release", "--adapter", "bp"], timeoutMs: 30_000 },
      },
    };
  }

  it("keys the adapter by both ports and makes runs on either port BUSY, in this and another process", async () => {
    await setBench({ faults: { stream: ["41"] } });
    const uart = await profile("uart.json", uartProfile());
    const claimed = await core.claimedResources(root, program(), ["capture", "--adapter", "bp"]);
    expect(claimed?.resources[0]?.keys).toEqual(["serial:COM35", "serial:COM34", IDENTITY.toLowerCase()]);
    const first = runner();
    const run = await first.start(
      await request(["capture", "--adapter", "bp", "--bus", uart, "--duration", "3"]),
    );
    const portRun = (port: string): core.RunRequest => ({
      sessionId: "s2",
      workbench: root,
      executable: python,
      args: ["-c", "pass", "--port", port],
    });
    await expect(first.start(portRun("COM34"))).rejects.toMatchObject({ code: "BUSY" });
    await expect(runner().start(portRun("com34"))).rejects.toMatchObject({ code: "BUSY" });
    await expect(runner().start(portRun("COM35"))).rejects.toMatchObject({ code: "BUSY" });
    const result = await run.done;
    expect(result).toMatchObject({ exitCode: 0, physical: "confirmed", cleanup: "none" });
    const other = runner();
    const holder = await other.start({
      ...portRun("COM35"),
      args: ["-c", "import time; time.sleep(2)", "--port", "COM35"],
      background: true,
    });
    await expect(runner().start(await request(["identify", "--adapter", "bp"]))).rejects.toMatchObject({
      code: "BUSY",
    });
    await holder.done;
  });

  it("runs the release cleanup after a timeout kills a run stuck in a transaction", async () => {
    await setBench({ faults: { silentConfig: true } });
    const slow = await profile(
      "slow.json",
      i2cProfile({ limits: { maxWriteBytes: 16, maxReadBytes: 32, timeoutMs: 10000 } }),
    );
    const run = await runner().start(
      await request(
        ["read-register", "--adapter", "bp", "--bus", slow, "--device", "bme280", "--register", "chip_id"],
        1500,
      ),
    );
    const result = await run.done;
    expect(result.timedOut).toBe(true);
    expect(result).toMatchObject({ physical: "confirmed", cleanup: "separate" });
    expect(fakeState()).toMatchObject({ mode: "HiZ", pullups: false, psu: false });
  });

  it("lets a stopped capture end itself with the release, needing no cleanup", async () => {
    await setBench({ faults: { stream: ["41"] } });
    const uart = await profile("uart.json", uartProfile());
    const run = await runner().start(
      await request(["capture", "--adapter", "bp", "--bus", uart, "--duration", "30"], 2000),
    );
    const result = await run.done;
    expect(result).toMatchObject({ timedOut: true, physical: "confirmed", cleanup: "none" });
    expect(result.output).toMatch(/"code": "stopped"/);
  });
});

const port = process.env.VERA_TEST_BUS_PIRATE_PORT;
const terminal = process.env.VERA_TEST_BUS_PIRATE_TERMINAL;
const identity = process.env.VERA_TEST_BUS_PIRATE_IDENTITY;
describe.skipIf(!port || !terminal || !identity)("a real Bus Pirate (hardware evidence, read-only)", () => {
  it("identifies the adapter through BPIO2", async () => {
    await writeFile(
      paths().registry,
      JSON.stringify({
        format: 1,
        resources: [{ ...ADAPTER, resource: port, terminal, identity, power: undefined }],
      }),
    );
    const { VERA_RUN_CONTROL: _a, ...rest } = process.env;
    const result = spawnSync(python, [script, "identify", "--adapter", "bp"], {
      cwd: root,
      env: { ...rest, BUS_REGISTRY: paths().registry },
      encoding: "utf8",
    });
    const json = JSON.parse(result.stdout);
    expect(json.status, result.stdout).toBe("pass");
    expect(json.adapter.supported).toBe(true);
  });
});
