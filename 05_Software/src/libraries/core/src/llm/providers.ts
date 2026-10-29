import type { AssistantMessage, Model, TSchema } from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { createModels, createProvider, type MutableModels } from "@earendil-works/pi-ai/models";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import {
  customSettingsSchema,
  type ModelCapabilities,
  modelReferenceSchema,
  type Settings,
  veraError,
} from "@vera/shared";
import type { CredentialStore } from "../ports.js";
import { parseChatGptCatalog } from "./chatgpt-catalog.js";
import { mapProviderError, type ProviderFailure } from "./errors.js";
import { type LlmEvent, type LlmGateway, type LlmRequest, splitModelReference } from "./gateway.js";
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
}
type Custom = Settings["providers"]["custom"][number];
function customModel(config: Custom, provider: string, id = config.model): Model<"openai-completions"> {
  const profile = config.models?.find((m) => m.id === id);
  if (config.protocol === "lmstudio" && !profile) throw veraError("NOT_FOUND");
  return {
    id,
    name: profile?.name ?? id,
    api: "openai-completions",
    provider,
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    reasoning: !!profile?.reasoningOptions.length,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: profile?.contextWindow ?? config.contextWindow,
    maxTokens: profile?.maxOutputTokens ?? config.maxOutputTokens,
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false },
  };
}
function customProvider(custom: Custom, provider: string, model = customModel(custom, provider)) {
  return createProvider({
    id: provider,
    name: custom.name,
    models: [model],
    auth: {
      apiKey: {
        name: custom.name,
        resolve: async ({ credential }) => ({
          auth: {
            apiKey: credential?.type === "api_key" && credential.key ? credential.key : "not-needed",
          },
          source: "credential",
        }),
      },
    },
    api: openAICompletionsApi(),
  });
}
function limits(
  model: Model<string>,
  supportsTools?: boolean,
  output?: number,
  reasoningOptions: string[] = [],
): ModelCapabilities {
  if (output !== undefined && (!Number.isSafeInteger(output) || output <= 0)) throw veraError("INVALID");
  const safetyMargin = Math.max(1024, Math.ceil(model.contextWindow * 0.05));
  const effectiveMaximum =
    model.provider === "openai"
      ? Math.min(16384, model.maxTokens, model.contextWindow - safetyMargin - 1)
      : model.maxTokens;
  const maxOutputTokens = Math.min(output ?? effectiveMaximum, effectiveMaximum);
  const inputBudget = model.contextWindow - maxOutputTokens - safetyMargin;
  if (
    !Number.isSafeInteger(model.contextWindow) ||
    model.contextWindow <= 0 ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens <= 0 ||
    inputBudget <= 0
  )
    throw veraError("INVALID");
  return {
    contextWindow: model.contextWindow,
    maxOutputTokens,
    safetyMargin,
    inputBudget,
    ...(supportsTools !== undefined ? { supportsTools } : {}),
    ...(reasoningOptions.length ? { reasoningOptions: [...reasoningOptions] } : {}),
  };
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
function safeMessage(
  message: AssistantMessage,
  scrub: GatewayHost["scrub"],
  timestamp: number,
): AssistantMessage {
  const safe = (v: unknown): unknown =>
    typeof v === "string"
      ? scrub(v)
      : Array.isArray(v)
        ? v.map(safe)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), safe(x)]))
          : v;
  return {
    ...(safe(message) as AssistantMessage),
    role: message.role,
    api: message.api,
    stopReason: message.stopReason,
    usage: message.usage,
    timestamp,
    model: scrub(message.model),
    provider: scrub(message.provider),
    content: message.content.map((c) =>
      c.type === "text"
        ? { ...(safe(c) as typeof c), type: c.type, text: scrub(c.text) }
        : c.type === "thinking"
          ? { ...(safe(c) as typeof c), type: c.type, thinking: scrub(c.thinking) }
          : c.type === "toolCall"
            ? {
                ...(safe(c) as typeof c),
                type: c.type,
                id: scrub(c.id),
                name: scrub(c.name),
                arguments: safe(c.arguments) as typeof c.arguments,
              }
            : c,
    ),
    ...(message.errorMessage ? { errorMessage: scrub(message.errorMessage) } : {}),
  };
}
export function createPiAiGateway(
  host: GatewayHost,
): LlmGateway & { collections: ReturnType<typeof createCollections> } {
  const collections = createCollections(host.credentials, host.subscriptionCredentials);
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
      const endpoint = "https://chatgpt.com/backend-api/codex/models?client_version=0.162.1";
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
  const target = (reference: string) => {
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
      };
    }
    const custom = config(provider);
    const model = customModel(custom, provider, id);
    const models = createModels({ credentials: host.credentials });
    models.setProvider(customProvider(custom, provider, model));
    return {
      models,
      model,
      endpoint: custom.baseUrl,
      supportsTools: custom.models?.find((m) => m.id === id)?.supportsTools ?? custom.supportsTools,
      slot: provider,
      reasoningOptions:
        custom.protocol === "lmstudio"
          ? (custom.models?.find((m) => m.id === id)?.reasoningOptions ?? [])
          : [],
    };
  };
  const gateway: LlmGateway & { collections: typeof collections } = {
    get collections() {
      const snapshot = createCollections(host.credentials, host.subscriptionCredentials);
      for (const custom of host.settings().providers.custom) {
        const parsed = customSettingsSchema.parse(custom);
        snapshot.api.setProvider(customProvider(parsed, `custom:${parsed.slug}`));
      }
      return snapshot;
    },
    async prepareModel(reference, signal) {
      if (reference.startsWith("chatgpt/")) await chatgptModels(signal);
      target(reference);
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
      return limits(resolved.model, resolved.supportsTools, output, resolved.reasoningOptions);
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
      try {
        if (request.model.startsWith("chatgpt/")) await chatgptModels(request.signal);
        const resolved = target(request.model);
        let selectedReasoning = request.reasoning;
        if (selectedReasoning != null && !resolved.reasoningOptions.includes(selectedReasoning)) {
          if (request.sessionId) selectedReasoning = undefined;
          else {
            yield { type: "error", error: veraError("INVALID"), aborted: false };
            return;
          }
        }
        endpoint = resolved.endpoint;
        const capabilities = limits(resolved.model, resolved.supportsTools, request.maxOutputTokens);
        const key = await host.credentials.read(resolved.slot, { signal: request.signal });
        if (
          (resolved.slot === "openai" && (key?.type !== "api_key" || !key.key)) ||
          (resolved.slot === "chatgpt" && key?.type !== "oauth")
        ) {
          yield {
            type: "error",
            error: mapProviderError("", host.scrub, endpoint, { status: 401 }),
            aborted: false,
          };
          return;
        }
        const transport: typeof fetch = async (input, init) => {
          const url = new URL(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          );
          if (url.origin !== new URL(endpoint).origin) throw veraError("DENIED");
          try {
            const response = await (host.fetch ?? globalThis.fetch)(input, { ...init, redirect: "error" });
            if (!response.ok) {
              failure.status = response.status;
              failure.retryAfter = response.headers.get("retry-after") ?? undefined;
              const body = await response.clone().text();
              failure.context =
                /context[_ -]?(length|window)|maximum context|too many tokens|token limit/i.test(body);
            }
            return response;
          } catch (error) {
            if (!request.signal.aborted) failure.offline = true;
            throw error;
          }
        };
        const custom = resolved.slot.startsWith("custom:") ? config(resolved.slot) : undefined;
        const profile =
          custom?.protocol === "lmstudio"
            ? custom.models?.find((m) => m.id === resolved.model.id)
            : undefined;
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
        const stream = resolved.models.stream(
          resolved.model,
          {
            systemPrompt: request.system,
            messages: request.messages,
            tools: request.tools.map((t) => ({ ...t, parameters: t.parameters as unknown as TSchema })),
          },
          {
            signal: request.signal,
            maxTokens: capabilities.maxOutputTokens,
            timeoutMs: 30000,
            maxRetries: 0,
            fetch: transport,
            transport: "sse",
            ...(profile?.temperature === undefined ? {} : { temperature: profile.temperature }),
            ...(chosenReasoning === undefined
              ? {}
              : {
                  onPayload: (payload: unknown) => ({
                    ...(payload as Record<string, unknown>),
                    ...(resolved.model.api === "openai-completions"
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
        const textScrubber = createStreamScrubber(secrets, host.scrub);
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
              redactor = createStreamScrubber(secrets, host.scrub);
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
            if (event.type === "done")
              yield { type: "done", message: safeMessage(event.message, host.scrub, host.now()) };
            else
              yield {
                type: "error",
                error: mapProviderError(event.error.errorMessage ?? "", host.scrub, endpoint, failure),
                aborted: event.reason === "aborted",
                partial: safeMessage(event.error, host.scrub, host.now()),
              };
          }
        }
      } catch (error) {
        yield {
          type: "error",
          error: mapProviderError(error, host.scrub, endpoint, failure),
          aborted: request.signal.aborted,
        };
      }
    },
  };
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
