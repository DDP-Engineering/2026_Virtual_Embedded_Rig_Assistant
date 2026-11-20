import { randomUUID } from "node:crypto";
import type { Model, TSchema } from "@earendil-works/pi-ai";
import { anthropicMessagesApi } from "@earendil-works/pi-ai/api/anthropic-messages.lazy";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  type CuratedModel,
  type CuratedProviderPreset,
  curatedProviderPresets,
  customSettingsSchema,
  isHostedCatalog,
  isMiMoKeyScope,
  type ModelCapabilities,
  modelReferenceSchema,
  type ProviderCatalog,
  type Settings,
  veraError,
} from "@vera/shared";
import type { CredentialStore } from "../ports.js";
import { parseChatGptCatalog } from "./chatgpt-catalog.js";
import {
  directCompletionsCompatibility,
  hostedCompletionsCompatibility,
  isMiniMaxPreset,
  isZaiPreset,
  kimiMessagesCompatibility,
  miniMaxThinking,
  zaiCompletionsCompatibility,
} from "./curated-adapters.js";
import { mapProviderError, type ProviderFailure } from "./errors.js";
import { type LlmEvent, type LlmGateway, type LlmRequest, splitModelReference } from "./gateway.js";
import { scrubAssistantMessage } from "./message-scrub.js";
import { openCodeCompatibility } from "./opencode.js";
import { PresetCatalogCache } from "./preset-catalog-cache.js";
import {
  catalogListedModels,
  curatedTokenLimits,
  discoverPresetModels,
  openCodePlan,
  providerKeyMatches,
  readProviderJson,
  resolveCuratedConnection,
  usesPresetCatalog,
  usesRegionalCatalog,
} from "./preset-connection.js";
import { scrub } from "./scrub.js";
import { createStreamScrubber } from "./stream-scrub.js";

export type { AuthInteraction, Models } from "@earendil-works/pi-ai";
export type { MutableModels } from "@earendil-works/pi-ai/models";

