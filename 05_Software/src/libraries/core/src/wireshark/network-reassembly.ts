import { type NetworkObservation, networkLimits } from "@vera/shared";
import { hasIpFragment, ipFragmentFields, networkPoint } from "./network-profiles.js";
import type { NetworkFact } from "./network-projection.js";
import { nativeUint, type TrafficFact } from "./traffic-native.js";

const reassemblyFields = [
  {
    contributors: "tcp.segment",
    count: "tcp.segment.count",
    completion: "tcp.reassembled_in",
    error: "tcp.segment.error",
  },
  {
    contributors: "tls.segment",
    count: "tls.segment.count",
    completion: "tls.reassembled_in",
    error: "tls.segment.error",
  },
  ...ipFragmentFields,
];

export type NetworkReassembly = {
  frames: number[];
  status: Omit<NonNullable<NetworkObservation["reassembly"]>, "withheldFields">;
};

export function observationReassembly(
  { fact, protocol }: NetworkFact,
  scanned: TrafficFact[],
  scoped: Set<number>,
): NetworkReassembly | undefined {
  const current = fact.frame.number;
  const related = new Set<number>();
  const ipRelated = new Set<number>();
  let hasForwardLink = false;
  let pendingOrInvalid = false;
  let ipPending = false;
  for (const fields of reassemblyFields) {
    const { contributors, count, completion, error } = fields;
    const isIp = "more" in fields;
    const members = fact.get(contributors).map(nativeUint);
    const completions = fact.get(completion).map(nativeUint);
    hasForwardLink ||= completions.some((number) => number > current);
    for (const number of [...members, ...completions]) {
      if (number === current) continue;
      related.add(number);
      if (isIp) ipRelated.add(number);
    }
    const incomplete =
      members.some((number) => number > current || !number) ||
      completions.some((number) => number <= current) ||
      fact.get(count).some((value) => nativeUint(value) > members.length) ||
      fact.get(error).length > 0;
    pendingOrInvalid ||= incomplete;
    if (isIp)
      ipPending ||=
        incomplete || (hasIpFragment(fact, fields) && !completions.length && !fact.get(count).length);
  }
  pendingOrInvalid ||= ipPending || (protocol === "tls_candidate" && !hasForwardLink);
  if (!related.size && !pendingOrInvalid) return undefined;
  const point = JSON.stringify(networkPoint(fact));
  const verified = [...related]
    .filter((number) => {
      const record = scanned[number - 1];
      return (
        record && record.capturedBytes === record.wireBytes && JSON.stringify(networkPoint(record)) === point
      );
    })
    .sort((a, b) => a - b);
  const frames = verified.slice(0, networkLimits.framesPerRow - 2);
  const unverifiedFrames = related.size - verified.length;
  const verifiedSet = new Set(verified);
  return {
    frames,
    status: {
      relatedFrames: related.size,
      outsideScopeFrames: verified.filter((number) => !scoped.has(number)).length,
      unverifiedFrames,
      omittedFrames: verified.length - frames.length,
      pendingOrInvalid: pendingOrInvalid || unverifiedFrames > 0,
      transportContextUnverified: ipPending || [...ipRelated].some((number) => !verifiedSet.has(number)),
    },
  };
}

export function networkReassembly(facts: NetworkFact[], scanned: TrafficFact[], scoped: Set<number>) {
  const byFrame = new Map<number, NetworkReassembly>();
  const summary = {
    tcpGapFrames: 0,
    pendingOrInvalidFrames: 0,
    framesWithRelatedOutsideScope: 0,
    framesWithOmittedRelated: 0,
    tlsCandidateFrames: 0,
    basis: "native_dissector_markers_and_port_443_candidates" as const,
  };
  for (const candidate of facts) {
    const { fact, protocol } = candidate;
    if (fact.get("tcp.analysis.lost_segment").length || fact.get("tcp.analysis.ack_lost_segment").length)
      summary.tcpGapFrames++;
    if (protocol === "tls_candidate") summary.tlsCandidateFrames++;
    const evidence = observationReassembly(candidate, scanned, scoped);
    if (!evidence) continue;
    byFrame.set(fact.frame.number, evidence);
    if (evidence.status.pendingOrInvalid) summary.pendingOrInvalidFrames++;
    if (evidence.status.outsideScopeFrames) summary.framesWithRelatedOutsideScope++;
    if (evidence.status.omittedFrames) summary.framesWithOmittedRelated++;
  }
  return { byFrame, summary };
}
