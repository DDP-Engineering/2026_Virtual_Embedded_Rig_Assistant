import { isIP } from "node:net";
import { type TrafficLayer, type TrafficTransport, type TrafficWindow, trafficLimits } from "@vera/shared";
import { CaptureError, invalidOutput } from "./native.js";
import { nativeUint, protocolStack, type TrafficAddress, type TrafficFact } from "./traffic-native.js";

export type TrafficRow = { frames: number[] } & Record<string, unknown>;
export type TrafficProjection = {
  rows: TrafficRow[];
  summary: Record<string, unknown>;
  summaryFrames?: number[];
  incomplete?: boolean;
};
type Counts = { packets: number; wireBytes: number; capturedBytes: number };
type Counter = Counts & { frames: number[] };

export const addressFields = ["eth.src", "eth.dst", "ip.src", "ip.dst", "ipv6.src", "ipv6.dst"];
export function transportFields(transport: TrafficTransport) {
  return [`${transport}.srcport`, `${transport}.dstport`, `${transport}.stream`];
}

export function counts(): Counts {
  return { packets: 0, wireBytes: 0, capturedBytes: 0 };
}

export function count(counter: Counts, fact: TrafficFact) {
  counter.packets++;
  counter.wireBytes += fact.wireBytes;
  counter.capturedBytes += fact.capturedBytes;
}

function keepSample(frames: number[], frame: number) {
  if (frames.length === 0) frames.push(frame);
}

function checkGroupBudget(size: number) {
  if (size >= trafficLimits.aggregateGroups)
    throw new CaptureError(
      "traffic_group_limit",
      "Too many traffic groups. Narrow the display filter or window.",
    );
}

function pairFields(fact: TrafficFact, prefix: string, suffix: string, valid: (value: string) => boolean) {
  const src = fact.get(`${prefix}.src${suffix}`);
  const dst = fact.get(`${prefix}.dst${suffix}`);
  if (!src.every(valid) || !dst.every(valid)) throw invalidOutput();
  return src.length === 1 && dst.length === 1 && src[0] !== undefined && dst[0] !== undefined
    ? ([src[0], dst[0]] as const)
    : undefined;
}

export function streamIds(fact: TrafficFact, transport: TrafficTransport) {
  return fact.get(`${transport}.stream`).map(nativeUint);
}

export function endpointPair(fact: TrafficFact, layer: TrafficLayer) {
  const ipv4 = () => pairFields(fact, "ip", "", (value) => isIP(value) === 4);
  const ipv6 = () => pairFields(fact, "ipv6", "", (value) => isIP(value) === 6);
  const transport = layer === "tcp" || layer === "udp" ? layer : undefined;
  const hasV4 = fact.get("ip.src").length > 0 || fact.get("ip.dst").length > 0;
  const hasV6 = fact.get("ipv6.src").length > 0 || fact.get("ipv6.dst").length > 0;
  let addresses: readonly [string, string] | undefined;
  if (layer === "ethernet")
    addresses = pairFields(fact, "eth", "", (value) => /^(?:[\da-f]{2}:){5}[\da-f]{2}$/i.test(value));
  else if (layer === "ipv4" || (transport && hasV4 && !hasV6)) addresses = ipv4();
  else if (layer === "ipv6" || (transport && hasV6 && !hasV4)) addresses = ipv6();
  if (!addresses) return undefined;
  const ports = transport && pairFields(fact, transport, "port", (value) => nativeUint(value) <= 65535);
  if (transport && !ports) return undefined;
  const [a, b] = addresses;
  return [
    { address: a, port: ports ? Number(ports[0]) : null },
    { address: b, port: ports ? Number(ports[1]) : null },
  ] as const satisfies readonly [TrafficAddress, TrafficAddress];
}

export function hierarchies(facts: TrafficFact[]): TrafficProjection {
  const groups = new Map<string, Counter>();
  let missingStackFrames = 0;
  let deepStackFrames = 0;
  for (const fact of facts) {
    const stack = protocolStack(fact);
    if (!stack.length) missingStackFrames++;
    if (stack.length > 32) deepStackFrames++;
    let key = "";
    for (const protocol of stack.slice(0, 32)) {
      key = key ? `${key}:${protocol}` : protocol;
      let group = groups.get(key);
      if (!group) {
        checkGroupBudget(groups.size);
        group = { ...counts(), frames: [] };
        groups.set(key, group);
      }
      count(group, fact);
      keepSample(group.frames, fact.frame.number);
    }
  }
  return {
    summary: { basis: "frame.protocols", missingStackFrames, deepStackFrames },
    rows: [...groups.keys()].sort().flatMap((key) => {
      const group = groups.get(key);
      return group ? [{ path: key.split(":"), ...group }] : [];
    }),
    incomplete: missingStackFrames > 0 || deepStackFrames > 0,
  };
}

