import { describe, expect, it } from "vitest";
import {
  type LabResource,
  labRegistrySchema,
  labResourceKeys,
  serialPortKey,
  visaResourceKeys,
} from "./lab-resources.js";
import { validatePluginManifest } from "./plugins.js";
import { programApprovalSchema } from "./program-rules.js";

const entry = (fields: Record<string, unknown> = {}) => ({
  alias: "psu",
  kind: "visa",
  resource: "USB0::0x1AB1::0x0E11::DP8C123456::INSTR",
  profile: "rigol-dp800",
  ...fields,
});

describe("lab/resources.json", () => {
  it("accepts a format 1 registry with identity and plugin fields", () => {
    const parsed = labRegistrySchema.parse({
      format: 1,
      resources: [
        entry({
          serial: "DP8C123456",
          backend: "py",
          limits: { CH1: { voltage: 5.5, current: 0.5 } },
          note: "DUT",
        }),
        entry({
          alias: "scope",
          resource: "TCPIP0::10.0.0.5::INSTR",
          profile: "rigol-ds1000z",
          backend: "ivi",
        }),
      ],
    });
    expect(parsed.resources.map((resource) => resource.alias)).toEqual(["psu", "scope"]);
  });

  it("refuses unknown keys, duplicate aliases, unknown kinds, bad resources and limits", () => {
    const bad = [
      { format: 2, resources: [entry()] },
      { format: 1, resources: [] },
      { format: 1, resources: [entry(), entry()] },
      { format: 1, resources: [entry({ alias: "PSU" })] },
      { format: 1, resources: [entry({ kind: "nic" })] },
      { format: 1, resources: [entry({ command: "OUTP ON" })] },
      { format: 1, resources: [entry({ resource: "PXI0::1::INSTR" })] },
      { format: 1, resources: [entry({ resource: "USB0::0x1AB1::0x0E11::INSTR" })] },
      { format: 1, resources: [entry({ limits: { CH1: { voltage: -1 } } })] },
      { format: 1, resources: [entry({ limits: { CH1: { voltage: Number.POSITIVE_INFINITY } } })] },
      { format: 1, resources: [entry({ backend: "sim" })] },
      { format: 1, resources: [entry({ serial: "with space\u0007" })] },
      { format: 1, resources: [entry()], extra: true },
    ];
    for (const value of bad)
      expect(labRegistrySchema.safeParse(value).success, JSON.stringify(value)).toBe(false);
  });
});

// REQ-DATA-9fe47866 REQ-FUNC-4dadea40
describe("bus-adapter entries", () => {
  const adapter = (fields: Record<string, unknown> = {}) => ({
    alias: "bp",
    kind: "bus-adapter",
    backend: "bus-pirate-bpio2",
    resource: "COM35",
    terminal: "COM34",
    identity: "usb:1209:7331:BP5X0001",
    ...fields,
  });
  it("accepts a bus adapter beside a VISA instrument", () => {
    const parsed = labRegistrySchema.parse({
      format: 1,
      resources: [
        entry(),
        adapter({ power: { maxMv: 3300, maxMa: 100 }, note: "bench Bus Pirate" }),
        adapter({ alias: "bp-linux", resource: "/dev/ttyACM1", terminal: "/dev/ttyACM0" }),
      ],
    });
    expect(parsed.resources.map((resource) => resource.kind)).toEqual(["visa", "bus-adapter", "bus-adapter"]);
  });
  it("refuses a bus adapter with a shared port, a bad identity, power or key", () => {
    const bad = [
      adapter({ terminal: "COM35" }),
      adapter({ terminal: "com35" }),
      adapter({ resource: "USB0::0x1AB1::0x0E11::A::INSTR" }),
      adapter({ identity: "usb:1209:7331" }),
      adapter({ identity: "serial:COM35" }),
      adapter({ power: { maxMv: 6000, maxMa: 100 } }),
      adapter({ power: { maxMv: 3300, maxMa: 0 } }),
      adapter({ power: { maxMv: 3300.5, maxMa: 10 } }),
      adapter({ backend: "ft232h" }),
      adapter({ profile: "rigol-dp800" }),
      adapter({ terminal: undefined }),
    ];
    for (const value of bad)
      expect(
        labRegistrySchema.safeParse({ format: 1, resources: [value] }).success,
        JSON.stringify(value),
      ).toBe(false);
  });
  it("keys a bus adapter by both ports and its USB identity", () => {
    expect(labResourceKeys(adapter({ resource: "com35", terminal: "COM34" }) as never)).toEqual([
      "serial:COM35",
      "serial:COM34",
      "usb:1209:7331:bp5x0001",
    ]);
    expect(labResourceKeys(adapter({ resource: "/dev/ttyACM1", terminal: "/dev/ttyACM0" }) as never)).toEqual(
      ["serial:/dev/ttyACM1", "serial:/dev/ttyACM0", "usb:1209:7331:bp5x0001"],
    );
    expect(serialPortKey("COM34")).toBe("serial:COM34");
  });
});

