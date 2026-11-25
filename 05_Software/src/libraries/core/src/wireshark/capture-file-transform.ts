import { createHash } from "node:crypto";
import { basename } from "node:path";
import {
  type CaptureAnalysis,
  type CaptureReference,
  captureFileLimits,
  captureLimits,
  type DeriveCaptureArgs,
} from "@vera/shared";
import { type CaptureFileIndex, type IndexedPacket, indexCapture, parseEpoch } from "./capture-file-index.js";
import type { CaptureLineageRange } from "./capture-file-lineage.js";
import { type CaptureFileNative, cleanOptions } from "./capture-files-native.js";
import { CaptureError, type OfflineTshark } from "./native.js";

export type CaptureFileInput = { path: string; reference: CaptureReference; index: CaptureFileIndex };
type Transform = Exclude<
  DeriveCaptureArgs,
  { operation: "export_fields" | "export_objects" | "export_pdus" }
>;
type Format = CaptureReference["fileFormat"];
type Ancestry = { source: number; packet: IndexedPacket };

const mismatch = () =>
  new CaptureError(
    "derived_verification_failed",
    "Native output did not preserve the expected packets, order or metadata.",
  );
const splitLimit = () =>
  new CaptureError(
    "capture_part_limit",
    "The split needs more parts than the host allows. Use a larger interval or count.",
  );

function requireTimes(packets: IndexedPacket[]) {
  if (packets.some(({ time, subnanosecond }) => time === null || subnanosecond))
    throw new CaptureError(
      "capture_time_unavailable",
      "This operation requires a nanosecond-resolvable timestamp for every packet.",
    );
}

export function refuseEmbeddedSecrets(input: CaptureFileInput) {
  if (input.index.metadata.secrets)
    throw new CaptureError(
      "capture_embedded_secrets",
      "Clean the embedded decryption secrets before requesting dissection.",
    );
}

function frameRanges(numbers: number[]) {
  const ranges: string[] = [];
  let first = numbers[0];
  if (first === undefined) return [String(captureLimits.scanFrames + 1)];
  let last = first;
  for (const current of numbers.slice(1)) {
    if (current !== last + 1) {
      ranges.push(first === last ? String(first) : `${first}-${last}`);
      first = current;
    }
    last = current;
  }
  ranges.push(first === last ? String(first) : `${first}-${last}`);
  if (ranges.length > captureFileLimits.selectionRanges)
    throw new CaptureError(
      "capture_selection_limit",
      "This sparse selection has too many frame ranges. Narrow the selection.",
    );
  return ranges;
}

async function selected(
  args: Extract<Transform, { operation: "select" }>,
  input: CaptureFileInput,
  tshark: () => { native: OfflineTshark; analysis: CaptureAnalysis },
) {
  const { selection } = args;
  const { packets } = input.index;
  switch (selection.kind) {
    case "frames": {
      const included = new Set<number>();
      for (const { first, last } of selection.ranges) {
        if (last > packets.length)
          throw new CaptureError("frame_not_found", "The requested frame is absent from the saved capture.");
        for (let n = first; n <= last; n++) included.add(n);
      }
      return packets.filter(({ number }) => included.has(number));
    }
    case "filter": {
      refuseEmbeddedSecrets(input);
      const { native, analysis } = tshark();
      await native.validate(analysis);
      const numbers = await native.numbers(input.path, analysis, captureLimits.scanFrames, selection.filter);
      if (numbers.some((number) => number > packets.length)) throw mismatch();
      const included = new Set(numbers);
      return packets.filter(({ number }) => included.has(number));
    }
    case "time": {
      requireTimes(packets);
      const from = parseEpoch(selection.from);
      const until = parseEpoch(selection.until);
      if (until <= from)
        throw new CaptureError("capture_time_range", "Use an end timestamp after the start.");
      return packets.filter(({ time }) => time !== null && time >= from && time < until);
    }
  }
}

