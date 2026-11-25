import { createHash } from "node:crypto";
import { type CaptureReference, captureFileLimits, captureLimits } from "@vera/shared";
import { CaptureError } from "./native.js";

const second = 1_000_000_000n;
const packetLimit = () =>
  new CaptureError(
    "capture_scan_limit",
    "The operation requires a complete capture within the host frame limit.",
  );
const malformed = () =>
  new CaptureError("invalid_capture", "The capture has malformed or unsupported PCAP/PCAPNG records.");

export type IndexedPacket = {
  number: number;
  time: bigint | null;
  subnanosecond: boolean;
  dataHash: string;
  identity: string;
  originalFrame: number | null;
};

function upperPduFrame(bytes: Buffer) {
  let frame: number | null = null;
  for (let at = 0; at + 4 <= bytes.length; ) {
    const tag = bytes.readUInt16BE(at);
    const size = bytes.readUInt16BE(at + 2);
    at += 4;
    if (tag === 0) return size === 0 ? frame : null;
    if (at + size > bytes.length) return null;
    if (tag === 30) {
      if (size !== 4 || frame !== null) return null;
      frame = bytes.readUInt32BE(at);
    }
    at += size;
  }
  return null;
}

type CaptureInterface = {
  section: number;
  id: number;
  linkType: number;
  snapLength: number | null;
  timestampResolution: string;
  timestampOffsetSeconds: string;
  packets: number;
};

type InterfaceClock = {
  view: CaptureInterface;
  ticksPerSecond: bigint;
  offset: bigint;
};

export function parseEpoch(value: string) {
  const [whole = "", fraction = ""] = value.replace(/^-/, "").split(".");
  const time = BigInt(whole) * second + BigInt(fraction.padEnd(9, "0"));
  return value.startsWith("-") ? -time : time;
}

export function epochText(time: bigint | null) {
  if (time === null) return null;
  const magnitude = time < 0n ? -time : time;
  return `${time < 0n ? "-" : ""}${magnitude / second}.${String(magnitude % second).padStart(9, "0")}`;
}

