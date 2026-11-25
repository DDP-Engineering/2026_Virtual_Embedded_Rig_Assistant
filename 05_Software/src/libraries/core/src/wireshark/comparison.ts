import { join } from "node:path";
import {
  type CaptureAnalysis,
  type CaptureComparisonResult,
  captureLimits,
  type WiresharkCaptureArgs,
} from "@vera/shared";
import { type ToolContext, toolLimit } from "../tools/context.js";
import { type ComparisonGroup, comparisonFields, observeComparisonSide } from "./comparison-observations.js";
import { fitComparisonReport } from "./comparison-report.js";
import { CaptureError, type OfflineTshark } from "./native.js";
import { snapshotCapture } from "./storage.js";

type Args = Extract<WiresharkCaptureArgs, { operation: "compare" }>;
type View = CaptureComparisonResult["comparison"];
type Row = View["rows"][number];
type Timing = NonNullable<Row["baseline"]>["dns"];
const timingProtocols = ["dns", "http"] as const;
const duration = ({ startMs, endMs }: Args["baseline"]["window"]) => endMs - startMs;

function timingChanged(before: NonNullable<Timing>, after: NonNullable<Timing>, toleranceUs: number) {
  return (
    before.samples !== after.samples ||
    (["minMs", "medianMs", "p95Ms", "maxMs"] as const).some((key) => {
      const difference = Math.abs((before[key] ?? 0) - (after[key] ?? 0));
      return Math.round(difference * 1_000_000_000) > toleranceUs * 1_000_000;
    })
  );
}

function compareObservations(
  before: ComparisonGroup,
  after: ComparisonGroup,
  tolerance: number | null,
): Pick<Row, "metrics" | "withheldTiming"> {
  const baseline = before.observation;
  const candidate = after.observation;
  const metrics: Row["metrics"] = [];
  const withheldTiming: Row["withheldTiming"] = [];
  if (
    (["aToB", "bToA"] as const).some(
      (key) =>
        baseline[key].packets !== candidate[key].packets ||
        baseline[key].wireBytes !== candidate[key].wireBytes,
    )
  )
    metrics.push("volume");
  if (baseline.retransmissions !== candidate.retransmissions) metrics.push("retransmissions");
  for (const protocol of timingProtocols) {
    const first = baseline[protocol];
    const second = candidate[protocol];
    if (!first && !second) continue;
    if (
      !first ||
      !second ||
      first.samples < 2 ||
      second.samples < 2 ||
      first.unpaired ||
      second.unpaired ||
      tolerance === null
    ) {
      withheldTiming.push(protocol);
    } else if (timingChanged(first, second, tolerance)) {
      metrics.push(protocol);
    }
  }
  return { metrics, withheldTiming };
}

