import type Database from "better-sqlite3";

export interface EventRow {
  session_id: string;
  seq: number;
  type: string | null;
  payload_json: string;
  created_at: string | null;
}
/** Persisted-event rows; replay/live semantics belong to the session engine. */
export class EventsRepository {
  constructor(private readonly db: Database.Database) {}
  create(row: EventRow): EventRow {
    if (!Number.isSafeInteger(row.seq) || row.seq < 0)
      throw new RangeError("seq must be a nonnegative safe integer");
    this.db
      .prepare(
        "INSERT INTO events(session_id,seq,type,payload_json,created_at) VALUES (@session_id,@seq,@type,@payload_json,@created_at)",
      )
      .run(row);
    return this.get(row.session_id, row.seq) as EventRow;
  }
  get(sessionId: string, seq: number): EventRow | undefined {
    return this.db.prepare("SELECT * FROM events WHERE session_id=? AND seq=?").get(sessionId, seq) as
      | EventRow
      | undefined;
  }
  list(sessionId: string, afterSeq = -1): EventRow[] {
    return this.db
      .prepare("SELECT * FROM events WHERE session_id=? AND seq>? ORDER BY seq")
      .all(sessionId, afterSeq) as EventRow[];
  }
  latestReasoning(sessionId: string): string | null {
    const row = this.db
      .prepare(
        "SELECT json_extract(payload_json,'$.reasoning') AS reasoning FROM events WHERE session_id=? AND type='session.updated' AND json_type(payload_json,'$.reasoning') IS NOT NULL ORDER BY seq DESC LIMIT 1",
      )
      .get(sessionId) as { reasoning: string | null } | undefined;
    return row?.reasoning ?? null;
  }
  messageTexts(sessionId: string): string[] {
    return (
      this.db
        .prepare(
          "SELECT payload_json FROM events WHERE session_id=? AND type IN ('message.user','message.queued','message.done') ORDER BY seq",
        )
        .all(sessionId) as { payload_json: string }[]
    ).map((row) => (JSON.parse(row.payload_json) as { text: string }).text);
  }
  delete(sessionId: string, seq: number): boolean {
    return this.db.prepare("DELETE FROM events WHERE session_id=? AND seq=?").run(sessionId, seq).changes > 0;
  }
}
