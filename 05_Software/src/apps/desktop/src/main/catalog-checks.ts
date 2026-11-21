/** Plugin catalog update checks run once a day unless the Plugin catalog check interval says otherwise. */
export const CATALOG_CHECK_MS = 24 * 60 * 60 * 1000;

/**
 * Reads the plugin catalog at start and every interval while `enabled()` (a remote catalog is set and the
 * update mode is not Off). A check only reads the index; installing is always the user's action.
 */
export class CatalogChecks {
  private timer: ReturnType<typeof setInterval> | undefined;
  private scheduled: number | undefined;
  private running = false;
  constructor(
    private readonly options: {
      check: () => Promise<unknown>;
      enabled: () => boolean;
      /** The interval, read at start and on each settings change (REQ-FUNC-ce542246). */
      intervalMs?: number | (() => number);
    },
  ) {}
  private interval(): number {
    const value =
      typeof this.options.intervalMs === "function" ? this.options.intervalMs() : this.options.intervalMs;
    return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : CATALOG_CHECK_MS;
  }
  private schedule(): void {
    this.scheduled = this.interval();
    this.timer = setInterval(() => this.tick(), this.scheduled);
  }
  private tick(): void {
    if (this.running || !this.options.enabled()) return;
    this.running = true;
    // A failed read shows as the catalog's problem on the Plugins page; the next tick tries again.
    void this.options
      .check()
      .catch(() => {})
      .finally(() => {
        this.running = false;
      });
  }
  start(): void {
    if (this.timer) return;
    this.schedule();
    this.tick();
  }
  /** A changed interval restarts the wait without a check; an unchanged one keeps it. */
  settingsChanged(): void {
    if (!this.timer || this.interval() === this.scheduled) return;
    clearInterval(this.timer);
    this.schedule();
  }
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
