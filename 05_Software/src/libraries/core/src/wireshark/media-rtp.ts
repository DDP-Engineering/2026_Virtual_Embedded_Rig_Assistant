import { isIP } from "node:net";
import type { CaptureMediaResult } from "@vera/shared";
import { nativeTime, type TrafficFact } from "./traffic-native.js";

type RtpProjection = NonNullable<CaptureMediaResult["media"]["rtp"]>;
type Stream = RtpProjection["streams"][number];
type Packet = {
  frame: number;
  sequence: number;
  stamp: number;
  payloadType: number;
  arrival: bigint | null;
  setupFrames: string[];
};
export const rtpFields = [
  "rtp.ssrc",
  "rtp.timestamp",
  "rtp.setup-frame",
  "udp.srcport",
  "udp.dstport",
  "udp.stream",
  "ip.src",
  "ip.dst",
  "ipv6.src",
  "ipv6.dst",
  "vlan.id",
  "ip.flags.mf",
  "ip.frag_offset",
];

function single(fact: TrafficFact, field: string) {
  const values = fact.get(field);
  return values.length === 1 ? values[0] : undefined;
}

function numberField(fact: TrafficFact, field: string, max: number) {
  const value = single(fact, field);
  if (value === undefined || !/^(?:\d{1,10}|0x[0-9a-f]{1,8})$/i.test(value)) return undefined;
  const number = Number(value);
  return number <= max ? number : undefined;
}

function identify(fact: TrafficFact, stack: string[]) {
  const layers = stack.filter((name) => ["ip", "ipv6", "ipv6.fraghdr", "udp", "rtp"].includes(name));
  const [ip] = layers;
  if (layers.length !== 3 || (ip !== "ip" && ip !== "ipv6") || layers[1] !== "udp" || layers[2] !== "rtp")
    return undefined;
  if (fact.capturedBytes < fact.wireBytes) return undefined;
  if (
    ip === "ip" &&
    (single(fact, "ip.flags.mf") !== "False" || numberField(fact, "ip.frag_offset", 8191) !== 0)
  )
    return undefined;
  const source = single(fact, `${ip}.src`);
  const destination = single(fact, `${ip}.dst`);
  if (!source || !destination || !isIP(source) || !isIP(destination)) return undefined;
  const sourcePort = numberField(fact, "udp.srcport", 65535);
  const destinationPort = numberField(fact, "udp.dstport", 65535);
  const udp = numberField(fact, "udp.stream", 0xffffffff);
  const ssrc = numberField(fact, "rtp.ssrc", 0xffffffff);
  const sequence = numberField(fact, "rtp.seq", 65535);
  const stamp = numberField(fact, "rtp.timestamp", 0xffffffff);
  const payloadType = numberField(fact, "rtp.p_type", 127);
  if (
    [sourcePort, destinationPort, udp, ssrc].includes(undefined) ||
    sequence === undefined ||
    stamp === undefined ||
    payloadType === undefined
  )
    return undefined;
  const vlans = fact.get("vlan.id");
  if (vlans.length !== stack.filter((protocol) => protocol === "vlan").length) return undefined;
  const key = JSON.stringify([
    fact.section,
    fact.frame.interfaceId,
    vlans,
    udp,
    source,
    sourcePort,
    destination,
    destinationPort,
    ssrc,
  ]);
  const { number, timestampEpoch } = fact.frame;
  const packet: Packet = {
    frame: number,
    sequence,
    stamp,
    payloadType,
    arrival: timestampEpoch === null ? null : nativeTime(timestampEpoch),
    setupFrames: fact.get("rtp.setup-frame"),
  };
  return { key, packet };
}

function sequenceGaps(packets: Packet[], initial: Packet) {
  let low = initial.sequence;
  let high = low;
  const seen = new Set([low]);
  for (const { sequence } of packets.slice(1)) {
    const step = ((sequence - high + 32768) & 0xffff) - 32768;
    if (step > 3000 || step < -100) return null;
    const extended = high + step;
    seen.add(extended);
    low = Math.min(low, extended);
    high = Math.max(high, extended);
  }
  return high - low + 1 - seen.size;
}

function streamStats(
  initial: Packet,
  packets: Packet[],
  complete: boolean,
  allowClockAssumption: boolean,
): Stream {
  const result: Stream = {
    frame: initial.frame,
    packets: packets.length,
    missingSequenceNumbers: null,
    maxDeltaMs: null,
    jitterMs: null,
    jitterClock: null,
    limitations: [],
  };
  if (!complete) {
    result.limitations.push("scope_limited");
    return result;
  }
  if (packets.length < 2) {
    result.limitations.push("too_few_packets");
    return result;
  }
  result.missingSequenceNumbers = sequenceGaps(packets, initial);
  if (result.missingSequenceNumbers === null) result.limitations.push("sequence_discontinuity");
  const useDefaultClock =
    allowClockAssumption &&
    [0, 8].includes(initial.payloadType) &&
    packets.every(
      ({ payloadType, setupFrames }) =>
        payloadType === initial.payloadType &&
        (setupFrames.length === 0 || (setupFrames.length === 1 && setupFrames[0] === String(initial.frame))),
    );
  if (!useDefaultClock) result.limitations.push("clock_rate_unavailable");
  let previous = initial;
  let maxDelta = 0;
  let jitter = 0;
  for (const packet of packets.slice(1)) {
    if (packet.arrival === null || previous.arrival === null || packet.arrival < previous.arrival) {
      result.limitations.push("arrival_time_unavailable");
      return result;
    }
    const deltaMs = Number(packet.arrival - previous.arrival) / 1e9;
    maxDelta = Math.max(maxDelta, deltaMs);
    if (useDefaultClock) {
      const stampDelta = (packet.stamp - previous.stamp) | 0;
      jitter += (Math.abs(deltaMs - stampDelta / 8) - jitter) / 16;
    }
    previous = packet;
  }
  result.maxDeltaMs = maxDelta;
  if (useDefaultClock && result.missingSequenceNumbers !== null) {
    result.jitterMs = jitter;
    result.jitterClock = "assumed_rtp_avp_8khz";
  }
  return result;
}

export function mediaRtp(
  facts: { fact: TrafficFact; stack: string[] }[],
  complete: boolean,
  limit: number,
  explicitRtpPort = false,
): RtpProjection {
  const groups = new Map<string, Packet[]>();
  let unresolvedFrames = 0;
  for (const { fact, stack } of facts) {
    if (!stack.includes("rtp")) continue;
    const identified = identify(fact, stack);
    if (!identified) {
      unresolvedFrames++;
      continue;
    }
    const { key, packet } = identified;
    const group = groups.get(key);
    if (group) group.push(packet);
    else groups.set(key, [packet]);
  }
  const fullScope = complete && unresolvedFrames === 0;
  const allowClockAssumption = explicitRtpPort && !facts.some(({ stack }) => stack.includes("sdp"));
  const streams = [...groups.values()]
    .slice(0, limit)
    .flatMap((packets) =>
      packets[0] ? [streamStats(packets[0], packets, fullScope, allowClockAssumption)] : [],
    );
  return {
    scope: fullScope ? "whole_capture" : "partial_observation",
    unresolvedFrames,
    streamsOmitted: groups.size - streams.length,
    streams,
  };
}
