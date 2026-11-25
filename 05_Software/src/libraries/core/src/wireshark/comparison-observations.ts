import {
  type CaptureAnalysis,
  type CaptureComparisonResult,
  type CaptureReference,
  networkLimits,
  type TrafficTransport,
  trafficLimits,
  type WiresharkCaptureArgs,
} from "@vera/shared";
import { captureCitation } from "./citations.js";
import {
  type ComparisonCitation,
  type ComparisonMember,
  comparisonTimingProtocols,
  milliseconds,
  observeTiming,
} from "./comparison-timing.js";
import { timingFields } from "./diagnostics.js";
import { CaptureError, type OfflineTshark } from "./native.js";
import { requireSecretsFreeCapture } from "./network-capture.js";
import { dropCoverage } from "./network-evidence.js";
import {
  matchesNetworkTransport,
  networkEndpoints,
  networkingFields,
  networkPoint,
  networkProtocol,
  networkSymptoms,
} from "./network-profiles.js";
import type { NetworkFact } from "./network-projection.js";
import { networkReassembly } from "./network-reassembly.js";
import { inWindow, streamIds } from "./statistics.js";
import { protocolStack, readTrafficFacts, type TrafficFact } from "./traffic-native.js";

type Args = Extract<WiresharkCaptureArgs, { operation: "compare" }>;
type View = CaptureComparisonResult["comparison"];
type Side = View["baseline"];
type Row = View["rows"][number];
type Observation = NonNullable<Row["baseline"]>;
type Capture = { capture: CaptureReference; snapshot: string };
type Stream = { members: ComparisonMember[]; first: [TrafficFact?, TrafficFact?] };
type Group = {
  transport: TrafficTransport;
  vlans: number[];
  endpoints: Row["endpoints"];
  streams: Map<number, Stream>;
};
export type ComparisonGroup = Pick<Group, "transport" | "vlans" | "endpoints"> & {
  ambiguous: boolean;
  observation: Observation;
};

export const comparisonFields = [
  ...new Set([
    ...networkingFields("tcp_udp"),
    ...networkingFields("dns_dhcp"),
    ...comparisonTimingProtocols.flatMap((protocol) => Object.values(timingFields(protocol))),
  ]),
];
function observeStream(
  stream: Stream,
  transport: TrafficTransport,
  scanned: TrafficFact[],
  scope: Set<number>,
  reassembly: ReturnType<typeof networkReassembly>["byFrame"],
  cite: ComparisonCitation,
  nativeContextShared: boolean,
): Observation {
  const counts = [
    { packets: 0, wireBytes: 0 },
    { packets: 0, wireBytes: 0 },
  ] satisfies [Observation["aToB"], Observation["bToA"]];
  let retransmissions = 0;
  let representative: TrafficFact | undefined;
  for (const { fact, direction } of stream.members) {
    const volume = counts[direction];
    volume.packets++;
    volume.wireBytes += fact.wireBytes;
    if (
      !nativeContextShared &&
      transport === "tcp" &&
      networkSymptoms(fact).some(
        (name) =>
          name === "retransmission" || name === "fastRetransmission" || name === "spuriousRetransmission",
      )
    ) {
      retransmissions++;
      representative ??= fact;
    }
  }
  return {
    nativeContextShared,
    aToB: counts[0],
    bToA: counts[1],
    retransmissions: transport === "tcp" && !nativeContextShared ? retransmissions : null,
    retransmissionFrame: representative ? cite(representative) : null,
    dns: nativeContextShared ? null : observeTiming(stream.members, scanned, scope, reassembly, "dns", cite),
    http:
      transport === "tcp" && !nativeContextShared
        ? observeTiming(stream.members, scanned, scope, reassembly, "http", cite)
        : null,
    frames: stream.first.flatMap((fact) => (fact ? [cite(fact)] : [])),
  };
}

