// The ble-tools plugin without a BLE device. Default tests check the package, the risk rules and ble-tool against a
// fake Bleak 3.1.0 (tests/fixtures/ble-tools/fake-bleak) that simulates adapters, advertisers and GATT servers from a
// bench file and logs every radio call - offline evidence only, never proof of a real adapter or device. The runner
// block uses the real ProgramRunner, lease folder and cleanup run. VERA_TEST_BLE_PYTHON names a Python with the pinned
// Bleak for one real passive scan on this computer's adapter; no test connects to a real device.
// REQ-DATA-e8502710 REQ-FUNC-0f792684 REQ-FUNC-dd778299 REQ-SEC-98e5023f REQ-PLAT-7938d880 REQ-SEC-14b13f88
// REQ-SEC-0a495d33 REQ-SEC-73fb6150 REQ-REL-74028483 REQ-FUNC-aac8f787 REQ-FUNC-0ec93754 REQ-DATA-c1bd7c16
// REQ-SEC-1c16a89f REQ-SEC-ba742a6b REQ-FUNC-fe487751 REQ-REL-d832225a REQ-REL-b1f75f03 REQ-SEC-74530dd0
// REQ-SEC-a637b83d REQ-SEC-3b098df7 REQ-REL-4706f92a REQ-REL-efdfb040 REQ-SEC-ae588c69 REQ-REL-864d305c
// REQ-PLAT-638438cc REQ-REL-1b62b28c REQ-REL-92d16a4c REQ-DATA-73b3fb3d REQ-REL-9b84dc0c REQ-SEC-ad7b56a7
// REQ-SEC-e44aa511 REQ-TEST-e7ad54bf
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as core from "@vera/core";
import { classifyCommand, type PluginManifest, validatePluginManifest } from "@vera/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse } from "yaml";

const software = fileURLToPath(new URL("../../", import.meta.url));
const pluginFolder = join(software, "plugins", "ble-tools");
const scripts = join(pluginFolder, "scripts");
const script = join(scripts, "ble_tool.py");
const fakeBleak = fileURLToPath(new URL("../fixtures/ble-tools/fake-bleak/", import.meta.url));
const windows = process.platform === "win32";
const manifest = (): PluginManifest => parse(readFileSync(join(pluginFolder, "plugin.yaml"), "utf8"));
const sleep = (ms: number) => new Promise<void>((done) => setTimeout(done, ms));

/** The toolchain's Python, which runs ble-tool against the fake Bleak; it needs no Bluetooth package. */
const python = (() => {
  const name = process.env.VERA_TEST_PYTHON ?? (windows ? "python" : "python3");
  const found = spawnSync(
    name,
    ["-c", "import sys; assert sys.version_info >= (3, 11); print(sys.executable)"],
    {
      encoding: "utf8",
    },
  );
  if (found.status !== 0) throw new Error(`These tests need Python 3.11+ as ${name}: ${found.stderr}`);
  return found.stdout.trim();
})();

const ADDRESS = "C4:7F:51:00:12:34";
const TWIN = "C4:7F:51:00:99:99";
const CUSTOM = "8e1f0000-1c2b-4a3d-9e5f-0123456789ab";
const custom = (n: number) => `8e1f000${n}-1c2b-4a3d-9e5f-0123456789ab`;
const hex = (text: string) => Buffer.from(text, "utf8").toString("hex");
const DEVICE = {
  alias: "thermo",
  kind: "ble-device",
  address: ADDRESS,
  addressType: "public",
  profile: "bench-thermometer",
  serial: "TH-0042",
};
// biome-ignore lint/suspicious/noExplicitAny: printed JSON documents and fixture data, checked field by field.
type Json = Record<string, any>;

let root = "";
const paths = () => ({
  registry: join(root, "lab", "resources.json"),
  bench: join(root, "bench.json"),
  state: join(root, "fake-state.json"),
  log: join(root, "fake-ble.log"),
});
const gatt = (serial: string, fields: Json = {}): Json[] => [
  {
    uuid: "181a",
    handle: 1,
    characteristics: [
      {
        uuid: "2a6e",
        handle: 3,
        properties: ["read", "notify"],
        value: fields.temperature ?? "1509",
        descriptors: [{ uuid: "2902", handle: 4 }],
        notify: fields.notify ?? { values: ["1509", "1609", "1709"], interval: 0.05, repeat: true },
        ...(fields.temperatureChar ?? {}),
      },
    ],
  },
  {
    uuid: "180a",
    handle: 5,
    characteristics: [
      { uuid: "2a25", handle: 6, properties: ["read"], value: hex(serial), ...(fields.serialChar ?? {}) },
    ],
  },
  {
    uuid: CUSTOM,
    handle: 8,
    characteristics: [
      { uuid: custom(1), handle: 9, properties: ["read", "write"], value: "00", ...(fields.fan ?? {}) },
      { uuid: custom(2), handle: 11, properties: ["write"], value: "32" },
      { uuid: custom(3), handle: 13, properties: ["read"], value: "07" },
      { uuid: custom(4), handle: 15, properties: ["write-without-response"], value: "00", maxWwr: 20 },
    ].filter((char) => !(fields.drop ?? []).includes(char.uuid)),
  },
];
const devices = (fields: Json = {}): Json[] => [
  {
    address: ADDRESS,
    name: "THERMO",
    rssi: [-60, -52, -58],
    serviceUuids: ["181a"],
    manufacturer: { "89": "0102" },
    txPower: 4,
    mtu: 247,
    services: gatt("TH-0042", fields),
    faults: fields.faults ?? {},
    ...(fields.thermo ?? {}),
  },
  { address: TWIN, name: "THERMO", rssi: [-80, -75], serviceUuids: ["181a"], services: gatt("TH-0099") },
  { address: "E1:22:33:44:55:66", name: "TAG", rssi: [-70], serviceUuids: ["fe95"] },
];
async function setBench(fields: Json = {}) {
  await writeFile(
    paths().bench,
    JSON.stringify({
      backend: "win_rt",
      adapter: "on",
      devices: devices(fields),
      findWait: 0.3,
      ...(fields.bench ?? {}),
    }),
  );
}
async function setRegistry(entry: Json = {}) {
  await writeFile(paths().registry, JSON.stringify({ format: 1, resources: [{ ...DEVICE, ...entry }] }));
}
const thermometer = (): Json =>
  JSON.parse(readFileSync(join(pluginFolder, "profiles", "bench-thermometer.json"), "utf8"));
