import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type CaptureAnalysis,
  captureFileLimits,
  captureLimits,
  type DeriveCaptureArgs,
  type WiresharkCaptureArgs,
  wiresharkProfile,
} from "@vera/shared";
import type { ProgramHost } from "../plugins/program-tools.js";
import type { LoadedPlugin } from "../plugins/store.js";
import { type ToolContext, toolLimit } from "../tools/context.js";
import { exportCaptureReport, exportPdus } from "./capture-file-export.js";
import { indexCapture } from "./capture-file-index.js";
import { stageCaptureLineage } from "./capture-file-lineage.js";
import { type CaptureFileInput, transformCapture } from "./capture-file-transform.js";
import { CaptureFileNative, fileProgramsFor, resolveFilePrograms } from "./capture-files-native.js";
import { CaptureError, OfflineTshark } from "./native.js";
import { publishCaptures, snapshotCapture } from "./storage.js";

type FileArgs = DeriveCaptureArgs | Extract<WiresharkCaptureArgs, { operation: "file_metadata" }>;
const activeOperations = new Set<string>([
  "file_metadata",
  "select",
  "split",
  "merge",
  "convert",
  "reorder",
  "deduplicate",
  "clean",
  "export_fields",
  "export_pdus",
  "export_objects",
]);

export function isCaptureFileOperation(args: WiresharkCaptureArgs | DeriveCaptureArgs): args is FileArgs {
  return activeOperations.has(args.operation);
}