// REQ-DATA-bc2b27d1
describe("ble-device entries", () => {
  const device = (fields: Record<string, unknown> = {}) => ({
    alias: "thermo",
    kind: "ble-device",
    address: "C4:7F:51:00:12:34",
    addressType: "public",
    profile: "bench-thermometer",
    ...fields,
  });
  it("accepts BLE devices beside a VISA instrument and keys them by address", () => {
    const parsed = labRegistrySchema.parse({
      format: 1,
      resources: [
        entry(),
        device({ serial: "TH-0042", note: "bench sensor" }),
        device({ alias: "tag", address: "d1:22:33:44:55:66", addressType: "random", adapter: "hci1" }),
      ],
    });
    expect(parsed.resources.map((resource) => resource.kind)).toEqual(["visa", "ble-device", "ble-device"]);
    expect(labResourceKeys(parsed.resources[1] as never)).toEqual(["ble:c4:7f:51:00:12:34"]);
    expect(labResourceKeys(parsed.resources[2] as never)).toEqual(["ble:d1:22:33:44:55:66"]);
  });
  it("refuses private random addresses, malformed fields and unknown keys", () => {
    const bad = [
      device({ address: "C4:7F:51:00:12" }),
      device({ address: "C4-7F-51-00-12-34" }),
      device({ address: "51:22:33:44:55:66", addressType: "random" }),
      device({ address: "11:22:33:44:55:66", addressType: "random" }),
      device({ addressType: "static" }),
      device({ profile: "Bench" }),
      device({ adapter: "hci100" }),
      device({ adapter: "usb0" }),
      device({ serial: "" }),
      device({ resource: "COM3" }),
      device({ profile: undefined }),
    ];
    for (const value of bad)
      expect(
        labRegistrySchema.safeParse({ format: 1, resources: [value] }).success,
        JSON.stringify(value),
      ).toBe(false);
  });
});