function compareSides(
  baseline: Awaited<ReturnType<typeof observeComparisonSide>>,
  candidate: Awaited<ReturnType<typeof observeComparisonSide>>,
  args: Args,
  scanLimit: number,
): View {
  const diagnostics: View["diagnostics"] = [];
  const totals: View["totals"] = {
    compared: 0,
    added: 0,
    missing: 0,
    changed: 0,
    unmatched: 0,
    timingUnavailable: 0,
  };
  const rows: Row[] = [];
  const compatible = duration(baseline.side.window) === duration(candidate.side.window);
  if (!compatible) diagnostics.push("window_duration_mismatch");
  const complete = compatible && baseline.complete && candidate.complete;
  const unresolved = new Set([
    ...baseline.side.coverage.unresolvedTransports,
    ...candidate.side.coverage.unresolvedTransports,
  ]);
  const aError = baseline.side.timingUncertaintyUs;
  const bError = candidate.side.timingUncertaintyUs;
  const tolerance = aError === null || bError === null ? null : aError + bError;
  if (tolerance === null) diagnostics.push("clock_uncertainty_unknown");

  let timingObserved = false;
  let timingInsufficient = false;
  const keys = new Set([...baseline.observations.keys(), ...candidate.observations.keys()]);
  for (const key of [...keys].sort()) {
    const before = baseline.observations.get(key);
    const after = candidate.observations.get(key);
    const group = before ?? after;
    if (!group) continue;
    const { transport, vlans, endpoints } = group;
    const row: Row = {
      kind: "unmatched",
      transport,
      vlans,
      endpoints,
      metrics: [],
      withheldTiming: [],
      baseline: before?.observation ?? null,
      candidate: after?.observation ?? null,
    };
    timingObserved ||= timingProtocols.some(
      (protocol) => row.baseline?.[protocol] || row.candidate?.[protocol],
    );
    if (
      before?.ambiguous ||
      after?.ambiguous ||
      before?.observation.nativeContextShared ||
      after?.observation.nativeContextShared ||
      !complete ||
      unresolved.has(transport)
    ) {
      totals.unmatched++;
    } else if (before && after) {
      totals.compared++;
      Object.assign(row, compareObservations(before, after, tolerance));
      if (row.withheldTiming.length) {
        totals.timingUnavailable++;
        timingInsufficient ||= row.withheldTiming.some((protocol) => {
          const first = before.observation[protocol];
          const second = after.observation[protocol];
          return (
            !first ||
            !second ||
            first.samples < 2 ||
            second.samples < 2 ||
            !!first.unpaired ||
            !!second.unpaired
          );
        });
      }
      if (row.metrics.length) {
        row.kind = "changed";
        totals.changed++;
      } else if (row.withheldTiming.length) {
        row.kind = "timing_unavailable";
      } else {
        continue;
      }
    } else {
      row.kind = before ? "missing" : "added";
      totals[row.kind]++;
    }
    rows.push(row);
  }
  if (!timingObserved) diagnostics.push("timing_unobserved");
  if (timingInsufficient) diagnostics.push("timing_insufficient");

  const partial = unresolved.size > 0 || totals.unmatched > 0 || totals.timingUnavailable > 0;
  const changed = totals.added + totals.missing + totals.changed > 0;
  return {
    format: 1,
    status: !complete ? "incomparable" : partial ? "partial" : changed ? "different" : "equivalent",
    matchRule: "exact_ip_port_pair_transport_ordered_vlan_single_stream",
    timeBasis: "first_timestamped_frame_half_open",
    transports: [...args.transports].sort(),
    scanLimit,
    timingToleranceUs: tolerance,
    reportLocale: args.reportLocale ?? "en",
    diagnostics,
    baseline: baseline.side,
    candidate: candidate.side,
    totals,
    omittedRows: Math.max(0, rows.length - (args.limit ?? 12)),
    rows: rows.slice(0, args.limit ?? 12),
  };
}

/** Compare immutable snapshots within the declared saved-capture scope. */
export async function compareCaptures(
  ctx: ToolContext,
  args: Args,
  native: OfflineTshark,
  analysis: CaptureAnalysis,
  scratch: string,
  signal: AbortSignal,
) {
  const scanLimit = args.scanFrames ?? captureLimits.scanFrames;
  const baselinePath = join(scratch, "baseline.capture");
  const candidatePath = join(scratch, "candidate.capture");
  const baseline = await snapshotCapture(ctx, args.baseline.source, baselinePath, signal);
  const candidate = await snapshotCapture(ctx, args.candidate.source, candidatePath, signal);
  await native.validate(analysis, comparisonFields);
  const before = await observeComparisonSide(
    args.baseline,
    args.transports,
    { capture: baseline, snapshot: baselinePath },
    analysis,
    native,
    scanLimit,
    signal,
  );
  const after = await observeComparisonSide(
    args.candidate,
    args.transports,
    { capture: candidate, snapshot: candidatePath },
    analysis,
    native,
    scanLimit,
    signal,
  );
  const result: CaptureComparisonResult = {
    analysis,
    comparison: compareSides(before, after, args, scanLimit),
    report: "",
    packetData: "untrusted_capture_data",
  };
  if (!fitComparisonReport(result, toolLimit(ctx, "toolResultChars")))
    throw new CaptureError("result_limit", "The comparison and report exceed the host result budget.");
  return result;
}
