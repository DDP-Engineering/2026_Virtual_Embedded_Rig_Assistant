import type { NativeAutomotivePdu } from "./automotive-native.js";
import { type AutomotiveFrame, capturePoint, directionalObservation } from "./automotive-scope.js";
import { invalidOutput } from "./native.js";

type ObservationContext = "same" | "unknown" | "mixed";

function observationContext(
  frame: number,
  contributors: number[],
  scanned: AutomotiveFrame[],
): ObservationContext {
  const anchor = scanned[frame - 1];
  if (!anchor) throw invalidOutput();
  const context = directionalObservation(anchor);
  let state: ObservationContext = "same";
  for (const number of contributors) {
    if (number === frame) continue;
    const contributor = scanned[number - 1];
    if (!contributor) throw invalidOutput();
    if (!context || directionalObservation(contributor) !== context) return "mixed";
    if (!capturePoint(anchor.fact)) state = "unknown";
  }
  return state;
}

function mergeContext(a: ObservationContext, b: ObservationContext): ObservationContext {
  if (a === "mixed" || b === "mixed") return "mixed";
  return a === "unknown" || b === "unknown" ? "unknown" : "same";
}

function tpLinkKey(pdu: NativeAutomotivePdu, completion: number, source: number) {
  const ids = [
    "someip.messageid",
    "someip.clientid",
    "someip.sessionid",
    "someip.messagetype",
    "someip.protoversion",
    "someip.interfaceversion",
  ].map((name) => pdu.fields[name]);
  return ids.includes(undefined) ? undefined : JSON.stringify([completion, source, ...ids]);
}

export function someipTpLinks(tree: Map<number, NativeAutomotivePdu[]>, scanned: AutomotiveFrame[]) {
  const links = new Map<string, ObservationContext>();
  for (const pdus of tree.values()) {
    for (const pdu of pdus) {
      if (!pdu.tpReassembled) continue;
      const contributors = [...pdu.tcpSegments.map(({ frame }) => frame), ...pdu.tpFrames];
      const context = observationContext(pdu.frame, contributors, scanned);
      for (const source of pdu.tpFrames) {
        const key = tpLinkKey(pdu, pdu.frame, source);
        if (key) links.set(key, mergeContext(context, links.get(key) ?? "same"));
      }
    }
  }
  return links;
}

export function pduReassemblyEvidence(
  pdu: NativeAutomotivePdu,
  scanned: AutomotiveFrame[],
  links: ReturnType<typeof someipTpLinks>,
) {
  const tcpFrames = [...new Set(pdu.tcpSegments.map(({ frame }) => frame))].sort((a, b) => a - b);
  const contributors = [...tcpFrames, ...pdu.tpFrames];
  const ownContext = observationContext(pdu.frame, contributors, scanned);
  const forward = pdu.tpFragment && !pdu.tpReassembled ? pdu.completedIn : null;
  const key = forward === null ? undefined : tpLinkKey(pdu, forward, pdu.frame);
  const linked = key ? links.get(key) : undefined;
  return {
    tcpFrames,
    contributors,
    linkedCompletion: linked === undefined ? null : forward,
    observationContext: forward === null ? ownContext : mergeContext(ownContext, linked ?? "unknown"),
  };
}
