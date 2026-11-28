import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { classifyCommand, validatePluginManifest } from "@vera/shared";
import { expect, it } from "vitest";
import { parse } from "yaml";
import {
  nativeDumpcapActivity,
  nativeDumpcapInventory,
  proveNativeDumpcap,
} from "../support/dumpcap-native.js";

const plugins = new URL("../../plugins/", import.meta.url);

it("lists Dumpcap as an optional find-only official plugin with raw execution blocked", async () => {
  const result = validatePluginManifest(
    parse(await readFile(new URL("wireshark-dumpcap/plugin.yaml", plugins), "utf8")),
  );
  expect(result.issues).toEqual([]);
  const manifest = result.manifest;
  if (!manifest) throw Error("Invalid manifest");
  expect(manifest.programs.dumpcap?.install).toMatchObject({
    find: {
      windows: ["%PATH%", "%ProgramFiles%/Wireshark/dumpcap.exe"],
      linux: ["$PATH", "/usr/bin/dumpcap"],
    },
  });
  for (const args of [[], ["--version"], ["-i", "-"], ["-i", "rpcap://remote/eth0"]]) {
    expect(classifyCommand(manifest.rules, "dumpcap", args).risk).toBe("blocked");
  }
  const catalog = parse(await readFile(new URL("catalog.yaml", plugins), "utf8"));
  expect(catalog.official).toContain("wireshark-dumpcap");
  const packs = parse(await readFile(new URL("packs.yaml", plugins), "utf8"));
  expect(packs.find((pack: { id: string }) => pack.id === "wireshark")?.groups).toContainEqual({
    name: "Local capture",
    plugins: ["wireshark-dumpcap"],
    default: false,
  });
});

const dumpcap = process.env.VERA_DUMPCAP_TEST_BINARY;
const tshark = process.env.VERA_DUMPCAP_TEST_TSHARK;
const interfaceId = process.env.VERA_DUMPCAP_TEST_INTERFACE;

it.skipIf(!dumpcap)("probes the installed Dumpcap without opening a capture", async () => {
  if (!dumpcap) throw Error("Dumpcap path required");
  const result = await nativeDumpcapInventory({ pluginRoot: fileURLToPath(plugins), dumpcap });
  if (process.env.VERA_DUMPCAP_TEST_NPCAP_MISSING === "1")
    expect(result).toMatchObject({ reason: "npcap_missing" });
  else {
    expect(result.version).toMatch(/^\d+\.\d+\.\d+$/);
    if (process.platform === "win32")
      expect(result.interfaces).toEqual(
        expect.arrayContaining([expect.objectContaining({ id: "\\Device\\NPF_Loopback", loopback: true })]),
      );
  }
});

it.skipIf(!dumpcap || process.env.VERA_DUMPCAP_TEST_NPCAP_MISSING === "1")(
  "counts the packets each interface sees with the installed Dumpcap",
  { timeout: 20_000 },
  async () => {
    if (!dumpcap) throw Error("Dumpcap path required");
    const result = await nativeDumpcapActivity({ pluginRoot: fileURLToPath(plugins), dumpcap });
    expect(result).toMatchObject({ tool: "dumpcap", seconds: 2 });
    const rows = (result as { interfaces: { id: string; packets: number | null }[] }).interfaces;
    expect(rows.length).toBeGreaterThan(0);
    // Every interface dumpcap lists is counted, busiest first.
    expect(rows.every((row) => typeof row.packets === "number")).toBe(true);
    expect(rows.map((row) => row.packets)).toEqual(
      [...rows.map((row) => row.packets as number)].sort((a, b) => b - a),
    );
  },
);

it.skipIf(!dumpcap || !tshark || !interfaceId)(
  "publishes real short and rolling UDP captures on isolated loopback",
  { timeout: 35_000 },
  async () => {
    if (!dumpcap || !tshark || !interfaceId) throw Error("Native loopback test configuration required");
    const evidenceDir = process.env.VERA_DUMPCAP_TEST_EVIDENCE;
    const proof = await proveNativeDumpcap({
      pluginRoot: fileURLToPath(plugins),
      dumpcap,
      tshark,
      interfaceId,
      ...(evidenceDir ? { evidenceDir } : {}),
    });
    console.log(JSON.stringify(proof));
  },
);
