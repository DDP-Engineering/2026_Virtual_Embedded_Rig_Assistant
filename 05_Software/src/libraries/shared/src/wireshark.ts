import { z } from "zod";
import { parseRef } from "./refs.js";
import { automotiveInputs, automotiveLimits, automotiveProfileSchema } from "./wireshark-automotive.js";
import {
  trafficPageCursorSchema,
  trafficPreferencesSchema,
  trafficStatisticSchema,
  trafficStreamSchema,
  trafficTransportSchema,
  trafficWindowSchema,
} from "./wireshark-traffic.js";

export const wiresharkPluginId = "wireshark-tshark";
export const wiresharkProfile = "vera-offline-v1";
export const captureLimits = {
  captureBytes: 64 * 1024 * 1024,
  managedBytes: 256 * 1024 * 1024,
  managedFiles: 32,
  scanFrames: 50_000,
  pageRows: 50,
  valueChars: 240,
  deadlineMs: 30_000,
} as const;

const positive = z.number().int().positive().max(4_294_967_295);
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
// biome-ignore lint/suspicious/noControlCharactersInRegex: keep paths and native argument text on one line.
const singleLine = /^[^\u0000-\u001f\u007f]+$/;
const path = z.string().min(1).max(1024).regex(singleLine);
export const captureFormatSchema = z.enum(["pcap", "pcapng"]);

/** Stable source and content identity within the owning workbench. */
export const captureReferenceSchema = z.strictObject({
  format: z.literal(1),
  source: z.discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("workbench"), path }),
    z.strictObject({ kind: z.literal("managed") }),
  ]),
  fileFormat: captureFormatSchema,
  bytes: positive,
  sha256,
});
export type CaptureReference = z.infer<typeof captureReferenceSchema>;

/** A frame in the exact file, with the original decimal epoch timestamp when present. */
export const captureFrameReferenceSchema = z.strictObject({
  captureSha256: sha256,
  number: positive,
  interfaceId: z.number().int().nonnegative().nullable(),
  timestampEpoch: z
    .string()
    .regex(/^-?\d{1,20}(?:\.\d{1,12})?$/)
    .nullable(),
});
export type CaptureFrameReference = z.infer<typeof captureFrameReferenceSchema>;

const decodeAs = z.strictObject({
  transport: z.enum(["tcp", "udp"]),
  port: z.number().int().min(1).max(65535),
  protocol: z.string().regex(/^[a-z][a-z0-9_.-]{0,47}$/),
});
const profile = {
  profile: z.literal(wiresharkProfile).optional(),
  decodeAs: z.array(decodeAs).max(8).optional(),
};
export const captureDisplayFilterSchema = z.string().min(1).max(1024).regex(singleLine);
const filter = captureDisplayFilterSchema;
export const captureCitationRefSchema = z
  .string()
  .max(85)
  .refine((ref) => parseRef(ref)?.kind === "capture");
const field = z.string().regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,79}$/);
const fields = z.array(field).min(1).max(10);
const source = z.union([z.strictObject({ path }), z.strictObject({ reference: captureReferenceSchema })]);
const scanFrames = z.number().int().min(1).max(captureLimits.scanFrames);
const kind = z.enum(["fields", "protocols", "decoders"]);
const search = z
  .string()
  .max(80)
  .regex(/^[a-zA-Z0-9_. -]*$/);
const offset = z.number().int().min(0).max(150_000);
const limit = z.number().int().min(1).max(captureLimits.pageRows);
export const captureQueryCursorSchema = z.strictObject({ querySha256: sha256, afterFrame: positive });
const trafficInputs = {
  source,
  filter: filter.optional(),
  window: trafficWindowSchema.optional(),
  scanFrames: scanFrames.optional(),
  limit: limit.optional(),
  trafficCursor: trafficPageCursorSchema.optional(),
  validateChecksums: z.boolean().optional(),
  ...profile,
};

export const wiresharkCaptureArgsSchema = z.discriminatedUnion("operation", [
  z.strictObject({ operation: z.literal("capabilities") }),
  z.strictObject({
    operation: z.literal("discover"),
    kind,
    search: search.optional(),
    offset: offset.optional(),
    limit: limit.optional(),
  }),
  z.strictObject({ operation: z.literal("validate_filter"), filter, ...profile }),
  z.strictObject({ operation: z.literal("inspect"), source, scanFrames: scanFrames.optional(), ...profile }),
  z.strictObject({
    operation: z.literal("query"),
    source,
    filter: filter.optional(),
    fields: fields.optional(),
    scanFrames: scanFrames.optional(),
    limit: limit.optional(),
    cursor: captureQueryCursorSchema.optional(),
    ...profile,
  }),
  z.strictObject({
    operation: z.literal("frame"),
    source,
    frame: positive,
    fields: fields.optional(),
    ...profile,
  }),
  z.strictObject({ operation: z.literal("statistics"), statistic: trafficStatisticSchema, ...trafficInputs }),
  z.strictObject({
    operation: z.literal("follow"),
    transport: trafficTransportSchema,
    stream: trafficStreamSchema,
    ...trafficInputs,
  }),
  z.strictObject({
    operation: z.literal("automotive"),
    source,
    scanFrames: scanFrames.optional(),
    limit: limit.optional(),
    ...profile,
    ...automotiveInputs,
  }),
  z.strictObject({ operation: z.literal("import"), path }),
  z.strictObject({
    operation: z.literal("verify_reference"),
    source: z.strictObject({ reference: captureReferenceSchema }),
  }),
]);
export type WiresharkCaptureArgs = z.infer<typeof wiresharkCaptureArgsSchema>;
export type CaptureSource = z.infer<typeof source>;
export type CaptureDecodeAs = z.infer<typeof decodeAs>;

