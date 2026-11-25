import { createHash, randomUUID } from "node:crypto";
import { basename } from "node:path";
import {
  ARTIFACT_MAX_BYTES,
  type CaptureAnalysis,
  captureFileLimits,
  captureLimits,
  type DeriveCaptureArgs,
} from "@vera/shared";
import { z } from "zod";
import { type ArtifactHost, ArtifactMaskingConflict } from "../artifacts/store.js";
import type { CaptureEmittingFrame } from "./capture-file-lineage.js";
import { type CaptureFileInput, refuseEmbeddedSecrets, verifiedFile } from "./capture-file-transform.js";
import { type CaptureFileNative, httpObjectArguments, pduTaps } from "./capture-files-native.js";
import { CaptureError, type OfflineTshark, selectedFields } from "./native.js";

type Export = Extract<DeriveCaptureArgs, { operation: "export_fields" | "export_objects" }>;
type Pdu = Extract<DeriveCaptureArgs, { operation: "export_pdus" }>;

export async function exportPdus(
  args: Pdu,
  input: CaptureFileInput,
  utility: CaptureFileNative,
  tshark: OfflineTshark,
  analysis: CaptureAnalysis,
) {
  refuseEmbeddedSecrets(input);
  if (args.filter) await tshark.validate(analysis);
  const scoped = args.filter
    ? new Set(await tshark.numbers(input.path, analysis, captureLimits.scanFrames, args.filter))
    : undefined;
  const result = await utility.capture("tshark", [
    "-n",
    "-r",
    basename(input.path),
    ...(args.filter ? ["-Y", args.filter] : []),
    "-U",
    pduTaps[args.tap],
    "-F",
    "pcapng",
    "-w",
    "-",
  ]);
  const file = verifiedFile(result, "pcapng", utility.signal);
  const candidates = input.index.packets.filter(({ number }) => !scoped || scoped.has(number));
  const inputTimes = new Set(candidates.map(({ time }) => time));
  const exactFrames = new Map<string, number | null>();
  for (const { identity, number } of candidates)
    exactFrames.set(identity, exactFrames.has(identity) ? null : number);
  const frames: CaptureEmittingFrame[] = [];
  for (const packet of file.index.packets) {
    const origin = packet.originalFrame === null ? undefined : input.index.packets[packet.originalFrame - 1];
    if (
      !inputTimes.has(packet.time) ||
      (packet.originalFrame !== null &&
        (!origin || origin.time !== packet.time || (scoped && !scoped.has(origin.number))))
    ) {
      throw new CaptureError(
        "derived_verification_failed",
        "TShark exported a PDU inconsistent with the saved capture.",
      );
    }
    if (origin) frames.push([packet.number, origin.number, "native_origin"]);
    else {
      const exact = exactFrames.get(packet.identity);
      if (exact) frames.push([packet.number, exact, "exact_packet"]);
    }
  }
  return {
    file,
    lineage: {
      emittingFrames: frames,
      mapped: frames.length,
      unavailable: file.index.packets.length - frames.length,
    },
  };
}

const httpLayers = z.object({
  "frame.number": z.tuple([z.string().regex(/^[1-9]\d{0,6}$/)]).transform(([n]) => Number(n)),
  "http.file_data": z.array(z.string()),
  "http.content_length": z.array(z.string().regex(/^\d{1,10}$/)).optional(),
  "http.content_encoding": z.array(z.string()).optional(),
  "http.transfer_encoding": z.array(z.string()).optional(),
});
const httpRows = z
  .array(z.object({ _source: z.object({ layers: httpLayers }) }))
  .max(captureLimits.scanFrames);
const invalidExport = () =>
  new CaptureError(
    "native_output_invalid",
    "TShark returned invalid export metadata. Check the installed version and capture.",
  );

