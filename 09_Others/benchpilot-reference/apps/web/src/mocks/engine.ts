// Scripted turns: the mock counterpart of the server's agent loop (04 §1) + runner (04 §4).
// Scripts only emit SSE-shaped events; everything the UI shows comes from those events and the mock store.
import { extractCitations, type Plan, type PlanDecisionItem, type PlanItem, type SessionEvent, type TestRun } from "@benchpilot/shared";
import { testById } from "./fixtures/catalog";
import { db } from "./store";

export class AbortedError extends Error {
  constructor() {
    super("aborted");
  }
}

/** Thrown by a script to end the turn with an `error` event (provider failure). */
export class ProviderError extends Error {}

/** Demo-time multiplier on top of each test's `duration.demo_s` (01 DEMO_SPEED). */
function mockSpeed() {
  try {
    const v = Number(localStorage.getItem("bp-mock-speed"));
    if (v > 0) return v;
  } catch {
    // ignore
  }
  return 2.5;
}

export interface Decision {
  decision: "approve" | "reject";
  plan: Plan;
  items: PlanItem[];
  fw: string;
  comment?: string;
}

type Resolver = { sessionId: string; resolve: (d: { decision: "approve" | "reject"; items?: PlanDecisionItem[]; fw?: string; comment?: string }) => void };
const pendingDecisions = new Map<string, Resolver>();

/** Called by mockApi.decidePlan (POST /plans/:id/decision). */
export function resolvePlanDecision(planId: string, d: Parameters<Resolver["resolve"]>[0]): boolean {
  const r = pendingDecisions.get(planId);
  if (!r) return false;
  pendingDecisions.delete(planId);
  r.resolve(d);
  return true;
}

export interface RunResult {
  reportId: string;
  fw: string;
  runs: TestRun[];
}

export class TurnContext {
  constructor(
    readonly sessionId: string,
    readonly turnId: string,
    readonly signal: AbortSignal,
    private readonly emitFn: (e: SessionEvent) => void,
  ) {}

  emit(e: SessionEvent) {
    if (this.signal.aborted) throw new AbortedError();
    this.emitFn(e);
  }

