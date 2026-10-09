// SSE events on GET /api/sessions/:id/events (01). Discriminated union on `type`.
// Field lists follow 01; fields marked "P4a addition" are optional extras proposed for 01 (docs/progress/P4a.md).
import type { EpochSeconds, PlanDecision, PlanItem, ReportSummary, Verdict } from "./domain.ts";

export type StopReason = "end" | "aborted" | "error" | "tool_cap";
export type EventSeverity = "error" | "warning" | "info";

export interface Citation {
  ref: string;
  valid: boolean;
}

export interface RunTest {
  testRunId: string;
  testId: string;
  /** P4a addition: display name and simulated duration, so the monitor can label progress before any data arrives. */
  name?: string;
  simDurationS?: number;
}

export type SessionEvent =
  | { type: "turn.started"; turnId: string }
  | { type: "turn.done"; turnId: string; stopReason: StopReason }
  | { type: "message.delta"; messageId: string; text: string }
  | { type: "message.done"; messageId: string; citations: Citation[] }
  | { type: "tool.started"; callId: string; name: string; args: Record<string, unknown> }
  | {
      type: "tool.done";
      callId: string;
      ok: boolean;
      summary: string;
      durationMs: number;
      /** P4a addition: capped result excerpt for the expandable ToolCallRow (≤ 2 000 chars). */
      preview?: string;
    }
  | { type: "skill.loaded"; name: string }
  | {
      type: "plan.proposed";
      planId: string;
      items: PlanItem[];
      rationale: string;
      /** P4a addition: from propose_test_plan args; the approval card shows them. */
      title?: string;
      device?: string;
      fw?: string;
    }
  | {
      type: "plan.decided";
      planId: string;
      decision: PlanDecision;
      /** P4a addition: the approved (possibly edited) items and firmware, and the reject comment. */
      items?: PlanItem[];
      fw?: string;
      comment?: string;
    }
  | {
      type: "run.started";
      reportId: string;
      planId: string;
      tests: RunTest[];
      /** P4a addition. */
      fw?: string;
      device?: string;
    }
  | {
      type: "run.progress";
      testRunId: string;
      /** 0–100. */
      pct: number;
      /** Simulated seconds elapsed in this test run. */
      simTime: number;
    }
  | { type: "run.metric"; testRunId: string; name: string; ts: EpochSeconds; value: number }
  | {
      type: "run.event";
      testRunId: string;
      source: string;
      ts: EpochSeconds;
      severity: EventSeverity;
      message: string;
      ev: string;
    }
  | { type: "run.verdict"; testRunId: string; testId: string; verdict: Verdict }
  | { type: "run.completed"; reportId: string; summary: ReportSummary }
  | { type: "error"; message: string };

/** `error.message` the server emits at startup for a turn a restart cut off (P3 restart recovery); the UI renders it as its own item. */
export const SERVER_RESTART_MESSAGE = "The server restarted during this turn.";

export type SessionEventType = SessionEvent["type"];
export type SessionEventOf<T extends SessionEventType> = Extract<SessionEvent, { type: T }>;
