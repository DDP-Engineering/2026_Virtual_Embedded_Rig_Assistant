// Agent runtime (04 §1, §4, §5): sessions bound to one testbench, one running turn per session (409 otherwise),
// stop, plan decisions, and recovery of turns a server restart cut off.
import path from "node:path";
import {
  SERVER_RESTART_MESSAGE,
  sessionStatus,
  type PlanDecisionRequest,
  type PlanItem,
  type SessionDetail,
  type SessionSummary,
  type Skill,
  type StopReason,
} from "@benchpilot/shared";
import type { Catalog } from "../catalog/load.ts";
import type { Config } from "../config.ts";
import type { Db } from "../db/index.ts";
import { nextId } from "../db/repos/counters.ts";
import { decidePlan, getPlan } from "../db/repos/plans.ts";
import type { Pools } from "../db/repos/pools.ts";
import {
  appendMessage,
  createSession,
  getSession,
  lastEventAt,
  lastReportOfSession,
  listMessages,
  listSessions,
  NEW_SESSION_TITLE,
  updateSession,
  type StoredMessage,
} from "../db/repos/sessions.ts";
import { getDoc, getTestbenchConfig } from "../db/repos/testbenches.ts";
import { HttpError } from "../errors.ts";
import { finaliseInterruptedReports, type FinalisedReport } from "../runner/recover.ts";
import type { SettingsFile } from "../llm/credentials.ts";
import type { LlmGateway, ModelRef } from "../llm/gateway.ts";
import { planItems } from "../tools/execution.ts";
import type { ToolContext, ToolRegistry } from "../tools/registry.ts";
import type { ApprovalGate } from "./approval.ts";
import type { SessionHub } from "./hub.ts";
import { buildContext, runTurn } from "./loop.ts";
import { buildPrompt } from "./prompt.ts";
import { writeRecording } from "./record.ts";

export const MAX_PROMPT_CHARS = 8_000;

export interface RuntimeDeps {
  db: Db;
  config: Config;
  catalog: Catalog;
  skills: Skill[];
  /** Live pools; a function so a reset (or data generated after start) is picked up. */
  pools: () => Pools;
  registry: ToolRegistry;
  gateway: LlmGateway;
  settings: SettingsFile;
  hub: SessionHub;
  approvals: ApprovalGate;
}

interface ActiveTurn {
  turnId: string;
  ctrl: AbortController;
  done: Promise<StopReason>;
}

export const titleFrom = (text: string) => {
  const t = text.trim().replace(/\s+/g, " ");
  return t.length > 60 ? `${t.slice(0, 59)}…` : t;
};

export class AgentRuntime {
  private readonly turns = new Map<string, ActiveTurn>();

  constructor(readonly deps: RuntimeDeps) {}

  /** The provider/model new turns use: the active provider in Settings. */
  activeModel(): ModelRef | null {
    const s = this.deps.settings.read();
    if (!s.active) return null;
    if (s.active === "replay") return { provider: "replay", model: "replay" };
    const model = s.providers[s.active].model;
    return model ? { provider: s.active, model } : null;
  }

  // ---------------------------------------------------------------- sessions

  summary(id: string): SessionSummary {
    const s = getSession(this.deps.db, id);
    if (!s) throw new HttpError(404, `Session ${id} not found`);
    return {
      ...s,
      updatedAt: lastEventAt(this.deps.db, id) ?? s.createdAt,
      lastReportId: lastReportOfSession(this.deps.db, id),
      status: sessionStatus(this.deps.hub.state(id)),
    };
  }

  list(): SessionSummary[] {
    return listSessions(this.deps.db).map((s) => this.summary(s.id));
  }

  create(testbenchId: string): SessionSummary {
    if (!getTestbenchConfig(this.deps.db, testbenchId)) throw new HttpError(404, `Testbench ${testbenchId} not found`);
    const m = this.activeModel();
    const s = createSession(this.deps.db, { testbenchId, provider: m?.provider ?? null, model: m?.model ?? null });
    return this.summary(s.id);
  }

  detail(id: string): SessionDetail {
    const session = this.summary(id);
    return { ...this.deps.hub.state(id), session };
  }

  isRunning(id: string): boolean {
    return this.turns.has(id);
  }