function partitions(packets: IndexedPacket[], by: Extract<Transform, { operation: "split" }>["by"]) {
  if (!packets.length) return [[]];
  const parts: IndexedPacket[][] = [];
  let current: IndexedPacket[] = [];
  let start: bigint | null = null;
  const duration = by.kind === "time" ? parseEpoch(by.seconds) : null;
  if (duration !== null) {
    requireTimes(packets);
    if (!isChronological(packets))
      throw new CaptureError("capture_unsorted", "Reorder the source before splitting it by time.");
  }
  for (const packet of packets) {
    if (
      by.kind === "count"
        ? current.length === by.packets
        : start !== null && duration !== null && packet.time !== null && packet.time >= start + duration
    ) {
      parts.push(current);
      if (parts.length === captureFileLimits.parts) throw splitLimit();
      current = [];
    }
    if (!current.length) start = packet.time;
    current.push(packet);
  }
  parts.push(current);
  return parts;
}

function isChronological(packets: IndexedPacket[]) {
  return packets.every(({ time }, i) => {
    const previous = packets[i - 1]?.time;
    return time === null || previous == null || time >= previous;
  });
}

function deduplicate(packets: IndexedPacket[], window: number) {
  const seen = new Map<string, number>();
  return packets.filter(({ number, dataHash }) => {
    const previous = seen.get(dataHash);
    seen.set(dataHash, number);
    return previous === undefined || number - previous >= window;
  });
}

function lineage(mapping: (Ancestry | null)[]) {
  const ranges: CaptureLineageRange[] = [];
  let ambiguous = 0;
  for (const [index, origin] of mapping.entries()) {
    if (!origin) {
      ambiguous++;
      continue;
    }
    const previous = ranges.at(-1);
    if (
      previous &&
      previous[0] + previous[3] === index + 1 &&
      previous[1] === origin.source &&
      previous[2] + previous[3] === origin.packet.number
    ) {
      previous[3]++;
    } else ranges.push([index + 1, origin.source, origin.packet.number, 1]);
  }
  return {
    ranges,
    rangeCount: ranges.length,
    ambiguous,
    mappingSha256: createHash("sha256").update(JSON.stringify(ranges)).digest("hex"),
  };
}

function matchOrdered(actual: IndexedPacket[], expected: Ancestry[], chronological: boolean) {
  if (expected.length !== actual.length) throw mismatch();
  if (!chronological) {
    if (expected.some(({ packet }, index) => actual[index]?.identity !== packet.identity)) throw mismatch();
    return expected;
  }
  if (!isChronological(actual)) throw mismatch();
  const byIdentity = new Map<string, { origin: Ancestry; count: number; used: number }>();
  for (const origin of expected) {
    const entry = byIdentity.get(origin.packet.identity);
    if (entry) entry.count++;
    else byIdentity.set(origin.packet.identity, { origin, count: 1, used: 0 });
  }
  return actual.map(({ identity }) => {
    const entry = byIdentity.get(identity);
    if (!entry || ++entry.used > entry.count) throw mismatch();
    return entry.count > 1 ? null : entry.origin;
  });
}

export function verifiedFile(file: { bytes: Buffer; path: string }, format: Format, signal: AbortSignal) {
  const index = indexCapture(file.bytes, format, signal);
  const reference: CaptureReference = {
    format: 1,
    source: { kind: "managed" },
    fileFormat: format,
    bytes: file.bytes.length,
    sha256: createHash("sha256").update(file.bytes).digest("hex"),
  };
  return { input: file.path, reference, index };
}

function output(
  file: { bytes: Buffer; path: string },
  format: Format,
  native: CaptureFileNative,
  expected: Ancestry[],
  chronological = false,
) {
  const verified = verifiedFile(file, format, native.signal);
  return { ...verified, lineage: lineage(matchOrdered(verified.index.packets, expected, chronological)) };
}

function position(packets: IndexedPacket[], source = 0) {
  return packets.map((packet) => ({ source, packet }));
}

const nativeFormat = (format: Format) => (format === "pcap" ? "nsecpcap" : format);

function edit(
  native: CaptureFileNative,
  input: string,
  format: Format,
  flags: string[] = [],
  ranges: string[] = [],
  intermediate = false,
) {
  return native.capture(
    "editcap",
    [...flags, "-F", nativeFormat(format), basename(input), "-", ...ranges],
    intermediate,
  );
}

