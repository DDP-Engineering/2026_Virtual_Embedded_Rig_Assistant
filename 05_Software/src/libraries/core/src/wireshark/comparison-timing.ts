import type { CaptureComparisonResult } from "@vera/shared";
import { timingFields } from "./diagnostics.js";
import { dnsRelationship } from "./network-projection.js";
import type { networkReassembly } from "./network-reassembly.js";
import { nativeTime, nativeUint, protocolStack, type TrafficFact } from "./traffic-native.js";

type Observation = NonNullable<CaptureComparisonResult["comparison"]["rows"][number]["baseline"]>;
type Sample = { elapsed: bigint; request: TrafficFact; response: TrafficFact };
export type ComparisonMember = { fact: TrafficFact; direction: 0 | 1 };
export type ComparisonCitation = (fact: TrafficFact) => Observation["frames"][number];
export const comparisonTimingProtocols = ["dns", "http"] as const;
export const milliseconds = (picoseconds: bigint) => Number(picoseconds) / 1e9;

function timingSummary(samples: Sample[], unpaired: number, cite: ComparisonCitation): Observation["dns"] {
  const sorted = samples.sort((a, b) => (a.elapsed < b.elapsed ? -1 : a.elapsed > b.elapsed ? 1 : 0));
  const low = sorted[0];
  const high = sorted.at(-1);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const median = sorted[Math.floor(sorted.length / 2)];
  const lowerMedian = sorted[Math.floor((sorted.length - 1) / 2)];
  if (!low || !high || !p95 || !median || !lowerMedian) {
    return unpaired
      ? { samples: 0, unpaired, minMs: null, medianMs: null, p95Ms: null, maxMs: null, frames: [] }
      : null;
  }
  return {
    samples: sorted.length,
    unpaired,
    minMs: milliseconds(low.elapsed),
    medianMs: milliseconds(median.elapsed + lowerMedian.elapsed) / 2,
    p95Ms: milliseconds(p95.elapsed),
    maxMs: milliseconds(high.elapsed),
    frames: [...new Set([low, lowerMedian, median, p95, high])].flatMap(({ request, response }) => [
      cite(request),
      cite(response),
    ]),
  };
}

/** Use only corroborated request/response pairs inside one normalized stream and window. */
export function observeTiming(
  members: ComparisonMember[],
  scanned: TrafficFact[],
  scoped: Set<number>,
  reassembly: ReturnType<typeof networkReassembly>["byFrame"],
  protocol: (typeof comparisonTimingProtocols)[number],
  cite: ComparisonCitation,
) {
  const fields = timingFields(protocol);
  const byFrame = new Map(members.map((member) => [member.fact.frame.number, member]));
  const requests = new Set<number>();
  const paired = new Set<number>();
  const samples: Sample[] = [];
  let unpaired = 0;
  for (const { fact, direction } of members) {
    const number = fact.frame.number;
    if (!protocolStack(fact).includes(protocol)) continue;
    const flags = fact.get(fields.request);
    const isRequest = protocol === "dns" ? flags.some((item) => /^(0|false)$/i.test(item)) : flags.length > 0;
    const present = fact.get(fields.present);
    const isResponse =
      protocol === "dns" ? flags.some((item) => /^(1|true)$/i.test(item)) : present.length > 0;
    if (isRequest) requests.add(number);
    if (!isResponse) continue;
    const links = fact.get(fields.response);
    const [elapsed, ...otherDurations] = fact.get(fields.duration);
    const requestNumber = links.length === 1 ? nativeUint(links[0]) : 0;
    const request = byFrame.get(requestNumber);
    const requestTime = request?.fact.relative;
    const duration = elapsed && !otherDurations.length ? nativeTime(elapsed) : null;
    const dns = protocol === "dns" ? dnsRelationship(fact, scanned, scoped) : null;
    const requestFlags = request?.fact.get(fields.request) ?? [];
    const requestContext = reassembly.get(requestNumber)?.status;
    const replyContext = reassembly.get(number)?.status;
    if (
      !request ||
      !requests.has(requestNumber) ||
      requestNumber >= number ||
      paired.has(requestNumber) ||
      request.direction === direction ||
      isRequest ||
      flags.length > 1 ||
      present.length > 1 ||
      requestFlags.length !== 1 ||
      requestContext?.pendingOrInvalid ||
      requestContext?.outsideScopeFrames ||
      replyContext?.pendingOrInvalid ||
      replyContext?.outsideScopeFrames ||
      (dns && (dns.status !== "native_link" || !dns.counterpartInScope)) ||
      requestTime == null ||
      fact.relative === null ||
      duration === null ||
      duration < 0n ||
      fact.relative - requestTime !== duration
    ) {
      unpaired++;
      continue;
    }
    paired.add(requestNumber);
    samples.push({ elapsed: duration, request: request.fact, response: fact });
  }
  return timingSummary(samples, unpaired + requests.size - paired.size, cite);
}
