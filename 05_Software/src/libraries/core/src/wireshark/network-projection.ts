import {
  type CaptureNetworkingResult,
  type NetworkConversation,
  type NetworkObservation,
  type NetworkProfile,
  networkConversationSchema,
  networkLimits,
  type TrafficTransport,
  trafficLimits,
} from "@vera/shared";
import { CaptureError } from "./native.js";
import {
  dnsLinks,
  networkEndpoints,
  networkPoint,
  networkProfiles,
  networkSymptoms,
  sensitiveNetworkField,
} from "./network-profiles.js";
import type { NetworkReassembly } from "./network-reassembly.js";
import { directionalGroups, type TrafficProjection } from "./statistics.js";
import { nativeUint, protocolStack, type TrafficAddress, type TrafficFact } from "./traffic-native.js";

export type NetworkFact = { fact: TrafficFact; protocol: NetworkObservation["protocol"] };
type NetworkView = CaptureNetworkingResult["networking"];
const transportProtocols = new Set(["tcp", "udp", "dns", "dhcp", "dhcpv6", "tls", "tls_candidate"]);

function endpoint(value: TrafficAddress | undefined, compact: boolean) {
  if (!value) return null;
  return { address: compact ? null : value.address, port: value.port, redacted: compact };
}

export function dnsRelationship(fact: TrafficFact, scanned: TrafficFact[], scoped: Set<number>) {
  const absent = { status: "counterpart_not_observed" } as const;
  const ambiguous = { status: "ambiguous_context" } as const;
  const [responseIn, responseTo] = dnsLinks.map((key) => fact.get(key));
  const links = [...(responseIn ?? []), ...(responseTo ?? [])];
  const [flag] = fact.get("dns.flags.response");
  const [id] = fact.get("dns.id");
  if (fact.get("dns.id").length > 1 || fact.get("dns.flags.response").length > 1 || links.length > 1)
    return ambiguous;
  if (!id || flag === undefined || !links.length) return absent;
  const isResponse = /^(1|true)$/i.test(flag);
  const number = nativeUint(links[0]);
  if (number < 1 || (isResponse ? number >= fact.frame.number : number <= fact.frame.number))
    return ambiguous;
  const counterpart = scanned[number - 1];
  if (!counterpart) return absent;
  const peers = networkEndpoints(fact, "dns");
  const reverse = networkEndpoints(counterpart, "dns");
  const reciprocal = counterpart.get(isResponse ? dnsLinks[0] : dnsLinks[1]);
  const reverseId = counterpart.get("dns.id");
  const reverseFlag = counterpart.get("dns.flags.response");
  const transport = protocolStack(fact).find((name) => name === "tcp" || name === "udp");
  if (
    !peers ||
    !reverse ||
    !transport ||
    !protocolStack(counterpart).includes(transport) ||
    JSON.stringify(peers) !== JSON.stringify([reverse[1], reverse[0]]) ||
    JSON.stringify(networkPoint(fact)) !== JSON.stringify(networkPoint(counterpart)) ||
    reverseId.length !== 1 ||
    reverseId[0] !== id ||
    reverseFlag.length !== 1 ||
    /^(1|true)$/i.test(reverseFlag[0] ?? "") === isResponse ||
    reciprocal.length !== 1 ||
    nativeUint(reciprocal[0]) !== fact.frame.number ||
    (isResponse ? !responseTo?.length : !responseIn?.length)
  )
    return ambiguous;
  return { status: "native_link", counterpartFrame: number, counterpartInScope: scoped.has(number) } as const;
}

