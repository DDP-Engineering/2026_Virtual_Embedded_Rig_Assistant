import type Database from "better-sqlite3";

interface DelegationRequestRow {
  child_session_id: string | null;
  request_hash: string;
  turn_id: string;
  message_id: string;
}

export interface DelegationChildRow extends DelegationRequestRow {
  child_session_id: string;
  parent_session_id: string;
}

/** Durable relationships and request identities owned by a single workbench database. */
export class DelegationsRepository {
  constructor(private readonly db: Database.Database) {}

  create(requestId: string, row: DelegationChildRow): void {
    this.db
      .prepare(
        `INSERT INTO session_delegations
          (parent_session_id, request_id, request_hash, child_session_id, turn_id, message_id)
          VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.parent_session_id,
        requestId,
        row.request_hash,
        row.child_session_id,
        row.turn_id,
        row.message_id,
      );
  }

  request(parentId: string, requestId: string): DelegationRequestRow | undefined {
    return this.db
      .prepare("SELECT * FROM session_delegations WHERE parent_session_id=? AND request_id=?")
      .get(parentId, requestId) as DelegationRequestRow | undefined;
  }

  child(childId: string): DelegationChildRow | undefined {
    return this.db.prepare("SELECT * FROM session_delegations WHERE child_session_id=?").get(childId) as
      | DelegationChildRow
      | undefined;
  }

  children(parentId: string): DelegationChildRow[] {
    return this.db
      .prepare(
        `SELECT d.* FROM session_delegations d JOIN sessions s ON s.id=d.child_session_id
         WHERE d.parent_session_id=? ORDER BY s.created_at DESC,s.id DESC`,
      )
      .all(parentId) as DelegationChildRow[];
  }

  hasChildren(parentId: string): boolean {
    return !!this.db
      .prepare(
        "SELECT 1 FROM session_delegations WHERE parent_session_id=? AND child_session_id IS NOT NULL LIMIT 1",
      )
      .get(parentId);
  }

  forgetDeletedChildren(parentId: string): void {
    this.db
      .prepare("DELETE FROM session_delegations WHERE parent_session_id=? AND child_session_id IS NULL")
      .run(parentId);
  }
}
