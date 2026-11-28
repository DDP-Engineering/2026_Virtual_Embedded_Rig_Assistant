import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type CaptureAnalysis,
  type CaptureCoverage,
  type CaptureDecodeAs,
  type CapturePacket,
  type CaptureReference,
  captureLimits,
  type DeriveCaptureArgs,
  type WiresharkCaptureArgs,
  wiresharkPluginId,
  wiresharkProfile,
} from "@vera/shared";
import type { ProgramHost } from "../plugins/program-tools.js";
import type { LoadedPlugin } from "../plugins/store.js";
import type { ToolContext } from "../tools/context.js";
import { toolLimit } from "../tools/context.js";
import { analyzeAutomotive, automotiveCapabilities, automotiveDecodeAs } from "./automotive.js";
import { readCaptureLineage } from "./capture-file-lineage.js";
import { captureFileOperation, isCaptureFileOperation } from "./capture-files.js";
import { CaptureFileNative, fileUtilityCapabilities, resolveFilePrograms } from "./capture-files-native.js";
import { importHexdump } from "./capture-hexdump.js";
import { captureCitation } from "./citations.js";
import { compareCaptures } from "./comparison.js";
import { analyzeMedia, mediaCapabilities } from "./media.js";
import { CaptureError, emptyPcap, OfflineTshark, selectedFields } from "./native.js";
import { analyzeNetworking } from "./network-evidence.js";
import { networkingCapabilities } from "./network-profiles.js";
import { capturePresets } from "./presets.js";
import { publishCapture, snapshotCapture, snapshotKeyLog } from "./storage.js";
import { analyzeTraffic, trafficCapabilities } from "./traffic-analysis.js";

type Query = Extract<WiresharkCaptureArgs, { operation: "query" }>;
const installations = new WeakMap<ProgramHost["runner"], number>();

export function officialCapturePlugin({ manifest, record }: Pick<LoadedPlugin, "manifest" | "record">) {
  return manifest.id === wiresharkPluginId && record.tier === "official";
}

function analysisFor(args: WiresharkCaptureArgs, version: string): CaptureAnalysis {
  const decodeAs: CaptureDecodeAs[] =
    args.operation === "automotive"
      ? automotiveDecodeAs(args)
      : args.operation === "media" && args.rtpPort !== undefined
        ? [{ transport: "udp", port: args.rtpPort, protocol: "rtp" }]
        : "decodeAs" in args
          ? (args.decodeAs ?? [])
          : [];
  const selectors = decodeAs.map(({ transport, port }) => `${transport}:${port}`);
  if (new Set(selectors).size !== selectors.length)
    throw new CaptureError("invalid_decode_as", "Use one Decode As protocol per transport and port.");
  return {
    tool: "tshark",
    version,
    profile: wiresharkProfile,
    decodeAs,
    // A query that names a protocol preset and no filter of its own reads that protocol's frames.
    filter:
      ("filter" in args ? args.filter : undefined) ??
      (args.operation === "query" && args.preset ? capturePresets[args.preset].filter : null),
    ...(args.operation === "automotive" ? { automotiveProfile: args.automotiveProfile } : {}),
    ...(args.operation === "network" ? { networkProfile: args.networkProfile } : {}),
    ...(args.operation === "media" ? { mediaProfile: args.mediaProfile } : {}),
    ...(args.operation === "compare" ? { networkProfile: "tcp_udp" as const } : {}),
    ...(args.operation === "statistics" ||
    args.operation === "follow" ||
    args.operation === "automotive" ||
    args.operation === "network" ||
    args.operation === "compare"
      ? {
          trafficPreferences: {
            tcpSequenceAnalysis: true,
            tcpDesegmentation: true,
            tcpReassembleOutOfOrder: false,
            httpDesegmentation: true,
            dnsDesegmentation: true,
            validateChecksums: "validateChecksums" in args ? (args.validateChecksums ?? false) : false,
          },
        }
      : {}),
  };
}

