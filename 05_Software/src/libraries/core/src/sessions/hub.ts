import {
  applySessionEvent,
  emptySessionState,
  isLiveSessionEvent,
  type SessionEvent,
  sessionEventSchema,
} from "@vera/shared";
import type Database from "better-sqlite3";
import { EventsRepository } from "../storage/repos/events.js";

export type SessionListener = (seq: number | undefined, event: SessionEvent) => void;
export class SessionHub {
  private readonly events: EventsRepository;
  private readonly listeners = new Map<string, Set<SessionListener>>();
  private readonly pending = new Map<string, { seq?: number; event: SessionEvent }[]>();
  private readonly publishing = new Set<string>();
  constructor(
    private readonly db: Database.Database,
    private readonly now: () => string,
  ) {
    this.events = new EventsRepository(db);
  }
  revision(id: string): { seq: number } {
    return this.db.prepare("SELECT COALESCE(MAX(seq),0) AS seq FROM events WHERE session_id=?").get(id) as {
      seq: number;
    };
  }
  get(id: string) {
    const rows = this.events.list(id);
    return {
      snapshot: rows
        .map((r) => sessionEventSchema.parse(JSON.parse(r.payload_json)))
        .reduce(applySessionEvent, emptySessionState()),
      seq: rows.at(-1)?.seq ?? 0,
    };
  }
  record(id: string, input: SessionEvent): { seq?: number; event: SessionEvent } {
    const event = sessionEventSchema.parse(input);
    if (isLiveSessionEvent(event)) return { event };
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
    const pending = this.pending.get(id) ?? [];
    pending.push(structuredClone(value));
    this.pending.set(id, pending);
    if (this.publishing.has(id)) return;
    this.publishing.add(id);
    try {
      while (pending.length) {
        const next = pending.shift();
        if (!next) break;
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
  subscribe(id: string, sinceSeq: number, listener: SessionListener): () => void {
    const rows = this.events.list(id, sinceSeq);
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
    for (const row of rows) notify(row.seq, sessionEventSchema.parse(JSON.parse(row.payload_json)));
    while (queued.length) {
      const value = queued.shift();
      if (value) notify(value.seq, value.event);
    }
    replay = false;
    return () => {
      active = false;
      listeners.delete(deliver);
      if (!listeners.size) this.listeners.delete(id);
    };
  }
  clear(id?: string): void {
    if (id) this.listeners.delete(id);
    else this.listeners.clear();
  }
}
