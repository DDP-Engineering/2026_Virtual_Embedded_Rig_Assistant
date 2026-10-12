// REQ-FUNC-2e8a54c7 REQ-DATA-d968385c
import { expect, it } from "vitest";
import { sessionEventSchema } from "./events.js";
import { todoItemSchema } from "./session.js";
import { applySessionEvent, emptySessionState, sessionStateSchema } from "./session-state.js";

it("bounds todo text and validates the three statuses at shared event/snapshot boundaries", () => {
  for (const status of ["pending", "in_progress", "done"] as const) {
    const item = { id: "optional", text: "ă".repeat(200), status };
    expect(todoItemSchema.parse(item)).toEqual(item);
    expect(todoItemSchema.safeParse({ ...item, text: "ă".repeat(201) }).success).toBe(false);
  }
  expect(todoItemSchema.safeParse({ text: "text", status: "unknown" }).success).toBe(false);
  const items = Array.from({ length: 50 }, () => ({ text: "", status: "pending" as const }));
  expect(sessionEventSchema.parse({ type: "todo.updated", items })).toMatchObject({ items });
  expect(sessionEventSchema.safeParse({ type: "todo.updated", items: [...items, items[0]] }).success).toBe(
    false,
  );
  expect(sessionStateSchema.safeParse({ ...emptySessionState(), todos: [...items, items[0]] }).success).toBe(
    false,
  );
});
it("replaces the whole projected list in input order, preserving optional IDs and clearing", () => {
  const a = [{ id: "a", text: "Inspect", status: "pending" as const }];
  const state = applySessionEvent(emptySessionState(), { type: "todo.updated", items: a });
  const b = [{ text: "Verify", status: "done" as const }];
  expect(applySessionEvent(state, { type: "todo.updated", items: b }).todos).toEqual(b);
  expect(state.todos).toEqual(a);
  expect(applySessionEvent(state, { type: "todo.updated", items: [] }).todos).toEqual([]);
});
