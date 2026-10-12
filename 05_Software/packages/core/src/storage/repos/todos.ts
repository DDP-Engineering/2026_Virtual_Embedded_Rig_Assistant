import { sessionIdSchema, type TodoItem, todoItemsSchema } from "@vera/shared";
import type Database from "better-sqlite3";

export interface TodoRow {
  session_id: string;
  items_json: string;
  updated_at: string;
}
/** Current whole session list; events/replay are owned by the session host. */
export class TodosRepository {
  constructor(private readonly db: Database.Database) {}
  get(sessionId: string): TodoRow | undefined {
    sessionIdSchema.parse(sessionId);
    return this.db.prepare("SELECT * FROM todos WHERE session_id=?").get(sessionId) as TodoRow | undefined;
  }
  replace(sessionId: string, items: TodoItem[], updatedAt: string): TodoItem[] {
    sessionIdSchema.parse(sessionId);
    const parsed = todoItemsSchema.parse(items);
    this.db
      .prepare(
        "INSERT INTO todos(session_id,items_json,updated_at) VALUES (?,?,?) ON CONFLICT(session_id) DO UPDATE SET items_json=excluded.items_json,updated_at=excluded.updated_at",
      )
      .run(sessionId, JSON.stringify(parsed), updatedAt);
    return parsed;
  }
}
