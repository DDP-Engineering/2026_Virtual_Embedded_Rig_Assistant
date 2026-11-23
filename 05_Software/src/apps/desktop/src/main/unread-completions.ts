import { randomUUID } from "node:crypto";
import { type ActivitySessionTarget, type UnreadCompletion, unreadCompletionLimit } from "@vera/shared";

function sameSession(entry: ActivitySessionTarget, target: ActivitySessionTarget): boolean {
  return (
    entry.folder === target.folder &&
    entry.workbenchId === target.workbenchId &&
    entry.sessionId === target.sessionId
  );
}

/** The newest unread completion markers for the lifetime of the desktop main process. */
export class UnreadCompletions {
  private readonly entries = new Map<string, UnreadCompletion>();

  add(completion: Omit<UnreadCompletion, "completionId">): void {
    const completionId = randomUUID();
    if (this.entries.size === unreadCompletionLimit) {
      const oldest = this.entries.keys().next();
      if (!oldest.done) this.entries.delete(oldest.value);
    }
    this.entries.set(completionId, { ...completion, completionId });
  }

  list(): UnreadCompletion[] {
    return [...this.entries.values()].reverse();
  }

  read(completionId: string, target: ActivitySessionTarget): void {
    const entry = this.entries.get(completionId);
    if (entry && sameSession(entry, target)) this.entries.delete(completionId);
  }

  clear(): void {
    this.entries.clear();
  }

  discard(target: ActivitySessionTarget): void {
    for (const [id, entry] of this.entries) if (sameSession(entry, target)) this.entries.delete(id);
  }

  discardWorkbench(folder: string): void {
    for (const [id, entry] of this.entries) if (entry.folder === folder) this.entries.delete(id);
  }
}
