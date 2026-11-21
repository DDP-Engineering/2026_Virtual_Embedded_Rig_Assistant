import type { DocumentIndexStatus, DocumentStatus } from "@vera/shared";
import type Database from "better-sqlite3";
import type { DocumentIndexPhase } from "./ingest.js";

export type IndexStatusFields = Pick<
  DocumentIndexStatus,
  "state" | "progress" | "searchable" | "volume" | "guard"
>;

const UPDATE_INTERVAL_MS = 250;

/** Tracks a pass and published passages independently of the document search path. */
export class IndexStatus {
  private searchableIds: Set<number> | undefined;
  private progress: DocumentIndexStatus["progress"] = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private previous: string | undefined;

  constructor(
    private readonly current: () => IndexStatusFields,
    private readonly changed: () => void,
  ) {}

  seed(db: Database.Database) {
    this.searchableIds ??= new Set(
      db
        .prepare(`SELECT d.id FROM documents d WHERE d.status='indexed'
        AND EXISTS(SELECT 1 FROM chunks c WHERE c.doc_id=d.id)`)
        .pluck()
        .all() as number[],
    );
  }
  published(id: number, searchable: boolean): void {
    if (searchable) this.searchableIds?.add(id);
    else this.searchableIds?.delete(id);
  }
  clearPublished(): void {
    this.searchableIds?.clear();
  }
  select(total: number): void {
    this.progress = { total, processed: 0, exceptions: 0 };
  }
  finish(status: DocumentStatus): void {
    if (!this.progress || status === "pending") return;
    this.progress.processed++;
    if (status !== "indexed") this.progress.exceptions++;
  }
  snapshot(
    phase: DocumentIndexPhase,
    volume: IndexStatusFields["volume"],
    guard: IndexStatusFields["guard"],
    stopped: boolean,
    rebuilding: boolean,
  ): IndexStatusFields {
    const searchable = this.searchableIds?.size ?? null;
    const measured = phase === "indexing" || phase === "settled" || phase === "settled-with-exceptions";
    return {
      state: indexState(phase, searchable, guard, stopped, rebuilding),
      progress: !stopped && measured && this.progress ? { ...this.progress } : null,
      searchable,
      volume,
      guard,
    };
  }
  notify(): void {
    this.cancel();
    const next = JSON.stringify(this.current());
    if (next === this.previous) return;
    this.previous = next;
    this.changed();
  }
  notifySoon(): void {
    this.timer ??= setTimeout(() => this.notify(), UPDATE_INTERVAL_MS);
  }
  cancel(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}

function indexState(
  phase: DocumentIndexPhase,
  searchable: number | null,
  guard: IndexStatusFields["guard"],
  stopped: boolean,
  rebuilding: boolean,
): IndexStatusFields["state"] {
  if (stopped) return "stopped";
  if (rebuilding && (phase === "scanning" || phase === "indexing")) return "rebuilding";
  switch (phase) {
    case "settled":
      return searchable ? "ready" : "empty";
    case "settled-with-exceptions":
      return "exceptions";
    case "blocked":
      return guard ? "count-guard" : "blocked";
    case "unknown":
      return "scanning";
    default:
      return phase;
  }
}
