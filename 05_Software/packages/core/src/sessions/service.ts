import type { Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  type ChangeDetail,
  type ChangeSummary,
  changeIdSchema,
  isLiveSessionEvent,
  type PermissionMode,
  permissionModeSchema,
  type SessionEvent,
  type SessionSummary,
  sessionIdSchema,
  veraError,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { parsePatch } from "diff";
import { ulid } from "ulid";
import { type ApprovalDecision, ApprovalGate } from "../agent/approvals.js";
import { validateCitations } from "../agent/citations.js";
import { ContextPolicy } from "../agent/context.js";
import type { PermissionEngine } from "../agent/permissions.js";
import { ReferenceRuntime, toolResult } from "../agent/runtime.js";
import type { AgentRuntime, RuntimeEvent, RuntimeHost, StopReason } from "../agent/types.js";
import { ArtifactStore } from "../artifacts/store.js";
import { type LlmGateway, resolveModelReference } from "../llm/gateway.js";
import type { Clock, WorkerPool } from "../ports.js";
import { MessagesRepository } from "../storage/repos/messages.js";
import { type SessionRow, SessionsRepository } from "../storage/repos/sessions.js";
import { TodosRepository } from "../storage/repos/todos.js";
import { type ChangeRequest, type PreparedChange, recoverChanges } from "../tools/changes.js";
import { createToolContext, type ToolContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
import { WriteQueue } from "../workbench/write-queue.js";
import { SessionHub, type SessionListener } from "./hub.js";
import { timedGateway } from "./timed-gateway.js";

export interface SessionHost {
  db: Database.Database;
  root: string;
  gateway: LlmGateway;
  clock: Clock;
  model(session: string | null): string;
  prompt(mode: PermissionMode): string;
  readOnly?: boolean;
  mode?: PermissionMode;
  maxToolCallsPerTurn?: number;
  noOutputTimeoutMs?: number;
  workers?: WorkerPool;
  registry?: ToolRegistry;
  permissions?: PermissionEngine;
  contextPolicy?: ContextPolicy;
  runtime?: (host: RuntimeHost) => AgentRuntime;
  /** Host ownership is checked before each accepted mutation and event persistence. */
  assertWritable?: () => void;
  scrub?: (text: string) => string;
  disabledTools?: readonly string[];
  writeQueue?: WriteQueue;
}
interface ActiveTurn {
  runtime: AgentRuntime;
  done: Promise<{ stopReason: StopReason }>;
  turnId: string;
  messageId: string;
  failed?: boolean;
}
interface RecordedChange {
  id: number;
  session_id: string;
  path: string;
  created_at: string;
  diff: string;
}
export class SessionService {
  private readonly sessions: SessionsRepository;
  private readonly messages: MessagesRepository;
  private readonly hub: SessionHub;
  private readonly active = new Map<string, ActiveTurn>();
  private readonly last = new Map<string, { stopReason: StopReason }>();
  private readonly contexts = new Map<string, ToolContext>();
  private readonly deleting = new Set<string>();
  private closed = false;
  private readonly writeQueue: WriteQueue;
  private readonly ready: Promise<void>;
  private readonly approvals: ApprovalGate;
  private readonly artifacts: ArtifactStore;
  constructor(private readonly host: SessionHost) {
    this.sessions = new SessionsRepository(host.db);
    this.artifacts = new ArtifactStore(host.root, host.db);
    this.messages = new MessagesRepository(host.db);
    this.hub = new SessionHub(host.db, () => this.now());
    this.approvals = new ApprovalGate({
      db: host.db,
      now: () => this.now(),
      assertWritable: () => this.writable(),
      active: (id, turn) => this.active.get(id)?.turnId === turn && !this.active.get(id)?.failed,
      mode: (id) => this.row(id).permission_mode,
      record: (id, event) => {
        const row = this.row(id);
        const status =
          event.type === "approval.requested"
            ? "awaiting_approval"
            : event.type === "approval.decided"
              ? "running"
              : row.status;
        const mode =
          event.type === "session.updated" ? (event.mode ?? row.permission_mode) : row.permission_mode;
        host.db
          .prepare("UPDATE sessions SET status=?,permission_mode=?,updated_at=? WHERE id=?")
          .run(status, mode, this.now(), id);
        const value = this.hub.record(id, event);
        return () => this.hub.publish(id, value);
      },
    });
    this.writeQueue = host.writeQueue ?? new WriteQueue();
    this.ready = host.readOnly
      ? Promise.resolve()
      : this.writeQueue.run(async () => {
          this.writable();
          await recoverChanges(host.root, host.db, new AbortController().signal, {
            assertWritable: () => this.writable(),
            recorded: (id, event) => {
              const value = this.hub.record(id, event);
              return () => this.hub.publish(id, value);
            },
          });
        });
    // Retain rejection for execution/close while avoiding an unhandled startup promise.
    void this.ready.catch(() => {});
    if (!host.readOnly) {
      this.writable();
      this.recover();
    }
  }
  private now(): string {
    return this.host.clock.now().toISOString();
  }
  /** Hosts await initialization before exposing snapshots or accepting a new turn. */
  async waitReady(): Promise<void> {
    await this.ready;
  }
  private row(id: string): SessionRow {
    if (!sessionIdSchema.safeParse(id).success) throw veraError("INVALID");
    if (this.closed) throw veraError("CONFLICT");
    const row = this.sessions.get(id);
    if (!row) throw veraError("NOT_FOUND");
    return row;
  }
  private writable(): void {
    if (this.closed) throw veraError("CONFLICT");
    if (this.host.readOnly) throw veraError("DENIED");
    this.host.assertWritable?.();
  }
  private idle(id: string): SessionRow {
    const row = this.row(id);
    this.writable();
    if (this.active.has(id) || this.deleting.has(id)) throw veraError("BUSY");
    return row;
  }
  private summary(row: SessionRow): SessionSummary {
    if (!row.created_at || !row.updated_at) throw veraError("INVALID");
    return {
      id: row.id,
      title: row.title,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      modelRef: row.model_ref,
      mode: row.permission_mode,
      status: row.status,
      archived: !!row.archived,
    };
  }
  list(): SessionSummary[] {
    if (this.closed) throw veraError("CONFLICT");
    return this.sessions.list().map((row) => this.summary(row));
  }
  create(modelRef: string | null = null, mode: PermissionMode = this.host.mode ?? "ask"): SessionSummary {
    this.writable();
    permissionModeSchema.parse(mode);
    if (modelRef !== null) resolveModelReference(modelRef);
    const id = `ses_${ulid()}`;
    const now = this.now();
    this.host.db.transaction(() => {
      this.sessions.create({
        id,
        title: "",
        created_at: now,
        updated_at: now,
        model_ref: modelRef,
        permission_mode: mode,
        status: "idle",
        archived: 0,
      });
      this.hub.record(id, { type: "session.updated", title: "", status: "idle", modelRef, mode });
    })();
    return this.summary(this.row(id));
  }
  get(id: string) {
    this.row(id);
    return this.hub.get(id);
  }
  /** Read stored patches independently of subsequent file edits. */
  listChanges(id: string): ChangeSummary[] {
    this.row(id);
    return (
      this.host.db
        .prepare(
          "SELECT id,session_id,path,created_at,diff FROM changes WHERE session_id=? AND status='applied' ORDER BY created_at ASC,id ASC",
        )
        .all(id) as RecordedChange[]
    ).map((row) => this.changeSummary(row));
  }
  getChange(id: number): ChangeDetail {
    if (!changeIdSchema.safeParse(id).success) throw veraError("INVALID");
    if (this.closed) throw veraError("CONFLICT");
    const row = this.host.db
      .prepare("SELECT id,session_id,path,created_at,diff FROM changes WHERE id=? AND status='applied'")
      .get(id) as RecordedChange | undefined;
    if (!row) throw veraError("NOT_FOUND");
    this.row(row.session_id);
    return { ...this.changeSummary(row), diff: row.diff };
  }
  private changeSummary(row: RecordedChange): ChangeSummary {
    const lines = parsePatch(row.diff).flatMap((patch) => patch.hunks.flatMap((hunk) => hunk.lines));
    return {
      changeId: row.id,
      sessionId: row.session_id,
      path: row.path,
      createdAt: row.created_at,
      added: lines.filter((line) => line.startsWith("+")).length,
      removed: lines.filter((line) => line.startsWith("-")).length,
    };
  }
  private update(id: string, event: Extract<SessionEvent, { type: "session.updated" }>): void {
    this.writable();
    const value = this.host.db.transaction(() => {
      const row = this.row(id);
      this.host.db
        .prepare("UPDATE sessions SET title=?,status=?,model_ref=?,permission_mode=?,updated_at=? WHERE id=?")
        .run(
          event.title ?? row.title,
          event.status ?? row.status,
          event.modelRef === undefined ? row.model_ref : event.modelRef,
          event.mode ?? row.permission_mode,
          this.now(),
          id,
        );
      return this.hub.record(id, event);
    })();
    this.hub.publish(id, value);
  }
  rename(id: string, title: string): SessionSummary {
    this.idle(id);
    if (!title.trim() || title.length > 60) throw veraError("INVALID");
    this.update(id, { type: "session.updated", title });
    return this.summary(this.row(id));
  }
  setModel(id: string, modelRef: string | null): SessionSummary {
    this.idle(id);
    if (modelRef !== null) this.host.gateway.capabilities(resolveModelReference(modelRef));
    this.update(id, { type: "session.updated", modelRef });
    return this.summary(this.row(id));
  }
  setMode(id: string, mode: PermissionMode): SessionSummary {
    this.row(id);
    this.writable();
    if (this.deleting.has(id)) throw veraError("BUSY");
    if (!permissionModeSchema.safeParse(mode).success) throw veraError("INVALID");
    this.update(id, { type: "session.updated", mode });
    if (mode === "read-only") this.approvals.abort(id, "mode");
    return this.summary(this.row(id));
  }
  decideApproval(input: ApprovalDecision): void {
    this.approvals.decide(input);
  }
  listArtifacts(id: string) {
    this.row(id);
    return this.artifacts.list(id);
  }
  async openArtifact(id: string) {
    return this.verifiedArtifact(id).artifact;
  }
  verifiedArtifact(id: string) {
    if (this.closed) throw veraError("CONFLICT");
    const result = this.artifacts.verified(id);
    this.row(result.artifact.sessionId);
    if (this.deleting.has(result.artifact.sessionId)) throw veraError("BUSY");
    return result;
  }
  async delete(id: string): Promise<void> {
    this.idle(id);
    this.deleting.add(id);
    try {
      await this.writeQueue.run(async () => {
        this.writable();
        this.artifacts.removeSession(id);
        this.writable();
        this.sessions.delete(id);
      });
      this.hub.clear(id);
      this.contexts.delete(id);
      this.last.delete(id);
    } finally {
      this.deleting.delete(id);
    }
  }
  subscribe(id: string, sinceSeq: number, listener: SessionListener): () => void {
    this.row(id);
    if (!Number.isSafeInteger(sinceSeq) || sinceSeq < 0) throw veraError("INVALID");
    return this.hub.subscribe(id, sinceSeq, listener);
  }
  private transcript(id: string): Message[] {
    return this.messages.list(id).map((row) => JSON.parse(row.content_json) as Message);
  }
  private sync(id: string, transcript: Message[]): void {
    const stored = this.messages.list(id);
    for (let i = stored.length; i < transcript.length; i++) {
      const message = transcript[i];
      if (!message) continue;
      this.messages.create({
        session_id: id,
        seq: i + 1,
        role: message.role,
        content_json: JSON.stringify(message),
        created_at: this.now(),
      });
    }
  }
  private syncToolResults(id: string, transcript: Message[]): void {
    const at = transcript.findLastIndex((m) => m.role === "assistant");
    const assistant = transcript[at];
    if (assistant?.role !== "assistant") return;
    const calls = assistant.content.filter((c): c is ToolCall => c.type === "toolCall");
    let index = this.messages.list(id).length - at - 1;
    for (; index < calls.length; index++) {
      const call = calls[index];
      if (!call) break;
      const row = this.host.db
        .prepare("SELECT result_json FROM tool_calls WHERE id=? AND session_id=? AND status != 'pending'")
        .get(call.id, id) as { result_json: string | null } | undefined;
      if (!row?.result_json) break;
      const result = JSON.parse(row.result_json) as ToolResultMessage;
      if (result.role !== "toolResult") break;
      this.messages.create({
        session_id: id,
        seq: at + index + 2,
        role: "toolResult",
        content_json: row.result_json,
        created_at: this.now(),
      });
    }
  }
  send(id: string, text: string): { turnId: string; messageId: string } {
    const row = this.idle(id);
    if (!text.trim()) throw veraError("INVALID");
    let processing = Promise.resolve();
    let failed = false;
    const durable = async () => {
      await this.ready;
      await processing;
      if (failed) throw veraError("INTERNAL");
      this.writable();
    };
    const model = this.host.model(row.model_ref);
    this.host.gateway.capabilities(model);
    const ctx = this.contexts.get(id) ?? createToolContext(this.host.root, this.host.workers);
    this.contexts.set(id, ctx);
    ctx.todos = {
      db: this.host.db,
      repository: new TodosRepository(this.host.db),
      sessionId: id,
      now: () => this.now(),
      assertWritable: () => {
        this.row(id);
        this.writable();
        if (this.deleting.has(id)) throw veraError("BUSY");
      },
      record: (event) => {
        const value = this.hub.record(id, event);
        return () => this.hub.publish(id, value);
      },
      ...(this.host.scrub ? { scrub: this.host.scrub } : {}),
    };
    ctx.artifacts = {
      store: this.artifacts,
      sessionId: id,
      queue: this.writeQueue,
      now: () => this.now(),
      assertWritable: () => {
        this.row(id);
        this.writable();
        if (this.deleting.has(id)) throw veraError("BUSY");
      },
      record: (event) => {
        const value = this.hub.record(id, event);
        return () => this.hub.publish(id, value);
      },
      ...(this.host.scrub ? { scrub: this.host.scrub } : {}),
    };
    const registry = this.host.registry ?? new ToolRegistry();
    const permissions = this.host.permissions;
    const prepared = new Map<string, PreparedChange>();
    const tools = registry
      .bind(ctx, this.host.disabledTools)
      .filter((tool) => tool.class !== "write" || row.permission_mode !== "read-only")
      .map((tool) => ({
        ...tool,
        execute: async (args: unknown, signal: AbortSignal) => {
          await durable();
          if (tool.class === "write") {
            if (this.row(id).permission_mode === "read-only") throw Error("Tool permission denied.");
            const change = prepared.get(tool.name);
            prepared.delete(tool.name);
            if (!change) throw Error("Prepared change permission is missing.");
            try {
              if (!permissions) this.approvals.consume(change.request);
              const result = await change.apply(signal);
              const text = JSON.stringify(result);
              return this.host.scrub?.(text) ?? text;
            } catch (error) {
              throw Error(
                this.host.scrub?.(error instanceof Error ? error.message : "Tool failed.") ??
                  (error instanceof Error ? error.message : "Tool failed."),
              );
            }
          }
          if (
            permissions &&
            !(await permissions.allow(
              { sessionId: id, mode: this.row(id).permission_mode, tool, args },
              signal,
            ))
          )
            throw Error("Tool permission denied.");
          this.writable();
          try {
            const result = await tool.execute(args, signal);
            return this.host.scrub?.(result) ?? result;
          } catch (error) {
            throw Error(
              this.host.scrub?.(error instanceof Error ? error.message : "Tool failed.") ??
                (error instanceof Error ? error.message : "Tool failed."),
            );
          }
        },
      }));
    const gateway = timedGateway(this.host.gateway, this.host.noOutputTimeoutMs ?? 300000);
    const self = this;
    const runtimeHost: RuntimeHost = {
      gateway: {
        ...gateway,
        stream: async function* (request) {
          await durable();
          request.signal.throwIfAborted();
          yield* gateway.stream({
            ...request,
            sessionId: id,
            tools: request.tools.filter(
              (tool) =>
                self.row(id).permission_mode !== "read-only" ||
                (tool.name !== "write" && tool.name !== "edit"),
            ),
          });
        },
      },
      now: () => this.host.clock.now().getTime(),
      nextId: () => ulid(),
      approve: async (call, signal) => {
        try {
          await durable();
          const tool = tools.find((candidate) => candidate.name === call.name);
          if (tool?.class !== "write" || this.row(id).permission_mode === "read-only") return "denied";
          let grantedRequest: ChangeRequest | undefined;
          const change = await registry.prepare(
            {
              ...ctx,
              change: {
                db: this.host.db,
                queue: this.writeQueue,
                sessionId: id,
                turnId: this.active.get(id)?.turnId ?? "",
                callId: call.id,
                now: () => this.now(),
                assertWritable: () => {
                  this.writable();
                  if (this.row(id).permission_mode === "read-only") throw Error("Tool permission denied.");
                  if (this.host.disabledTools?.includes(call.name)) throw Error("Tool is unavailable.");
                  if (!permissions && grantedRequest) this.approvals.assertGranted(grantedRequest);
                },
                recorded: (event) => {
                  this.writable();
                  const value = this.hub.record(id, event);
                  return () => this.hub.publish(id, value);
                },
              },
            },
            call.name,
            call.arguments,
            signal,
            this.host.disabledTools,
          );
          const exact = JSON.stringify(change.request);
          if (this.host.scrub && this.host.scrub(exact) !== exact)
            throw Error("This change contains protected credential data.");
          const decision = permissions
            ? (await permissions.allow(
                {
                  sessionId: id,
                  mode: this.row(id).permission_mode,
                  tool,
                  args: call.arguments,
                  prepared: change.request,
                },
                signal,
              ))
              ? "approved"
              : "denied"
            : await this.approvals.request(change.request, signal);
          signal.throwIfAborted();
          if (decision !== "approved") return decision;
          grantedRequest = change.request;
          prepared.set(tool.name, change);
          return "approved";
        } catch (error) {
          throw Error(
            this.host.scrub?.(error instanceof Error ? error.message : "Tool failed.") ??
              (error instanceof Error ? error.message : "Tool failed."),
          );
        }
      },
    };
    const runtime = this.host.runtime?.(runtimeHost) ?? new ReferenceRuntime(runtimeHost);
    runtime.start({
      systemPrompt: this.host.prompt(row.permission_mode),
      model,
      tools,
      messages: this.transcript(id),
      contextPolicy: this.host.contextPolicy ?? new ContextPolicy(),
      maxToolCallsPerTurn: this.host.maxToolCallsPerTurn ?? 50,
    });
    const turn: ActiveTurn = {
      runtime,
      done: Promise.resolve({ stopReason: "error" }),
      turnId: "",
      messageId: "",
    };
    this.active.set(id, turn);
    const off = runtime.onEvent((event) => {
      if (event.type === "turn.started") turn.turnId = event.turnId;
      if (event.type === "message.user") turn.messageId = event.messageId;
      const transcript = runtime.messages();
      const next =
        event.type === "message.user"
          ? this.process(id, event, transcript, turn)
          : processing.then(() => this.process(id, event, transcript, turn));
      processing = next.catch(() => {
        failed = true;
        turn.failed = true;
        runtime.abort();
      });
    });
    turn.done = runtime
      .send(text)
      .then(async (result) => {
        await processing;
        if (failed) result = { stopReason: "error" };
        this.last.set(id, result);
        return result;
      })
      .finally(() => {
        off();
        this.active.delete(id);
      });
    return { turnId: turn.turnId, messageId: turn.messageId };
  }
  private async process(
    id: string,
    event: RuntimeEvent,
    transcript: Message[],
    turn: ActiveTurn,
  ): Promise<void> {
    this.writable();
    if (
      event.type === "tool.delta" ||
      event.type === "approval.requested" ||
      event.type === "approval.decided"
    )
      return;
    if (turn.failed && event.type !== "turn.done") return;
    if (turn.failed && event.type === "turn.done") {
      event = { ...event, stopReason: "error" };
      this.hub.emit(id, { type: "error", code: "INTERNAL", messageKey: "errors.INTERNAL", retryable: false });
    }
    let publicEvent: SessionEvent;
    if (event.type === "message.done") {
      this.host.db.transaction(() => this.sync(id, transcript))();
      publicEvent = {
        type: "message.done",
        messageId: event.messageId,
        text: event.text,
        citations: await validateCitations(this.host.root, event.text, transcript, (name) =>
          this.artifacts.exists(id, name),
        ),
      };
    } else if (event.type === "tool.done") {
      publicEvent = {
        type: "tool.done",
        callId: event.callId,
        ok: event.ok,
        summary: event.summary,
        durationMs: event.durationMs,
      };
    } else publicEvent = event;
    if (isLiveSessionEvent(publicEvent)) {
      this.hub.emit(id, publicEvent);
      return;
    }
    const value = this.host.db.transaction(() => {
      if (event.type === "message.user") {
        this.sync(id, transcript);
        if (!this.row(id).title)
          this.host.db.prepare("UPDATE sessions SET title=? WHERE id=?").run(event.text.slice(0, 60), id);
      }
      if (event.type === "tool.started")
        this.host.db
          .prepare(
            "INSERT INTO tool_calls(id,session_id,name,args_json,status,started_at) VALUES (?,?,?,?,?,?)",
          )
          .run(event.callId, id, event.name, JSON.stringify(event.args), "pending", this.now());
      if (event.type === "tool.done")
        this.host.db
          .prepare("UPDATE tool_calls SET result_json=?,status=?,ended_at=? WHERE id=? AND session_id=?")
          .run(
            JSON.stringify(event.message ?? { summary: event.summary }),
            event.ok
              ? "ok"
              : event.aborted
                ? "aborted"
                : event.summary === "The user denied this change."
                  ? "denied"
                  : "error",
            this.now(),
            event.callId,
            id,
          );
      if (event.type === "tool.done") this.syncToolResults(id, transcript);
      if (event.type === "turn.done" && !turn.failed) this.sync(id, transcript);
      const status =
        event.type === "turn.started"
          ? "running"
          : event.type === "turn.done"
            ? event.stopReason === "error"
              ? "error"
              : "idle"
            : this.row(id).status;
      this.host.db
        .prepare("UPDATE sessions SET status=?,updated_at=? WHERE id=?")
        .run(status, this.now(), id);
      return this.hub.record(id, publicEvent);
    })();
    this.hub.publish(id, value);
    if (event.type === "message.user")
      this.update(id, { type: "session.updated", title: this.row(id).title });
  }
  stop(id: string): boolean {
    this.row(id);
    this.writable();
    const turn = this.active.get(id);
    turn?.runtime.abort();
    return !!turn;
  }
  async waitIdle(id: string): Promise<{ stopReason: StopReason } | null> {
    this.row(id);
    return this.active.get(id)?.done ?? this.last.get(id) ?? null;
  }
  async close(): Promise<void> {
    if (this.closed) return;
    for (const turn of this.active.values()) turn.runtime.abort();
    await Promise.allSettled([...this.active.values()].map((turn) => turn.done));
    await this.ready;
    await this.writeQueue.drain();
    this.closed = true;
    this.hub.clear();
    this.contexts.clear();
  }
  private recover(): void {
    for (const row of this.sessions.list()) {
      this.host.db.transaction(() => {
        const undecided = this.host.db
          .prepare("SELECT id FROM approvals WHERE session_id=? AND decision IS NULL")
          .all(row.id) as { id: string }[];
        for (const approval of undecided) {
          this.host.db
            .prepare(
              "UPDATE approvals SET decision='aborted',decided_by='mode',decided_at=? WHERE id=? AND decision IS NULL",
            )
            .run(this.now(), approval.id);
          this.hub.record(row.id, {
            type: "approval.decided",
            approvalId: approval.id,
            decision: "aborted",
            by: "mode",
          });
        }
        const rows = this.messages.list(row.id);
        const repaired: { raw: string; role: string; created: string | null }[] = [];
        let changed = false;
        for (let i = 0; i < rows.length; i++) {
          const stored = rows[i];
          if (!stored) continue;
          const message = JSON.parse(stored.content_json) as Message;
          repaired.push({ raw: stored.content_json, role: message.role, created: stored.created_at });
          if (message.role !== "assistant") continue;
          const calls = message.content.filter((c): c is ToolCall => c.type === "toolCall");
          const answered = new Set<string>();
          while (rows[i + 1]?.role === "toolResult") {
            const result = rows[++i];
            if (!result) break;
            answered.add((JSON.parse(result.content_json) as ToolResultMessage).toolCallId);
            repaired.push({ raw: result.content_json, role: "toolResult", created: result.created_at });
          }
          for (const call of calls)
            if (!answered.has(call.id)) {
              const saved = this.host.db
                .prepare("SELECT result_json FROM tool_calls WHERE session_id=? AND id=?")
                .get(row.id, call.id) as { result_json: string | null } | undefined;
              let result = saved?.result_json
                ? (JSON.parse(saved.result_json) as ToolResultMessage)
                : undefined;
              if (result?.role !== "toolResult")
                result = toolResult(
                  call,
                  "Interrupted: call outcome unresolved.",
                  true,
                  this.host.clock.now().getTime(),
                );
              repaired.push({ raw: JSON.stringify(result), role: "toolResult", created: this.now() });
              changed = true;
            }
        }
        if (changed) {
          this.host.db.prepare("DELETE FROM messages WHERE session_id=?").run(row.id);
          for (const [index, m] of repaired.entries())
            this.messages.create({
              session_id: row.id,
              seq: index + 1,
              role: m.role,
              content_json: m.raw,
              created_at: m.created,
            });
        }
        if (row.status === "running" || row.status === "awaiting_approval") {
          const snapshot = this.hub.get(row.id).snapshot;
          const turnId = snapshot.activeTurnId ?? `interrupted_${row.id}`;
          for (const item of snapshot.items)
            if (item.kind === "tool" && item.status === "running")
              this.hub.record(row.id, {
                type: "tool.done",
                callId: item.id,
                ok: false,
                summary: "Interrupted.",
                durationMs: 0,
              });
          this.host.db
            .prepare(
              "UPDATE tool_calls SET status='aborted',result_json=COALESCE(result_json,?),ended_at=? WHERE session_id=? AND status='pending'",
            )
            .run(JSON.stringify({ error: "Interrupted." }), this.now(), row.id);
          this.hub.record(row.id, { type: "session.interrupted", turnId });
          this.hub.record(row.id, { type: "turn.done", turnId, stopReason: "aborted" });
          this.host.db
            .prepare("UPDATE sessions SET status='idle',updated_at=? WHERE id=?")
            .run(this.now(), row.id);
          this.hub.record(row.id, { type: "session.updated", status: "idle" });
        }
      })();
    }
  }
}
