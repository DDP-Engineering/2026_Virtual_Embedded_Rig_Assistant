import { veraError } from "./errors.js";

/** Swaps `items[index]` with the nearest item in the `offset` direction that `peer` accepts. */
function swap<T>(items: readonly T[], index: number, offset: -1 | 1, peer: (item: T) => boolean): T[] {
  const next = [...items];
  let other = index + offset;
  while (other >= 0 && other < next.length && !peer(next[other] as T)) other += offset;
  if (other >= 0 && other < next.length) [next[index], next[other]] = [next[other] as T, next[index] as T];
  return next;
}

/**
 * Lists sessions absent from the stored order first, in their incoming order, then the others in
 * the stored order. Archived sessions are never ordered: with a stored order they come last in
 * their incoming order, without one the list is returned as it came. Stored ids without a session
 * are ignored.
 */
export function orderSessions<T extends { id: string; archived?: boolean }>(
  list: readonly T[],
  order?: readonly string[],
): T[] {
  if (!order?.length) return [...list];
  const rank = new Map(order.map((id, index) => [id, index]));
  return list
    .map((item, index) => ({
      item,
      index,
      rank: item.archived ? order.length : (rank.get(item.id) ?? -1),
    }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

/**
 * Moves a non-archived session one place among the non-archived ones and returns the id order to
 * store, which holds only non-archived sessions (deleted and archived ids are dropped). At an edge
 * the order is unchanged.
 */
export function moveSession(
  list: readonly { id: string; archived: boolean }[],
  order: readonly string[] | undefined,
  id: string,
  offset: -1 | 1,
): string[] {
  const ordered = orderSessions(list, order);
  const index = ordered.findIndex((session) => session.id === id);
  if (index < 0 || ordered[index]?.archived) throw veraError("NOT_FOUND");
  return swap(ordered, index, offset, (session) => !session.archived)
    .filter((session) => !session.archived)
    .map((session) => session.id);
}

/** Moves a recent workbench one place among the entries with the same pinned state. */
export function moveRecentWorkbench<T extends { folder: string; pinned?: boolean | undefined }>(
  entries: readonly T[],
  folder: string,
  offset: -1 | 1,
): T[] {
  const index = entries.findIndex((entry) => entry.folder === folder);
  if (index < 0) throw veraError("NOT_FOUND");
  const pinned = !!entries[index]?.pinned;
  return swap(entries, index, offset, (entry) => !!entry.pinned === pinned);
}
