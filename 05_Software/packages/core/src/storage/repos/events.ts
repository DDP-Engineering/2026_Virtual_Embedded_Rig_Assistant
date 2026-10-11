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
  delete(sessionId: string, seq: number): boolean {
    return this.db.prepare("DELETE FROM events WHERE session_id=? AND seq=?").run(sessionId, seq).changes > 0;
  }
}
