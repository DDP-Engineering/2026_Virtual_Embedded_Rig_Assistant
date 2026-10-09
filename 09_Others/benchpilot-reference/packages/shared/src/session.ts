// Session view state: the transcript as the UI renders it, plus run-monitor state.
// GET /sessions/:id returns it (SessionDetail); SSE events update it via applySessionEvent().
// Pure and immutable, so the web query cache and server-side snapshots can share it.
import type { EpochSeconds, PlanItem, ReportSummary, Verdict } from "./domain.ts";
import type { Citation, EventSeverity, SessionEvent, StopReason } from "./events.ts";

export type TranscriptItem =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      turnId: string;
      text: string;
      streaming: boolean;
      citations: Citation[];
    }
  | {
      kind: "tool";
      id: string;
      turnId: string;
      name: string;
      args: Record<string, unknown>;
      status: "running" | "ok" | "error";
      summary?: string;
      durationMs?: number;
      preview?: string;
    }
  | { kind: "skill"; id: string; turnId: string; name: string }
  | { kind: "plan"; id: string; turnId: string; plan: PlanCardState }
  | { kind: "run"; id: string; turnId: string; reportId: string }
  | { kind: "error"; id: string; turnId: string | null; message: string };

export interface PlanCardState {
  planId: string;
  title: string;
  device: string;
  fw: string;
  items: PlanItem[];
  rationale: string;
  /** `cancelled`: the turn stopped while the plan was pending. */
  status: "pending" | "approved" | "rejected" | "cancelled";
  /** Items the user approved (after editing). */
  approvedItems?: PlanItem[];
  comment?: string;
}

export interface RunTestState {
  testRunId: string;
  testId: string;
  name: string;
  simDurationS: number;
  pct: number;
  simTime: number;
  status: "queued" | "running" | "done";
  verdict: Verdict | null;
}

export interface MonitorEvent {
  testRunId: string;
  testId: string;
  source: string;
  ts: EpochSeconds;
  severity: EventSeverity;
  message: string;
  ev: string;
}

export interface RunState {
  reportId: string;
  planId: string;
  fw: string;
  device: string;
  status: "running" | "completed" | "aborted";
  tests: RunTestState[];
  /** Newest first. */
  events: MonitorEvent[];
  /** testRunId → metric name → points (append-only while running). */
  metrics: Record<string, Record<string, { ts: EpochSeconds; value: number }[]>>;
  summary: ReportSummary | null;
}

export interface TurnStat {
  turnId: string;
  /** Tool calls in this turn. */
  steps: number;
  stopReason: StopReason | null;
}

export interface SessionState {
  items: TranscriptItem[];
  runs: Record<string, RunState>;
  activeTurnId: string | null;
  pendingPlanId: string | null;
  turns: TurnStat[];
  loadedSkills: string[];
  toolCalls: number;
}

export function emptySessionState(): SessionState {
  return { items: [], runs: {}, activeTurnId: null, pendingPlanId: null, turns: [], loadedSkills: [], toolCalls: 0 };
}

/** The UI adds the user's message optimistically; the server snapshot carries it after a refetch. */
export function appendUserMessage<S extends SessionState>(state: S, id: string, text: string): S {
  return { ...state, items: [...state.items, { kind: "user", id, text }] };
}

function updateItem<S extends SessionState>(state: S, id: string, kind: TranscriptItem["kind"], fn: (item: TranscriptItem) => TranscriptItem): S {
  let hit = false;
  const items = state.items.map((it) => {
    if (it.id !== id || it.kind !== kind) return it;
    hit = true;
    return fn(it);
  });
  return hit ? { ...state, items } : state;
}

function updateRun<S extends SessionState>(state: S, reportId: string, fn: (run: RunState) => RunState): S {
  const run = state.runs[reportId];
  return run ? { ...state, runs: { ...state.runs, [reportId]: fn(run) } } : state;
}

function findRunByTest(state: SessionState, testRunId: string): RunState | undefined {
  return Object.values(state.runs).find((r) => r.tests.some((t) => t.testRunId === testRunId));
}

function updateTest(run: RunState, testRunId: string, fn: (t: RunTestState) => RunTestState): RunState {
  return { ...run, tests: run.tests.map((t) => (t.testRunId === testRunId ? fn(t) : t)) };
}

