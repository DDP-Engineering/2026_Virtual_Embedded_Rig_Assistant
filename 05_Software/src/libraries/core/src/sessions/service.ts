import { isAbsolute } from "node:path";
import type { Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import {
  type ChangeDetail,
  type ChangeSummary,
  changeIdSchema,
  isLiveSessionEvent,
  type MaskingArea,
  type PermissionMode,
  type ProgramApproval,
  parseRef,
  permissionModeSchema,
  type SessionEvent,
  type SessionItemDetailField,
  type SessionSummary,
  sessionEventSchema,
  sessionExportSchema,
  sessionIdSchema,
  sessionSearchQuerySchema,
  type ViewerContent,
  veraError,
  veraErrorSchema,
  type WorkbenchRetrieval,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { parsePatch } from "diff";
import { ulid } from "ulid";
import { type ApprovalDecision, ApprovalGate, requestSha256 } from "../agent/approvals.js";
import { issuedLogRefs, validateCitations } from "../agent/citations.js";
import { ContextCompactor } from "../agent/compaction.js";
import { ContextPolicy } from "../agent/context.js";
import type { PermissionEngine } from "../agent/permissions.js";
import { ReferenceRuntime, toolResult } from "../agent/runtime.js";
import type { AgentRuntime, RuntimeEvent, RuntimeHost, StopReason } from "../agent/types.js";
import { ArtifactStore } from "../artifacts/store.js";
import { electricalToolOffered } from "../electrical/tools.js";
import type { EmbeddingPort } from "../knowledge/embedding.js";
import { DocumentKnowledge } from "../knowledge/search.js";
import { DocumentViewer } from "../knowledge/viewer.js";
import { type LlmGateway, resolveModelReference } from "../llm/gateway.js";
import type { PartsSearcher } from "../parts/configured.js";
import { programApproval } from "../plugins/program-request.js";
import { type ProgramHost, ProgramSession } from "../plugins/program-tools.js";
import type { Clock, WorkerPool } from "../ports.js";
import type { SkillCatalog } from "../skills/catalog.js";
import { EventsRepository } from "../storage/repos/events.js";
import { MessagesRepository } from "../storage/repos/messages.js";
import { type SessionRow, SessionsRepository } from "../storage/repos/sessions.js";
import { TodosRepository } from "../storage/repos/todos.js";
import { type ChangeRequest, type PreparedChange, recoverChanges } from "../tools/changes.js";
import { createToolContext, type ToolContext } from "../tools/context.js";
import type { HelpHost } from "../tools/help.js";
import { capToolResult, programToolNames, ToolRegistry } from "../tools/registry.js";
import type { TerminalReader } from "../tools/terminal-read.js";
import type { WebDownloads } from "../web/downloads.js";
import type { WebProvider } from "../web/provider.js";
import { WriteQueue } from "../workbench/write-queue.js";
import { SessionHub, type SessionListener } from "./hub.js";
import { MaskingContextPolicy, maskMessages, maskModelStream, maskValue } from "./masking.js";
import { timedGateway } from "./timed-gateway.js";

export interface SessionHost {
  terminals?: TerminalReader;
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
  embeddings?: EmbeddingPort;
  /** Workbench defaults for search_docs; read on every search so saved settings apply at once. */
  retrieval?: WorkbenchRetrieval | undefined;
  skills?: SkillCatalog | undefined;
  registry?: ToolRegistry;
  web?: WebProvider;
  /** Supplier catalog search; absent hosts never offer parts_search. */
  parts?: PartsSearcher;
  /** VERA's own help; absent hosts never offer the help tool. */
  help?: HelpHost;
  /** Writing kicad-layout candidates over their boards; only hosts that enable it (with the official plugin) offer apply_candidate. */
  applyCandidate?: boolean;
  /** IDs of the loaded electrical/automation plugins: the model tools need one, each plugin tool its own plugin. */
  electricalPlugins?: readonly string[];
  downloads?: WebDownloads;
  permissions?: PermissionEngine;
  contextPolicy?: ContextPolicy;
  runtime?: (host: RuntimeHost) => AgentRuntime;
  /** Host ownership is checked before each accepted mutation and event persistence. */
  assertWritable?: () => void;
  scrub?: (text: string) => string;
  /** Receives swallowed turn failures, already scrubbed. */
  log?: (message: string) => void;
  masking?: (area: MaskingArea) => boolean;
  knownSecrets?: () => readonly string[];
  disabledTools?: readonly string[];
  writeQueue?: WriteQueue;
  /** Plugin programs of the workbench; without it the program tools are not offered. */
  programs?: ProgramHost;
  /** Live workbench grants, supplied only by the host; model arguments never select them. */
  commandPrefixes?: () => readonly string[];
  additionalFolders?: () => readonly string[];
  saveCommandPrefix?: (prefix: string) => Promise<void>;
  pluginBuilder?: import("../plugins/store.js").PluginStore;
  managedRoots?: readonly string[];
}
interface ActiveTurn {
  runtime: AgentRuntime;
  done: Promise<{ stopReason: StopReason }>;
  turnId: string;
  messageId: string;
  failed?: boolean;
  accepting: boolean;
  approvalWait?: string;
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
  private readonly programSessions = new Map<string, ProgramSession>();
  private readonly bypassScopes = new Map<string, AbortController>();
  private readonly reasonings = new Map<string, string | null>();
  private readonly compactors = new Map<string, ContextCompactor>();
  private readonly deleting = new Set<string>();
  private closed = false;
  private closing = false;
  private readonly writeQueue: WriteQueue;
  private readonly ready: Promise<void>;
  private readonly approvals: ApprovalGate;
  private readonly artifacts: ArtifactStore;
  private readonly knowledge: DocumentKnowledge;
  constructor(private readonly host: SessionHost) {
    this.sessions = new SessionsRepository(host.db);
    this.artifacts = new ArtifactStore(host.root, host.db);
    this.knowledge = new DocumentKnowledge(host.root, host.db, host.embeddings, () => host.retrieval);
    this.messages = new MessagesRepository(host.db);
    this.hub = new SessionHub(host.db, () => this.now());
    this.approvals = new ApprovalGate({
      db: host.db,
      now: () => this.now(),
      assertWritable: () => this.writable(),
      active: (id, turn) => this.active.get(id)?.turnId === turn && !this.active.get(id)?.failed,
      mode: (id) => this.row(id).permission_mode,
      commandPrefixes: () => host.commandPrefixes?.() ?? [],
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
  /** Content policy only; authorization continues to use the unconditional host scrubber. */
  maskContent(area: MaskingArea, text: string): string {
    return this.host.masking?.(area) === false ? text : (this.host.scrub?.(text) ?? text);
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
  /** Stored bytes per session of this workbench. */
  sizes(): Record<string, number> {
    if (this.closed) throw veraError("CONFLICT");
    return this.sessions.sizes();
  }
  /** Full durable message search; never uses the derived model request view. */
  search(query: string): SessionSummary[] {
    const parsed = sessionSearchQuerySchema.safeParse(query);
    if (!parsed.success) throw veraError("INVALID");
    const needle = parsed.data.toLowerCase();
    const matches = (text: string) => this.maskContent("agent", text).toLowerCase().includes(needle);
    const events = new EventsRepository(this.host.db);
    // SQLite narrows the rows on the stored text only when that cannot lose a hit: an ASCII needle
    // (other case folding is JavaScript's), and one that cannot match inside or across the
    // "[REDACTED]" that masking puts in place of a stored secret.
    const masked = !!this.host.scrub && this.host.masking?.("agent") !== false;
    const narrow =
      /^[\x20-\x7e]+$/.test(needle) && !(masked && (/[[\]]/.test(needle) || "redacted".includes(needle)));
    return this.list().filter(
      (session) =>
        matches(session.title) || events.messageTexts(session.id, narrow ? needle : undefined).some(matches),
    );
  }
  /** Synchronous read of one workbench-owned durable archival view. */
  exportSession(id: string) {
    const session = this.summary(this.row(id));
    return sessionExportSchema.parse({
      schemaVersion: 1,
      session,
      events: new EventsRepository(this.host.db).list(id).map((row) => ({
        seq: row.seq,
        createdAt: row.created_at,
        event: sessionEventSchema.parse(JSON.parse(row.payload_json)),
      })),
    });
  }
  /** Opt-in New session reuses unused rows; explicit creation keeps allocating. */
  create(
    modelRef: string | null = null,
    mode: PermissionMode = this.host.mode ?? "ask",
    reuseEmpty = false,
  ): SessionSummary {
    this.writable();
    permissionModeSchema.parse(mode);
    if (modelRef !== null) resolveModelReference(modelRef);
    return this.host.db.transaction(() => {
      if (reuseEmpty) {
        const empty = this.host.db
          .prepare(`
          SELECT s.id FROM sessions s
          WHERE s.archived=0 AND s.status='idle'
            AND NOT EXISTS (SELECT 1 FROM messages m WHERE m.session_id=s.id AND m.role='user')
            AND NOT EXISTS (SELECT 1 FROM events e WHERE e.session_id=s.id AND e.type IN ('message.user','message.queued'))
          ORDER BY s.updated_at DESC,s.id DESC LIMIT 1
        `)
          .get() as { id: string } | undefined;
        if (empty) return this.summary(this.row(empty.id));
      }
      const id = `ses_${ulid()}`;
      const now = this.now();
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
      return this.summary(this.row(id));
    })();
  }
  revision(id: string) {
    this.row(id);
    return this.hub.revision(id);
  }
  get(id: string) {
    this.row(id);
    return this.hub.get(id);
  }
  /** The full stored text of one item's field; NOT_FOUND for a session of another workbench. */
  itemDetail(id: string, itemId: string, field: SessionItemDetailField): string {
    this.row(id);
    return this.hub.itemDetail(id, itemId, field);
  }
  /** Revalidate a completed assistant citation; snippet comes only from successful issued results. */
  async openCitation(id: string, messageId: string, ref: string): Promise<ViewerContent> {
    this.row(id);
    const items = this.hub.get(id).snapshot.items;
    const at = items.findIndex((i) => i.kind === "assistant" && i.id === messageId);
    const item = items[at];
    if (item?.kind !== "assistant" || item.streaming || !item.citations.some((c) => c.ref === ref && c.valid))
      throw veraError("NOT_FOUND");
    const calls = new Set(
      items
        .slice(0, at)
        .filter((i) => i.kind === "tool" && i.status === "ok")
        .map((i) => i.id),
    );
    const messages = this.transcript(id).filter(
      (m) => m.role === "toolResult" && !m.isError && calls.has(m.toolCallId),
    );
    const valid = await validateCitations(
      this.host.root,
      `[[${ref}]]`,
      messages,
      (name) => this.artifacts.exists(id, name),
      (r) => this.knowledge.validDocumentRef(r),
    );
    if (!valid[0]?.valid) throw veraError("NOT_FOUND");
    let snippet = "";
    const visit = (value: unknown) => {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") {
        const row = value as Record<string, unknown>;
        if (row.ref === ref && typeof (row.snippet ?? row.text) === "string")
          snippet = String(row.snippet ?? row.text).slice(0, 12000);
        Object.values(row).forEach(visit);
      }
    };
    for (const message of messages)
      if (message.role === "toolResult")
        for (const block of message.content)
          if (block.type === "text") {
            try {
              visit(JSON.parse(block.text));
            } catch {
              /* plain tool text has no issued structured snippet */
            }
          }
    const parsed = parseRef(ref);
    if (parsed?.kind === "artifact") {
      const summary = this.listArtifacts(id).find((a) => a.name === parsed.name);
      if (!summary) throw veraError("NOT_FOUND");
      const artifact = await this.openArtifact(summary.artifactId);
      this.row(id);
      return {
        kind: "artifact",
        path: artifact.name,
        ref,
        snippet,
        content: artifact.content,
        mime: artifact.mime,
      };
    }
    const content = await new DocumentViewer(this.host.root, this.host.db).open(
      ref,
      snippet,
      false,
      issuedLogRefs(messages).has(ref),
    );
    this.row(id);
    return content;
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
    if (event.reasoning !== undefined) this.reasonings.set(id, event.reasoning);
    this.hub.publish(id, value);
  }
  /** Stores a user-only session preference; it never enters the agent transcript. */
  bookmark(id: string, messageId: string, bookmarked: boolean): void {
    const row = this.row(id);
    this.writable();
    if (row.archived) throw veraError("DENIED");
    if (this.deleting.has(id)) throw veraError("BUSY");
    const input = sessionEventSchema.safeParse({ type: "message.bookmarked", messageId, bookmarked });
    if (!input.success) throw veraError("INVALID");
    const value = this.host.db.transaction(() => {
      const user = this.host.db
        .prepare(
          "SELECT 1 FROM events WHERE session_id=? AND type IN ('message.user','message.queued') AND json_extract(payload_json,'$.messageId')=? LIMIT 1",
        )
        .get(id, messageId);
      if (!user) throw veraError("INVALID");
      return this.hub.record(id, input.data);
    })();
    this.hub.publish(id, value);
  }
  rename(id: string, title: string): SessionSummary {
    this.idle(id);
    if (!title.trim() || title.length > 60) throw veraError("INVALID");
    this.update(id, { type: "session.updated", title });
    return this.summary(this.row(id));
  }
  setArchived(id: string, archived: boolean): SessionSummary {
    const row = this.idle(id);
    if (typeof archived !== "boolean") throw veraError("INVALID");
    const value = this.host.db.transaction(() => {
      this.writable();
      this.host.db
        .prepare("UPDATE sessions SET archived=?,updated_at=? WHERE id=?")
        .run(archived ? 1 : 0, this.now(), id);
      return this.hub.record(id, { type: "session.updated", status: row.status });
    })();
    this.hub.publish(id, value);
    return this.summary(this.row(id));
  }
  private savedReasoning(id: string): string | null {
    if (!this.reasonings.has(id))
      this.reasonings.set(id, new EventsRepository(this.host.db).latestReasoning(id));
    return this.reasonings.get(id) ?? null;
  }
  private requestReasoning(id: string, model: string): string | undefined {
    const value = this.savedReasoning(id);
    return value !== null && this.host.gateway.capabilities(model).reasoningOptions?.includes(value)
      ? value
      : undefined;
  }
  async reasoningOptions(id: string) {
    const row = this.row(id);
    const modelRef = this.host.model(row.model_ref);
    await this.host.gateway.prepareModel?.(modelRef);
    const options = [...(this.host.gateway.capabilities(modelRef).reasoningOptions ?? [])];
    return { modelRef, options, selected: this.requestReasoning(id, modelRef) ?? null };
  }
  async setReasoning(id: string, reasoning: string | null, expectedModel: string) {
    this.row(id);
    this.writable();
    if (this.deleting.has(id)) throw veraError("BUSY");
    const current = await this.reasoningOptions(id);
    this.writable();
    if (this.deleting.has(id)) throw veraError("BUSY");
    if (this.host.model(this.row(id).model_ref) !== expectedModel) throw veraError("CONFLICT");
    if (current.modelRef !== expectedModel) throw veraError("CONFLICT");
    if (reasoning !== null && !current.options.includes(reasoning)) throw veraError("INVALID");
    this.update(id, { type: "session.updated", reasoning });
    return { ...current, selected: reasoning };
  }
  setModel(id: string, modelRef: string | null): SessionSummary {
    this.idle(id);
    const caps =
      modelRef !== null ? this.host.gateway.capabilities(resolveModelReference(modelRef)) : undefined;
    const saved = this.savedReasoning(id);
    let options = caps?.reasoningOptions ?? [];
    if (modelRef === null && saved !== null) {
      try {
        options = this.host.gateway.capabilities(this.host.model(null)).reasoningOptions ?? [];
      } catch (error) {
        const parsed = veraErrorSchema.safeParse(error);
        if (!parsed.success || !["INVALID", "NOT_FOUND"].includes(parsed.data.code)) throw error;
      }
    }
    this.update(id, {
      type: "session.updated",
      modelRef,
      ...(saved !== null && !options?.includes(saved) ? { reasoning: null } : {}),
    });
    return this.summary(this.row(id));
  }
  setMode(id: string, mode: PermissionMode): SessionSummary {
    const previousMode = this.row(id).permission_mode;
    this.writable();
    if (this.deleting.has(id)) throw veraError("BUSY");
    if (!permissionModeSchema.safeParse(mode).success) throw veraError("INVALID");
    this.update(id, { type: "session.updated", mode });
    if (mode !== "bypass") {
      this.bypassScopes.get(id)?.abort();
      this.bypassScopes.delete(id);
      if (previousMode === "bypass") this.approvals.abort(id, "mode");
    }
    if (mode === "read-only") this.approvals.abort(id, "mode");
    if (mode === "bypass") this.approvals.approveBypass(id);
    return this.summary(this.row(id));
  }
  decideApproval(input: ApprovalDecision): void {
    this.approvals.decide(input);
  }
  /** Persist an explicit user prefix grant, then approve its still-pending exact command. */
  async allowCommandApproval(input: ApprovalDecision): Promise<void> {
    const prefix = this.approvals.commandPrefix(input);
    if (!this.host.saveCommandPrefix) throw veraError("DENIED");
    await this.host.saveCommandPrefix(prefix);
    // Saving can yield to Stop, mode changes and workbench closure; decide rechecks ownership.
    const { commandPrefix: _prefix, ...decision } = input;
    this.approvals.decide(decision);
  }
  listArtifacts(id: string) {
    this.row(id);
    return this.artifacts.list(id);
  }
  listDownloads() {
    if (!this.host.downloads) return Promise.resolve([]);
    return this.host.downloads.list();
  }
  openDownload(downloadId: string) {
    if (!this.host.downloads) throw veraError("NOT_FOUND");
    return this.host.downloads.open(downloadId);
  }
  locateDownload(downloadId: string) {
    if (!this.host.downloads) throw veraError("NOT_FOUND");
    return this.host.downloads.locate(downloadId);
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
      // Background runs of a deleted session would hold ports no session can stop any more.
      await this.host.programs?.runner.stopSession(id);
      await this.writeQueue.run(async () => {
        this.writable();
        this.artifacts.removeSession(id);
        this.writable();
        this.sessions.delete(id);
      });
      this.hub.clear(id);
      this.contexts.delete(id);
      this.programSessions.delete(id);
      this.bypassScopes.get(id)?.abort();
      this.bypassScopes.delete(id);
      this.compactors.delete(id);
      this.reasonings.delete(id);
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
      const message = maskMessages(transcript.slice(i, i + 1), (text) => this.maskContent("agent", text))[0];
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
    const current = this.row(id);
    this.writable();
    if (!text.trim()) throw veraError("INVALID");
    if (this.closing || this.deleting.has(id)) throw veraError("BUSY");
    const active = this.active.get(id);
    if (active) {
      if (
        !active.accepting ||
        active.failed ||
        active.approvalWait ||
        !active.turnId ||
        current.status === "awaiting_approval" ||
        this.host.db
          .prepare("SELECT 1 FROM approvals WHERE session_id=? AND decision IS NULL LIMIT 1")
          .get(id)
      )
        throw veraError("BUSY");
      const messageId = ulid();
      const value = this.host.db.transaction(() => {
        this.host.db.prepare("UPDATE sessions SET updated_at=? WHERE id=?").run(this.now(), id);
        return this.hub.record(id, {
          type: "message.queued",
          messageId,
          text,
          timestamp: this.host.clock.now().getTime(),
        });
      })();
      this.hub.publish(id, value);
      return { turnId: active.turnId, messageId };
    }
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
    if (!this.host.gateway.prepareModel) this.host.gateway.capabilities(model);
    const ctx = this.contexts.get(id) ?? createToolContext(this.host.root, this.host.workers);
    this.contexts.set(id, ctx);
    ctx.permissionMode = () => this.row(id).permission_mode;
    ctx.additionalFolders = () => this.host.additionalFolders?.() ?? [];
    ctx.bypassSignal = () => {
      if (this.row(id).permission_mode !== "bypass") return AbortSignal.abort();
      let scope = this.bypassScopes.get(id);
      if (!scope) {
        scope = new AbortController();
        this.bypassScopes.set(id, scope);
      }
      return scope.signal;
    };
    ctx.knowledge = this.knowledge;
    if (this.host.terminals) ctx.terminals = this.host.terminals;
    else delete ctx.terminals;
    if (this.host.pluginBuilder) ctx.pluginBuilder = this.host.pluginBuilder;
    if (this.host.managedRoots) ctx.managedRoots = this.host.managedRoots;
    if (this.host.web) ctx.web = this.host.web;
    else delete ctx.web;
    if (this.host.parts) ctx.parts = this.host.parts;
    else delete ctx.parts;
    if (this.host.help) ctx.help = this.host.help;
    else delete ctx.help;
    if (this.host.downloads) ctx.downloads = this.host.downloads;
    else delete ctx.downloads;
    if (this.host.skills) ctx.skills = this.host.skills;
    else delete ctx.skills;
    if (this.host.programs) {
      let programSession = this.programSessions.get(id);
      if (!programSession) {
        programSession = new ProgramSession();
        this.programSessions.set(id, programSession);
      }
      ctx.programs = { host: this.host.programs, session: programSession, sessionId: id };
    } else delete ctx.programs;
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
      scrubContent: (text) => this.maskContent("exports", text),
      ...(this.host.scrub ? { scrub: this.host.scrub } : {}),
    };
    const registry = this.host.registry ?? new ToolRegistry();
    const permissions = this.host.permissions;
    const prepared = new Map<string, PreparedChange>();
    const programPaths = new Map<string, ProgramApproval>();
    const tools = registry
      .bind(ctx, this.host.disabledTools)
      .filter((tool) => tool.class !== "write" || row.permission_mode !== "read-only")
      .filter((tool) => tool.name !== "web_download" || !!this.host.downloads)
      .filter((tool) => tool.name !== "parts_search" || !!this.host.parts)
      .filter((tool) => tool.name !== "help" || !!this.host.help)
      .filter((tool) => tool.name !== "terminal_read" || !!this.host.terminals)
      .filter((tool) => tool.name !== "apply_candidate" || !!this.host.applyCandidate)
      .filter((tool) => electricalToolOffered(tool.name, this.host.electricalPlugins ?? []))
      .filter(
        (tool) => !["plugin_install", "plugin_validate"].includes(tool.name) || !!this.host.pluginBuilder,
      )
      .filter((tool) => !programToolNames.includes(tool.name) || !!this.host.programs)
      .filter((tool) => tool.name !== "run_command" || !!this.host.programs?.shell)
      .map((tool) => ({
        ...tool,
        publish: (args: unknown, output: string) => {
          const authorized = tool.publish?.(args, output) ?? output;
          return this.maskContent("agent", authorized);
        },
        execute: async (args: unknown, signal: AbortSignal) => {
          await durable();
          if (tool.class === "program") {
            const run = prepared.get(tool.name);
            prepared.delete(tool.name);
            if (!run) throw Error("Program run permission is missing.");
            try {
              // The run consumes its approval itself, with the request prepared again right before it starts.
              if (run.request.tool === "plugin_install") this.approvals.consume(run.request);
              const { text } = capToolResult(await run.apply(signal));
              return text;
            } catch (error) {
              throw Error(
                this.host.scrub?.(error instanceof Error ? error.message : "Tool failed.") ??
                  (error instanceof Error ? error.message : "Tool failed."),
              );
            }
          }
          if (tool.class === "write") {
            if (this.row(id).permission_mode === "read-only") throw Error("Tool permission denied.");
            const change = prepared.get(tool.name);
            prepared.delete(tool.name);
            if (!change) throw Error("Prepared change permission is missing.");
            try {
              if (!permissions) this.approvals.consume(change.request);
              const result = await change.apply(signal);
              const text = JSON.stringify(result);
              return text;
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
            return result;
          } catch (error) {
            throw Error(
              this.host.scrub?.(error instanceof Error ? error.message : "Tool failed.") ??
                (error instanceof Error ? error.message : "Tool failed."),
            );
          }
        },
      }));
    const writeToolNames = new Set(tools.filter((tool) => tool.class === "write").map((tool) => tool.name));
    const contextPolicy = new MaskingContextPolicy(this.host.contextPolicy ?? new ContextPolicy(), (text) =>
      this.maskContent("agent", text),
    );
    const gateway = timedGateway(this.host.gateway, this.host.noOutputTimeoutMs ?? 300000);
    const self = this;
    const runtimeHost: RuntimeHost = {
      log: (message) => this.host.log?.(this.host.scrub?.(message) ?? message),
      steering: () =>
        this.hub
          .get(id)
          .snapshot.items.flatMap((item) =>
            item.kind === "user" && item.pending
              ? [{ messageId: item.id, text: item.text, timestamp: item.timestamp ?? 0 }]
              : [],
          ),
      gateway: {
        ...gateway,
        stream: async function* (request) {
          await durable();
          request.signal.throwIfAborted();
          const tools = request.tools.filter(
            (tool) =>
              self.row(id).permission_mode !== "read-only" ||
              (!writeToolNames.has(tool.name) && tool.name !== "run_command"),
          );
          // Settings may change while durable events are published after runtime budgeting.
          const view = contextPolicy.prepare(
            { system: request.system, tools, messages: request.messages },
            gateway.capabilities(request.model, request.maxOutputTokens),
          );
          if (!view.fits) {
            yield { type: "error", error: veraError("CONTEXT_LIMIT"), aborted: false };
            return;
          }
          yield* maskModelStream(
            gateway.stream({
              ...request,
              sessionId: id,
              maskOutput: () => self.host.masking?.("agent") !== false,
              messages: view.messages,
              reasoning: self.requestReasoning(id, request.model) ?? null,
              tools,
            }),
            () => self.host.masking?.("agent") !== false,
            self.host.knownSecrets ?? (() => []),
            (text) => self.host.scrub?.(text) ?? text,
          );
        },
      },
      now: () => this.host.clock.now().getTime(),
      nextId: () => ulid(),
      approve: async (call, signal) => {
        try {
          await durable();
          const tool = tools.find((candidate) => candidate.name === call.name);
          if (
            (tool?.class !== "write" && tool?.class !== "program") ||
            (tool.class === "write" && this.row(id).permission_mode === "read-only")
          )
            return "denied";
          let grantedRequest: ChangeRequest | undefined;
          const change = await registry.prepare(
            {
              ...ctx,
              ...(ctx.programs
                ? {
                    programs: {
                      ...ctx.programs,
                      turnId: this.active.get(id)?.turnId ?? "",
                      callId: call.id,
                      consume: (request) => {
                        this.writable();
                        if (!permissions) this.approvals.consume(request);
                        // A host permission engine allowed one exact request; a different one is not covered.
                        else if (!grantedRequest || requestSha256(request) !== requestSha256(grantedRequest))
                          throw veraError("CONFLICT");
                        if (
                          isAbsolute(request.cwd) ||
                          request.directories?.length ||
                          request.files.some((file) => isAbsolute(file.path))
                        )
                          programPaths.set(request.callId, programApproval(request));
                      },
                    },
                  }
                : {}),
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
                  if ((!permissions || call.name === "plugin_install") && grantedRequest)
                    this.approvals.assertGranted(grantedRequest);
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
            throw Error(
              tool.class === "program"
                ? "This command contains protected credential data."
                : "This change contains protected credential data.",
            );
          const decision =
            permissions && call.name !== "plugin_install"
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
    const contextCompactor = this.compactors.get(id) ?? new ContextCompactor();
    this.compactors.set(id, contextCompactor);
    runtime.start({
      systemPrompt: this.host.prompt(row.permission_mode),
      model,
      tools,
      messages: this.transcript(id),
      contextPolicy,
      contextCompactor,
      maxToolCallsPerTurn: this.host.maxToolCallsPerTurn ?? 50,
    });
    const turn: ActiveTurn = {
      runtime,
      done: Promise.resolve({ stopReason: "error" }),
      turnId: "",
      messageId: "",
      accepting: true,
    };
    this.active.set(id, turn);
    const off = runtime.onEvent((event) => {
      if (event.type === "turn.started") turn.turnId = event.turnId;
      if (event.type === "message.user") turn.messageId = event.messageId;
      if (event.type === "turn.done") turn.accepting = false;
      if (event.type === "approval.requested") turn.approvalWait = event.call.id;
      if (
        (event.type === "approval.decided" || event.type === "tool.done") &&
        turn.approvalWait === event.callId
      )
        delete turn.approvalWait;
      const transcript = runtime.messages();
      const program = event.type === "tool.done" ? programPaths.get(event.callId) : undefined;
      if (event.type === "tool.done") programPaths.delete(event.callId);
      const next =
        event.type === "message.user"
          ? this.process(id, event, transcript, turn)
          : processing.then(() => this.process(id, event, transcript, turn, program));
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
    program?: ProgramApproval,
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
      // One source check per cited file for the whole message, not one per citation.
      const verified = new Map<string, Promise<void>>();
      publicEvent = {
        type: "message.done",
        messageId: event.messageId,
        text: event.text,
        citations: await validateCitations(
          this.host.root,
          event.text,
          transcript,
          (name) => this.artifacts.exists(id, name),
          (ref) => this.knowledge.validDocumentRef(ref, verified),
        ),
      };
    } else if (event.type === "tool.started") {
      publicEvent = { ...event, args: maskValue(event.args, (text) => this.maskContent("agent", text)) };
    } else if (event.type === "tool.done") {
      publicEvent = {
        type: "tool.done",
        callId: event.callId,
        ok: event.ok,
        summary: event.summary,
        durationMs: event.durationMs,
        ...(program ? { program } : {}),
      };
    } else publicEvent = event;
    if (isLiveSessionEvent(publicEvent)) {
      this.hub.emit(id, publicEvent);
      return;
    }
    const value = this.host.db.transaction(() => {
      if (event.type === "message.delivered") this.sync(id, transcript);
      if (event.type === "message.user") {
        this.sync(id, transcript);
        if (!this.row(id).title) {
          // Masked before the cut, so a secret pasted into the chat never reaches the title, not even
          // in part. The cut must not leave half of a surrogate pair at the end.
          const title = this.maskContent("agent", event.text)
            .slice(0, 60)
            .replace(/[\uD800-\uDBFF]$/, "");
          this.host.db.prepare("UPDATE sessions SET title=? WHERE id=?").run(title, id);
        }
      }
      if (event.type === "tool.started")
        this.host.db
          .prepare(
            "INSERT INTO tool_calls(id,session_id,name,args_json,status,started_at) VALUES (?,?,?,?,?,?)",
          )
          .run(
            event.callId,
            id,
            event.name,
            JSON.stringify(maskValue(event.args, (text) => this.maskContent("agent", text))),
            "pending",
            this.now(),
          );
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
    if (turn) turn.accepting = false;
    turn?.runtime.abort();
    // Background program runs of the session end with it; the foreground run ends with the turn's abort.
    void this.host.programs?.runner.stopSession(id);
    return !!turn;
  }
  async waitIdle(id: string): Promise<{ stopReason: StopReason } | null> {
    this.row(id);
    return this.active.get(id)?.done ?? this.last.get(id) ?? null;
  }
  /** Shutdown barriers inspect promises, including final persistence, without UI subscriptions. */
  hasActiveWork(): boolean {
    return (
      this.active.size > 0 ||
      !!this.host.db.prepare("SELECT 1 FROM approvals WHERE decision IS NULL LIMIT 1").get()
    );
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closing = true;
    for (const turn of this.active.values()) turn.accepting = false;
    for (const turn of this.active.values()) turn.runtime.abort();
    for (const scope of this.bypassScopes.values()) scope.abort();
    const downloadsClosed = this.host.downloads?.close();
    await Promise.allSettled([...this.active.values()].map((turn) => turn.done));
    await downloadsClosed;
    await this.ready;
    await this.writeQueue.drain();
    this.closed = true;
    this.hub.clear();
    this.contexts.clear();
    this.bypassScopes.clear();
    this.compactors.clear();
    this.reasonings.clear();
  }
  private recover(): void {
    for (const row of this.sessions.list()) {
      try {
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
          try {
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
          } catch {
            // A damaged message row: the transcript stays as stored, the interrupted turn is still closed.
            changed = false;
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
      } catch {
        // A damaged session stays as stored (its transaction rolled back); the others still load.
      }
    }
  }
}