describe("linux-board entries (REQ-DATA-6c8b61c9)", () => {
  const FP = "SHA256:poL9IyoPcWFvRhSsEZrF7kHtkUwKG1XT7/5iI+t95OQ";
  const board = (fields: Record<string, unknown> = {}) => ({
    alias: "pi",
    kind: "linux-board",
    host: "Pi.Local",
    port: 22,
    user: "vera",
    hostKeys: [FP],
    identity: { serial: "10000000abcdef01" },
    root: "/home/vera/vera-projects",
    ...fields,
  });
  it("accepts a Raspberry Pi and keys it by host and port", () => {
    const parsed = labRegistrySchema.parse({
      format: 1,
      resources: [
        entry(),
        board({ agentKey: FP, note: "bench Pi" }),
        board({
          alias: "wsl",
          host: "127.0.0.1",
          port: 2222,
          hostKeys: [],
          identity: {
            machineId: "bc0b1006b5a746f78ab732682c62598c",
            model: "Raspberry Pi 5 Model B Rev 1.0",
          },
        }),
      ],
    });
    expect(labResourceKeys(parsed.resources[1] as never)).toEqual(["ssh:pi.local:22"]);
    expect(labResourceKeys(parsed.resources[2] as never)).toEqual(["ssh:127.0.0.1:2222"]);
  });
  it("refuses root, unsafe roots, malformed fingerprints, a missing identity and unknown keys", () => {
    const bad = [
      board({ user: "root" }),
      board({ user: "Vera" }),
      board({ root: "relative/path" }),
      board({ root: "/home/vera/../etc" }),
      board({ root: "/home/vera/./x" }),
      board({ root: "/" }),
      board({ root: "/srv" }),
      board({ root: "/home/vera/with space" }),
      board({ hostKeys: ["poL9IyoPcWFvRhSsEZrF7kHtkUwKG1XT7/5iI+t95OQ"] }),
      board({ hostKeys: [FP, FP, FP, FP, FP] }),
      board({ agentKey: "MD5:aa" }),
      board({ identity: {} }),
      board({ identity: { model: "Raspberry Pi 5" } }),
      board({ identity: { serial: "xyz" } }),
      board({ port: 0 }),
      board({ host: "pi;rm -rf" }),
      board({ password: "secret" }),
    ];
    for (const value of bad)
      expect(
        labRegistrySchema.safeParse({ format: 1, resources: [value] }).success,
        JSON.stringify(value),
      ).toBe(false);
  });
});

describe("VISA identity keys", () => {
  const same = (left: string, right: string) =>
    expect(visaResourceKeys(left)).toEqual(visaResourceKeys(right));
  it("gives spellings of one connection one key", () => {
    same("USB0::0x1AB1::0x0E11::DP8C1::INSTR", "usb::6833::3601::dp8c1::0::INSTR");
    same("USB0::0x1AB1::0x0E11::DP8C1::INSTR", "USB1::0x1ab1::0x0e11::DP8C1::RAW");
    same("TCPIP0::10.0.0.5::inst0::INSTR", "TCPIP::10.0.0.5::5025::SOCKET");
    same("TCPIP0::10.0.0.5::INSTR", "tcpip0::10.0.0.5::hislip0::INSTR");
    same("TCPIP0::Bench-Scope.local::INSTR", "TCPIP0::bench-scope.local::INSTR");
    same("ASRL3::INSTR", "ASRLCOM3::INSTR");
    same("asrl3::instr", "ASRL3::INSTR");
    same("GPIB::5::INSTR", "GPIB0::5::INSTR");
    expect(visaResourceKeys("USB0::0x1AB1::0x0E11::DP8C1::INSTR")).toEqual(["usb:1ab1:0e11:dp8c1"]);
    expect(visaResourceKeys("TCPIP0::[fe80::1]::INSTR")).toEqual(["tcpip:[fe80::1]"]);
    expect(visaResourceKeys("TCPIP0::gw.lan::gpib0,5::INSTR")).toEqual(["tcpip:gw.lan/gpib0,5"]);
    expect(visaResourceKeys("ASRL/dev/ttyUSB0::INSTR")).toEqual(["serial:/dev/ttyUSB0"]);
    expect(visaResourceKeys("GPIB1::7::96::INSTR")).toEqual(["gpib:1:7:96"]);
  });
  it("keeps different devices apart and adds the declared serial number", () => {
    expect(visaResourceKeys("TCPIP0::10.0.0.5::INSTR")).not.toEqual(
      visaResourceKeys("TCPIP0::10.0.0.6::INSTR"),
    );
    expect(visaResourceKeys("USB0::0x1AB1::0x0E11::A::INSTR")).not.toEqual(
      visaResourceKeys("USB0::0x1AB1::0x0E11::B::INSTR"),
    );
    expect(visaResourceKeys("TCPIP0::10.0.0.5::INSTR", "DP8C1")).toEqual([
      "tcpip:10.0.0.5",
      "serial-number:dp8c1",
    ]);
    expect(labResourceKeys(entry({ serial: "DP8C123456" }) as never)).toEqual([
      "usb:1ab1:0e11:dp8c123456",
      "serial-number:dp8c123456",
    ]);
  });
  it("rejects other syntax", () => {
    for (const resource of [
      "PXI0::1::INSTR",
      "USB0::0x1AB1::DP8C1::INSTR",
      "USB0::0xGG::0x0E11::A::INSTR",
      "USB0::70000::1::A::INSTR",
      "TCPIP0::::INSTR",
      "TCPIP0::10.0.0.5::99999::SOCKET",
      "ASRL::INSTR",
      "ASRLCOM::INSTR",
      "GPIB0::31::INSTR",
      "",
      "USB0::0x1AB1::0x0E11::A::INSTR::extra",
    ])
      expect(() => visaResourceKeys(resource), resource).toThrow();
  });
  it("maps serial ports to the key an ASRL instrument uses", () => {
    expect(serialPortKey("COM3")).toBe(visaResourceKeys("ASRL3::INSTR")[0]);
    expect(serialPortKey("/dev/ttyUSB0")).toBe(visaResourceKeys("ASRL/dev/ttyUSB0::INSTR")[0]);
  });
});

