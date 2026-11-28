import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize } from "node:path";
import {
  type CaptureReference,
  hexdumpImportLimits,
  type LiveCaptureManifest,
  liveCaptureLimits,
  liveCaptureManifestSchema,
} from "@vera/shared";
import type { RunResult } from "../plugins/runner.js";
import { indexCapture } from "./capture-file-index.js";
import { captureBaseName, closeReceiptName, diagnoseDumpcap, liveFailure } from "./live-native.js";
import { type CaptureCapacityReservation, type CaptureWriteAccess, publishCaptures } from "./storage.js";

export type LiveCaptureIdentity = Pick<
  LiveCaptureManifest,
  "captureId" | "sessionId" | "version" | "observation" | "filter" | "promiscuous" | "startedAt" | "limits"
>;
type CapturedSegment = LiveCaptureManifest["segments"][number];
const nativeBlocks = new Set([0x0a0d0d0a, 1, 5, 6]);
const sequenceOf = (name: string) => Number(/^segment_(\d{5})_\d{14}\.pcapng$/.exec(name)?.[1] ?? 0);
const receiptPath = (path: string) =>
  process.platform === "win32" ? normalize(path).toLowerCase() : normalize(path);

function digest(bytes: Buffer) {
  return { bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Open a bounded ordinary file from the private native capture directory. */
async function readNative(path: string, limit: number) {
  const before = await lstat(path);
  if (!before.isFile() || before.nlink !== 1 || before.size > limit || (await realpath(path)) !== path)
    throw liveFailure("capture_storage");
  const fd = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
  try {
    const actual = await fd.stat();
    if (
      !actual.isFile() ||
      actual.dev !== before.dev ||
      actual.ino !== before.ino ||
      actual.nlink !== 1 ||
      actual.size !== before.size
    )
      throw liveFailure("capture_storage");
    const bytes = Buffer.alloc(before.size + 1);
    let read = 0;
    while (read < bytes.length) {
      const { bytesRead } = await fd.read(bytes, read, bytes.length - read, read);
      if (!bytesRead) break;
      read += bytesRead;
    }
    const after = await fd.stat();
    if (
      read !== before.size ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      throw liveFailure("capture_storage");
    return bytes.subarray(0, read);
  } finally {
    await fd.close();
  }
}

async function verifySegment(input: string, sequence: number, limit: number, signal: AbortSignal) {
  const bytes = await readNative(input, limit);
  let truncatedPackets = 0;
  const index = indexCapture(bytes, "pcapng", signal, {
    allowedPcapngBlocks: nativeBlocks,
    visitPacket(_number, data, wire) {
      if (data.length < wire) truncatedPackets++;
    },
  });
  if (index.interfaces.length !== 1) throw liveFailure("capture_failed");
  const reference: CaptureReference = {
    format: 1,
    source: { kind: "managed" },
    fileFormat: "pcapng",
    ...digest(bytes),
  };
  const segment: CapturedSegment = {
    sequence,
    reference,
    packets: index.packets.length,
    truncatedPackets,
    firstPacketEpoch: index.earliestEpoch,
    lastPacketEpoch: index.latestEpoch,
  };
  return { segment, input, reference };
}

function captureCounters(output: string, interfaceId: string): LiveCaptureManifest["stats"] {
  const capturedText = [...output.matchAll(/(?:^|[\r\n])Packets captured: (\d+)(?=\r?\n|$)/g)].at(-1)?.[1];
  const dropLine = [
    ...output.matchAll(
      /(?:^|[\r\n])Packets received\/dropped on interface '([^\r\n]+)': (\d+)\/(\d+) \([^\r\n]*?ps_ifdrop:(\d+)\)/g,
    ),
  ].find((match) => match[1] === interfaceId || match[1]?.endsWith(`: ${interfaceId}`));
  const count = (value?: string) => (value && Number.isSafeInteger(Number(value)) ? Number(value) : null);
  const missingDropStats = /can(?:not|'t) get packet-drop statistics/i.test(output);
  return {
    captured: count(capturedText),
    received: count(dropLine?.[2]),
    dropped: missingDropStats ? null : count(dropLine?.[3]),
    interfaceDropped: missingDropStats ? null : count(dropLine?.[4]),
  };
}

function terminalOutcome(
  result: RunResult,
  identity: LiveCaptureIdentity,
  lastSequence: number,
  last?: CapturedSegment,
): Pick<LiveCaptureManifest, "status" | "reason"> {
  if (result.stopped) return { status: "stopped", reason: "stopped" };
  if (result.timedOut) return { status: "expired", reason: "duration_limit" };
  const acquisitionFailed =
    /error while capturing packets|network adapter [^\r\n]*(?:no longer running|no longer attached)|the capture has stopped\./i.test(
      result.output,
    );
  if (result.exitCode !== 0 || acquisitionFailed || !lastSequence || !last) {
    const failure = lastSequence ? "capture_failed" : "capture_startup";
    return { status: "failed", reason: diagnoseDumpcap(result.output, failure) };
  }
  const { limits } = identity;
  const sizeThreshold =
    Math.floor((limits.maxSegmentBytes - liveCaptureLimits.segmentReserveBytes) / 1000) * 1000;
  const volumeCandidate = limits.rotation
    ? lastSequence >= limits.maxSegments
    : last.reference.bytes >= sizeThreshold;
  const packetCandidate = !limits.rotation && last.packets === limits.packetsPerSegment;
  if (volumeCandidate || packetCandidate) {
    const ambiguous =
      result.durationMs >= limits.durationSeconds * 1000 || (volumeCandidate && packetCandidate);
    return {
      status: "expired",
      reason: ambiguous ? "native_limit" : volumeCandidate ? "volume_limit" : "packet_limit",
    };
  }
  return { status: "expired", reason: "duration_limit" };
}

export async function finalizeLiveCapture(
  root: string,
  access: CaptureWriteAccess,
  folder: string,
  identity: LiveCaptureIdentity,
  result: RunResult,
  reservation: CaptureCapacityReservation,
) {
  const endedAt = new Date().toISOString();
  const signal = AbortSignal.timeout(30_000);
  if ((await realpath(folder)) !== folder) throw liveFailure("capture_storage");
  const { limits } = identity;
  const entries = (await readdir(folder))
    .flatMap((name) => {
      const sequence = limits.rotation ? sequenceOf(name) : Number(name === captureBaseName);
      return sequence ? [{ name, sequence }] : [];
    })
    .sort((a, b) => a.sequence - b.sequence);
  const lastPresent = entries.at(-1)?.sequence ?? 0;
  if (
    lastPresent > limits.maxSegments ||
    new Set(entries.map((entry) => entry.sequence)).size !== entries.length
  )
    throw liveFailure("capture_storage");
  const receipts = new Set<string>();
  let lastSequence = lastPresent;
  if (limits.rotation) {
    try {
      const receipt = await readNative(join(folder, closeReceiptName), 128 * 1024);
      for (const line of receipt.toString("utf8").split(/\r?\n/)) {
        if (!line) continue;
        const path = receiptPath(line);
        const sequence = sequenceOf(basename(path));
        if (!sequence || dirname(path) !== receiptPath(folder)) continue;
        if (sequence > limits.maxSegments) throw liveFailure("capture_storage");
        lastSequence = Math.max(lastSequence, sequence);
        receipts.add(path);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  let incompleteSegments = lastSequence - lastPresent;
  let lastSegmentPartial =
    incompleteSegments > 0 || (lastSequence === 0 && (result.timedOut || result.stopped));
  const verified = [];
  for (const { name, sequence } of entries) {
    const input = join(folder, name);
    const final = sequence === lastSequence;
    // Dumpcap can receipt a failed terminal close. A later attempted member corroborates that an
    // earlier receipted member had already closed through rotation.
    const closed = limits.rotation ? receipts.has(receiptPath(input)) : result.exitCode === 0;
    if (closed && (!final || result.exitCode === 0)) {
      try {
        verified.push(await verifySegment(input, sequence, limits.maxSegmentBytes, signal));
        continue;
      } catch {
        signal.throwIfAborted();
      }
    }
    incompleteSegments++;
    if (final) lastSegmentPartial = true;
  }
  const retained = verified.slice(-(limits.rotation?.retain ?? 1));
  const rotatedOut = lastPresent - entries.length + verified.length - retained.length;
  const stats = captureCounters(result.output, identity.observation.id);
  const outcome = terminalOutcome(result, identity, lastSequence, verified.at(-1)?.segment);
  const manifest = liveCaptureManifestSchema.parse({
    format: 1,
    kind: "wireshark_live_capture",
    tool: "dumpcap",
    ...identity,
    endedAt,
    ...outcome,
    incompleteSegments,
    lastSegmentPartial,
    rotatedOut,
    stats,
    partial:
      outcome.status === "failed" ||
      rotatedOut > 0 ||
      incompleteSegments > 0 ||
      lastSegmentPartial ||
      stats.dropped === null ||
      stats.dropped > 0 ||
      (stats.interfaceDropped ?? 0) > 0 ||
      retained.some(({ segment }) => segment.truncatedPackets > 0),
    segments: retained.map(({ segment }) => segment),
  });
  const bytes = Buffer.from(`${JSON.stringify(manifest)}\n`);
  if (bytes.length > hexdumpImportLimits.manifestBytes) throw liveFailure("capture_storage");
  const manifestPath = join(folder, "manifest.json");
  const reference = digest(bytes);
  await writeFile(manifestPath, bytes, { flag: "wx", mode: 0o600 });
  await publishCaptures(root, access, retained, signal, async () => {}, {
    provenance: { input: manifestPath, reference },
    reservation,
  });
  return { manifest, manifestReference: reference };
}
