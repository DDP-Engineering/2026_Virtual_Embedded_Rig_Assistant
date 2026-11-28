import { isIP } from "node:net";
import {
  type CaptureAnalysis,
  type CaptureFrameReference,
  captureFrameReferenceSchema,
  type TrafficTransport,
  trafficLimits,
} from "@vera/shared";
import { z } from "zod";
import { CaptureError, invalidOutput, type OfflineTshark } from "./native.js";

const frameFields = [
  "frame.number",
  "frame.section_number",
  "frame.interface_id",
  "frame.time_epoch",
  "frame.time_relative",
  "frame.len",
  "frame.cap_len",
];
const uint = /^\d{1,10}$/;
const decimal = /^-?\d{1,20}(?:\.\d{1,12})?$/;
const uint32 = z.number().int().min(0).max(4_294_967_295);
const fieldCell = z
  .string()
  .max(4096)
  .regex(/^[a-zA-Z0-9.,:_-]*$/);
const nativeAddress = z
  .string()
  .max(45)
  .refine((address) => isIP(address) > 0);
const endpointPort = z.number().int().min(0).max(65535);
const nativeStack = /^[a-zA-Z0-9_.-]+(?::[a-zA-Z0-9_.-]+)*$/;
const base64Line = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export type TrafficFact = {
  frame: CaptureFrameReference;
  section: number | null;
  relative: bigint | null;
  wireBytes: number;
  capturedBytes: number;
  get(field: string): string[];
};
export type TrafficAddress = { address: string; port: number | null };
export type NativeFollowRecord =
  | { frame: number; peer: 0 | 1; kind: "data"; bytes: number; data: Buffer }
  | { frame: number; peer: 0 | 1; kind: "gap"; bytes: number | null };
export type NativeFollow = {
  peers: [TrafficAddress | null, TrafficAddress | null];
  records: NativeFollowRecord[];
};

export function nativeUint(value: string | undefined) {
  if (value === undefined || !uint.test(value)) throw invalidOutput();
  const parsed = uint32.safeParse(Number(value));
  if (!parsed.success) throw invalidOutput();
  return parsed.data;
}

/** Parse a native decimal in picoseconds to keep millisecond boundaries exact. */
export function nativeTime(value: string) {
  if (!decimal.test(value)) throw invalidOutput();
  const [seconds, fraction = ""] = value.replace(/^-/, "").split(".");
  const magnitude = BigInt(seconds ?? "") * 1_000_000_000_000n + BigInt(fraction.padEnd(12, "0"));
  return value.startsWith("-") ? -magnitude : magnitude;
}

export function protocolStack(fact: TrafficFact) {
  const [value, ...others] = fact.get("frame.protocols");
  if (!value) return [];
  if (others.length || !nativeStack.test(value)) throw invalidOutput();
  return value.split(":");
}

export async function readTrafficFacts(
  native: OfflineTshark,
  snapshot: string,
  analysis: CaptureAnalysis,
  maxFrames: number,
  fields: string[],
  sha256: string,
) {
  const names = [...new Set([...frameFields, ...fields])];
  const stdout = await native.trafficOutput(
    snapshot,
    analysis,
    maxFrames,
    ["-T", "fields", "-E", "occurrence=a", "-E", "aggregator=,", ...names.flatMap((name) => ["-e", name])],
    trafficLimits.nativeFieldsBytes,
  );
  const lines = stdout ? stdout.trimEnd().split(/\r?\n/) : [];
  if (lines.length > maxFrames) throw invalidOutput();
  return lines.map((line, index): TrafficFact => {
    const cells = line.split("\t");
    // Only the last record can have its trailing empty cells removed by trimEnd().
    if (cells.length > names.length || (index < lines.length - 1 && cells.length !== names.length))
      throw invalidOutput();
    const [frameNo, section, interfaceId, timestamp, relative, wire, captured] = cells;
    if (nativeUint(frameNo) !== index + 1) throw invalidOutput();
    const parsed = captureFrameReferenceSchema.safeParse({
      captureSha256: sha256,
      number: index + 1,
      interfaceId: interfaceId ? nativeUint(interfaceId) : null,
      timestampEpoch: timestamp || null,
    });
    const wireBytes = nativeUint(wire);
    const capturedBytes = nativeUint(captured);
    if (!parsed.success || capturedBytes > wireBytes) throw invalidOutput();
    const values = new Map<string, string[]>();
    for (const [column, field] of names.entries()) {
      if (column < frameFields.length) continue;
      const value = cells[column];
      if (!value) continue;
      if (!fieldCell.safeParse(value).success)
        throw new CaptureError(
          "traffic_field_limit",
          "A native traffic field is invalid or exceeds its bound.",
        );
      values.set(field, value.split(","));
    }
    return {
      frame: parsed.data,
      section: section ? nativeUint(section) : null,
      relative: relative ? nativeTime(relative) : null,
      wireBytes,
      capturedBytes,
      get: (field) => values.get(field) ?? [],
    };
  });
}