  /** Resolves when the session's current turn (if any) ends. */
  async waitIdle(id: string): Promise<StopReason | null> {
    return this.turns.get(id)?.done ?? null;
  }

  // ---------------------------------------------------------------- turns

  /** POST /sessions/:id/messages. `model` overrides the active provider (CLI `--script`). */
  postMessage(sessionId: string, text: string, opts: { model?: ModelRef } = {}): { turnId: string; messageId: string } {
    const session = getSession(this.deps.db, sessionId);
    if (!session) throw new HttpError(404, `Session ${sessionId} not found`);
    const body = text.trim();
    if (!body) throw new HttpError(400, "Message is empty");
    if (body.length > MAX_PROMPT_CHARS) throw new HttpError(400, `Message is longer than ${MAX_PROMPT_CHARS} characters`);
    if (this.turns.has(sessionId)) throw new HttpError(409, "A turn is already running in this session");
    const testbench = getTestbenchConfig(this.deps.db, session.testbenchId);
    if (!testbench) throw new HttpError(409, `Testbench ${session.testbenchId} no longer exists`);

    const db = this.deps.db;
    const messageId = nextId(db, "U");
    const turnId = nextId(db, "T");
    this.deps.hub.recordUserMessage(sessionId, messageId, body);
    appendMessage(db, sessionId, { role: "user", content: body, timestamp: Date.now() });
    if (session.title === NEW_SESSION_TITLE) updateSession(db, sessionId, { title: titleFrom(body) });

    const model = opts.model ?? this.activeModel();
    if (model) updateSession(db, sessionId, { provider: model.provider, model: model.model });
    const ctrl = new AbortController();
    const done = this.execTurn(sessionId, turnId, model, ctrl.signal);
    this.turns.set(sessionId, { turnId, ctrl, done });
    void done.finally(() => {
      if (this.turns.get(sessionId)?.turnId === turnId) this.turns.delete(sessionId);
    });
    return { turnId, messageId };
  }

  stop(sessionId: string): boolean {
    if (!getSession(this.deps.db, sessionId)) throw new HttpError(404, `Session ${sessionId} not found`);
    const t = this.turns.get(sessionId);
    t?.ctrl.abort();
    return Boolean(t);
  }

  stopAll(): Promise<unknown> {
    const all = [...this.turns.values()];
    for (const t of all) t.ctrl.abort();
    return Promise.allSettled(all.map((t) => t.done));
  }

  private async execTurn(sessionId: string, turnId: string, model: ModelRef | null, signal: AbortSignal): Promise<StopReason> {
    const { db, hub } = this.deps;
    // Let the POST handler return (and the client subscribe) before the first event.
    await Promise.resolve();
    hub.emit(sessionId, { type: "turn.started", turnId });
    let stopReason: StopReason = "error";
    try {
      if (!model) {
        const message = "No model is connected. Choose a provider in Settings, or use Demo replay.";
        appendMessage(db, sessionId, { role: "error", message, timestamp: Date.now() });
        hub.emit(sessionId, { type: "error", message });
        return (stopReason = "error");
      }
      const session = getSession(db, sessionId)!;
      const testbench = getTestbenchConfig(db, session.testbenchId)!;
      const tools: ToolContext = {
        db,
        config: this.deps.config,
        catalog: this.deps.catalog,
        skills: this.deps.skills,
        pools: this.deps.pools(),
        testbench,
        sessionId,
        signal,
        emit: (e) => hub.emit(sessionId, e),
        approvals: this.deps.approvals,
        loadedSkills: () => hub.state(sessionId).loadedSkills,
      };
      const system = buildPrompt({
        testbench,
        testbenchMd: getDoc(db, testbench.id, "docs/TESTBENCH.md")?.content ?? "",
        skills: this.deps.skills,
        tests: [...this.deps.catalog.values()],
        today: this.deps.config.dataBaseTime.slice(0, 10),
        latestReportId: lastReportOfSession(db, sessionId),
      });
      stopReason = await runTurn({ db, gateway: this.deps.gateway, registry: this.deps.registry, tools, model, system });
      return stopReason;
    } catch (err) {
      const message = `Unexpected error: ${(err as Error).message}`;
      appendMessage(db, sessionId, { role: "error", message, timestamp: Date.now() });
      hub.emit(sessionId, { type: "error", message });
      return (stopReason = signal.aborted ? "aborted" : "error");
    } finally {
      hub.emit(sessionId, { type: "turn.done", turnId, stopReason });
      if (this.deps.config.recordReplay && model && model.provider !== "replay" && stopReason === "end") {
        try {
          writeRecording(path.join(import.meta.dirname, "../../fixtures/replay/recorded"), `${sessionId}-${turnId}`, buildContext(listMessages(db, sessionId)));
        } catch (err) {
          console.error(`record replay: ${(err as Error).message}`);
        }
      }
    }
  }

