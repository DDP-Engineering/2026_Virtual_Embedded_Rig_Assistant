// pi-ai side of the gateway (04 §7): Anthropic API, OpenAI API, custom OpenAI-compatible endpoint, ChatGPT
// subscription. Names below come from the installed package (docs/progress/P3.md §1), not from memory.
import {
  createModels,
  createProvider,
  type Context,
  type Model,
  type MutableModels,
  type Tool,
  type TSchema,
} from "@earendil-works/pi-ai";
import { openAICompletionsApi } from "@earendil-works/pi-ai/api/openai-completions.lazy";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { openaiProvider } from "@earendil-works/pi-ai/providers/openai";
import type { ProviderId } from "@benchpilot/shared";
import { credentialStoreView, type CredentialsFile, type SettingsFile } from "./credentials.ts";
import type { ConnectionResult, LlmEvent, LlmGateway, LlmStreamRequest, ProviderConfig } from "./gateway.ts";

const MAX_OUTPUT_TOKENS = 16_384;
/** Env vars pi-ai consults when no key is stored (README "Environment Variables"). */
const ENV_KEYS: Partial<Record<ProviderId, string>> = { anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY" };

export const CUSTOM_PROVIDER = "custom";

/** OpenAI-compatible endpoint (Azure OpenAI, LiteLLM, Ollama, vLLM …). Conservative compat flags: plain `system`
 * role, no `store`, no `reasoning_effort` — the common subset those servers accept. */
export function customModel(baseUrl: string, model: string): Model<"openai-completions"> {
  return {
    id: model,
    name: model,
    api: "openai-completions",
    provider: CUSTOM_PROVIDER,
    baseUrl: baseUrl.replace(/\/+$/, ""),
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 8_192,
    compat: { supportsStore: false, supportsDeveloperRole: false, supportsReasoningEffort: false },
  };
}

function customProvider(model: Model<"openai-completions"> | null, credentials: CredentialsFile) {
  return createProvider({
    id: CUSTOM_PROVIDER,
    name: "Custom endpoint",
    auth: {
      apiKey: {
        name: "Custom endpoint API key",
        // Keyless local servers (Ollama) are valid: the OpenAI SDK still wants a non-empty string.
        resolve: async ({ credential }) => ({ auth: { apiKey: credential?.key ?? credentials.apiKey("custom") ?? "not-needed" }, source: "custom" }),
      },
    },
    models: model ? [model] : [],
    api: openAICompletionsApi(),
  });
}

export interface PiAiDeps {
  settings: SettingsFile;
  credentials: CredentialsFile;
}

export interface PiAiCollections {
  /** anthropic, openai (API key) and custom; credential slots of the same name. */
  api: MutableModels;
  /** openai provider with the ChatGPT OAuth credential (slot `chatgpt`). */
  subscription: MutableModels;
}

export function createCollections(deps: PiAiDeps): PiAiCollections {
  const api = createModels({ credentials: credentialStoreView(deps.credentials, { anthropic: "anthropic", openai: "openai", custom: "custom" }) });
  api.setProvider(anthropicProvider());
  api.setProvider(openaiProvider());
  api.setProvider(customProvider(null, deps.credentials));
  const subscription = createModels({ credentials: credentialStoreView(deps.credentials, { openai: "chatgpt" }) });
  subscription.setProvider(openaiProvider());
  return { api, subscription };
}

/** Collection + pi-ai provider id + model for one of our provider ids. */
function resolve(cols: PiAiCollections, deps: PiAiDeps, cfg: ProviderConfig): { models: MutableModels; model: Model<string> } {
  const saved = deps.settings.read().providers;
  switch (cfg.provider) {
    case "anthropic":
    case "openai": {
      const id = cfg.model || saved[cfg.provider].model;
      const model = id ? cols.api.getModel(cfg.provider, id) : undefined;
      if (!model) throw new Error(`Unknown ${cfg.provider} model "${id ?? ""}".`);
      return { models: cols.api, model };
    }
    case "chatgpt": {
      if (deps.credentials.get("chatgpt")?.type !== "oauth") throw new Error("Not signed in with ChatGPT. Use “Sign in with ChatGPT” in Settings.");
      const id = cfg.model || saved.chatgpt.model;
      const model = id ? cols.subscription.getModel("openai", id) : undefined;
      if (!model) throw new Error(`Unknown ChatGPT model "${id ?? ""}".`);
      return { models: cols.subscription, model };
    }
    case "custom": {
      const baseUrl = cfg.baseUrl || saved.custom.baseUrl;
      const id = cfg.model || saved.custom.model;
      if (!baseUrl || !id) throw new Error("A custom endpoint needs a base URL and a model.");
      const model = customModel(baseUrl, id);
      cols.api.setProvider(customProvider(model, deps.credentials));
      return { models: cols.api, model };
    }
    case "replay":
      throw new Error("replay is not a pi-ai provider");
  }
}

/** Every secret we know of, for scrubbing provider error text before it reaches SSE, logs or the DB. */
function knownSecrets(deps: PiAiDeps, extra?: string): string[] {
  const out = new Set<string>();
  for (const slot of deps.credentials.slots()) {
    const c = deps.credentials.get(slot);
    if (c?.type === "api_key" && c.key) out.add(c.key);
    if (c?.type === "oauth") {
      out.add(c.access);
      out.add(c.refresh);
    }
  }
  for (const env of Object.values(ENV_KEYS)) if (process.env[env]) out.add(process.env[env]!);
  if (extra) out.add(extra);
  return [...out].filter((s) => s.length >= 8);
}

export function redact(text: string, secrets: string[]): string {
  let out = text;
  for (const s of secrets) out = out.split(s).join("••••");
  // Belt and braces: anything shaped like a provider key or bearer token.
  return out.replace(/\b(sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,})/g, "••••");
}

