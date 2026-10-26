import {
  type AppEvent,
  type UpdateChannel,
  type UpdateMode,
  type UpdateOffer,
  type UpdateSnapshot,
  updateSnapshotSchema,
  veraError,
} from "@vera/shared";

export interface UpdateBackend {
  check(channel: UpdateChannel): Promise<UpdateOffer | null>;
  download(progress: (percent: number) => void): Promise<void>;
  install(restart: boolean): void;
}
function failureCode(error: unknown): "INTEGRITY" | "NETWORK" {
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  return /CHECKSUM|SIGNATURE|PUBLISHER|SHA512/.test(code) ? "INTEGRITY" : "NETWORK";
}

/** The main host owns admission and persistence; the updater never aborts user work. */
export class Updates {
  private state: UpdateSnapshot;
  private working = false;
  private closed = false;
  private installed = false;
  private shutdown: boolean | undefined;
  private admitted = false;
  private timer: ReturnType<typeof setInterval> | undefined;
  private deferred: ReturnType<typeof setInterval> | undefined;
  private preference: { mode: UpdateMode; channel: UpdateChannel } | undefined;
  constructor(
    private readonly host: {
      distribution: UpdateSnapshot["distribution"];
      configured: boolean;
      backend: UpdateBackend;
      preferences: () => { mode: UpdateMode; channel: UpdateChannel };
      emit: (event: AppEvent) => void;
      beginShutdown: () => boolean;
      quit: () => void;
      openExternal: (url: string) => Promise<void>;
    },
  ) {
    this.state = {
      distribution: host.distribution,
      configured: host.configured,
      phase: "idle",
      offer: null,
      progress: null,
      errorCode: null,
    };
  }
  get(): UpdateSnapshot {
    return structuredClone(this.state);
  }
  private change(patch: Partial<UpdateSnapshot>): void {
    this.state = updateSnapshotSchema.parse({ ...this.state, ...patch });
    this.host.emit({ type: "update.changed", snapshot: this.get() });
  }
  start(): void {
    this.settingsChanged();
  }
  settingsChanged(): void {
    if (this.closed) return;
    const next = this.host.preferences();
    const previous = this.preference;
    if (previous?.mode === next.mode && previous.channel === next.channel) return;
    this.preference = { ...next };
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    if (next.mode !== "off" && this.host.configured) {
      this.timer = setInterval(
        () => {
          void this.check().catch(() => {});
        },
        6 * 60 * 60 * 1000,
      );
      this.timer.unref?.();
      if (!previous || previous.mode === "off" || previous.channel !== next.channel) {
        void this.check().catch(() => {});
      } else if (next.mode === "download" && this.state.phase === "available") {
        void this.download().catch(() => {});
      }
    }
  }
  async check(): Promise<UpdateSnapshot> {
    if (this.closed || this.admitted) throw veraError("DENIED");
    if (this.working) throw veraError("BUSY");
    // The verified download and its backend remain pinned through restart.
    if (this.state.phase === "ready" || this.state.phase === "deferred") return this.get();
    if (!this.host.configured) {
      this.change({ phase: "error", errorCode: "UNCONFIGURED" });
      return this.get();
    }
    this.working = true;
    const channel = this.host.preferences().channel;
    this.change({ phase: "checking", offer: null, progress: null, errorCode: null });
    try {
      const offer = await this.host.backend.check(channel);
      // Preference changes during I/O cannot display/download a stale channel offer.
      if (channel !== this.host.preferences().channel) {
        this.change({ phase: "idle" });
      } else {
        this.change({ phase: offer ? "available" : "current", offer });
        if (offer) this.host.emit({ type: "update.available", version: offer.version, notes: offer.notes });
      }
    } catch (error) {
      this.change({ phase: "error", errorCode: failureCode(error), offer: null });
    } finally {
      this.working = false;
    }
    if (this.state.phase === "idle" && this.host.preferences().mode !== "off") return this.check();
    if (
      this.state.phase === "available" &&
      this.host.preferences().mode === "download" &&
      this.host.distribution === "installed"
    )
      return this.download();
    return this.get();
  }
  async download(): Promise<UpdateSnapshot> {
    if (this.closed || this.admitted || this.host.distribution !== "installed") throw veraError("DENIED");
    if (this.working) throw veraError("BUSY");
    if (this.state.phase !== "available" || !this.state.offer) throw veraError("CONFLICT");
    this.working = true;
    this.change({ phase: "downloading", progress: 0, errorCode: null });
    try {
      await this.host.backend.download((percent) => {
        if (Number.isFinite(percent)) this.change({ progress: Math.max(0, Math.min(100, percent)) });
      });
      this.change({ phase: "ready", progress: 100 });
    } catch (error) {
      this.change({ phase: "error", errorCode: failureCode(error), progress: null });
    } finally {
      this.working = false;
    }
    return this.get();
  }
  get hasDownloaded(): boolean {
    return this.state.phase === "ready" || this.state.phase === "deferred";
  }
  get shuttingDown(): boolean {
    return this.admitted;
  }
  requestRestart(): UpdateSnapshot {
    if (this.closed || this.host.distribution !== "installed") throw veraError("DENIED");
    if (!this.hasDownloaded) throw veraError("CONFLICT");
    this.requestQuit(true);
    return this.get();
  }
  requestQuit(restart = false): void {
    if (!this.hasDownloaded || this.closed || this.admitted) return;
    this.shutdown = this.shutdown === true || restart;
    const attempt = () => {
      if (this.closed || this.admitted || !this.host.beginShutdown()) return;
      this.admitted = true;
      if (this.deferred) clearInterval(this.deferred);
      this.deferred = undefined;
      // Leave the caller's before-quit/IPC stack before re-entering app.quit.
      setTimeout(() => this.host.quit(), 0);
    };
    attempt();
    if (!this.admitted) {
      this.change({ phase: "deferred" });
      if (!this.deferred) this.deferred = setInterval(attempt, 100);
    }
  }
  /** Called only after successful session, workbench, settings and log drains. */
  finishShutdown(): boolean {
    if (!this.admitted || this.installed || this.shutdown === undefined) return false;
    this.installed = true;
    this.stopTimers();
    this.host.backend.install(this.shutdown);
    return true;
  }
  async openRelease(version: string): Promise<UpdateSnapshot> {
    const offer = this.state.offer;
    if (this.host.distribution !== "portable" || !offer?.link || offer.version !== version)
      throw veraError("DENIED");
    await this.host.openExternal(offer.link);
    return this.get();
  }
  private stopTimers(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.deferred) clearInterval(this.deferred);
    this.timer = undefined;
    this.deferred = undefined;
  }
  close(): void {
    this.closed = true;
    this.stopTimers();
  }
}