export async function captureFileOperation(
  ctx: ToolContext,
  args: FileArgs,
  host: ProgramHost,
  plugin: LoadedPlugin,
  folder: string,
  signal: AbortSignal,
  authorize: () => Promise<unknown>,
) {
  const writeAccess = ctx.artifacts;
  function assertWritable() {
    if (!writeAccess || ctx.permissionMode?.() === "read-only")
      throw new CaptureError(
        "storage_read_only",
        "Use a writable workbench and session to create derived captures.",
      );
    try {
      writeAccess.assertWritable();
    } catch {
      throw new CaptureError(
        "storage_read_only",
        "Use a writable workbench and session to create derived captures.",
      );
    }
  }
  if (args.operation !== "file_metadata") assertWritable();
  const required = fileProgramsFor(args);
  const programs = await resolveFilePrograms(host, plugin, required, signal);
  const native = new CaptureFileNative(host.runner, programs, folder, signal);
  for (const name of required) if (!programs[name]) native.require(name);
  const inputArgs = args.operation === "merge" ? args.sources : [args.source];
  const inputs: CaptureFileInput[] = [];
  let remainingBytes: number = captureFileLimits.inputBytes;
  let frames = 0;
  for (const [index, source] of inputArgs.entries()) {
    const path = join(folder, `source-${index + 1}.capture`);
    const reference = await snapshotCapture(ctx, source, path, signal, remainingBytes);
    const bytes = await readFile(path, { signal });
    if (
      bytes.length !== reference.bytes ||
      createHash("sha256").update(bytes).digest("hex") !== reference.sha256
    )
      throw new CaptureError(
        "capture_changed",
        "The source snapshot changed before the operation could start.",
      );
    const audit = indexCapture(bytes, reference.fileFormat, signal);
    frames += audit.packets.length;
    if (frames > captureLimits.scanFrames)
      throw new CaptureError("capture_scan_limit", "The inputs exceed the combined host frame limit.");
    remainingBytes -= reference.bytes;
    inputs.push({ path, reference, index: audit });
  }
  const input = inputs[0];
  if (!input) throw new CaptureError("invalid_capture", "Select a saved source capture.");
  if (args.operation === "file_metadata") {
    const {
      packets,
      interfaces,
      metadata,
      earliestEpoch,
      latestEpoch,
      untimed,
      subnanosecond,
      chronological,
    } = input.index;
    const encapsulation = await native.metadata(input.path, input.reference, packets.length);
    await authorize();
    return {
      capture: input.reference,
      tools: native.versions,
      metadata: {
        format: input.reference.fileFormat,
        encapsulation,
        interfaces,
        packets: packets.length,
        earliestEpoch: subnanosecond ? null : earliestEpoch,
        latestEpoch: subnanosecond ? null : latestEpoch,
        framesWithoutTimestamp: untimed,
        framesWithSubnanosecondPrecision: subnanosecond,
        chronological,
        metadataCounts: metadata,
      },
    };
  }
  if (!writeAccess)
    throw new CaptureError("storage_read_only", "Use a writable workbench to create derived captures.");
  const tshark = () => {
    const versioned = native.require("tshark");
    const filter =
      "filter" in args
        ? args.filter
        : args.operation === "select" && args.selection.kind === "filter"
          ? args.selection.filter
          : undefined;
    const analysis: CaptureAnalysis = {
      tool: "tshark",
      version: versioned.version,
      profile: wiresharkProfile,
      decodeAs: [],
      filter: filter ?? null,
    };
    return { native: new OfflineTshark(host.runner, versioned.executable, folder, signal), analysis };
  };
  if (args.operation === "export_fields" || args.operation === "export_objects") {
    const dissection = tshark();
    return exportCaptureReport(
      args,
      input,
      native,
      dissection.native,
      dissection.analysis,
      writeAccess,
      authorize,
      assertWritable,
    );
  }
  const {
    operation,
    source: _source,
    sources: _sources,
    ...recordedParameters
  } = {
    source: undefined,
    sources: undefined,
    ...args,
  };
  const common = {
    operation,
    parameters: {
      ...recordedParameters,
      outputFormat: ("outputFormat" in args ? args.outputFormat : undefined) ?? "pcapng",
    },
    sources: inputs.map(({ reference }) => reference),
    tools: native.versions,
  };
  if (args.operation === "export_pdus") {
    const dissection = tshark();
    const { file, lineage } = await exportPdus(args, input, native, dissection.native, dissection.analysis);
    const report = await stageCaptureLineage(
      folder,
      common.sources,
      [
        {
          capture: file.reference,
          lineage: { kind: "pdu_emissions", rows: lineage.emittingFrames, unavailable: lineage.unavailable },
        },
      ],
      signal,
    );
    const preview = {
      ...lineage,
      emittingFrames: lineage.emittingFrames.slice(0, captureFileLimits.lineageRanges),
    };
    const result = {
      ...common,
      complete: true,
      analysis: dissection.analysis,
      lineageReport: report.reference,
      outputs: [{ capture: file.reference, packets: file.index.packets.length, lineage: preview }],
    };
    limitResult(result, ctx, () => preview.emittingFrames.pop());
    await publishCaptures(ctx.root, { queue: writeAccess.queue, assertWritable }, [file], signal, authorize, {
      lineage: report,
    });
    return result;
  }
  const transformed = await transformCapture(args, inputs, native, tshark);
  const report = await stageCaptureLineage(
    folder,
    common.sources,
    transformed.files.map(({ reference, lineage }) => ({
      capture: reference,
      lineage: { kind: "packet_ranges", rows: lineage.ranges, unavailable: lineage.ambiguous },
    })),
    signal,
  );
  const outputs = transformed.files.map(({ reference, index, lineage }) => ({
    capture: reference,
    packets: index.packets.length,
    chronological: index.chronological,
    metadataCounts: index.metadata,
    lineage: { ...lineage, ranges: lineage.ranges.slice(0, captureFileLimits.lineageRanges) },
  }));
  const result = {
    ...common,
    complete: true,
    lineageReport: report.reference,
    outputs,
    ...(transformed.removed && {
      removed: transformed.removed,
      packetDataAndIdentifiersMayRemain: transformed.packetDataAndIdentifiersMayRemain,
    }),
  };
  limitResult(result, ctx, () => {
    const widest = outputs.reduce<(typeof outputs)[number] | undefined>(
      (longest, current) =>
        current.lineage.ranges.length > (longest?.lineage.ranges.length ?? 0) ? current : longest,
      undefined,
    );
    return widest?.lineage.ranges.pop();
  });
  await publishCaptures(
    ctx.root,
    { queue: writeAccess.queue, assertWritable },
    transformed.files,
    signal,
    authorize,
    { lineage: report },
  );
  return result;
}

function limitResult(result: Record<string, unknown>, ctx: ToolContext, trim: () => unknown) {
  const max = toolLimit(ctx, "toolResultChars");
  while (JSON.stringify(result).length > max) {
    if (!trim())
      throw new CaptureError(
        "result_limit",
        "Use fewer inputs or parts to keep the result within the host limit.",
      );
  }
}
