import {
  automotiveLimits,
  type CaptureAnalysis,
  type TrafficTransport,
  type WiresharkCaptureArgs,
} from "@vera/shared";
import { sdMessageId } from "./automotive-fields.js";
import { invalidOutput } from "./native.js";
import { addressFields, endpointPair, streamIds, transportFields } from "./statistics.js";
import { nativeTime, nativeUint, protocolStack, type TrafficFact } from "./traffic-native.js";

export type AutomotiveArgs = Extract<WiresharkCaptureArgs, { operation: "automotive" }>;

export const automotiveFrameFields = [
  "frame.protocols",
  "frame.encap_type",
  "frame.packet_flags_direction",
  "frame.drop_count",
  "vlan.id",
  "ieee8021ad.id",
  ...addressFields,
  ...transportFields("tcp"),
  ...transportFields("udp"),
  "tcp.len",
  "udp.length",
  "tcp.analysis.lost_segment",
  "ip.fragment",
  "ip.fragment.count",
  "ip.flags.mf",
  "ip.frag_offset",
  "ipv6.fragment",
  "ipv6.fraghdr.more",
  "ipv6.fraghdr.offset",
];

function single(fact: TrafficFact, name: string) {
  const values = fact.get(name);
  if (values.length > 1) throw invalidOutput();
  return values[0];
}

export function capturePoint(fact: TrafficFact) {
  const {
    section,
    frame: { interfaceId },
  } = fact;
  return section === null || interfaceId === null ? null : { section, interfaceId };
}

export function automotiveFrame(fact: TrafficFact) {
  const stack = protocolStack(fact);
  const rawEncapsulation = single(fact, "frame.encap_type");
  const encapsulation = rawEncapsulation === undefined ? null : nativeUint(rawEncapsulation);
  const rawDirection = single(fact, "frame.packet_flags_direction");
  if (rawDirection && !/^(?:0x[0-9a-f]{1,8}|[0-3])$/i.test(rawDirection)) throw invalidOutput();
  const direction =
    rawDirection === undefined
      ? null
      : (["unknown", "inbound", "outbound", "reserved"] as const)[Number(rawDirection)];
  if (rawDirection !== undefined && direction === undefined) throw invalidOutput();
  const customerTags = fact.get("vlan.id").map(nativeUint);
  const serviceTags = fact.get("ieee8021ad.id").map(nativeUint);
  if ([...customerTags, ...serviceTags].some((vlan) => vlan > 4095)) throw invalidOutput();
  let customerIndex = 0;
  let serviceIndex = 0;
  const vlans = stack.flatMap((node) => {
    const tag =
      node === "vlan"
        ? customerTags[customerIndex++]
        : node === "ieee8021ad"
          ? serviceTags[serviceIndex++]
          : undefined;
    return tag === undefined ? [] : [tag];
  });
  const vlanComplete =
    customerIndex === customerTags.length &&
    serviceIndex === serviceTags.length &&
    vlans.length === customerIndex + serviceIndex;
  const supportedEncapsulation = stack[0] === "eth" || (stack[0] === "ppi" && stack.includes("eth"));
  const transports = stack.filter((part): part is TrafficTransport => part === "tcp" || part === "udp");
  const transport = transports.length === 1 ? transports[0] : undefined;
  const endpoints = transport ? endpointPair(fact, transport) : undefined;
  const streams = transport ? streamIds(fact, transport) : [];
  const stream = streams.length === 1 ? streams[0] : undefined;
  const ipFragmented =
    ["ip.fragment", "ip.fragment.count", "ipv6.fragment"].some((field) => fact.get(field).length > 0) ||
    ["ip.flags.mf", "ip.frag_offset", "ipv6.fraghdr.more", "ipv6.fraghdr.offset"].some((field) =>
      fact.get(field).some((value) => value === "True" || (value !== "False" && nativeUint(value) !== 0)),
    );
  const rawLength = transport ? single(fact, transport === "tcp" ? "tcp.len" : "udp.length") : undefined;
  const payloadBytes =
    rawLength === undefined ? 0 : Math.max(0, nativeUint(rawLength) - (transport === "udp" ? 8 : 0));
  return {
    fact,
    stack,
    vlans,
    endpoints,
    transport,
    stream,
    direction: direction ?? null,
    encapsulation,
    supportedEncapsulation,
    ipFragmented,
    payloadBytes,
    vlanComplete,
  };
}

export function normalizeAddress(address: string) {
  return address.includes(":") ? new URL(`http://[${address}]/`).hostname.slice(1, -1) : address;
}

export type AutomotiveFrame = ReturnType<typeof automotiveFrame>;