function unauthorized() {
  return new CaptureError(
    "plugin_unavailable",
    "Enable the verified official Wireshark plugin in this workbench.",
  );
}

function requireResultBudget(result: Record<string, unknown>, max: number) {
  if (JSON.stringify(result).length > max)
    throw new CaptureError(
      "result_limit",
      "The result exceeds the host limit. Request fewer fields or a smaller page.",
    );
  return result;
}

function packetPage(
  args: Query,
  capture: CaptureReference,
  analysis: CaptureAnalysis,
  coverage: CaptureCoverage,
  fields: string[],
  querySha256: string,
  packets: CapturePacket[],
  remaining: number,
  max: number,
) {
  const limit = args.limit ?? 12;
  while (true) {
    const last = packets.at(-1)?.frame.number;
    const more = remaining > packets.length;
    const truncated =
      packets.some((packet) => packet.truncated) || packets.length < Math.min(remaining, limit);
    const result = {
      capture,
      analysis,
      fields,
      packets,
      coverage: {
        ...coverage,
        returned: packets.length,
        partial: coverage.partial || more || truncated,
        truncated,
      },
      page: {
        querySha256,
        limit,
        afterFrame: args.cursor?.afterFrame ?? 0,
        next: more && last !== undefined ? { querySha256, afterFrame: last } : null,
      },
      packetData: "untrusted_capture_data",
    };
    if (JSON.stringify(result).length <= max) return result;
    if (packets.length <= 1) return requireResultBudget(result, max);
    packets.pop();
  }
}

