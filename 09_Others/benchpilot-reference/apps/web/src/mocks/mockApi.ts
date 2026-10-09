// BenchPilotApi on in-memory fixtures. Same contract P4b implements over HTTP + SSE.
import {
  appendUserMessage,
  applySessionEvent,
  emptySessionState,
  sessionStatus,
  type CatalogTestDetail,
  type CatalogTestSummary,
  type LlmSettings,
  type ProviderId,
  type SessionEvent,
  type SessionSummary,
  type TestbenchSummary,
  type Verdict,
} from "@benchpilot/shared";
import { ApiRequestError, type BenchPilotApi, type SessionStreamHandlers } from "@/api/client";
import { SKILLS, TESTS, TOOLS, testById } from "./fixtures/catalog";
import { headline, POOLS } from "./fixtures/runs";
import { testbenchMdTemplate, tb01Docs } from "./fixtures/testbench";
import { AbortedError, ProviderError, resolvePlanDecision, TurnContext } from "./engine";
import { exportReport } from "./exports";
import { pickScript } from "./scenarios";
import { db, maskKey } from "./store";

const delay = (ms = 70) => new Promise((r) => setTimeout(r, ms));
const clone = <T>(v: T): T => structuredClone(v);

function notFound(what: string): never {
  throw new ApiRequestError(404, `${what} not found`);
}

// ---------------------------------------------------------------- session event bus

interface Subscriber {
  handlers: SessionStreamHandlers;
  /** Last seq delivered; a dropped subscriber catches up from here when it "reconnects". */
  last: number;
  dropped: boolean;
}
const subscribers = new Map<string, Set<Subscriber>>();
const activeTurns = new Map<string, AbortController>();
/** Per-session event log, seq = index + 1 — the mock side of P3's `session_events` and SSE ids. */
const eventLogs = new Map<string, SessionEvent[]>();
const lastSeq = (sessionId: string) => eventLogs.get(sessionId)?.length ?? 0;

function deliver(sub: Subscriber, sessionId: string) {
  const log = eventLogs.get(sessionId) ?? [];
  while (!sub.dropped && sub.last < log.length) {
    sub.last += 1;
    sub.handlers.onEvent(log[sub.last - 1]!, sub.last);
  }
}

function emit(sessionId: string, event: SessionEvent) {
  const s = db.sessions.get(sessionId);
  if (s) {
    s.state = applySessionEvent(s.state, event);
    s.summary = { ...s.summary, status: sessionStatus(s.state), updatedAt: new Date().toISOString() };
  }
  const log = eventLogs.get(sessionId) ?? [];
  log.push(event);
  eventLogs.set(sessionId, log);
  for (const sub of subscribers.get(sessionId) ?? []) deliver(sub, sessionId);
}

/** `/mock-reconnect`: the stream drops for 2.5 s, then resumes after the last delivered seq (like Last-Event-ID). */
function simulateDrop(sessionId: string) {
  for (const sub of subscribers.get(sessionId) ?? []) {
    sub.dropped = true;
    sub.handlers.onState("reconnecting");
    setTimeout(() => {
      sub.dropped = false;
      sub.handlers.onState("open");
      deliver(sub, sessionId);
    }, 2500);
  }
}

async function runTurn(sessionId: string, turnId: string, text: string) {
  const ctrl = new AbortController();
  activeTurns.set(sessionId, ctrl);
  const ctx = new TurnContext(sessionId, turnId, ctrl.signal, (e) => emit(sessionId, e));
  emit(sessionId, { type: "turn.started", turnId });
  try {
    if (/^\/mock-reconnect/i.test(text)) {
      simulateDrop(sessionId);
      await ctx.say("Event stream dropped and resumed (simulated). Nothing was lost: the stream resumed after the last event it delivered.");
    } else {
      await pickScript(text)(ctx, text);
    }
    emit(sessionId, { type: "turn.done", turnId, stopReason: "end" });
  } catch (err) {
    if (err instanceof AbortedError || ctrl.signal.aborted) {
      emit(sessionId, { type: "turn.done", turnId, stopReason: "aborted" });
    } else {
      emit(sessionId, { type: "error", message: err instanceof ProviderError ? err.message : `Unexpected error: ${String(err)}` });
      emit(sessionId, { type: "turn.done", turnId, stopReason: "error" });
      if (!(err instanceof ProviderError)) console.warn(err);
    }
  } finally {
    activeTurns.delete(sessionId);
  }
}

// ---------------------------------------------------------------- catalog helpers

