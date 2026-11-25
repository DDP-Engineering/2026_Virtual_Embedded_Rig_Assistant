import { invalidOutput } from "./native.js";
import type { TrafficProjection, TrafficRow } from "./statistics.js";
import { nativeTime, nativeUint, type TrafficFact } from "./traffic-native.js";

const observations = {
  retransmission: "tcp.analysis.retransmission",
  fastRetransmission: "tcp.analysis.fast_retransmission",
  spuriousRetransmission: "tcp.analysis.spurious_retransmission",
  previousSegmentUnseen: "tcp.analysis.lost_segment",
  acknowledgedSegmentUnseen: "tcp.analysis.ack_lost_segment",
  outOfOrder: "tcp.analysis.out_of_order",
  duplicateAck: "tcp.analysis.duplicate_ack",
  zeroWindow: "tcp.analysis.zero_window",
};
const transports = ["tcp", "udp"] as const;
const checksumFields = transports.flatMap((name) => [`${name}.checksum.status`, `${name}.checksum.partial`]);
export const diagnosticFields = [
  "_ws.expert.severity",
  "_ws.expert.group",
  ...Object.values(observations),
  ...checksumFields,
];
export const streamDiagnosticFields = [...Object.values(observations), "tcp.flags"];

const statuses = ["bad", "good", "unverified", "not_present", "illegal"] as const;
function checksumStatus(fact: TrafficFact, transport: (typeof transports)[number]) {
  const codes = fact.get(`${transport}.checksum.status`).map(nativeUint);
  const markedPartial = partialChecksumOccurrences(fact, transport) > 0;
  return codes.map((code) =>
    markedPartial && codes.length === 1 ? "partial_offload_evidence" : (statuses[code] ?? "unknown"),
  );
}

function partialChecksumOccurrences(fact: TrafficFact, transport: (typeof transports)[number]) {
  return fact.get(`${transport}.checksum.partial`).length;
}

function nativeCodes(values: string[]) {
  return values.map((value) => (/^0x[\da-f]{1,8}$/i.test(value) ? Number(value) : nativeUint(value)));
}

export function observedFlags(fact: TrafficFact) {
  const names = Object.keys(observations) as Array<keyof typeof observations>;
  return names.filter((name) => fact.get(observations[name]).length > 0);
}

export function diagnostics(facts: TrafficFact[]): TrafficProjection {
  const expertSeverity: Record<string, number> = {};
  const expertGroup: Record<string, number> = {};
  const tcpObservations: Record<string, number> = {};
  const checksumStatuses = { tcp: {} as Record<string, number>, udp: {} as Record<string, number> };
  const partialChecksumMarkers = { tcp: 0, udp: 0 };
  const rows: TrafficRow[] = [];
  let expertRowsLimited = 0;
  function addCounts(counts: Record<string, number>, values: (number | string)[]) {
    for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  }
  for (const fact of facts) {
    const severity = nativeCodes(fact.get("_ws.expert.severity"));
    const group = nativeCodes(fact.get("_ws.expert.group"));
    const tcp = observedFlags(fact);
    const tcpChecksum = checksumStatus(fact, "tcp");
    const udpChecksum = checksumStatus(fact, "udp");
    const partialChecksum = {
      tcp: partialChecksumOccurrences(fact, "tcp"),
      udp: partialChecksumOccurrences(fact, "udp"),
    };
    partialChecksumMarkers.tcp += partialChecksum.tcp;
    partialChecksumMarkers.udp += partialChecksum.udp;
    const truncated = fact.capturedBytes < fact.wireBytes;
    addCounts(expertSeverity, severity);
    addCounts(expertGroup, group);
    addCounts(tcpObservations, tcp);
    addCounts(checksumStatuses.tcp, tcpChecksum);
    addCounts(checksumStatuses.udp, udpChecksum);
    if (
      severity.length ||
      group.length ||
      tcp.length ||
      truncated ||
      partialChecksum.tcp ||
      partialChecksum.udp ||
      [...tcpChecksum, ...udpChecksum].some((status) => status !== "good")
    ) {
      const valuesLimited = [severity, group, tcpChecksum, udpChecksum].some((values) => values.length > 64);
      if (valuesLimited) expertRowsLimited++;
      rows.push({
        frames: [fact.frame.number],
        expertSeverity: severity.slice(0, 64),
        expertGroup: group.slice(0, 64),
        tcp,
        checksum: { tcp: tcpChecksum.slice(0, 64), udp: udpChecksum.slice(0, 64) },
        partialChecksum,
        truncated,
        valuesLimited,
        wireBytes: fact.wireBytes,
        capturedBytes: fact.capturedBytes,
      });
    }
  }
  return {
    summary: {
      expertSeverity,
      expertGroup,
      tcpObservations,
      checksumStatuses,
      partialChecksumMarkers,
      diagnosticFrames: rows.length,
      expertRowsLimited,
      interpretation: "observations_at_capture_point",
    },
    rows,
    incomplete: expertRowsLimited > 0,
  };
}

