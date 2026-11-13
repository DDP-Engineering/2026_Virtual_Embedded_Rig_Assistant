import { describe, expect, it } from "vitest";
import { labRegistrySchema, labResourceKeys, serialPortKey, visaResourceKeys } from "./lab-resources.js";
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
