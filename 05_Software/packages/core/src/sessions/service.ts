import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  isLiveSessionEvent,
  type PermissionMode,
  permissionModeSchema,
  type SessionEvent,
  type SessionSummary,
  sessionIdSchema,
  veraError,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { ulid } from "ulid";
import { validateCitations } from "../agent/citations.js";
import { ContextPolicy } from "../agent/context.js";
import { type PermissionEngine, readPermissions } from "../agent/permissions.js";
import { ReferenceRuntime, toolResult } from "../agent/runtime.js";
import type { AgentRuntime, RuntimeEvent, RuntimeHost, StopReason } from "../agent/types.js";
import { type LlmGateway, resolveModelReference } from "../llm/gateway.js";
import type { Clock, WorkerPool } from "../ports.js";
import { MessagesRepository } from "../storage/repos/messages.js";
import { type SessionRow, SessionsRepository } from "../storage/repos/sessions.js";
import { createToolContext, type ToolContext } from "../tools/context.js";
import { ToolRegistry } from "../tools/registry.js";
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
}
interface ActiveTurn {
  runtime: AgentRuntime;
  done: Promise<{ stopReason: StopReason }>;
  turnId: string;
  messageId: string;
  failed?: boolean;
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
  constructor(private readonly host: SessionHost) {
    this.sessions = new SessionsRepository(host.db);
    this.messages = new MessagesRepository(host.db);
    this.hub = new SessionHub(host.db, () => this.now());
    if (!host.readOnly) {
      this.writable();
      this.recover();
    }
  }
  private now(): string {
    return this.host.clock.now().toISOString();
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
    this.idle(id);
    if (!permissionModeSchema.safeParse(mode).success) throw veraError("INVALID");
    this.update(id, { type: "session.updated", mode });
    return this.summary(this.row(id));
  }
  async delete(id: string): Promise<void> {
    this.idle(id);
    this.deleting.add(id);
    try {
      for (const path of [
        join(this.host.root, ".vera"),
        join(this.host.root, ".vera/artifacts"),
        join(this.host.root, ".vera/artifacts", id),
      ]) {
        try {
          const stat = await lstat(path);
          if (stat.isSymbolicLink() || !stat.isDirectory()) throw veraError("DENIED");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
      this.writable();
      await rm(join(this.host.root, ".vera/artifacts", id), { recursive: true, force: true });
      this.writable();
      this.sessions.delete(id);
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
      await processing;
      if (failed) throw veraError("INTERNAL");
      this.writable();
    };
    const model = this.host.model(row.model_ref);
    this.host.gateway.capabilities(model);
    const ctx = this.contexts.get(id) ?? createToolContext(this.host.root, this.host.workers);
    this.contexts.set(id, ctx);
    const registry = this.host.registry ?? new ToolRegistry();
    const permissions = this.host.permissions ?? readPermissions;
    const tools = registry
      .bind(ctx, this.host.disabledTools)
      .filter((tool) => tool.class === "read")
      .map((tool) => ({
        ...tool,
        execute: async (args: unknown, signal: AbortSignal) => {
          await durable();
          if (!(await permissions.allow({ sessionId: id, mode: row.permission_mode, tool, args }, signal)))
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
    const runtimeHost: RuntimeHost = {
      gateway: {
        ...gateway,
        stream: async function* (request) {
          await durable();
          request.signal.throwIfAborted();
          yield* gateway.stream({ ...request, sessionId: id });
        },
      },
      now: () => this.host.clock.now().getTime(),
      nextId: () => ulid(),
      approve: async () => "denied",
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
        citations: await validateCitations(this.host.root, event.text, transcript),
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
            event.ok ? "ok" : event.aborted ? "aborted" : "error",
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
    this.closed = true;
    this.hub.clear();
    this.contexts.clear();
  }
  private recover(): void {
    for (const row of this.sessions.list()) {
      this.host.db.transaction(() => {
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
