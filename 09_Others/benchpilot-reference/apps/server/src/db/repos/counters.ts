import type { Db } from "../index.ts";

/** P3 adds T (turn), M (assistant message), U (user message), C (replay tool call), DRAFT (ticket draft). */
export type IdPrefix = "RPT" | "RUN" | "PLAN" | "S" | "T" | "M" | "U" | "C" | "DRAFT";

/** Next sequential id, e.g. `RPT-0009`. Counters reset with the DB, so ids are deterministic after seed. */
export function nextId(db: Db, prefix: IdPrefix): string {
  const row = db
    .prepare(
      "INSERT INTO counters(name, value) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET value = value + 1 RETURNING value",
    )
    .get(prefix) as { value: number };
  return `${prefix}-${String(row.value).padStart(4, "0")}`;
}

export function peekNextId(db: Db, prefix: IdPrefix): string {
  const row = db.prepare("SELECT value FROM counters WHERE name = ?").get(prefix) as { value: number } | undefined;
  return `${prefix}-${String((row?.value ?? 0) + 1).padStart(4, "0")}`;
}