export function directionalGroups(
  facts: TrafficFact[],
  layer: TrafficLayer,
  kind: "endpoints" | "conversations",
): TrafficProjection {
  const transport = layer === "tcp" || layer === "udp" ? layer : undefined;
  const layerProtocol = { ethernet: "eth", ipv4: "ip", ipv6: "ipv6", tcp: "tcp", udp: "udp" }[layer];
  type Direction = Counts & { representativeFrame: number | null };
  type Group = {
    a: TrafficAddress;
    b: TrafficAddress | undefined;
    stream: number | undefined;
    first: Direction;
    second: Direction;
    counts: Counts;
  };
  const groups = new Map<string, Group>();
  let excludedFrames = 0;
  let ambiguousFrames = 0;
  function add(
    fact: TrafficFact,
    key: string,
    reverse: boolean,
    a: TrafficAddress,
    b?: TrafficAddress,
    stream?: number,
  ) {
    let group = groups.get(key);
    if (!group) {
      checkGroupBudget(groups.size);
      group = {
        a,
        b,
        stream,
        first: { ...counts(), representativeFrame: null },
        second: { ...counts(), representativeFrame: null },
        counts: counts(),
      };
      groups.set(key, group);
    }
    const direction = reverse ? group.second : group.first;
    count(direction, fact);
    count(group.counts, fact);
    direction.representativeFrame ??= fact.frame.number;
  }
  for (const fact of facts) {
    const pair = endpointPair(fact, layer);
    const streams = transport && kind === "conversations" ? streamIds(fact, transport) : [];
    if (!pair || (transport && kind === "conversations" && streams.length !== 1)) {
      if (protocolStack(fact).includes(layerProtocol)) ambiguousFrames++;
      else excludedFrames++;
      continue;
    }
    const [a, b] = pair;
    const aKey = JSON.stringify(a);
    const bKey = JSON.stringify(b);
    if (kind === "endpoints") {
      add(fact, aKey, false, a);
      add(fact, bKey, true, b);
    } else {
      // Canonical keys identify a pair; A and B keep the first scoped packet's orientation.
      const key = JSON.stringify([streams[0] ?? null, ...[aKey, bKey].sort()]);
      const group = groups.get(key);
      const reverse = group?.a.address === b.address && group.a.port === b.port && aKey !== bKey;
      add(fact, key, reverse, a, b, streams[0]);
    }
  }
  return {
    summary: { layer, excludedFrames, ambiguousFrames, byteBasis: "frame_length" },
    rows: [...groups.values()].map(({ a, b, stream, first, second, counts }) => ({
      ...(kind === "endpoints"
        ? { endpoint: a, tx: first, rx: second }
        : { a, b, ...(stream === undefined ? {} : { stream }), aToB: first, bToA: second }),
      ...counts,
      frames: [first.representativeFrame, second.representativeFrame].filter((frame) => frame !== null),
    })),
    incomplete: ambiguousFrames > 0,
  };
}

const picosecondsPerMs = 1_000_000_000n;
export function inWindow(value: bigint | null, window: TrafficWindow) {
  return (
    value !== null &&
    value >= BigInt(window.startMs) * picosecondsPerMs &&
    value < BigInt(window.endMs) * picosecondsPerMs
  );
}

export function trafficIntervals(
  facts: TrafficFact[],
  window: TrafficWindow,
  intervalMs: number,
): TrafficProjection {
  const { startMs, endMs } = window;
  const start = BigInt(startMs) * picosecondsPerMs;
  const width = BigInt(intervalMs) * picosecondsPerMs;
  const buckets = Array.from({ length: Math.ceil((endMs - startMs) / intervalMs) }, (_, index) => ({
    startMs: startMs + index * intervalMs,
    endMs: Math.min(startMs + (index + 1) * intervalMs, endMs),
    ...counts(),
    frames: [] as number[],
  }));
  for (const fact of facts) {
    if (fact.relative === null) continue;
    const bucket = buckets[Number((fact.relative - start) / width)];
    if (!bucket) throw invalidOutput();
    count(bucket, fact);
    keepSample(bucket.frames, fact.frame.number);
  }
  return {
    summary: { intervalMs, intervalCount: buckets.length, rateBasis: "per_second" },
    rows: buckets.map((bucket) => {
      const durationSeconds = (bucket.endMs - bucket.startMs) / 1000;
      return {
        ...bucket,
        packetsPerSecond: bucket.packets / durationSeconds,
        wireBytesPerSecond: bucket.wireBytes / durationSeconds,
        capturedBytesPerSecond: bucket.capturedBytes / durationSeconds,
      };
    }),
  };
}
