import { z } from "zod";
import {
  captureAnalysisSchema,
  captureComparisonLocaleSchema,
  captureComparisonSideSchema,
  captureLimits,
  captureReferenceSchema,
  captureTrafficFrameSchema,
} from "./wireshark.js";
import { trafficTransportSchema } from "./wireshark-traffic.js";

const count = z.number().int().nonnegative();
const time = z.number().nonnegative();
const frame = captureTrafficFrameSchema;
const diagnosticSchema = z.enum([
  "window_duration_mismatch",
  "window_not_bracketed",
  "scan_limit",
  "untimed_frames",
  "clock_regression",
  "truncated_frames",
  "reported_drops",
  "unresolved_traffic",
  "ambiguous_conversations",
  "shared_native_context",
  "clock_uncertainty_unknown",
  "timing_insufficient",
  "timing_unobserved",
]);
const side = z.strictObject({
  capture: captureReferenceSchema,
  point: captureComparisonSideSchema.shape.point,
  window: captureComparisonSideSchema.shape.window,
  timingUncertaintyUs: captureComparisonSideSchema.shape.timingUncertaintyUs.unwrap(),
  coverage: z.strictObject({
    scanComplete: z.boolean(),
    scannedFrames: count,
    pointFrames: count,
    outOfScopeFrames: count,
    scopedTransportFrames: count,
    observedDurationMs: time.nullable(),
    framesWithoutTimestamp: count,
    truncatedFrames: count,
    unresolvedFrames: count,
    unresolvedTransports: z.array(trafficTransportSchema).max(2),
    sharedNativeContexts: count,
    knownDrops: z
      .string()
      .regex(/^\d{1,25}$/)
      .nullable(),
    interfaceDropCounters: z.strictObject({
      interface: z
        .string()
        .regex(/^\d{1,20}$/)
        .nullable(),
      operatingSystem: z
        .string()
        .regex(/^\d{1,20}$/)
        .nullable(),
    }),
    diagnostics: z.array(diagnosticSchema),
    evidence: z.array(frame).max(4),
  }),
});
const endpoint = z.strictObject({ address: z.string().min(1).max(240), port: count.max(65_535) });
const volume = z.strictObject({ packets: count, wireBytes: count });
const timing = z.strictObject({
  samples: count,
  unpaired: count,
  minMs: time.nullable(),
  medianMs: time.nullable(),
  p95Ms: time.nullable(),
  maxMs: time.nullable(),
  frames: z.array(frame).max(10),
});
const observation = z.strictObject({
  nativeContextShared: z.boolean(),
  aToB: volume,
  bToA: volume,
  retransmissions: count.nullable(),
  retransmissionFrame: frame.nullable(),
  dns: timing.nullable(),
  http: timing.nullable(),
  frames: z.array(frame).max(2),
});
const row = z.strictObject({
  kind: z.enum(["added", "missing", "changed", "unmatched", "timing_unavailable"]),
  transport: trafficTransportSchema,
  vlans: z.array(count.max(4095)).max(12),
  endpoints: z.tuple([endpoint, endpoint]),
  metrics: z.array(z.enum(["volume", "retransmissions", "dns", "http"])).max(4),
  withheldTiming: z.array(z.enum(["dns", "http"])).max(2),
  baseline: observation.nullable(),
  candidate: observation.nullable(),
});

/** Typed format-1 result for later assertions and local report generation. */
export const captureComparisonResultSchema = z.strictObject({
  analysis: captureAnalysisSchema,
  comparison: z.strictObject({
    format: z.literal(1),
    status: z.enum(["equivalent", "different", "partial", "incomparable"]),
    matchRule: z.literal("exact_ip_port_pair_transport_ordered_vlan_single_stream"),
    timeBasis: z.literal("first_timestamped_frame_half_open"),
    transports: z.array(trafficTransportSchema).min(1).max(2),
    scanLimit: count,
    timingToleranceUs: time.nullable(),
    reportLocale: captureComparisonLocaleSchema,
    diagnostics: z.array(diagnosticSchema),
    baseline: side,
    candidate: side,
    totals: z.strictObject({
      compared: count,
      added: count,
      missing: count,
      changed: count,
      unmatched: count,
      timingUnavailable: count,
    }),
    omittedRows: count,
    rows: z.array(row).max(captureLimits.pageRows),
  }),
  report: z.string(),
  packetData: z.literal("untrusted_capture_data"),
});
export type CaptureComparisonResult = z.infer<typeof captureComparisonResultSchema>;
