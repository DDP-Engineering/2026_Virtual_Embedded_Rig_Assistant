// REQ-DATA-3b6664f9 REQ-REL-f19a4bc2 REQ-FUNC-d9d16533
import { z } from "zod";

/** One renderer record per workbench session: `vera.tabs.<workbenchId>.<sessionId>` (TASK-061fe00e). */
const key = (workbenchId: string, sessionId: string) => `vera.tabs.${workbenchId}.${sessionId}`;
const text = z.string().min(1).max(4096);
const targetSchema = z.union([
  z.strictObject({ path: text }),
  z.strictObject({ ref: text }),
  z.strictObject({ downloadId: text }),
  z.strictObject({ textPath: text, ignored: z.boolean().optional() }),
  z.strictObject({ sessionId: text, messageId: text, ref: text }),
]);
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const placeSchema = z.union([
  z.strictObject({ page: count }),
  z.strictObject({ line: count }),
  z.strictObject({ scroll: z.number().min(0).max(Number.MAX_SAFE_INTEGER) }),
]);
/** The stored format; its version stays 1 during development (AGENTS.md). */
const tabSchema = z.strictObject({ target: targetSchema, place: placeSchema.optional() });
/** The most tabs one session keeps; more are dropped from the front (the oldest) when saving. */
const MAX_TABS = 200;
export const storedTabsSchema = z.strictObject({
  version: z.literal(1),
  active: text,
  tabs: z.array(tabSchema).max(MAX_TABS),
});
export type StoredTabs = z.infer<typeof storedTabsSchema>;
/** Records of sessions deleted in this run; a save still pending for one must not bring it back. */
const deleted = new Set<string>();

/** The session's stored tabs, or nothing for a missing, unreadable or invalid record. */
export function readTabs(
  storage: Pick<Storage, "getItem">,
  workbenchId: string,
  sessionId: string,
): StoredTabs | undefined {
  try {
    const result = storedTabsSchema.safeParse(
      JSON.parse(storage.getItem(key(workbenchId, sessionId)) ?? "null"),
    );
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
export function writeTabs(
  storage: Pick<Storage, "setItem">,
  workbenchId: string,
  sessionId: string,
  value: StoredTabs,
): void {
  if (deleted.has(key(workbenchId, sessionId))) return;
  // One tab that cannot be stored (an over-long path) is left out instead of losing the record.
  const tabs = value.tabs.filter((tab) => tabSchema.safeParse(tab).success).slice(-MAX_TABS);
  const active = text.safeParse(value.active).success ? value.active : "chat";
  try {
    storage.setItem(
      key(workbenchId, sessionId),
      JSON.stringify(storedTabsSchema.parse({ version: value.version, active, tabs })),
    );
  } catch {
    /* Unavailable storage keeps the tabs working for this run. */
  }
}
export function removeTabs(
  storage: Pick<Storage, "removeItem">,
  workbenchId: string,
  sessionId: string,
): void {
  // Session ids are never reused, so the record stays deleted for the rest of the run.
  deleted.add(key(workbenchId, sessionId));
  try {
    storage.removeItem(key(workbenchId, sessionId));
  } catch {
    /* Unavailable storage has nothing to remove. */
  }
}