export function timingFields(protocol: "dns" | "http") {
  return protocol === "dns"
    ? { request: "dns.flags.response", response: "dns.response_to", duration: "dns.time", present: "dns.id" }
    : {
        request: "http.request",
        response: "http.request_in",
        duration: "http.time",
        present: "http.response",
      };
}

export function responseTiming(
  facts: TrafficFact[],
  scanned: TrafficFact[],
  protocol: "dns" | "http",
): TrafficProjection {
  const fields = timingFields(protocol);
  const scoped = new Set(facts.map((fact) => fact.frame.number));
  const pairedRequests = new Set<number>();
  const requestsPairedInScope = new Set<number>();
  const requests = new Set<number>();
  const rows: TrafficRow[] = [];
  let responsesWithoutPair = 0;
  let ambiguousResponses = 0;
  let pairsWithRequestOutsideScope = 0;
  let minimum: string | null = null;
  let maximum: string | null = null;
  let totalPs = 0n;
  for (const fact of scanned) {
    const frame = fact.frame.number;
    const request = fact.get(fields.request);
    const isRequest =
      protocol === "dns" ? request.some((flag) => /^(false|0)$/i.test(flag)) : request.length > 0;
    if (isRequest && scoped.has(frame)) requests.add(frame);
    const paired = fact.get(fields.response);
    const durations = fact.get(fields.duration);
    const isResponse =
      protocol === "dns"
        ? request.some((flag) => /^(true|1)$/i.test(flag))
        : fact.get(fields.present).length > 0;
    if (!isResponse) continue;
    if (
      paired.length !== 1 ||
      durations.length !== 1 ||
      request.length > 1 ||
      fact.get(fields.present).length > 1 ||
      (protocol === "http" && isRequest)
    ) {
      if (scoped.has(frame)) {
        if (paired.length === 0 && durations.length === 0) responsesWithoutPair++;
        else ambiguousResponses++;
      }
      continue;
    }
    const requestFrame = nativeUint(paired[0]);
    const durationSeconds = durations[0];
    if (!durationSeconds || requestFrame < 1 || requestFrame >= frame) throw invalidOutput();
    const durationPs = nativeTime(durationSeconds);
    pairedRequests.add(requestFrame);
    if (!scoped.has(frame)) continue;
    requestsPairedInScope.add(requestFrame);
    if (!scoped.has(requestFrame)) pairsWithRequestOutsideScope++;
    if (minimum === null || durationPs < nativeTime(minimum)) minimum = durationSeconds;
    if (maximum === null || durationPs > nativeTime(maximum)) maximum = durationSeconds;
    totalPs += durationPs;
    rows.push({
      frames: [requestFrame, frame],
      requestFrame,
      responseFrame: frame,
      requestInScope: scoped.has(requestFrame),
      durationSeconds,
    });
  }
  let requestsWithoutObservedResponse = 0;
  let requestsWithResponseOnlyOutsideScope = 0;
  for (const frame of requests) {
    if (!pairedRequests.has(frame)) requestsWithoutObservedResponse++;
    else if (!requestsPairedInScope.has(frame)) requestsWithResponseOnlyOutsideScope++;
  }
  return {
    summary: {
      protocol,
      pairs: rows.length,
      requests: requests.size,
      requestsWithoutObservedResponse,
      requestsWithResponseOnlyOutsideScope,
      responsesWithoutPair,
      ambiguousResponses,
      pairsWithRequestOutsideScope,
      minimumSeconds: minimum,
      maximumSeconds: maximum,
      meanSeconds: rows.length ? Number(totalPs) / 1e12 / rows.length : null,
    },
    rows,
    incomplete:
      requestsWithoutObservedResponse +
        requestsWithResponseOnlyOutsideScope +
        responsesWithoutPair +
        ambiguousResponses +
        pairsWithRequestOutsideScope >
      0,
  };
}
