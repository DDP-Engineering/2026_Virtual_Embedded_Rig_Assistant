import { z } from "zod";
import { downloadApprovalSchema, validDownloadApproval } from "./downloads.js";
import { type SessionEvent, usageEventSchema } from "./events.js";
import { programApprovalSchema, validProgramApproval } from "./program-rules.js";
import { reasoningOptionSchema } from "./provider-discovery.js";
import {
  messageImagesSchema,
  permissionModeSchema,
  sessionStatusSchema,
  stopReasonSchema,
  todoItemsSchema,
} from "./session.js";

const assistant = z.strictObject({
  kind: z.literal("assistant"),
  id: z.string(),
  turnId: z.string().nullable(),
  text: z.string(),
  streaming: z.boolean(),
  replyToMessageIds: z.array(z.string()).optional(),
  citations: z.array(z.strictObject({ ref: z.string(), valid: z.boolean() })),
});
const tool = z.strictObject({
  kind: z.literal("tool"),
  id: z.string(),
  turnId: z.string().nullable(),
  name: z.string(),
  args: z.unknown(),
  status: z.enum(["running", "ok", "error"]),
  summary: z.string().optional(),
  preview: z.string().optional(),
  durationMs: z.number().optional(),
  /** Full UTF-8 sizes of the fields cut for the renderer (PERF-06); `args` then holds a JSON prefix. */
  truncated: z
    .strictObject({
      preview: z.number().int().nonnegative().optional(),
      args: z.number().int().nonnegative().optional(),
    })
    .optional(),
});
export const sessionStateSchema = z.strictObject({
  title: z.string(),
  status: sessionStatusSchema,
  modelRef: z.string().nullable(),
  reasoning: reasoningOptionSchema.nullable().optional(),
  mode: permissionModeSchema,
  activeTurnId: z.string().nullable(),
  interrupted: z.array(z.string()),
  bookmarkedMessageIds: z.array(z.string()),
  items: z.array(
    z.discriminatedUnion("kind", [
      z.strictObject({
        kind: z.literal("user"),
        id: z.string(),
        text: z.string(),
        images: messageImagesSchema.optional(),
        pending: z.boolean().optional(),
        timestamp: z.number().int().nonnegative().optional(),
        usage: z
          .strictObject({
            inputTokens: z.number().int().nonnegative().optional(),
            outputTokens: z.number().int().nonnegative().optional(),
            contextTokens: z.number().int().nonnegative().optional(),
            contextWindow: z.number().int().positive().optional(),
            estimated: z.boolean().optional(),
            shared: z.boolean().optional(),
          })
          .optional(),
      }),
      assistant,
      tool,
      z.strictObject({
        kind: z.literal("error"),
        id: z.string(),
        code: z.string(),
        messageKey: z.string(),
        params: z.record(z.string(), z.union([z.string(), z.number().finite()])).optional(),
        retryable: z.boolean(),
      }),
    ]),
  ),
  turns: z.array(
    z.strictObject({ turnId: z.string(), steps: z.number(), stopReason: stopReasonSchema.nullable() }),
  ),
  approvals: z.array(
    z
      .strictObject({
        approvalId: z.string(),
        callId: z.string(),
        requestSha256: z.string(),
        tool: z.enum([
          "write",
          "edit",
          "web_download",
          "run_program",
          "run_command",
          "plugin_install",
          "apply_candidate",
          "electrical_model_change",
          "electrical_network",
          "protection_coordination",
          "motor_drives",
          "power_quality",
          "lighting_design",
        ]),
        path: z.string(),
        diff: z.string(),
        bytes: z.number(),
        download: downloadApprovalSchema.optional(),
        program: programApprovalSchema.optional(),
        truncated: z.strictObject({ diff: z.number().int().nonnegative() }).optional(),
        decision: z.enum(["approved", "denied", "aborted"]).nullable(),
        by: z.enum(["user", "mode"]).optional(),
      })
      .refine(validDownloadApproval)
      .refine(validProgramApproval),
  ),
  changes: z.array(
    z.strictObject({ changeId: z.number(), path: z.string(), added: z.number(), removed: z.number() }),
  ),
  artifacts: z.array(z.strictObject({ artifactId: z.string(), name: z.string(), bytes: z.number() })),
  todos: todoItemsSchema,
  usage: usageEventSchema.omit({ type: true }),
});
export type SessionState = z.infer<typeof sessionStateSchema>;
export function emptySessionState(): SessionState {
  return {
    title: "",
    status: "idle",
    modelRef: null,
    mode: "ask",
    activeTurnId: null,
    interrupted: [],
    bookmarkedMessageIds: [],
    items: [],
    turns: [],
    approvals: [],
    changes: [],
    artifacts: [],
    todos: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}
type SessionItem = SessionState["items"][number];
type Collection =
  | "interrupted"
  | "bookmarkedMessageIds"
  | "items"
  | "turns"
  | "approvals"
  | "changes"
  | "artifacts";
type Records = "items" | "turns" | "approvals";

/**
 * Write access to one state for the shared reducer. A fold owns the whole state and mutates it in
 * place, with an id index over `items`; a live update (`copyOnWrite`) copies a collection and an
 * element the first time it writes to them, so everything the event does not touch keeps its identity.
 */
class Draft {
  private readonly fresh = new Set<unknown>();
  private ids: Map<string, number> | undefined;
  private errors: number | undefined;
  private admitted: number | undefined;
  constructor(
    readonly s: SessionState,
    private readonly copyOnWrite: boolean,
  ) {}
  /** The collection, safe to push to and to replace elements of. */
  list<K extends Collection>(key: K): SessionState[K] {
    if (this.copyOnWrite && !this.fresh.has(this.s[key])) {
      this.s[key] = [...this.s[key]] as SessionState[K];
      this.fresh.add(this.s[key]);
    }
    return this.s[key];
  }
  /** Element `index` of the collection, safe to mutate. */
  at<K extends Records>(key: K, index: number): SessionState[K][number] {
    const list = this.list(key) as SessionState[K][number][];
    let value = list[index] as SessionState[K][number];
    if (this.copyOnWrite && !this.fresh.has(value)) {
      value = { ...value };
      list[index] = value;
      this.fresh.add(value);
    }
    return value;
  }
  /** Index of the first item with this id (and kind), or -1. */
  find(id: string, kind?: SessionItem["kind"]): number {
    const items = this.s.items;
    if (!this.copyOnWrite) {
      if (!this.ids) {
        const ids = new Map<string, number>();
        items.forEach((item, index) => {
          if (!ids.has(item.id)) ids.set(item.id, index);
        });
        this.ids = ids;
      }
      const first = this.ids.get(id);
      if (first === undefined) return -1;
      if (!kind || items[first]?.kind === kind) return first;
    }
    return items.findIndex((i) => i.id === id && (!kind || i.kind === kind));
  }
  push(value: SessionItem): void {
    const items = this.list("items");
    if (this.ids && !this.ids.has(value.id)) this.ids.set(value.id, items.length);
    if (value.kind === "error" && this.errors !== undefined) this.errors++;
    if (value.kind === "user" && !value.pending) this.admitted = items.length;
    items.push(value);
    this.fresh.add(value);
  }
  admit(index: number): void {
    if (this.admitted !== undefined) this.admitted = Math.max(this.admitted, index);
  }
  /** Cached across a fold so usage-absent request ownership keeps linear replay cost. */
  admittedUser(): string | null {
    if (this.admitted === undefined)
      this.admitted = this.s.items.findLastIndex((item) => item.kind === "user" && !item.pending);
    return this.s.items[this.admitted]?.id ?? null;
  }
  replaceItems(items: SessionItem[]): void {
    this.s.items = items;
    this.admitted = undefined;
    this.fresh.add(items);
    this.ids = undefined;
  }
  /** Number of error items, counted once per fold and kept current by `push`. */
  errorCount(): number {
    const count = this.errors ?? this.s.items.filter((i) => i.kind === "error").length;
    if (!this.copyOnWrite) this.errors = count;
    return count;
  }
}

/** Request ownership is frozen when a reply starts, before later queued messages are admitted. */
function replyOwners(d: Draft): string[] {
  if (d.s.usage.promptIds)
    return d.s.usage.promptIds.filter((id) => {
      const item = d.s.items[d.find(id, "user")];
      return item?.kind === "user" && !item.pending;
    });
  const id = d.admittedUser();
  return id === null ? [] : [id];
}

/** The single event switch shared by the fold and the live update. It never writes to `event`. */
function reduce(d: Draft, event: SessionEvent): void {
  const s = d.s;
  const turnId = s.activeTurnId;
  switch (event.type) {
    case "session.updated": {
      const { type: _, ...fields } = event;
      Object.assign(s, fields);
      break;
    }
    case "session.interrupted":
      d.list("interrupted").push(event.turnId);
      break;
    case "turn.started":
      s.activeTurnId = event.turnId;
      s.usage = { inputTokens: 0, outputTokens: 0 };
      s.status = "running";
      d.list("turns").push({ turnId: event.turnId, steps: 0, stopReason: null });
      break;
    case "turn.done": {
      s.activeTurnId = null;
      s.status = event.stopReason === "error" ? "error" : "idle";
      for (let i = 0; i < s.turns.length; i++)
        if (s.turns[i]?.turnId === event.turnId) d.at("turns", i).stopReason = event.stopReason;
      // Unfinalized live text is dropped; every remaining assistant item is therefore finalized.
      const kept = s.items.filter((i) => i.kind !== "assistant" || !i.streaming);
      if (kept.length !== s.items.length) d.replaceItems(kept);
      for (let i = 0; i < s.items.length; i++) {
        const current = s.items[i];
        if (current?.kind !== "tool" || current.status !== "running") continue;
        const tool = d.at("items", i) as typeof current;
        tool.status = "error";
        tool.summary = "Interrupted.";
      }
      break;
    }
    case "message.user":
      if (d.find(event.messageId) < 0)
        d.push({
          kind: "user",
          id: event.messageId,
          text: event.text,
          ...(event.images && { images: event.images }),
        });
      break;
    case "message.bookmarked": {
      if (d.find(event.messageId, "user") < 0) break;
      const index = s.bookmarkedMessageIds.indexOf(event.messageId);
      if (event.bookmarked && index < 0) d.list("bookmarkedMessageIds").push(event.messageId);
      else if (!event.bookmarked && index >= 0) d.list("bookmarkedMessageIds").splice(index, 1);
      break;
    }
    case "message.queued":
      if (d.find(event.messageId) < 0)
        d.push({
          kind: "user",
          id: event.messageId,
          text: event.text,
          ...(event.images && { images: event.images }),
          pending: true,
          timestamp: event.timestamp,
        });
      break;
    case "message.delivered":
      for (let i = 0; i < s.items.length; i++) {
        const current = s.items[i];
        if (current?.kind === "user" && "pending" in current && event.messageIds.includes(current.id)) {
          delete (d.at("items", i) as typeof current).pending;
          d.admit(i);
        }
      }
      break;
    case "reasoning.delta":
      break; // ephemeral reasoning has no durable projection
    case "message.delta": {
      const index = d.find(event.messageId, "assistant");
      if (index < 0)
        d.push({
          kind: "assistant",
          id: event.messageId,
          turnId,
          text: event.text,
          streaming: true,
          replyToMessageIds: replyOwners(d),
          citations: [],
        });
      else (d.at("items", index) as Extract<SessionItem, { kind: "assistant" }>).text += event.text;
      break;
    }
    case "message.done": {
      const index = d.find(event.messageId, "assistant");
      const previous = s.items[index];
      const done: SessionItem = {
        kind: "assistant",
        id: event.messageId,
        turnId,
        text: event.text,
        streaming: false,
        replyToMessageIds: previous?.kind === "assistant" ? previous.replyToMessageIds : replyOwners(d),
        citations: event.citations,
      };
      if (index < 0) d.push(done);
      else d.list("items")[index] = done;
      break;
    }
    case "tool.started":
      d.push({
        kind: "tool",
        id: event.callId,
        turnId,
        name: event.name,
        args: event.args,
        status: "running",
        ...(event.truncated ? { truncated: { ...event.truncated } } : {}),
      });
      for (let i = 0; i < s.turns.length; i++) if (s.turns[i]?.turnId === turnId) d.at("turns", i).steps++;
      break;
    case "tool.update":
      break;
    case "tool.done": {
      const index = d.find(event.callId, "tool");
      if (index < 0) break;
      const tool = d.at("items", index) as Extract<SessionItem, { kind: "tool" }>;
      tool.status = event.ok ? "ok" : "error";
      tool.summary = event.summary;
      tool.durationMs = event.durationMs;
      if (event.preview !== undefined) tool.preview = event.preview;
      if (event.truncated) tool.truncated = { ...tool.truncated, ...event.truncated };
      break;
    }
    case "approval.requested": {
      const { type: _, ...a } = event;
      d.list("approvals").push({ ...a, decision: null });
      s.status = "awaiting_approval";
      break;
    }
    case "approval.decided": {
      const index = s.approvals.findIndex((a) => a.approvalId === event.approvalId);
      if (index >= 0) {
        const a = d.at("approvals", index);
        a.decision = event.decision;
        a.by = event.by;
      }
      s.status = s.activeTurnId ? "running" : "idle";
      break;
    }
    case "change.recorded": {
      const { type: _, ...c } = event;
      d.list("changes").push(c);
      break;
    }
    case "artifact.saved": {
      const { type: _, ...a } = event;
      d.list("artifacts").push(a);
      break;
    }
    case "todo.updated":
      s.todos = event.items;
      break;
    case "usage.updated": {
      const input = Math.max(0, event.inputTokens - s.usage.inputTokens);
      const output = Math.max(0, event.outputTokens - s.usage.outputTokens);
      const owners = new Set(event.promptIds);
      for (let i = 0; owners.size && i < s.items.length; i++) {
        const current = s.items[i];
        if (current?.kind !== "user" || current.pending || !owners.has(current.id)) continue;
        const user = d.at("items", i) as typeof current;
        const usage = { ...user.usage };
        if (input || output) {
          usage.inputTokens = (usage.inputTokens ?? 0) + input;
          usage.outputTokens = (usage.outputTokens ?? 0) + output;
        }
        if (
          usage.contextTokens === undefined &&
          event.contextTokens !== undefined &&
          event.compactionStatus !== "running"
        ) {
          usage.contextTokens = event.requestViewTokens ?? event.contextTokens;
          if (event.contextWindow) usage.contextWindow = event.contextWindow;
          usage.estimated = event.estimated ?? true;
        }
        if (owners.size > 1) usage.shared = true;
        user.usage = usage;
      }
      const { type: _, ...u } = event;
      s.usage = { ...s.usage, ...u };
      break;
    }
    case "error": {
      const { type: _, ...e } = event;
      d.push({ kind: "error", id: `error-${d.errorCount()}`, ...e });
      break;
    }
  }
}

/**
 * Folds stored events into one snapshot in linear time, mutating a single fresh state in place.
 * The fold never writes to the events, but the snapshot keeps references to their nested data
 * (tool args, citations, todos, approval details): pass events the caller owns, such as freshly
 * parsed rows (JSON-derived, so no field is explicitly `undefined`), and treat the snapshot as
 * read-only while the events are still in use.
 * Terminal messages are authoritative even when deltas were missed.
 */
export function foldSessionEvents(events: Iterable<SessionEvent>): SessionState {
  const draft = new Draft(emptySessionState(), false);
  for (const event of events) reduce(draft, event);
  return draft.s;
}

/**
 * Pure live projection for the renderer: returns a new state that shares every collection and item
 * the event does not change with `state`, and never mutates `state`. The event is detached first,
 * so the result does not alias the caller's event objects.
 */
export function applySessionEvent(state: SessionState, input: SessionEvent): SessionState {
  const draft = new Draft({ ...state }, true);
  reduce(draft, JSON.parse(JSON.stringify(input)));
  return draft.s;
}
