import {
  type NetworkObservation,
  type NetworkProfile,
  networkLimits,
  networkProfileSchema,
  networkQueryProfiles,
  type TrafficTransport,
} from "@vera/shared";
import { observedFlags, streamDiagnosticFields } from "./diagnostics.js";
import { invalidOutput } from "./native.js";
import { addressFields, endpointPair, transportFields } from "./statistics.js";
import { nativeUint, type TrafficFact } from "./traffic-native.js";

export const ipFragmentFields = [
  {
    more: "ip.flags.mf",
    offset: "ip.frag_offset",
    transport: "ip.proto",
    completion: "ip.reassembled_in",
    contributors: "ip.fragment",
    count: "ip.fragment.count",
    error: "ip.fragment.error",
  },
  {
    more: "ipv6.fraghdr.more",
    offset: "ipv6.fraghdr.offset",
    transport: "ipv6.fraghdr.nxt",
    completion: "ipv6.reassembled.in",
    contributors: "ipv6.fragment",
    count: "ipv6.fragment.count",
    error: "ipv6.fragment.error",
  },
] as const;
const v4 = ["ip.src", "ip.dst", "ip.ttl", ...Object.values(ipFragmentFields[0])];
const v6 = ["ipv6.src", "ipv6.dst", "ipv6.nxt", "ipv6.hlim", ...Object.values(ipFragmentFields[1])];
const arp = ["arp.opcode", "arp.src.hw_mac", "arp.dst.hw_mac", "arp.src.proto_ipv4", "arp.dst.proto_ipv4"];
const nd = [
  "icmpv6.type",
  "icmpv6.code",
  "icmpv6.nd.ns.target_address",
  "icmpv6.nd.na.target_address",
  "icmpv6.nd.na.flag.s",
  "icmpv6.nd.rd.target_address",
  "icmpv6.opt.src_linkaddr",
  "icmpv6.opt.target_linkaddr",
  "icmpv6.nd.ra.router_lifetime",
];
const dns = [
  "dns.id",
  "dns.flags.response",
  "dns.flags.rcode",
  "dns.flags.truncated",
  "dns.qry.type",
  "dns.a",
  "dns.aaaa",
];
export const dnsLinks = ["dns.response_in", "dns.response_to"] as const;
const dhcp = [
  "dhcp.id",
  "dhcp.option.dhcp",
  "dhcp.hw.mac_addr",
  "dhcp.ip.client",
  "dhcp.ip.your",
  "dhcp.ip.server",
  "dhcp.ip.relay",
  "dhcp.option.dhcp_server_id",
];
const dhcpv6 = ["dhcpv6.xid", "dhcpv6.msgtype", "dhcpv6.iaaddr.ip"];
const multicast = [
  "igmp.type",
  "igmp.maddr",
  "igmp.record_type",
  "igmp.saddr",
  "icmpv6.type",
  "icmpv6.mld.multicast_address",
  "icmpv6.mldr.mar.multicast_address",
  "icmpv6.mldr.mar.record_type",
];
const tls = [
  "tls.record.content_type",
  "tls.record.opaque_type",
  "tls.record.version",
  "tls.handshake.type",
  "tls.handshake.version",
  "tls.handshake.extensions.supported_version",
  "tls.handshake.ciphersuite",
  "tls.reassembled_in",
  "tls.segment.error",
];
const transport = [
  ...transportFields("tcp"),
  ...transportFields("udp"),
  ...streamDiagnosticFields,
  "tcp.flags.reset",
  "tcp.len",
  "udp.length",
  "tcp.checksum.status",
  "tcp.checksum.partial",
  "udp.checksum.status",
  "udp.checksum.partial",
  "tcp.segment.error",
  "tcp.reassembled_in",
  "ip.proto",
  "ipv6.fraghdr.nxt",
];
const coverageFields = [
  "frame.protocols",
  "frame.drop_count",
  "vlan.id",
  ...addressFields,
  ...transportFields("tcp"),
  ...transportFields("udp"),
  "tcp.len",
  "tcp.analysis.lost_segment",
  "tcp.analysis.ack_lost_segment",
  "tcp.segment.error",
  "tcp.reassembled_in",
  "tcp.segment",
  "tcp.segment.count",
  "tls.segment",
  "tls.segment.count",
  "tls.segment.error",
  "tls.reassembled_in",
  ...ipFragmentFields.flatMap((fields) => Object.values(fields)),
];