/** Applies one SSE event. Unknown references (e.g. a delta for a message we never saw) are tolerated. */
export function applySessionEvent<S extends SessionState>(state: S, event: SessionEvent): S {
  const turnId = state.activeTurnId ?? "turn-?";
  switch (event.type) {
    case "turn.started":
      return {
        ...state,
        activeTurnId: event.turnId,
        turns: [...state.turns, { turnId: event.turnId, steps: 0, stopReason: null }],
      };

    case "turn.done": {
      // Close anything a stopped turn left open.
      const items = state.items.map((it): TranscriptItem => {
        if (it.kind === "assistant" && it.streaming) return { ...it, streaming: false };
        if (it.kind === "tool" && it.status === "running") return { ...it, status: "error", summary: it.summary ?? "stopped" };
        if (it.kind === "plan" && it.plan.status === "pending" && event.stopReason !== "end") return { ...it, plan: { ...it.plan, status: "cancelled" } };
        return it;
      });
      const runs = Object.fromEntries(
        Object.entries(state.runs).map(([id, r]) => [id, r.status === "running" && event.stopReason !== "end" ? { ...r, status: "aborted" as const } : r]),
      );
      return {
        ...state,
        items,
        runs,
        activeTurnId: null,
        pendingPlanId: event.stopReason === "end" ? state.pendingPlanId : null,
        turns: state.turns.map((t) => (t.turnId === event.turnId ? { ...t, stopReason: event.stopReason } : t)),
      };
    }

    case "message.delta": {
      const exists = state.items.some((it) => it.kind === "assistant" && it.id === event.messageId);
      if (!exists) {
        const item: TranscriptItem = { kind: "assistant", id: event.messageId, turnId, text: event.text, streaming: true, citations: [] };
        return { ...state, items: [...state.items, item] };
      }
      return updateItem(state, event.messageId, "assistant", (it) => (it.kind === "assistant" ? { ...it, text: it.text + event.text } : it));
    }

    case "message.done":
      return updateItem(state, event.messageId, "assistant", (it) =>
        it.kind === "assistant" ? { ...it, streaming: false, citations: event.citations } : it,
      );

    case "tool.started": {
      const item: TranscriptItem = { kind: "tool", id: event.callId, turnId, name: event.name, args: event.args, status: "running" };
      return {
        ...state,
        items: [...state.items, item],
        toolCalls: state.toolCalls + 1,
        turns: state.turns.map((t) => (t.turnId === turnId ? { ...t, steps: t.steps + 1 } : t)),
      };
    }

    case "tool.done":
      return updateItem(state, event.callId, "tool", (it) =>
        it.kind === "tool"
          ? { ...it, status: event.ok ? "ok" : "error", summary: event.summary, durationMs: event.durationMs, preview: event.preview }
          : it,
      );

    case "skill.loaded": {
      const item: TranscriptItem = { kind: "skill", id: `skill-${state.items.length}-${event.name}`, turnId, name: event.name };
      const loadedSkills = state.loadedSkills.includes(event.name) ? state.loadedSkills : [...state.loadedSkills, event.name];
      return { ...state, items: [...state.items, item], loadedSkills };
    }

    case "plan.proposed": {
      const plan: PlanCardState = {
        planId: event.planId,
        title: event.title ?? "Test plan",
        device: event.device ?? "",
        fw: event.fw ?? "",
        items: event.items,
        rationale: event.rationale,
        status: "pending",
      };
      return { ...state, items: [...state.items, { kind: "plan", id: event.planId, turnId, plan }], pendingPlanId: event.planId };
    }

    case "plan.decided": {
      const next = updateItem(state, event.planId, "plan", (it) =>
        it.kind === "plan"
          ? {
              ...it,
              plan: {
                ...it.plan,
                status: event.decision === "approve" ? "approved" : "rejected",
                approvedItems: event.decision === "approve" ? (event.items ?? it.plan.items) : undefined,
                fw: event.fw ?? it.plan.fw,
                comment: event.comment,
              },
            }
          : it,
      );
      return { ...next, pendingPlanId: next.pendingPlanId === event.planId ? null : next.pendingPlanId };
    }

    case "run.started": {
      const run: RunState = {
        reportId: event.reportId,
        planId: event.planId,
        fw: event.fw ?? "",
        device: event.device ?? "",
        status: "running",
        tests: event.tests.map((t) => ({
          testRunId: t.testRunId,
          testId: t.testId,
          name: t.name ?? t.testId,
          simDurationS: t.simDurationS ?? 0,
          pct: 0,
          simTime: 0,
          status: "queued",
          verdict: null,
        })),
        events: [],
        metrics: {},
        summary: null,
      };
      return {
        ...state,
        runs: { ...state.runs, [event.reportId]: run },
        items: [...state.items, { kind: "run", id: `run-${event.reportId}`, turnId, reportId: event.reportId }],
      };
    }

    case "run.progress": {
      const run = findRunByTest(state, event.testRunId);
      if (!run) return state;
      return updateRun(state, run.reportId, (r) =>
        updateTest(r, event.testRunId, (t) => ({
          ...t,
          pct: Math.max(t.pct, Math.min(100, event.pct)),
          simTime: Math.max(t.simTime, event.simTime),
          status: t.status === "done" ? "done" : "running",
        })),
      );
    }

    case "run.metric": {
      const run = findRunByTest(state, event.testRunId);
      if (!run) return state;
      return updateRun(state, run.reportId, (r) => {
        const perRun = r.metrics[event.testRunId] ?? {};
        const points = perRun[event.name] ?? [];
        return {
          ...r,
          metrics: { ...r.metrics, [event.testRunId]: { ...perRun, [event.name]: [...points, { ts: event.ts, value: event.value }] } },
        };
      });
    }

    case "run.event": {
      const run = findRunByTest(state, event.testRunId);
      if (!run) return state;
      const testId = run.tests.find((t) => t.testRunId === event.testRunId)?.testId ?? "";
      const ev: MonitorEvent = { ...event, testId };
      return updateRun(state, run.reportId, (r) => ({ ...r, events: [ev, ...r.events] }));
    }

    case "run.verdict": {
      const run = findRunByTest(state, event.testRunId);
      if (!run) return state;
      return updateRun(state, run.reportId, (r) =>
        updateTest(r, event.testRunId, (t) => ({ ...t, pct: 100, status: "done", verdict: event.verdict })),
      );
    }

    case "run.completed":
      return updateRun(state, event.reportId, (r) => ({ ...r, status: "completed", summary: event.summary }));

    case "error": {
      const item: TranscriptItem = { kind: "error", id: `error-${state.items.length}`, turnId: state.activeTurnId, message: event.message };
      return { ...state, items: [...state.items, item] };
    }
  }
}

/** Composer state derived from the snapshot (05 §4 states). */
export function sessionStatus(state: SessionState): "idle" | "running" | "awaiting_approval" {
  if (state.pendingPlanId) return "awaiting_approval";
  return state.activeTurnId ? "running" : "idle";
}
