import type { PermissionMode } from "@vera/shared";
import type Database from "better-sqlite3";

export interface SessionRow {
  id: string;
  title: string;
  created_at: string | null;
  updated_at: string | null;
  model_ref: string | null;
  permission_mode: PermissionMode;
  status: "idle" | "running" | "awaiting_approval" | "error";
  archived: 0 | 1;
}
/** Storage only; the session engine owns IDs, titles, status transitions and artifact files. */
export class SessionsRepository {
  constructor(private readonly db: Database.Database) {}
  create(row: SessionRow): SessionRow {
    this.db
      .prepare(
        "INSERT INTO sessions(id,title,created_at,updated_at,model_ref,permission_mode,status,archived) VALUES (@id,@title,@created_at,@updated_at,@model_ref,@permission_mode,@status,@archived)",
      )
      .run(row);
    return this.get(row.id) as SessionRow;
  }
  get(id: string): SessionRow | undefined {
    return this.db.prepare("SELECT * FROM sessions WHERE id=?").get(id) as SessionRow | undefined;
  }
  list(): SessionRow[] {
    return this.db.prepare("SELECT * FROM sessions ORDER BY created_at DESC,id DESC").all() as SessionRow[];
  }
  /** Stored bytes per session: what grows with it, never shrunk by compaction. */
  sizes(): Record<string, number> {
    const rows = this.db
      .prepare(
        `SELECT s.id AS id,
          (SELECT coalesce(sum(length(CAST(payload_json AS BLOB))), 0) FROM events WHERE session_id = s.id)
          + (SELECT coalesce(sum(length(CAST(content_json AS BLOB))), 0) FROM messages WHERE session_id = s.id)
          + (SELECT coalesce(sum(length(CAST(coalesce(args_json, '') AS BLOB))
              + length(CAST(coalesce(result_json, '') AS BLOB))), 0) FROM tool_calls WHERE session_id = s.id)
          + (SELECT coalesce(sum(length(CAST(coalesce(diff, '') AS BLOB))), 0) FROM changes WHERE session_id = s.id)
          + (SELECT coalesce(sum(coalesce(bytes, 0)), 0) FROM artifacts WHERE session_id = s.id) AS bytes
        FROM sessions s`,
      )
      .all() as { id: string; bytes: number }[];
    return Object.fromEntries(rows.map((row) => [row.id, row.bytes]));
  }
  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM sessions WHERE id=?").run(id).changes > 0;
  }
}
