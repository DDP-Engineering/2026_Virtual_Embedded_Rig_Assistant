import { type AutomotiveProfile, automotiveLimits, type CaptureAnalysis } from "@vera/shared";
import { DOMParser, type XmlElement } from "@xmldom/xmldom/lib/dom-parser.js";
import { doipFields, entryFields, sdMessageId, someipFields } from "./automotive-fields.js";
import { CaptureError, invalidOutput, type OfflineTshark } from "./native.js";
import { nativeUint } from "./traffic-native.js";

const dissectionIssues = [
  "doip.illegal_length_field",
  "someip.unknown_protocol_version",
  "someip.message_truncated",
  "someip.incomplete_headers",
  "someip.tp.fragment.overlap.conflicts",
  "someip.tp.fragment.multiple_tails",
  "someip.tp.fragment.too_long_fragment",
  "someip.tp.fragment.error",
  "someipsd.message_truncated",
  "someipsd.entry_array_malformed",
  "someipsd.option_array_truncated",
  "someipsd.option_array_bytes_left",
  "someipsd.option_wrong_length",
];

type TcpSegment = { frame: number; bytes: number };

/** Native provenance is internal until the analysis binds every frame number to a citation. */
export type NativeAutomotivePdu = {
  profile: AutomotiveProfile;
  frame: number;
  occurrence: number;
  fields: Record<string, number>;
  locator: { basis: "capture_frame" | "reassembled_tcp"; offset: number; bytes: number };
  payloadBytes: number | null;
  entries: Record<string, number>[];
  omittedEntries: number;
  tcpSegments: TcpSegment[];
  tpFrames: number[];
  tpFragment: boolean;
  tpReassembled: boolean;
  completedIn: number | null;
  incomplete: boolean;
};

function elements(parent: XmlElement) {
  const result: XmlElement[] = [];
  for (let child = parent.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) result.push(child as XmlElement);
  }
  return result;
}

function attr(element: XmlElement, name: string) {
  for (let index = 0; index < element.attributes.length; index++) {
    const attribute = element.attributes.item(index);
    if (attribute?.name === name) return attribute.value;
  }
  return undefined;
}

function fields(parent: XmlElement) {
  const found = new Map<string, XmlElement[]>();
  const pending = elements(parent).reverse();
  while (pending.length) {
    const node = pending.pop();
    if (node?.localName !== "field") throw invalidOutput();
    const name = attr(node, "name");
    if (name === undefined) throw invalidOutput();
    const matches = found.get(name);
    if (matches) matches.push(node);
    else found.set(name, [node]);
    for (const child of elements(node).reverse()) pending.push(child);
  }
  return found;
}

function numberField(field: XmlElement) {
  const value = attr(field, "show");
  if (value === "True") return 1;
  if (value === "False") return 0;
  return /^0x[\da-f]{1,8}$/i.test(value ?? "") ? Number(value) : nativeUint(value);
}

function optionalNumber(nodes: ReturnType<typeof fields>, name: string) {
  const matches = nodes.get(name);
  if (!matches) return null;
  const [field] = matches;
  if (matches.length !== 1 || !field) throw invalidOutput();
  return numberField(field);
}

function project(nodes: ReturnType<typeof fields>, allowed: string[]) {
  const result: Record<string, number> = {};
  for (const name of allowed) {
    const value = optionalNumber(nodes, name);
    if (value !== null) result[name] = value;
  }
  return result;
}

function relatedFrames(nodes: ReturnType<typeof fields>, field: string, through: number) {
  const numbers = (nodes.get(field) ?? []).map(numberField);
  if (numbers.some((number) => number < 1 || number > through)) throw invalidOutput();
  return [...new Set(numbers)].sort((a, b) => a - b);
}

function tcpSegments(nodes: ReturnType<typeof fields>, through: number) {
  const segments = (nodes.get("tcp.segment") ?? []).map((node) => ({
    frame: numberField(node),
    bytes: nativeUint(attr(node, "size")),
  }));
  if (
    segments.some(({ frame, bytes }) => frame < 1 || frame > through || bytes === 0) ||
    !segments.some(({ frame }) => frame === through)
  )
    throw invalidOutput();
  return segments;
}

