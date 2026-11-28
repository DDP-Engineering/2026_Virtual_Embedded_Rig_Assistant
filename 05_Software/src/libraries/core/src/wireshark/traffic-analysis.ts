import { createHash } from "node:crypto";
import {
  type CaptureAnalysis,
  type CaptureCoverage,
  type CaptureReference,
  type TrafficStatistic,
  trafficLimits,
  type WiresharkCaptureArgs,
} from "@vera/shared";
import { captureCitation } from "./citations.js";
import {
  diagnosticFields,
  diagnostics,
  responseTiming,
  streamDiagnosticFields,
  timingFields,
} from "./diagnostics.js";
import { CaptureError, invalidOutput, type OfflineTshark } from "./native.js";
import {
  addressFields,
  count,
  counts,
  directionalGroups,
  hierarchies,
  inWindow,
  streamIds,
  trafficIntervals,
  transportFields,
} from "./statistics.js";
import { streams } from "./streams.js";
import {
  readNativeFollow,
  readTrafficFacts,
  readTrafficMatches,
  type TrafficFact,
} from "./traffic-native.js";

type TrafficArgs = Extract<WiresharkCaptureArgs, { operation: "statistics" | "follow" }>;
export const trafficCapabilities = {
  statistics: [
    "protocol_hierarchy",
    "endpoints",
    "conversations",
    "traffic",
    "diagnostics",
    "response_timing",
  ],
  endpointLayers: ["ethernet", "ipv4", "ipv6", "tcp", "udp"],
  timingProtocols: ["dns", "http"],
  followTransports: ["tcp", "udp"],
  payloadView: ["text_per_record", "hex_per_record"],
  nativeSupport: "checked_when_requested",
  limits: trafficLimits,
} as const;

function selectionFields(statistic: TrafficStatistic) {
  switch (statistic.kind) {
    case "protocol_hierarchy":
      return ["frame.protocols"];
    case "endpoints":
    case "conversations": {
      const layer = statistic.layer;
      return [
        "frame.protocols",
        ...addressFields,
        ...(layer === "tcp" || layer === "udp" ? transportFields(layer) : []),
      ];
    }
    case "traffic":
      return [];
    case "diagnostics":
      return diagnosticFields;
    case "response_timing":
      return Object.values(timingFields(statistic.protocol));
  }
}

function measure(
  args: Extract<TrafficArgs, { operation: "statistics" }>,
  scoped: TrafficFact[],
  scanned: TrafficFact[],
) {
  const statistic = args.statistic;
  switch (statistic.kind) {
    case "protocol_hierarchy":
      return hierarchies(scoped);
    case "endpoints":
    case "conversations":
      return directionalGroups(scoped, statistic.layer, statistic.kind);
    case "diagnostics":
      return diagnostics(scoped);
    case "response_timing":
      return responseTiming(scoped, scanned, statistic.protocol);
    case "traffic":
      if (!args.window) throw invalidOutput();
      return trafficIntervals(scoped, args.window, statistic.intervalMs);
  }
}

export function tallyCoverage(scoped: TrafficFact[], scanned: TrafficFact[], window?: TrafficArgs["window"]) {
  const totals = counts();
  const points = new Map<string, { section: number | null; interfaceId: number | null; packets: number }>();
  let truncatedFrames = 0;
  let missingObservationPointFrames = 0;
  let framesWithoutTimestamp = 0;
  let origin: TrafficFact | undefined;
  let min: TrafficFact | undefined;
  let max: TrafficFact | undefined;
  for (const fact of scanned) {
    if (fact.relative === null || fact.frame.timestampEpoch === null) {
      framesWithoutTimestamp++;
      continue;
    }
    origin ??= fact;
    if (min?.relative == null || fact.relative < min.relative) min = fact;
    if (max?.relative == null || fact.relative > max.relative) max = fact;
  }
  for (const fact of scoped) {
    count(totals, fact);
    if (fact.capturedBytes < fact.wireBytes) truncatedFrames++;
    if (fact.section === null || fact.frame.interfaceId === null) missingObservationPointFrames++;
    const interfaceId = fact.frame.interfaceId;
    const key = JSON.stringify([fact.section, interfaceId]);
    const point = points.get(key);
    if (point) point.packets++;
    else points.set(key, { section: fact.section, interfaceId, packets: 1 });
  }
  return {
    totals,
    truncatedFrames,
    missingObservationPointFrames,
    observationPoints: [...points.values()].slice(0, 16),
    omittedObservationPoints: Math.max(0, points.size - 16),
    framesWithoutTimestamp,
    timeOrigin: {
      basis: "first_timestamped_frame",
      frame: origin?.frame.number ?? null,
      timestampEpoch: origin?.frame.timestampEpoch ?? null,
    },
    windowExtendsOutsideScannedTimeRange: window
      ? min?.relative == null ||
        max?.relative == null ||
        min.relative > BigInt(window.startMs) * 1_000_000_000n ||
        max.relative < BigInt(window.endMs) * 1_000_000_000n
      : null,
    scannedTimeRange: {
      earliestObservedTimestampEpoch: min?.frame.timestampEpoch ?? null,
      latestObservedTimestampEpoch: max?.frame.timestampEpoch ?? null,
    },
  };
}

