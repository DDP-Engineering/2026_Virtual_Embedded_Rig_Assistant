import { readFile } from "node:fs/promises";
import type { CaptureReference } from "@vera/shared";
import { CaptureError } from "./native.js";

type InterfaceDrops = { interface: bigint | null; operatingSystem: bigint | null };
const invalid = () => new CaptureError("invalid_capture", "The PCAPNG block structure is invalid.");

function readDropOptions(
  start: number,
  end: number,
  u16: (offset: number) => number,
  u64: (offset: number) => bigint,
  maximum: InterfaceDrops,
) {
  const seen = new Set<number>();
  for (let offset = start; offset < end; ) {
    if (end - offset < 4) throw invalid();
    const code = u16(offset);
    const length = u16(offset + 2);
    const valueAt = offset + 4;
    offset = valueAt + Math.ceil(length / 4) * 4;
    if (offset > end) throw invalid();
    if (code === 0) {
      if (length !== 0 || offset !== end) throw invalid();
      break;
    }
    const counter = code === 5 ? "interface" : code === 7 ? "operatingSystem" : null;
    if (!counter) continue;
    if (length !== 8 || seen.has(code)) throw invalid();
    seen.add(code);
    const value = u64(valueAt);
    const old = maximum[counter];
    if (old === null || value > old) maximum[counter] = value;
  }
}

/** Keep embedded decryption secrets out of TShark before profiling saved packets. */
export async function requireSecretsFreeCapture(
  snapshot: string,
  capture: CaptureReference,
  signal: AbortSignal,
  statisticsPoint?: { section: number | null; interfaceId: number | null },
  profile: "network" | "media" = "network",
) {
  if (capture.fileFormat !== "pcapng") return { interface: null, operatingSystem: null };
  const bytes = await readFile(snapshot, { signal });
  let littleEndian = true;
  let section = 0;
  const counters: InterfaceDrops = { interface: null, operatingSystem: null };
  const u16 = (offset: number) => (littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset));
  const u32 = (offset: number) => (littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset));
  const u64 = (offset: number) =>
    littleEndian ? bytes.readBigUInt64LE(offset) : bytes.readBigUInt64BE(offset);
  for (let offset = 0; offset < bytes.length; ) {
    signal.throwIfAborted();
    if (bytes.length - offset < 12) throw invalid();
    const sectionHeader = bytes.readUInt32BE(offset) === 0x0a0d0d0a;
    if (sectionHeader) {
      const order = bytes.readUInt32BE(offset + 8);
      if (order !== 0x1a2b3c4d && order !== 0x4d3c2b1a) throw invalid();
      littleEndian = order === 0x4d3c2b1a;
      section++;
    }
    const type = u32(offset);
    const size = u32(offset + 4);
    if (size < (sectionHeader ? 28 : 12) || size % 4 || size > bytes.length - offset) throw invalid();
    const end = offset + size - 4;
    if (u32(end) !== size) throw invalid();
    if (type === 0x0a)
      throw new CaptureError(
        `${profile}_embedded_secrets`,
        `${profile === "media" ? "Media" : "Networking"} profiles require a saved capture without embedded decryption secrets.`,
      );
    if (type === 5 && statisticsPoint?.section === section) {
      if (size < 24) throw invalid();
      if (u32(offset + 8) === statisticsPoint.interfaceId)
        readDropOptions(offset + 20, end, u16, u64, counters);
    }
    offset += size;
  }
  return {
    interface: counters.interface?.toString() ?? null,
    operatingSystem: counters.operatingSystem?.toString() ?? null,
  };
}
