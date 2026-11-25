import { expect, it } from "vitest";
import { mediaRtp } from "./media-rtp.js";
import type { TrafficFact } from "./traffic-native.js";

function observedRtp(
  number: number,
  sequence: number,
  options: {
    interfaceId?: number;
    timestampEpoch?: string | null;
    stack?: string[];
    setupFrame?: number;
  } = {},
) {
  const fields: Record<string, string> = {
    "ip.src": "192.0.2.1",
    "ip.dst": "192.0.2.2",
    "ip.flags.mf": "False",
    "ip.frag_offset": "0",
    "udp.srcport": "40000",
    "udp.dstport": "5004",
    "udp.stream": "0",
    "rtp.ssrc": "0xf",
    "rtp.seq": String(sequence),
    "rtp.timestamp": String(sequence * 160),
    "rtp.p_type": "0",
  };
  if (options.setupFrame !== undefined) fields["rtp.setup-frame"] = String(options.setupFrame);
  const fact: TrafficFact = {
    frame: {
      captureSha256: "0".repeat(64),
      number,
      interfaceId: options.interfaceId ?? 0,
      timestampEpoch: options.timestampEpoch === undefined ? String(number) : options.timestampEpoch,
    },
    section: 1,
    relative: null,
    wireBytes: 92,
    capturedBytes: 92,
    get: (field) => (fields[field] === undefined ? [] : [fields[field]]),
  };
  return { fact, stack: options.stack ?? ["eth", "ip", "udp", "rtp"] };
}

it("separates observations by interface and bounds representative RTP streams", () => {
  const frames = [
    observedRtp(1, 12),
    observedRtp(2, 12, { interfaceId: 1 }),
    observedRtp(3, 14),
    observedRtp(4, 13, { interfaceId: 1 }),
  ];
  expect(mediaRtp(frames, true, 1)).toMatchObject({
    scope: "whole_capture",
    unresolvedFrames: 0,
    streamsOmitted: 1,
    streams: [{ frame: 1, packets: 2, missingSequenceNumbers: 1 }],
  });
});

it("withholds RTP metrics for an ambiguous unscoped observation", () => {
  const frames = [
    observedRtp(1, 12),
    observedRtp(2, 13),
    observedRtp(3, 55, { stack: ["eth", "ip", "udp", "vxlan", "eth", "ip", "udp", "rtp"] }),
  ];
  expect(mediaRtp(frames, true, 6)).toMatchObject({
    scope: "partial_observation",
    unresolvedFrames: 1,
    streams: [
      {
        frame: 1,
        packets: 2,
        missingSequenceNumbers: null,
        maxDeltaMs: null,
        jitterMs: null,
        limitations: ["scope_limited"],
      },
    ],
  });
});

it("keeps packet counts when sequence or arrival inputs cannot support a metric", () => {
  const frames = [observedRtp(1, 12), observedRtp(2, 4000, { timestampEpoch: null })];
  expect(mediaRtp(frames, true, 6, true).streams).toMatchObject([
    {
      frame: 1,
      packets: 2,
      missingSequenceNumbers: null,
      maxDeltaMs: null,
      jitterMs: null,
      limitations: ["sequence_discontinuity", "arrival_time_unavailable"],
    },
  ]);
});

it("withholds the default RTP clock when the native setup points to other evidence", () => {
  const frames = [observedRtp(2, 12, { setupFrame: 1 }), observedRtp(3, 13, { setupFrame: 1 })];
  expect(mediaRtp(frames, true, 6, true).streams).toMatchObject([
    {
      frame: 2,
      packets: 2,
      missingSequenceNumbers: 0,
      maxDeltaMs: 1000,
      jitterMs: null,
      jitterClock: null,
      limitations: ["clock_rate_unavailable"],
    },
  ]);
});
