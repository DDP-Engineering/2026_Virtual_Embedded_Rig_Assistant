import { ConfiguredWebProvider, type SettingsService, WebAccessBlocked, type WebProvider } from "@vera/core";
import {
  veraError,
  type WebAccessSave,
  type WebAccessSnapshot,
  type WebAccessTest,
  type WebAccessTestResult,
  webAccessSaveSchema,
  webAccessTestSchema,
} from "@vera/shared";
import type { CredentialFile } from "./credentials.js";

const credentialId = "web:exa";
type TestAttempt = { id: string; controller: AbortController; done?: Promise<WebAccessTestResult> };
/** Main owns keys, authority changes, rollback and temporary connection tests. */
export class WebAccessService {
  readonly provider: ConfiguredWebProvider;
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
      create?: (key: string | undefined) => WebProvider;
    },
  ) {
    this.provider = new ConfiguredWebProvider({
      config: () => ({
        ...host.settings.get().settings.webAccess,
        ...(this.saving ? { enabled: false } : {}),
      }),
      getKey: async (signal) => {
        const value = await host.credentials.read(credentialId, { signal });
        return value?.type === "api_key" ? value.key : undefined;
      },
      ...(host.create ? { create: host.create } : {}),
    });
  }
  async get(): Promise<WebAccessSnapshot> {
    await this.queue;
    const value = await this.host.credentials.read(credentialId);
    const state = this.host.settings.get();
    const snapshot = {
      preferences: state.settings.webAccess,
      keyConfigured: value?.type === "api_key" && !!value.key,
      storage: this.host.credentials.storage(credentialId),
      secureStorage: this.host.credentials.secureStorage,
      readOnly: state.readOnly,
    };
    if (this.host.credentials.containsSecret(snapshot)) throw veraError("INVALID");
    return snapshot;
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
  save(request: WebAccessSave) {
    if (typeof request?.apiKey === "string") this.host.credentials.registerSecret(request.apiKey);
    const parsed = webAccessSaveSchema.safeParse(request);
    if (!parsed.success) return Promise.reject(veraError("INVALID"));
    return this.enqueue(async () => {
      const input = parsed.data;
      if (this.host.settings.get().readOnly) throw veraError("DENIED");
      const savedKey = await this.host.credentials.read(credentialId);
      if (
        input.enabled &&
        input.authentication === "api-key" &&
        !input.apiKey &&
        !(savedKey?.type === "api_key" && savedKey.key)
      )
        throw veraError("INVALID");
      if (input.apiKey && !this.host.credentials.secureStorage && input.storageConsent === undefined)
        return { status: "consent-required" as const };
      const restore = await this.host.credentials.checkpoint(credentialId);
      this.saving = true;
      this.provider.revoke();
      try {
        if (input.apiKey)
          await this.host.credentials.modify(
            credentialId,
            async () => ({ type: "api_key", key: input.apiKey! }),
            input.storageConsent === undefined ? undefined : { storageConsent: input.storageConsent },
          );
        await this.host.settings.update({
          webAccess: { enabled: input.enabled, provider: "exa", authentication: input.authentication },
        });
      } catch {
        await restore();
        throw veraError("INTERNAL");
      } finally {
        this.saving = false;
      }
      try {
        this.host.changed();
      } catch {
        /* Committed preferences cannot be undone by an observer. */
      }
      return { status: "saved" as const };
    });
  }
  removeKey() {
    return this.enqueue(async () => {
      const state = this.host.settings.get();
      if (state.readOnly) throw veraError("DENIED");
      const restore = await this.host.credentials.checkpoint(credentialId);
      this.saving = true;
      this.provider.revoke();
      try {
        await this.host.credentials.delete(credentialId);
        await this.host.settings.update({
          webAccess: { ...state.settings.webAccess, authentication: "anonymous" },
        });
      } catch {
        await restore();
        throw veraError("INTERNAL");
      } finally {
        this.saving = false;
      }
      try {
        this.host.changed();
      } catch {
        /* Delivery is best effort after a committed removal. */
      }
      return {};
    });
  }
  test(request: WebAccessTest): Promise<WebAccessTestResult> {
    if (typeof request?.apiKey === "string") this.host.credentials.registerSecret(request.apiKey);
    const parsed = webAccessTestSchema.safeParse(request);
    if (!parsed.success) return Promise.reject(veraError("INVALID"));
    if (this.closed) return Promise.reject(veraError("DENIED"));
    if (this.attempt) return Promise.reject(veraError("BUSY"));
    const input = parsed.data,
      start = Date.now();
    const attempt: TestAttempt = { id: input.testId, controller: new AbortController() };
    this.attempt = attempt;
    const run = async (): Promise<WebAccessTestResult> => {
      let status: WebAccessTestResult["status"] = "pass";
      try {
        await this.provider.test(input, attempt.controller.signal);
      } catch (error) {
        status = error instanceof WebAccessBlocked ? error.reason : "fail";
      } finally {
        if (this.attempt === attempt) this.attempt = undefined;
      }
      return {
        testId: input.testId,
        authentication: input.authentication,
        status,
        checkedAt: (this.host.now?.() ?? new Date()).toISOString(),
        durationMs: Math.max(0, Date.now() - start),
      };
    };
    attempt.done = run();
    return attempt.done;
  }
  cancelTest({ testId }: { testId: string }) {
    if (this.attempt?.id === testId) this.attempt.controller.abort();
    return {};
  }
  async close() {
    this.closed = true;
    this.attempt?.controller.abort();
    await this.provider.close();
    await this.queue;
  }
}
