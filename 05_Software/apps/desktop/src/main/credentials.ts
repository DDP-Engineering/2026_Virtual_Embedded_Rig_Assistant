import {
  type AuthOperationOptions,
  type Credential,
  type CredentialInfo,
  type CredentialStore,
  type CredentialWriteOptions,
  type FileAccess,
  type Logger,
  scrub,
} from "@vera/core";
import { veraError } from "@vera/shared";

export interface CredentialCrypto {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend(): string;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
export type CredentialStorage = "encrypted" | "unprotected" | "memory" | null;
type Entry = { encoding: "safeStorage" | "unprotected"; value: string; weak: boolean };
type Document = { schemaVersion: 1; entries: Record<string, Entry>; [key: string]: unknown };
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function credential(value: unknown): value is Credential {
  if (!object(value)) return false;
  if (value.type === "api_key")
    return (
      (value.key === undefined || typeof value.key === "string") &&
      (value.env === undefined ||
        (object(value.env) && Object.values(value.env).every((v) => typeof v === "string")))
    );
  return (
    value.type === "oauth" &&
    typeof value.access === "string" &&
    typeof value.refresh === "string" &&
    typeof value.expires === "number" &&
    Number.isFinite(value.expires)
  );
}

/** Single-main-process serialized store. OS-account boundary and Electron instance lock own writers. */
export class CredentialFile implements CredentialStore {
  private document: Document = { schemaVersion: 1, entries: {} };
  private values = new Map<string, Credential>();
  private locations = new Map<string, CredentialStorage>();
  private secrets = new Set<string>();
  private loading: Promise<void> | undefined;
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(
    private readonly host: {
      file: string;
      files: FileAccess;
      crypto: CredentialCrypto;
      logger: Logger;
      platform: string;
    },
  ) {}
  get secureStorage(): boolean {
    return (
      this.host.crypto.isEncryptionAvailable() &&
      (this.host.platform !== "linux" || this.host.crypto.getSelectedStorageBackend() !== "basic_text")
    );
  }
  storage(id: string): CredentialStorage {
    return this.locations.get(id) ?? null;
  }
  registerSecret(secret: string): void {
    if (!secret || this.secrets.has(secret)) return;
    this.secrets.add(secret);
    this.host.logger.registerSecret(secret);
  }
  private register(value: Credential): void {
    const walk = (item: unknown): void => {
      if (typeof item === "string") this.registerSecret(item);
      else if (Array.isArray(item)) item.forEach(walk);
      else if (object(item)) Object.values(item).forEach(walk);
    };
    const { type: _type, ...fields } = value;
    walk(fields);
  }
  scrub(text: string): string {
    return scrub(text, this.secrets);
  }
  /** Compare public data values, not protocol/schema field names. Low-entropy keys match whole values. */
  containsSecret(value: unknown): boolean {
    if (typeof value === "string")
      return [...this.secrets].some((secret) =>
        secret.length <= 7 ? value === secret : value.includes(secret),
      );
    if (Array.isArray(value)) return value.some((item) => this.containsSecret(item));
    if (object(value)) return Object.values(value).some((item) => this.containsSecret(item));
    return false;
  }
  sanitize<T>(value: T): T {
    const walk = (item: unknown): unknown => {
      if (typeof item === "string") return this.scrub(item);
      if (Array.isArray(item)) return item.map(walk);
      if (object(item))
        return Object.fromEntries(Object.entries(item).map(([k, v]) => [this.scrub(k), walk(v)]));
      return item;
    };
    return walk(value) as T;
  }
  load(): Promise<void> {
    this.loading ??= this.initialize();
    return this.loading;
  }
  private async initialize(): Promise<void> {
    const raw = await this.host.files.read(this.host.file);
    if (raw === undefined) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw veraError("INVALID");
    }
    if (!object(parsed) || !Number.isSafeInteger(parsed.schemaVersion)) throw veraError("INVALID");
    if ((parsed.schemaVersion as number) > 1) throw veraError("DENIED");
    if (parsed.schemaVersion !== 1 || !object(parsed.entries)) throw veraError("INVALID");
    const values = new Map<string, Credential>();
    const locations = new Map<string, CredentialStorage>();
    for (const [id, entry] of Object.entries(parsed.entries)) {
      if (
        !id ||
        !object(entry) ||
        !["safeStorage", "unprotected"].includes(String(entry.encoding)) ||
        typeof entry.value !== "string" ||
        typeof entry.weak !== "boolean" ||
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(entry.value) ||
        !entry.value
      )
        throw veraError("INVALID");
      let value: unknown;
      try {
        const buffer = Buffer.from(entry.value, "base64");
        value = JSON.parse(
          entry.encoding === "safeStorage" ? this.host.crypto.decryptString(buffer) : buffer.toString("utf8"),
        );
      } catch {
        throw veraError("INVALID");
      }
      if (!credential(value) || (entry.encoding === "unprotected" && !entry.weak)) throw veraError("INVALID");
      this.register(value);
      values.set(id, value);
      locations.set(id, entry.weak ? "unprotected" : "encrypted");
    }
    this.document = parsed as Document;
    this.values = values;
    this.locations = locations;
  }
  async read(id: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();
    await this.load();
    const value = this.values.get(id);
    return value === undefined ? undefined : structuredClone(value);
  }
  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    await this.load();
    return [...this.values].map(([providerId, value]) => ({ providerId, type: value.type }));
  }
  private enqueue<T>(operation: () => Promise<T>, options?: AuthOperationOptions): Promise<T> {
    if (this.closed) return Promise.reject(veraError("DENIED"));
    const run = this.queue.then(async () => {
      options?.signal?.throwIfAborted();
      await this.load();
      return operation();
    });
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  modify(
    id: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: CredentialWriteOptions,
  ): Promise<Credential | undefined> {
    return this.enqueue(async () => {
      if (!id || id === "__proto__" || id === "constructor" || id === "prototype") throw veraError("INVALID");
      const current = await this.read(id);
      // Main-only port: the consumer owns callback rejection/cancellation semantics.
      let next = await fn(current);
      if (next === undefined) return this.read(id);
      if (!credential(next)) throw veraError("INVALID");
      next = structuredClone(next);
      this.register(next);
      options?.signal?.throwIfAborted();
      const secure = this.secureStorage;
      if (!secure && options?.storageConsent === undefined) throw veraError("DENIED");
      const memory = !secure && options?.storageConsent === false;
      const entries = { ...this.document.entries };
      if (memory) delete entries[id];
      else {
        try {
          const text = JSON.stringify(next);
          const available = this.host.crypto.isEncryptionAvailable();
          entries[id] = {
            encoding: available ? "safeStorage" : "unprotected",
            value: (available ? this.host.crypto.encryptString(text) : Buffer.from(text)).toString("base64"),
            weak: !secure,
          };
        } catch {
          throw veraError("INTERNAL");
        }
      }
      const document = { ...this.document, entries };
      if (!memory || Object.hasOwn(this.document.entries, id)) {
        try {
          await this.host.files.writeAtomic(this.host.file, JSON.stringify(document, null, 2));
        } catch {
          throw veraError("INTERNAL");
        }
      }
      this.document = document;
      this.values.set(id, next);
      this.locations.set(id, memory ? "memory" : secure ? "encrypted" : "unprotected");
      return structuredClone(next);
    }, options);
  }
  delete(id: string, options?: AuthOperationOptions): Promise<void> {
    return this.enqueue(async () => {
      const entries = { ...this.document.entries };
      delete entries[id];
      const document = { ...this.document, entries };
      options?.signal?.throwIfAborted();
      if (Object.hasOwn(this.document.entries, id)) {
        try {
          await this.host.files.writeAtomic(this.host.file, JSON.stringify(document, null, 2));
        } catch {
          throw veraError("INTERNAL");
        }
      }
      this.document = document;
      this.values.delete(id);
      this.locations.delete(id);
    }, options);
  }
  /** Main-only transaction undo: restore encoded entry and location without re-encryption or consent. */
  checkpoint(id: string): Promise<() => Promise<void>> {
    return this.enqueue(async () => {
      const value = await this.read(id);
      const entry = this.document.entries[id];
      const previousEntry = entry === undefined ? undefined : structuredClone(entry);
      const location = this.locations.get(id);
      return () =>
        this.enqueue(async () => {
          const entries = { ...this.document.entries };
          if (previousEntry === undefined) delete entries[id];
          else entries[id] = structuredClone(previousEntry);
          const document = { ...this.document, entries };
          if (previousEntry !== undefined || Object.hasOwn(this.document.entries, id)) {
            try {
              await this.host.files.writeAtomic(this.host.file, JSON.stringify(document, null, 2));
            } catch {
              throw veraError("INTERNAL");
            }
          }
          this.document = document;
          if (value === undefined) this.values.delete(id);
          else this.values.set(id, structuredClone(value));
          if (location === undefined) this.locations.delete(id);
          else this.locations.set(id, location);
        });
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.loading;
    await this.queue;
  }
}