export function indexCapture(bytes: Buffer, format: CaptureReference["fileFormat"], signal: AbortSignal) {
  const packets: IndexedPacket[] = [];
  const interfaces: CaptureInterface[] = [];
  const metadata = { capture_comments: 0, packet_comments: 0, secrets: 0 };
  const metadataHashes = {
    capture_comments: createHash("sha256"),
    packet_comments: createHash("sha256"),
    secrets: createHash("sha256"),
  };
  let section = -1;
  let little = false;
  let clocks: InterfaceClock[] = [];
  let earliest: bigint | null = null;
  let latest: bigint | null = null;
  let chronological = true;
  let previous: bigint | null = null;
  let untimed = 0;
  let subnanosecond = 0;

  const u16 = (offset: number) => (little ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
  const u32 = (offset: number) => (little ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const i64 = (offset: number) => (little ? bytes.readBigInt64LE(offset) : bytes.readBigInt64BE(offset));
  const recordMetadata = (kind: keyof typeof metadata, start: number, size: number, secretType?: number) => {
    metadata[kind]++;
    metadataHashes[kind].update(`${secretType ?? ""}:${size}:`);
    metadataHashes[kind].update(bytes.subarray(start, start + size));
  };
  const addInterface = (linkType: number, snapLength: number, resolution: number, offset: bigint) => {
    if (interfaces.length >= captureFileLimits.interfaces)
      throw new CaptureError("capture_interface_limit", "The capture exceeds the host interface limit.");
    const binary = resolution >= 128;
    const exponent = resolution & 127;
    const ticksPerSecond = (binary ? 2n : 10n) ** BigInt(exponent);
    const view = {
      section,
      id: clocks.length,
      linkType,
      snapLength: snapLength || null,
      timestampResolution: `${binary ? 2 : 10}^-${exponent}`,
      timestampOffsetSeconds: String(offset),
      packets: 0,
    };
    interfaces.push(view);
    clocks.push({ view, ticksPerSecond, offset });
  };
  const addPacket = (
    clock: InterfaceClock,
    start: number,
    length: number,
    wire: number,
    ticks: bigint | null,
  ) => {
    if (packets.length >= captureLimits.scanFrames) throw packetLimit();
    if (length > wire) throw malformed();
    const data = bytes.subarray(start, start + length);
    const dataHash = createHash("sha256").update(data).digest("hex");
    const numerator = ticks === null ? 0n : (ticks + clock.offset * clock.ticksPerSecond) * second;
    let time = ticks === null ? null : numerator / clock.ticksPerSecond;
    const remainder = numerator % clock.ticksPerSecond;
    if (time !== null && remainder < 0n) time -= 1n;
    let exactTime = String(time);
    if (remainder !== 0n) {
      // Normalize as a rational number so conversions cannot silently lose subnanosecond information.
      let a = remainder < 0n ? -remainder : remainder;
      let b = clock.ticksPerSecond;
      while (b) [a, b] = [b, a % b];
      exactTime = `${numerator / a}/${clock.ticksPerSecond / a}`;
      subnanosecond++;
    }
    if (time === null) untimed++;
    else {
      if (earliest === null || time < earliest) earliest = time;
      if (latest === null || time > latest) latest = time;
      if (previous !== null && time < previous) chronological = false;
      previous = time;
    }
    clock.view.packets++;
    packets.push({
      number: packets.length + 1,
      time,
      subnanosecond: remainder !== 0n,
      dataHash,
      identity: `${clock.view.linkType}:${wire}:${length}:${exactTime}:${dataHash}`,
      originalFrame: clock.view.linkType === 252 ? upperPduFrame(data) : null,
    });
  };
  function readOptions(start: number, end: number, visit: (code: number, at: number, size: number) => void) {
    for (let at = start; at < end; ) {
      if (end - at < 4) throw malformed();
      const code = u16(at);
      const length = u16(at + 2);
      at += 4;
      if (code === 0) {
        if (length !== 0 || at !== end) throw malformed();
        return;
      }
      const next = at + Math.ceil(length / 4) * 4;
      if (next > end) throw malformed();
      visit(code, at, length);
      at = next;
    }
  }

  if (format === "pcap") {
    if (bytes.length < 24) throw malformed();
    const magic = bytes.subarray(0, 4).toString("hex");
    if (!["d4c3b2a1", "4d3cb2a1", "a1b2c3d4", "a1b23c4d"].includes(magic)) throw malformed();
    little = magic.endsWith("b2a1");
    if (u16(4) !== 2 || u16(6) !== 4) throw malformed();
    section = 0;
    addInterface(u32(20) & 0xffff, u32(16), magic === "4d3cb2a1" || magic === "a1b23c4d" ? 9 : 6, 0n);
    const clock = clocks[0];
    if (!clock) throw malformed();
    for (let at = 24; at < bytes.length; ) {
      signal.throwIfAborted();
      if (bytes.length - at < 16) throw malformed();
      const length = u32(at + 8);
      const fraction = BigInt(u32(at + 4));
      if (length > bytes.length - at - 16 || fraction >= clock.ticksPerSecond) throw malformed();
      addPacket(clock, at + 16, length, u32(at + 12), BigInt(u32(at)) * clock.ticksPerSecond + fraction);
      at += 16 + length;
    }
  } else {
    for (let at = 0; at < bytes.length; ) {
      signal.throwIfAborted();
      if (bytes.length - at < 12) throw malformed();
      const isSection = bytes.readUInt32BE(at) === 0x0a0d0d0a;
      if (isSection) {
        const magic = bytes.readUInt32BE(at + 8);
        if (magic !== 0x1a2b3c4d && magic !== 0x4d3c2b1a) throw malformed();
        little = magic === 0x4d3c2b1a;
        section++;
        clocks = [];
      }
      if (section < 0) throw malformed();
      const type = u32(at);
      const length = u32(at + 4);
      const end = at + length - 4;
      if (length < 12 || length % 4 || end + 4 > bytes.length || u32(end) !== length) throw malformed();
      if (isSection) {
        if (length < 28 || u16(at + 12) !== 1) throw malformed();
        readOptions(at + 24, end, (code, start, size) => {
          if (code === 1) recordMetadata("capture_comments", start, size);
        });
      } else if (type === 1) {
        if (length < 20) throw malformed();
        let resolution: number | undefined;
        let offset: bigint | undefined;
        readOptions(at + 16, end, (code, option, size) => {
          if (code === 9) {
            if (size !== 1 || resolution !== undefined) throw malformed();
            resolution = bytes.readUInt8(option);
          }
          if (code === 14) {
            if (size !== 8 || offset !== undefined) throw malformed();
            offset = i64(option);
          }
        });
        addInterface(u16(at + 8), u32(at + 12), resolution ?? 6, offset ?? 0n);
      } else if (type === 6 || type === 2) {
        if (length < 32) throw malformed();
        const clock = clocks[type === 6 ? u32(at + 8) : u16(at + 8)];
        const captured = u32(at + 20);
        const options = at + 28 + Math.ceil(captured / 4) * 4;
        if (!clock || options > end) throw malformed();
        const ticks = (BigInt(u32(at + 12)) << 32n) | BigInt(u32(at + 16));
        addPacket(clock, at + 28, captured, u32(at + 24), ticks);
        readOptions(options, end, (code, start, size) => {
          if (code === 1) recordMetadata("packet_comments", start, size);
        });
      } else if (type === 3) {
        const clock = clocks[0];
        if (!clock || length < 16) throw malformed();
        const wire = u32(at + 8);
        const captured = Math.min(wire, clock.view.snapLength ?? wire);
        if (at + 12 + Math.ceil(captured / 4) * 4 !== end) throw malformed();
        addPacket(clock, at + 12, captured, wire, null);
      } else if (type === 10) {
        if (length < 20 || at + 16 + Math.ceil(u32(at + 12) / 4) * 4 > end) throw malformed();
        recordMetadata("secrets", at + 16, u32(at + 12), u32(at + 8));
      } else if (type !== 4 && type !== 5) {
        // Wiretap can emit frames for other block types, including Systemd Journal Export.
        throw new CaptureError(
          "capture_records_unsupported",
          "The PCAPNG contains records that VERA cannot verify. Use a capture with supported packet records.",
        );
      }
      at = end + 4;
    }
  }
  return {
    packets,
    interfaces,
    metadata,
    untimed,
    subnanosecond,
    metadataSha256: {
      capture_comments: metadataHashes.capture_comments.digest("hex"),
      packet_comments: metadataHashes.packet_comments.digest("hex"),
      secrets: metadataHashes.secrets.digest("hex"),
    },
    earliestEpoch: epochText(earliest),
    latestEpoch: epochText(latest),
    chronological: !packets.length || untimed || subnanosecond ? null : chronological,
  };
}

export type CaptureFileIndex = ReturnType<typeof indexCapture>;
