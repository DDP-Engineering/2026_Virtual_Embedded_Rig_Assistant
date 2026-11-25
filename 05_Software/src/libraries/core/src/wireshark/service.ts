import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import {
  type CaptureAnalysis,
  type CaptureCoverage,
  type CapturePacket,
  type CaptureReference,
  captureLimits,
  type WiresharkCaptureArgs,
  wiresharkPluginId,
  wiresharkProfile,
} from "@vera/shared";
import type { ProgramHost } from "../plugins/program-tools.js";
import type { LoadedPlugin } from "../plugins/store.js";
import type { ToolContext } from "../tools/context.js";
import { toolLimit } from "../tools/context.js";
import { analyzeAutomotive, automotiveCapabilities, automotiveDecodeAs } from "./automotive.js";
import { captureCitation } from "./citations.js";
import { CaptureError, emptyPcap, OfflineTshark, selectedFields } from "./native.js";
import { publishCapture, snapshotCapture } from "./storage.js";
import { analyzeTraffic, trafficCapabilities } from "./traffic-analysis.js";

type Query = Extract<WiresharkCaptureArgs, { operation: "query" }>;
const installations = new WeakMap<ProgramHost["runner"], number>();

export function officialCapturePlugin({ manifest, record }: Pick<LoadedPlugin, "manifest" | "record">) {
  return manifest.id === wiresharkPluginId && record.tier === "official";
}

function analysisFor(args: WiresharkCaptureArgs, version: string): CaptureAnalysis {
  const decodeAs =
    args.operation === "automotive"
      ? automotiveDecodeAs(args)
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
    filter: "filter" in args ? (args.filter ?? null) : null,
    ...(args.operation === "automotive" ? { automotiveProfile: args.automotiveProfile } : {}),
    ...(args.operation === "statistics" || args.operation === "follow" || args.operation === "automotive"
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
    { operation: "capabilities" | "validate_filter" | "discover" | "verify_reference" }
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
  const capture = await snapshotCapture(ctx, source, snapshot, signal);
  const scanLimit =
    args.operation === "frame"
      ? args.frame
      : (("scanFrames" in args ? args.scanFrames : undefined) ?? captureLimits.scanFrames);
  if (args.operation === "frame" && scanLimit > captureLimits.scanFrames)
    throw new CaptureError(
      "frame_scan_limit",
      "The frame exceeds the host scan limit. Use a smaller capture.",
    );
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
  const fields = "fields" in args ? selectedFields(args.fields) : selectedFields();
  if (analysis.filter || analysis.decodeAs.length) await native.validate(analysis);
  const lastPosition = scanLimit + 1;
  const all = await native.numbers(snapshot, analysis, lastPosition);
  const lastSeen = all.at(-1) ?? 0;
  const scanComplete = lastSeen < lastPosition;
  const scannedThrough = Math.min(lastSeen, scanLimit);
  const coverage: CaptureCoverage = {
    scope: args.operation === "frame" ? "single_frame" : analysis.filter ? "display_filter" : "capture",
    scannedThrough,
    scanLimit,
    scanComplete,
    matchedInScope: scannedThrough,
    returned: 0,
    partial: !scanComplete && args.operation !== "frame",
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
  if (args.operation === "frame") {
    if (args.frame > scannedThrough)
      throw new CaptureError(
        "frame_not_found",
        "The requested frame is absent. Check the capture reference and frame number.",
      );
    const [packet] = await native.packets(snapshot, analysis, [args.frame], fields, capture.sha256);
    if (!packet) throw new CaptureError("frame_not_found", "The requested frame is absent.");
    return {
      capture,
      analysis,
      fields,
      packet: { ...packet, ref: captureCitation(capture, packet.frame, analysis) },
      coverage: {
        ...coverage,
        matchedInScope: 1,
        returned: 1,
        partial: packet.truncated,
        truncated: packet.truncated,
      },
      packetData: "untrusted_capture_data",
    };
  }
  if (args.operation !== "query")
    throw new CaptureError("storage_read_only", "Capture storage is unavailable.");
  const querySha256 = createHash("sha256")
    .update(JSON.stringify({ capture, analysis, fields, scanLimit, limit: args.limit ?? 12 }))
    .digest("hex");
  if (args.cursor && args.cursor.querySha256 !== querySha256)
    throw new CaptureError(
      "cursor_mismatch",
      "This cursor belongs to a different capture or query. Start at the first page.",
    );
  const inScope = analysis.filter
    ? await native.numbers(snapshot, analysis, scanLimit, analysis.filter)
    : all.filter((number) => number <= scanLimit);
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
export async function inspectWireshark(ctx: ToolContext, args: WiresharkCaptureArgs, signal: AbortSignal) {
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
    if (args.operation === "verify_reference") {
      const capture = await snapshotCapture(ctx, args.source, undefined, bounded);
      await authorize();
      return requireResultBudget({ capture, verified: true }, toolLimit(ctx, "toolResultChars"));
    }
    const resolved = await host.resolver.resolve(plugin, "tshark", bounded);
    const isolated = process.getuid?.() !== 0;
    const usable =
      isolated &&
      resolved &&
      isAbsolute(resolved.executable) &&
      !resolved.launcher &&
      !resolved.prefix?.length &&
      !Object.keys(resolved.env ?? {}).length &&
      resolved.version &&
      /^\d+\.\d+\.\d+$/.test(resolved.version);
    if (args.operation === "capabilities") {
      await authorize();
      return {
        tshark: usable
          ? { available: true, version: resolved.version }
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
        traffic: usable ? trafficCapabilities : { available: false },
        automotive: usable ? automotiveCapabilities : { available: false },
      };
    }
    if (!isolated)
      throw new CaptureError(
        "profile_unavailable",
        "Run VERA without elevated Linux privileges to isolate the Wireshark profile.",
      );
    if (!usable)
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
      throw new CaptureError("capture_deadline", "Offline analysis timed out. Narrow the capture or filter.");
    if (error instanceof CaptureError) throw error;
    throw new CaptureError(
      "capture_failed",
      "Offline analysis failed. Check the workbench and TShark installation.",
    );
  } finally {
    if (folder) await rm(folder, { recursive: true, force: true }).catch(() => {});
    const count = installations.get(host.runner) ?? 1;
    if (count <= 1) installations.delete(host.runner);
    else installations.set(host.runner, count - 1);
  }
}