export function networkObservation(
  { fact, protocol }: NetworkFact,
  profile: NetworkProfile,
  compact: boolean,
  relationship: NetworkObservation["dnsRelationship"],
  text: Record<string, string[]>,
  textLimited: boolean,
  includeExchange: boolean,
  reassembly: NetworkReassembly | undefined,
): NetworkObservation {
  const point = networkPoint(fact);
  const fields: NetworkObservation["fields"] = {};
  const redactedFields: string[] = [];
  const withheldFields: string[] = [];
  const vlansLimited = point.vlans.length > networkLimits.fieldValues;
  let valuesLimited = vlansLimited || textLimited;
  const uncertainTransport = reassembly?.status.transportContextUnverified;
  const withhold =
    (uncertainTransport && transportProtocols.has(protocol)) ||
    (reassembly?.status.pendingOrInvalid &&
      ["tls", "dns", "dhcp", "dhcpv6", "igmp", "mld", "nd"].includes(protocol));
  for (const field of [...networkProfiles[profile].fields, ...networkProfiles[profile].text]) {
    const values = text[field] ?? fact.get(field);
    if (!values.length) continue;
    if (withhold) {
      withheldFields.push(field);
      continue;
    }
    if (compact && sensitiveNetworkField(field)) {
      redactedFields.push(field);
      continue;
    }
    if (
      values.length > networkLimits.fieldValues ||
      values.some((value) => value.length > networkLimits.valueChars)
    )
      valuesLimited = true;
    fields[field] = values
      .slice(0, networkLimits.fieldValues)
      .map((value) => value.slice(0, networkLimits.valueChars));
  }
  const [source, destination] = observationEndpoints({ fact, protocol }, reassembly) ?? [];
  const bytesTruncated = fact.capturedBytes < fact.wireBytes;
  const observationFrame = fact.frame.number;
  const counterpart = relationship?.status === "native_link" ? [relationship.counterpartFrame] : [];
  const frames = [...new Set([observationFrame, ...counterpart, ...(reassembly?.frames ?? [])])].sort(
    (a, b) => a - b,
  );
  return {
    kind: "observation",
    protocol,
    ...point,
    vlans: point.vlans.slice(0, networkLimits.fieldValues),
    vlansLimited,
    frames,
    observationFrame,
    source: endpoint(source, compact),
    destination: endpoint(destination, compact),
    fields,
    redactedFields,
    valuesLimited,
    truncated: bytesTruncated,
    symptoms: uncertainTransport ? [] : networkSymptoms(fact),
    opaqueTls: !withhold && opaqueTls(fact),
    reassembly: reassembly ? { ...reassembly.status, withheldFields } : null,
    exchange: includeExchange && !withhold ? exchangePhase(fact, protocol) : null,
    dnsRelationship: relationship,
  };
}

export function observationEndpoints({ fact, protocol }: NetworkFact, reassembly?: NetworkReassembly) {
  if (reassembly?.status.transportContextUnverified && transportProtocols.has(protocol)) return undefined;
  return networkEndpoints(fact, protocol);
}

const ndPhases = {
  133: "router_solicitation",
  134: "router_advertisement",
  135: "neighbor_solicitation",
  136: "neighbor_advertisement",
  137: "redirect",
} as const;

function exchangePhase(
  fact: TrafficFact,
  protocol: NetworkObservation["protocol"],
): NetworkObservation["exchange"] {
  function single(field: string) {
    const values = fact.get(field);
    return values.length === 1 ? values[0] : undefined;
  }
  function messageType(field: string) {
    const value = single(field);
    return value === undefined ? null : nativeUint(value);
  }
  function transactionId(field: string) {
    const value = single(field);
    return value && /^0x[\da-f]{1,8}$/i.test(value) ? value : null;
  }
  if (protocol === "arp") {
    const code = messageType("arp.opcode");
    return {
      messageType: code,
      transactionId: null,
      phase: code === 1 ? "request" : code === 2 ? "response" : "undetermined",
    };
  }
  if (protocol === "nd") {
    const code = messageType("icmpv6.type");
    return {
      messageType: code,
      transactionId: null,
      phase: ndPhases[code as keyof typeof ndPhases] ?? "undetermined",
    };
  }
  if (protocol === "dns") {
    const flag = single("dns.flags.response");
    const phase = /^(1|true)$/i.test(flag ?? "")
      ? "response"
      : /^(0|false)$/i.test(flag ?? "")
        ? "request"
        : "undetermined";
    return { messageType: null, transactionId: transactionId("dns.id"), phase };
  }
  if (protocol === "dhcp" || protocol === "dhcpv6") {
    const v4 = protocol === "dhcp";
    const code = messageType(v4 ? "dhcp.option.dhcp" : "dhcpv6.msgtype");
    const ports = networkEndpoints(fact, protocol);
    const client = v4 ? 68 : 546;
    const phase =
      ports?.[0].port === client
        ? "client_message"
        : ports?.[1].port === client
          ? "server_message"
          : "undetermined";
    return { messageType: code, transactionId: transactionId(v4 ? "dhcp.id" : "dhcpv6.xid"), phase };
  }
  return null;
}

