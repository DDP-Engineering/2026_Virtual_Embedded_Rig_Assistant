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
  delete(id: string): boolean {
    return this.db.prepare("DELETE FROM sessions WHERE id=?").run(id).changes > 0;
  }
}
