import { createHash } from "node:crypto";
import {
  automotiveLimits,
  automotiveProfileSchema,
  type CaptureAnalysis,
  type CaptureCoverage,
  type CaptureReference,
} from "@vera/shared";
import { doipFields, entryFields, someipFields } from "./automotive-fields.js";
import { type NativeAutomotivePdu, readAutomotiveTree } from "./automotive-native.js";
import { pduReassemblyEvidence, someipTpLinks } from "./automotive-reassembly.js";
import {
  type AutomotiveArgs,
  type AutomotiveFrame,
  automotiveFrame,
  automotiveFrameFields,
  chooseFrames,
  conversationKey,
  directionalObservation,
  observationCoverage,
} from "./automotive-scope.js";
import { captureCitation } from "./citations.js";
import { CaptureError, invalidOutput, type OfflineTshark } from "./native.js";
import { count, counts } from "./statistics.js";
import { readTrafficFacts } from "./traffic-native.js";

const sdDecodeAs = { transport: "udp", port: 30490, protocol: "someip" } as const;
const profileFields = {
  doip: doipFields,
  someip: someipFields,
  someip_sd: [...someipFields, "someipsd.flags", ...entryFields],
};
export const automotiveCapabilities = {
  profiles: automotiveProfileSchema.options,
  encapsulation: ["ethernet", "ppi_ethernet"],
  transports: ["tcp", "udp"],
  defaultPorts: { doip: { tcp: [13400], udp: [13400] }, someip: {}, someip_sd: { udp: [30490] } },
  defaultDecodeAs: { someip_sd: [sdDecodeAs] },
  fields: profileFields,
  reassembly: { tcp: "upstream_in_order", someipTp: "upstream", nativePasses: 2 },
  payloadView: "verified_local_capture_only",
  nativeSupport: "checked_when_requested",
  limits: automotiveLimits,
} as const;

export function automotiveDecodeAs(args: AutomotiveArgs) {
  const decodeAs = args.decodeAs ?? [];
  const dissector = args.automotiveProfile === "doip" ? "doip" : "someip";
  const addSd =
    args.automotiveProfile === "someip_sd" &&
    !decodeAs.some(({ transport, port }) => transport === sdDecodeAs.transport && port === sdDecodeAs.port);
  if (
    decodeAs.some(({ protocol }) => protocol !== dissector) ||
    (addSd && decodeAs.length >= automotiveLimits.selectors)
  )
    throw new CaptureError(
      "invalid_decode_as",
      "Use the selected Automotive Ethernet dissector and at most eight effective mappings.",
    );
  return addSd ? [...decodeAs, sdDecodeAs] : decodeAs;
}

type AutomotiveConversation = {
  id: number;
  a: NonNullable<AutomotiveFrame["endpoints"]>[number];
  b: NonNullable<AutomotiveFrame["endpoints"]>[number];
  transport: "tcp" | "udp";
  stream: number;
  section: number | null;
  interfaceId: number | null;
  vlans: number[];
  forward: ReturnType<typeof counts> & { pdus: number };
  reverse: ReturnType<typeof counts> & { pdus: number };
};

function transportConversations(frames: AutomotiveFrame[]) {
  const groups = new Map<string, AutomotiveConversation>();
  const byFrame = new Map<number, { group: AutomotiveConversation; reverse: boolean }>();
  for (const frame of frames) {
    if (!frame.supportedEncapsulation || frame.ipFragmented || !frame.vlanComplete) continue;
    const identity = conversationKey(frame);
    if (!identity) continue;
    const { key, a, b, transport, stream, reverse } = identity;
    const { fact, vlans } = frame;
    let group = groups.get(key);
    if (!group) {
      group = {
        id: fact.frame.number,
        a,
        b,
        stream,
        transport,
        vlans,
        section: fact.section,
        interfaceId: fact.frame.interfaceId,
        forward: { ...counts(), pdus: 0 },
        reverse: { ...counts(), pdus: 0 },
      };
      groups.set(key, group);
    }
    count(reverse ? group.reverse : group.forward, fact);
    byFrame.set(fact.frame.number, { group, reverse });
  }
  return { groups: [...groups.values()], byFrame };
}