/** The example profile with short timeouts, a state-changing counter and a without-response LED. */
const benchProfile = (change: (profile: Json) => void = () => {}): Json => {
  const profile = thermometer();
  profile.limits = {
    connectTimeoutS: 2,
    operationTimeoutS: 2,
    maxNotificationsPerSecond: 50,
    maxNotifications: 1000,
    maxBytes: 100000,
  };
  profile.services[2].characteristics.push(
    {
      name: "counter",
      uuid: custom(3),
      properties: ["read"],
      operations: ["read"],
      sideEffects: "changes-state",
      payload: { type: "uint", size: 1, byteOrder: "little", unit: "count" },
    },
    {
      name: "led",
      uuid: custom(4),
      properties: ["write-without-response"],
      operations: ["write"],
      sideEffects: "none",
      payload: { type: "bytes", minLength: 1, maxLength: 24, unit: "none" },
      writes: [
        { name: "blink", class: "actuate", value: "fixed", data: "01", response: false },
        { name: "pattern", class: "actuate", value: "fixed", data: "01".repeat(24), response: false },
      ],
    },
  );
  change(profile);
  return profile;
};
async function profile(name: string, document: Json = benchProfile()) {
  await writeFile(join(root, "ble", name), JSON.stringify(document));
  return `ble/${name}`;
}

function environment(extra: Record<string, string> = {}): Record<string, string> {
  return {
    PYTHONPATH: fakeBleak,
    PYTHONUTF8: "1",
    PYTHONDONTWRITEBYTECODE: "1",
    BLE_REGISTRY: paths().registry,
    FAKE_BLE_BENCH: paths().bench,
    FAKE_BLE_STATE: paths().state,
    FAKE_BLE_LOG: paths().log,
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
const events = (name?: string) => wire().filter((entry) => name === undefined || entry.event === name);
const resultOf = (run: Run): Json => JSON.parse(readFileSync(join(root, run.json.resultPath), "utf8"));
const clearWire = () => rm(paths().log, { force: true });
const code = (run: Run) => run.json.errors?.[0]?.code;
const device = ["--device", "thermo"];

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "vera-ble-tools-")));
  await mkdir(join(root, "lab"));
  await mkdir(join(root, "ble"));
  await mkdir(join(root, ".vera"));
  await setRegistry();
  await setBench();
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true, maxRetries: 5 });
});

describe("package", () => {
  it("publishes the official ble-tools package with one pinned helper, a supervised device, skills, catalog and pack", async () => {
    const m = manifest();
    expect(validatePluginManifest(m).issues).toEqual([]);
    expect(m).toMatchObject({ id: "ble-tools", version: "0.2.0", platforms: ["windows-x64", "linux-x64"] });
    expect(Object.keys(m.programs)).toEqual(["ble-tool"]);
    const program = m.programs["ble-tool"];
    expect(program?.install).toEqual({ script: "scripts/ble_tool.py" });
    expect(program?.resources).toEqual({
      option: "--device",
      kinds: ["ble-device"],
      grace: 5,
      cleanup: ["release"],
      cleanupTimeout: 30,
    });
    // biome-ignore lint/suspicious/noTemplateCurlyInString: the manifest placeholder, compared literally.
    expect(program?.env).toEqual({ BLE_REGISTRY: "${workbench}/lab/resources.json" });
    const source = readFileSync(script, "utf8");
    for (const pin of [
      '"bleak==3.1.0"',
      "winrt-runtime==4.1.0; sys_platform == 'win32'",
      "dbus-fast==5.2.0; sys_platform == 'linux'",
    ])
      expect(source).toContain(pin);
    expect(source.match(/==4!10\.0\.28000\.2957; sys_platform == 'win32'/g)).toHaveLength(8);
    const catalog = parse(readFileSync(join(software, "plugins", "catalog.yaml"), "utf8"));
    expect(catalog.official).toContain("ble-tools");
    expect(catalog.metadata["ble-tools"].keywords).toContain("GATT");
    const packs = parse(readFileSync(join(software, "plugins", "packs.yaml"), "utf8"));
    const arduino = packs.find((pack: { id: string }) => pack.id === "arduino");
    expect(arduino.groups).toContainEqual({
      name: "BLE devices (GATT)",
      plugins: ["ble-tools"],
      default: true,
    });
    expect(await core.checkCatalogSource(join(software, "plugins"))).toEqual([]);
    const store = new core.PluginStore({ root: join(root, "plugins") });
    await store.install(pluginFolder);
    const installed = await store.load("ble-tools");
    const skills = new core.SkillCatalog({
      root,
      disabled: () => [],
      plugins: async () => [{ id: installed.manifest.id, folder: installed.folder }],
    });
    const names = (await skills.list())
      .filter((skill) => skill.plugin === "ble-tools")
      .map((skill) => skill.name);
    expect(names.sort()).toEqual(["ble-devices", "ble-profiles"]);
    const usage = (await skills.read("plugin", "ble-devices")).content;
    for (const text of [
      "ambiguousName",
      "candidate",
      "pairing-required",
      "--persistent",
      "--side-effects",
      "overflow",
      "BUSY",
      "untrusted",
    ])
      expect(usage).toContain(text);
    const profiles = (await skills.read("plugin", "ble-profiles")).content;
    for (const text of [
      "sideEffects",
      "changes-state",
      "persistent",
      "identity",
      "no raw write",
      "static random",
    ])
      expect(profiles.toLowerCase()).toContain(text.toLowerCase());
    await writeFile(
      join(root, "ble", "example.json"),
      readFileSync(join(pluginFolder, "profiles", "bench-thermometer.json")),
    );
    const caps = bt(["capabilities", "--profile", "ble/example.json"]);
    expect(caps.code, caps.stdout).toBe(0);
    expect(caps.json.profile.characteristics.map((char: Json) => char.name)).toEqual([
      "temperature",
      "serial-number",
      "fan-level",
      "default-level",
    ]);
    expect(caps.json.engine).toMatchObject({ bleak: "3.1.0", windowsMinBuild: 22000 });
    expect(events()).toEqual([]);
  });

  it("classifies every operation at its highest effect and never calls a read safe", () => {
    const m = manifest();
    const risk = (line: string) => {
      const [program, ...args] = line.split(" ");
      return classifyCommand(m.rules ?? [], program as string, args).risk;
    };
    for (const line of [
      "ble-tool --version",
      "ble-tool capabilities",
      "ble-tool capabilities --profile p.json",
      "ble-tool report --run r",
    ])
      expect(risk(line), line).toBe("safe");
    for (const line of [
      "ble-tool scan --duration 5",
      "ble-tool scan --duration 5 --active",
      "ble-tool identify --device d --profile p.json",
      "ble-tool discover-services --device d",
      "ble-tool read-characteristic --device d --profile p.json --characteristic t",
      "ble-tool subscribe-notifications --device d --profile p.json --characteristic t --duration 5",
    ])
      expect(risk(line), line).toBe("device-read");
    for (const line of [
      "ble-tool read-characteristic --device d --profile p.json --characteristic c --side-effects",
      "ble-tool subscribe-notifications --device d --profile p.json --characteristic c --duration 5 --side-effects",
      "ble-tool write-characteristic --device d --profile p.json --characteristic f --write off",
      "ble-tool release --device d",
    ])
      expect(risk(line), line).toBe("device-write");
    expect(
      risk(
        "ble-tool write-characteristic --device d --profile p.json --characteristic f --write store --value 5 --persistent",
      ),
    ).toBe("irreversible");
  });

  it("offers no pairing, raw write, firmware or advertising operation", () => {
    for (const args of [
      ["pair", "--device", "thermo"],
      ["unpair"],
      ["write-raw"],
      ["dfu"],
      ["advertise"],
      ["connect"],
    ]) {
      const run = bt(args);
      expect(run.code).toBe(2);
      expect(run.json).toMatchObject({ status: "blocked", errors: [{ code: "arguments" }] });
    }
    const raw = bt([
      "write-characteristic",
      ...device,
      "--profile",
      "p.json",
      "--characteristic",
      "fan-level",
      "--data",
      "ff",
    ]);
    expect(code(raw)).toBe("arguments");
    const source = readdirSync(join(scripts, "ble_support"))
      .filter((name) => name.endsWith(".py"))
      .map((name) => readFileSync(join(scripts, "ble_support", name), "utf8"))
      .join("\n");
    for (const call of [
      ".pair(",
      ".unpair(",
      "pair=True",
      '"pair": True',
      "write_gatt_descriptor",
      "BleakGATTServer",
      "advertis(e|ing)_start",
    ])
      expect(source).not.toContain(call);
    expect(bt(["--version"]).stdout.trim()).toBe("ble-tool 0.2.0");
    expect(events()).toEqual([]);
  });

  it("carries workspace.py and lifecycle.py as byte-identical copies", async () => {
    const pairs = [
      [
        "workspace.py",
        join(software, "plugins", "circuitpython", "scripts", "circuitpython_support", "workspace.py"),
      ],
      ["lifecycle.py", join(software, "plugins", "bus-tools", "scripts", "bus_support", "lifecycle.py")],
    ] as const;
    const ours = await readFile(join(scripts, "ble_support", pairs[0][0]));
    expect(ours.equals(await readFile(pairs[0][1]))).toBe(true);
    const life = (await readFile(join(scripts, "ble_support", pairs[1][0]), "utf8"))
      .split("\n")
      .slice(1)
      .join("\n");
    expect(life).toBe((await readFile(pairs[1][1], "utf8")).split("\n").slice(1).join("\n"));
  });
});

