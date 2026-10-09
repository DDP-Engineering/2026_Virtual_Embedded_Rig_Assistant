// Session event hub: every SSE event is persisted (session_events), applied to a cached SessionState with the
// shared reducer, then fanned out to subscribers. GET /sessions/:id returns that state, so a snapshot equals the
// fold of the stream by construction (P4a decision; contract test in api/sessions.spec.ts).
import { appendUserMessage, applySessionEvent, emptySessionState, type SessionEvent, type SessionState } from "@benchpilot/shared";
import type { Db } from "../db/index.ts";
import { appendEvent, listEvents, type LoggedEvent } from "../db/repos/sessions.ts";

export type EventListener = (seq: number, event: SessionEvent) => void;

export function foldEvents(events: LoggedEvent[]): SessionState {
  return events.reduce<SessionState>((s, e) => (e.type === "user.message" ? appendUserMessage(s, e.id, e.text) : applySessionEvent(s, e)), emptySessionState());
}

export class SessionHub {
  private readonly states = new Map<string, SessionState>();
  private readonly listeners = new Map<string, Set<EventListener>>();
  private readonly resetListeners = new Set<() => void>();

  constructor(private readonly db: Db) {}

  state(sessionId: string): SessionState {
    let s = this.states.get(sessionId);
    if (!s) {
      s = foldEvents(listEvents(this.db, sessionId).map((r) => r.event));
      this.states.set(sessionId, s);
    }
    return s;
  }

  emit(sessionId: string, event: SessionEvent): void {
    const seq = appendEvent(this.db, sessionId, event);
    this.states.set(sessionId, applySessionEvent(this.state(sessionId), event));
    for (const fn of this.listeners.get(sessionId) ?? []) {
      try {
        fn(seq, event);
      } catch {
        // A broken subscriber (closed socket) must not break the turn.
      }
    }
  }

  /** The user's message: logged for snapshots, not streamed (01: the client appends it optimistically). */
  recordUserMessage(sessionId: string, id: string, text: string): void {
    appendEvent(this.db, sessionId, { type: "user.message", id, text });
    this.states.set(sessionId, appendUserMessage(this.state(sessionId), id, text));
  }

  subscribe(sessionId: string, fn: EventListener): () => void {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(fn);
    this.listeners.set(sessionId, set);
    return () => set.delete(fn);
  }

  /** Streamed events after `seq` (SSE Last-Event-ID resume). User records are skipped: they are not SSE events. */
  since(sessionId: string, seq: number): { seq: number; event: SessionEvent }[] {
    return listEvents(this.db, sessionId, seq).filter((r): r is { seq: number; event: SessionEvent } => r.event.type !== "user.message");
  }

  lastSeq(sessionId: string): number {
    return (this.db.prepare("SELECT COALESCE(MAX(seq), 0) AS s FROM session_events WHERE session_id = ?").get(sessionId) as { s: number }).s;
  }

  /** Called when the DB is reset; open SSE streams end so they never mix old and new sessions with the same id. */
  onReset(fn: () => void): () => void {
    this.resetListeners.add(fn);
    return () => this.resetListeners.delete(fn);
  }

  /** After a DB reset. */
  clear(): void {
    this.states.clear();
    for (const fn of [...this.resetListeners]) fn();
    this.listeners.clear();
  }
}