export function conversationKey(frame: AutomotiveFrame, directional = false) {
  const { fact, endpoints, transport, stream, vlans } = frame;
  if (!endpoints || !transport || stream === undefined) return undefined;
  const [src, dst] = endpoints;
  const reverse = JSON.stringify(src) > JSON.stringify(dst);
  const [a, b] = reverse && !directional ? [dst, src] : [src, dst];
  const key = JSON.stringify([transport, stream, fact.section, fact.frame.interfaceId, vlans, a, b]);
  return { key, a, b, reverse, transport, stream };
}

export function directionalObservation(frame: AutomotiveFrame | undefined) {
  if (!frame?.supportedEncapsulation || frame.ipFragmented || !frame.vlanComplete) return undefined;
  return conversationKey(frame, true)?.key;
}

function isOtherSomeipVariant(frame: AutomotiveFrame, profile: AutomotiveArgs["automotiveProfile"]) {
  if (profile === "doip") return false;
  const ids = frame.fact.get("someip.messageid");
  return ids.length > 0 && ids.every((id) => (Number(id) === sdMessageId) !== (profile === "someip_sd"));
}

export function chooseFrames(args: AutomotiveArgs, analysis: CaptureAnalysis, frames: AutomotiveFrame[]) {
  const addresses = new Set(args.addresses?.map(normalizeAddress));
  return frames.filter((frame) => {
    const decoded = frame.stack.includes(args.automotiveProfile === "doip" ? "doip" : "someip");
    const { endpoints, transport } = frame;
    const unresolved = !frame.supportedEncapsulation || !frame.vlanComplete || frame.ipFragmented || decoded;
    if (args.vlan !== undefined && frame.vlanComplete && !frame.vlans.includes(args.vlan)) return false;
    if (addresses.size) {
      const network = endpoints ?? [
        ...(endpointPair(frame.fact, "ipv4") ?? []),
        ...(endpointPair(frame.fact, "ipv6") ?? []),
      ];
      if (
        network.length
          ? !network.some(({ address }) => addresses.has(normalizeAddress(address)))
          : !unresolved
      )
        return false;
    }
    const ports = args.ports;
    if (
      ports &&
      (endpoints ? !endpoints.some(({ port }) => port !== null && ports.includes(port)) : !unresolved)
    )
      return false;
    if (isOtherSomeipVariant(frame, args.automotiveProfile)) return false;
    if (unresolved) return true;
    return endpoints?.some(
      ({ port }) =>
        (args.automotiveProfile === "doip" && port === 13400) ||
        args.ports?.some((selected) => selected === port) ||
        analysis.decodeAs.some((mapping) => mapping.transport === transport && mapping.port === port),
    );
  });
}

export function observationCoverage(
  frames: AutomotiveFrame[],
  expectedPoints: AutomotiveArgs["expectedPoints"],
) {
  const points = new Map<string, { section: number; interfaceId: number; packets: number }>();
  const previousTime = new Map<string, bigint>();
  let missingObservationPointFrames = 0;
  let framesWithoutTimestamp = 0;
  let timestampBacksteps = 0;
  let dropReports = 0;
  let drops = 0n;
  for (const { fact } of frames) {
    const point = capturePoint(fact);
    const key = point ? JSON.stringify([point.section, point.interfaceId]) : "";
    if (!point) missingObservationPointFrames++;
    else {
      const known = points.get(key);
      if (known) known.packets++;
      else points.set(key, { ...point, packets: 1 });
    }
    const stamp = fact.frame.timestampEpoch;
    if (stamp === null) framesWithoutTimestamp++;
    else if (point) {
      const time = nativeTime(stamp);
      const previous = previousTime.get(key);
      if (previous !== undefined && time < previous) timestampBacksteps++;
      previousTime.set(key, time);
    }
    const dropsHere = single(fact, "frame.drop_count");
    if (dropsHere !== undefined) {
      if (!/^\d{1,20}$/.test(dropsHere) || BigInt(dropsHere) > 18_446_744_073_709_551_615n)
        throw invalidOutput();
      drops += BigInt(dropsHere);
      dropReports++;
    }
  }
  const missingExpectedPoints = (expectedPoints ?? []).filter(
    (point) => !points.has(JSON.stringify([point.section, point.interfaceId])),
  );
  return {
    observationPoints: [...points.values()].slice(0, automotiveLimits.observationPoints),
    omittedObservationPoints: Math.max(0, points.size - automotiveLimits.observationPoints),
    missingObservationPointFrames,
    missingExpectedPoints,
    framesWithoutTimestamp,
    timestampBacksteps,
    clockSynchronization: "unknown",
    dropReports,
    knownDrops: dropReports ? drops.toString() : null,
    dropCoverage: "packet_drop_metadata_only",
    limitOfInference: "observed_at_saved_capture_interfaces",
  };
}