function projectRow(
  pdu: NativeAutomotivePdu,
  frame: AutomotiveFrame,
  scanned: AutomotiveFrame[],
  ref: string,
  links: ReturnType<typeof someipTpLinks>,
) {
  const { tcpFrames, contributors, linkedCompletion, observationContext } = pduReassemblyEvidence(
    pdu,
    scanned,
    links,
  );
  const required = new Set(linkedCompletion === null ? [pdu.frame] : [pdu.frame, linkedCompletion]);
  const frames = [...new Set([...required, ...contributors])].sort((a, b) => a - b);
  if (
    pdu.locator.basis === "capture_frame" &&
    !pdu.incomplete &&
    pdu.locator.offset + pdu.locator.bytes > frame.fact.capturedBytes
  )
    throw invalidOutput();
  const boundedFrames =
    frames.length > automotiveLimits.framesPerPdu
      ? [
          ...frames
            .filter((number) => !required.has(number))
            .slice(0, automotiveLimits.framesPerPdu - required.size),
          ...required,
        ].sort((a, b) => a - b)
      : frames;
  const kept = new Set(boundedFrames);
  return {
    frames: boundedFrames,
    pdu: {
      ref,
      occurrence: pdu.occurrence,
      locator: pdu.locator,
      fields: pdu.fields,
      payloadBytes: pdu.payloadBytes,
      entries: pdu.entries,
      omittedEntries: pdu.omittedEntries,
      incomplete: pdu.incomplete,
      reassembly: {
        tcp: tcpFrames.length ? "reassembled" : "none",
        someipTp: !pdu.tpFragment ? "none" : pdu.tpReassembled ? "reassembled" : "fragment",
        completedIn: pdu.completedIn,
        tcpFrames: tcpFrames.filter((number) => kept.has(number)),
        tpFrames: pdu.tpFrames.filter((number) => kept.has(number)),
        omittedFrames: frames.length - boundedFrames.length,
        observationContext,
      },
    },
  };
}

function decodedTcpBytes(tree: Map<number, NativeAutomotivePdu[]>, scanned: AutomotiveFrame[]) {
  // A decoded PDU does not account for any pending TCP bytes after its end.
  const totals = new Map<number, number>();
  for (const [frame, pdus] of tree) {
    const completion = scanned[frame - 1];
    if (completion?.transport !== "tcp") continue;
    const context = directionalObservation(completion);
    if (!context) continue;
    for (const pdu of pdus) {
      if (pdu.incomplete) continue;
      const segments = pdu.tcpSegments.length ? pdu.tcpSegments : [{ frame, bytes: pdu.locator.bytes }];
      for (const segment of segments) {
        if (directionalObservation(scanned[segment.frame - 1]) === context)
          totals.set(segment.frame, (totals.get(segment.frame) ?? 0) + segment.bytes);
      }
    }
  }
  return totals;
}