export interface GatewayHost {
  settings(): Settings;
  credentials: CredentialStore;
  scrub(text: string): string;
  now(): number;
  fetch?: typeof fetch;
  knownSecrets?: () => readonly string[];
  subscriptionCredentials?: CredentialStore;
  presets?: readonly CuratedProviderPreset[];
}
type Custom = Settings["providers"]["custom"][number];
type CuratedConnection = ReturnType<typeof resolveCuratedConnection>;
function customModel(
  config: Custom,
  provider: string,
  id = config.model,
  curated?: CuratedModel,
): Model<"openai-completions"> {
  const profile = config.models?.find((m) => m.id === id);
  if (config.protocol === "lmstudio" && !profile) throw veraError("NOT_FOUND");
  return {
    id,
    name: curated?.name ?? profile?.name ?? id,
    api: "openai-completions",
    provider,
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    reasoning: curated?.reasoning ?? !!(curated?.reasoningOptions ?? profile?.reasoningOptions)?.length,
    input: curated?.input
      ? [...curated.input]
      : config.imageModels?.includes(id)
        ? ["text", "image"]
        : ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: profile?.contextWindow ?? config.contextWindow,
    maxTokens: profile?.maxOutputTokens ?? config.maxOutputTokens,
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false },
  };
}
function customProvider(
  custom: Custom,
  provider: string,
  model: Model<"openai-completions" | "anthropic-messages"> = customModel(custom, provider),
) {
  const messages = model.api === "anthropic-messages";
  return createProvider({
    id: provider,
    name: custom.name,
    models: [model],
    auth: {
      apiKey: {
        name: custom.name,
        resolve: async ({ credential }) => {
          // The Messages request supplies the scoped key as a header, avoiding SDK OAuth inference.
          if (messages) return { auth: {}, source: "credential" };
          const key = credential?.type === "api_key" && credential.key;
          if (custom.preset && !key) throw veraError("DENIED");
          return { auth: { apiKey: key || "not-needed" }, source: "credential" };
        },
      },
    },
    api: messages ? anthropicMessagesApi() : openAICompletionsApi(),
  });
}
function limits(
  model: Pick<Model<string>, "provider" | "input" | "contextWindow" | "maxTokens">,
  supportsTools?: boolean,
  output?: number,
  reasoningOptions: string[] = [],
  advertised?: Pick<CuratedModel, "maxInputTokens" | "maxOutputTokens">,
): ModelCapabilities {
  if (output !== undefined && (!Number.isSafeInteger(output) || output <= 0)) throw veraError("INVALID");
  const safetyMargin = Math.max(1024, Math.ceil(model.contextWindow * 0.05));
  const effectiveMaximum =
    model.provider === "openai"
      ? Math.min(16384, model.maxTokens, model.contextWindow - safetyMargin - 1)
      : model.maxTokens;
  const maxOutputTokens = Math.min(output ?? effectiveMaximum, effectiveMaximum);
  const inputBudget = Math.min(
    model.contextWindow - maxOutputTokens - safetyMargin,
    advertised?.maxInputTokens ?? Infinity,
  );
  if (
    !Number.isSafeInteger(model.contextWindow) ||
    model.contextWindow <= 0 ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens <= 0 ||
    inputBudget <= 0
  )
    throw veraError("INVALID");
  return {
    input: [...model.input],
    contextWindow: model.contextWindow,
    maxOutputTokens,
    ...(advertised?.maxInputTokens === undefined ? {} : { maxInputTokens: advertised.maxInputTokens }),
    ...(advertised?.maxOutputTokens === undefined
      ? {}
      : { providerMaxOutputTokens: advertised.maxOutputTokens }),
    safetyMargin,
    inputBudget,
    ...(supportsTools !== undefined ? { supportsTools } : {}),
    ...(reasoningOptions.length ? { reasoningOptions: [...reasoningOptions] } : {}),
  };
}
function containsCredential(value: unknown, key: string): boolean {
  if (typeof value === "string") return value.includes(key);
  if (Array.isArray(value)) return value.some((item) => containsCredential(item, key));
  if (value !== null && typeof value === "object")
    return Object.entries(value).some(([name, item]) => name.includes(key) || containsCredential(item, key));
  return (
    (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) &&
    String(value) === key
  );
}
export function createCollections(
  credentials: CredentialStore,
  subscriptionCredentials = credentials,
): {
  api: MutableModels;
  subscription: MutableModels;
} {
  const api = createModels({ credentials });
  const builtIn = openaiProvider();
  // Explicit store-only auth prevents upstream OPENAI_API_KEY/OAuth fallback in the API collection.
  api.setProvider({
    ...builtIn,
    auth: {
      apiKey: {
        name: "OpenAI API key",
        resolve: async ({ credential }) => {
          if (credential?.type !== "api_key" || !credential.key) throw veraError("PROVIDER");
          return { auth: { apiKey: credential.key }, source: "credential" };
        },
      },
    },
  });
  const subscription = createModels({
    credentials: {
      read: (_id, o) => subscriptionCredentials.read("chatgpt", o),
      list: async (o) =>
        (await subscriptionCredentials.list(o))
          .filter((c) => c.providerId === "chatgpt")
          .map((c) => ({ ...c, providerId: "openai" })),
      modify: (_id, fn, o) => subscriptionCredentials.modify("chatgpt", fn, o),
      delete: (_id, o) => subscriptionCredentials.delete("chatgpt", o),
    },
  });
  if (!builtIn.auth.oauth) throw veraError("INTERNAL");
  subscription.setProvider({ ...builtIn, auth: { oauth: builtIn.auth.oauth } });
  return { api, subscription };
}
export function createPiAiGateway(
  host: GatewayHost,
): LlmGateway & { collections: ReturnType<typeof createCollections> } {
  const collections = createCollections(host.credentials, host.subscriptionCredentials);
  const presets = host.presets ?? curatedProviderPresets;
  type Catalog = ReturnType<typeof parseChatGptCatalog>;
  let live: { token: string; until: number; models: Catalog } | undefined;
  let pending: { token: string; promise: Promise<Catalog> } | undefined;
  let generation = 0;
  async function chatgptModels(signal?: AbortSignal): Promise<Catalog> {
    signal?.throwIfAborted();
    const auth = await collections.subscription.getAuth("openai", signal ? { signal } : {});
    const token = auth?.auth.apiKey;
    if (!token) {
      live = undefined;
      generation++;
      throw veraError("PROVIDER");
    }
    const credential = await (host.subscriptionCredentials ?? host.credentials).read(
      "chatgpt",
      signal ? { signal } : {},
    );
    let account: unknown = credential?.type === "oauth" ? credential.accountId : undefined;
    if (account === undefined) {
      try {
        const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8"));
        account = claims["https://api.openai.com/auth"]?.chatgpt_account_id;
      } catch {
        /* Opaque access tokens have no optional account header. */
      }
    }
    const accountId =
      typeof account === "string" && /^[a-zA-Z0-9_-]{1,200}$/.test(account) ? account : undefined;
    const identity = `${token}/${accountId ?? ""}`;
    if (live && live.token !== identity) {
      live = undefined;
      generation++;
    }
    if (live?.token === identity && host.now() < live.until) return live.models;
    if (pending?.token === identity) return waitCatalog(pending.promise, signal);
    const current = ++generation;
    const promise = (async () => {
      const endpoint = "https://api.openai.com/v1/models";
      const response = await (host.fetch ?? globalThis.fetch)(endpoint, {
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          Authorization: `Bearer ${token}`,
          ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
        },
      });
      if (!response.ok) throw mapProviderError("", host.scrub, endpoint, { status: response.status });
      const models = parseChatGptCatalog(await response.json(), (id) =>
        collections.subscription.getModel("openai", id),
      );
      if (current !== generation) throw veraError("CONFLICT");
      const control = response.headers.get("cache-control") ?? "";
      const age = /(?:^|,)\s*max-age=(\d+)/i.exec(control)?.[1];
      const ttl = /(?:^|,)\s*(?:no-store|no-cache)\b/i.test(control)
        ? 0
        : Math.min(300000, age === undefined ? 300000 : Number(age) * 1000);
      live = { token: identity, until: host.now() + ttl, models };
      return models;
    })();
    pending = { token: identity, promise };
    void promise.then(
      () => {
        if (pending?.promise === promise) pending = undefined;
      },
      () => {
        if (pending?.promise === promise) pending = undefined;
      },
    );
    return waitCatalog(promise, signal);
  }
  function waitCatalog(promise: Promise<Catalog>, signal?: AbortSignal): Promise<Catalog> {
    if (!signal) return promise;
    signal.throwIfAborted();
    let abort: () => void;
    return new Promise<Catalog>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      void promise.then(resolve, reject);
    }).finally(() => signal.removeEventListener("abort", abort));
  }
  const config = (provider: string): Custom => {
    const found = host.settings().providers.custom.find((c) => `custom:${c.slug}` === provider);
    if (!found) throw veraError("NOT_FOUND");
    const parsed = customSettingsSchema.safeParse(found);
    if (!parsed.success) throw veraError("INVALID");
    return parsed.data;
  };
  const presetCatalogs = new PresetCatalogCache(host);
  function curatedTarget(
    custom: Custom,
    provider: string,
    id: string,
    connection = resolveCuratedConnection(custom, presets),
    profiles = presetCatalogs.profiles(connection.slot),
  ) {
    const plan = openCodePlan(connection.binding);
    const { qwenCloud, keyScope } = connection.binding;
    const catalogProfile = profiles?.get(id);
    const documented = connection.binding.models?.find((m) => m.id === id);
    const profile = catalogProfile ?? documented;
    const selected = id === custom.model;
    if (!selected && !(qwenCloud ? catalogProfile : profile)) {
      if (keyScope) throw { ...veraError("PROVIDER"), messageKey: "provider.scopedModelUnavailable" };
      throw veraError("NOT_FOUND");
    }
    const directCatalog =
      connection.binding.catalog.kind === "openai-models" && connection.binding.catalog.metadata;
    const hosted = isHostedCatalog(connection.binding.catalog);
    const { contextWindow, maxOutputTokens } = curatedTokenLimits(
      custom,
      profile,
      selected,
      hosted || !!plan || !!(directCatalog && catalogProfile),
    );
    const model = customModel(custom, provider, id, profile);
    const modelCompatibility = directCompletionsCompatibility(connection.preset.id, id);
    if (plan) model.compat = openCodeCompatibility(plan, id);
    else if (isZaiPreset(connection.preset.id)) {
      model.compat = { ...model.compat, ...zaiCompletionsCompatibility(id) };
    } else if (modelCompatibility) {
      model.compat = {
        ...model.compat,
        ...modelCompatibility,
        ...(model.reasoning ? { requiresReasoningContentOnAssistantMessages: true } : {}),
      };
      if (connection.preset.id === "deepseek") model.thinkingLevelMap = { off: null };
    }
    if (hosted) model.compat = { ...model.compat, ...hostedCompletionsCompatibility(connection.preset.id) };
    if (qwenCloud && !profile?.reasoningOptions)
      model.compat = { ...model.compat, maxTokensField: "max_tokens" };
    if (keyScope) {
      const mimo = isMiMoKeyScope(keyScope);
      model.compat = {
        ...model.compat,
        maxTokensField: mimo ? "max_completion_tokens" : "max_tokens",
        requiresReasoningContentOnAssistantMessages: model.reasoning,
      };
    }
    const configuredModel = { ...model, contextWindow, maxTokens: maxOutputTokens };
    const inferenceModel: Model<"openai-completions" | "anthropic-messages"> =
      connection.preset.protocol === "anthropic-messages"
        ? {
            ...configuredModel,
            api: "anthropic-messages",
            compat: isMiniMaxPreset(connection.preset.id) ? {} : kimiMessagesCompatibility(id),
          }
        : configuredModel;
    return {
      ...connection,
      profile,
      supportsTools: profile?.supportsTools ?? (selected && !hosted ? custom.supportsTools : undefined),
      model: inferenceModel,
      reasoningOptions: [...(profile?.reasoningOptions ?? [])],
    };
  }
  const target = (
    reference: string,
    prepared?: { connection: CuratedConnection; custom: Custom; profiles: Map<string, CuratedModel> },
  ) => {
    const { provider, model: id } = splitModelReference(reference);
    if (provider === "openai" || provider === "chatgpt") {
      const models = provider === "chatgpt" ? collections.subscription : collections.api;
      const current = provider === "chatgpt" ? live?.models.get(id) : undefined;
      const model =
        current?.model ?? (provider === "chatgpt" && live ? undefined : models.getModel("openai", id));
      if (!model) throw veraError("NOT_FOUND");
      return {
        models,
        model,
        endpoint: model.baseUrl,
        supportsTools: undefined,
        slot: provider,
        reasoningOptions: current?.reasoningOptions ?? [],
        curated: undefined,
        profile: undefined,
      };
    }
    const custom = prepared?.custom ?? config(provider);
    const curated = custom.preset
      ? curatedTarget(custom, provider, id, prepared?.connection, prepared?.profiles)
      : undefined;
    const model = curated?.model ?? customModel(custom, provider, id);
    const models = createModels(curated ? undefined : { credentials: host.credentials });
    models.setProvider(customProvider(custom, provider, model));
    return {
      models,
      model,
      endpoint: custom.baseUrl,
      supportsTools: curated
        ? curated.supportsTools
        : (custom.models?.find((m) => m.id === id)?.supportsTools ?? custom.supportsTools),
      slot: curated?.slot ?? provider,
      curated,
      profile: custom.protocol === "lmstudio" ? custom.models?.find((m) => m.id === id) : undefined,
      reasoningOptions:
        curated?.reasoningOptions ??
        (custom.protocol === "lmstudio"
          ? (custom.models?.find((m) => m.id === id)?.reasoningOptions ?? [])
          : []),
    };
  };
  const gateway: LlmGateway & { collections: typeof collections } = {
    get collections() {
      const snapshot = createCollections(host.credentials, host.subscriptionCredentials);
      for (const custom of host.settings().providers.custom) {
        const parsed = customSettingsSchema.parse(custom);
        if (parsed.preset) continue;
        snapshot.api.setProvider(customProvider(parsed, `custom:${parsed.slug}`));
      }
      return snapshot;
    },
    async prepareModel(reference, signal) {
      if (reference.startsWith("chatgpt/")) await chatgptModels(signal);
      const candidate = await preparePresetModel(reference, signal);
      target(reference, candidate);
    },
    selectedModel(provider) {
      if (provider === "chatgpt") {
        const current = host.settings().defaultModel;
        return current?.startsWith("chatgpt/")
          ? splitModelReference(current).model
          : (live?.models.values().next().value?.model.id ??
              collections.subscription.getModels("openai")[0]?.id ??
              "");
      }
      const model = provider === "openai" ? host.settings().providers.openai.model : config(provider).model;
      if (!model) throw veraError("INVALID");
      return model;
    },
    capabilities(reference, output) {
      const resolved = target(reference);
      return {
        ...limits(
          resolved.model,
          resolved.supportsTools,
          output,
          resolved.reasoningOptions,
          resolved.curated?.profile,
        ),
        ...(resolved.curated
          ? {
              inputVerified: !!resolved.curated.profile?.input,
              contextVerified: resolved.curated.profile?.contextWindow !== undefined,
            }
          : {}),
      };
    },
    async models(provider, signal, probe = false) {
      let endpoint = "";
      try {
        if (provider === "openai" || provider === "chatgpt") {
          endpoint = "https://api.openai.com/v1";
          if (provider === "chatgpt") {
            const catalog = await chatgptModels(signal);
            return {
              reachability: "pass",
              models: [...catalog.values()].map(({ model, reasoningOptions }) => ({
                id: host.scrub(model.id),
                name: host.scrub(model.name),
                reference: host.scrub(`chatgpt/${model.id}`),
                ...limits(model, undefined, undefined, reasoningOptions),
              })),
            };
          }
          const models = collections.api;
          const listed = probe && provider === "openai" ? await list(endpoint, provider, signal) : null;
          return {
            reachability: listed === null ? "skipped" : "pass",
            models: models.getModels("openai").map((m) => ({
              id: host.scrub(m.id),
              name: host.scrub(m.name),
              reference: host.scrub(`${provider}/${m.id}`),
              ...limits(m),
            })),
          };
        }
        const custom = config(provider);
        endpoint = custom.baseUrl;
        splitModelReference(`${provider}/${custom.model}`);
        if (custom.preset) {
          const connection = resolveCuratedConnection(custom, presets);
          let reachability: ProviderCatalog["reachability"] = "skipped";
          let profiles: Map<string, CuratedModel> | undefined;
          let listed = false;
          const { qwenCloud, keyScope } = connection.binding;
          if (usesPresetCatalog(connection.binding)) {
            const credential = await host.credentials.read(connection.slot, signal ? { signal } : {});
            const key = credential?.type === "api_key" ? credential.key : undefined;
            const snapshot = await presetCatalogs.load(connection, key, signal, probe);
            if (!openCodePlan(connection.binding))
              await verifyCatalogCredential(provider, connection, key, signal);
            const discovery = snapshot?.result;
            if (probe && !key)
              throw mapProviderError("", host.scrub, endpoint, {
                status: 401,
                ...(keyScope ? { scoped: { operation: "catalog" } } : {}),
                ...(qwenCloud ? { qwenCloud: { plan: qwenCloud, operation: "catalog" } } : {}),
              });
            if (probe && discovery?.status === "failed") throw discovery.error;
            if (
              discovery?.status === "discovered" ||
              (discovery?.status === "manual" &&
                (openCodePlan(connection.binding) || discovery.reason === "empty"))
            )
              reachability = "pass";
            profiles = snapshot?.profiles ?? new Map();
            listed = catalogListedModels(discovery);
          } else if (probe) {
            const credential = await host.credentials.read(connection.slot, signal ? { signal } : {});
            const discovery = await discoverPresetModels(
              connection.binding,
              credential?.type === "api_key" ? credential.key : undefined,
              host,
              signal,
            );
            if (discovery.status === "failed") throw discovery.error;
            if (discovery.status === "discovered" || discovery.reason === "empty") reachability = "pass";
          }
          const directCatalog =
            connection.binding.catalog.kind === "openai-models" && connection.binding.catalog.metadata;
          const ids = new Set([
            custom.model,
            ...(profiles?.keys() ?? []),
            ...(qwenCloud || ((directCatalog || usesRegionalCatalog(connection.binding)) && listed)
              ? []
              : (connection.binding.models?.map(({ id }) => id) ?? [])),
          ]);
          return {
            reachability,
            models: [...ids].slice(0, 10001).map((id) => {
              const { model, profile, supportsTools, reasoningOptions } = curatedTarget(
                custom,
                provider,
                id,
                connection,
                profiles,
              );
              if (host.scrub(id) !== id) throw veraError("INVALID");
              const service = [
                connection.preset.label,
                connection.binding.label ?? (keyScope ? connection.binding.id : undefined),
              ]
                .filter(Boolean)
                .join(" · ");
              const label = custom.name === connection.preset.label ? service : `${service} · ${custom.name}`;
              return {
                id,
                name: host.scrub(model.name),
                reference: host.scrub(`${provider}/${id}`),
                providerName: host.scrub(label),
                curated: true,
                inputVerified: !!profile?.input,
                contextVerified: profile?.contextWindow !== undefined,
                ...limits(model, supportsTools, undefined, reasoningOptions, profile),
                ...(profile?.reasoningOptions ? { reasoningOptions } : {}),
              };
            }),
          };
        }
        if (custom.protocol === "lmstudio" && custom.models) {
          const listed = probe ? await list(endpoint, provider, signal) : null;
          return {
            reachability: listed === null ? "skipped" : "pass",
            models: custom.models.map((profile) => ({
              id: host.scrub(profile.id),
              name: host.scrub(profile.name),
              reference: host.scrub(`${provider}/${profile.id}`),
              ...limits(
                customModel(custom, provider, profile.id),
                profile.supportsTools,
                undefined,
                profile.reasoningOptions,
              ),
            })),
          };
        }
        const ids = await list(endpoint, provider, signal);
        return {
          reachability: ids === null ? "skipped" : "pass",
          models: [...new Set([custom.model, ...(ids ?? [])])].map((id) => ({
            id: host.scrub(id),
            name: host.scrub(id),
            reference: host.scrub(`${provider}/${id}`),
            ...limits(customModel(custom, provider, id), custom.supportsTools),
          })),
        };
      } catch (error) {
        throw mapProviderError(error, host.scrub, endpoint);
      }
    },
    async *stream(request: LlmRequest): AsyncIterable<LlmEvent> {
      let endpoint = "";
      const failure: ProviderFailure = {};
      let redact = host.scrub;
      try {
        if (request.model.startsWith("chatgpt/")) await chatgptModels(request.signal);
        const prepared = await preparePresetModel(request.model, request.signal);
        const resolved = target(request.model, prepared);
        const binding = resolved.curated?.binding;
        const openCode = binding && openCodePlan(binding);
        const qwenCloud = binding?.qwenCloud;
        const keyScope = binding?.keyScope;
        const mimo = isMiMoKeyScope(keyScope);
        const alibaba = keyScope === "model-studio" || keyScope === "alibaba-coding";
        const messages = resolved.curated?.preset.protocol === "anthropic-messages";
        const presetId = resolved.curated?.preset.id;
        const deepSeek = presetId === "deepseek";
        const miniMax = isMiniMaxPreset(presetId);
        const zai = isZaiPreset(presetId);
        if (keyScope) failure.scoped = { operation: "inference" };
        if (qwenCloud) failure.qwenCloud = { plan: qwenCloud, operation: "inference" };
        let selectedReasoning = request.reasoning;
        if (selectedReasoning != null && !resolved.reasoningOptions.includes(selectedReasoning)) {
          if (request.sessionId) selectedReasoning = undefined;
          else {
            yield { type: "error", error: veraError("INVALID"), aborted: false };
            return;
          }
        }
        endpoint = resolved.endpoint;
        const capabilities = limits(
          resolved.model,
          resolved.supportsTools,
          request.maxOutputTokens,
          [],
          resolved.curated?.profile,
        );
        const key = prepared
          ? prepared.credential
          : await host.credentials.read(resolved.slot, { signal: request.signal });
        const curatedKey = resolved.curated && key?.type === "api_key" ? key.key : undefined;
        if (curatedKey) redact = (text) => host.scrub(scrub(text, [curatedKey]));
        const locallyMaskedKey = curatedKey && host.scrub(curatedKey) === curatedKey ? curatedKey : undefined;
        request.signal.throwIfAborted();
        if (
          (resolved.curated && !curatedKey) ||
          (binding && curatedKey && !providerKeyMatches(binding, curatedKey)) ||
          (resolved.slot === "openai" && (key?.type !== "api_key" || !key.key)) ||
          (resolved.slot === "chatgpt" && key?.type !== "oauth")
        ) {
          yield {
            type: "error",
            error: mapProviderError("", host.scrub, endpoint, { ...failure, status: 401 }),
            aborted: false,
          };
          return;
        }
        const transport: typeof fetch = async (input, init) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          );
          if (resolved.curated) {
            const method = init?.method ?? (input instanceof Request ? input.method : "GET");
            // The pinned Messages SDK uses its beta resource for streaming.
            const route = messages ? "/v1/messages?beta=true" : "/chat/completions";
            if (method !== "POST" || url.href !== endpoint + route) throw veraError("DENIED");
          } else if (url.origin !== new URL(endpoint).origin) throw veraError("DENIED");
          const fetcher = host.fetch ?? globalThis.fetch;
          if (miniMax) {
            // Forward the fixed MiniMax Messages path without the SDK's beta query marker.
            url.search = "";
            input = input instanceof Request ? new Request(url, input) : url;
          }
          request.signal.throwIfAborted();
          try {
            const response = await fetcher(input, { ...init, redirect: "error" });
            if (!response.ok) {
              failure.status = response.status;
              failure.retryAfter = response.headers.get("retry-after") ?? undefined;
              if (openCode || qwenCloud || keyScope) {
                const copy = response.clone();
                const signal = AbortSignal.any([request.signal, AbortSignal.timeout(1000)]);
                const body = await readProviderJson(copy, signal, 16384).catch(() => undefined);
                if (keyScope) failure.scoped = { operation: "inference", body };
                if (openCode) failure.openCode = { operation: "inference", body };
                if (qwenCloud) failure.qwenCloud = { plan: qwenCloud, operation: "inference", body };
              } else {
                const body = await response.clone().text();
                failure.context =
                  /context[_ -]?(length|window)|maximum context|too many tokens|token limit/i.test(body);
              }
            }
            return response;
          } catch (error) {
            if (!request.signal.aborted) failure.offline = true;
            throw error;
          }
        };
        const profile = resolved.profile;
        const chosenReasoning = selectedReasoning ?? profile?.reasoning;
        // LM Studio's OpenAI-compatible route uses "none" for native "off".
        const reasoningEffort =
          chosenReasoning === "off"
            ? "none"
            : chosenReasoning === "on"
              ? profile?.reasoningDefault && !["off", "on"].includes(profile.reasoningDefault)
                ? profile.reasoningDefault
                : "medium"
              : chosenReasoning;
        const zaiEffort =
          zai && resolved.model.reasoning
            ? chosenReasoning === "low" || chosenReasoning === "high"
              ? chosenReasoning
              : "max"
            : undefined;
        const stream = resolved.models.stream(
          resolved.model,
          {
            systemPrompt: request.system,
            messages: request.messages,
            tools: request.tools
              .filter(({ name }) => request.toolAvailable?.(name) !== false)
              .map((t) => ({ ...t, parameters: t.parameters as unknown as TSchema })),
          },
          {
            signal: request.signal,
            ...(curatedKey && !messages ? { apiKey: curatedKey } : {}),
            ...(messages && curatedKey
              ? {
                  headers: { "x-api-key": curatedKey, "User-Agent": "VERA", "anthropic-beta": null },
                  cacheRetention: "none",
                  ...(!miniMax && resolved.model.reasoning
                    ? { thinkingEnabled: true, effort: chosenReasoning }
                    : {}),
                }
              : {}),
            ...(openCode
              ? { headers: { "User-Agent": "VERA", "x-opencode-session": request.sessionId ?? randomUUID() } }
              : {}),
            maxTokens: capabilities.maxOutputTokens,
            timeoutMs: 30000,
            maxRetries: 0,
            fetch: transport,
            transport: "sse",
            ...(profile?.temperature === undefined ? {} : { temperature: profile.temperature }),
            ...(zaiEffort ? { reasoningEffort: zaiEffort } : {}),
            ...(miniMax && chosenReasoning !== undefined
              ? {
                  onPayload: (payload: unknown) => ({
                    ...(payload as Record<string, unknown>),
                    ...miniMaxThinking(resolved.model.id, chosenReasoning),
                  }),
                }
              : {}),
            ...(messages || zai || chosenReasoning === undefined
              ? {}
              : {
                  onPayload: (payload: unknown) => ({
                    ...(payload as Record<string, unknown>),
                    ...(qwenCloud || alibaba
                      ? { enable_thinking: chosenReasoning === "on" }
                      : mimo
                        ? { thinking: { type: chosenReasoning === "on" ? "enabled" : "disabled" } }
                        : deepSeek
                          ? chosenReasoning === "off"
                            ? { thinking: { type: "disabled" } }
                            : { thinking: { type: "enabled" }, reasoning_effort: reasoningEffort }
                          : resolved.model.api === "openai-completions"
                            ? { reasoning_effort: reasoningEffort }
                            : {
                                reasoning: {
                                  ...((payload as { reasoning?: object }).reasoning ?? {}),
                                  effort: reasoningEffort,
                                },
                              }),
                  }),
                }),
            ...(request.sessionId ? { sessionId: request.sessionId } : {}),
          },
        );
        const secrets = () => [
          ...(host.knownSecrets?.() ?? []),
          ...(key?.type === "api_key" && key.key ? [key.key] : []),
          ...(key?.type === "oauth" ? [key.access, key.refresh] : []),
        ];
        const outputScrub = (text: string) => (request.maskOutput?.() === false ? text : redact(text));
        const textScrubber = createStreamScrubber(secrets, redact, request.maskOutput);
        let sourceDeltas = 0;
        const toolScrubbers = new Map<number, ReturnType<typeof createStreamScrubber>>();
        for await (const event of stream) {
          if (event.type === "text_delta") {
            if (event.delta) sourceDeltas++;
            const delta = textScrubber.push(event.delta);
            if (delta) yield { type: "text", delta, sourceDeltas };
          } else if (event.type === "toolcall_delta") {
            let redactor = toolScrubbers.get(event.contentIndex);
            if (!redactor) {
              redactor = createStreamScrubber(secrets, redact, request.maskOutput);
              toolScrubbers.set(event.contentIndex, redactor);
            }
            const delta = redactor.push(event.delta);
            if (delta) yield { type: "tool", index: event.contentIndex, delta };
          } else if (event.type === "done" || event.type === "error") {
            const tail = textScrubber.flush();
            if (tail) yield { type: "text", delta: tail, sourceDeltas };
            for (const [index, redactor] of toolScrubbers) {
              const delta = redactor.flush();
              if (delta) yield { type: "tool", index, delta };
            }
            // Raw tool calls reach the runtime. A key known only to this request cannot be masked there.
            if (locallyMaskedKey && request.maskOutput?.() !== false) {
              const terminal = event.type === "done" ? event.message : event.error;
              const keyInCall = terminal.content.some(
                (content) =>
                  content.type === "toolCall" &&
                  containsCredential([content.id, content.name, content.arguments], locallyMaskedKey),
              );
              if (keyInCall) {
                yield { type: "error", error: veraError("INVALID"), aborted: request.signal.aborted };
                return;
              }
            }
            if (event.type === "done")
              yield {
                type: "done",
                message: scrubAssistantMessage(event.message, outputScrub, host.now(), true, redact),
              };
            else
              yield {
                type: "error",
                error: mapProviderError(event.error.errorMessage ?? "", redact, endpoint, failure),
                aborted: event.reason === "aborted",
                partial: {
                  ...scrubAssistantMessage(event.error, outputScrub, host.now(), true, redact),
                  errorMessage: redact(event.error.errorMessage ?? ""),
                },
              };
          }
        }
      } catch (error) {
        yield {
          type: "error",
          error: mapProviderError(error, redact, endpoint, failure),
          aborted: request.signal.aborted,
        };
      }
    },
  };
  async function preparePresetModel(reference: string, signal?: AbortSignal) {
    const { provider, model } = splitModelReference(reference);
    if (!provider.startsWith("custom:")) return;
    const custom = config(provider);
    if (!custom.preset) return;
    const connection = resolveCuratedConnection(custom, presets);
    const { qwenCloud, keyScope } = connection.binding;
    if (!usesPresetCatalog(connection.binding)) return;
    const credential = await host.credentials.read(connection.slot, signal ? { signal } : {});
    const key = credential?.type === "api_key" ? credential.key : undefined;
    const snapshot = await presetCatalogs.load(connection, key, signal);
    const { current, latest } = await verifyCatalogCredential(provider, connection, key, signal);
    if (
      snapshot?.result.status === "failed" &&
      snapshot.result.error.messageKey === "provider.workspaceUnavailable"
    )
      throw snapshot.result.error;
    const profiles = snapshot?.profiles ?? new Map<string, CuratedModel>();
    const documentedModel =
      ((connection.binding.catalog.kind === "openai-models" && connection.binding.catalog.metadata) ||
        usesRegionalCatalog(connection.binding)) &&
      !catalogListedModels(snapshot?.result) &&
      connection.binding.models?.some(({ id }) => id === model);
    if (model !== current.model && !profiles.has(model) && !documentedModel) {
      if (snapshot?.result.status === "failed") throw snapshot.result.error;
      if (!key)
        throw mapProviderError("", host.scrub, connection.binding.inference, {
          status: 401,
          ...(keyScope ? { scoped: { operation: "inference" } } : {}),
          ...(qwenCloud ? { qwenCloud: { plan: qwenCloud, operation: "inference" } } : {}),
        });
      if (keyScope) throw { ...veraError("PROVIDER"), messageKey: "provider.scopedModelUnavailable" };
      if (!qwenCloud && !openCodePlan(connection.binding)) throw veraError("NOT_FOUND");
      throw {
        ...veraError("PROVIDER"),
        messageKey: qwenCloud ? "provider.qwenCloudModel" : "provider.openCodePlan",
      };
    }
    return { credential: latest, profiles, connection, custom: current };
  }
  async function verifyCatalogCredential(
    provider: string,
    connection: CuratedConnection,
    key: string | undefined,
    signal?: AbortSignal,
  ) {
    const current = config(provider);
    if (resolveCuratedConnection(current, presets).slot !== connection.slot) throw veraError("CONFLICT");
    const latest = await host.credentials.read(connection.slot, signal ? { signal } : {});
    if ((latest?.type === "api_key" ? latest.key : undefined) !== key) {
      presetCatalogs.invalidate(connection.slot, key);
      throw veraError("CONFLICT");
    }
    return { current, latest };
  }
  async function list(endpoint: string, provider: string, signal?: AbortSignal): Promise<string[] | null> {
    const key = await host.credentials.read(provider, signal ? { signal } : {});
    if (provider === "openai" && (key?.type !== "api_key" || !key.key))
      throw mapProviderError("", host.scrub, endpoint, { status: 401 });
    let response: globalThis.Response;
    try {
      response = await (host.fetch ?? globalThis.fetch)(`${endpoint.replace(/\/+$/, "")}/models`, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        redirect: "error",
        headers: key?.type === "api_key" && key.key ? { Authorization: `Bearer ${key.key}` } : {},
      });
    } catch (error) {
      throw mapProviderError(error, host.scrub, endpoint, { offline: true });
    }
    if ([404, 405, 501].includes(response.status)) return null;
    if (!response.ok)
      throw mapProviderError(await response.text(), host.scrub, endpoint, {
        status: response.status,
        retryAfter: response.headers.get("retry-after") ?? undefined,
      });
    const body: unknown = await response.json();
    if (
      !body ||
      typeof body !== "object" ||
      !("data" in body) ||
      !Array.isArray(body.data) ||
      body.data.length > 10000
    )
      throw mapProviderError("", host.scrub, endpoint);
    return body.data.map((m: unknown) => {
      if (
        !m ||
        typeof m !== "object" ||
        !("id" in m) ||
        typeof m.id !== "string" ||
        !m.id.trim() ||
        m.id.length > 200 ||
        !modelReferenceSchema.safeParse(`${provider}/${m.id}`).success
      )
        throw mapProviderError("", host.scrub, endpoint);
      return m.id;
    });
  }
  return gateway;
}
