import {
  defaultSettings,
  mergeSettings,
  type SettingsServicePatch,
  type SettingsSnapshot,
  settingsSchema,
  settingsServicePatchSchema,
  veraError,
} from "@vera/shared";
import type { FileAccess, PathProvider } from "../ports.js";

export class SettingsService {
  private state: SettingsSnapshot | undefined;
  private loading: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;

  constructor(
    private readonly host: {
      files: FileAccess;
      paths: PathProvider;
      uuid: () => string;
      changed: () => void;
    },
  ) {}

  load(): Promise<void> {
    this.loading ??= this.initialize();
    return this.loading;
  }

  private async initialize(): Promise<void> {
    const raw = await this.host.files.read(this.host.paths.settings);
    if (raw === undefined) {
      const defaults = defaultSettings(this.host.uuid());
      await this.host.files.writeAtomic(this.host.paths.settings, JSON.stringify(defaults, null, 2));
      this.state = { settings: defaults };
      return;
    }
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      throw veraError("INVALID");
    }
    // The current format only: any other schemaVersion is invalid data (AGENTS.md).
    const parsed = settingsSchema.safeParse(stored);
    if (!parsed.success) throw veraError("INVALID");
    this.state = { settings: parsed.data };
  }

  get(): SettingsSnapshot {
    if (!this.state) throw veraError("BUSY");
    return structuredClone(this.state);
  }

  async update(
    patch: SettingsServicePatch,
    when?: (current: SettingsSnapshot) => boolean,
  ): Promise<SettingsSnapshot> {
    if (this.closed) throw veraError("DENIED");
    const parsed = settingsServicePatchSchema.safeParse(patch);
    if (!parsed.success) throw veraError("INVALID");
    const run = this.queue.then(async () => {
      await this.load();
      const current = this.get();
      if (when && !when(current)) return current;
      const next = mergeSettings(current.settings, parsed.data);
      if (JSON.stringify(next) !== JSON.stringify(current.settings)) {
        await this.host.files.writeAtomic(this.host.paths.settings, JSON.stringify(next, null, 2));
        this.state = { settings: next };
        // Observers cannot turn an already committed save into a failed update.
        try {
          this.host.changed();
        } catch {
          /* delivery is best effort */
        }
      }
      return this.get();
    });
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }

  async close(): Promise<void> {
    this.closed = true;
    await this.loading;
    await this.queue;
  }
}