/** Object-shaped model schema with strict operation-specific validation at dispatch. */
export const wiresharkCaptureToolSchema = z
  .strictObject({
    operation: z.enum([
      "capabilities",
      "discover",
      "validate_filter",
      "inspect",
      "query",
      "frame",
      "statistics",
      "follow",
      "automotive",
      "verify_reference",
    ]),
    kind: kind.optional(),
    search: search.optional(),
    offset: offset.optional(),
    limit: limit.optional(),
    filter: filter.optional(),
    source: source.optional(),
    scanFrames: scanFrames.optional(),
    fields: fields.optional(),
    cursor: captureQueryCursorSchema.optional(),
    frame: positive.optional(),
    statistic: trafficStatisticSchema.optional(),
    transport: trafficTransportSchema.optional(),
    stream: trafficStreamSchema.optional(),
    window: trafficWindowSchema.optional(),
    trafficCursor: trafficPageCursorSchema.optional(),
    validateChecksums: z.boolean().optional(),
    ...profile,
    ...automotiveInputs,
    automotiveProfile: automotiveInputs.automotiveProfile.optional(),
  })
  .refine((args) => wiresharkCaptureArgsSchema.safeParse(args).success, {
    message: "Supply only the inputs for the selected capture operation.",
  });
export const wiresharkImportSchema = z.strictObject({ path });

export const captureAnalysisSchema = z.strictObject({
  tool: z.literal("tshark"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  profile: z.literal(wiresharkProfile),
  decodeAs: z.array(decodeAs).max(8),
  filter: filter.nullable(),
  trafficPreferences: trafficPreferencesSchema.optional(),
  automotiveProfile: automotiveProfileSchema.optional(),
});
export type CaptureAnalysis = z.infer<typeof captureAnalysisSchema>;

export const captureCoverageSchema = z.strictObject({
  scope: z.enum(["capture", "display_filter", "single_frame"]),
  scannedThrough: z.number().int().nonnegative(),
  scanLimit: positive,
  scanComplete: z.boolean(),
  matchedInScope: z.number().int().nonnegative(),
  returned: z.number().int().nonnegative(),
  partial: z.boolean(),
  truncated: z.boolean(),
});
export type CaptureCoverage = z.infer<typeof captureCoverageSchema>;

/** Common context carried by offline packet evidence and reusable by other capture features. */
export const captureEvidenceSchema = z.strictObject({
  capture: captureReferenceSchema,
  analysis: captureAnalysisSchema,
  coverage: captureCoverageSchema,
});
export type CaptureEvidence = z.infer<typeof captureEvidenceSchema>;

export const capturePacketSchema = z.strictObject({
  ref: captureCitationRefSchema.optional(),
  frame: captureFrameReferenceSchema,
  wireBytes: z.number().int().nonnegative(),
  capturedBytes: z.number().int().nonnegative(),
  fields: z.record(field, z.array(z.string().max(captureLimits.valueChars))),
  truncated: z.boolean(),
});
export type CapturePacket = z.infer<typeof capturePacketSchema>;

export const captureTrafficFrameSchema = z.strictObject({
  section: z.number().int().nonnegative().nullable(),
  ref: captureCitationRefSchema,
  frame: captureFrameReferenceSchema,
});

export const captureAutomotiveFrameSchema = captureTrafficFrameSchema.extend({
  conversation: positive.nullable(),
  encapsulation: z.number().int().nonnegative().nullable(),
  vlans: z.array(z.number().int().min(0).max(4095)),
  direction: z.enum(["unknown", "inbound", "outbound", "reserved"]).nullable(),
  wireBytes: z.number().int().nonnegative(),
  capturedBytes: z.number().int().nonnegative(),
});

export const captureAutomotiveEvidenceSchema = z
  .array(captureAutomotiveFrameSchema)
  .max(captureLimits.pageRows * automotiveLimits.framesPerPdu + automotiveLimits.issueFrameSamples);
