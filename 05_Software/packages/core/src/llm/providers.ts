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
  return {
    id,
    name: id,
    api: "openai-completions",
    provider,
    baseUrl: config.baseUrl.replace(/\/+$/, ""),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: config.contextWindow,
    maxTokens: config.maxOutputTokens,
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
function limits(model: Model<string>, supportsTools?: boolean, output?: number): ModelCapabilities {
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
      const model = models.getModel("openai", id);
      if (!model) throw veraError("NOT_FOUND");
      return { models, model, endpoint: model.baseUrl, supportsTools: undefined, slot: provider };
    }
    const custom = config(provider);
    const model = customModel(custom, provider, id);
    const models = createModels({ credentials: host.credentials });
    models.setProvider(customProvider(custom, provider, model));
    return { models, model, endpoint: custom.baseUrl, supportsTools: custom.supportsTools, slot: provider };
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
    selectedModel(provider) {
      if (provider === "chatgpt") {
        const current = host.settings().defaultModel;
        return current?.startsWith("chatgpt/")
          ? splitModelReference(current).model
          : (collections.subscription.getModels("openai")[0]?.id ?? "");
      }
      const model = provider === "openai" ? host.settings().providers.openai.model : config(provider).model;
      if (!model) throw veraError("INVALID");
      return model;
    },
    capabilities(reference, output) {
      const resolved = target(reference);
      return limits(resolved.model, resolved.supportsTools, output);
    },
    async models(provider, signal, probe = false) {
      let endpoint = "";
      try {
        if (provider === "openai" || provider === "chatgpt") {
          endpoint = "https://api.openai.com/v1";
          const models = provider === "chatgpt" ? collections.subscription : collections.api;
          if (
            provider === "chatgpt" &&
            (await host.credentials.read("chatgpt", signal ? { signal } : {}))?.type !== "oauth"
          )
            throw mapProviderError("", host.scrub, endpoint, { status: 401 });
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
        const resolved = target(request.model);
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