function transportGroups(items: NetworkFact[], reassembly: ReturnType<typeof networkReassembly>["byFrame"]) {
  const groups = new Map<string, Group>();
  const unresolved: NetworkFact[] = [];
  let streamCount = 0;
  for (const { fact, protocol } of items) {
    const pair = networkEndpoints(fact, protocol);
    const { vlans } = networkPoint(fact);
    const streams = protocol === "tcp" || protocol === "udp" ? streamIds(fact, protocol) : [];
    const [from, to] = pair ?? [];
    const streamId = streams[0];
    if (
      (protocol !== "tcp" && protocol !== "udp") ||
      streams.length !== 1 ||
      streamId === undefined ||
      from?.port == null ||
      to?.port == null ||
      vlans.length > networkLimits.fieldValues ||
      reassembly.get(fact.frame.number)?.status.transportContextUnverified
    ) {
      unresolved.push({ fact, protocol });
      continue;
    }
    const a = { address: from.address, port: from.port };
    const b = { address: to.address, port: to.port };
    const aKey = JSON.stringify(a);
    const bKey = JSON.stringify(b);
    const direction = aKey <= bKey ? 0 : 1;
    const endpoints: Row["endpoints"] = direction === 0 ? [a, b] : [b, a];
    const key = JSON.stringify([protocol, vlans, endpoints]);
    let group = groups.get(key);
    if (!group) {
      group = { transport: protocol, vlans, endpoints, streams: new Map() };
      groups.set(key, group);
    }
    let stream = group.streams.get(streamId);
    if (!stream) {
      if (++streamCount > trafficLimits.aggregateGroups)
        throw new CaptureError(
          "traffic_group_limit",
          "Too many conversations. Narrow the comparison window.",
        );
      stream = { members: [], first: [] };
      group.streams.set(streamId, stream);
    }
    stream.members.push({ fact, direction });
    stream.first[direction] ??= fact;
  }
  return { groups, unresolved };
}

const streamKey = (transport: TrafficTransport, id: number) => `${transport}:${id}`;

function sharedNativeStreams(scanned: TrafficFact[], transports: TrafficTransport[]) {
  const firstPoint = new Map<string, string>();
  const shared = new Set<string>();
  for (const fact of scanned) {
    const streams = transports.flatMap((transport) =>
      streamIds(fact, transport).map((id) => streamKey(transport, id)),
    );
    if (!streams.length) continue;
    const point = JSON.stringify(networkPoint(fact));
    for (const stream of streams) {
      const first = firstPoint.get(stream);
      if (first === undefined) firstPoint.set(stream, point);
      else if (first !== point) shared.add(stream);
    }
  }
  return shared;
}