function projectPdu(
  protocol: XmlElement,
  sd: XmlElement | undefined,
  frame: number,
  occurrence: number,
  segments: TcpSegment[],
  doip: boolean,
  scanLimit: number,
): NativeAutomotivePdu {
  const nodes = fields(protocol);
  const metadata = project(nodes, doip ? doipFields : someipFields);
  const isSd = metadata["someip.messageid"] === sdMessageId || sd !== undefined;
  const tpFragment = !doip && ((metadata["someip.messagetype"] ?? 0) & 0x20) !== 0;
  const tpFrames = relatedFrames(nodes, "someip.tp.fragment", frame);
  const reassembledLength = optionalNumber(nodes, "someip.tp.reassembled.length");
  const tpReassembled = reassembledLength !== null;
  const nativeCompletion = optionalNumber(nodes, "someip.tp.reassembled.in");
  if (nativeCompletion !== null && (nativeCompletion < frame || nativeCompletion > scanLimit))
    throw invalidOutput();
  const completedIn = reassembledLength === null ? nativeCompletion : frame;
  const sdNodes = sd && fields(sd);
  const sdEntries = sdNodes?.get("someipsd.entry") ?? [];
  const sdFlags = sdNodes ? optionalNumber(sdNodes, "someipsd.flags") : null;
  if (sdFlags !== null) metadata["someipsd.flags"] = sdFlags;

  const bytes = nativeUint(attr(protocol, "size"));
  const offset = nativeUint(attr(protocol, "pos"));
  const declared = metadata[doip ? "doip.length" : "someip.length"];
  const min = doip ? 0 : 8 + (tpFragment ? 4 : 0);
  const diagnosticOverhead = { 32769: 4, 32770: 5, 32771: 5 }[metadata["doip.type"] ?? 0] ?? 0;
  const completeHeader = doip
    ? metadata["doip.version"] !== undefined && metadata["doip.type"] !== undefined
    : metadata["someip.returncode"] !== undefined;
  const incomplete =
    !completeHeader ||
    declared === undefined ||
    declared < Math.max(min, diagnosticOverhead) ||
    bytes < declared + 8 ||
    (isSd && !sdNodes && (!tpFragment || tpReassembled)) ||
    dissectionIssues.some((issue) => nodes.has(issue) || sdNodes?.has(issue));
  return {
    profile: doip ? "doip" : isSd ? "someip_sd" : "someip",
    frame,
    occurrence,
    fields: metadata,
    locator: { basis: segments.length ? "reassembled_tcp" : "capture_frame", offset, bytes },
    payloadBytes: incomplete ? null : (reassembledLength ?? declared - min - diagnosticOverhead),
    entries: sdEntries
      .slice(0, automotiveLimits.entriesPerPdu)
      .map((entry) => project(fields(entry), entryFields)),
    omittedEntries: Math.max(0, sdEntries.length - automotiveLimits.entriesPerPdu),
    tcpSegments: segments,
    tpFrames,
    tpFragment,
    tpReassembled,
    completedIn,
    incomplete,
  };
}

export function parseAutomotiveTree(input: string, profile: AutomotiveProfile, scanLimit: number) {
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(input)) throw invalidOutput();
  const reject = () => {
    throw invalidOutput();
  };
  const { documentElement } = new DOMParser({
    errorHandler: { warning: reject, error: reject, fatalError: reject },
  }).parseFromString(input, "text/xml");
  if (documentElement?.localName !== "pdml") throw invalidOutput();
  const result = new Map<number, NativeAutomotivePdu[]>();
  let previous = 0;
  for (const packet of elements(documentElement)) {
    if (packet.localName !== "packet") throw invalidOutput();
    const protocols = elements(packet);
    const frameNode = protocols.find((node) => attr(node, "name") === "geninfo");
    const frame = frameNode && optionalNumber(fields(frameNode), "num");
    if (!frame || frame <= previous || frame > scanLimit) throw invalidOutput();
    previous = frame;
    const pdus: NativeAutomotivePdu[] = [];
    result.set(frame, pdus);
    let pendingTcp: TcpSegment[] = [];
    let occurrence = 0;
    for (const [index, protocol] of protocols.entries()) {
      const name = attr(protocol, "name");
      if (name === "fake-field-wrapper") {
        const wrappers = fields(protocol);
        if (wrappers.has("tcp.segments")) {
          if (pendingTcp.length) throw invalidOutput();
          pendingTcp = tcpSegments(wrappers, frame);
        }
        continue;
      }
      if (name !== (profile === "doip" ? "doip" : "someip")) {
        pendingTcp = [];
        continue;
      }
      const next = protocols[index + 1];
      const sd = next && attr(next, "name") === "someipsd" ? next : undefined;
      pdus.push(projectPdu(protocol, sd, frame, ++occurrence, pendingTcp, profile === "doip", scanLimit));
      pendingTcp = [];
    }
  }
  return result;
}

export async function readAutomotiveTree(
  native: OfflineTshark,
  snapshot: string,
  analysis: CaptureAnalysis,
  profile: AutomotiveProfile,
  through: number,
) {
  const protocol = profile === "doip" ? "doip" : "someip";
  try {
    const xml = await native.trafficOutput(
      snapshot,
      analysis,
      through,
      ["-T", "pdml", "-J", `tcp.segments ${protocol} someipsd`],
      automotiveLimits.nativeTreeBytes,
      protocol,
    );
    return parseAutomotiveTree(xml, profile, through);
  } catch (error) {
    if (
      error instanceof CaptureError &&
      (error.reason === "traffic_unavailable" || error.reason === "traffic_failed")
    )
      throw new CaptureError(
        "automotive_unavailable",
        "TShark could not perform the selected Automotive Ethernet dissection.",
      );
    throw error;
  }
}