function lastVerdicts(testId: string): { verdicts: Verdict[]; fw: string | null } {
  const runs = db.runsOfTest(testId).slice(-8);
  const fws = new Set(runs.map((r) => r.run.fw));
  return { verdicts: runs.map((r) => r.run.verdict), fw: fws.size === 1 ? [...fws][0]! : null };
}

function summarizeTestbench(id: string): TestbenchSummary {
  const tb = db.testbenches.get(id)!;
  const reports = [...db.reports.values()].map((r) => r.detail).filter((r) => r.testbenchId === id);
  const last = reports.sort((a, b) => b.id.localeCompare(a.id))[0];
  return {
    id,
    name: tb.config.name,
    description: tb.config.description,
    device: tb.config.device,
    counts: {
      docs: db.docs.filter((d) => d.testbenchId === id).length,
      tools: tb.config.enabled_tools.length,
      skills: tb.config.enabled_skills.length,
      tests: tb.config.enabled_tests.length,
    },
    lastReport: last ? { id: last.id, verdict: last.verdict, fw: last.fw, createdAt: last.createdAt } : null,
  };
}

function activeModel(settings: LlmSettings): { provider: ProviderId | null; model: string | null } {
  if (!settings.active) return { provider: null, model: null };
  return { provider: settings.active, model: settings.providers[settings.active].model };
}

// ---------------------------------------------------------------- API

