import type { TrafficTransport } from "@vera/shared";
import { observedFlags } from "./diagnostics.js";
import { CaptureError, invalidOutput } from "./native.js";
import { count, counts, endpointPair, type TrafficProjection, type TrafficRow } from "./statistics.js";
import { type NativeFollow, nativeTime, type TrafficAddress, type TrafficFact } from "./traffic-native.js";

function same(a: TrafficAddress, b: TrafficAddress) {
  return a.address === b.address && a.port === b.port;
}

export function streams(
  scanned: TrafficFact[],
  scoped: TrafficFact[],
  native: NativeFollow,
  transport: TrafficTransport,
): TrafficProjection {
  const allByNumber = new Map(scanned.map((fact) => [fact.frame.number, fact]));
  const inScope = new Set(scoped.map((fact) => fact.frame.number));
  const fallback = scanned[0] && endpointPair(scanned[0], transport);
  const a = native.peers[0] ?? fallback?.[0];
  const b = native.peers[1] ?? fallback?.[1];
  if (!a || !b || (native.peers[0] === null) !== (native.peers[1] === null) || same(a, b))
    throw new CaptureError(
      "stream_direction_unavailable",
      "TShark could not identify two distinct stream endpoints.",
    );

  const direction = (fact: TrafficFact) => {
    const pair = endpointPair(fact, transport);
    if (pair && same(pair[0], a) && same(pair[1], b)) return 0;
    if (pair && same(pair[0], b) && same(pair[1], a)) return 1;
    return null;
  };
  const directional = [0, 1].map((peer) => ({
    direction: peer === 0 ? "a_to_b" : "b_to_a",
    ...counts(),
    payloadBytes: 0,
    gapRecords: 0,
    missingBytes: 0,
    unknownGapLengths: 0,
    representativeFrame: null as number | null,
  }));
  const flags = new Map<string, number>();
  const handshake = { synFrame: null, synAckFrame: null, ackAfterSynAckFrame: null } as Record<
    "synFrame" | "synAckFrame" | "ackAfterSynAckFrame",
    number | null
  >;
  const finFrames: [number | null, number | null] = [null, null];
  let resetFrame: number | null = null;
  let synPeer: number | null = null;
  let undirectedFrames = 0;
  let truncatedFrames = 0;
  let unseenSegmentFrames = 0;
  for (const fact of scanned) {
    const peer = direction(fact);
    const number = fact.frame.number;
    const tcpObservations = observedFlags(fact);
    if (fact.wireBytes > fact.capturedBytes) truncatedFrames++;
    if (
      tcpObservations.includes("acknowledgedSegmentUnseen") ||
      tcpObservations.includes("previousSegmentUnseen")
    )
      unseenSegmentFrames++;
    if (inScope.has(number)) {
      if (peer === null) undirectedFrames++;
      else {
        const totals = directional[peer];
        if (!totals) throw invalidOutput();
        count(totals, fact);
        totals.representativeFrame ??= number;
      }
      for (const observation of tcpObservations) flags.set(observation, (flags.get(observation) ?? 0) + 1);
    }
    if (transport !== "tcp" || peer === null) continue;
    const tcpFlags = fact.get("tcp.flags");
    if (tcpFlags.length !== 1 || !/^0x[\da-f]{1,4}$/i.test(tcpFlags[0] ?? "")) continue;
    const bits = Number(tcpFlags[0]);
    const syn = (bits & 2) !== 0;
    const ack = (bits & 16) !== 0;
    if (syn && !ack && handshake.synFrame === null) {
      handshake.synFrame = number;
      synPeer = peer;
    }
    if (syn && ack && synPeer !== null && peer !== synPeer) handshake.synAckFrame ??= number;
    if (!syn && ack && handshake.synAckFrame !== null && peer === synPeer)
      handshake.ackAfterSynAckFrame ??= number;
    if (bits & 1) finFrames[peer] ??= number;
    if (bits & 4) resetFrame ??= number;
  }
  const rows: TrafficRow[] = [];
  let nativeGapRecords = 0;
  let recordsOutsideScope = 0;
  let unassociatedRecords = 0;
  for (const [index, record] of native.records.entries()) {
    const totals = directional[record.peer];
    const fact = allByNumber.get(record.frame);
    if (!fact || !totals) throw invalidOutput();
    const epoch = fact.frame.timestampEpoch;
    const sourcePeer = direction(fact);
    // TShark uses a zero timestamp for missing timestamps and its synthetic gap markers.
    if (
      (record.kind === "data" && sourcePeer !== record.peer) ||
      (record.kind === "gap" &&
        (epoch === null || nativeTime(epoch) === 0n) &&
        (sourcePeer === null || sourcePeer === record.peer))
    ) {
      unassociatedRecords++;
      continue;
    }
    if (record.kind === "gap") nativeGapRecords++;
    if (!inScope.has(record.frame)) {
      recordsOutsideScope++;
      continue;
    }
    if (record.kind === "data") totals.payloadBytes += record.bytes;
    else {
      totals.gapRecords++;
      if (record.bytes === null) totals.unknownGapLengths++;
      else totals.missingBytes += record.bytes;
    }
    rows.push({
      record: index + 1,
      kind: record.kind,
      direction: totals.direction,
      payloadBytes: record.kind === "data" ? record.bytes : 0,
      missingBytes: record.kind === "gap" ? record.bytes : 0,
      frames: [record.frame],
    });
  }
  const tcp =
    transport === "tcp"
      ? {
          ...handshake,
          finFrames,
          resetFrame,
          handshakeMarkersObserved: handshake.ackAfterSynAckFrame !== null,
          endMarkersObserved: resetFrame !== null || finFrames.every((frame) => frame !== null),
          unseenSegmentFrames,
          observationsInScope: Object.fromEntries(flags),
        }
      : null;
  return {
    summary: {
      transport,
      a,
      b,
      directions: directional,
      tcp,
      scannedStreamFrames: scanned.length,
      scopedStreamFrames: scoped.length,
      truncatedStreamFrames: truncatedFrames,
      undirectedFrames,
      nativeGapRecords,
      recordsOutsideScope,
      unassociatedRecords,
      payloadView: "verified_local_capture_only",
      basis: "native_follow_records_anchored_to_selected_frames",
    },
    rows,
    summaryFrames: [
      ...Object.values(handshake),
      ...finFrames,
      resetFrame,
      ...directional.map((total) => total.representativeFrame),
    ].filter((frame) => frame !== null),
    incomplete:
      undirectedFrames + nativeGapRecords + unassociatedRecords + truncatedFrames + unseenSegmentFrames > 0 ||
      (tcp !== null && (!tcp.handshakeMarkersObserved || !tcp.endMarkersObserved)),
  };
}
