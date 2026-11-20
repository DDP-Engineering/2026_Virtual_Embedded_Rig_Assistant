import type { Clock, SettingsService } from "@vera/core";
import {
  createPiAiGateway,
  discoverPresetModels,
  type LlmGateway,
  resolveCuratedConnection,
  resolveModelReference,
  resolveProviderBinding,
  testConnection,
} from "@vera/core";
import {
  acceptsImages,
  type CuratedDiscovery,
  type CuratedDiscoveryRequest,
  curatedDiscoveryRequestSchema,
  curatedDiscoverySchema,
  isHostedCatalog,
  type ProviderCatalog,
  type ProviderDiscoveryRequest,
  type ProviderTestResult,
  providerCatalogSchema,
  providerTestResultSchema,
  samePresetBinding,
  veraError,
  veraErrorSchema,
} from "@vera/shared";
import type { CredentialFile } from "./credentials.js";
import { discoverProvider } from "./provider-discovery.js";
import type { ProviderSettings } from "./provider-settings.js";
import { subscriptionStore } from "./subscription-store.js";

/** Main owns gateway lifetime, current settings, credentials, and retained-secret scrubbing. */
export class ProviderGateway {
  readonly api: LlmGateway;
  private closed = false;
  private readonly lifetime = new AbortController();
  private readonly active = new Set<Promise<unknown>>();
  constructor(
    private readonly settings: SettingsService,
    private readonly credentials: CredentialFile,
    private readonly providers: ProviderSettings,
    private readonly clock: Clock,
    gateway?: LlmGateway,
    private readonly defaultReference?: () => string,
    private readonly fetcher?: typeof fetch,
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
        presets: providers.presets,
        ...(fetcher ? { fetch: fetcher } : {}),
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
  discoverPreset(input: CuratedDiscoveryRequest): Promise<CuratedDiscovery> {
    // The key is a local draft until providers.save. Register it for masking even if validation fails.
    if (typeof input?.apiKey === "string") this.credentials.registerSecret(input.apiKey);
    return this.track(async () => {
      const parsed = curatedDiscoveryRequestSchema.safeParse(input);
      if (!parsed.success) return { status: "failed", error: veraError("INVALID") };
      const request = parsed.data;
      const signal = this.lifetime.signal;
      try {
        const { binding } = resolveProviderBinding(this.providers.presets, request.preset);
        let key = request.apiKey;
        if (request.savedId) {
          const saved = this.settings
            .get()
            .settings.providers.custom.find((p) => `custom:${p.slug}` === request.savedId);
          if (!saved || !samePresetBinding(saved.preset, request.preset)) throw veraError("DENIED");
          const { slot } = resolveCuratedConnection(saved, this.providers.presets);
          if (key === undefined) {
            const credential = await this.credentials.read(slot, { signal });
            if (credential?.type === "api_key") key = credential.key;
          }
        }
        const result = await discoverPresetModels(
          binding,
          key,
          {
            scrub: (text) => this.credentials.scrub(text),
            ...(this.fetcher ? { fetch: this.fetcher } : {}),
          },
          signal,
        );
        return curatedDiscoverySchema.parse(result);
      } catch (failure) {
        const error = veraErrorSchema.safeParse(failure);
        return {
          status: "failed",
          error: error.success ? error.data : veraError(signal.aborted ? "DENIED" : "PROVIDER"),
        };
      }
    });
  }
  imageCapability(draftModel: string | null) {
    return this.track(async () => {
      const reference = this.modelReference(null, draftModel);
      await this.api.prepareModel?.(reference);
      return { acceptsImages: acceptsImages(this.api.capabilities(reference)) };
    });
  }
  models(id: string): Promise<ProviderCatalog> {
    return this.track(async () =>
      providerCatalogSchema.parse(await this.api.models(id, this.lifetime.signal)),
    );
  }
  test(id: string, model?: string): Promise<ProviderTestResult> {
    return this.track(async () => {
      const before = this.settings.get().settings.providers.custom.find((c) => `custom:${c.slug}` === id);
      const resolved = before?.preset ? resolveCuratedConnection(before, this.providers.presets) : undefined;
      const slot = resolved?.slot;
      const profile = resolved?.binding.models?.find(({ id }) => id === (model ?? before?.model));
      const hosted = isHostedCatalog(resolved?.binding.catalog);
      const testKey = slot ? await this.credentials.read(slot, { signal: this.lifetime.signal }) : undefined;
      const result = providerTestResultSchema.parse(
        await testConnection(
          this.api,
          id,
          model,
          this.lifetime.signal,
          () => this.clock.now().getTime(),
          (text) => this.credentials.scrub(text),
          profile?.reasoningOptions?.includes("off")
            ? { reasoning: "off" }
            : profile?.reasoningOptions?.includes("low")
              ? { reasoning: "low", maxOutputTokens: 4096 }
              : profile?.reasoningOptions?.includes("on")
                ? { reasoning: "on", maxOutputTokens: 4096 }
                : hosted && profile?.reasoning
                  ? { maxOutputTokens: 4096 }
                  : {},
        ),
      );
      const tools = result.steps.find((s) => s.step === "tools");
      if (before && (!model || model === before.model) && tools?.status !== "skipped") {
        if (!before.preset) await this.providers.recordToolSupport(before, tools?.status === "pass");
        // A manual entry without a profile can receive a fallback model response.
        // Hosted models report capabilities from catalog fields and exact documented profiles.
        else if (
          !hosted &&
          ((!resolved?.binding.keyScope && resolved?.binding.catalog.kind !== "manual") || profile) &&
          tools?.status === "pass" &&
          testKey?.type === "api_key" &&
          testKey.key
        )
          await this.providers.recordToolSupport(before, true, testKey.key);
      }
      return result;
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    this.lifetime.abort();
    await Promise.allSettled([...this.active]);
  }
}