describe("debug probes in lab/resources.json (REQ-DATA-ea470ec1)", () => {
  const probe = (fields: Record<string, unknown> = {}) => ({
    alias: "stlink1",
    kind: "probe",
    resource: "0483:374B:066DFF485153826687243634",
    profile: "stm32f4-stlink",
    ...fields,
  });
  it("accepts a probe named by VID:PID:SERIAL beside instruments", () => {
    const parsed = labRegistrySchema.parse({
      format: 1,
      resources: [probe({ note: "NUCLEO-F401RE" }), entry()],
    });
    expect(parsed.resources[0]?.kind).toBe("probe");
  });
  it("keys a probe by VID:PID:SERIAL and VID:PID in lower case, whatever the spelling", () => {
    const keys = labResourceKeys(
      labRegistrySchema.parse({ format: 1, resources: [probe()] }).resources[0] as LabResource,
    );
    expect(keys).toEqual(["probe:0483:374b:066dff485153826687243634", "probe:0483:374b"]);
    const lower = labRegistrySchema.parse({
      format: 1,
      resources: [probe({ resource: "0483:374b:066dff485153826687243634" })],
    }).resources[0] as LabResource;
    expect(labResourceKeys(lower)).toEqual(keys);
  });
  it("refuses a probe without a serial, with a malformed id, a Tcl character or an unknown field", () => {
    for (const bad of [
      probe({ resource: "0483:374b" }),
      probe({ resource: "0483:374b:" }),
      probe({ resource: "483:374b:ABC" }),
      probe({ resource: "0x0483:374b:ABC" }),
      probe({ resource: "0483:374g:ABC" }),
      probe({ resource: "0483:374b:AB C" }),
      probe({ resource: "0483:374b:AB[x]" }),
      probe({ resource: "0483:374b:AB$x" }),
      probe({ resource: "0483:374b:AB;x" }),
      probe({ serial: "ABC" }),
      probe({ profile: "Bad Profile" }),
    ])
      expect(labRegistrySchema.safeParse({ format: 1, resources: [bad] }).success, JSON.stringify(bad)).toBe(
        false,
      );
  });
});