describe("scanning", { timeout: 60_000 }, () => {
  it("scans passively for a bounded time, lists advertisers by address and never merges same-named devices", () => {
    const run = bt(["scan", "--duration", "1"]);
    expect(run.code, run.stdout).toBe(0);
    expect(run.json.scan).toMatchObject({ mode: "passive", durationS: 1, endedBy: "duration", devices: 3 });
    const byAddress = Object.fromEntries(run.json.advertisers.map((item: Json) => [item.address, item]));
    expect(byAddress[ADDRESS]).toMatchObject({
      names: ["THERMO"],
      rssiMin: -60,
      rssiMax: -52,
      manufacturerIds: [89],
      txPower: 4,
      registryAlias: "thermo",
      candidate: true,
      identity: "candidate",
      ambiguousName: true,
    });
    expect(byAddress[ADDRESS].serviceUuids).toEqual(["0000181a-0000-1000-8000-00805f9b34fb"]);
    expect(byAddress[TWIN]).toMatchObject({ registryAlias: null, candidate: false, ambiguousName: true });
    expect(byAddress["E1:22:33:44:55:66"]).toMatchObject({ ambiguousName: false });
    expect(JSON.stringify(run.json)).not.toContain("confirmed");
    expect(run.json.warnings).toContainEqual(expect.objectContaining({ code: "ambiguous-name" }));
    expect(resultOf(run)).toMatchObject({
      format: 1,
      kind: "ble-tool-result",
      operation: "scan",
      status: "pass",
    });
    expect(events("scanner-start")).toEqual([expect.objectContaining({ mode: "passive" })]);
    expect(events("connect")).toEqual([]);
  });

  it("ends at the device bound, marks profile candidates and refuses an unbounded scan", async () => {
    const hints = await profile("hints.json");
    const run = bt(["scan", "--duration", "10", "--max-devices", "2", "--profile", hints]);
    expect(run.json.scan).toMatchObject({ endedBy: "max-devices", devices: 2 });
    const twin = run.json.advertisers.find((item: Json) => item.address === TWIN);
    if (twin) expect(twin).toMatchObject({ candidate: true, identity: "candidate" });
    for (const args of [
      ["--duration", "31"],
      ["--duration", "0"],
      ["--duration", "5", "--max-devices", "501"],
    ]) {
      const refused = bt(["scan", ...args]);
      expect(refused.code).toBe(2);
      expect(code(refused)).toBe("arguments");
    }
  });

  it("refuses passive scanning on Linux and scans actively when asked", async () => {
    await setBench({ bench: { backend: "bluez_dbus" } });
    await clearWire();
    const passive = bt(["scan", "--duration", "1"]);
    expect(passive.code).toBe(2);
    expect(code(passive)).toBe("passive-unsupported");
    expect(passive.json.resultPath).toBeUndefined();
    expect(events()).toEqual([]);
    const active = bt(["scan", "--duration", "1", "--active"]);
    expect(active.code, active.stdout).toBe(0);
    expect(events("scanner-start")).toEqual([expect.objectContaining({ mode: "active" })]);
  });

  it("reports an absent or switched-off adapter, an unsupported backend and another Bleak version", async () => {
    for (const [state, reason] of [
      ["missing", "no-bluetooth"],
      ["off", "powered-off"],
      ["denied", "denied"],
    ]) {
      await setBench({ bench: { adapter: state } });
      for (const args of [
        ["scan", "--duration", "1"],
        ["identify", ...device, "--profile", await profile("p.json")],
      ]) {
        const run = bt(args);
        expect(run.code, run.stdout).toBe(2);
        expect(run.json).toMatchObject({
          status: "blocked",
          errors: [{ code: "adapter-unavailable" }],
          adapterReason: reason,
        });
      }
    }
    expect(events("connect")).toEqual([]);
    await setBench({ bench: { backend: "core_bluetooth" } });
    expect(code(bt(["scan", "--duration", "1"]))).toBe("os-unsupported");
    await setBench();
    const old = join(root, "old-bleak");
    await mkdir(join(old, "bleak-3.0.2.dist-info"), { recursive: true });
    await writeFile(
      join(old, "bleak-3.0.2.dist-info", "METADATA"),
      "Metadata-Version: 2.1\nName: bleak\nVersion: 3.0.2\n",
    );
    const version = bt(["scan", "--duration", "1"], { PYTHONPATH: [old, fakeBleak].join(delimiter) });
    expect(code(version)).toBe("backend-version");
    expect(version.json.errors[0].message).toContain("3.0.2");
  });
});

