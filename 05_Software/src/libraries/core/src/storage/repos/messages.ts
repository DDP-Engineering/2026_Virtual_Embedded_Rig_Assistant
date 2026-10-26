import type Database from "better-sqlite3";

export interface MessageRow {
  session_id: string;
  seq: number;
  role: string | null;
  content_json: string;
  created_at: string | null;
}
/** Verbatim message JSON and caller-assigned sequence, without model/runtime coupling. */
export class MessagesRepository {
  constructor(private readonly db: Database.Database) {}
  create(row: MessageRow): MessageRow {
    if (!Number.isSafeInteger(row.seq) || row.seq < 0)
      throw new RangeError("seq must be a nonnegative safe integer");
    this.db
      .prepare(
        "INSERT INTO messages(session_id,seq,role,content_json,created_at) VALUES (@session_id,@seq,@role,@content_json,@created_at)",
      )
      .run(row);
    return this.get(row.session_id, row.seq) as MessageRow;
  }
  get(sessionId: string, seq: number): MessageRow | undefined {
    return this.db.prepare("SELECT * FROM messages WHERE session_id=? AND seq=?").get(sessionId, seq) as
      | MessageRow
      | undefined;
  }
  list(sessionId: string): MessageRow[] {
    return this.db
      .prepare("SELECT * FROM messages WHERE session_id=? ORDER BY seq")
      .all(sessionId) as MessageRow[];
  }
  delete(sessionId: string, seq: number): boolean {
    return (
      this.db.prepare("DELETE FROM messages WHERE session_id=? AND seq=?").run(sessionId, seq).changes > 0
    );
  }
}