export const toPiTools = (tools: LlmStreamRequest["tools"]): Tool[] =>
  tools.map((t) => ({ name: t.name, description: t.description, parameters: t.parameters as unknown as TSchema }));

export function piAiGateway(deps: PiAiDeps, cols = createCollections(deps)): LlmGateway & { collections: PiAiCollections } {
  return {
    collections: cols,

    async *stream(req: LlmStreamRequest): AsyncIterable<LlmEvent> {
      let target: ReturnType<typeof resolve>;
      try {
        target = resolve(cols, deps, req.model);
      } catch (err) {
        yield { type: "error", message: (err as Error).message, aborted: false };
        return;
      }
      const context: Context = { systemPrompt: req.system, messages: req.messages, tools: toPiTools(req.tools) };
      const s = target.models.stream(target.model, context, {
        signal: req.signal,
        maxTokens: Math.min(MAX_OUTPUT_TOKENS, target.model.maxTokens),
        ...(req.sessionId ? { sessionId: req.sessionId } : {}),
      });
      for await (const e of s) {
        if (e.type === "text_delta") yield { type: "text", delta: e.delta };
        else if (e.type === "done") yield { type: "done", message: e.message };
        else if (e.type === "error")
          yield {
            type: "error",
            message: redact(e.error.errorMessage ?? (e.reason === "aborted" ? "aborted" : "provider error"), knownSecrets(deps)),
            aborted: e.reason === "aborted",
            partial: e.error,
          };
      }
    },

    async testConnection(cfg: ProviderConfig): Promise<ConnectionResult> {
      const started = Date.now();
      try {
        const target = resolve(cols, deps, cfg);
        const msg = await target.models.complete(
          target.model,
          { systemPrompt: "Connection test.", messages: [{ role: "user", content: "Reply with the single word OK.", timestamp: Date.now() }] },
          { maxTokens: 256, timeoutMs: 30_000, maxRetries: 0, ...(cfg.apiKey ? { apiKey: cfg.apiKey } : {}) },
        );
        const latencyMs = Date.now() - started;
        if (msg.stopReason === "error" || msg.stopReason === "aborted")
          return { ok: false, detail: redact(msg.errorMessage ?? "provider error", knownSecrets(deps, cfg.apiKey)), latencyMs };
        return { ok: true, detail: `Connection OK · ${target.model.id}`, latencyMs };
      } catch (err) {
        return { ok: false, detail: redact((err as Error).message, knownSecrets(deps, cfg.apiKey)) };
      }
    },
  };
}

/** Is a provider usable without further input? (Settings `configured`.) */
export function providerConfigured(deps: PiAiDeps, id: ProviderId): boolean {
  const saved = deps.settings.read().providers;
  switch (id) {
    case "replay":
      return true;
    case "chatgpt":
      return deps.credentials.get("chatgpt")?.type === "oauth";
    case "custom":
      return Boolean(saved.custom.baseUrl && saved.custom.model);
    case "anthropic":
    case "openai":
      return Boolean((deps.credentials.apiKey(id) || process.env[ENV_KEYS[id]!]) && saved[id].model);
  }
}

/** The key a provider will use (stored wins over env, as in pi-ai), for masking only. */
export function effectiveKey(deps: PiAiDeps, id: ProviderId): string | undefined {
  if (id === "anthropic" || id === "openai") return deps.credentials.apiKey(id) ?? process.env[ENV_KEYS[id]!] ?? undefined;
  if (id === "custom") return deps.credentials.apiKey("custom");
  return undefined;
}

/** Model choices for Settings: 04 §7 for Anthropic; the current OpenAI chat catalog otherwise. */
export function modelChoices(cols: PiAiCollections): Partial<Record<ProviderId, string[]>> {
  const openai = cols.api
    .getModels("openai")
    .map((m) => m.id)
    .filter((id) => /^gpt-(5\.[3-9]|6)/.test(id) && !/(pro|realtime|chat-latest|codex-spark)$/.test(id));
  return {
    anthropic: ["claude-sonnet-5-5", "claude-opus-5-5"],
    openai,
    chatgpt: openai,
  };
}
