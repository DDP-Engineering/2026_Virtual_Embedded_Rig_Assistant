import { z } from "zod";

export const trafficLimits = {
  intervals: 1000,
  aggregateGroups: 20_000,
  nativeFieldsBytes: 24 * 1024 * 1024,
  nativeFollowBytes: 4 * 1024 * 1024,
} as const;
export const trafficLayerSchema = z.enum(["ethernet", "ipv4", "ipv6", "tcp", "udp"]);
export const trafficTransportSchema = z.enum(["tcp", "udp"]);
export const trafficStatisticSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("protocol_hierarchy") }),
  z.strictObject({ kind: z.literal("endpoints"), layer: trafficLayerSchema }),
  z.strictObject({ kind: z.literal("conversations"), layer: trafficLayerSchema }),
  z.strictObject({ kind: z.literal("traffic"), intervalMs: z.number().int().min(1).max(86_400_000) }),
  z.strictObject({ kind: z.literal("diagnostics") }),
  z.strictObject({ kind: z.literal("response_timing"), protocol: z.enum(["dns", "http"]) }),
]);
const relativeMs = z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000);
export const trafficWindowSchema = z
  .strictObject({ startMs: relativeMs, endMs: relativeMs })
  .refine(({ startMs, endMs }) => startMs < endMs, "Use a nonempty half-open time window.");
export const trafficStreamSchema = z.number().int().nonnegative().max(4_294_967_295);
export const trafficPageCursorSchema = z.strictObject({
  querySha256: z.string().regex(/^[a-f0-9]{64}$/),
  offset: z.number().int().positive().max(1_000_000),
});
export const trafficPreferencesSchema = z.strictObject({
  tcpSequenceAnalysis: z.literal(true),
  tcpDesegmentation: z.literal(true),
  tcpReassembleOutOfOrder: z.literal(false),
  httpDesegmentation: z.literal(true),
  dnsDesegmentation: z.literal(true),
  validateChecksums: z.boolean(),
});

export type TrafficStatistic = z.infer<typeof trafficStatisticSchema>;
export type TrafficWindow = z.infer<typeof trafficWindowSchema>;
export type TrafficLayer = z.infer<typeof trafficLayerSchema>;
export type TrafficTransport = z.infer<typeof trafficTransportSchema>;