  // ---------------------------------------------------------------- plan decisions

  /** POST /plans/:id/decision: validate, persist, emit plan.decided, and wake the waiting propose_test_plan. */
  decidePlan(planId: string, req: PlanDecisionRequest): void {
    const { db } = this.deps;
    const plan = getPlan(db, planId);
    if (!plan) throw new HttpError(404, `Plan ${planId} not found`);
    if (!plan.sessionId) throw new HttpError(409, `Plan ${planId} was not proposed in a session`);
    if (plan.status !== "pending") throw new HttpError(409, `Plan ${planId} is ${plan.status}, not awaiting a decision`);
    if (req.decision !== "approve" && req.decision !== "reject") throw new HttpError(400, "decision must be approve or reject");
    const testbench = getTestbenchConfig(db, plan.testbenchId);
    if (!testbench) throw new HttpError(409, `Testbench ${plan.testbenchId} no longer exists`);

    const fw = req.fw ?? plan.fw;
    let items: PlanItem[] = plan.items;
    if (req.decision === "approve") {
      const chosen = (req.items ?? plan.items).map((i) => ({
        testId: i.testId,
        rationale: i.rationale || plan.items.find((p) => p.testId === i.testId)?.rationale || "Added by the user.",
      }));
      try {
        items = planItems({ catalog: this.deps.catalog, pools: this.deps.pools(), testbench }, fw, chosen);
      } catch (err) {
        throw new HttpError(400, (err as Error).message);
      }
    }
    const edited = req.decision === "approve" && (fw !== plan.fw || items.map((i) => i.testId).join() !== plan.items.map((i) => i.testId).join());
    const comment = req.comment?.trim() || undefined;
    decidePlan(db, planId, { decision: req.decision, ...(req.decision === "approve" ? { items, fw } : {}), ...(comment ? { comment } : {}) });
    this.deps.hub.emit(plan.sessionId, {
      type: "plan.decided",
      planId,
      decision: req.decision,
      ...(req.decision === "approve" ? { items, fw } : {}),
      ...(comment ? { comment } : {}),
    });
    this.deps.approvals.resolve(planId, {
      decision: req.decision,
      items: req.decision === "approve" ? items.map((i) => ({ testId: i.testId, rationale: i.rationale })) : [],
      fw: req.decision === "approve" ? fw : plan.fw,
      ...(comment ? { comment } : {}),
      edited,
    });
  }

  // ---------------------------------------------------------------- recovery

  /** At startup: close turns a restart cut off, and cancel the plans they were waiting on. */
  recoverInterrupted(): FinalisedReport[] {
    const { db, hub } = this.deps;
    // Reports first (P5): their run events land before the restart error, as on the runner's stop path.
    const sessions = new Set(listSessions(db).map((x) => x.id));
    const finalised = finaliseInterruptedReports({
      db,
      catalog: this.deps.catalog,
      runtimeDir: this.deps.config.runtimeDir,
      emit: (sessionId, event) => {
        if (sessionId && sessions.has(sessionId)) hub.emit(sessionId, event);
      },
    });
    for (const s of listSessions(db)) {
      const state = hub.state(s.id);
      if (!state.activeTurnId) continue;
      const message = SERVER_RESTART_MESSAGE;
      appendMessage(db, s.id, { role: "error", message, timestamp: Date.now() } as StoredMessage);
      hub.emit(s.id, { type: "error", message });
      hub.emit(s.id, { type: "turn.done", turnId: state.activeTurnId, stopReason: "error" });
    }
    db.prepare("UPDATE plans SET status = 'rejected', comment = 'cancelled: the server restarted before a decision', decided_at = ? WHERE status = 'pending'").run(
      new Date().toISOString(),
    );
    return finalised;
  }
}