  sleep(ms: number) {
    return new Promise<void>((resolve, reject) => {
      if (this.signal.aborted) return reject(new AbortedError());
      const t = setTimeout(() => {
        this.signal.removeEventListener("abort", onAbort);
        resolve();
      }, ms);
      const onAbort = () => {
        clearTimeout(t);
        reject(new AbortedError());
      };
      this.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  /** Streams markdown in ~40-char chunks (04 §8 replay provider), then validates citations. */
  async say(markdown: string) {
    const messageId = `M-${db.next("message")}`;
    for (let i = 0; i < markdown.length; i += 40) {
      this.emit({ type: "message.delta", messageId, text: markdown.slice(i, i + 40) });
      await this.sleep(35);
    }
    const citations = extractCitations(markdown).map((ref) => ({ ref, valid: db.resolveEvidence(ref) !== null }));
    this.emit({ type: "message.done", messageId, citations });
  }

  async tool(name: string, args: Record<string, unknown>, result: { summary: string; ms: number; preview?: string; ok?: boolean; wait?: number }) {
    const callId = `C-${db.next("call")}`;
    this.emit({ type: "tool.started", callId, name, args });
    await this.sleep(result.wait ?? 380);
    this.emit({ type: "tool.done", callId, ok: result.ok ?? true, summary: result.summary, durationMs: result.ms, preview: result.preview });
  }

  async skill(name: string) {
    await this.tool("load_skill", { name }, { summary: "loaded", ms: 4, wait: 200 });
    this.emit({ type: "skill.loaded", name });
  }

  /** propose_test_plan: blocks until POST /plans/:id/decision (04 §4). */
  async proposePlan(p: { title: string; fw: string; rationale: string; items: { testId: string; rationale: string }[] }): Promise<Decision> {
    const items: PlanItem[] = p.items.map(({ testId, rationale }) => {
      const t = testById(testId)!;
      return { testId, rationale, name: t.name, version: t.version, duration: t.duration };
    });
    const plan: Plan = {
      id: `PLAN-${String(db.next("plan")).padStart(4, "0")}`,
      sessionId: this.sessionId,
      testbenchId: "TB-01",
      title: p.title,
      device: "RTR-AX3000",
      fw: p.fw,
      items,
      rationale: p.rationale,
      status: "pending",
    };
    db.plans.set(plan.id, plan);
    const callId = `C-${db.next("call")}`;
    const args = { title: p.title, device: plan.device, fw: p.fw, items: p.items.map((i) => ({ test_id: i.testId, rationale: i.rationale })), rationale: p.rationale };
    this.emit({ type: "tool.started", callId, name: "propose_test_plan", args });
    await this.sleep(250);
    this.emit({ type: "plan.proposed", planId: plan.id, items, rationale: p.rationale, title: p.title, device: plan.device, fw: p.fw });

    const started = performance.now();
    const raw = await new Promise<Parameters<Resolver["resolve"]>[0]>((resolve, reject) => {
      pendingDecisions.set(plan.id, { sessionId: this.sessionId, resolve });
      this.signal.addEventListener(
        "abort",
        () => {
          pendingDecisions.delete(plan.id);
          reject(new AbortedError());
        },
        { once: true },
      );
    });
    const approved = raw.decision === "approve";
    // Like the server: edited items carry only {testId, rationale}; the rest is re-enriched from the proposal.
    const chosen: PlanItem[] = approved
      ? raw.items
        ? raw.items.flatMap((e) => {
            const base = items.find((i) => i.testId === e.testId);
            return base ? [{ ...base, rationale: e.rationale || base.rationale }] : [];
          })
        : items
      : [];
    const fw = raw.fw ?? p.fw;
    plan.status = approved ? "approved" : "rejected";
    plan.fw = fw;
    plan.decidedAt = new Date().toISOString();
    plan.comment = raw.comment;
    this.emit({ type: "plan.decided", planId: plan.id, decision: raw.decision, items: approved ? chosen : undefined, fw, comment: raw.comment });
    this.emit({
      type: "tool.done",
      callId,
      ok: true,
      summary: approved ? `approved · ${chosen.length} of ${items.length} tests${fw !== p.fw ? ` · fw ${fw}` : ""}` : "rejected",
      durationMs: Math.round(performance.now() - started),
      preview: JSON.stringify({ plan_id: plan.id, decision: raw.decision, items: chosen.map((i) => i.testId), fw, comment: raw.comment }, null, 2),
    });
    return { decision: raw.decision, plan, items: chosen, fw, comment: raw.comment };
  }

  /** run_test_plan: consumes live pools, replays each dataset's timeline, builds the report (04 §4). */
  async runPlan(d: Decision): Promise<RunResult> {
    const callId = `C-${db.next("call")}`;
    const started = performance.now();
    this.emit({ type: "tool.started", callId, name: "run_test_plan", args: { plan_id: d.plan.id } });
    d.plan.status = "running";

    const reportId = `RPT-${String(db.next("report")).padStart(4, "0")}`;
    const planned = d.items.map((item) => ({
      item,
      runId: `RUN-${String(db.next("run")).padStart(4, "0")}`,
      fixture: db.takeDataset(d.fw, item.testId),
    }));
    this.emit({
      type: "run.started",
      reportId,
      planId: d.plan.id,
      fw: d.fw,
      device: d.plan.device,
      tests: planned.map((p) => ({ testRunId: p.runId, testId: p.item.testId, name: p.item.name, simDurationS: p.item.duration.sim_s })),
    });

    const speed = mockSpeed();
    const runs: TestRun[] = [];
    for (const { item, runId, fixture } of planned) {
      if (!fixture) {
        this.emit({ type: "run.verdict", testRunId: runId, testId: item.testId, verdict: "error" });
        continue;
      }
      const run = db.registerRun(runId, reportId, fixture);
      runs.push(run);
      const wallMs = (item.duration.demo_s * 1000) / speed;
      const simS = item.duration.sim_s;
      const points = fixture.series.flatMap((s) => s.points.map((p) => ({ name: s.name, ...p }))).sort((a, b) => a.offset - b.offset);
      const events = [...fixture.events].sort((a, b) => a.offset - b.offset);
      let mi = 0;
      let ei = 0;
      const t0 = performance.now();
      for (;;) {
        const frac = Math.min(1, (performance.now() - t0) / wallMs);
        const sim = frac * simS;
        while (mi < points.length && (points[mi]!.offset <= sim || frac >= 1)) {
          const p = points[mi++]!;
          this.emit({ type: "run.metric", testRunId: runId, name: p.name, ts: fixture.start + p.offset, value: p.value });
        }
        while (ei < events.length && events[ei]!.offset <= sim) {
          const e = events[ei++]!;
          this.emit({
            type: "run.event",
            testRunId: runId,
            source: e.source,
            ts: fixture.start + e.offset,
            severity: e.severity,
            message: e.message,
            ev: `ev:${runId}/log/${e.source}/${e.line}`,
          });
        }
        this.emit({ type: "run.progress", testRunId: runId, pct: Math.round(frac * 100), simTime: Math.round(sim) });
        if (frac >= 1) break;
        await this.sleep(150);
      }
      this.emit({ type: "run.verdict", testRunId: runId, testId: item.testId, verdict: run.verdict });
      await this.sleep(250);
    }

    const report = db.buildReport(reportId, d.plan.id, "live", d.fw, new Date().toISOString(), runs);
    db.reports.set(reportId, { detail: report, sessionId: this.sessionId });
    const session = db.sessions.get(this.sessionId);
    if (session) session.summary = { ...session.summary, lastReportId: reportId };
    d.plan.status = "done";
    this.emit({ type: "run.completed", reportId, summary: report.summary });

    const results = runs.map((r) => ({ test_run_id: r.id, test_id: r.testId, verdict: r.verdict, failing_checks: r.checks.filter((c) => !c.pass).map((c) => c.id) }));
    this.emit({
      type: "tool.done",
      callId,
      ok: true,
      summary: `${runs.length} tests · ${reportId}`,
      durationMs: Math.round(performance.now() - started),
      preview: JSON.stringify({ report_id: reportId, results }, null, 2),
    });
    return { reportId, fw: d.fw, runs };
  }
}