export const mockApi: BenchPilotApi = {
  async getHealth() {
    // Real endpoint: the P0 server is up during P4a, and Settings shows its tshark probe.
    const r = await fetch("/api/health");
    if (!r.ok) throw new ApiRequestError(r.status, "health check failed");
    return r.json();
  },

  async getAbout() {
    await delay();
    return { version: "mock", gitSha: null, buildDate: null, distribution: "source" as const, node: "in-browser mocks", notices: false };
  },

  async listTestbenches() {
    await delay();
    return [...db.testbenches.keys()].map(summarizeTestbench);
  },
  async getTestbench(id) {
    await delay();
    const tb = db.testbenches.get(id) ?? notFound(`Testbench ${id}`);
    return clone(tb);
  },
  async createTestbench(req) {
    await delay(300);
    const id = `TB-${String(db.next("testbench")).padStart(2, "0")}`;
    const config = {
      id,
      name: req.name,
      description: req.description ?? `Virtual testbench for ${req.device.model}`,
      device: req.device,
      enabled_tools: req.enabled_tools,
      enabled_skills: req.enabled_skills,
      enabled_tests: req.enabled_tests,
      simulation: { pools: "data/pools.json" },
    };
    const base = db.testbenches.get("TB-01")!;
    db.testbenches.set(id, { config, topology: base.topology, createdAt: new Date().toISOString() });
    const firstId = db.counters.doc;
    const docs =
      req.template === "tb-01"
        ? tb01Docs(id, firstId)
        : [{ id: firstId, testbenchId: id, path: "docs/TESTBENCH.md", title: req.name, content: testbenchMdTemplate(req.name, req.device.model), pinned: true }];
    db.counters.doc = firstId + docs.length;
    db.docs.push(...docs);
    for (const d of req.docs ?? []) db.docs.push({ id: db.next("doc"), testbenchId: id, path: d.path, title: d.path.split("/").pop()!, content: d.content, pinned: false });
    return clone(db.testbenches.get(id)!);
  },
  async updateTestbench(id, req) {
    await delay();
    const tb = db.testbenches.get(id) ?? notFound(`Testbench ${id}`);
    tb.config = { ...tb.config, ...req };
    return clone(tb);
  },
  async listDocs(testbenchId) {
    await delay();
    return clone(db.docs.filter((d) => d.testbenchId === testbenchId));
  },
  async createDoc(testbenchId, req) {
    await delay();
    if (db.docs.some((d) => d.testbenchId === testbenchId && d.path === req.path)) throw new ApiRequestError(409, `${req.path} already exists`);
    const title = /^#\s+(.+)$/m.exec(req.content)?.[1] ?? req.path.split("/").pop()!;
    const doc = { id: db.next("doc"), testbenchId, path: req.path, title, content: req.content, pinned: false };
    db.docs.push(doc);
    return clone(doc);
  },
  async updateDoc(testbenchId, docId, req) {
    await delay(150);
    const doc = db.docs.find((d) => d.id === docId && d.testbenchId === testbenchId) ?? notFound(`Document ${docId}`);
    doc.content = req.content;
    doc.title = /^#\s+(.+)$/m.exec(req.content)?.[1] ?? doc.title;
    return clone(doc);
  },
  async deleteDoc(testbenchId, docId) {
    await delay();
    const doc = db.docs.find((d) => d.id === docId && d.testbenchId === testbenchId) ?? notFound(`Document ${docId}`);
    if (doc.pinned) throw new ApiRequestError(409, "TESTBENCH.md can't be deleted");
    db.docs = db.docs.filter((d) => d !== doc);
  },
  async getSimulation(testbenchId) {
    await delay();
    const tb = db.testbenches.get(testbenchId) ?? notFound(`Testbench ${testbenchId}`);
    const pools = Object.entries(POOLS)
      .sort(([a], [b]) => b.localeCompare(a, undefined, { numeric: true }))
      .flatMap(([fw, tests]) =>
        Object.entries(tests)
          .filter(([testId]) => tb.config.enabled_tests.includes(testId))
          .map(([testId, datasets]) => ({ fw, testId, datasets, next: Math.min(db.poolCursor.get(`${fw}/${testId}`) ?? 0, datasets.length - 1) })),
      );
    return { poolsFile: tb.config.simulation.pools, pools };
  },

  async listCatalogTests() {
    await delay();
    return TESTS.map((t): CatalogTestSummary => {
      const { verdicts, fw } = lastVerdicts(t.id);
      return { id: t.id, name: t.name, version: t.version, area: t.area, owner: t.owner, duration: t.duration, lastVerdicts: verdicts, lastVerdictsFw: fw };
    });
  },
  async getCatalogTest(id) {
    await delay();
    const t = testById(id) ?? notFound(`Test ${id}`);
    const runs = db.runsOfTest(id);
    const history = runs.map(({ run, fixture }) => ({
      date: new Date(run.startedAt * 1000).toISOString(),
      fw: run.fw,
      testVersion: run.testVersion,
      verdict: run.verdict,
      measured: Object.fromEntries(run.checks.map((c) => [c.id, c.measured])),
      value: headline(fixture),
      testRunId: run.id,
      reportId: run.reportId,
    }));
    const last8 = history.slice(-8);
    const flips = last8.reduce((n, h, i) => (i > 0 && h.verdict !== last8[i - 1]!.verdict ? n + 1 : n), 0);
    return clone({ ...t, history, flips } satisfies CatalogTestDetail);
  },
  async listSkills() {
    await delay();
    return SKILLS.map(({ name, description }) => ({ name, description }));
  },
  async getSkill(name) {
    await delay();
    return clone(SKILLS.find((s) => s.name === name) ?? notFound(`Skill ${name}`));
  },
  async listTools() {
    await delay();
    return clone(TOOLS);
  },

  async listSessions() {
    await delay();
    return [...db.sessions.values()].map((s) => clone(s.summary)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async createSession(req) {
    await delay();
    const id = `S-${String(db.next("session")).padStart(4, "0")}`;
    const now = new Date().toISOString();
    const summary: SessionSummary = { id, testbenchId: req.testbenchId, title: "New session", ...activeModel(db.settings), createdAt: now, updatedAt: now, lastReportId: null, status: "idle" };
    db.sessions.set(id, { summary, state: emptySessionState() });
    return clone(summary);
  },
  async getSession(id) {
    await delay();
    const s = db.sessions.get(id) ?? notFound(`Session ${id}`);
    return clone({ ...s.state, session: s.summary, seq: lastSeq(id) });
  },
  async postMessage(sessionId, req) {
    await delay(40);
    const s = db.sessions.get(sessionId) ?? notFound(`Session ${sessionId}`);
    if (activeTurns.has(sessionId)) throw new ApiRequestError(409, "A turn is already running in this session");
    const turnId = `T-${db.next("turn")}`;
    const messageId = `U-${db.next("message")}`;
    s.state = appendUserMessage(s.state, messageId, req.text);
    if (s.summary.title === "New session") {
      const t = req.text.trim();
      s.summary = { ...s.summary, title: t.length > 60 ? `${t.slice(0, 59)}…` : t };
    }
    void runTurn(sessionId, turnId, req.text);
    return { turnId, messageId };
  },
  async stopTurn(sessionId) {
    await delay(30);
    activeTurns.get(sessionId)?.abort();
  },
  async decidePlan(planId, req) {
    await delay(60);
    if (!resolvePlanDecision(planId, req)) throw new ApiRequestError(409, `Plan ${planId} is not awaiting a decision`);
  },
  subscribeSessionEvents(sessionId, since, handlers) {
    const sub: Subscriber = { handlers, last: since, dropped: false };
    const set = subscribers.get(sessionId) ?? new Set();
    set.add(sub);
    subscribers.set(sessionId, set);
    queueMicrotask(() => {
      handlers.onState("open");
      deliver(sub, sessionId);
    });
    return () => set.delete(sub);
  },

  async listReports() {
    await delay();
    return [...db.reports.values()]
      .map(({ detail: { runs: _r, analysis: _a, tickets: _t, ...item } }) => clone(item))
      .sort((a, b) => b.id.localeCompare(a.id));
  },
  async getReport(id) {
    await delay();
    return clone((db.reports.get(id) ?? notFound(`Report ${id}`)).detail);
  },
  async exportReport(id, format) {
    await delay(120);
    const r = db.reports.get(id) ?? notFound(`Report ${id}`);
    return exportReport(r.detail, format);
  },
  async getRunMetrics(testRunId, name) {
    await delay();
    return clone(db.metricSeries(testRunId, name) ?? notFound(`Metric ${name} for ${testRunId}`));
  },
  async getEvidence(ref) {
    await delay(90);
    return clone(db.resolveEvidence(ref) ?? notFound("Evidence"));
  },

  async getLlmSettings() {
    await delay();
    return clone(db.settings);
  },
  async updateLlmSettings(req) {
    await delay(150);
    const st = db.settings;
    if (req.provider) {
      const { id, apiKey, model, baseUrl } = req.provider;
      const p = { ...st.providers[id] };
      if (apiKey) {
        db.secrets.keys[id] = apiKey;
        p.keyMasked = maskKey(apiKey);
      }
      if (model !== undefined) p.model = model || null;
      if (baseUrl !== undefined) p.baseUrl = baseUrl || null;
      p.configured = id === "replay" || (id === "chatgpt" ? st.chatgpt.connected : !!db.secrets.keys[id] && (id !== "custom" || !!p.baseUrl) && !!p.model);
      st.providers = { ...st.providers, [id]: p };
    }
    if (req.active !== undefined) {
      if (req.active && !st.providers[req.active].configured) throw new ApiRequestError(400, "Configure this provider before making it active");
      st.active = req.active;
    }
    return clone(st);
  },
  async testLlmConnection(req) {
    await delay(650);
    const saved = db.settings.providers[req.provider];
    const model = req.model || saved.model;
    if (req.provider === "replay") return { ok: true, detail: "Demo replay ready · 5 scripted scenarios", latencyMs: 3 };
    if (req.provider === "chatgpt")
      return db.settings.chatgpt.connected
        ? { ok: true, detail: `Connected as ${db.settings.chatgpt.account} · ${model ?? "gpt-5.1-codex"}`, latencyMs: 640 }
        : { ok: false, detail: "Not signed in. Use Sign in with ChatGPT first." };
    const key = req.apiKey || db.secrets.keys[req.provider];
    if (!key) return { ok: false, detail: "No API key. Enter a key to test the connection." };
    if (key.length < 12) return { ok: false, detail: "401 Unauthorized: the API key was rejected." };
    if (req.provider === "custom" && !(req.baseUrl || saved.baseUrl)) return { ok: false, detail: "Base URL is required for a custom endpoint." };
    if (!model) return { ok: false, detail: "Choose a model." };
    return { ok: true, detail: `Connection OK · ${model}`, latencyMs: 412 };
  },
  async startChatgptAuth() {
    await delay(200);
    // Mock: no provider window; the "callback" lands after 1.5 s.
    setTimeout(() => {
      db.settings.chatgpt = { connected: true, account: "demo.user@example.com", expiresAt: "2026-11-07T00:00:00Z" };
      db.settings.providers.chatgpt = { ...db.settings.providers.chatgpt, configured: true, model: "gpt-5.1-codex" };
    }, 1500);
    return { url: "" };
  },
  async getChatgptAuthStatus() {
    await delay(50);
    return clone(db.settings.chatgpt);
  },
  async logoutChatgpt() {
    await delay();
    db.settings.chatgpt = { connected: false };
    db.settings.providers.chatgpt = { ...db.settings.providers.chatgpt, configured: false };
    if (db.settings.active === "chatgpt") db.settings.active = null;
  },

  async resetDemo() {
    await delay(300);
    for (const ctrl of activeTurns.values()) ctrl.abort();
    eventLogs.clear();
    db.reset();
    return { ok: true as const, reports: 8, nextReport: "RPT-0009" };
  },

  // The mock has no planted ground truth; it says so instead of inventing an accuracy.
  async getTriageEval() {
    await delay();
    return {
      analysedReports: 0,
      failedRuns: 0,
      categoryCorrect: 0,
      clusterCorrect: 0,
      categoryAccuracy: null,
      clusterAccuracy: null,
      findings: [],
      extraClusters: [],
      rows: [],
      sources: [],
      caveat: "Mock data (npm run dev:mock): there is no planted ground truth in the browser. Start the server for real numbers.",
    };
  },
};
