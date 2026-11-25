import type { CaptureAnalysis, CaptureReference } from "@vera/shared";
import { expect, it, vi } from "vitest";
import type { ProgramRunner } from "../plugins/runner.js";
import { analyzeAutomotive } from "./automotive.js";
import { parseAutomotiveTree, readAutomotiveTree } from "./automotive-native.js";
import { OfflineTshark } from "./native.js";

const capture: CaptureReference = {
  format: 1,
  source: { kind: "workbench", path: "saved.pcap" },
  fileFormat: "pcap",
  bytes: 24,
  sha256: "0".repeat(64),
};
const analysis: CaptureAnalysis = {
  tool: "tshark",
  version: "4.6.10",
  profile: "vera-offline-v1",
  automotiveProfile: "doip",
  decodeAs: [],
  filter: null,
  trafficPreferences: {
    tcpSequenceAnalysis: true,
    tcpDesegmentation: true,
    tcpReassembleOutOfOrder: false,
    httpDesegmentation: true,
    dnsDesegmentation: true,
    validateChecksums: false,
  },
};

it("rejects unavailable Automotive Ethernet fields and bounded native output without evidence", async () => {
  const captureOutput = vi
    .fn<ProgramRunner["captureOutput"]>()
    .mockResolvedValueOnce({
      exit: { code: 1, signal: null },
      stdout: "",
      stderr: "Some fields aren't valid: private",
      exceeded: false,
    })
    .mockResolvedValueOnce({
      exit: { code: 0, signal: null },
      stdout: "private",
      stderr: "",
      exceeded: true,
    });
  const native = new OfflineTshark(
    { captureOutput } as unknown as ProgramRunner,
    "tshark",
    ".",
    new AbortController().signal,
  );
  await expect(
    analyzeAutomotive(
      { operation: "automotive", automotiveProfile: "doip", source: { reference: capture } },
      capture,
      analysis,
      native,
      "saved.pcap",
      1,
      10_000,
    ),
  ).rejects.toMatchObject({
    reason: "automotive_unavailable",
    message: expect.not.stringContaining("private"),
  });
  await expect(readAutomotiveTree(native, "saved.pcap", analysis, "doip", 1)).rejects.toMatchObject({
    reason: "native_output_limit",
    message: expect.not.stringContaining("private"),
  });
});

it.each([
  '<!DOCTYPE pdml [<!ENTITY example "text">]><pdml/>',
  "<pdml><packet></pdml>",
  '<pdml><packet><proto name="geninfo"><field name="num" show="2"/></proto></packet></pdml>',
])("rejects malformed, unexpected or out-of-prefix Automotive Ethernet trees", (xml) => {
  expect(() => parseAutomotiveTree(xml, "doip", 1)).toThrow(
    expect.objectContaining({ reason: "native_output_invalid" }),
  );
});