export async function analyzeAutomotive(
  args: AutomotiveArgs,
  capture: CaptureReference,
  analysis: CaptureAnalysis,
  native: OfflineTshark,
  snapshot: string,
  scanLimit: number,
  maxChars: number,
) {
  await native.validate(analysis, profileFields[args.automotiveProfile]).catch((error: unknown) => {
    if (error instanceof CaptureError && error.reason === "traffic_unavailable")
      throw new CaptureError(
        "automotive_unavailable",
        "The installed TShark lacks fields or preferences required by the selected Automotive Ethernet profile.",
      );
    throw error;
  });
  const selection = {
    profile: args.automotiveProfile,
    vlan: args.vlan ?? null,
    addresses: args.addresses ?? [],
    ports: args.ports ?? [],
    expectedPoints: args.expectedPoints ?? [],
  };
  const limit = args.limit ?? 12;
  const querySha256 = createHash("sha256")
    .update(JSON.stringify({ capture, analysis, selection, limit, scanLimit }))
    .digest("hex");
  if (args.automotiveCursor && args.automotiveCursor.querySha256 !== querySha256)
    throw new CaptureError(
      "cursor_mismatch",
      "This cursor belongs to a different capture or Automotive Ethernet query.",
    );

  const numbers = await native.numbers(snapshot, analysis, scanLimit + 1);
  const scanComplete = numbers.length <= scanLimit;
  const scannedThrough = Math.min(numbers.length, scanLimit);
  const protocol = selection.profile === "doip" ? "doip" : "someip";
  const mandatoryField = protocol === "doip" ? "doip.type" : "someip.messageid";
  const selectedFields = [...automotiveFrameFields, mandatoryField];
  if (selection.profile === "someip_sd") selectedFields.push("someipsd.flags");
  const facts = await readTrafficFacts(
    native,
    snapshot,
    analysis,
    scanLimit,
    selectedFields,
    capture.sha256,
  ).catch((error: unknown) => {
    if (error instanceof CaptureError && error.reason === "traffic_unavailable")
      throw new CaptureError(
        "automotive_unavailable",
        "The installed TShark lacks fields required by the selected Automotive Ethernet profile.",
      );
    throw error;
  });
  if (facts.length !== scannedThrough) throw invalidOutput();
  const scanned = facts.map(automotiveFrame);
  const candidates = chooseFrames(args, analysis, scanned);
  const tree = scannedThrough
    ? await readAutomotiveTree(native, snapshot, analysis, selection.profile, scannedThrough)
    : new Map<number, NativeAutomotivePdu[]>();
  const { groups, byFrame } = transportConversations(candidates);
  const tcpBytes = decodedTcpBytes(tree, scanned);
  const tpLinks = someipTpLinks(tree, scanned);
  const observations = observationCoverage(scanned, args.expectedPoints);
  let undecodedPayloadFrames = 0;
  let unfinishedTpFragments = 0;
  let incompletePdus = 0;
  let mixedReassemblyPdus = 0;
  let omittedEvidencePdus = 0;
  let observedTcpGaps = 0;
  let unresolvedTransportFrames = 0;
  let decodedFrames = 0;
  const issueFrames: Record<string, number> = {};
  const rows = candidates.flatMap((frame) => {
    const { fact } = frame;
    const number = fact.frame.number;
    if (fact.capturedBytes < fact.wireBytes) issueFrames.truncated ??= number;
    if (!frame.supportedEncapsulation) {
      issueFrames.unsupportedEncapsulation ??= number;
      return [];
    }
    const groupDirection = byFrame.get(number);
    if (!groupDirection) {
      if (frame.ipFragmented || !frame.vlanComplete || frame.stack.includes(protocol)) {
        unresolvedTransportFrames++;
        issueFrames.unresolvedTransport ??= number;
      }
      return [];
    }
    const nativePdus = (tree.get(number) ?? []).filter((pdu) => pdu.profile === selection.profile);
    if (fact.get("tcp.analysis.lost_segment").length) {
      observedTcpGaps++;
      issueFrames.tcpGap ??= number;
    }
    const coveredBytes = frame.transport === "tcp" ? (tcpBytes.get(number) ?? 0) : 0;
    if (coveredBytes > frame.payloadBytes) throw invalidOutput();
    if (frame.payloadBytes > coveredBytes && (frame.transport === "tcp" || !nativePdus.length)) {
      undecodedPayloadFrames++;
      issueFrames.undecodedPayload ??= number;
    }
    if (!nativePdus.length) return [];
    decodedFrames++;
    const { group, reverse } = groupDirection;
    const ref = captureCitation(capture, fact.frame, analysis);
    return nativePdus.map((pdu) => {
      if (pdu.tpFragment && pdu.completedIn === null) {
        unfinishedTpFragments++;
        issueFrames.unfinishedTp ??= number;
      }
      if (pdu.incomplete) {
        incompletePdus++;
        issueFrames.incompletePdu ??= number;
      }
      const row = projectRow(pdu, frame, scanned, ref, tpLinks);
      if (row.pdu.reassembly.observationContext !== "same") {
        mixedReassemblyPdus++;
        issueFrames.unverifiedReassemblyContext ??= number;
      }
      if (row.pdu.reassembly.omittedFrames || pdu.omittedEntries) {
        omittedEvidencePdus++;
        issueFrames.omittedEvidence ??= number;
      }
      (reverse ? group.reverse : group.forward).pdus++;
      return { ...row, conversation: group.id, direction: reverse ? "reverse" : "forward" };
    });
  });
  const truncatedFrames = scanned.filter(({ fact }) => fact.capturedBytes < fact.wireBytes).length;
  const unsupportedEncapsulationFrames = candidates.filter((frame) => !frame.supportedEncapsulation).length;
  const scopeCoverage = {
    ...observations,
    unsupportedEncapsulationFrames,
    truncatedFrames,
    undecodedPayloadFrames,
    unfinishedTpFragments,
    incompletePdus,
    unverifiedReassemblyContextPdus: mixedReassemblyPdus,
    omittedEvidencePdus,
    observedTcpGaps,
    unresolvedTransportFrames,
    decodedFrames,
    issueFrames,
  };
  const measurementIncomplete = !!(
    unsupportedEncapsulationFrames ||
    truncatedFrames ||
    undecodedPayloadFrames ||
    unfinishedTpFragments ||
    incompletePdus ||
    mixedReassemblyPdus ||
    omittedEvidencePdus ||
    observedTcpGaps ||
    unresolvedTransportFrames ||
    observations.missingObservationPointFrames ||
    observations.missingExpectedPoints.length ||
    observations.omittedObservationPoints ||
    observations.framesWithoutTimestamp ||
    observations.timestampBacksteps ||
    (observations.knownDrops && observations.knownDrops !== "0")
  );
  const offset = args.automotiveCursor?.offset ?? 0;
  if (args.automotiveCursor && offset >= rows.length)
    throw new CaptureError(
      "cursor_mismatch",
      "The cursor is outside the Automotive Ethernet evidence range.",
    );
  const pageRows = rows.slice(offset, offset + limit);
  const samples = Object.values(issueFrames);
  while (true) {
    const ids = new Set(pageRows.map((row) => row.conversation));
    for (const number of samples) {
      const group = byFrame.get(number)?.group;
      if (group) ids.add(group.id);
    }
    const evidence = [...new Set([...samples, ...pageRows.flatMap((row) => row.frames)])]
      .sort((a, b) => a - b)
      .map((number) => {
        const frame = scanned[number - 1];
        if (!frame) throw invalidOutput();
        const { fact, encapsulation, vlans, direction } = frame;
        return {
          section: fact.section,
          frame: fact.frame,
          ref: captureCitation(capture, fact.frame, analysis),
          conversation: byFrame.get(number)?.group.id ?? null,
          encapsulation,
          vlans,
          direction,
          wireBytes: fact.wireBytes,
          capturedBytes: fact.capturedBytes,
        };
      });
    const nextOffset = offset + pageRows.length;
    const next = nextOffset < rows.length ? { querySha256, offset: nextOffset } : null;
    const coverage: CaptureCoverage = {
      scope: "capture",
      scannedThrough,
      scanLimit,
      scanComplete,
      matchedInScope: candidates.length,
      returned: pageRows.length,
      partial: !scanComplete || measurementIncomplete || offset > 0 || next !== null,
      truncated:
        truncatedFrames > 0 ||
        omittedEvidencePdus > 0 ||
        pageRows.length < Math.min(limit, rows.length - offset),
    };
    const result = {
      capture,
      analysis,
      coverage,
      automotive: {
        selection,
        scopeCoverage,
        status: rows.length
          ? "decoded"
          : unsupportedEncapsulationFrames && unsupportedEncapsulationFrames === candidates.length
            ? "unsupported_encapsulation"
            : measurementIncomplete
              ? "incomplete"
              : "not_observed",
        conversations: groups.filter(({ id }) => ids.has(id)),
        rows: pageRows,
        evidence,
        page: { querySha256, offset, limit, totalRows: rows.length, next },
      },
    };
    if (JSON.stringify(result).length <= maxChars) return result;
    if (pageRows.length <= 1)
      throw new CaptureError(
        "result_limit",
        "Automotive Ethernet evidence exceeds the result budget. Narrow the selection.",
      );
    pageRows.pop();
  }
}