export const networkProfiles = {
  ethernet_vlan: {
    fields: ["eth.src", "eth.dst", "eth.type", "vlan.id", "vlan.etype", "vlan.priority"],
    text: [],
  },
  ipv4_ipv6: { fields: [...v4, ...v6], text: [] },
  arp_nd: { fields: [...arp, ...nd], text: [] },
  dns_dhcp: { fields: [...dns, ...dhcp, ...dhcpv6], text: ["dns.qry.name"] },
  tcp_udp: { fields: transport, text: [] },
  multicast: { fields: multicast, text: [] },
  tls: { fields: tls, text: ["tls.handshake.extensions_server_name", "tls.handshake.extensions_alpn_str"] },
} satisfies Record<NetworkProfile, { fields: readonly string[]; text: readonly string[] }>;

export const networkingCapabilities = {
  profiles: networkProfileSchema.options,
  queries: networkQueryProfiles,
  evidenceModes: ["observations", "compact"],
  nativeSupport: "checked_when_requested",
  limits: networkLimits,
} as const;

const identifiers = new Set([
  ...addressFields,
  "arp.src.hw_mac",
  "arp.dst.hw_mac",
  "arp.src.proto_ipv4",
  "arp.dst.proto_ipv4",
  "icmpv6.nd.ns.target_address",
  "icmpv6.nd.na.target_address",
  "icmpv6.nd.rd.target_address",
  "icmpv6.opt.src_linkaddr",
  "icmpv6.opt.target_linkaddr",
  "dns.a",
  "dns.aaaa",
  "dns.qry.name",
  "dhcp.hw.mac_addr",
  "dhcp.ip.client",
  "dhcp.ip.your",
  "dhcp.ip.server",
  "dhcp.ip.relay",
  "dhcp.option.dhcp_server_id",
  "dhcpv6.iaaddr.ip",
  "igmp.maddr",
  "igmp.saddr",
  "icmpv6.mld.multicast_address",
  "icmpv6.mldr.mar.multicast_address",
  ...networkProfiles.tls.text,
]);
export const sensitiveNetworkField = (field: string) => identifiers.has(field);

export function networkPoint(fact: TrafficFact) {
  const vlans = fact.get("vlan.id").map(nativeUint);
  if (vlans.some((vlan) => vlan > 4095)) throw invalidOutput();
  return { section: fact.section, interfaceId: fact.frame.interfaceId, vlans };
}

export function hasIpFragment(fact: TrafficFact, fields: (typeof ipFragmentFields)[number]) {
  return (
    fact.get(fields.more).some((flag) => /^(1|true)$/i.test(flag)) ||
    fact.get(fields.offset).some((offset) => nativeUint(offset) > 0)
  );
}

export function networkingFields(profile: NetworkProfile) {
  return [
    ...new Set([
      ...coverageFields,
      ...networkProfiles[profile].fields,
      ...(profile === "dns_dhcp" ? dnsLinks : []),
    ]),
  ];
}

function multicastDestination(fact: TrafficFact) {
  const v4 = fact.get("ip.dst").some((address) => /^2(?:2[4-9]|3\d)\./.test(address));
  const v6 = fact.get("ipv6.dst").some((address) => /^ff[\da-f]{2}:/i.test(address));
  const ethernet = fact
    .get("eth.dst")
    .some(
      (address) => /^(?:[\da-f][13579bdf]:)/i.test(address) && address.toLowerCase() !== "ff:ff:ff:ff:ff:ff",
    );
  return v4 || v6 || ethernet;
}

