import { stopReasonSchema } from "@vera/shared";
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

  /** Read initial outcomes in one query without replaying child transcripts on every Desktop poll. */
  outcomes() {
    const rows = this.db
      .prepare(
        `SELECT d.child_session_id, d.parent_session_id,
        (SELECT CASE WHEN e.type='session.interrupted' THEN 'interrupted'
          ELSE json_extract(e.payload_json,'$.stopReason') END
         FROM events e WHERE e.session_id=d.child_session_id
          AND e.type IN ('session.interrupted','turn.done')
          AND json_extract(e.payload_json,'$.turnId')=d.turn_id
         ORDER BY e.seq LIMIT 1) AS outcome
       FROM session_delegations d WHERE d.child_session_id IS NOT NULL`,
      )
      .all() as { child_session_id: string; parent_session_id: string; outcome: unknown }[];
    return new Map(
      rows.map(
        ({ child_session_id, parent_session_id, outcome }) =>
          [
            child_session_id,
            {
              parentSessionId: parent_session_id,
              outcome:
                outcome === null || outcome === "interrupted" ? outcome : stopReasonSchema.parse(outcome),
            },
          ] as const,
      ),
    );
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
