import { describe, expect, it } from "vitest";
import { evidenceLabel, extractCitations, formatEvidenceRef, parseEvidenceRef, splitCitations } from "./evidence.ts";

describe("parseEvidenceRef", () => {
  it.each([
    ["ev:RUN-0042/pcap/capture-lan/1532", { kind: "pcap", testRunId: "RUN-0042", capture: "capture-lan", frame: 1532 }],
    ["ev:RUN-0042/log/dut-syslog/218", { kind: "log", testRunId: "RUN-0042", source: "dut-syslog", line: 218 }],
    ["ev:RUN-0042/metric/mem_free_kb/1765432100", { kind: "metric", testRunId: "RUN-0042", name: "mem_free_kb", ts: 1765432100 }],
    ["ev:RUN-0042/check/lease_time", { kind: "check", testRunId: "RUN-0042", checkId: "lease_time" }],
    ["ev:TB-01/doc/docs/lab-notes.md#sw-01", { kind: "doc", testbenchId: "TB-01", path: "docs/lab-notes.md", anchor: "sw-01" }],
    ["ev:TB-01/doc/docs/firmware/2.1.0.md", { kind: "doc", testbenchId: "TB-01", path: "docs/firmware/2.1.0.md", anchor: null }],
  ])("parses and round-trips %s", (ref, expected) => {
    const parsed = parseEvidenceRef(ref);
    expect(parsed).toMatchObject({ ...expected, ref });
    expect(formatEvidenceRef(parsed!)).toBe(ref);
  });

  it.each([
    "RUN-0042/pcap/capture-lan/1532", // no prefix
    "ev:RUN-42/pcap/capture-lan/1532", // short run id
    "ev:RUN-0042/pcap/capture-lan/abc", // non-numeric frame
    "ev:RUN-0042/pcap/capture-lan", // missing frame
    "ev:RUN-0042/pcap/capture-lan/1/2", // extra segment
    "ev:RUN-0042/check/lease_time/1", // extra segment
    "ev:RUN-0042/video/cam/1", // unknown kind
    "ev:TB-01/doc/../secrets.md", // path traversal
    "ev:RUN-0042/doc/docs/a.md", // doc owner must be a testbench
    "ev:TB-01/log/dut-syslog/1", // log owner must be a run
    "ev:TB-01/doc/docs/a.md#bad anchor",
  ])("rejects %s", (ref) => {
    expect(parseEvidenceRef(ref)).toBeNull();
  });
});

describe("evidenceLabel", () => {
  it("builds compact chip labels", () => {
    expect(evidenceLabel("ev:RUN-0041/pcap/capture-wan/4127")).toBe("capture-wan #4127");
    expect(evidenceLabel("ev:RUN-0043/log/dut-syslog/1532")).toBe("dut-syslog L1532");
    expect(evidenceLabel("ev:RUN-0044/check/lease_time")).toBe("check lease_time");
    expect(evidenceLabel("ev:TB-01/doc/docs/lab-notes.md#2026-09-29")).toBe("lab-notes.md#2026-09-29");
    expect(evidenceLabel("ev:RUN-0043/metric/mem_free_kb/1791442332")).toBe("mem_free_kb @ 06:52");
  });

  it("falls back to the raw ref for malformed input", () => {
    expect(evidenceLabel("ev:nope")).toBe("nope");
  });
});

describe("citations", () => {
  const text = "Link down [[ev:RUN-0041/log/switch-syslog/57]] and OOM [[ev:RUN-0043/log/dut-syslog/1532]]; again [[ev:RUN-0041/log/switch-syslog/57]].";

  it("splits text and refs in order", () => {
    expect(splitCitations(text)).toEqual([
      { type: "text", text: "Link down " },
      { type: "ev", ref: "ev:RUN-0041/log/switch-syslog/57" },
      { type: "text", text: " and OOM " },
      { type: "ev", ref: "ev:RUN-0043/log/dut-syslog/1532" },
      { type: "text", text: "; again " },
      { type: "ev", ref: "ev:RUN-0041/log/switch-syslog/57" },
      { type: "text", text: "." },
    ]);
  });

  it("extracts unique refs", () => {
    expect(extractCitations(text)).toEqual(["ev:RUN-0041/log/switch-syslog/57", "ev:RUN-0043/log/dut-syslog/1532"]);
  });

  it("leaves ordinary brackets alone", () => {
    expect(splitCitations("see [docs] and [[not-ev]]")).toEqual([{ type: "text", text: "see [docs] and [[not-ev]]" }]);
  });
});
