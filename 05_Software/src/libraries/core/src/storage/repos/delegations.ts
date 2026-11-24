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

  mutation(parentId: string, requestId: string) {
    return this.db
      .prepare(
        "SELECT request_hash,result_json FROM session_delegation_requests WHERE parent_session_id=? AND request_id=?",
      )
      .get(parentId, requestId) as { request_hash: string; result_json: string } | undefined;
  }

  recordMutation(parentId: string, requestId: string, hash: string, result: object): void {
    this.db
      .prepare("INSERT INTO session_delegation_requests VALUES (?,?,?,?)")
      .run(parentId, requestId, hash, JSON.stringify(result));
  }

  /** Resolve model/reasoning changes without scanning unrelated conversation events. */
  configurationRevision(id: string): number {
    const row = this.db
      .prepare(`SELECT seq FROM events WHERE session_id=? AND type='session.updated'
        AND (json_type(payload_json,'$.modelRef') IS NOT NULL OR json_type(payload_json,'$.reasoning') IS NOT NULL)
        ORDER BY seq DESC LIMIT 1`)
      .get(id) as { seq: number } | undefined;
    return row?.seq ?? 0;
  }

  start(id: string, turnId: string) {
    return this.db
      .prepare(`SELECT json_extract(payload_json,'$.messageId') AS messageId FROM events
        WHERE session_id=? AND type='turn.started' AND json_extract(payload_json,'$.turnId')=?`)
      .get(id, turnId) as { messageId: string | null } | undefined;
  }

  /** Read latest outcomes through the turn indexes without replaying child transcripts. */
  outcomes() {
    const rows = this.db
      .prepare(
        `SELECT d.child_session_id, d.parent_session_id, json_extract(s.payload_json,'$.turnId') AS turn_id,
        (SELECT CASE WHEN e.type='session.interrupted' THEN 'interrupted'
          ELSE json_extract(e.payload_json,'$.stopReason') END
         FROM events e WHERE e.session_id=d.child_session_id
          AND e.type IN ('session.interrupted','turn.done')
          AND json_extract(e.payload_json,'$.turnId')=json_extract(s.payload_json,'$.turnId')
         ORDER BY e.seq LIMIT 1) AS outcome
       FROM session_delegations d JOIN events s ON s.session_id=d.child_session_id AND s.seq=(
         SELECT seq FROM events WHERE session_id=d.child_session_id AND type='turn.started' ORDER BY seq DESC LIMIT 1
       )`,
      )
      .all() as { child_session_id: string; parent_session_id: string; turn_id: string; outcome: unknown }[];
    return new Map(
      rows.map(
        ({ child_session_id, parent_session_id, turn_id, outcome }) =>
          [
            child_session_id,
            {
              parentSessionId: parent_session_id,
              turnId: turn_id,
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
