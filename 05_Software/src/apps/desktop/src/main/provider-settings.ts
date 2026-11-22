import { randomUUID } from "node:crypto";
import {
  curatedTokenLimits,
  providerKeyMatches,
  resolveCuratedConnection,
  type SettingsService,
} from "@vera/core";
import {
  type CuratedProviderPreset,
  curatedProviderPresets,
  type ProviderList,
  type ProviderModelsEnable,
  type ProviderRemove,
  type ProviderSave,
  providerListSchema,
  providerModelsEnableSchema,
  providerRemoveSchema,
  providerSaveSchema,
  providerSlug,
  samePresetBinding,
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
    readonly presets: readonly CuratedProviderPreset[] = curatedProviderPresets,
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
    const { settings } = this.settings.get();
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
      ...(settings.providers.openai.enabledModels
        ? { enabledModels: settings.providers.openai.enabledModels }
        : {}),
      ...(await metadata("openai")),
    };
    const chatgpt = {
      id: "chatgpt" as const,
      ...(settings.providers.chatgpt?.enabledModels
        ? { enabledModels: settings.providers.chatgpt.enabledModels }
        : {}),
    };
    const custom = await Promise.all(
      settings.providers.custom.map(async (config) => {
        const id = `custom:${config.slug}`;
        const slot = config.preset ? resolveCuratedConnection(config, this.presets).slot : id;
        return { ...config, id, ...(await metadata(slot, !config.preset)) };
      }),
    );
    return providerListSchema.parse({
      openai,
      chatgpt,
      custom,
      secureStorage: this.credentials.secureStorage,
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
      const providers = structuredClone(state.settings.providers);
      let id = "openai";
      if (input.provider === "openai") {
        if (input.model === "") delete providers.openai.model;
        else if (input.model !== undefined) {
          const first = providers.openai.model === undefined;
          const changed = providers.openai.model !== input.model;
          providers.openai = { ...providers.openai, model: input.model };
          // A first model is the only one offered; a later new model joins the ticks; a list stays absent.
          providers.openai.enabledModels = tickChosen(
            providers.openai.enabledModels,
            input.model,
            first,
            changed,
          );
        }
      } else {
        const found = input.id ? providers.custom.findIndex((c) => `custom:${c.slug}` === input.id) : -1;
        if (input.id && found < 0) throw veraError("NOT_FOUND");
        const previous = providers.custom[found];
        if (previous && !samePresetBinding(previous.preset, input.config.preset)) throw veraError("DENIED");
        if (input.config.preset && input.config.supportsTools !== undefined) throw veraError("INVALID");
        const slug =
          previous?.slug ??
          (input.config.preset ? `preset-${randomUUID()}` : providerSlug(input.config.name));
        if (!slug || slug.length > 80) throw veraError("INVALID");
        if (
          providers.custom.some(
            (c, i) =>
              i !== found && (c.name.toLowerCase() === input.config.name.toLowerCase() || c.slug === slug),
          )
        )
          throw veraError("CONFLICT");
        id = `custom:${slug}`;
        const changes = JSON.parse(JSON.stringify(input.config)) as typeof input.config;
        const config = { ...previous, ...changes, slug };
        // A new connection offers only its chosen model; an edit keeps its ticks (or their absence) and adds a
        // changed active model to an existing list (RULING-001 of TASK-ec18086f).
        const ticks = tickChosen(
          changes.enabledModels ?? previous?.enabledModels,
          config.model,
          !previous && !changes.enabledModels,
          !!previous && previous.model !== config.model,
        );
        if (ticks) config.enabledModels = ticks;
        else delete config.enabledModels;
        if (config.preset) {
          const connection = resolveCuratedConnection(config, this.presets);
          id = connection.slot;
          const profile = connection.binding.models?.find((m) => m.id === config.model);
          Object.assign(config, curatedTokenLimits(config, profile, true));
          if (!previous && !input.apiKey) throw veraError("INVALID");
          if (
            input.apiKey &&
            (connection.binding.apiKeyPrefix || connection.binding.keyScope) &&
            !providerKeyMatches(connection.binding, input.apiKey)
          )
            throw {
              ...veraError("PROVIDER"),
              messageKey: connection.binding.keyScope ? "provider.serviceBindingAuth" : "provider.auth",
            };
          if (input.apiKey !== undefined || previous?.model !== config.model) delete config.supportsTools;
        }
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
      const { id } = parsed.data;
      let slot = id;
      const providers = structuredClone(state.settings.providers);
      if (id !== "openai") {
        const config = providers.custom.find((c) => `custom:${c.slug}` === id);
        if (!config) throw veraError("NOT_FOUND");
        if (config.preset) slot = resolveCuratedConnection(config, this.presets).slot;
        providers.custom = providers.custom.filter((c) => c.slug !== config.slug);
      }
      const restore = await this.credentials.checkpoint(slot);
      await this.credentials.delete(slot);
      try {
        await this.settings.update({ providers });
      } catch {
        await restore();
        throw veraError("INTERNAL");
      }
      return {};
    });
  }
  /** Writes the model ticks of several providers in one settings update; `null` offers a whole catalog. */
  enableModels(request: ProviderModelsEnable): Promise<Record<string, never>> {
    const parsed = providerModelsEnableSchema.safeParse(request);
    if (!parsed.success) return Promise.reject(veraError("INVALID"));
    return this.enqueue(async () => {
      await this.credentials.load();
      const providers = structuredClone(this.settings.get().settings.providers);
      const apply = <T extends { enabledModels?: string[] | undefined }>(
        target: T,
        models: string[] | null,
      ) => {
        if (models === null) delete target.enabledModels;
        else target.enabledModels = models;
      };
      for (const { id, models } of parsed.data.providers) {
        if (id === "openai") apply(providers.openai, models);
        else if (id === "chatgpt") {
          providers.chatgpt = { ...providers.chatgpt };
          apply(providers.chatgpt, models);
        } else {
          const config = providers.custom.find((c) => `custom:${c.slug}` === id);
          if (!config) throw veraError("NOT_FOUND");
          apply(config, models);
        }
      }
      // A model ID equal to a stored key would make every later list() refuse the settings.
      if (this.credentials.containsSecret(providers)) throw veraError("INVALID");
      try {
        await this.settings.update({ providers });
      } catch {
        throw veraError("INTERNAL");
      }
      return {};
    });
  }
  async close(): Promise<void> {
    this.closed = true;
    await this.queue;
  }
  recordToolSupport(
    config:
      | ProviderList["custom"][number]
      | ReturnType<SettingsService["get"]>["settings"]["providers"]["custom"][number],
    supportsTools: boolean,
    expectedKey?: string,
  ): Promise<void> {
    return this.enqueue(async () => {
      const state = this.settings.get();
      const current = state.settings.providers.custom.find((c) => c.slug === config.slug);
      if (!current || JSON.stringify(current) !== JSON.stringify(config)) return;
      if (current.preset) {
        const { slot } = resolveCuratedConnection(current, this.presets);
        const key = await this.credentials.read(slot);
        if (!expectedKey || key?.type !== "api_key" || key.key !== expectedKey) return;
      }
      const custom = state.settings.providers.custom.map((c) =>
        c.slug === config.slug ? { ...c, supportsTools } : c,
      );
      await this.settings.update({ providers: { ...state.settings.providers, custom } });
    });
  }
}

/**
 * The ticks after a save: `[model]` for a new connection or a first OpenAI model, the list plus a changed active
 * model, and otherwise the list as it was (an absent list stays absent, so the whole catalog stays offered).
 */
function tickChosen(
  list: string[] | undefined,
  model: string,
  first: boolean,
  changed: boolean,
): string[] | undefined {
  // A model ID with whitespace cannot form a model reference, so it is never offered.
  if (/\s/.test(model)) return list;
  if (!list) return first ? [model] : undefined;
  return changed && !list.includes(model) ? [...list, model] : list;
}
