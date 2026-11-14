import {
  ConfiguredPartsProvider,
  PartsAccessBlocked,
  type PartsHost,
  type SettingsService,
} from "@vera/core";
import {
  type PartsAccessSave,
  type PartsAccessSnapshot,
  type PartsAccessTest,
  type PartsAccessTestResult,
  type PartsSupplierId,
  partsAccessSaveSchema,
  partsAccessTestSchema,
  partsSearchDefaults,
  partsSupplierIds,
  veraError,
} from "@vera/shared";
import type { CredentialFile } from "./credentials.js";

const credentialId = (supplier: PartsSupplierId) => `parts:${supplier}`;
type TestAttempt = { id: string; controller: AbortController };
/** Main owns supplier credentials, parts settings changes, rollback and connection tests. */
export class PartsAccessService {
  readonly provider: ConfiguredPartsProvider;
  private queue: Promise<void> = Promise.resolve();
  private saving = false;
  private closed = false;
  private attempt: TestAttempt | undefined;
  constructor(
    private readonly host: {
      settings: SettingsService;
      credentials: CredentialFile;
      changed(): void;
      now?: () => Date;
      http?: PartsHost["http"];
      adapters?: PartsHost["adapters"];
    },
  ) {
    this.provider = new ConfiguredPartsProvider({
      config: () => {
        const settings = host.settings.get().settings;
        return {
          parts: settings.partsSearch ?? partsSearchDefaults,
          webEnabled: settings.webAccess.enabled && !this.saving,
        };
      },
      getCredential: async (supplier, signal) => {
        const value = await host.credentials.read(credentialId(supplier), { signal });
        if (value?.type !== "api_key" || !value.key) return undefined;
        const id = value.env?.id;
        return id ? { secret: value.key, id } : { secret: value.key };
      },
      ...(host.http ? { http: host.http } : {}),
      ...(host.adapters ? { adapters: host.adapters } : {}),
      ...(host.now ? { now: host.now } : {}),
    });
  }
  get(): Promise<PartsAccessSnapshot> {
    return this.enqueue(async () => {
      const keys = {} as PartsAccessSnapshot["keys"];
      for (const supplier of partsSupplierIds) {
        const value = await this.host.credentials.read(credentialId(supplier));
        keys[supplier] = {
          keyConfigured: value?.type === "api_key" && !!value.key,
          storage: this.host.credentials.storage(credentialId(supplier)),
        };
      }
      const snapshot = {
        preferences: this.host.settings.get().settings.partsSearch ?? partsSearchDefaults,
        keys,
        secureStorage: this.host.credentials.secureStorage,
      };
      if (this.host.credentials.containsSecret(snapshot)) throw veraError("INVALID");
      return snapshot;
    });
  }
  private enqueue<T>(action: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(veraError("DENIED"));
    const operation = this.queue.then(action);
    this.queue = operation.then(
      () => {},
      () => {},
    );
    return operation;
  }
  save(request: PartsAccessSave) {
    for (const value of [request?.credential?.secret, request?.credential?.id])
      if (typeof value === "string") this.host.credentials.registerSecret(value);
    const parsed = partsAccessSaveSchema.safeParse(request);
    if (!parsed.success) return Promise.reject(veraError("INVALID"));
    return this.enqueue(async () => {
      const input = parsed.data;
      if (input.credential && !this.host.credentials.secureStorage && input.storageConsent === undefined)
        return { status: "consent-required" as const };
      const id = input.supplier ? credentialId(input.supplier) : undefined;
      const restore = id ? await this.host.credentials.checkpoint(id) : async () => {};
      const before = this.host.settings.get().settings.partsSearch;
      this.saving = true;
      this.provider.revoke();
      try {
        if (id && input.credential) {
          const { secret, id: publicPart } = input.credential;
          await this.host.credentials.modify(
            id,
            async () => ({
              type: "api_key",
              key: secret,
              ...(publicPart ? { env: { id: publicPart } } : {}),
            }),
            input.storageConsent === undefined ? undefined : { storageConsent: input.storageConsent },
          );
        }
        await this.host.settings.update({ partsSearch: input.preferences });
      } catch {
        await restore();
        if (before) await this.host.settings.update({ partsSearch: before }).catch(() => {});
        throw veraError("INTERNAL");
      } finally {
        this.saving = false;
      }
      this.notify();
      return { status: "saved" as const };
    });
  }
  removeKey({ supplier }: { supplier: PartsSupplierId }) {
    if (!partsSupplierIds.includes(supplier)) return Promise.reject(veraError("INVALID"));
    return this.enqueue(async () => {
      const id = credentialId(supplier);
      const restore = await this.host.credentials.checkpoint(id);
      this.saving = true;
      this.provider.revoke();
      try {
        await this.host.credentials.delete(id);
      } catch {
        await restore();
        throw veraError("INTERNAL");
      } finally {
        this.saving = false;
      }
      this.notify();
      return {};
    });
  }
  test(request: PartsAccessTest): Promise<PartsAccessTestResult> {
    const parsed = partsAccessTestSchema.safeParse(request);
    if (!parsed.success) return Promise.reject(veraError("INVALID"));
    if (this.closed) return Promise.reject(veraError("DENIED"));
    if (this.attempt) return Promise.reject(veraError("BUSY"));
    const input = parsed.data,
      start = Date.now();
    const attempt: TestAttempt = { id: input.testId, controller: new AbortController() };
    this.attempt = attempt;
    return (async () => {
      let status: PartsAccessTestResult["status"];
      try {
        status = (await this.provider.test(input.supplier, attempt.controller.signal)).status;
      } catch (error) {
        status = error instanceof PartsAccessBlocked ? error.reason : "failed";
      } finally {
        if (this.attempt === attempt) this.attempt = undefined;
      }
      return {
        testId: input.testId,
        supplier: input.supplier,
        status,
        checkedAt: (this.host.now?.() ?? new Date()).toISOString(),
        durationMs: Math.max(0, Date.now() - start),
      };
    })();
  }
  cancelTest({ testId }: { testId: string }) {
    if (this.attempt?.id === testId) this.attempt.controller.abort();
    return {};
  }
  /** A Web access change also changes who may search: calls in flight end and tokens are dropped. */
  revoke() {
    this.provider.revoke();
  }
  async close() {
    this.closed = true;
    this.attempt?.controller.abort();
    await this.provider.close();
    await this.queue;
  }
  private notify() {
    try {
      this.host.changed();
    } catch {
      /* Committed settings cannot be undone by an observer. */
    }
  }
}