function transportProtocol(fact: TrafficFact, stack: string[]) {
  const tcp = stack.includes("tcp");
  const udp = stack.includes("udp");
  const fragmentProtocols = ipFragmentFields.flatMap((fields) =>
    hasIpFragment(fact, fields) ? fact.get(fields.transport).map(nativeUint) : [],
  );
  const includesTcp = tcp || fragmentProtocols.includes(6);
  const includesUdp = udp || fragmentProtocols.includes(17);
  if (includesTcp && includesUdp) return "transport_ambiguous";
  if (includesTcp) return tcp ? "tcp" : "tcp_fragment";
  if (includesUdp) return udp ? "udp" : "udp_fragment";
  return null;
}

type NetworkProtocol = NetworkObservation["protocol"];

export function matchesNetworkTransport(protocol: NetworkProtocol, transport: TrafficTransport) {
  return protocol === transport || protocol === `${transport}_fragment` || protocol === "transport_ambiguous";
}

export function networkProtocol(
  profile: NetworkProfile,
  fact: TrafficFact,
  stack: string[],
): NetworkProtocol | null {
  const has = (name: string) => stack.includes(name);
  const icmp = fact.get("icmpv6.type").map(nativeUint);
  switch (profile) {
    case "ethernet_vlan":
      return has("eth") ? "ethernet" : fact.get("vlan.id").length ? "vlan" : null;
    case "ipv4_ipv6":
      return stack.find((name) => name === "ip" || name === "ipv6") === "ip"
        ? "ipv4"
        : has("ipv6")
          ? "ipv6"
          : null;
    case "arp_nd":
      return has("arp") ? "arp" : icmp.some((value) => value >= 133 && value <= 137) ? "nd" : null;
    case "dns_dhcp":
      return has("dns") || has("mdns") || has("llmnr")
        ? "dns"
        : has("dhcp")
          ? "dhcp"
          : has("dhcpv6")
            ? "dhcpv6"
            : null;
    case "tcp_udp":
      return transportProtocol(fact, stack);
    case "multicast":
      return has("igmp")
        ? "igmp"
        : icmp.some((value) => [130, 131, 132, 143].includes(value))
          ? "mld"
          : multicastDestination(fact)
            ? "multicast"
            : null;
    case "tls":
      if (has("tls")) return "tls";
      return fact.get("tcp.len").some((length) => nativeUint(length) > 0) &&
        endpointPair(fact, "tcp")?.some(({ port }) => port === 443)
        ? "tls_candidate"
        : null;
  }
}

export function networkSymptoms(fact: TrafficFact) {
  const symptoms: NetworkObservation["symptoms"] = observedFlags(fact);
  if (fact.get("tcp.flags.reset").some((value) => /^(1|true)$/i.test(value))) symptoms.push("reset");
  return symptoms;
}

export function networkEndpoints(fact: TrafficFact, protocol: NetworkObservation["protocol"]) {
  if (protocol === "vlan" || protocol === "transport_ambiguous" || protocol.endsWith("_fragment"))
    return undefined;
  if (protocol === "ethernet" || protocol === "arp") return endpointPair(fact, "ethernet");
  if (protocol === "ipv4" || protocol === "ipv6") return endpointPair(fact, protocol);
  if (protocol === "nd" || protocol === "mld") return endpointPair(fact, "ipv6");
  if (protocol === "igmp") return endpointPair(fact, "ipv4");
  const tcp = endpointPair(fact, "tcp");
  const udp = endpointPair(fact, "udp");
  if (tcp && udp) return undefined;
  if (protocol === "tcp" || protocol.startsWith("tls")) return tcp;
  if (protocol === "udp" || protocol.startsWith("dhcp")) return udp;
  if (fact.get("ip.src").length && fact.get("ipv6.src").length) return tcp ?? udp;
  return (
    tcp ??
    udp ??
    endpointPair(fact, "ipv4") ??
    endpointPair(fact, "ipv6") ??
    (protocol === "multicast" ? endpointPair(fact, "ethernet") : undefined)
  );
}
