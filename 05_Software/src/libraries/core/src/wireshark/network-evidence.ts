import { createHash } from "node:crypto";
import type {
  CaptureAnalysis,
  CaptureNetworkingResult,
  CaptureReference,
  NetworkObservation,
  WiresharkCaptureArgs,
} from "@vera/shared";
import { networkLimits } from "@vera/shared";
import { captureCitation } from "./citations.js";
import { CaptureError, invalidOutput, type OfflineTshark } from "./native.js";
import { requireSecretsFreeCapture } from "./network-capture.js";
import {
  matchesNetworkTransport,
  networkingFields,
  networkProfiles,
  networkProtocol,
  networkSymptoms,
} from "./network-profiles.js";
import {
  dnsRelationship,
  type NetworkFact,
  networkConversations,
  networkObservation,
  observationEndpoints,
  opaqueTls,
  trimNetworkPage,
} from "./network-projection.js";
import { networkReassembly, observationReassembly } from "./network-reassembly.js";
import { tallyCoverage } from "./traffic-analysis.js";
import { protocolStack, readTrafficFacts, readTrafficMatches, type TrafficFact } from "./traffic-native.js";

type NetworkArgs = Extract<WiresharkCaptureArgs, { operation: "network" }>;

export function dropCoverage(scanned: TrafficFact[]) {
  let dropReports = 0;
  let drops = 0n;
  for (const fact of scanned) {
    const [value, ...extra] = fact.get("frame.drop_count");
    if (value === undefined) continue;
    if (extra.length || !/^\d{1,20}$/.test(value) || BigInt(value) > 18_446_744_073_709_551_615n)
      throw invalidOutput();
    dropReports++;
    drops += BigInt(value);
  }
  return { dropReports, knownDrops: dropReports ? drops.toString() : null };
}

function tcpSymptom({ fact, protocol }: NetworkFact) {
  if (protocol !== "tcp") return matchesNetworkTransport(protocol, "tcp");
  return (
    networkSymptoms(fact).length > 0 ||
    fact.get("tcp.checksum.partial").length > 0 ||
    fact.get("tcp.checksum.status").includes("0") ||
    fact.get("tcp.segment.error").length > 0 ||
    fact.capturedBytes < fact.wireBytes
  );
}