export async function analyzeTraffic(
  args: TrafficArgs,
  capture: CaptureReference,
  analysis: CaptureAnalysis,
  native: OfflineTshark,
  snapshot: string,
  scanLimit: number,
  maxChars: number,
) {
  const window = args.window ?? null;
  if (args.operation === "statistics" && args.statistic.kind === "traffic") {
    if (!window)
      throw new CaptureError(
        "traffic_window_required",
        "Supply a relative time window for interval statistics.",
      );
    if (Math.ceil((window.endMs - window.startMs) / args.statistic.intervalMs) > trafficLimits.intervals)
      throw new CaptureError("traffic_interval_limit", "Use a shorter window or a larger interval.");
  }
  const selection =
    args.operation === "statistics"
      ? args.statistic
      : {
          transport: args.transport,
          stream: args.stream,
          ...(args.payload ? { payload: args.payload } : {}),
        };
  const limit = args.limit ?? 12;
  const querySha256 = createHash("sha256")
    .update(JSON.stringify({ capture, analysis, selection, window, scanLimit, limit }))
    .digest("hex");
  if (args.trafficCursor && args.trafficCursor.querySha256 !== querySha256)
    throw new CaptureError("cursor_mismatch", "This cursor belongs to a different capture or traffic query.");
  if (analysis.filter || analysis.decodeAs.length) await native.validate(analysis);
  const fields =
    args.operation === "statistics"
      ? selectionFields(args.statistic)
      : [
          ...addressFields,
          ...transportFields(args.transport),
          ...(args.transport === "tcp" ? streamDiagnosticFields : []),
        ];
  const facts = await readTrafficFacts(native, snapshot, analysis, scanLimit + 1, fields, capture.sha256);
  const scanComplete = facts.length <= scanLimit;
  const scanned = facts.slice(0, scanLimit);
  const matching =
    analysis.filter && scanned.length
      ? await readTrafficMatches(native, snapshot, analysis, scanLimit, analysis.filter)
      : null;
  if (matching && [...matching].some((frame) => frame > scanned.length)) throw invalidOutput();
  const candidates =
    args.operation === "follow"
      ? scanned.filter((fact) => streamIds(fact, args.transport).includes(args.stream))
      : scanned;
  if (args.operation === "follow" && !candidates.length)
    throw new CaptureError(
      scanComplete ? "stream_not_found" : "stream_not_observed",
      scanComplete
        ? "The stream ID is absent in this capture."
        : "The stream was absent in the scanned prefix.",
    );
  const filtered = candidates.filter((fact) => !matching || matching.has(fact.frame.number));
  const scoped = window ? filtered.filter((fact) => inWindow(fact.relative, window)) : filtered;
  const missingTimeFrames = window ? filtered.filter((fact) => fact.relative === null).length : 0;
  const projection =
    args.operation === "statistics"
      ? measure(args, scoped, scanned)
      : streams(
          candidates,
          scoped,
          await readNativeFollow(native, snapshot, analysis, scanLimit, args.transport, args.stream),
          args.transport,
          args.payload,
        );
  const coverageDetails = tallyCoverage(scoped, scanned, args.window);
  const { timeOrigin, ...scopeDetails } = coverageDetails;
  const totalRows = projection.rows.length;
  const offset = args.trafficCursor?.offset ?? 0;
  if (args.trafficCursor && offset >= totalRows)
    throw new CaptureError("cursor_mismatch", "The cursor is outside the traffic evidence range.");
  const scanLimited = !scanComplete;
  const measurementIncomplete =
    !!projection.incomplete ||
    missingTimeFrames > 0 ||
    (window !== null && coverageDetails.framesWithoutTimestamp > 0) ||
    coverageDetails.windowExtendsOutsideScannedTimeRange === true;
  const rows = projection.rows.slice(offset, offset + limit);
  const summaryFrames = [
    ...new Set([
      ...(projection.summaryFrames ?? []),
      ...(window !== null && timeOrigin.frame !== null ? [timeOrigin.frame] : []),
    ]),
  ];
  while (true) {
    const frameNumbers = [...new Set([...summaryFrames, ...rows.flatMap((row) => row.frames)])];
    const evidence = frameNumbers
      .sort((a, b) => a - b)
      .map((number) => {
        const fact = scanned[number - 1];
        if (!fact) throw invalidOutput();
        return {
          section: fact.section,
          frame: fact.frame,
          ref: captureCitation(capture, fact.frame, analysis),
        };
      });
    const nextOffset = offset + rows.length;
    const next = nextOffset < totalRows ? { querySha256, offset: nextOffset } : null;
    const coverage: CaptureCoverage = {
      scope: analysis.filter ? "display_filter" : "capture",
      scannedThrough: scanned.length,
      scanLimit,
      scanComplete,
      matchedInScope: scoped.length,
      returned: rows.length,
      partial:
        scanLimited ||
        measurementIncomplete ||
        next !== null ||
        offset > 0 ||
        coverageDetails.truncatedFrames > 0,
      truncated: rows.length < Math.min(limit, totalRows - offset) || coverageDetails.truncatedFrames > 0,
    };
    const result = {
      capture,
      analysis,
      traffic: {
        operation: args.operation,
        selection,
        timeOrigin,
        window,
        scopeCoverage: {
          scanLimited,
          measurementIncomplete,
          missingTimeFrames,
          ...scopeDetails,
          limitOfInference: "observed_at_saved_capture_interfaces",
        },
        summary: { ...coverageDetails.totals, ...projection.summary },
        summaryFrames,
        rows,
        evidence,
        page: { querySha256, offset, limit, totalRows, next },
      },
      coverage,
    };
    if (JSON.stringify(result).length <= maxChars) return result;
    if (rows.length <= 1)
      throw new CaptureError(
        "result_limit",
        "Traffic evidence exceeds the result budget. Narrow the selection.",
      );
    rows.pop();
  }
}
