// sessions, messages (pi-ai shape, verbatim), tool_calls and session_events (01 data model + P3 event log).
import type { ProviderId, Session, SessionEvent } from "@benchpilot/shared";
import type { Db } from "../index.ts";
import { nextId } from "./counters.ts";

interface SessionRow {
  id: string;
  testbench_id: string;
  title: string;
  provider: string | null;
  model: string | null;
  created_at: string;
}

const toSession = (r: SessionRow): Session => ({
  id: r.id,
  testbenchId: r.testbench_id,
  title: r.title,
  provider: (r.provider as ProviderId | null) ?? null,
  model: r.model,
  createdAt: r.created_at,
});

export const NEW_SESSION_TITLE = "New session";

export function createSession(db: Db, s: { testbenchId: string; provider: ProviderId | null; model: string | null }, now = new Date()): Session {
  const id = nextId(db, "S");
  db.prepare("INSERT INTO sessions(id, testbench_id, title, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id,
    s.testbenchId,
    NEW_SESSION_TITLE,
    s.provider,
    s.model,
    now.toISOString(),
  );
  return getSession(db, id)!;
}

export function getSession(db: Db, id: string): Session | null {
  const r = db.prepare("SELECT * FROM sessions WHERE id = ?").get(id) as SessionRow | undefined;
  return r ? toSession(r) : null;
}

export function listSessions(db: Db): Session[] {
  return (db.prepare("SELECT * FROM sessions ORDER BY created_at DESC, id DESC").all() as SessionRow[]).map(toSession);
}

export function updateSession(db: Db, id: string, patch: Partial<Pick<Session, "title" | "provider" | "model">>): void {
  const cur = getSession(db, id);
  if (!cur) return;
  const next = { ...cur, ...patch };
  db.prepare("UPDATE sessions SET title = ?, provider = ?, model = ? WHERE id = ?").run(next.title, next.provider, next.model, id);
}

// ---------------------------------------------------------------- messages

/** Messages as persisted: pi-ai messages, plus `error` markers the LLM never sees. */
export type StoredMessage = { role: string; [k: string]: unknown };

export function appendMessage(db: Db, sessionId: string, message: StoredMessage, now = new Date()): number {
  const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM messages WHERE session_id = ?").get(sessionId) as { s: number }).s;
  const r = db
    .prepare("INSERT INTO messages(session_id, seq, role, content_json, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(sessionId, seq, message.role, JSON.stringify(message), now.toISOString());
  return Number(r.lastInsertRowid);
}

export function listMessages(db: Db, sessionId: string): StoredMessage[] {
  return (db.prepare("SELECT content_json FROM messages WHERE session_id = ? ORDER BY seq").all(sessionId) as { content_json: string }[]).map(
    (r) => JSON.parse(r.content_json) as StoredMessage,
  );
}

// ---------------------------------------------------------------- tool calls

export function startToolCall(db: Db, c: { id: string; sessionId: string; messageId: number | null; name: string; args: unknown }, now = new Date()): void {
  db.prepare(
    "INSERT OR REPLACE INTO tool_calls(id, session_id, message_id, name, args_json, status, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?)",
  ).run(c.id, c.sessionId, c.messageId, c.name, JSON.stringify(c.args ?? {}), now.toISOString());
}

export function finishToolCall(db: Db, id: string, ok: boolean, result: unknown, now = new Date()): void {
  db.prepare("UPDATE tool_calls SET status = ?, result_json = ?, ended_at = ? WHERE id = ?").run(ok ? "ok" : "error", JSON.stringify(result), now.toISOString(), id);
}

// ---------------------------------------------------------------- event log

/** Internal record: the user's message has no SSE event (01), but the snapshot must carry it. */
export interface UserMessageRecord {
  type: "user.message";
  id: string;
  text: string;
}
export type LoggedEvent = SessionEvent | UserMessageRecord;

export function appendEvent(db: Db, sessionId: string, event: LoggedEvent, now = new Date()): number {
  const seq = (db.prepare("SELECT COALESCE(MAX(seq), 0) + 1 AS s FROM session_events WHERE session_id = ?").get(sessionId) as { s: number }).s;
  db.prepare("INSERT INTO session_events(session_id, seq, event_json, created_at) VALUES (?, ?, ?, ?)").run(sessionId, seq, JSON.stringify(event), now.toISOString());
  return seq;
}

export function listEvents(db: Db, sessionId: string, afterSeq = 0): { seq: number; event: LoggedEvent }[] {
  return (
    db.prepare("SELECT seq, event_json FROM session_events WHERE session_id = ? AND seq > ? ORDER BY seq").all(sessionId, afterSeq) as {
      seq: number;
      event_json: string;
    }[]
  ).map((r) => ({ seq: r.seq, event: JSON.parse(r.event_json) as LoggedEvent }));
}

export function lastEventAt(db: Db, sessionId: string): string | null {
  const r = db.prepare("SELECT MAX(created_at) AS t FROM session_events WHERE session_id = ?").get(sessionId) as { t: string | null };
  return r.t;
}

/** Latest report produced by a plan of this session (SessionSummary.lastReportId). */
export function lastReportOfSession(db: Db, sessionId: string): string | null {
  const r = db
    .prepare("SELECT r.id FROM reports r JOIN plans p ON p.id = r.plan_id WHERE p.session_id = ? ORDER BY r.id DESC LIMIT 1")
    .get(sessionId) as { id: string } | undefined;
  return r?.id ?? null;
}
