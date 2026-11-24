import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultSettings,
  mergeSettings,
  type SettingsServicePatch,
  type SettingsSnapshot,
  settingsSchema,
  settingsServicePatchSchema,
  veraError,
} from "@vera/shared";
import { z } from "zod";
import type { FileAccess, PathProvider } from "../ports.js";

const delegatedFullAccessFile = "delegated-full-access.json";
const delegatedFullAccessSchema = z.strictObject({ schemaVersion: z.literal(1), enabled: z.boolean() });

/** Both hosts check the current profile policy inside delegation admission. */
export function delegatedFullAccessEnabled(userData: string): boolean {
  try {
    const saved: unknown = JSON.parse(readFileSync(join(userData, delegatedFullAccessFile), "utf8"));
    return delegatedFullAccessSchema.safeParse(saved).data?.enabled === true;
  } catch {
    return false;
  }
}

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
    // A failed load (a busy or locked file) is not cached: the next call reads the file again.
    this.loading ??= this.initialize().catch((error) => {
      this.loading = undefined;
      throw error;
    });
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
    return this.enqueue(async () => {
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
  }

  /** Writes the security policy independently of general preferences shared by CLI and Desktop. */
  async setDelegatedFullAccess(enabled: boolean): Promise<{ enabled: boolean }> {
    if (this.closed) throw veraError("DENIED");
    const value = delegatedFullAccessSchema.parse({ schemaVersion: 1, enabled });
    return this.enqueue(async () => {
      await this.host.files.writeAtomic(
        join(this.host.paths.userData, delegatedFullAccessFile),
        JSON.stringify(value),
      );
      return { enabled };
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.queue.then(operation);
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
