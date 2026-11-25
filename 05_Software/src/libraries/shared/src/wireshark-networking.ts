import { z } from "zod";
import { trafficPageCursorSchema, trafficTransportSchema } from "./wireshark-traffic.js";

export const networkProfileSchema = z.enum([
  "ethernet_vlan",
  "ipv4_ipv6",
  "arp_nd",
  "dns_dhcp",
  "tcp_udp",
  "multicast",
  "tls",
]);

export const networkQuerySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("observations") }),
  z.strictObject({ kind: z.literal("exchanges") }),
  z.strictObject({ kind: z.literal("conversations"), transport: trafficTransportSchema }),
  z.strictObject({ kind: z.literal("tcp_symptoms") }),
  z.strictObject({ kind: z.literal("multicast") }),
]);
const evidenceModeSchema = z.enum(["observations", "compact"]);

export const networkQueryProfiles = {
  observations: networkProfileSchema.options,
  exchanges: ["arp_nd", "dns_dhcp"],
  conversations: ["tcp_udp"],
  tcp_symptoms: ["tcp_udp"],
  multicast: ["multicast"],
} as const satisfies Record<NetworkQuery["kind"], readonly NetworkProfile[]>;

export const networkingInputs = {
  networkProfile: networkProfileSchema,
  networkQuery: networkQuerySchema.optional(),
  networkCursor: trafficPageCursorSchema.optional(),
  evidenceMode: evidenceModeSchema.optional(),
};

export function acceptsNetworkQuery({
  networkProfile,
  networkQuery,
}: z.infer<z.ZodObject<typeof networkingInputs>>) {
  return networkQueryProfiles[networkQuery?.kind ?? "observations"].some((item) => item === networkProfile);
}

export const networkLimits = { pageRows: 50, framesPerRow: 8, fieldValues: 12, valueChars: 240 } as const;
const uint = z.number().int().nonnegative().max(4_294_967_295);
const frameNumber = uint.min(1);
const vlan = uint.max(4095);
const field = z.string().regex(/^[a-z0-9_][a-z0-9_.-]{0,79}$/);
const networkEndpoints = z.strictObject({
  address: z.string().min(1).max(networkLimits.valueChars).nullable(),
  port: uint.max(65535).nullable(),
  redacted: z.boolean(),
});
const point = {
  section: uint.nullable(),
  interfaceId: uint.nullable(),
  vlans: z.array(vlan).max(networkLimits.fieldValues),
  vlansLimited: z.boolean(),
};
const row = { frames: z.array(frameNumber).min(1).max(networkLimits.framesPerRow), ...point };
const direction = z.strictObject({
  packets: uint,
  wireBytes: z.number().int().nonnegative(),
  capturedBytes: z.number().int().nonnegative(),
  representativeFrame: frameNumber.nullable(),
});
const networkSymptomsSchema = z.enum([
  "retransmission",
  "fastRetransmission",
  "spuriousRetransmission",
  "previousSegmentUnseen",
  "acknowledgedSegmentUnseen",
  "outOfOrder",
  "duplicateAck",
  "zeroWindow",
  "reset",
]);