async function chronologicalOutput(inputs: CaptureFileInput[], format: Format, native: CaptureFileNative) {
  const runs: { input: CaptureFileInput; frames: IndexedPacket[]; whole: boolean }[] = [];
  for (const input of inputs) {
    const { packets } = input.index;
    requireTimes(packets);
    let start = 0;
    for (const [index, packet] of packets.entries()) {
      const previous = packets[index - 1]?.time;
      if (previous != null && packet.time !== null && previous > packet.time) {
        runs.push({ input, frames: packets.slice(start, index), whole: false });
        if (runs.length >= captureFileLimits.chronologicalRuns)
          throw new CaptureError(
            "capture_order_limit",
            "The input has too many chronological runs. Split it into smaller captures.",
          );
        start = index;
      }
    }
    runs.push({ input, frames: packets.slice(start), whole: start === 0 });
  }
  if (runs.length > captureFileLimits.chronologicalRuns)
    throw new CaptureError(
      "capture_order_limit",
      "The input has too many chronological runs. Split it into smaller captures.",
    );
  if (runs.length === 1 && runs[0]) {
    const { input, frames } = runs[0];
    return output(await edit(native, input.path, format), format, native, position(frames));
  }
  const parts: string[] = [];
  const intermediate: { path: string; size: number }[] = [];
  for (const { input, frames, whole } of runs) {
    if (whole) parts.push(basename(input.path));
    else {
      const piece = await edit(
        native,
        input.path,
        "pcapng",
        ["-r"],
        frameRanges(frames.map(({ number }) => number)),
        true,
      );
      output(piece, "pcapng", native, position(frames));
      parts.push(basename(piece.path));
      intermediate.push({ path: piece.path, size: piece.bytes.length });
    }
  }
  const file = await native.capture("mergecap", [
    "-F",
    nativeFormat(format),
    "-I",
    "none",
    "-w",
    "-",
    ...parts,
  ]);
  await native.discardIntermediate(intermediate);
  return output(
    file,
    format,
    native,
    inputs.flatMap(({ index }, i) => position(index.packets, i)),
    true,
  );
}

export async function transformCapture(
  args: Transform,
  inputs: CaptureFileInput[],
  native: CaptureFileNative,
  tshark: () => { native: OfflineTshark; analysis: CaptureAnalysis },
) {
  const input = inputs[0];
  if (!input) throw mismatch();
  const format = ("outputFormat" in args ? args.outputFormat : undefined) ?? "pcapng";
  if (
    format === "pcap" &&
    new Set(inputs.flatMap(({ index }) => index.interfaces.map(({ linkType }) => linkType))).size > 1
  )
    throw new CaptureError(
      "capture_incompatible",
      "Classic PCAP needs one link type. Use PCAPNG for these inputs.",
    );
  const path = input.path;
  const packets = input.index.packets;
  if (args.operation === "merge" || args.operation === "reorder")
    return { files: [await chronologicalOutput(inputs, format, native)] };
  if (args.operation === "split") {
    const files: ReturnType<typeof output>[] = [];
    for (const part of partitions(packets, args.by)) {
      const file = await edit(native, path, format, ["-r"], frameRanges(part.map(({ number }) => number)));
      files.push(output(file, format, native, position(part)));
    }
    return { files };
  }
  if (args.operation === "select") {
    const chosen = await selected(args, input, tshark);
    const file = await edit(native, path, format, ["-r"], frameRanges(chosen.map(({ number }) => number)));
    return { files: [output(file, format, native, position(chosen))] };
  }
  if (args.operation === "clean") {
    if (!(await native.canClean()))
      throw new CaptureError(
        "utility_feature_unavailable",
        "Update Editcap to a version that supports capture cleanup.",
      );
    const verified = output(
      await edit(
        native,
        path,
        format,
        args.remove.map((name) => cleanOptions[name]),
      ),
      format,
      native,
      position(packets),
    );
    if (
      Object.keys(input.index.metadata).some((key) => {
        const name = key as keyof typeof cleanOptions;
        return args.remove.includes(name)
          ? verified.index.metadata[name] !== 0
          : verified.index.metadataSha256[name] !== input.index.metadataSha256[name];
      })
    )
      throw mismatch();
    return {
      files: [verified],
      removed: Object.fromEntries(args.remove.map((name) => [name, input.index.metadata[name]])),
      packetDataAndIdentifiersMayRemain: true,
    };
  }
  const flags = args.operation === "deduplicate" ? ["-D", String(args.window)] : [];
  const expected = args.operation === "deduplicate" ? deduplicate(packets, args.window) : packets;
  return { files: [output(await edit(native, path, format, flags), format, native, position(expected))] };
}
