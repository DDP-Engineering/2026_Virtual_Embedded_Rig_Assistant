import type { SettingsService } from "@vera/core";
import { moveSession, orderSessions, veraError } from "@vera/shared";

/**
 * The user's session order per workbench, kept in the user settings. Moves run one at a time so
 * each one starts from the order the previous one saved.
 */
export function createSessionOrder(settings: Pick<SettingsService, "get" | "update">) {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    list<T extends { id: string }>(workbenchId: string, sessions: readonly T[]): T[] {
      return orderSessions(sessions, settings.get().settings.sessionOrder?.[workbenchId]);
    },
    move(
      workbenchId: string,
      sessions: readonly { id: string; archived: boolean }[],
      sessionId: string,
      offset: -1 | 1,
    ): Promise<void> {
      const run = queue.then(async () => {
        const snapshot = settings.get();
        if (snapshot.readOnly) throw veraError("DENIED");
        const stored = snapshot.settings.sessionOrder;
        const order = moveSession(sessions, stored?.[workbenchId], sessionId, offset);
        await settings.update({ sessionOrder: { ...stored, [workbenchId]: order } });
      });
      queue = run.catch(() => {});
      return run;
    },
  };
}