export async function readTrafficMatches(
  native: OfflineTshark,
  snapshot: string,
  analysis: CaptureAnalysis,
  maxFrames: number,
  filter: string,
) {
  const stdout = await native.trafficOutput(
    snapshot,
    analysis,
    maxFrames,
    ["-T", "fields", "-e", "frame.number"],
    maxFrames * 8,
    filter,
  );
  let previous = 0;
  return new Set(
    (stdout ? stdout.trimEnd().split(/\r?\n/) : []).map((line) => {
      const frame = nativeUint(line);
      if (frame <= previous || frame > maxFrames) throw invalidOutput();
      previous = frame;
      return frame;
    }),
  );
}

export async function readNativeFollow(
  native: OfflineTshark,
  snapshot: string,
  analysis: CaptureAnalysis,
  maxFrames: number,
  transport: TrafficTransport,
  stream: number,
) {
  const stdout = await native.trafficOutput(
    snapshot,
    analysis,
    maxFrames,
    ["-q", "-z", ["follow", transport, "yaml", stream].join(",")],
    trafficLimits.nativeFollowBytes,
  );
  const lines = stdout.trimEnd().split(/\r?\n/);
  let offset = 0;
  function expect(line: string) {
    if (lines[offset++] !== line) throw invalidOutput();
  }
  function read(pattern: RegExp) {
    const value = pattern.exec(lines[offset++] ?? "")?.[1];
    if (value === undefined) throw invalidOutput();
    return value;
  }
  function peer(index: 0 | 1) {
    expect(`  - peer: ${index}`);
    const address = read(/^ {4}host: *(.*?) *$/);
    const port = endpointPort.safeParse(nativeUint(read(/^ {4}port: (\d{1,5})$/)));
    if (!port.success) throw invalidOutput();
    if (address === "" && port.data === 0) return null;
    if (!nativeAddress.safeParse(address).success) throw invalidOutput();
    return { address, port: port.data };
  }
  expect("peers:");
  const peers: NativeFollow["peers"] = [peer(0), peer(1)];
  expect("packets:");
  const records: NativeFollowRecord[] = [];
  while (offset < lines.length) {
    const frame = nativeUint(read(/^ {2}- packet: (\d{1,10})$/));
    const peer = read(/^ {4}peer: ([01])$/) === "0" ? 0 : 1;
    const timestamp = nativeTime(read(/^ {4}timestamp: ([-.\d]+)$/));
    expect("    data: !!binary |");
    let payloadBytes = 0;
    let firstLine = "";
    let dataLines = 0;
    const encoded: string[] = [];
    while (lines[offset]?.startsWith("      ")) {
      const line = read(/^ {6}(\S{1,128})$/);
      if (!base64Line.test(line)) throw invalidOutput();
      if (!dataLines) firstLine = line;
      dataLines++;
      encoded.push(line);
      payloadBytes += (line.length / 4) * 3 - (line.endsWith("==") ? 2 : line.endsWith("=") ? 1 : 0);
    }
    if (!payloadBytes || frame < 1 || frame > maxFrames || !peers[peer]) throw invalidOutput();
    // Wireshark timestamps its synthetic TCP gap record at zero and terminates it with NUL.
    const gap =
      transport === "tcp" && timestamp === 0n && dataLines === 1
        ? /^\[(-?\d+) bytes missing in capture file\]\0$/.exec(
            Buffer.from(firstLine, "base64").toString("latin1"),
          )
        : null;
    if (gap) {
      const bytes = Number(gap[1]);
      records.push({
        frame,
        peer,
        kind: "gap",
        bytes: Number.isSafeInteger(bytes) && bytes > 0 ? bytes : null,
      });
    } else {
      records.push({
        frame,
        peer,
        kind: "data",
        bytes: payloadBytes,
        data: Buffer.concat(encoded.map((line) => Buffer.from(line, "base64"))),
      });
    }
  }
  return { peers, records };
}
