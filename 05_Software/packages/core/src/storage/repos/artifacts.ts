import type Database from "better-sqlite3";

export interface ArtifactRow {
  id: string;
  session_id: string;
  name: string;
  mime: "text/markdown" | "text/plain";
  bytes: number;
  sha256: string;
  description: string | null;
  created_at: string;
}
/** Existing schema1 storage; session FK cascades and unique(session_id,name). */
export class ArtifactsRepository {
  constructor(private readonly db: Database.Database) {}
  get(id: string): ArtifactRow | undefined {
    return this.db.prepare("SELECT * FROM artifacts WHERE id=?").get(id) as ArtifactRow | undefined;
  }
  named(sessionId: string, name: string): ArtifactRow | undefined {
    return this.db.prepare("SELECT * FROM artifacts WHERE session_id=? AND name=?").get(sessionId, name) as
      | ArtifactRow
      | undefined;
  }
  list(sessionId: string): ArtifactRow[] {
    return this.db
      .prepare("SELECT * FROM artifacts WHERE session_id=? ORDER BY created_at,id")
      .all(sessionId) as ArtifactRow[];
  }
  save(row: ArtifactRow): void {
    this.db
      .prepare(
        "INSERT INTO artifacts(id,session_id,name,mime,bytes,sha256,description,created_at) VALUES(@id,@session_id,@name,@mime,@bytes,@sha256,@description,@created_at) ON CONFLICT(session_id,name) DO UPDATE SET mime=excluded.mime,bytes=excluded.bytes,sha256=excluded.sha256,description=excluded.description,created_at=excluded.created_at",
      )
      .run(row);
  }
}