async function httpObjects(input: CaptureFileInput, utility: CaptureFileNative) {
  const report = await utility.text(
    "tshark",
    httpObjectArguments(input.path),
    3 * captureFileLimits.objectBytes,
  );
  let decoded: unknown;
  try {
    decoded = JSON.parse(report);
  } catch {
    throw invalidExport();
  }
  const parsed = httpRows.safeParse(decoded);
  if (!parsed.success) throw invalidExport();
  let used = 0;
  let previous = 0;
  let skipped = 0;
  const rows = [];
  for (const {
    _source: { layers },
  } of parsed.data) {
    const frame = layers["frame.number"];
    if (frame <= previous || frame > input.index.packets.length) throw invalidExport();
    previous = frame;
    const [raw] = layers["http.file_data"];
    const [declared] = layers["http.content_length"] ?? [];
    if (
      layers["http.file_data"].length !== 1 ||
      layers["http.content_length"]?.length !== 1 ||
      layers["http.content_encoding"]?.some((value) => value.toLowerCase() !== "identity") ||
      layers["http.transfer_encoding"]?.length ||
      !raw ||
      !/^(?:[a-fA-F0-9]{2})+$/.test(raw) ||
      raw.length / 2 !== Number(declared) ||
      rows.length === captureFileLimits.reportRows ||
      used + raw.length / 2 > captureFileLimits.objectBytes
    ) {
      skipped++;
      continue;
    }
    const bytes = Buffer.from(raw, "hex");
    used += bytes.length;
    rows.push({
      frame,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      contentBase64: bytes.toString("base64"),
    });
  }
  return { rows, scope: "http_complete_content_length_bodies", observed: parsed.data.length, skipped };
}

export async function exportCaptureReport(
  args: Export,
  input: CaptureFileInput,
  utility: CaptureFileNative,
  tshark: OfflineTshark,
  analysis: CaptureAnalysis,
  host: ArtifactHost,
  authorize: () => Promise<unknown>,
  assertWritable: () => void,
) {
  refuseEmbeddedSecrets(input);
  let rows: unknown[];
  let scope: string;
  let observed: number;
  let skipped: number;
  let partial: boolean;
  let parameters: Record<string, unknown>;
  if (args.operation === "export_objects") {
    ({ rows, scope, observed, skipped } = await httpObjects(input, utility));
    partial = true;
    parameters = { protocol: args.protocol };
  } else {
    const fields = selectedFields(args.fields);
    if (args.filter) await tshark.validate(analysis);
    const numbers = await tshark.numbers(input.path, analysis, captureLimits.scanFrames, args.filter);
    if (numbers.some((number) => number > input.index.packets.length)) throw invalidExport();
    const packets = [];
    const retained = numbers.slice(0, captureFileLimits.reportRows);
    for (let i = 0; i < retained.length; i += captureLimits.pageRows) {
      packets.push(
        ...(await tshark.packets(
          input.path,
          analysis,
          retained.slice(i, i + captureLimits.pageRows),
          fields,
          input.reference.sha256,
        )),
      );
    }
    rows = packets;
    observed = numbers.length;
    skipped = observed - rows.length;
    partial = skipped > 0 || packets.some(({ truncated }) => truncated);
    scope = args.filter ? "display_filter" : "capture";
    parameters = { fields, filter: args.filter ?? null };
  }
  const provenance = { operation: args.operation, source: input.reference, analysis, parameters };
  const coverage = { scope, records: rows.length, observed, skipped, partial };
  const content = JSON.stringify({ format: 1, ...provenance, coverage, rows });
  if (Buffer.byteLength(content) > ARTIFACT_MAX_BYTES) throw utility.outputLimit();
  let artifact: Awaited<ReturnType<ArtifactHost["store"]["save"]>>;
  try {
    artifact = await host.store.save(
      { ...host, assertWritable },
      { name: `wireshark-${randomUUID()}.json`, content },
      utility.signal,
      { authorize, exactContent: true },
    );
  } catch (error) {
    if (error instanceof ArtifactMaskingConflict)
      throw new CaptureError(
        "capture_export_masked",
        "The export mask would change the structured data. Select fields or a capture that can be exported under the current mask.",
      );
    throw error;
  }
  return {
    operation: args.operation,
    sources: [input.reference],
    analysis,
    parameters,
    export: { ...coverage, ...artifact },
  };
}
