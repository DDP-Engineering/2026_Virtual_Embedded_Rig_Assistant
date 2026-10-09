// Earlier sessions in the list, built by replaying SSE events through the shared reducer.
import { appendUserMessage, applySessionEvent, emptySessionState, type SessionEvent, type SessionState } from "@benchpilot/shared";
import type { MockDb, StoredSession } from "./store";

function build(id: string, title: string, createdAt: string, prompt: string, events: SessionEvent[], lastReportId: string | null = null): StoredSession {
  let state: SessionState = appendUserMessage(emptySessionState(), `${id}-u1`, prompt);
  state = events.reduce(applySessionEvent, state);
  return {
    summary: { id, testbenchId: "TB-01", title, provider: "anthropic", model: "claude-sonnet-5-5", createdAt, updatedAt: createdAt, lastReportId, status: "idle" },
    state,
  };
}

/** `summary` ends with the duration, e.g. `3 reports · 22 ms`. */
const tool = (callId: string, name: string, args: Record<string, unknown>, summary: string, preview?: string): SessionEvent[] => {
  const durationMs = Number(/(\d+) ms$/.exec(summary)?.[1] ?? 0);
  return [
    { type: "tool.started", callId, name, args },
    { type: "tool.done", callId, ok: true, summary: summary.replace(/ · \d+ ms$/, ""), durationMs, preview },
  ];
};

const say = (messageId: string, text: string, citations: { ref: string; valid: boolean }[]): SessionEvent[] => [
  { type: "message.delta", messageId, text },
  { type: "message.done", messageId, citations },
];

export function seedSessions(db: MockDb): StoredSession[] {
  const valid = (ref: string) => ({ ref, valid: db.resolveEvidence(ref) !== null });

  const baseline = build("S-0003", "Baseline check · fw 2.0.4", "2026-10-06T08:12:00Z", "Summarize the latest 2.0.4 nightly results.", [
    { type: "turn.started", turnId: "S3-T1" },
    ...tool("S3-C1", "list_reports", { fw: "2.0.4", kind: "history", limit: 3 }, "3 reports · 22 ms", "RPT-0008 · Oct 5 · 5/5 pass\nRPT-0007 · Oct 4 · 4/5 pass (TC-DNS-005)\nRPT-0006 · Oct 3 · 5/5 pass"),
    ...tool("S3-C2", "get_report", { report_id: "RPT-0008" }, "5 runs · 31 ms", "TC-DHCP-001 pass · TC-IPV6-002 pass · TC-PERF-003 pass · TC-DNS-005 pass · TC-END-004 pass"),
    ...say(
      "S3-M1",
      "RPT-0008 (nightly, Oct 5, fw 2.0.4): **5 of 5 passed.**\n\n| Test | Verdict | Measured |\n|---|---|---|\n| TC-DHCP-001 | PASS | 1.39 s |\n| TC-PERF-003 | PASS | 933.0 Mbps |\n| TC-DNS-005 | PASS | p95 46.0 ms |\n| TC-END-004 | PASS | no crash, memory flat |\n\nTC-DNS-005 passed this time [[ev:RUN-0039/check/p95]], but it failed on Oct 4 (RPT-0007). Ask me to look into it if that pattern matters for the release.",
      [valid("ev:RUN-0039/check/p95")],
    ),
    { type: "turn.done", turnId: "S3-T1", stopReason: "end" },
  ], "RPT-0008");

  const dnsFlap = build("S-0002", "Why does DNS latency flap?", "2026-10-05T14:40:00Z", "Why does TC-DNS-005 keep flipping between pass and fail?", [
    { type: "turn.started", turnId: "S2-T1" },
    ...tool("S2-C1", "get_test_history", { test_id: "TC-DNS-005", limit: 8 }, "8 runs · 3 fail · 37 ms", "p95 ms: 45 47 54 44 56 48 52 46 · fw 2.0.4 throughout · flips: 6"),
    ...say(
      "S2-M1",
      "TC-DNS-005 failed 3 of the last 8 nightly runs on unchanged firmware 2.0.4, with 6 verdict flips. By the test policy that makes it **flaky**. The DUT logs show no resolver restarts [[ev:RUN-0039/log/dut-syslog/9999]].\n\nI have not checked the captures yet, so the cause is unverified. A good next step is to split cache hits from upstream lookups in one of the failing runs.",
      [{ ref: "ev:RUN-0039/log/dut-syslog/9999", valid: false }],
    ),
    { type: "turn.done", turnId: "S2-T1", stopReason: "end" },
  ]);

  const labNotes = build("S-0001", "Lab notes cleanup", "2026-10-02T09:05:00Z", "Which lab-notes entries still matter for TB-01 test results?", [
    { type: "turn.started", turnId: "S1-T1" },
    ...tool("S1-C1", "read_testbench_doc", { path: "docs/lab-notes.md" }, "6 entries · 14 ms"),
    ...say(
      "S1-M1",
      "Only one entry is still relevant to results: SW-01 Gi1/0/7, the SRV-01 uplink, has CRC errors and link flaps, and ticket LAB-311 is still open [[ev:TB-01/doc/docs/lab-notes.md#2026-09-29]]. A flap on that port drops throughput tests to zero for a few seconds. The other entries are routine maintenance.",
      [valid("ev:TB-01/doc/docs/lab-notes.md#2026-09-29")],
    ),
    { type: "turn.done", turnId: "S1-T1", stopReason: "end" },
  ]);

  return [baseline, dnsFlap, labNotes];
}