describe("power monitors in lab/resources.json (REQ-DATA-f13cc264)", () => {
  const meter = (fields: Record<string, unknown> = {}) => ({
    alias: "js1",
    kind: "power-monitor",
    resource: "u/js220/000415",
    profile: "joulescope-js220",
    ...fields,
  });
  it("accepts a Joulescope named by its device path beside instruments and probes", () => {
    const parsed = labRegistrySchema.parse({
      format: 1,
      resources: [meter({ note: "DUT supply" }), entry()],
    });
    expect(parsed.resources[0]?.kind).toBe("power-monitor");
  });
  it("keys a meter by model and serial in lower case", () => {
    const keys = labResourceKeys(
      labRegistrySchema.parse({ format: 1, resources: [meter({ resource: "u/js220/00AbC4" })] })
        .resources[0] as LabResource,
    );
    expect(keys).toEqual(["power-monitor:js220:00abc4"]);
  });
  it("refuses another model, a missing serial, odd characters or an unknown field", () => {
    for (const bad of [
      meter({ resource: "u/js110/000415" }),
      meter({ resource: "u/js220/" }),
      meter({ resource: "u/js220/00 41" }),
      meter({ resource: "u/js220/00/41" }),
      meter({ resource: "js220/000415" }),
      meter({ resource: "u/js220/000415000415000415000415000415000" }),
      meter({ serial: "000415" }),
      meter({ profile: "Bad Profile" }),
    ])
      expect(labRegistrySchema.safeParse({ format: 1, resources: [bad] }).success, JSON.stringify(bad)).toBe(
        false,
      );
  });
});

describe("manifest resources and approvals", () => {
  const manifest = (resources: unknown) => ({
    format: 1,
    id: "lab",
    version: "1.0.0",
    name: "Lab",
    description: "Lab plugin.",
    ecosystem: "lab",
    platforms: ["windows-x64"],
    programs: {
      scpi: {
        install: { script: "scripts/scpi.py" },
        version: { args: ["--version"], match: "(\\d+)" },
        resources,
      },
    },
  });
  it("accepts a program that claims registry aliases", () => {
    const resources = {
      option: "--instrument",
      kinds: ["visa"],
      grace: 10,
      cleanup: ["close"],
      cleanupTimeout: 60,
    };
    expect(validatePluginManifest(manifest(resources)).issues).toEqual([]);
  });
  it("refuses malformed declarations with field paths", () => {
    for (const resources of [
      { option: "instrument", kinds: ["visa"], grace: 10, cleanup: ["close"], cleanupTimeout: 60 },
      { option: "--instrument", kinds: [], grace: 10, cleanup: ["close"], cleanupTimeout: 60 },
      { option: "--instrument", kinds: ["nic"], grace: 10, cleanup: ["close"], cleanupTimeout: 60 },
      { option: "--instrument", kinds: ["visa", "visa"], grace: 10, cleanup: ["close"], cleanupTimeout: 60 },
      { option: "--instrument", kinds: ["visa"], grace: 0, cleanup: ["close"], cleanupTimeout: 60 },
      { option: "--instrument", kinds: ["visa"], grace: 10, cleanup: [], cleanupTimeout: 60 },
      { option: "--instrument", kinds: ["visa"], grace: 10, cleanup: ["close"], cleanupTimeout: 301 },
      { option: "--instrument", kinds: ["visa"], grace: 10, cleanup: ["close"] },
    ]) {
      const { issues } = validatePluginManifest(manifest(resources));
      expect(issues.length, JSON.stringify(resources)).toBeGreaterThan(0);
      expect(issues[0]?.path).toMatch(/^programs\.scpi\.resources/);
    }
  });
  it("carries reserved resources and the registry hash in approvals", () => {
    const base = {
      pluginId: "lab",
      trial: false,
      program: "scpi",
      programVersion: "1.0.0",
      executable: "uv",
      args: ["identify", "--instrument", "psu"],
      cwd: ".",
      risk: "device-read",
      confirm: null,
      notes: [],
      files: [],
    } as const;
    const registry = { path: "lab/resources.json", sha256: "a".repeat(64) };
    const resources = [{ alias: "psu", kind: "visa", resource: "USB0::0x1AB1::0x0E11::DP8C1::INSTR" }];
    expect(programApprovalSchema.safeParse({ ...base, resources, registry }).success).toBe(true);
    expect(programApprovalSchema.safeParse(base).success).toBe(true);
    expect(programApprovalSchema.safeParse({ ...base, resources }).success).toBe(false);
  });
});
