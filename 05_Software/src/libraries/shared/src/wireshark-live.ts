import { z } from "zod";
import { captureLimits, captureReferenceSchema } from "./wireshark.js";

export const dumpcapPluginId = "wireshark-dumpcap";
export const liveCaptureLimits = {
  seconds: 3600,
  defaultSeconds: 30,
  /** A capture without rotation that lasts longer runs in the background and returns its ID. */
  waitSeconds: 60,
  activitySeconds: 5,
  minimumBytes: 16_000,
  maximumBytes: 64 * 1024 * 1024,
  defaultBytes: 16 * 1024 * 1024,
  retainedSegments: 8,
  segments: 120,
  snapshotBytes: 4096,
  packetsPerSegment: captureLimits.scanFrames,
  // One maximum-sized packet plus PCAPNG framing and the final interface statistics block.
  segmentReserveBytes: 8192,
} as const;

const count = z.number().int().nonnegative();
const bytes = count.min(liveCaptureLimits.minimumBytes).max(liveCaptureLimits.maximumBytes);
const seconds = count.min(1).max(liveCaptureLimits.seconds);
const captureId = z.uuid();

const captureFilter = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[\x20-\x7e]+$/);
export const liveCaptureStartSchema = z.strictObject({
  /** An interface ID, or the name discover lists for it. */
  interfaceId: z.string().min(1).max(160),
  filter: captureFilter.optional(),
  durationSeconds: seconds.optional(),
  totalBytes: bytes.optional(),
  promiscuous: z.boolean().optional(),
  background: z.boolean().optional(),
  rotation: z
    .strictObject({
      segmentSeconds: seconds,
      segmentBytes: bytes,
      retain: count.min(1).max(liveCaptureLimits.retainedSegments),
    })
    .optional(),
});
export type LiveCaptureStart = z.infer<typeof liveCaptureStartSchema>;

const activitySeconds = count.min(1).max(liveCaptureLimits.activitySeconds);
export const liveCaptureControlSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("discover") }),
  z.strictObject({ operation: z.literal("activity"), seconds: activitySeconds.optional() }),
  z.strictObject({ operation: z.literal("status"), captureId }),
  z.strictObject({ operation: z.literal("stop"), captureId }),
]);
export const liveCaptureControlToolSchema = z.strictObject({
  operation: z.enum(["discover", "activity", "status", "stop"]),
  captureId: captureId.optional(),
  seconds: activitySeconds.optional(),
});

export const liveCaptureInterfaceSchema = z.strictObject({
  id: z.string().min(1).max(96),
  label: z.string().min(1).max(160),
  loopback: z.boolean(),
});
export type LiveCaptureInterface = z.infer<typeof liveCaptureInterfaceSchema>;

export const liveCaptureFailureSchema = z.enum([
  "dumpcap_missing",
  "dumpcap_version",
  "npcap_missing",
  "capture_permission",
  "interface_unavailable",
  "invalid_capture_filter",
  "capture_startup",
  "capture_failed",
  "capture_storage",
]);
export type LiveCaptureFailure = z.infer<typeof liveCaptureFailureSchema>;

const captureStats = z.strictObject({
  captured: count.nullable(),
  received: count.nullable(),
  dropped: count.nullable(),
  interfaceDropped: count.nullable(),
});

export const liveCaptureManifestSchema = z.strictObject({
  format: z.literal(1),
  kind: z.literal("wireshark_live_capture"),
  captureId,
  sessionId: z.string().min(1).max(64),
  tool: z.literal("dumpcap"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  observation: liveCaptureInterfaceSchema,
  filter: captureFilter.nullable(),
  promiscuous: z.boolean().optional(),
  startedAt: z.iso.datetime(),
  endedAt: z.iso.datetime(),
  limits: z.strictObject({
    durationSeconds: seconds,
    totalBytes: bytes,
    maxSegmentBytes: bytes,
    maxSegments: count.min(1).max(liveCaptureLimits.segments),
    snapshotBytes: z.literal(liveCaptureLimits.snapshotBytes),
    packetsPerSegment: z.literal(liveCaptureLimits.packetsPerSegment),
    rotation: liveCaptureStartSchema.shape.rotation.unwrap().nullable(),
  }),
  status: z.enum(["expired", "stopped", "failed"]),
  reason: z.union([
    liveCaptureFailureSchema,
    z.enum(["duration_limit", "volume_limit", "packet_limit", "native_limit", "stopped"]),
  ]),
  rotatedOut: count,
  incompleteSegments: count,
  lastSegmentPartial: z.boolean(),
  partial: z.boolean(),
  stats: captureStats,
  segments: z
    .array(
      z.strictObject({
        sequence: count.positive(),
        reference: captureReferenceSchema,
        packets: count,
        truncatedPackets: count,
        firstPacketEpoch: z.string().nullable(),
        lastPacketEpoch: z.string().nullable(),
      }),
    )
    .max(liveCaptureLimits.retainedSegments),
});
export type LiveCaptureManifest = z.infer<typeof liveCaptureManifestSchema>;
