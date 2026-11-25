import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CaptureReference,
  captureFileLimits,
  captureLimits,
  captureLineageLimits,
  captureReferenceSchema,
  type WiresharkCaptureArgs,
} from "@vera/shared";
import { z } from "zod";
import { CaptureError } from "./native.js";
import { snapshotCaptureLineage } from "./storage.js";

const frame = z.number().int().min(1).max(captureLimits.scanFrames);
const range = z.tuple([
  frame,
  z
    .number()
    .int()
    .min(0)
    .max(captureFileLimits.inputs - 1),
  frame,
  frame,
]);
const emitting = z.tuple([frame, frame, z.enum(["native_origin", "exact_packet"])]);
export type CaptureLineageRange = z.infer<typeof range>;
export type CaptureEmittingFrame = z.infer<typeof emitting>;

const storedLineage = z.strictObject({
  format: z.literal(1),
  sources: z.array(captureReferenceSchema.shape.sha256).min(1).max(captureFileLimits.inputs),
  outputs: z
    .array(
      z.strictObject({
        capture: captureReferenceSchema,
        lineage: z.discriminatedUnion("kind", [
          z.strictObject({
            kind: z.literal("packet_ranges"),
            rows: z.array(range).max(captureLimits.scanFrames),
            unavailable: z.number().int().min(0).max(captureLimits.scanFrames),
          }),
          z.strictObject({
            kind: z.literal("pdu_emissions"),
            rows: z.array(emitting).max(captureLimits.scanFrames),
            unavailable: z.number().int().min(0).max(captureLimits.scanFrames),
          }),
        ]),
      }),
    )
    .min(1)
    .max(captureFileLimits.parts),
});
type Output = z.infer<typeof storedLineage>["outputs"][number];

/** Stage all verified mappings in the same private directory as the corresponding captures. */
export async function stageCaptureLineage(
  directory: string,
  sources: CaptureReference[],
  outputs: Output[],
  signal: AbortSignal,
) {
  const data = Buffer.from(
    JSON.stringify({ format: 1, sources: sources.map(({ sha256 }) => sha256), outputs }),
  );
  if (data.length > captureLineageLimits.bytes)
    throw new CaptureError(
      "capture_lineage_limit",
      "The capture lineage exceeds the host budget. Select fewer packets.",
    );
  const input = join(directory, "lineage.json");
  await writeFile(input, data, { flag: "wx", mode: 0o600, signal });
  return {
    input,
    reference: { bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") },
  };
}

export async function readCaptureLineage(
  root: string,
  directory: string,
  args: Extract<WiresharkCaptureArgs, { operation: "file_lineage" }>,
  signal: AbortSignal,
) {
  const target = join(directory, "lineage.json");
  await snapshotCaptureLineage(root, args.report, target, signal);
  const data = await readFile(target, { signal });
  const invalid = () =>
    new CaptureError("capture_lineage_invalid", "The requested lineage report is invalid.");
  if (
    data.length !== args.report.bytes ||
    createHash("sha256").update(data).digest("hex") !== args.report.sha256
  )
    throw invalid();
  let parsed: unknown;
  try {
    parsed = JSON.parse(data.toString("utf8"));
  } catch {
    throw invalid();
  }
  const report = storedLineage.safeParse(parsed);
  if (!report.success) throw invalid();
  const output = report.data.outputs[args.part - 1];
  const offset = args.offset ?? 0;
  if (!output || offset > output.lineage.rows.length)
    throw new CaptureError(
      "capture_lineage_range",
      "Use an output part and offset reported for this lineage.",
    );
  const { kind, rows, unavailable } = output.lineage;
  const page = rows.slice(offset, offset + captureLineageLimits.pageRows);
  return {
    capture: output.capture,
    report: args.report,
    part: args.part,
    sourceSha256: report.data.sources,
    kind,
    rows: page,
    unavailable,
    total: rows.length,
    offset,
    nextOffset: offset + page.length < rows.length ? offset + page.length : null,
  };
}
