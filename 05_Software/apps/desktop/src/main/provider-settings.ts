import type { SettingsService } from "@vera/core";
import {
  type ProviderList,
  type ProviderRemove,
  type ProviderSave,
  providerListSchema,
  providerRemoveSchema,
  providerSaveSchema,
  providerSlug,
  veraError,
} from "@vera/shared";
import type { CredentialFile } from "./credentials.js";

export function credentialHint(value: string | undefined): string | null {
  if (!value) return null;
  const characters = [...value];
  if (characters.length <= 7) return null;
  const hint = `${characters.slice(0, 3).join("")}…${characters.slice(-4).join("")}`;
  return hint === value ? null : hint;
}

/** Provider configuration and key writes live together in main; metadata is the public projection. */
export class ProviderSettings {
  private queue: Promise<void> = Promise.resolve();
  private closed = false;
  constructor(
    private readonly settings: SettingsService,
    private readonly credentials: CredentialFile,
  ) {}
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    if (this.closed) return Promise.reject(veraError("DENIED"));
    const run = this.queue.then(operation);
    this.queue = run.then(
      () => {},
      () => {},
    );
    return run;
  }
  async list(): Promise<ProviderList> {
    await this.credentials.load();
    const { settings, readOnly } = this.settings.get();
    if (this.credentials.containsSecret(settings.providers)) throw veraError("INVALID");
    const metadata = async (id: string, keyless = false) => {
      const credential = await this.credentials.read(id);
      const hint = credentialHint(credential?.type === "api_key" ? credential.key : undefined);
      return {
        configured: keyless || (credential?.type === "api_key" && !!credential.key),
        hint: this.credentials.containsSecret(hint) ? null : hint,
        storage: this.credentials.storage(id),
      };
    };
    const openai = {
      id: "openai" as const,
      ...(settings.providers.openai.model ? { model: settings.providers.openai.model } : {}),
      ...(await metadata("openai")),
    };
    const custom = await Promise.all(
      settings.providers.custom.map(async (config) => {
        const { name, slug, baseUrl, model, contextWindow, maxOutputTokens, supportsTools } = config;
        return {
          id: `custom:${slug}`,
          name,
          slug,
          baseUrl,
          model,
          contextWindow,
          maxOutputTokens,
          ...(supportsTools === undefined ? {} : { supportsTools }),
          ...(await metadata(`custom:${slug}`, true)),
        };
      }),
    );
    return providerListSchema.parse({
      openai,
      custom,
      secureStorage: this.credentials.secureStorage,
      readOnly,
    });
  }
  save(request: ProviderSave): Promise<{ status: "saved" | "consent-required" }> {
    // Submitted keys register even when configuration validation rejects the request.
    if (typeof request?.apiKey === "string") this.credentials.registerSecret(request.apiKey);
    const parsed = providerSaveSchema.safeParse(request);
    if (!parsed.success) return Promise.reject(veraError("INVALID"));
    return this.enqueue(async () => {
      const input = parsed.data;
      await this.credentials.load();
      const state = this.settings.get();
      if (state.readOnly) throw veraError("DENIED");
      const providers = structuredClone(state.settings.providers);
      let id = "openai";
      if (input.provider === "openai") {
        if (input.model === "") delete providers.openai.model;
        else if (input.model !== undefined) providers.openai = { ...providers.openai, model: input.model };
      } else {
        const found = input.id ? providers.custom.findIndex((c) => `custom:${c.slug}` === input.id) : -1;
        if (input.id && found < 0) throw veraError("NOT_FOUND");
        const slug = found >= 0 ? providers.custom[found]?.slug : providerSlug(input.config.name);
        if (!slug || slug.length > 80) throw veraError("INVALID");
        if (
          providers.custom.some(
            (c, i) =>
              i !== found && (c.name.toLowerCase() === input.config.name.toLowerCase() || c.slug === slug),
          )
        )
          throw veraError("CONFLICT");
        id = `custom:${slug}`;
        const config = {
          ...(found >= 0 ? providers.custom[found] : {}),
          ...JSON.parse(JSON.stringify(input.config)),
          slug,
        };
        if (found >= 0) providers.custom[found] = config;
        else providers.custom.push(config);
      }
      if (this.credentials.containsSecret(providers)) throw veraError("INVALID");
      if (input.apiKey && !this.credentials.secureStorage && input.storageConsent === undefined)
        return { status: "consent-required" };
      const restore = await this.credentials.checkpoint(id);
      let changed = false;
      try {
        if (input.apiKey !== undefined) {
          if (input.apiKey) {
            const key = input.apiKey;
            await this.credentials.modify(
              id,
              async () => ({ type: "api_key", key }),
              input.storageConsent === undefined ? {} : { storageConsent: input.storageConsent },
            );
          } else await this.credentials.delete(id);
          changed = true;
        }
        await this.settings.update({ providers });
      } catch {
        if (changed) await restore();
        throw veraError("INTERNAL");
      }
      return { status: "saved" };
    });
  }
  remove(request: ProviderRemove): Promise<Record<string, never>> {
    const parsed = providerRemoveSchema.safeParse(request);
    if (!parsed.success) return Promise.reject(veraError("INVALID"));
    return this.enqueue(async () => {
      await this.credentials.load();
      const state = this.settings.get();
      if (state.readOnly) throw veraError("DENIED");
      const { id } = parsed.data;
      const providers = structuredClone(state.settings.providers);
      if (id !== "openai") {
        if (!providers.custom.some((c) => `custom:${c.slug}` === id)) throw veraError("NOT_FOUND");
        providers.custom = providers.custom.filter((c) => `custom:${c.slug}` !== id);
      }
      const restore = await this.credentials.checkpoint(id);
      await this.credentials.delete(id);
      try {
        await this.settings.update({ providers });
      } catch {
        await restore();
        throw veraError("INTERNAL");
      }
      return {};
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
  }
}
