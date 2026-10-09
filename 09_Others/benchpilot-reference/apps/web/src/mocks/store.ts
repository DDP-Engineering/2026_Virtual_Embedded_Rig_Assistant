// In-memory stand-in for the server's DB (01 data model). Mutated by mockApi and the mock runner.
// Reset from Settings → Demo restores the post-seed state (history RPT-0001…0008, next live report RPT-0009).
import {
  emptySessionState,
  parseEvidenceRef,
  type ChatgptAuthStatus,
  type EvidenceResponse,
  type LlmSettings,
  type MetricSeries,
  type Plan,
  type ProviderId,
  type ProviderView,
  type ReportAnalysis,
  type ReportDetail,
  type SessionState,
  type SessionSummary,
  type TestbenchConfig,
  type TestbenchDoc,
  type TestRun,
  type TicketDraft,
  type Topology,
} from "@benchpilot/shared";
import { iso } from "./fixtures/clock";
import { testById } from "./fixtures/catalog";
import { historyFixtures, POOLS, LIVE_FIXTURES, type RunFixture } from "./fixtures/runs";
import { slopePerHour, p95Of } from "./fixtures/series";
import { TB01_CONFIG, TB01_TOPOLOGY, tb01Docs } from "./fixtures/testbench";
import { seedSessions } from "./seed-sessions";

export interface StoredRun {
  run: TestRun;
  fixture: RunFixture;
}

export interface StoredReport {
  detail: ReportDetail;
  sessionId: string | null;
}

export interface StoredSession {
  summary: SessionSummary;
  state: SessionState;
}

interface Secrets {
  keys: Partial<Record<ProviderId, string>>;
}

const pad = (n: number) => String(n).padStart(4, "0");

function provider(id: ProviderId, patch: Partial<ProviderView> = {}): ProviderView {
  return { id, configured: false, keyMasked: null, model: null, baseUrl: null, ...patch };
}

export function maskKey(key: string) {
  return `••••${key.slice(-4)}`;
}

class MockDb {
  testbenches = new Map<string, { config: TestbenchConfig; topology: Topology; createdAt: string }>();
  docs: TestbenchDoc[] = [];
  sessions = new Map<string, StoredSession>();
  plans = new Map<string, Plan>();
  reports = new Map<string, StoredReport>();
  runs = new Map<string, StoredRun>();
  poolCursor = new Map<string, number>();
  counters = { report: 9, run: 41, plan: 4, session: 4, ticket: 1, doc: 1, turn: 1, message: 1, call: 1, testbench: 2 };
  settings!: LlmSettings;
  secrets: Secrets = { keys: {} };

  constructor() {
    this.reset();
  }

  reset() {
    this.testbenches.clear();
    this.sessions.clear();
    this.plans.clear();
    this.reports.clear();
    this.runs.clear();
    this.poolCursor.clear();
    this.counters = { report: 9, run: 41, plan: 4, session: 4, ticket: 1, doc: 9, turn: 1, message: 1, call: 1, testbench: 2 };
    this.testbenches.set("TB-01", { config: structuredClone(TB01_CONFIG), topology: TB01_TOPOLOGY, createdAt: "2026-09-12T08:00:00Z" });
    this.docs = tb01Docs();
    this.seedHistory();
    for (const s of seedSessions(this)) this.sessions.set(s.summary.id, s);
    const chatgpt: ChatgptAuthStatus = { connected: false };
    this.secrets = { keys: { anthropic: "sk-ant-demo-000000001234" } };
    this.settings = {
      active: "anthropic",
      providers: {
        anthropic: provider("anthropic", { configured: true, keyMasked: maskKey("sk-ant-demo-000000001234"), model: "claude-sonnet-5-5" }),
        openai: provider("openai"),
        custom: provider("custom"),
        chatgpt: provider("chatgpt"),
        replay: provider("replay", { configured: true, model: "demo-replay" }),
      },
      models: { anthropic: ["claude-sonnet-5-5", "claude-opus-5-5"], openai: ["gpt-5.1", "gpt-5.1-mini"], chatgpt: ["gpt-5.1-codex"] },
      chatgpt,
    };
  }

  next(kind: keyof MockDb["counters"]) {
    return this.counters[kind]++;
  }

  // ---------------------------------------------------------------- history (npm run seed)

  private seedHistory() {
    let runNo = 1;
    for (const { night, date, fixtures } of historyFixtures()) {
      const reportId = `RPT-${pad(night)}`;
      const runs = fixtures.map((f) => this.registerRun(`RUN-${pad(runNo++)}`, reportId, f));
      const created = date + 12 * 3600 + 45 * 60;
      this.reports.set(reportId, { detail: this.buildReport(reportId, null, "history", "2.0.4", iso(created), runs), sessionId: null });
    }
  }

