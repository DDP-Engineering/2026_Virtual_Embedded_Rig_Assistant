/** Plugin catalog update checks run once a day (architecture §7). */
export const CATALOG_CHECK_MS = 24 * 60 * 60 * 1000;

/**
 * Reads the plugin catalog at start and every 24 h while `enabled()` (a remote catalog is set and the
 * update mode is not Off). A check only reads the index; installing is always the user's action.
 */
export class CatalogChecks {
  private timer: ReturnType<typeof setInterval> | undefined;
  private running = false;
  constructor(
    private readonly options: { check: () => Promise<unknown>; enabled: () => boolean; intervalMs?: number },
  ) {}
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
    this.timer = setInterval(() => this.tick(), this.options.intervalMs ?? CATALOG_CHECK_MS);
    this.tick();
  }
  close(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