/** Project typed observations from the verified local capture without exporting payload. */
export async function analyzeNetworking(
  args: NetworkArgs,
  capture: CaptureReference,
  analysis: CaptureAnalysis,
  native: OfflineTshark,
  snapshot: string,
  scanLimit: number,
  maxChars: number,
  signal: AbortSignal,
): Promise<CaptureNetworkingResult> {
  const profile = args.networkProfile;
  const query = args.networkQuery ?? { kind: "observations" };
  const evidenceMode = args.evidenceMode ?? "observations";
  const compact = evidenceMode === "compact";
  const limit = args.limit ?? 12;
  const querySha256 = createHash("sha256")
    .update(JSON.stringify({ capture, analysis, query, evidenceMode, scanLimit, limit }))
    .digest("hex");
  if (args.networkCursor && args.networkCursor.querySha256 !== querySha256)
    throw new CaptureError(
      "cursor_mismatch",
      "This cursor belongs to a different capture or networking query.",
    );
  await requireSecretsFreeCapture(snapshot, capture, signal);
  const numericFields = networkingFields(profile);
  const textFields = [...networkProfiles[profile].text];
  const selectedFields = [...numericFields, ...textFields];
  await native.validate(analysis, selectedFields);
  const facts = await readTrafficFacts(
    native,
    snapshot,
    analysis,
    scanLimit + 1,
    numericFields,
    capture.sha256,
  );
  const scanComplete = facts.length <= scanLimit;
  const scanned = facts.slice(0, scanLimit);
  const matching =
    analysis.filter && scanned.length
      ? await readTrafficMatches(native, snapshot, analysis, scanLimit, analysis.filter)
      : null;
  if (matching && [...matching].some((number) => number > scanned.length)) throw invalidOutput();

  const candidates: NetworkFact[] = [];
  for (const fact of scanned) {
    if (matching && !matching.has(fact.frame.number)) continue;
    const protocol = networkProtocol(profile, fact, protocolStack(fact));
    if (!protocol) continue;
    if (query.kind === "conversations" && !matchesNetworkTransport(protocol, query.transport)) continue;
    if (query.kind === "tcp_symptoms" && !matchesNetworkTransport(protocol, "tcp")) continue;
    candidates.push({ fact, protocol });
  }
  const offset = args.networkCursor?.offset ?? 0;
  const scope = new Set(candidates.map(({ fact }) => fact.frame.number));
  const { byFrame: reassemblyByFrame, summary: reassembly } = networkReassembly(candidates, scanned, scope);
  const relationships = new Map<number, NonNullable<NetworkObservation["dnsRelationship"]>>();
  const exchanges = query.kind === "exchanges" || query.kind === "observations";
  if (profile === "dns_dhcp" && exchanges) {
    for (const { fact, protocol } of candidates) {
      if (protocol !== "dns") continue;
      const link = dnsRelationship(fact, scanned, scope);
      const counterpart = link.status === "native_link" ? scanned[link.counterpartFrame - 1] : undefined;
      const pending =
        reassemblyByFrame.get(fact.frame.number)?.status.pendingOrInvalid ||
        (counterpart &&
          (
            reassemblyByFrame.get(counterpart.frame.number) ??
            observationReassembly({ fact: counterpart, protocol }, scanned, scope)
          )?.status.pendingOrInvalid);
      relationships.set(fact.frame.number, pending ? { status: "ambiguous_context" } : link);
    }
  }
  const dnsStatuses = [...relationships.values()];
  const conversation =
    query.kind === "conversations"
      ? networkConversations(candidates, query.transport, compact, reassemblyByFrame)
      : null;
  const observations =
    query.kind === "tcp_symptoms"
      ? candidates.filter(
          (item) =>
            tcpSymptom(item) ||
            reassemblyByFrame.get(item.fact.frame.number)?.status.transportContextUnverified,
        )
      : candidates;
  const totalRows = conversation?.rows.length ?? observations.length;
  if (args.networkCursor && offset >= totalRows)
    throw new CaptureError("cursor_mismatch", "The cursor is outside the networking evidence range.");
  const pageFacts = conversation ? [] : observations.slice(offset, offset + limit);
  const text = textFields.length
    ? await native.packets(
        snapshot,
        analysis,
        pageFacts.map(({ fact }) => fact.frame.number),
        textFields,
        capture.sha256,
      )
    : [];
  const rows =
    conversation?.rows.slice(offset, offset + limit) ??
    pageFacts.map((item, index) => {
      const packet = text[index];
      return networkObservation(
        item,
        profile,
        compact,
        relationships.get(item.fact.frame.number) ?? null,
        packet?.fields ?? {},
        packet?.truncated ?? false,
        query.kind === "exchanges",
        reassemblyByFrame.get(item.fact.frame.number),
      );
    });

  const {
    observationPoints,
    omittedObservationPoints,
    missingObservationPointFrames,
    framesWithoutTimestamp,
    truncatedFrames,
  } = tallyCoverage(
    candidates.map(({ fact }) => fact),
    scanned,
  );
  const drops = dropCoverage(scanned);
  const scannedTruncatedFrames = scanned.filter((fact) => fact.capturedBytes < fact.wireBytes).length;
  const unresolvedEndpointFrames =
    conversation?.omitted ??
    candidates.filter((item) => !observationEndpoints(item, reassemblyByFrame.get(item.fact.frame.number)))
      .length;
  const unresolvedDnsFrames = dnsStatuses.filter(({ status }) => status !== "native_link").length;
  const dnsCounterpartsOutsideScope = dnsStatuses.filter(
    (link) => link.status === "native_link" && !link.counterpartInScope,
  ).length;
  const truncated =
    truncatedFrames > 0 ||
    reassembly.framesWithOmittedRelated > 0 ||
    candidates.some(({ fact }) => fact.get("vlan.id").length > networkLimits.fieldValues) ||
    rows.some((row) => row.kind === "observation" && row.valuesLimited);
  const nextOffset = offset + rows.length;
  const next = nextOffset < totalRows ? { querySha256, offset: nextOffset } : null;
  const result: CaptureNetworkingResult = {
    capture,
    analysis,
    packetData: "untrusted_capture_data",
    coverage: {
      scope: analysis.filter ? "display_filter" : "capture",
      scannedThrough: scanned.length,
      scanLimit,
      scanComplete,
      matchedInScope: candidates.length,
      returned: rows.length,
      truncated,
      partial: !!(
        truncated ||
        !scanComplete ||
        offset ||
        next ||
        unresolvedEndpointFrames ||
        unresolvedDnsFrames ||
        dnsCounterpartsOutsideScope ||
        missingObservationPointFrames ||
        framesWithoutTimestamp ||
        omittedObservationPoints ||
        reassembly.tcpGapFrames ||
        reassembly.pendingOrInvalidFrames ||
        reassembly.framesWithRelatedOutsideScope ||
        (drops.knownDrops && drops.knownDrops !== "0")
      ),
    },
    networking: {
      query,
      evidenceMode,
      selectedFields,
      projectedFields: conversation ? [] : [...networkProfiles[profile].fields, ...textFields],
      redactedContext: [],
      fieldAvailability: "projected_values_may_be_absent_redacted_or_withheld",
      sensitiveData: "selected_metadata_only",
      scopeCoverage: {
        observationPoints,
        omittedObservationPoints,
        missingObservationPointFrames,
        framesWithoutTimestamp,
        truncatedFrames,
        scannedTruncatedFrames,
        unresolvedEndpointFrames,
        unresolvedDnsFrames,
        dnsCounterpartsOutsideScope,
        reassemblyLimits: reassembly,
        opaqueTlsFrames: candidates.filter(
          ({ fact }) => opaqueTls(fact) && !reassemblyByFrame.get(fact.frame.number)?.status.pendingOrInvalid,
        ).length,
        ...drops,
        dropCoverage: "packet_drop_metadata_only",
        interpretation: "observed_at_saved_capture_interfaces",
        checksumInterpretation: "offload_and_observation_point_can_affect_checksums",
      },
      rows,
      evidence: [...new Set(rows.flatMap((row) => row.frames))]
        .sort((a, b) => a - b)
        .map((number) => {
          const fact = scanned[number - 1];
          if (!fact) throw invalidOutput();
          return {
            frame: fact.frame,
            section: fact.section,
            ref: captureCitation(capture, fact.frame, analysis),
            wireBytes: fact.wireBytes,
            capturedBytes: fact.capturedBytes,
          };
        }),
      page: { querySha256, limit, offset, totalRows, next },
    },
  };
  while (JSON.stringify(result).length > maxChars) {
    if (!trimNetworkPage(result.networking, result.coverage))
      throw new CaptureError(
        "result_limit",
        "Networking evidence exceeds the result budget. Narrow the selection.",
      );
  }
  return result;
}
