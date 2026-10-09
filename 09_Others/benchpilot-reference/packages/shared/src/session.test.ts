import { describe, expect, it } from "vitest";
import type { PlanItem } from "./domain.ts";
import type { SessionEvent } from "./events.ts";
import { appendUserMessage, applySessionEvent, emptySessionState, sessionStatus, type SessionState } from "./session.ts";

const item: PlanItem = { testId: "TC-PERF-003", rationale: "baseline", name: "TCP throughput", version: 4, duration: { sim_s: 30, demo_s: 6 } };

function play(events: SessionEvent[], start: SessionState = emptySessionState()) {
  return events.reduce(applySessionEvent, start);
}

describe("applySessionEvent", () => {
  it("streams an assistant message and records citations", () => {
    const s = play([
      { type: "turn.started", turnId: "T1" },
      { type: "message.delta", messageId: "M1", text: "Link " },
      { type: "message.delta", messageId: "M1", text: "down [[ev:RUN-0041/log/switch-syslog/57]]" },
      { type: "message.done", messageId: "M1", citations: [{ ref: "ev:RUN-0041/log/switch-syslog/57", valid: true }] },
      { type: "turn.done", turnId: "T1", stopReason: "end" },
    ]);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ kind: "assistant", text: "Link down [[ev:RUN-0041/log/switch-syslog/57]]", streaming: false, turnId: "T1" });
    expect(s.activeTurnId).toBeNull();
    expect(sessionStatus(s)).toBe("idle");
  });

  it("walks plan → approval → run → report", () => {
    let s = appendUserMessage(emptySessionState(), "U1", "Run the performance tests for firmware 2.1.0.");
    s = play(
      [
        { type: "turn.started", turnId: "T1" },
        { type: "skill.loaded", name: "test-planner" },
        { type: "tool.started", callId: "C1", name: "propose_test_plan", args: {} },
        { type: "plan.proposed", planId: "PLAN-0004", items: [item], rationale: "r", fw: "2.1.0", device: "RTR-AX3000" },
      ],
      s,
    );
    expect(sessionStatus(s)).toBe("awaiting_approval");
    expect(s.loadedSkills).toEqual(["test-planner"]);

    s = play(
      [
        { type: "plan.decided", planId: "PLAN-0004", decision: "approve" },
        { type: "tool.done", callId: "C1", ok: true, summary: "approved", durationMs: 4000 },
        { type: "tool.started", callId: "C2", name: "run_test_plan", args: { plan_id: "PLAN-0004" } },
        { type: "run.started", reportId: "RPT-0009", planId: "PLAN-0004", tests: [{ testRunId: "RUN-0041", testId: "TC-PERF-003", simDurationS: 30 }] },
        { type: "run.progress", testRunId: "RUN-0041", pct: 50, simTime: 15 },
        { type: "run.metric", testRunId: "RUN-0041", name: "throughput_mbps", ts: 100, value: 930 },
        { type: "run.event", testRunId: "RUN-0041", source: "switch-syslog", ts: 114, severity: "error", message: "Gi1/0/7 down", ev: "ev:RUN-0041/log/switch-syslog/57" },
        { type: "run.verdict", testRunId: "RUN-0041", testId: "TC-PERF-003", verdict: "fail" },
        { type: "run.completed", reportId: "RPT-0009", summary: { total: 1, passed: 0, failed: 1, errored: 0, simDurationS: 30 } },
      ],
      s,
    );
    expect(sessionStatus(s)).toBe("running");
    const plan = s.items.find((i) => i.kind === "plan");
    expect(plan).toMatchObject({ plan: { status: "approved", approvedItems: [item] } });
    const run = s.runs["RPT-0009"]!;
    expect(run.status).toBe("completed");
    expect(run.tests[0]).toMatchObject({ status: "done", verdict: "fail", pct: 100 });
    expect(run.metrics["RUN-0041"]!["throughput_mbps"]).toEqual([{ ts: 100, value: 930 }]);
    expect(run.events[0]).toMatchObject({ testId: "TC-PERF-003", severity: "error" });
    expect(s.toolCalls).toBe(2);
    expect(s.turns[0]!.steps).toBe(2);
    expect(s.items.map((i) => i.kind)).toEqual(["user", "skill", "tool", "plan", "tool", "run"]);
  });

  it("closes open work when a turn is stopped", () => {
    const s = play([
      { type: "turn.started", turnId: "T1" },
      { type: "message.delta", messageId: "M1", text: "Work" },
      { type: "tool.started", callId: "C1", name: "run_test_plan", args: {} },
      { type: "run.started", reportId: "RPT-0009", planId: "P", tests: [{ testRunId: "RUN-0041", testId: "TC-PERF-003" }] },
      { type: "turn.done", turnId: "T1", stopReason: "aborted" },
    ]);
    expect(s.items.find((i) => i.kind === "assistant")).toMatchObject({ streaming: false });
    expect(s.items.find((i) => i.kind === "tool")).toMatchObject({ status: "error" });
    expect(s.runs["RPT-0009"]!.status).toBe("aborted");
    expect(s.turns[0]!.stopReason).toBe("aborted");
  });

  it("records provider errors inline and ignores unknown run ids", () => {
    const s = play([
      { type: "turn.started", turnId: "T1" },
      { type: "run.progress", testRunId: "RUN-9999", pct: 10, simTime: 1 },
      { type: "error", message: "Provider timed out" },
    ]);
    expect(s.items).toEqual([{ kind: "error", id: "error-0", turnId: "T1", message: "Provider timed out" }]);
  });
});