async function captureOperation(
  ctx: ToolContext,
  args: Exclude<
    WiresharkCaptureArgs,
    {
      operation:
        | "capabilities"
        | "validate_filter"
        | "discover"
        | "verify_reference"
        | "file_metadata"
        | "file_lineage"
        | "compare";
    }
  >,
  native: OfflineTshark,
  analysis: CaptureAnalysis,
  scratch: string,
  signal: AbortSignal,
  authorize: () => Promise<void>,
) {
  const snapshot = join(scratch, "input.capture");
  const source = args.operation === "import" ? { path: args.path } : args.source;
  const writeAccess = args.operation === "import" ? ctx.artifacts : undefined;
  function assertWritable() {
    if (!writeAccess || ctx.permissionMode?.() === "read-only")
      throw new CaptureError(
        "storage_read_only",
        "Use a writable workbench and a session with write access to import captures.",
      );
    try {
      writeAccess.assertWritable();
    } catch {
      throw new CaptureError("storage_read_only", "Use a writable workbench to import captures.");
    }
  }
  if (args.operation === "import") assertWritable();
  // A capture that is only read may be larger than one that is retained.
  const capture = await snapshotCapture(
    ctx,
    source,
    snapshot,
    signal,
    args.operation === "import" ? captureLimits.captureBytes : captureLimits.analysisBytes,
  );
  const scanLimit =
    args.operation === "frame"
      ? args.frame
      : (("scanFrames" in args ? args.scanFrames : undefined) ?? captureLimits.scanFrames);
  if ("tlsKeylog" in args && args.tlsKeylog) {
    // TShark decrypts with a private copy of the key log; its hash is part of what the frames are cited with.
    const keys = join(scratch, "tls-keys.log");
    analysis.tlsKeylog = (await snapshotKeyLog(ctx, args.tlsKeylog, keys, signal)).sha256;
    native.prefer(["-o", `tls.keylog_file:${keys}`]);
  }
  if (args.operation === "statistics" || args.operation === "follow")
    return analyzeTraffic(
      args,
      capture,
      analysis,
      native,
      snapshot,
      scanLimit,
      toolLimit(ctx, "toolResultChars"),
    );
  if (args.operation === "automotive")
    return analyzeAutomotive(
      args,
      capture,
      analysis,
      native,
      snapshot,
      scanLimit,
      toolLimit(ctx, "toolResultChars"),
    );
  if (args.operation === "network")
    return analyzeNetworking(
      args,
      capture,
      analysis,
      native,
      snapshot,
      scanLimit,
      toolLimit(ctx, "toolResultChars"),
      signal,
    );
  if (args.operation === "media")
    return analyzeMedia(
      args,
      capture,
      analysis,
      native,
      snapshot,
      scanLimit,
      toolLimit(ctx, "toolResultChars"),
      signal,
    );
  const chosen = "fields" in args ? args.fields : undefined;
  const preset = args.operation === "query" && args.preset ? capturePresets[args.preset] : undefined;
  let fields = selectedFields(chosen ?? preset?.fields);
  if (analysis.filter || analysis.decodeAs.length || chosen || preset) {
    try {
      await native.validate(analysis, fields);
    } catch (error) {
      // A preset names the fields of current releases: an older TShark reads the capture without those it lacks.
      if (
        !preset ||
        chosen ||
        !(error instanceof CaptureError) ||
        error.reason !== "field_unavailable" ||
        !error.fields.length
      )
        throw error;
      fields = fields.filter((name) => !error.fields.includes(name));
      if (!fields.length) throw error;
      await native.validate(analysis, fields);
    }
  }
  if (args.operation === "frame") {
    // One frame is read directly, wherever it lies in the capture.
    const [packet] = await native.packets(snapshot, analysis, [args.frame], fields, capture.sha256);
    if (!packet)
      throw new CaptureError(
        "frame_not_found",
        "The requested frame is absent. Check the capture reference and frame number.",
      );
    return {
      capture,
      analysis,
      fields,
      packet: { ...packet, ref: captureCitation(capture, packet.frame, analysis) },
      ...(args.tree ? { tree: await native.frameText(snapshot, analysis, args.frame, "tree") } : {}),
      ...(args.bytes ? { hex: await native.frameText(snapshot, analysis, args.frame, "bytes") } : {}),
      coverage: {
        scope: "single_frame",
        scannedThrough: args.frame,
        scanLimit,
        scanComplete: false,
        matchedInScope: 1,
        returned: 1,
        partial: packet.truncated,
        truncated: packet.truncated,
      } satisfies CaptureCoverage,
      packetData: "untrusted_capture_data",
    };
  }
  // The scan window: the `scanLimit` frames after frame `scanFrom`.
  const scanFrom = "scanFrom" in args ? (args.scanFrom ?? 0) : 0;
  const windowEnd = scanFrom + scanLimit;
  const all = await native.numbers(snapshot, analysis, windowEnd + 1, undefined, scanFrom);
  const lastSeen = all.at(-1) ?? 0;
  const scanComplete = lastSeen <= windowEnd;
  const inWindow = all.filter((number) => number <= windowEnd);
  const scannedThrough = inWindow.at(-1) ?? 0;
  const coverage: CaptureCoverage = {
    scope: analysis.filter ? "display_filter" : "capture",
    ...(scanFrom ? { scanFrom } : {}),
    scannedThrough,
    scanLimit,
    scanComplete,
    matchedInScope: inWindow.length,
    returned: 0,
    partial: !scanComplete || scanFrom > 0,
    truncated: false,
  };
  if (args.operation === "import" && writeAccess) {
    if (!scanComplete)
      throw new CaptureError(
        "capture_scan_limit",
        "Import requires complete validation. Select a capture within the host frame limit.",
      );
    const reference = await publishCapture(
      ctx.root,
      { queue: writeAccess.queue, assertWritable },
      snapshot,
      capture,
      signal,
      authorize,
    );
    return { capture: reference, analysis, coverage };
  }
  if (args.operation === "inspect") return { capture, analysis, coverage };
  if (args.operation !== "query")
    throw new CaptureError("storage_read_only", "Capture storage is unavailable.");
  const querySha256 = createHash("sha256")
    .update(JSON.stringify({ capture, analysis, fields, scanLimit, scanFrom, limit: args.limit ?? 12 }))
    .digest("hex");
  if (args.cursor && args.cursor.querySha256 !== querySha256)
    throw new CaptureError(
      "cursor_mismatch",
      "This cursor belongs to a different capture or query. Start at the first page.",
    );
  const inScope = analysis.filter
    ? await native.numbers(snapshot, analysis, windowEnd, analysis.filter, scanFrom)
    : inWindow;
  if (args.cursor && !inScope.includes(args.cursor.afterFrame))
    throw new CaptureError(
      "cursor_mismatch",
      "The cursor is outside the matching range. Start at the first page.",
    );
  const remaining = inScope.filter((number) => number > (args.cursor?.afterFrame ?? 0));
  const packets = (
    await native.packets(snapshot, analysis, remaining.slice(0, args.limit ?? 12), fields, capture.sha256)
  ).map((packet) => ({ ...packet, ref: captureCitation(capture, packet.frame, analysis) }));
  return packetPage(
    args,
    capture,
    analysis,
    { ...coverage, matchedInScope: inScope.length },
    fields,
    querySha256,
    packets,
    remaining.length,
    toolLimit(ctx, "toolResultChars"),
  );
}