describe("profiles and requests refused before the radio", { timeout: 60_000 }, () => {
  it("refuses an invalid profile naming the field", async () => {
    const cases: [string, (p: Json) => void, RegExp][] = [
      ["unknown field", (p) => (p.extra = 1), /unknown fields extra/],
      ["bad uuid", (p) => (p.services[0].characteristics[0].uuid = "2a6"), /uuid/],
      [
        "unknown unit",
        (p) => (p.services[0].characteristics[0].payload.unit = "furlong"),
        /not a known unit/,
      ],
      [
        "operation without property",
        (p) => (p.services[0].characteristics[0].operations = ["read", "notify", "write"]),
        /write needs the property/,
      ],
      [
        "side effects missing",
        (p) => delete p.services[0].characteristics[0].sideEffects,
        /lacks sideEffects/,
      ],
      [
        "identity on a number",
        (p) => (p.services[0].characteristics[0].identity = true),
        /identifies the unit/,
      ],
      [
        "typed write on text",
        (p) => p.services[1].characteristics[0].operations.push("write"),
        /needs the property write/,
      ],
      [
        "write without response property",
        (p) => (p.services[2].characteristics[0].writes[1].response = false),
        /write-without-response/,
      ],
      ["size", (p) => (p.services[0].characteristics[0].payload.size = 3), /size/],
      ["zero scale", (p) => (p.services[0].characteristics[0].payload.scale = 0), /scale/],
      ["limits", (p) => (p.limits.maxNotificationsPerSecond = 501), /maxNotificationsPerSecond/],
    ];
    for (const [label, change, message] of cases) {
      const file = await profile("bad.json", benchProfile(change));
      const run = bt(["capabilities", "--profile", file]);
      expect(run.code, label).toBe(2);
      expect(run.json.errors[0], label).toMatchObject({ code: "profile" });
      expect(run.json.errors[0].message, label).toMatch(message);
      expect(code(bt(["identify", ...device, "--profile", file])), label).toBe("profile");
    }
    expect(events()).toEqual([]);
  });

  it("refuses an unknown alias, a profile of another model, a changed registry and an adapter name on Windows", async () => {
    const file = await profile("p.json");
    expect(code(bt(["identify", "--device", "other", "--profile", file]))).toBe("device-unknown");
    const other = await profile(
      "other.json",
      benchProfile((p) => (p.id = "other-model")),
    );
    expect(code(bt(["identify", ...device, "--profile", other]))).toBe("profile-device");
    const changed = bt(["identify", ...device, "--profile", file], { VERA_REGISTRY_SHA256: "0".repeat(64) });
    expect(code(changed)).toBe("registry-changed");
    const digest = createHash("sha256").update(readFileSync(paths().registry)).digest("hex");
    expect(bt(["identify", ...device, "--profile", file], { VERA_REGISTRY_SHA256: digest }).code).toBe(0);
    await clearWire();
    await setRegistry({ addressType: "random", address: "51:22:33:44:55:66" });
    expect(code(bt(["identify", ...device, "--profile", file]))).toBe("registry");
    if (windows) {
      await setRegistry({ adapter: "hci0" });
      expect(code(bt(["identify", ...device, "--profile", file]))).toBe("adapter-unsupported");
    }
    expect(events()).toEqual([]);
  });
});

