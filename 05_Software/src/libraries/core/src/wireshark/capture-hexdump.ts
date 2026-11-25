import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CaptureReference,
  type DeriveCaptureArgs,
  type HexdumpProfile,
  hexdumpImportLimits,
} from "@vera/shared";
import type { ProgramHost } from "../plugins/program-tools.js";
import type { LoadedPlugin } from "../plugins/store.js";
import { type ToolContext, toolLimit } from "../tools/context.js";
import { indexCapture } from "./capture-file-index.js";
import { CaptureFileNative, fileProgramsFor, resolveFilePrograms } from "./capture-files-native.js";
import { parseHexdump, text2pcapInput } from "./hexdump-parser.js";
import { CaptureError } from "./native.js";
import { publishCaptures, snapshotHexdump } from "./storage.js";

type Encapsulation = HexdumpProfile["encapsulation"];
type Args = Extract<DeriveCaptureArgs, { operation: "import_hexdump" }>;

const sourceAddress = Buffer.from([192, 0, 2, 1]);
const destinationAddress = Buffer.from([192, 0, 2, 2]);
const udpHeaderBytes = 42;
const sectionHeader = 0x0a0d0d0a;
const interfaceDescription = 1;
const enhancedPacket = 6;
const text2pcapBlocks = new Set([sectionHeader, interfaceDescription, enhancedPacket]);
const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const invalidOutput = () =>
  new CaptureError(
    "hexdump_output_invalid",
    "Text2pcap output disagrees with the hexdump profile. Check the installed Wireshark utilities.",
  );

function encapsulationArgs(encapsulation: Encapsulation) {
  if (encapsulation.kind !== "udp_ipv4") return ["-l", encapsulation.kind === "ethernet" ? "1" : "147"];
  return [
    "-l",
    "1",
    "-u",
    `${encapsulation.sourcePort},${encapsulation.destinationPort}`,
    "-4",
    `${sourceAddress.join(".")},${destinationAddress.join(".")}`,
  ];
}

function matchesFrame(frame: Buffer, source: Buffer, encapsulation: Encapsulation) {
  if (encapsulation.kind !== "udp_ipv4") return frame.equals(source);
  const payloadEnd = udpHeaderBytes + source.length;
  return (
    frame.length === Math.max(60, payloadEnd) &&
    frame.readUInt16BE(12) === 0x0800 &&
    frame[14] === 0x45 &&
    frame.readUInt16BE(16) === 28 + source.length &&
    frame[23] === 17 &&
    frame.subarray(26, 30).equals(sourceAddress) &&
    frame.subarray(30, 34).equals(destinationAddress) &&
    frame.readUInt16BE(34) === encapsulation.sourcePort &&
    frame.readUInt16BE(36) === encapsulation.destinationPort &&
    frame.readUInt16BE(38) === 8 + source.length &&
    frame.subarray(udpHeaderBytes, payloadEnd).equals(source) &&
    frame.subarray(payloadEnd).every((byte) => byte === 0)
  );
}

function verifyOutput(
  bytes: Buffer,
  packets: ReturnType<typeof parseHexdump>,
  encapsulation: Encapsulation,
  signal: AbortSignal,
) {
  try {
    const audit = indexCapture(bytes, "pcapng", signal, {
      allowedPcapngBlocks: text2pcapBlocks,
      visitPacket(number, data, wire, time) {
        const packet = packets[number - 1];
        if (
          !packet ||
          wire !== data.length ||
          time !== packet.time ||
          !matchesFrame(data, packet.data, encapsulation)
        )
          throw invalidOutput();
      },
    });
    const linkType = encapsulation.kind === "user0" ? 147 : 1;
    if (
      audit.packets.length !== packets.length ||
      audit.interfaces.length !== 1 ||
      audit.interfaces[0]?.linkType !== linkType ||
      audit.subnanosecond !== 0
    )
      throw invalidOutput();
  } catch {
    signal.throwIfAborted();
    throw invalidOutput();
  }
}

/** Convert one bounded saved hexdump and publish only a verified binary and its provenance. */
export async function importHexdump(
  ctx: ToolContext,
  args: Args,
  host: ProgramHost,
  plugin: LoadedPlugin,
  folder: string,
  signal: AbortSignal,
  authorize: () => Promise<unknown>,
) {
  const access = ctx.artifacts;
  const readOnly = () =>
    new CaptureError("storage_read_only", "Use a writable workbench and session to import hexdumps.");
  if (!access) throw readOnly();
  const assertWritable = () => {
    if (ctx.permissionMode?.() === "read-only") throw readOnly();
    try {
      access.assertWritable();
    } catch {
      throw readOnly();
    }
  };
  assertWritable();
  const programs = await resolveFilePrograms(host, plugin, fileProgramsFor(args), signal);
  const native = new CaptureFileNative(
    host.runner,
    programs,
    folder,
    signal,
    hexdumpImportLimits.outputBytes,
  );
  const { version } = native.require("text2pcap");

  const snapshot = join(folder, "source.hex");
  const source = await snapshotHexdump(ctx, args.path, snapshot, signal);
  const input = await readFile(snapshot, { signal });
  if (input.length !== source.bytes || sha256(input) !== source.sha256)
    throw new CaptureError("hexdump_changed", "The hexdump snapshot changed. Retry the import.");
  const profile = args.hexdumpProfile;
  const packets = parseHexdump(input, profile, signal);
  const canonicalName = "hex-input.txt";
  await writeFile(join(folder, canonicalName), text2pcapInput(packets, signal), {
    flag: "wx",
    mode: 0o600,
    signal,
  });
  const { bytes, path } = await native.capture("text2pcap", [
    "-q",
    "-F",
    "pcapng",
    "-o",
    "hex",
    "-t",
    "ISO",
    ...encapsulationArgs(profile.encapsulation),
    canonicalName,
    "-",
  ]);
  verifyOutput(bytes, packets, profile.encapsulation, signal);

  const capture: CaptureReference = {
    format: 1,
    source: { kind: "managed" },
    fileFormat: "pcapng",
    bytes: bytes.length,
    sha256: sha256(bytes),
  };
  const synthetic = profile.timestamps === "synthetic";
  const provenance = {
    format: 1,
    source,
    profile,
    tool: { name: "text2pcap", version },
    timestamps: { origin: synthetic ? "synthetic" : "trace", synthetic },
    syntheticHeaders: profile.encapsulation.kind === "udp_ipv4" ? ["ethernet", "ipv4", "udp"] : [],
    capture,
    packets: packets.length,
  };
  const manifestBody = Buffer.from(`${JSON.stringify(provenance, null, 2)}\n`);
  const manifest = { sha256: sha256(manifestBody), bytes: manifestBody.length };
  const result = { operation: "import_hexdump", complete: true, capture, manifest, provenance };
  if (
    manifest.bytes > hexdumpImportLimits.manifestBytes ||
    JSON.stringify(result).length > toolLimit(ctx, "toolResultChars")
  )
    throw new CaptureError("result_limit", "Increase the tool result limit before importing this hexdump.");
  const manifestPath = join(folder, "provenance.json");
  await writeFile(manifestPath, manifestBody, { flag: "wx", mode: 0o600, signal });
  await publishCaptures(
    ctx.root,
    { queue: access.queue, assertWritable },
    [{ input: path, reference: capture }],
    signal,
    authorize,
    {
      provenance: { input: manifestPath, reference: manifest },
    },
  );
  return result;
}