/** Run one model operation with bounded scratch, native output and result projection. */
export async function inspectWireshark(
  ctx: ToolContext,
  args: WiresharkCaptureArgs | DeriveCaptureArgs,
  signal: AbortSignal,
) {
  const host = ctx.programs?.host;
  if (!host) throw unauthorized();
  const deadline = AbortSignal.timeout(captureLimits.deadlineMs);
  const bounded = AbortSignal.any([deadline, signal]);
  const authorize = async () => {
    bounded.throwIfAborted();
    const plugin = (await host.plugins(bounded)).find(officialCapturePlugin);
    if (!plugin || plugin.record.sha256 !== ctx.wiresharkPackage) throw unauthorized();
    await plugin.verify?.();
    bounded.throwIfAborted();
    return plugin;
  };
  const active = installations.get(host.runner) ?? 0;
  if (active >= 3)
    throw new CaptureError(
      "capture_busy",
      "Offline analysis is busy. Retry after a current capture finishes.",
    );
  installations.set(host.runner, active + 1);
  let folder: string | undefined;
  try {
    const plugin = await authorize();
    if (args.operation === "file_lineage") {
      folder = await mkdtemp(join(tmpdir(), "vera-offline-"));
      const result = await readCaptureLineage(ctx.root, folder, args, bounded);
      await authorize();
      return requireResultBudget(result, toolLimit(ctx, "toolResultChars"));
    }
    if (isCaptureFileOperation(args)) {
      folder = await mkdtemp(join(tmpdir(), "vera-offline-"));
      await writeFile(join(folder, "empty.pcap"), emptyPcap, { mode: 0o600, flag: "wx" });
      const result = await captureFileOperation(ctx, args, host, plugin, folder, bounded, authorize);
      return args.operation === "file_metadata"
        ? requireResultBudget(result, toolLimit(ctx, "toolResultChars"))
        : result;
    }
    if (args.operation === "import_hexdump") {
      folder = await mkdtemp(join(tmpdir(), "vera-offline-"));
      return await importHexdump(ctx, args, host, plugin, folder, bounded, authorize);
    }
    if (args.operation === "verify_reference") {
      const capture = await snapshotCapture(ctx, args.source, undefined, bounded);
      await authorize();
      return requireResultBudget({ capture, verified: true }, toolLimit(ctx, "toolResultChars"));
    }
    const isolated = process.getuid?.() !== 0;
    if (args.operation === "capabilities") {
      const filePrograms = await resolveFilePrograms(
        host,
        plugin,
        ["capinfos", "editcap", "mergecap", "text2pcap", "tshark"],
        bounded,
      );
      const usable = filePrograms.tshark;
      let features = { clean: false, taps: [] as string[], httpObjects: false };
      if (filePrograms.editcap || usable) {
        folder = await mkdtemp(join(tmpdir(), "vera-offline-"));
        await writeFile(join(folder, "empty.pcap"), emptyPcap, { mode: 0o600, flag: "wx" });
        features = await new CaptureFileNative(host.runner, filePrograms, folder, bounded).features();
      }
      await authorize();
      return {
        tshark: usable
          ? { available: true, version: usable.version }
          : {
              available: false,
              reason: isolated
                ? "Install TShark through Wireshark or your distribution and check plugin dependencies."
                : "Run VERA without elevated Linux privileges to isolate the Wireshark profile.",
            },
        managedStorage: {
          readable: true,
          writable: !!ctx.artifacts && ctx.permissionMode?.() !== "read-only",
          importAvailable: !!usable && !!ctx.artifacts && ctx.permissionMode?.() !== "read-only",
        },
        profile: wiresharkProfile,
        limits: captureLimits,
        presets: usable ? Object.keys(capturePresets) : [],
        tlsKeylog: !!usable,
        traffic: usable ? trafficCapabilities : { available: false },
        automotive: usable ? automotiveCapabilities : { available: false },
        networking: usable ? networkingCapabilities : { available: false },
        media: usable ? mediaCapabilities : { available: false },
        comparison: usable
          ? { available: true, transports: ["tcp", "udp"], timing: ["dns", "http"] }
          : { available: false },
        ...fileUtilityCapabilities(
          filePrograms,
          features,
          !!ctx.artifacts && ctx.permissionMode?.() !== "read-only",
        ),
      };
    }
    if (!isolated)
      throw new CaptureError(
        "profile_unavailable",
        "Run VERA without elevated Linux privileges to isolate the Wireshark profile.",
      );
    const { tshark: resolved } = await resolveFilePrograms(host, plugin, ["tshark"], bounded);
    if (!resolved)
      throw new CaptureError(
        "tshark_unavailable",
        "Install the external TShark CLI, then check the Wireshark plugin dependencies.",
      );
    folder = await mkdtemp(join(tmpdir(), "vera-offline-"));
    await writeFile(join(folder, "empty.pcap"), emptyPcap, { mode: 0o600, flag: "wx" });
    const native = new OfflineTshark(host.runner, resolved.executable, folder, bounded);
    const analysis = analysisFor(args, resolved.version);
    let result: Record<string, unknown>;
    if (args.operation === "discover") {
      const entries = await native.discover(args);
      const offset = args.offset ?? 0;
      const limit = args.limit ?? 20;
      const rows = entries.slice(offset, offset + limit);
      const total = entries.length;
      result = {
        analysis,
        kind: args.kind,
        entries: rows,
        offset,
        limit,
        total,
        nextOffset: offset + rows.length < total ? offset + rows.length : null,
      };
    } else if (args.operation === "validate_filter") {
      await native.validate(analysis);
      result = { valid: true, analysis };
    } else if (args.operation === "compare") {
      result = await compareCaptures(ctx, args, native, analysis, folder, bounded);
    } else {
      result = await captureOperation(ctx, args, native, analysis, folder, bounded, async () => {
        await authorize();
      });
    }
    await authorize();
    return requireResultBudget(result, toolLimit(ctx, "toolResultChars"));
  } catch (error) {
    signal.throwIfAborted();
    if (deadline.aborted)
      throw new CaptureError(
        "capture_deadline",
        args.operation === "import_hexdump"
          ? "Hexdump import timed out. Split the dump and retry."
          : "Offline analysis timed out. Narrow the capture or filter.",
      );
    if (error instanceof CaptureError) throw error;
    throw new CaptureError(
      "capture_failed",
      args.operation === "import_hexdump"
        ? "Hexdump import failed. Check workbench access and the Text2pcap installation."
        : "Offline analysis failed. Check the workbench and TShark installation.",
    );
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {});
    const count = installations.get(host.runner) ?? 1;
    if (count <= 1) installations.delete(host.runner);
    else installations.set(host.runner, count - 1);
  }
}
