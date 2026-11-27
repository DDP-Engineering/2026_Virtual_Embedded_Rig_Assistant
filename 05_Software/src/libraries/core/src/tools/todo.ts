import { projectPlan, type SessionEvent, type TodoItem, todoItemsSchema } from "@vera/shared";
import type Database from "better-sqlite3";
import { z } from "zod";
import type { TodosRepository } from "../storage/repos/todos.js";
import { type ToolDefinition, toolLimit } from "./context.js";

export interface TodoHost {
  db: Database.Database;
  repository: TodosRepository;
  sessionId: string;
  now(): string;
  assertWritable(): void;
  record(event: SessionEvent): () => void;
  scrub?: (text: string) => string;
}

const params = z
  .strictObject({ items: todoItemsSchema.optional(), offset: z.number().int().positive().optional() })
  .refine(({ items, offset }) => items === undefined || offset === undefined, {
    message: "Use offset to read the plan, or items to replace the whole plan.",
  });

const statusWords: Record<string, TodoItem["status"]> = {
  pending: "pending",
  in_progress: "in_progress",
  done: "done",
  completed: "done",
  complete: "done",
  finished: "done",
  todo: "pending",
  open: "pending",
  not_started: "pending",
  "in-progress": "in_progress",
  inprogress: "in_progress",
  active: "in_progress",
  doing: "in_progress",
};
/**
 * The plan the model plainly meant: another word for a status is mapped, a step that is too long is
 * shortened and a blank step is dropped. A refused plan has to be sent again whole.
 */
function repairPlan(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !Array.isArray((raw as { items?: unknown }).items))
    return raw;
  const items = (raw as { items: unknown[] }).items.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [item];
    const step = item as { text?: unknown; status?: unknown };
    if (typeof step.text !== "string") return [item];
    if (!step.text.trim()) return [];
    const text =
      step.text.length > 200 ? `${step.text.slice(0, 199).replace(/[\uD800-\uDBFF]$/, "")}…` : step.text;
    const word = typeof step.status === "string" ? step.status.trim().toLowerCase().replaceAll(" ", "_") : "";
    return [{ ...step, text, status: statusWords[word] ?? step.status }];
  });
  return { ...raw, items };
}

function planPage(items: readonly TodoItem[], offset: number, limit: number) {
  const totalItems = items.length;
  const page: TodoItem[] = [];
  const capacity =
    limit - JSON.stringify({ items: [], totalItems, nextOffset: totalItems, idsOmitted: true }).length;
  let remaining = capacity;
  let idsOmitted = false;
  for (const item of items.slice(offset - 1)) {
    let entry = item;
    let size = JSON.stringify(entry).length + 1;
    if (size > capacity) {
      entry = { text: item.text, status: item.status };
      size = JSON.stringify(entry).length + 1;
    }
    if (size > remaining) break;
    page.push(entry);
    remaining -= size;
    idsOmitted ||= entry !== item;
  }
  const nextOffset = offset + page.length;
  return {
    items: page,
    totalItems,
    ...(nextOffset <= totalItems && { nextOffset }),
    ...(idsOmitted && { idsOmitted: true }),
  };
}

export const todoTool: ToolDefinition = {
  name: "todo",
  class: "session",
  description:
    "Pass items to replace the whole session Plan (up to 50 steps, each text up to 200 characters). Use pending, in_progress or done; items:[] clears it. Pass {} to read the current plan. Both return totalItems and a page; read again with the returned nextOffset to get the rest before replacing the plan. Optional IDs are stored; idsOmitted flags IDs too large for a response page.",
  params,
  repair: repairPlan,
  async execute(ctx, raw, signal) {
    const host = ctx.todos;
    if (!host) throw Error("Session Plan storage is unavailable.");
    const input = raw as z.infer<typeof params>;
    signal.throwIfAborted();
    const limit = toolLimit(ctx, "toolResultChars");
    if (input.items === undefined) {
      const row = host.repository.get(host.sessionId);
      const stored = row ? todoItemsSchema.parse(JSON.parse(row.items_json)) : [];
      const items = host.scrub ? projectPlan(stored, host.scrub) : stored;
      return planPage(items, input.offset ?? 1, limit);
    }
    host.assertWritable();
    const items = host.scrub ? projectPlan(input.items, host.scrub) : input.items;
    let publish: (() => void) | undefined;
    const stored = host.db.transaction(() => {
      signal.throwIfAborted();
      host.assertWritable();
      const value = host.repository.replace(host.sessionId, items, host.now());
      publish = host.record({ type: "todo.updated", items: value });
      return value;
    })();
    publish?.();
    return planPage(stored, 1, limit);
  },
};