describe("identity", { timeout: 60_000 }, () => {
  it("confirms the device by address, GATT database and serial before anything else and connects with pairing off", async () => {
    const run = bt(["identify", ...device, "--profile", await profile("p.json")]);
    expect(run.code, run.stdout).toBe(0);
    expect(run.json.device).toMatchObject({
      alias: "thermo",
      address: ADDRESS,
      identity: "confirmed",
      serial: "TH-0042",
      mtu: 247,
    });
    expect(run.json.link).toMatchObject({ connected: false, disconnectedBy: "helper", subscription: "none" });
    expect(run.json.lifecycle).toMatchObject({ physical: "confirmed" });
    const connect = events("connect");
    expect(connect).toHaveLength(1);
    expect(connect[0]).toMatchObject({
      pair: false,
      winrt: { address_type: "public", use_cached_services: false },
    });
    expect(events("read").map((entry) => entry.uuid)).toEqual(["00002a25-0000-1000-8000-00805f9b34fb"]);
    expect(events("find")[0]).toMatchObject({ address: ADDRESS, timeout: 2, mode: "passive" });
    expect(events("pair")).toEqual([]);
  });

  it("fails a device that lacks a profile characteristic or property, reading and writing nothing", async () => {
    const file = await profile("p.json");
    await setBench({ drop: [custom(1)] });
    const missing = bt([
      "write-characteristic",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "fan-level",
      "--write",
      "off",
    ]);
    expect(missing.code, missing.stdout).toBe(1);
    expect(missing.json).toMatchObject({ status: "fail", errors: [{ code: "profile-mismatch" }] });
    expect(missing.json.missing).toContain(`characteristic fan-level (${custom(1)})`);
    await setBench({ temperatureChar: { properties: ["read"] } });
    const property = bt(["identify", ...device, "--profile", file]);
    expect(property.json.missing).toEqual(["temperature property notify"]);
    expect(events("read")).toEqual([]);
    expect(events("write")).toEqual([]);
    expect(events("disconnect")).toHaveLength(2);
  });

  it("tells two units with one name apart by the serial and never writes to the other one", async () => {
    await setRegistry({ address: TWIN });
    const run = bt([
      "write-characteristic",
      ...device,
      "--profile",
      await profile("p.json"),
      "--characteristic",
      "fan-level",
      "--write",
      "off",
    ]);
    expect(run.code, run.stdout).toBe(1);
    expect(run.json).toMatchObject({
      errors: [{ code: "identity-mismatch" }],
      device: { identity: "mismatch", serial: "TH-0099" },
    });
    expect(events("write")).toEqual([]);
    expect(events("read")).toHaveLength(1);
    await setRegistry({ serial: undefined });
    const unchecked = bt(["identify", ...device, "--profile", await profile("p.json")]);
    expect(unchecked.json.warnings).toContainEqual(expect.objectContaining({ code: "identity-unchecked" }));
    expect(unchecked.json.device.identity).toBe("confirmed");
  });

  it("reports a device that is not seen without connecting", async () => {
    await setRegistry({ address: "C4:7F:51:00:00:01" });
    const run = bt(["identify", ...device, "--profile", await profile("p.json")]);
    expect(run.code).toBe(2);
    expect(run.json).toMatchObject({
      status: "blocked",
      errors: [{ code: "not-found" }],
      lifecycle: { physical: "unchanged" },
    });
    expect(events("connect")).toEqual([]);
    expect(resultOf(run).status).toBe("blocked");
  });

  it("lists the GATT table without reading values and names profile mismatches", async () => {
    const run = bt(["discover-services", ...device]);
    expect(run.code, run.stdout).toBe(0);
    expect(run.json.services.map((service: Json) => service.uuid)).toEqual([
      "0000181a-0000-1000-8000-00805f9b34fb",
      "0000180a-0000-1000-8000-00805f9b34fb",
      CUSTOM,
    ]);
    expect(run.json.services[0].characteristics[0]).toEqual({
      uuid: "00002a6e-0000-1000-8000-00805f9b34fb",
      handle: 3,
      properties: ["notify", "read"],
      descriptors: [{ uuid: "00002902-0000-1000-8000-00805f9b34fb", handle: 4 }],
    });
    await setBench({ drop: [custom(2)] });
    const mismatch = bt(["discover-services", ...device, "--profile", await profile("p.json")]);
    expect(mismatch.code).toBe(1);
    expect(mismatch.json.profileMismatches).toEqual([`characteristic default-level (${custom(2)})`]);
    expect(events("read")).toEqual([]);
  });
});

describe("reads and values", { timeout: 60_000 }, () => {
  it("reads a declared characteristic a bounded number of times and decodes it", async () => {
    const file = await profile("p.json");
    const run = bt([
      "read-characteristic",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "temperature",
      "--count",
      "3",
      "--interval",
      "0.1",
    ]);
    expect(run.code, run.stdout).toBe(0);
    expect(run.json.reads).toHaveLength(3);
    expect(run.json.reads[0]).toMatchObject({
      index: 1,
      characteristic: "temperature",
      raw: "1509",
      length: 2,
      value: 23.25,
      unit: "degC",
      valid: true,
      decodeError: null,
    });
    expect(run.json.reads[0].receivedAt).toMatch(/^\d{4}-\d\d-\d\dT/);
    expect(events("read")).toHaveLength(4);
    const notAllowed = bt([
      "read-characteristic",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "default-level",
    ]);
    expect(code(notAllowed)).toBe("operation-not-allowed");
    for (const args of [
      ["--count", "101"],
      ["--interval", "0.05"],
    ])
      expect(
        code(
          bt([
            "read-characteristic",
            ...device,
            "--profile",
            file,
            "--characteristic",
            "temperature",
            ...args,
          ]),
        ),
      ).toBe("arguments");
  });

  it("keeps truncated and out-of-range values raw and never reports them as measurements", async () => {
    const file = await profile("p.json");
    await setBench({ temperature: "15" });
    const short = bt([
      "read-characteristic",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "temperature",
    ]);
    expect(short.json.reads[0]).toMatchObject({
      raw: "15",
      length: 1,
      value: null,
      valid: false,
      decodeError: "length",
    });
    await setBench({ temperature: "204e" });
    const hot = bt(["read-characteristic", ...device, "--profile", file, "--characteristic", "temperature"]);
    expect(hot.json.reads[0]).toMatchObject({ value: 200, valid: false, decodeError: "out-of-range" });
    expect(hot.json.status).toBe("pass");
    await setBench({ serialChar: { value: "ff00" } });
    const text = await profile("text.json", benchProfile());
    await setRegistry({ serial: undefined });
    const utf8 = bt([
      "read-characteristic",
      ...device,
      "--profile",
      text,
      "--characteristic",
      "serial-number",
    ]);
    expect(utf8.json.reads[0]).toMatchObject({ value: null, decodeError: "utf8" });
  });

  it("reads a state-changing characteristic only with --side-effects", async () => {
    const file = await profile("p.json");
    const refused = bt(["read-characteristic", ...device, "--profile", file, "--characteristic", "counter"]);
    expect(refused.code).toBe(2);
    expect(code(refused)).toBe("side-effects-not-named");
    expect(events()).toEqual([]);
    const read = bt([
      "read-characteristic",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "counter",
      "--side-effects",
    ]);
    expect(read.json.reads[0]).toMatchObject({ value: 7, unit: "count", valid: true });
  });

  it("hands pairing to the user and never pairs", async () => {
    const file = await profile("p.json");
    await setBench({ temperatureChar: { readError: 5 } });
    const run = bt(["read-characteristic", ...device, "--profile", file, "--characteristic", "temperature"]);
    expect(run.code, run.stdout).toBe(2);
    expect(run.json).toMatchObject({ status: "blocked", errors: [{ code: "pairing-required" }] });
    expect(run.json.errors[0].message).toMatch(/Bluetooth settings/);
    expect(run.json.errors[0].message).toMatch(/never pairs, unpairs or enters a PIN/);
    await setBench({ temperatureChar: { readDenied: true } });
    expect(
      code(bt(["read-characteristic", ...device, "--profile", file, "--characteristic", "temperature"])),
    ).toBe("pairing-required");
    await setBench({ temperatureChar: { readError: 2 } });
    expect(
      code(bt(["read-characteristic", ...device, "--profile", file, "--characteristic", "temperature"])),
    ).toBe("not-permitted");
    expect(events("pair")).toEqual([]);
    expect(events("unpair")).toEqual([]);
  });
});

