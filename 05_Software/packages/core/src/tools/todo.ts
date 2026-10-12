import { type SessionEvent, type TodoItem, todoItemsSchema } from "@vera/shared";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { TodosRepository } from "../storage/repos/todos.js";
import type { ToolDefinition } from "./context.js";

export interface TodoHost {
  db: Database.Database;
  repository: TodosRepository;
  sessionId: string;
  now(): string;
  assertWritable(): void;
  record(event: SessionEvent): () => void;
  scrub?: (text: string) => string;
}
export const todoTool: ToolDefinition = {
  name: "todo",
  class: "session",
  description:
    "Replace the whole session Plan with up to 50 items, each text up to 200 characters. Use pending, in_progress or done; pass an empty list to clear. Optional IDs are preserved.",
  params: z.strictObject({ items: todoItemsSchema }),
  async execute(ctx, raw, signal) {
    const host = ctx.todos;
    if (!host) throw Error("Session Plan storage is unavailable.");
    const input = raw as { items: TodoItem[] };
    const items = todoItemsSchema.parse(
      input.items.map((item) => ({
        ...item,
        text: host.scrub?.(item.text) ?? item.text,
        ...(item.id === undefined ? {} : { id: host.scrub?.(item.id) ?? item.id }),
      })),
    );
    signal.throwIfAborted();
    host.assertWritable();
    let publish: (() => void) | undefined;
    const stored = host.db.transaction(() => {
      signal.throwIfAborted();
      host.assertWritable();
      const value = host.repository.replace(host.sessionId, items, host.now());
      publish = host.record({ type: "todo.updated", items: value });
      return value;
    })();
    publish?.();
    return { items: stored };
  },
};
