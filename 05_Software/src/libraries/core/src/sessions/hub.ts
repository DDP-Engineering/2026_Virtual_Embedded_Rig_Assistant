import {
  foldSessionEvents,
  isLiveSessionEvent,
  type SessionEvent,
  type SessionItemDetailField,
  sessionEventSchema,
  veraError,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { EventsRepository } from "../storage/repos/events.js";

export type SessionListener = (seq: number | undefined, event: SessionEvent) => void;
type LiveEvent = Extract<SessionEvent, { type: "message.delta" | "reasoning.delta" | "tool.update" }>;
/** Each item's live text a new subscriber receives keeps at most this many trailing characters. */
export const LIVE_REPLAY_CHARS = 500_000;
const liveKey = (event: LiveEvent) =>
  event.type === "tool.update" ? `tool.update/${event.callId}` : `${event.type}/${event.messageId}`;
export class SessionHub {
  private readonly events: EventsRepository;
  private readonly listeners = new Map<string, Set<SessionListener>>();
  private readonly pending = new Map<string, { seq?: number; event: SessionEvent }[]>();
  private readonly publishing = new Set<string>();
  /** The live text of each session's current turn, merged per message, reasoning or tool item. */
  private readonly live = new Map<string, Map<string, LiveEvent>>();
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => string,
    /** Sees every published event once, in order, before its subscribers do. */
    private readonly observe?: (id: string, event: SessionEvent) => void,
  ) {
    this.events = new EventsRepository(db);
  }
  revision(id: string): { seq: number } {
    return this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE session_id=?").get(id) as {
      seq: number;
    };
  }
  /**
   * Rows were validated by `record()` when written, so a read only parses JSON (PERF-05 ruling).
   * A corrupt row surfaces as an invalid snapshot or a throw, both caught by the IPC response check.
   */
  get(id: string) {
    const rows = this.events.list(id);
    return {
      snapshot: foldSessionEvents(rows.map((r) => JSON.parse(r.payload_json) as SessionEvent)),
      seq: rows.at(-1)?.seq ?? 0,
    };
  }
  /**
   * The full text of one item's field from its stored event (PERF-06), read with one query over this
   * session's rows of that event type; the latest matching event wins, as in the fold. NOT_FOUND when
   * the item or the field does not exist.
   */
  itemDetail(id: string, itemId: string, field: SessionItemDetailField): string {
    const [type, key] =
      field === "diff"
        ? ["approval.requested", "$.approvalId"]
        : [field === "preview" ? "tool.done" : "tool.started", "$.callId"];
    const row = this.db
      .prepare(
        `SELECT payload_json FROM events WHERE session_id=? AND type=? AND json_extract(payload_json,'${key}')=? ORDER BY seq DESC LIMIT 1`,
      )
      .get(id, type, itemId) as { payload_json: string } | undefined;
    const event = row ? (JSON.parse(row.payload_json) as Record<string, unknown>) : undefined;
    const value = event?.[field];
    const text = field === "args" && event && "args" in event ? JSON.stringify(value, null, 2) : value;
    if (typeof text !== "string") throw veraError("NOT_FOUND");
    return text;
  }
  record(id: string, input: SessionEvent): { seq?: number; event: SessionEvent } {
    const event = sessionEventSchema.parse(input);
    if (isLiveSessionEvent(event)) return { event };
    // Once the durable record exists, a new subscriber reads it instead of the live text it ends.
    this.settleLive(id, event);
    const last = this.db
      .prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE session_id=?")
      .get(id) as { seq: number };
    const seq = last.seq + 1;
    this.events.create({
      session_id: id,
      seq,
      type: event.type,
      payload_json: JSON.stringify(event),
      created_at: this.now(),
    });
    return { seq, event };
  }
  publish(id: string, value: { seq?: number; event: SessionEvent }): void {
    this.publishBatch(id, [value]);
  }
  /** Queue all committed events before subscribers can emit a later sequence. */
  publishBatch(id: string, values: readonly { seq?: number; event: SessionEvent }[]): void {
    if (values.length === 0) return;
    const pending = this.pending.get(id) ?? [];
    for (const value of values) pending.push(structuredClone(value));
    this.pending.set(id, pending);
    if (this.publishing.has(id)) return;
    this.publishing.add(id);
    try {
      while (pending.length) {
        const next = pending.shift();
        if (!next) break;
        // A durable end settles again when delivered: live text queued behind its record was kept since.
        if (next.seq === undefined && isLiveSessionEvent(next.event))
          this.keepLive(id, next.event as LiveEvent);
        else this.settleLive(id, next.event);
        if (this.observe)
          try {
            this.observe(id, next.event);
          } catch {
            /* observers cannot fail the turn */
          }
        for (const listener of [...(this.listeners.get(id) ?? [])]) {
          if (!this.listeners.get(id)?.has(listener)) continue;
          try {
            listener(next.seq, structuredClone(next.event));
          } catch {
            /* observers cannot fail the turn */
          }
        }
      }
    } finally {
      this.publishing.delete(id);
      this.pending.delete(id);
    }
  }
  emit(id: string, event: SessionEvent): void {
    this.publish(id, this.record(id, event));
  }
  /**
   * Replays the stored events after `sinceSeq`, then the live text of the current turn's unfinished items
   * (one merged event per item), then live delivery. The live text is copied before the listener joins, so
   * an event published while the replay runs arrives once, through the queue.
   */
  subscribe(id: string, sinceSeq: number, listener: SessionListener): () => void {
    const rows = this.events.list(id, sinceSeq);
    const live = [...(this.live.get(id)?.values() ?? [])];
    const queued: { seq?: number; event: SessionEvent }[] = [];
    let replay = true;
    let active = true;
    let deliveredSeq = sinceSeq;
    const notify: SessionListener = (seq, event) => {
      if (!active || (seq !== undefined && seq <= deliveredSeq)) return;
      if (seq !== undefined) deliveredSeq = seq;
      try {
        listener(seq, structuredClone(event));
      } catch {
        /* disconnected observer */
      }
    };
    const deliver: SessionListener = (seq, event) => {
      if (!active) return;
      if (replay) queued.push({ ...(seq === undefined ? {} : { seq }), event });
      else notify(seq, event);
    };
    const listeners = this.listeners.get(id) ?? new Set();
    listeners.add(deliver);
    this.listeners.set(id, listeners);
    const off = () => {
      active = false;
      listeners.delete(deliver);
      if (!listeners.size && this.listeners.get(id) === listeners) this.listeners.delete(id);
    };
    try {
      for (const row of rows) notify(row.seq, sessionEventSchema.parse(JSON.parse(row.payload_json)));
      for (const event of live) notify(undefined, event);
      while (queued.length) {
        const value = queued.shift();
        if (value) notify(value.seq, value.event);
      }
      replay = false;
      return off;
    } catch (error) {
      off();
      throw error;
    }
  }
  clear(id?: string): void {
    if (id) {
      this.listeners.delete(id);
      this.live.delete(id);
    } else {
      this.listeners.clear();
      this.live.clear();
    }
  }
  private keepLive(id: string, event: LiveEvent): void {
    const items = this.live.get(id) ?? new Map<string, LiveEvent>();
    const key = liveKey(event);
    const text = (items.get(key)?.text ?? "") + event.text;
    items.set(key, {
      ...event,
      text: text.length > LIVE_REPLAY_CHARS ? text.slice(-LIVE_REPLAY_CHARS) : text,
    });
    this.live.set(id, items);
  }
  /** A message's text ends at its message.done, a tool's output at its tool.done, all live text with the turn. */
  private settleLive(id: string, event: SessionEvent): void {
    const items = this.live.get(id);
    if (!items) return;
    if (event.type === "turn.done" || event.type === "session.interrupted") items.clear();
    else if (event.type === "message.done") items.delete(`message.delta/${event.messageId}`);
    else if (event.type === "tool.done") items.delete(`tool.update/${event.callId}`);
    if (!items.size) this.live.delete(id);
  }
}