/** Read one selected point and derive comparison observations from #233 network facts. */
export async function observeComparisonSide(
  input: Args["baseline"],
  transports: Args["transports"],
  { capture, snapshot }: Capture,
  analysis: CaptureAnalysis,
  native: OfflineTshark,
  scanLimit: number,
  signal: AbortSignal,
) {
  const interfaceDropCounters = await requireSecretsFreeCapture(snapshot, capture, signal, input.point);
  const facts = await readTrafficFacts(
    native,
    snapshot,
    analysis,
    scanLimit + 1,
    comparisonFields,
    capture.sha256,
  );
  const scanned = facts.slice(0, scanLimit);
  const point = scanned.filter(
    ({ section, frame }) => section === input.point.section && frame.interfaceId === input.point.interfaceId,
  );
  const windowFacts = point.filter(({ relative }) => inWindow(relative, input.window));
  const candidates: NetworkFact[] = [];
  for (const fact of windowFacts) {
    const protocol = networkProtocol("tcp_udp", fact, protocolStack(fact));
    if (protocol && transports.some((transport) => matchesNetworkTransport(protocol, transport)))
      candidates.push({ fact, protocol });
  }
  const cite: ComparisonCitation = ({ frame, section }) => ({
    frame,
    section,
    ref: captureCitation(capture, frame, analysis),
  });
  const scope = new Set(candidates.map(({ fact }) => fact.frame.number));
  const { byFrame } = networkReassembly(candidates, scanned, scope);
  const { groups, unresolved } = transportGroups(candidates, byFrame);
  let untimed: TrafficFact | undefined;
  let untimedCount = 0;
  let regression: TrafficFact | undefined;
  let min: bigint | undefined;
  let max: bigint | undefined;
  let previous: bigint | undefined;
  for (const fact of point) {
    const time = fact.relative;
    if (time === null || fact.frame.timestampEpoch === null) {
      untimedCount++;
      untimed ??= fact;
      continue;
    }
    if (previous !== undefined && time < previous) regression ??= fact;
    previous = time;
    if (min === undefined || time < min) min = time;
    if (max === undefined || time > max) max = time;
  }
  const bracketed =
    min !== undefined &&
    max !== undefined &&
    min <= BigInt(input.window.startMs) * 1_000_000_000n &&
    max >= BigInt(input.window.endMs) * 1_000_000_000n;
  const truncations = windowFacts.filter((fact) => fact.capturedBytes < fact.wireBytes);
  const scanComplete = facts.length <= scanLimit;
  const { knownDrops } = dropCoverage(point);
  const diagnostics: Side["coverage"]["diagnostics"] = [];
  if (!scanComplete) diagnostics.push("scan_limit");
  if (!bracketed) diagnostics.push("window_not_bracketed");
  if (untimedCount) diagnostics.push("untimed_frames");
  if (regression) diagnostics.push("clock_regression");
  if (truncations.length) diagnostics.push("truncated_frames");
  if ([knownDrops, ...Object.values(interfaceDropCounters)].some((value) => value !== null && value !== "0"))
    diagnostics.push("reported_drops");
  const complete = diagnostics.length === 0;
  if (unresolved.length) diagnostics.push("unresolved_traffic");
  const sharedStreams = sharedNativeStreams(scanned, transports);
  const observations = new Map<string, ComparisonGroup>();
  let sharedNativeContexts = 0;
  for (const [key, { transport, vlans, endpoints, streams }] of groups) {
    const first = streams.values().next().value;
    if (!first) continue;
    const nativeContextShared = [...streams.keys()].some((id) => sharedStreams.has(streamKey(transport, id)));
    if (nativeContextShared) sharedNativeContexts++;
    observations.set(key, {
      transport,
      vlans,
      endpoints,
      ambiguous: streams.size > 1,
      observation: observeStream(first, transport, scanned, scope, byFrame, cite, nativeContextShared),
    });
  }
  if ([...observations.values()].some(({ ambiguous }) => ambiguous))
    diagnostics.push("ambiguous_conversations");
  if (sharedNativeContexts) diagnostics.push("shared_native_context");
  const unresolvedTransports = transports
    .filter((transport) => unresolved.some(({ protocol }) => matchesNetworkTransport(protocol, transport)))
    .sort();
  const side: Side = {
    capture,
    point: input.point,
    window: input.window,
    timingUncertaintyUs: input.timingUncertaintyUs ?? null,
    coverage: {
      scanComplete,
      scannedFrames: scanned.length,
      pointFrames: point.length,
      outOfScopeFrames: scanned.length - candidates.length,
      scopedTransportFrames: candidates.length,
      observedDurationMs: min === undefined || max === undefined ? null : milliseconds(max - min),
      framesWithoutTimestamp: untimedCount,
      truncatedFrames: truncations.length,
      unresolvedFrames: unresolved.length,
      unresolvedTransports,
      sharedNativeContexts,
      knownDrops,
      interfaceDropCounters,
      diagnostics,
      evidence: [...new Set([untimed, regression, truncations[0], unresolved[0]?.fact])].flatMap((fact) =>
        fact ? [cite(fact)] : [],
      ),
    },
  };
  return { side, observations, complete };
}
