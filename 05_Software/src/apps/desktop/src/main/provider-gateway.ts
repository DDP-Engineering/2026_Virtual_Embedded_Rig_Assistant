import type { Clock, SettingsService } from "@vera/core";
import { createPiAiGateway, type LlmGateway, resolveModelReference, testConnection } from "@vera/core";
import {
  type ProviderCatalog,
  type ProviderDiscoveryRequest,
  type ProviderTestResult,
  providerCatalogSchema,
  providerTestResultSchema,
  veraError,
} from "@vera/shared";
import type { CredentialFile } from "./credentials.js";
import { discoverProvider } from "./provider-discovery.js";
import type { ProviderSettings } from "./provider-settings.js";
import { subscriptionStore } from "./subscription-store.js";

/** Main owns gateway lifetime, current settings, credentials, and retained-secret scrubbing. */
export class ProviderGateway {
  readonly api: LlmGateway;
  private closed = false;
  private readonly active = new Set<Promise<unknown>>();
  constructor(
    private readonly settings: SettingsService,
    private readonly credentials: CredentialFile,
    private readonly providers: ProviderSettings,
    private readonly clock: Clock,
    gateway?: LlmGateway,
    private readonly defaultReference?: () => string,
  ) {
    this.api =
      gateway ??
      createPiAiGateway({
        settings: () => settings.get().settings,
        credentials,
        subscriptionCredentials: subscriptionStore(credentials),
        scrub: (text) => credentials.scrub(text),
        knownSecrets: () => credentials.knownSecrets(),
        now: () => clock.now().getTime(),
      });
  }
  modelReference(session?: string | null, workbench?: string | null): string {
    return resolveModelReference(
      session,
      workbench,
      this.defaultReference?.() ?? this.settings.get().settings.defaultModel,
    );
  }
  private track<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(veraError("DENIED"));
    const task = Promise.resolve().then(operation);
    this.active.add(task);
    void task.then(
      () => this.active.delete(task),
      () => this.active.delete(task),
    );
    return task;
  }
  discover(request: ProviderDiscoveryRequest) {
    return this.track(() =>
      discoverProvider(request, { settings: this.settings, credentials: this.credentials }),
    );
  }
  models(id: string): Promise<ProviderCatalog> {
    return this.track(async () => providerCatalogSchema.parse(await this.api.models(id)));
  }
  test(id: string, model?: string): Promise<ProviderTestResult> {
    return this.track(async () => {
      const before = this.settings.get().settings.providers.custom.find((c) => `custom:${c.slug}` === id);
      const result = providerTestResultSchema.parse(
        await testConnection(
          this.api,
          id,
          model,
          undefined,
          () => this.clock.now().getTime(),
          (text) => this.credentials.scrub(text),
        ),
      );
      const tools = result.steps.find((s) => s.step === "tools");
      if (before && (!model || model === before.model) && tools?.status !== "skipped")
        await this.providers.recordToolSupport(before, tools?.status === "pass");
      return result;
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    await Promise.allSettled([...this.active]);
  }
}
