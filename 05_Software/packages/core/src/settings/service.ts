import {
  defaultSettings,
  mergeSettings,
  type SettingsServicePatch,
  type SettingsSnapshot,
  settingsSchema,
  settingsServicePatchSchema,
  settingsV0Schema,
  settingsV1Schema,
  settingsV2Schema,
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
    const defaults = defaultSettings(this.host.uuid());
    if (raw === undefined) {
      await this.host.files.writeAtomic(this.host.paths.settings, JSON.stringify(defaults, null, 2));
      this.state = { settings: defaults, readOnly: false };
      return;
    }
    let stored: unknown;
    try {
      stored = JSON.parse(raw);
    } catch {
      throw veraError("INVALID");
    }
    if (typeof stored !== "object" || stored === null || Array.isArray(stored)) throw veraError("INVALID");
    const version = (stored as { schemaVersion?: unknown }).schemaVersion;
    if (typeof version !== "number" || !Number.isSafeInteger(version) || version < 0)
      throw veraError("INVALID");
    if (version > 3) {
      this.state = { settings: defaults, readOnly: true };
      return;
    }
    let data = stored;
    if (version === 0) {
      const legacy = settingsV0Schema.safeParse(stored);
      if (!legacy.success) throw veraError("INVALID");
      const { schemaVersion: _version, installationId, ...patch } = legacy.data;
      data = {
        ...defaults,
        ...patch,
        schemaVersion: 3,
        providers: defaults.providers,
        installationId: installationId ?? defaults.installationId,
        updates: { ...defaults.updates, ...patch.updates },
        limits: { ...defaults.limits, ...patch.limits },
      };
    }
    if (version === 1) {
      const legacy = settingsV1Schema.safeParse(stored);
      if (!legacy.success) throw veraError("INVALID");
      data = { ...legacy.data, schemaVersion: 3, providers: defaults.providers };
    }
    if (version === 2) {
      const legacy = settingsV2Schema.safeParse(stored);
      if (!legacy.success) throw veraError("INVALID");
      data = { ...legacy.data, schemaVersion: 3, providers: defaults.providers };
    }
    const parsed = settingsSchema.safeParse(data);
    if (!parsed.success) throw veraError("INVALID");
    if (version < 3) {
      let backup = version;
      while (!(await this.host.files.backup(`${this.host.paths.settings}.bak-${backup}`, raw))) backup++;
      await this.host.files.writeAtomic(this.host.paths.settings, JSON.stringify(parsed.data, null, 2));
    }
    this.state = { settings: parsed.data, readOnly: false };
  }

  get(): SettingsSnapshot {
    if (!this.state) throw veraError("BUSY");
    return structuredClone(this.state);
  }

  async update(patch: SettingsServicePatch): Promise<SettingsSnapshot> {
    if (this.closed) throw veraError("DENIED");
    const parsed = settingsServicePatchSchema.safeParse(patch);
    if (!parsed.success) throw veraError("INVALID");
    const run = this.queue.then(async () => {
      await this.load();
      const current = this.get();
      if (current.readOnly) throw veraError("DENIED");
      const next = mergeSettings(current.settings, parsed.data);
      if (JSON.stringify(next) !== JSON.stringify(current.settings)) {
        await this.host.files.writeAtomic(this.host.paths.settings, JSON.stringify(next, null, 2));
        this.state = { settings: next, readOnly: false };
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
