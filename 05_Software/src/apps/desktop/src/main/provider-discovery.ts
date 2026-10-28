import type { SettingsService } from "@vera/core";
import {
  type ProviderDiscoveryRequest,
  providerDiscoveryRequestSchema,
  providerDiscoverySchema,
  veraError,
  veraErrorSchema,
} from "@vera/shared";
import { z } from "zod";
import type { CredentialFile } from "./credentials.js";

const positive = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const reasoning = z.string().regex(/^[a-z][a-z0-9_-]{0,31}$/);
const responseSchema = z.object({
  models: z
    .array(
      z.object({
        type: z.string(),
        key: z.string().min(1).max(200).regex(/^\S+$/),
        display_name: z.string().min(1).max(240),
        max_context_length: positive.nullish(),
        loaded_instances: z.array(z.object({ config: z.object({ context_length: positive }) })).max(1000),
        capabilities: z
          .object({
            trained_for_tool_use: z.boolean().optional(),
            reasoning: z
              .object({ allowed_options: z.array(reasoning).max(16), default: reasoning.optional() })
              .optional(),
          })
          .optional(),
      }),
    )
    .max(10000),
});

/** Read-only LM Studio discovery. Draft keys are never persisted or put in response data. */
export async function discoverProvider(
  input: ProviderDiscoveryRequest,
  host: {
    credentials: Pick<CredentialFile, "registerSecret" | "read" | "containsSecret">;
    settings: Pick<SettingsService, "get">;
    fetch?: typeof fetch;
  },
) {
  if (typeof input.apiKey === "string") host.credentials.registerSecret(input.apiKey);
  const request = providerDiscoveryRequestSchema.parse(input);
  const origin = new URL(request.endpoint).origin;
  let key = request.apiKey;
  if (request.savedId && key === undefined) {
    const saved = host.settings
      .get()
      .settings.providers.custom.find((p) => `custom:${p.slug}` === request.savedId);
    // A saved key may only return to the exact configured origin and path.
    if (!saved || saved.baseUrl.replace(/\/$/, "") !== `${origin}/v1`) throw veraError("DENIED");
    const credential = await host.credentials.read(request.savedId);
    if (credential?.type === "api_key") key = credential.key;
  }
  const signal = AbortSignal.timeout(10000);
  let response: Response;
  try {
    response = await (host.fetch ?? fetch)(`${origin}/api/v1/models`, {
      signal,
      redirect: "error",
      headers: key ? { Authorization: `Bearer ${key}` } : {},
    });
  } catch {
    throw veraError("OFFLINE");
  }
  if (response.status === 401 || response.status === 403) throw veraError("DENIED");
  if (response.status === 404) throw veraError("NOT_FOUND");
  if (!response.ok) throw veraError("PROVIDER");
  if (!response.body) throw veraError("PROVIDER");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "",
    length = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 2 * 1024 * 1024) {
        await reader.cancel();
        throw veraError("PROVIDER");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    if (host.credentials.containsSecret(text)) throw veraError("INVALID");
    const parsed = responseSchema.safeParse(JSON.parse(text));
    if (!parsed.success) throw veraError("PROVIDER");
    const models = parsed.data.models
      .filter((m) => m.type === "llm" || m.type === "vlm")
      .map((m) => ({
        id: m.key,
        name: m.display_name,
        reasoningOptions: [...new Set(m.capabilities?.reasoning?.allowed_options ?? [])],
        ...(m.capabilities?.reasoning?.default ? { reasoningDefault: m.capabilities.reasoning.default } : {}),
        ...(m.max_context_length ? { maxContextWindow: m.max_context_length } : {}),
        ...(m.loaded_instances.length
          ? { loadedContextWindow: Math.min(...m.loaded_instances.map((i) => i.config.context_length)) }
          : {}),
        ...(m.capabilities?.trained_for_tool_use !== undefined
          ? { supportsTools: m.capabilities.trained_for_tool_use }
          : {}),
      }));
    if (new Set(models.map((m) => m.id)).size !== models.length) throw veraError("PROVIDER");
    return providerDiscoverySchema.parse({ baseUrl: `${origin}/v1`, models });
  } catch (error) {
    if (veraErrorSchema.safeParse(error).success) throw error;
    throw veraError("PROVIDER");
  } finally {
    reader.releaseLock();
  }
}
