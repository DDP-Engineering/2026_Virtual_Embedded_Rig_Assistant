import { readFileSync } from "node:fs";
import { classifyCommand, validatePluginManifest } from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";

const audited: Record<string, Record<string, string[]>> = {
  "arduino-cli": {
    "arduino-tool": ["install", "upload"],
  },
  "ble-tools": {
    "ble-tool": ["read-characteristic", "subscribe-notifications", "write-characteristic", "release"],
  },
  "bus-tools": {
    "bus-tool": ["configure-bus", "read-register", "transfer", "capture", "release"],
  },
  "can-python": {
    can: ["capture", "send", "replay"],
  },
  circuitpython: {
    "circuitpython-tool": ["capture-output", "prepare-libraries", "deploy"],
  },
  "esp32-efuse": {
    espefuse: [
      "burn-efuse",
      "burn-key",
      "burn-block-data",
      "burn-bit",
      "burn-custom-mac",
      "write-protect-efuse",
      "read-protect-efuse",
      "set-flash-voltage",
    ],
  },
  "esp32-esptool": {
    esptool: ["write-flash", "erase-flash", "erase-region", "load-ram", "write-mem", "write-flash-status"],
  },
  micropython: {
    "micropython-tool": ["deploy-file", "run-file"],
  },
  "mqtt-tools": {
    "mqtt-tool": ["publish", "request"],
  },
  platformio: {
    platformio: ["build", "test-host", "test-device", "clean", "prepare-packages"],
    "platformio-upload": ["upload"],
  },
  "power-profiler": {
    "power-profile": ["capture", "release"],
  },
  "probe-rs": {
    "probe-rs": ["download", "run", "erase", "benchmark", "itm", "write"],
  },
  "raspberry-pi-linux": {
    "pi-tool": [
      "install-helper",
      "deploy-candidate",
      "apply-candidate",
      "run-task",
      "service-start",
      "service-stop",
      "stop-owned",
    ],
  },
  "serial-monitor": {
    serial: ["send"],
  },
  wokwi: {
    "wokwi-tool": ["run-scenario"],
  },
  zephyr: {
    zephyr: ["build", "test-build", "clean", "prepare-workspace"],
    "zephyr-flash": ["flash"],
  },
};

it.each(Object.entries(audited))(
  "keeps %s subcommand help exact and ordinary operation risk intact (REQ-SEC-0beca242)",
  (id, expected) => {
    const path = new URL(`../../plugins/${id}/plugin.yaml`, import.meta.url);
    const { manifest, issues } = validatePluginManifest(parse(readFileSync(path, "utf8")));
    expect(issues).toEqual([]);
    if (!manifest) throw Error(`Invalid manifest: ${id}`);
    for (const [program, declared] of Object.entries(manifest.programs)) {
      const commands = expected[program];
      const help = commands ? { flag: "--help", commands } : undefined;
      expect(declared.subcommandHelp).toEqual(help);
      if (!declared.subcommandHelp) continue;
      const ordinary = (args: string[]) =>
        classifyCommand(manifest.rules, program, args, declared.optionSyntax);
      const classify = (args: string[]) =>
        classifyCommand(manifest.rules, program, args, declared.optionSyntax, declared.subcommandHelp);
      for (const command of declared.subcommandHelp.commands) {
        expect(ordinary([command, "--help"]).risk, command).not.toBe("safe");
        expect(classify([command, "--help"]), command).toEqual({
          risk: "safe",
          notes: [],
          confirm: null,
          timeout: null,
        });
        for (const args of [[command], [command, "--help", "--extra"], [command, "--help=1"]])
          expect(classify(args), args.join(" ")).toEqual(ordinary(args));
      }
    }
  },
);
