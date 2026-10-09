import type { Db } from "../index.ts";

/** `data/pools.json`: `{fw: {test_id: [dataset_id, …]}}` (02 "Live pools"). */
export type Pools = Record<string, Record<string, string[]>>;

/** Consumes the next dataset of a live pool; the last entry repeats once the pool is exhausted. */
export function takeFromPool(db: Db, pools: Pools, fw: string, testId: string): string {
  const pool = pools[fw]?.[testId];
  if (!pool?.length) throw new Error(`no simulated data for ${testId} on firmware ${fw}`);
  const row = db.prepare("SELECT pos FROM pool_cursors WHERE fw = ? AND test_id = ?").get(fw, testId) as
    | { pos: number }
    | undefined;
  const pos = row?.pos ?? 0;
  db.prepare(
    "INSERT INTO pool_cursors(fw, test_id, pos) VALUES (?, ?, ?) ON CONFLICT(fw, test_id) DO UPDATE SET pos = excluded.pos",
  ).run(fw, testId, pos + 1);
  return pool[Math.min(pos, pool.length - 1)]!;
}

export function hasPool(pools: Pools, fw: string, testId: string): boolean {
  return Boolean(pools[fw]?.[testId]?.length);
}

/** Read-only cursor positions, keyed `fw|test_id` (GET /testbenches/:id/simulation). */
export function poolCursors(db: Db): Map<string, number> {
  const rows = db.prepare("SELECT fw, test_id, pos FROM pool_cursors").all() as { fw: string; test_id: string; pos: number }[];
  return new Map(rows.map((r) => [`${r.fw}|${r.test_id}`, r.pos]));
}
