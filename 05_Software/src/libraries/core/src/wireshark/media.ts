import {
  type CaptureAnalysis,
  type CaptureMediaResult,
  type CaptureReference,
  captureMediaResultSchema,
  mediaFields,
  mediaFieldValues,
  mediaProfileSchema,
  mediaProtocols,
  mediaResultLimit,
  mediaStreamLimit,
  type WiresharkCaptureArgs,
} from "@vera/shared";
import { captureCitation } from "./citations.js";
import { mediaRtp, rtpFields } from "./media-rtp.js";
import { CaptureError, invalidOutput, type OfflineTshark } from "./native.js";
import { requireSecretsFreeCapture } from "./network-capture.js";
import { protocolStack, readTrafficFacts, readTrafficMatches, type TrafficFact } from "./traffic-native.js";

type Args = Extract<WiresharkCaptureArgs, { operation: "media" }>;
type Projection = CaptureMediaResult["media"];
type Protocol = Projection["rows"][number]["protocols"][number];
const families = {
  wifi: ["wlan"],
  ble: ["btle", "bthci_evt", "btatt"],
  usb: ["usb"],
  voip: ["sip", "sdp", "rtp", "rtcp"],
} as const satisfies Record<Args["mediaProfile"], readonly Protocol[]>;

export const mediaCapabilities = {
  available: true,
  profiles: mediaProfileSchema.options,
  availability: "requires_native_dissectors",
  rtp: "native_signaling_or_explicit_udp_port",
  maxPackets: mediaResultLimit,
  maxStreams: mediaStreamLimit,
};

function finish(result: CaptureMediaResult, byFrame: Map<number, TrafficFact>, maxChars: number) {
  const { capture, analysis, coverage, media } = result;
  while (true) {
    const numbers = new Set([...media.rows, ...(media.rtp?.streams ?? [])].map(({ frame }) => frame));
    media.evidence = [...numbers]
      .sort((a, b) => a - b)
      .map((number) => {
        const fact = byFrame.get(number);
        if (!fact) throw invalidOutput();
        return {
          frame: fact.frame,
          section: fact.section,
          ref: captureCitation(capture, fact.frame, analysis),
        };
      });
    coverage.returned = media.rows.length;
    media.packetsOmitted = coverage.matchedInScope - coverage.returned;
    coverage.truncated ||= media.packetsOmitted > 0 || !!media.rtp?.streamsOmitted;
    coverage.partial ||= coverage.truncated;
    if (JSON.stringify(result).length <= maxChars) {
      const checked = captureMediaResultSchema.safeParse(result);
      if (!checked.success) throw invalidOutput();
      return checked.data;
    }
    if (media.rows.length > 1) {
      media.rows.pop();
    } else if (media.rtp?.streams.length) {
      media.rtp.streams.pop();
      media.rtp.streamsOmitted++;
    } else {
      throw new CaptureError(
        "result_limit",
        "The media result exceeds the host limit. Request a smaller scope.",
      );
    }
  }
}

/** Project only fixed dissector metadata from the verified capture and bounded scan. */
export async function analyzeMedia(
  args: Args,
  capture: CaptureReference,
  analysis: CaptureAnalysis,
  native: OfflineTshark,
  snapshot: string,
  scanLimit: number,
  maxChars: number,
  signal: AbortSignal,
) {
  await requireSecretsFreeCapture(snapshot, capture, signal, undefined, "media");
  const fields = mediaFields[args.mediaProfile];
  const names = ["frame.protocols", ...fields, ...(args.mediaProfile === "voip" ? rtpFields : [])];
  await native.validate(analysis, names);
  const facts = await readTrafficFacts(native, snapshot, analysis, scanLimit + 1, names, capture.sha256);
  const scanComplete = facts.length <= scanLimit;
  if (!scanComplete) facts.pop();
  const selected = analysis.filter
    ? await readTrafficMatches(native, snapshot, analysis, scanLimit, analysis.filter)
    : undefined;
  const byFrame = new Map<number, TrafficFact>();
  const rtpFacts: Parameters<typeof mediaRtp>[0] = [];
  const observedProtocols: Projection["observedProtocols"] = {};
  const rows: Projection["rows"] = [];
  const protocols: readonly Protocol[] = families[args.mediaProfile];
  let truncatedFrames = 0;
  let fieldValuesLimitedFrames = 0;
  for (const fact of facts) {
    if (selected && !selected.has(fact.frame.number)) continue;
    const truncated = fact.capturedBytes < fact.wireBytes;
    if (truncated) truncatedFrames++;
    const stack = protocolStack(fact);
    const found = mediaProtocols.options.filter(
      (protocol) =>
        protocols.includes(protocol) &&
        stack.includes(protocol) &&
        (protocol !== "bthci_evt" || fact.get("bthci_evt.le_meta_subevent").length > 0),
    );
    if (!found.length) continue;
    byFrame.set(fact.frame.number, fact);
    if (args.mediaProfile === "voip") rtpFacts.push({ fact, stack });
    for (const protocol of found) observedProtocols[protocol] = (observedProtocols[protocol] ?? 0) + 1;
    const fieldValuesLimited = fields.some((field) => fact.get(field).length > mediaFieldValues);
    if (fieldValuesLimited) fieldValuesLimitedFrames++;
    if (rows.length < (args.limit ?? 8)) {
      const projected = Object.fromEntries(
        fields.flatMap((field) => {
          const values = fact.get(field).slice(0, mediaFieldValues);
          return values.length ? [[field, values]] : [];
        }),
      );
      rows.push({
        frame: fact.frame.number,
        protocols: found,
        fields: projected,
        truncated,
        fieldValuesLimited,
      });
    }
  }
  const matched = byFrame.size;
  const rtp =
    args.mediaProfile === "voip"
      ? mediaRtp(
          rtpFacts,
          scanComplete && !analysis.filter && truncatedFrames === 0,
          mediaStreamLimit,
          args.rtpPort !== undefined,
        )
      : null;
  const truncated = truncatedFrames > 0 || fieldValuesLimitedFrames > 0;
  return finish(
    {
      capture,
      analysis,
      coverage: {
        scope: analysis.filter ? "display_filter" : "capture",
        scannedThrough: facts.length,
        scanLimit,
        scanComplete,
        matchedInScope: matched,
        returned: rows.length,
        partial: !scanComplete || truncated || !!rtp?.unresolvedFrames,
        truncated,
      },
      media: {
        profile: args.mediaProfile,
        observedProtocols,
        rows,
        rtp,
        evidence: [],
        packetsOmitted: matched - rows.length,
        truncatedFrames,
        fieldValuesLimitedFrames,
      },
      packetData: "untrusted_capture_data",
    },
    byFrame,
    maxChars,
  );
}
