import type { CaptureAnalysis } from "@vera/shared";
import { expect, it, vi } from "vitest";
import type { ProgramRunner } from "../plugins/runner.js";
import { OfflineTshark } from "./native.js";
import { streams } from "./streams.js";
import { readNativeFollow, readTrafficFacts, type TrafficFact } from "./traffic-native.js";

const analysis: CaptureAnalysis = {
  tool: "tshark",
  version: "4.6.10",
  profile: "vera-offline-v1",
  decodeAs: [],
  filter: null,
};

it("reports unsupported native traffic features and output bounds without returning subprocess text", async () => {
  const run = vi
    .fn<ProgramRunner["captureOutput"]>()
    .mockResolvedValueOnce({
      exit: { code: 1, signal: null },
      stdout: "",
      stderr: "Some fields aren't valid: private text",
      exceeded: false,
    })
    .mockResolvedValueOnce({
      exit: { code: 0, signal: null },
      stdout: "private text",
      stderr: "",
      exceeded: true,
    })
    .mockResolvedValueOnce({
      exit: { code: 0, signal: null },
      stdout: "private text",
      stderr: "",
      exceeded: false,
    });
  const runner = { captureOutput: run } as unknown as ProgramRunner;
  const native = new OfflineTshark(runner, "tshark", ".", new AbortController().signal);
  await expect(
    readTrafficFacts(native, "saved.pcap", analysis, 1, ["tcp.checksum.partial"], "0".repeat(64)),
  ).rejects.toMatchObject({
    reason: "traffic_unavailable",
    message: expect.not.stringContaining("private text"),
  });
  await expect(readNativeFollow(native, "saved.pcap", analysis, 1, "tcp", 0)).rejects.toMatchObject({
    reason: "native_output_limit",
    message: expect.not.stringContaining("private text"),
  });
  await expect(readNativeFollow(native, "saved.pcap", analysis, 1, "tcp", 0)).rejects.toMatchObject({
    reason: "native_output_invalid",
    message: expect.not.stringContaining("private text"),
  });
});

it.each(["0.000000000", null])(
  "reports a TCP gap marker at source timestamp %s as ambiguous",
  (timestampEpoch) => {
    const a = { address: "192.0.2.1", port: 40100 };
    const b = { address: "192.0.2.2", port: 49000 };
    const fields = new Map([
      ["ip.src", [a.address]],
      ["ip.dst", [b.address]],
      ["tcp.srcport", [String(a.port)]],
      ["tcp.dstport", [String(b.port)]],
      ["tcp.flags", ["0x0018"]],
    ]);
    const fact: TrafficFact = {
      frame: { captureSha256: "0".repeat(64), number: 1, interfaceId: 0, timestampEpoch },
      section: 1,
      relative: timestampEpoch === null ? null : 0n,
      wireBytes: 90,
      capturedBytes: 90,
      get: (field) => fields.get(field) ?? [],
    };
    expect(
      streams(
        [fact],
        [fact],
        {
          peers: [a, b],
          records: [{ frame: 1, peer: 0, kind: "gap", bytes: 5 }],
        },
        "tcp",
      ),
    ).toMatchObject({
      rows: [],
      summary: { nativeGapRecords: 0, unassociatedRecords: 1 },
      incomplete: true,
    });
  },
);