  registerRun(runId: string, reportId: string, fixture: RunFixture): TestRun {
    const test = testById(fixture.testId)!;
    const run: TestRun = {
      id: runId,
      reportId,
      datasetId: fixture.datasetId,
      testId: fixture.testId,
      testName: test.name,
      testVersion: test.version,
      device: "RTR-AX3000",
      fw: fixture.fw,
      testbenchId: "TB-01",
      verdict: fixture.verdict,
      checks: fixture.checks(runId),
      startedAt: fixture.start,
      endedAt: fixture.start + test.duration.sim_s,
      artifacts: fixture.artifacts.map((path) => ({ name: path.replace(/\.[^.]+$/, ""), type: path.split(".").pop() ?? "", path })),
    };
    this.runs.set(runId, { run, fixture });
    return run;
  }

  buildReport(id: string, planId: string | null, kind: "live" | "history", fw: string, createdAt: string, runs: TestRun[]): ReportDetail {
    const passed = runs.filter((r) => r.verdict === "pass").length;
    const errored = runs.filter((r) => r.verdict === "error").length;
    const failed = runs.length - passed - errored;
    return {
      id,
      planId,
      testbenchId: "TB-01",
      device: "RTR-AX3000",
      fw,
      kind,
      createdAt,
      summary: { total: runs.length, passed, failed, errored, simDurationS: runs.reduce((s, r) => s + (r.endedAt - r.startedAt), 0) },
      verdict: failed + errored > 0 ? "fail" : "pass",
      hasAnalysis: false,
      runs,
      analysis: null,
      tickets: [],
    };
  }

  /** Next dataset from the live pool; the last entry repeats when exhausted (02). */
  takeDataset(fw: string, testId: string): RunFixture | null {
    const pool = POOLS[fw]?.[testId];
    if (!pool?.length) return null;
    const key = `${fw}/${testId}`;
    const i = this.poolCursor.get(key) ?? 0;
    this.poolCursor.set(key, i + 1);
    return LIVE_FIXTURES[pool[Math.min(i, pool.length - 1)]!] ?? null;
  }

  saveAnalysis(reportId: string, analysis: ReportAnalysis) {
    const r = this.reports.get(reportId);
    if (!r) return;
    r.detail = { ...r.detail, analysis, hasAnalysis: true };
  }

  addTicket(reportId: string, t: Omit<TicketDraft, "id" | "reportId" | "createdAt">) {
    const r = this.reports.get(reportId);
    if (!r) return;
    const ticket: TicketDraft = { ...t, id: `DRAFT-${pad(this.next("ticket"))}`, reportId, createdAt: new Date().toISOString() };
    r.detail = { ...r.detail, tickets: [...r.detail.tickets, ticket] };
  }

  /** Runs of one test across all reports, oldest first. */
  runsOfTest(testId: string): StoredRun[] {
    return [...this.runs.values()].filter((r) => r.run.testId === testId && this.reports.has(r.run.reportId)).sort((a, b) => a.run.startedAt - b.run.startedAt);
  }

  // ---------------------------------------------------------------- metrics and evidence (GET /runs/:id/metrics, /evidence)

  metricSeries(runId: string, name: string): MetricSeries | null {
    const stored = this.runs.get(runId);
    const s = stored?.fixture.series.find((x) => x.name === name);
    if (!stored || !s) return null;
    const { fixture } = stored;
    const values = s.points.map((p) => p.value);
    const test = testById(fixture.testId)!;
    return {
      testRunId: runId,
      name,
      unit: s.unit,
      startTs: fixture.start,
      endTs: fixture.start + test.duration.sim_s,
      points: s.points.map((p) => ({ ts: fixture.start + p.offset, value: p.value })),
      stats: {
        min: Math.min(...values),
        max: Math.max(...values),
        avg: values.reduce((a, b) => a + b, 0) / values.length,
        p95: p95Of(values),
        slope_per_hour: slopePerHour(s.points),
      },
      markers: fixture.events
        .filter((e) => e.severity === "error")
        .map((e) => ({ ts: fixture.start + e.offset, label: /out of memory/i.test(e.message) ? "OOM" : "link down", ev: `ev:${runId}/log/${e.source}/${e.line}` })),
    };
  }

