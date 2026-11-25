import { readFile } from "node:fs/promises";
import type { CaptureReference } from "@vera/shared";
import { CaptureError } from "./native.js";

/** Keep embedded decryption secrets out of TShark before profiling saved packets. */
export async function requireSecretsFreeCapture(
  snapshot: string,
  capture: CaptureReference,
  signal: AbortSignal,
) {
  if (capture.fileFormat !== "pcapng") return;
  const bytes = await readFile(snapshot, { signal });
  const invalid = () => new CaptureError("invalid_capture", "The PCAPNG block structure is invalid.");
  let littleEndian = true;
  for (let offset = 0; offset < bytes.length; ) {
    signal.throwIfAborted();
    if (bytes.length - offset < 12) throw invalid();
    const sectionHeader = bytes.readUInt32BE(offset) === 0x0a0d0d0a;
    if (sectionHeader) {
      const order = bytes.readUInt32BE(offset + 8);
      if (order !== 0x1a2b3c4d && order !== 0x4d3c2b1a) throw invalid();
      littleEndian = order === 0x4d3c2b1a;
    }
    const type = littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
    const size = littleEndian ? bytes.readUInt32LE(offset + 4) : bytes.readUInt32BE(offset + 4);
    if (size < (sectionHeader ? 28 : 12) || size % 4 || size > bytes.length - offset) throw invalid();
    const end = offset + size - 4;
    const trailer = littleEndian ? bytes.readUInt32LE(end) : bytes.readUInt32BE(end);
    if (trailer !== size) throw invalid();
    if (type === 0x0a)
      throw new CaptureError(
        "network_embedded_secrets",
        "Networking profiles require a saved capture without embedded decryption secrets.",
      );
    offset += size;
  }
}