export function opaqueTls(fact: TrafficFact) {
  return [...fact.get("tls.record.content_type"), ...fact.get("tls.record.opaque_type")].includes("23");
}

function conversationPoints(
  facts: NetworkFact[],
  transport: TrafficTransport,
  reassembly: ReadonlyMap<number, NetworkReassembly>,
) {
  const groups = new Map<string, { point: ReturnType<typeof networkPoint>; facts: TrafficFact[] }>();
  let omitted = 0;
  for (const { fact, protocol } of facts) {
    if (protocol !== transport || reassembly.get(fact.frame.number)?.status.transportContextUnverified) {
      omitted++;
      continue;
    }
    const point = networkPoint(fact);
    const key = JSON.stringify(point);
    const common = groups.get(key);
    if (common) common.facts.push(fact);
    else groups.set(key, { point, facts: [fact] });
  }
  return { points: groups.values(), omitted };
}

function conversation(
  row: TrafficProjection["rows"][number],
  transport: TrafficTransport,
  point: ReturnType<typeof networkPoint>,
  compact: boolean,
): NetworkConversation {
  const a = endpoint(row.a as TrafficAddress | undefined, compact);
  const b = endpoint(row.b as TrafficAddress | undefined, compact);
  return networkConversationSchema.parse({
    kind: "conversation",
    protocol: transport,
    ...point,
    vlans: point.vlans.slice(0, networkLimits.fieldValues),
    vlansLimited: point.vlans.length > networkLimits.fieldValues,
    frames: row.frames,
    stream: row.stream,
    a,
    b,
    aToB: row.aToB,
    bToA: row.bToA,
  });
}

export function networkConversations(
  facts: NetworkFact[],
  transport: TrafficTransport,
  compact: boolean,
  reassembly: ReadonlyMap<number, NetworkReassembly>,
) {
  const rows: NetworkConversation[] = [];
  const { points, omitted: unmatched } = conversationPoints(facts, transport, reassembly);
  let omitted = unmatched;
  for (const { point, facts: atPoint } of points) {
    const { summary, rows: groups } = directionalGroups(atPoint, transport, "conversations");
    omitted += Number(summary.ambiguousFrames);
    if (rows.length + groups.length > trafficLimits.aggregateGroups)
      throw new CaptureError("traffic_group_limit", "Too many conversations. Narrow the display filter.");
    for (const row of groups) rows.push(conversation(row, transport, point, compact));
  }
  return { rows, omitted };
}

export function trimNetworkPage(view: NetworkView, coverage: CaptureNetworkingResult["coverage"]) {
  if (view.rows.length <= 1) return false;
  view.rows.pop();
  const frames = new Set(view.rows.flatMap((row) => row.frames));
  view.evidence = view.evidence.filter(({ frame }) => frames.has(frame.number));
  view.page.next = { querySha256: view.page.querySha256, offset: view.page.offset + view.rows.length };
  coverage.returned = view.rows.length;
  coverage.partial = true;
  coverage.truncated = true;
  return true;
}