  resolveEvidence(ref: string): EvidenceResponse | null {
    const ev = parseEvidenceRef(ref);
    if (!ev) return null;

    if (ev.kind === "doc") {
      const doc = this.docs.find((d) => d.testbenchId === ev.testbenchId && d.path === ev.path);
      if (!doc) return null;
      const section = ev.anchor ? docSection(doc.content, ev.anchor) : null;
      if (ev.anchor && !section) return null;
      return {
        kind: "doc",
        ref,
        title: section ? `${doc.path.replace(/^docs\//, "")} › ${section.heading}` : doc.path.replace(/^docs\//, ""),
        testbenchId: ev.testbenchId,
        path: doc.path,
        heading: section?.heading ?? null,
        markdown: doc.content,
        highlight: section?.body,
      };
    }

    const stored = this.runs.get(ev.testRunId);
    if (!stored) return null;
    const { run, fixture } = stored;
    const label = `${run.id} (${run.testId}, fw ${run.fw})`;

    switch (ev.kind) {
      case "log": {
        const ex = fixture.logs.find((l) => l.source === ev.source);
        if (!ex || ev.line < ex.first || ev.line >= ex.first + ex.lines.length) return null;
        const lines = ex.lines.map((text, i) => ({ no: ex.first + i, text })).filter((l) => Math.abs(l.no - ev.line) <= 10);
        return { kind: "log", ref, title: `${ev.source} · ${ex.host} · ${label}`, testRunId: run.id, source: ev.source, host: ex.host, lines, target: ev.line };
      }
      case "pcap": {
        const ex = fixture.pcaps.find((p) => p.capture === ev.capture);
        if (!ex || !ex.rows.some((r) => r.no === ev.frame)) return null;
        return {
          kind: "pcap",
          ref,
          title: `${ev.capture}.pcapng · frame ${ev.frame} · ${label}`,
          testRunId: run.id,
          capture: ev.capture,
          frame: ev.frame,
          rows: ex.rows.filter((r) => Math.abs(r.no - ev.frame) <= 15),
          detail: ex.details[ev.frame] ?? [{ label: `Frame ${ev.frame}` }],
          filter: ex.filters[ev.frame] ?? `frame.number == ${ev.frame}`,
          downloadUrl: `/api/runs/${run.id}/artifacts/${ev.capture}.pcapng`,
        };
      }
      case "metric": {
        const series = this.metricSeries(run.id, ev.name);
        if (!series || ev.ts < series.startTs - 60 || ev.ts > series.endTs + 60) return null;
        const baselineRun = run.fw !== "2.0.4" ? this.runsOfTest(run.testId).filter((r) => r.run.fw === "2.0.4").at(-1) : undefined;
        const baseline = baselineRun ? this.metricSeries(baselineRun.run.id, ev.name) : null;
        return {
          kind: "metric",
          ref,
          title: `${ev.name} · ${label}`,
          testRunId: run.id,
          series,
          markerTs: ev.ts,
          baseline: baseline
            ? { label: `${baselineRun!.run.id} · fw ${baselineRun!.run.fw}`, points: baseline.points.map((p) => ({ ts: p.ts - baseline.startTs + series.startTs, value: p.value })) }
            : undefined,
          note: metricNote(ev.name, run.fw, baselineRun?.run.id),
        };
      }
      case "check": {
        const check = run.checks.find((c) => c.id === ev.checkId);
        if (!check) return null;
        return { kind: "check", ref, title: `${run.testId} · ${check.title} · ${run.id}`, testRunId: run.id, testId: run.testId, check };
      }
    }
  }
}

function metricNote(name: string, fw: string, baselineRun?: string) {
  if (name === "mem_free_kb" && fw === "2.1.0")
    return `Fitted up to the OOM kill: −17.5 MB/h on 2.1.0. A whole-run fit gives −4.5 MB/h because mesh-agent restarts. Baseline ${baselineRun ?? "2.0.4"}: flat.`;
  return undefined;
}

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");

/** Section under the heading whose slug matches `anchor` (GitHub-style slugs). */
export function docSection(markdown: string, anchor: string): { heading: string; body: string } | null {
  const lines = markdown.split("\n");
  const at = lines.findIndex((l) => /^#{1,6}\s/.test(l) && slug(l.replace(/^#+\s*/, "")) === anchor);
  if (at === -1) return null;
  const level = lines[at]!.match(/^#+/)![0].length;
  const end = lines.findIndex((l, i) => i > at && /^#{1,6}\s/.test(l) && l.match(/^#+/)![0].length <= level);
  return { heading: lines[at]!.replace(/^#+\s*/, ""), body: lines.slice(at + 1, end === -1 ? undefined : end).join("\n").trim() };
}

export const db = new MockDb();
export type { MockDb };
export { emptySessionState };