describe("notifications", { timeout: 60_000 }, () => {
  it("records notifications for a bounded count and time into jsonl and csv and stops them before disconnecting", async () => {
    const file = await profile("p.json");
    const counted = bt([
      "subscribe-notifications",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "temperature",
      "--duration",
      "20",
      "--max-notifications",
      "5",
    ]);
    expect(counted.code, counted.stdout).toBe(0);
    expect(counted.json.notifications).toMatchObject({ count: 5, endedBy: "max-notifications", dropped: 0 });
    expect(counted.json.link).toMatchObject({ subscription: "stopped", disconnectedBy: "helper" });
    const lines = readFileSync(join(root, counted.json.notifications.file), "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(lines).toHaveLength(5);
    expect(lines[1]).toMatchObject({ index: 2, raw: "1609", value: 23.26, unit: "degC", valid: true });
    const csv = readFileSync(join(root, counted.json.notifications.csv), "utf8").trim().split("\n");
    expect(csv[0]).toBe("index,receivedAt,raw,value,unit,valid,decodeError");
    expect(csv).toHaveLength(6);
    const order = events()
      .map((entry) => entry.event)
      .filter((name) => ["start_notify", "stop_notify", "disconnect"].includes(name));
    expect(order).toEqual(["start_notify", "stop_notify", "disconnect"]);
    await clearWire();
    const started = Date.now();
    const timed = bt([
      "subscribe-notifications",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "temperature",
      "--duration",
      "1",
    ]);
    expect(timed.json.notifications.endedBy).toBe("duration");
    expect(Date.now() - started).toBeLessThan(15_000);
    expect(
      code(
        bt([
          "subscribe-notifications",
          ...device,
          "--profile",
          file,
          "--characteristic",
          "fan-level",
          "--duration",
          "1",
        ]),
      ),
    ).toBe("operation-not-allowed");
  });

  it("stops a notification flood and counts what it dropped", async () => {
    await setBench({ notify: { values: ["1509"], interval: 0.001, repeat: true } });
    const file = await profile(
      "flood.json",
      benchProfile((p) => (p.limits.maxNotificationsPerSecond = 10)),
    );
    const run = bt([
      "subscribe-notifications",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "temperature",
      "--duration",
      "10",
    ]);
    expect(run.code, run.stdout).toBe(3);
    expect(run.json).toMatchObject({
      status: "incomplete",
      errors: [{ code: "overflow" }],
      link: { subscription: "stopped" },
    });
    expect(run.json.notifications.count).toBeGreaterThan(10);
    expect(run.json.notifications.count).toBeLessThan(200);
    expect(events("stop_notify")).toHaveLength(1);
  });

  it("reports a subscription it could not turn off as unknown", async () => {
    await setBench({ faults: { stopNotifyFails: true } });
    const run = bt([
      "subscribe-notifications",
      ...device,
      "--profile",
      await profile("p.json"),
      "--characteristic",
      "temperature",
      "--duration",
      "1",
    ]);
    expect(run.json.link.subscription).toBe("unknown");
    expect(run.json.lifecycle.physical).toBe("unknown");
    expect(events("disconnect")).toHaveLength(1);
  });

  it("reports a lost link and a hanging connect without reconnecting or re-sending", async () => {
    const file = await profile("p.json");
    await setBench({ faults: { disconnectAfterNotifications: 3 } });
    const lost = bt([
      "subscribe-notifications",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "temperature",
      "--duration",
      "10",
    ]);
    expect(lost.code, lost.stdout).toBe(3);
    expect(lost.json).toMatchObject({
      errors: [{ code: "disconnected" }],
      link: { disconnectedBy: "device", subscription: "unknown" },
    });
    expect(lost.json.notifications.count).toBe(3);
    expect(events("connect")).toHaveLength(1);
    expect(events("start_notify")).toHaveLength(1);
    await clearWire();
    await setBench({ faults: { connectHang: true } });
    const hang = bt(["identify", ...device, "--profile", file]);
    expect(hang.code).toBe(2);
    expect(code(hang)).toBe("connect-timeout");
    expect(events("connect")).toHaveLength(1);
    await setBench({ temperatureChar: { readHang: true } });
    const slow = bt(["read-characteristic", ...device, "--profile", file, "--characteristic", "temperature"]);
    expect(slow.json).toMatchObject({ status: "incomplete", errors: [{ code: "timeout" }] });
  });

  it("stops at the next safe point when VERA asks and turns the subscription off", async () => {
    const control = join(root, "control");
    await mkdir(control);
    const file = await profile("p.json");
    const { VERA_RUN_CONTROL: _a, ...rest } = process.env;
    const child = spawn(
      python,
      [
        script,
        "subscribe-notifications",
        ...device,
        "--profile",
        file,
        "--characteristic",
        "temperature",
        "--duration",
        "30",
      ],
      {
        cwd: root,
        env: { ...rest, ...environment({ VERA_RUN_CONTROL: control }) },
      },
    );
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    const done = new Promise<number | null>((resolve) => child.on("close", resolve));
    while (events("start_notify").length === 0) await sleep(100);
    const asked = Date.now();
    await writeFile(join(control, "stop"), "");
    expect(await done).toBe(3);
    expect(Date.now() - asked).toBeLessThan(5000);
    const json = JSON.parse(stdout);
    expect(json).toMatchObject({
      errors: [{ code: "stopped" }],
      link: { subscription: "stopped" },
      lifecycle: { physical: "confirmed", stopRequested: true },
    });
    expect(JSON.parse(readFileSync(join(control, "state.json"), "utf8"))).toEqual({
      format: 1,
      phase: "released",
      physical: "confirmed",
    });
  });
});

describe("writes", { timeout: 60_000 }, () => {
  const write = (file: string, ...args: string[]) =>
    bt(["write-characteristic", ...device, "--profile", file, ...args]);

  it("sends only named write operations of the profile, once, and reads them back", async () => {
    const file = await profile("p.json");
    const off = write(file, "--characteristic", "fan-level", "--write", "off");
    expect(off.code, off.stdout).toBe(0);
    expect(off.json.write).toMatchObject({
      name: "off",
      class: "actuate",
      data: "00",
      delivery: "acknowledged",
      retried: false,
      effect: "read-back",
    });
    expect(off.json.write.readBack).toMatchObject({ raw: "00", matches: true });
    const level = write(file, "--characteristic", "fan-level", "--write", "set-level", "--value", "40");
    expect(level.json.write).toMatchObject({ data: "28", delivery: "acknowledged" });
    expect(events("write").map((entry) => [entry.data, entry.response])).toEqual([
      ["00", true],
      ["28", true],
    ]);
    expect(level.json.lifecycle.physical).toBe("confirmed");
    expect(code(write(file, "--characteristic", "fan-level", "--write", "max"))).toBe("write-unknown");
    expect(code(write(file, "--characteristic", "fan-level", "--write", "off", "--value", "3"))).toBe(
      "arguments",
    );
    expect(code(write(file, "--characteristic", "temperature", "--write", "off"))).toBe(
      "operation-not-allowed",
    );
    await setBench({ fan: { ignoreWrite: true } });
    const ignored = write(file, "--characteristic", "fan-level", "--write", "set-level", "--value", "60");
    expect(ignored.code).toBe(1);
    expect(ignored.json.write).toMatchObject({
      delivery: "acknowledged",
      effect: "unknown",
      readBack: { matches: false },
    });
  });

  it("refuses a value outside the limits or the encoding before the radio", async () => {
    const file = await profile("p.json");
    await clearWire();
    for (const [value, expected] of <[string, string][]>[
      ["101", "value-out-of-range"],
      ["-1", "value-out-of-range"],
      ["40.5", "value-not-representable"],
      ["0x20", "value-out-of-range"],
    ])
      expect(
        code(write(file, "--characteristic", "fan-level", "--write", "set-level", "--value", value)),
        value,
      ).toBe(expected);
    expect(code(write(file, "--characteristic", "fan-level", "--write", "set-level"))).toBe("value-required");
    expect(events()).toEqual([]);
  });

  it("writes a persistent value only with --persistent and refuses the option for other classes", async () => {
    const file = await profile("p.json");
    expect(code(write(file, "--characteristic", "default-level", "--write", "store", "--value", "50"))).toBe(
      "write-class",
    );
    expect(code(write(file, "--characteristic", "fan-level", "--write", "off", "--persistent"))).toBe(
      "write-class",
    );
    expect(events()).toEqual([]);
    const stored = write(
      file,
      "--characteristic",
      "default-level",
      "--write",
      "store",
      "--value",
      "50",
      "--persistent",
    );
    expect(stored.json.write).toMatchObject({
      class: "persistent",
      data: "32",
      delivery: "acknowledged",
      effect: "unknown",
    });
  });

  it("reports refused, sent and unknown deliveries and never retries", async () => {
    const file = await profile("p.json");
    await setBench({ fan: { writeError: 0x13 } });
    const refused = write(file, "--characteristic", "fan-level", "--write", "off");
    expect(refused.code).toBe(1);
    expect(refused.json.write).toMatchObject({ delivery: "refused", attError: 0x13, retried: false });
    await setBench();
    const blink = write(file, "--characteristic", "led", "--write", "blink");
    expect(blink.json.write).toMatchObject({ delivery: "sent", response: false, effect: "unknown" });
    await setBench({ faults: { disconnectOnWrite: true } });
    const lost = write(file, "--characteristic", "fan-level", "--write", "off");
    expect(lost.code).toBe(3);
    expect(lost.json).toMatchObject({
      errors: [{ code: "disconnected" }],
      write: { delivery: "unknown", retried: false },
    });
    await setBench({ fan: { writeUnreachable: true } });
    const unreachable = write(file, "--characteristic", "fan-level", "--write", "off");
    expect(unreachable.json).toMatchObject({
      status: "incomplete",
      write: { delivery: "unknown", retried: false },
    });
    expect(events("write")).toHaveLength(4);
    expect(events("connect")).toHaveLength(4);
  });

  it("refuses a subscription to a state-changing characteristic without --side-effects", async () => {
    const file = await profile(
      "stream.json",
      benchProfile((p) => {
        const counter = p.services[2].characteristics.find((char: Json) => char.name === "counter");
        counter.properties = ["read", "notify"];
        counter.operations = ["read", "notify"];
      }),
    );
    const run = bt([
      "subscribe-notifications",
      ...device,
      "--profile",
      file,
      "--characteristic",
      "counter",
      "--duration",
      "1",
    ]);
    expect(code(run)).toBe("side-effects-not-named");
    expect(events()).toEqual([]);
  });

  it("ends a capture at the profile's byte bound", async () => {
    const small = await profile(
      "small.json",
      benchProfile((p) => (p.limits.maxBytes = 7)),
    );
    const run = bt([
      "subscribe-notifications",
      ...device,
      "--profile",
      small,
      "--characteristic",
      "temperature",
      "--duration",
      "20",
    ]);
    expect(run.code, run.stdout).toBe(0);
    expect(run.json.notifications).toMatchObject({ count: 4, bytes: 8, endedBy: "max-bytes" });
    expect(run.json.link.subscription).toBe("stopped");
  });

  it("refuses a payload that does not fit one ATT write on the link", async () => {
    const file = await profile("p.json");
    const pattern = write(file, "--characteristic", "led", "--write", "pattern");
    expect(pattern.code).toBe(2);
    expect(pattern.json).toMatchObject({
      errors: [{ code: "payload-too-large" }],
      write: { delivery: "not-sent", length: 24 },
    });
    await setBench({ thermo: { mtu: 23 } });
    const big = await profile(
      "big.json",
      benchProfile((p) => {
        p.services[2].characteristics[0].writes.push({
          name: "table",
          class: "configure",
          value: "fixed",
          data: "00".repeat(21),
          response: true,
        });
      }),
    );
    const table = write(big, "--characteristic", "fan-level", "--write", "table");
    expect(code(table)).toBe("payload-too-large");
    expect(table.json.errors[0].message).toMatch(/20 bytes at MTU 23/);
    expect(events("write")).toEqual([]);
  });
});

describe("release and report", { timeout: 60_000 }, () => {
  it("confirms the release once the system drops the link, disconnects on Linux and reports a held link on Windows", async () => {
    await setBench({ bench: { connected: [ADDRESS], dropAfter: 1 } });
    const dropped = bt(["release", ...device]);
    expect(dropped.code, dropped.stdout).toBe(0);
    expect(dropped.json.lifecycle.physical).toBe("confirmed");
    await rm(paths().state, { force: true });
    await setBench({ bench: { connected: [ADDRESS], backend: "bluez_dbus" } });
    const linux = bt(["release", ...device]);
    expect(linux.code, linux.stdout).toBe(0);
    expect(events("disconnect")).toHaveLength(1);
    await rm(paths().state, { force: true });
    await setBench({ bench: { connected: [ADDRESS] } });
    const held = bt(["release", ...device]);
    expect(held.code).toBe(3);
    expect(held.json).toMatchObject({
      errors: [{ code: "held-by-system" }],
      lifecycle: { physical: "unknown" },
    });
    expect(events("connect")).toHaveLength(1);
  });

  it("summarizes run folders and refuses a folder without a result or an existing run id", async () => {
    const file = await profile("p.json");
    const first = bt(["identify", ...device, "--profile", file, "--run-id", "one"]);
    expect(first.json.resultPath).toBe("arduino-iot-results/one/result.json");
    expect(readFileSync(join(root, "arduino-iot-results", "one", "report.md"), "utf8")).toMatch(
      /identity confirmed/,
    );
    expect(code(bt(["identify", ...device, "--profile", file, "--run-id", "one"]))).toBe("run-exists");
    const summary = bt(["report", "--run", "arduino-iot-results/one"]);
    expect(summary.code).toBe(0);
    expect(summary.json.runs).toEqual([
      expect.objectContaining({
        path: "arduino-iot-results/one",
        operation: "identify",
        status: "pass",
        device: "thermo",
        physical: "confirmed",
      }),
    ]);
    await mkdir(join(root, "empty"));
    expect(code(bt(["report", "--run", "empty"]))).toBe("run-invalid");
    expect(code(bt(["identify", ...device, "--profile", file, "--results-dir", ".vera/x"]))).toBe("path");
  });
});

describe("the runner reserves and supervises the device", { timeout: 60_000 }, () => {
  const program = () => manifest().programs["ble-tool"] as NonNullable<PluginManifest["programs"][string]>;
  const leaseFolder = () => join(root, "leases");
  const runner = () =>
    new core.ProgramRunner({
      host: new core.NodeProcessHost(spawn),
      clock: { sleep },
      leases: new core.ResourceLeases({ root: leaseFolder(), app: "test" }),
    });
  async function request(args: string[], actuates: boolean, timeoutMs?: number): Promise<core.RunRequest> {
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
        claims: claimed.resources.map((resource) => ({ ...resource, actuates })),
        graceMs: 5000,
        cleanup: { args: [script, "release", "--device", "thermo"], timeoutMs: 30_000 },
      },
    };
  }

  it("keys the device by its address and makes a second run BUSY in this and another process", async () => {
    const file = await profile("p.json");
    const claimed = await core.claimedResources(root, program(), ["identify", "--device", "thermo"]);
    expect(claimed?.resources[0]).toMatchObject({
      alias: "thermo",
      kind: "ble-device",
      resource: ADDRESS,
      keys: ["ble:c4:7f:51:00:12:34"],
    });
    const first = runner();
    const run = await first.start(
      await request(
        [
          "subscribe-notifications",
          ...device,
          "--profile",
          file,
          "--characteristic",
          "temperature",
          "--duration",
          "3",
        ],
        false,
      ),
    );
    await expect(
      first.start(await request(["identify", ...device, "--profile", file], false)),
    ).rejects.toMatchObject({ code: "BUSY" });
    await expect(
      runner().start(await request(["identify", ...device, "--profile", file], false)),
    ).rejects.toMatchObject({ code: "BUSY" });
    const result = await run.done;
    expect(result).toMatchObject({ exitCode: 0, cleanup: "none" });
    const after = await runner().start(await request(["identify", ...device, "--profile", file], false));
    expect((await after.done).exitCode).toBe(0);
  });

  it("runs the release cleanup after a timeout kills a write stuck on the link", async () => {
    await setBench({ fan: { writeHang: true }, bench: { linkDropS: 1 } });
    const file = await profile(
      "slow.json",
      benchProfile((p) => (p.limits.operationTimeoutS = 30)),
    );
    const run = await runner().start(
      await request(
        [
          "write-characteristic",
          ...device,
          "--profile",
          file,
          "--characteristic",
          "fan-level",
          "--write",
          "off",
        ],
        true,
        2500,
      ),
    );
    const result = await run.done;
    expect(result.timedOut).toBe(true);
    expect(result).toMatchObject({ physical: "confirmed", cleanup: "separate" });
    expect(events("get_connected").length).toBeGreaterThan(0);
  });
});

const realPython = process.env.VERA_TEST_BLE_PYTHON;
describe.skipIf(!realPython)("this computer's Bluetooth adapter (hardware evidence, scan only)", () => {
  it("scans passively through the pinned Bleak's own backend", () => {
    const { PYTHONPATH: _p, VERA_RUN_CONTROL: _a, ...rest } = process.env;
    const result = spawnSync(
      realPython as string,
      [script, "scan", "--duration", "5", ...(windows ? [] : ["--active"])],
      {
        cwd: root,
        env: { ...rest, BLE_REGISTRY: paths().registry, PYTHONDONTWRITEBYTECODE: "1" },
        encoding: "utf8",
        timeout: 60_000,
      },
    );
    const json = JSON.parse(result.stdout);
    expect(json.status, result.stdout).toBe("pass");
    expect(json.scan.backend).toBe(windows ? "win_rt" : "bluez_dbus");
    expect(json.scan).toMatchObject({ mode: windows ? "passive" : "active", endedBy: "duration" });
  }, 60_000);
});