export const networkConversationSchema = z.strictObject({
  kind: z.literal("conversation"),
  protocol: trafficTransportSchema,
  ...row,
  a: networkEndpoints,
  b: networkEndpoints,
  stream: uint,
  aToB: direction,
  bToA: direction,
});
const networkObservationSchema = z.strictObject({
  kind: z.literal("observation"),
  protocol: z.enum([
    "ethernet",
    "vlan",
    "ipv4",
    "ipv6",
    "arp",
    "nd",
    "dns",
    "dhcp",
    "dhcpv6",
    "tcp",
    "udp",
    "tcp_fragment",
    "udp_fragment",
    "transport_ambiguous",
    "igmp",
    "mld",
    "multicast",
    "tls",
    "tls_candidate",
  ]),
  ...row,
  observationFrame: frameNumber,
  source: networkEndpoints.nullable(),
  destination: networkEndpoints.nullable(),
  fields: z.record(
    field,
    z.array(z.string().max(networkLimits.valueChars)).min(1).max(networkLimits.fieldValues),
  ),
  redactedFields: z.array(field).max(100),
  valuesLimited: z.boolean(),
  truncated: z.boolean(),
  symptoms: z.array(networkSymptomsSchema),
  opaqueTls: z.boolean(),
  reassembly: z
    .strictObject({
      relatedFrames: uint,
      outsideScopeFrames: uint,
      unverifiedFrames: uint,
      omittedFrames: uint,
      pendingOrInvalid: z.boolean(),
      transportContextUnverified: z.boolean(),
      withheldFields: z.array(field).max(100),
    })
    .nullable(),
  exchange: z
    .strictObject({
      phase: z.enum([
        "request",
        "response",
        "router_solicitation",
        "router_advertisement",
        "neighbor_solicitation",
        "neighbor_advertisement",
        "redirect",
        "client_message",
        "server_message",
        "undetermined",
      ]),
      messageType: uint.nullable(),
      transactionId: z
        .string()
        .regex(/^0x[\da-f]{1,8}$/i)
        .nullable(),
    })
    .nullable(),
  dnsRelationship: z
    .discriminatedUnion("status", [
      z.strictObject({
        status: z.literal("native_link"),
        counterpartFrame: frameNumber,
        counterpartInScope: z.boolean(),
      }),
      z.strictObject({ status: z.enum(["counterpart_not_observed", "ambiguous_context"]) }),
    ])
    .nullable(),
});

export const networkProjectionSchema = z.strictObject({
  query: networkQuerySchema,
  evidenceMode: evidenceModeSchema,
  selectedFields: z.array(field).max(100),
  projectedFields: z.array(field).max(100),
  fieldAvailability: z.literal("projected_values_may_be_absent_redacted_or_withheld"),
  sensitiveData: z.literal("selected_metadata_only"),
  redactedContext: z.array(z.enum(["capture.source.path", "analysis.filter"])).max(2),
  scopeCoverage: z.strictObject({
    observationPoints: z
      .array(z.strictObject({ section: uint.nullable(), interfaceId: uint.nullable(), packets: uint }))
      .max(16),
    omittedObservationPoints: uint,
    missingObservationPointFrames: uint,
    framesWithoutTimestamp: uint,
    truncatedFrames: uint,
    scannedTruncatedFrames: uint,
    unresolvedEndpointFrames: uint,
    unresolvedDnsFrames: uint,
    dnsCounterpartsOutsideScope: uint,
    reassemblyLimits: z.strictObject({
      tcpGapFrames: uint,
      pendingOrInvalidFrames: uint,
      framesWithRelatedOutsideScope: uint,
      framesWithOmittedRelated: uint,
      tlsCandidateFrames: uint,
      basis: z.literal("native_dissector_markers_and_port_443_candidates"),
    }),
    opaqueTlsFrames: uint,
    dropReports: uint,
    knownDrops: z.string().regex(/^\d+$/).nullable(),
    dropCoverage: z.literal("packet_drop_metadata_only"),
    interpretation: z.literal("observed_at_saved_capture_interfaces"),
    checksumInterpretation: z.literal("offload_and_observation_point_can_affect_checksums"),
  }),
  rows: z
    .array(z.discriminatedUnion("kind", [networkObservationSchema, networkConversationSchema]))
    .max(networkLimits.pageRows),
  page: z.strictObject({
    querySha256: trafficPageCursorSchema.shape.querySha256,
    offset: uint,
    limit: uint.min(1).max(networkLimits.pageRows),
    totalRows: uint,
    next: trafficPageCursorSchema.nullable(),
  }),
});

export type NetworkProfile = z.infer<typeof networkProfileSchema>;
export type NetworkQuery = z.infer<typeof networkQuerySchema>;
export type NetworkObservation = z.infer<typeof networkObservationSchema>;
export type NetworkConversation = z.infer<typeof networkConversationSchema>;
