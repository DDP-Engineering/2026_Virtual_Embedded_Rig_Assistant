import { createHash } from "node:crypto";
import {
  bindProviderWorkspace,
  type CuratedDiscovery,
  type CuratedModel,
  type CuratedProviderPreset,
  curatedInferenceSchema,
  curatedModelIdSchema,
  type PresetBinding,
  type ProviderBinding,
  providerTokenDefaults,
  type QwenCloudPlan,
  type Settings,
  veraError,
} from "@vera/shared";
import { z } from "zod";
import { parseDirectCatalog } from "./direct-catalog.js";
import { mapProviderError } from "./errors.js";
import { parseOpenCodeCatalog } from "./opencode.js";
import { scrub } from "./scrub.js";

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
export const openCodePlan = (binding: ProviderBinding) =>
  binding.catalog.kind === "openai-models" ? binding.catalog.opencode : undefined;

export const usesRegionalCatalog = (binding: ProviderBinding) =>
  binding.catalog.kind !== "manual" && binding.keyScope !== undefined;

export const usesPresetCatalog = (binding: ProviderBinding) =>
  usesRegionalCatalog(binding) ||
  (binding.catalog.kind === "openai-models" &&
    !!(binding.catalog.opencode || binding.catalog.metadata || binding.qwenCloud));

export function providerKeyMatches(binding: ProviderBinding, key: string): boolean {
  if (binding.apiKeyPrefix && !key.startsWith(binding.apiKeyPrefix)) return false;
  if (binding.qwenCloud && !qwenCloudKeyMatches(binding.qwenCloud, key)) return false;
  switch (binding.keyScope) {
    case "model-studio":
      return key.startsWith("sk-") && !key.startsWith("sk-sp-");
    case "alibaba-coding":
      return key.startsWith("sk-sp-");
    case "mimo-api":
      return key.startsWith("sk-");
    case "mimo-token":
      return key.startsWith("tp-") || key.startsWith("ttp-");
    default:
      return true;
  }
}

/** A dedicated Token Plan key cannot be used as a Standard key or vice versa. */
export function qwenCloudKeyMatches(plan: QwenCloudPlan, key: string): boolean {
  return key.startsWith("sk-sp-") === (plan === "token-plan");
}

export const catalogListedModels = (discovery: CuratedDiscovery | undefined) =>
  discovery?.status === "discovered" || (discovery?.status === "manual" && discovery.reason === "empty");

const catalogSchema = z.object({ data: z.array(z.object({ id: curatedModelIdSchema })).max(10000) });
const studioCatalogSchema = z.object({
  success: z.literal(true),
  output: z.object({
    models: z
      .array(
        z.object({
          model: curatedModelIdSchema,
          capabilities: z.array(z.string()).nullish(),
          inference_metadata: z
            .object({
              request_modality: z.array(z.string()).nullish(),
              response_modality: z.array(z.string()).nullish(),
            })
            .nullish(),
        }),
      )
      .max(100),
  }),
});

function studioModelIds(body: unknown) {
  return studioCatalogSchema
    .parse(body)
    .output.models.filter(
      ({ capabilities, inference_metadata: modalities }) =>
        capabilities?.includes("TG") ||
        (modalities?.request_modality?.includes("Text") && modalities.response_modality?.includes("Text")),
    )
    .map(({ model }) => model);
}

export function resolveProviderBinding(presets: readonly CuratedProviderPreset[], selection: PresetBinding) {
  const preset = presets.find(({ id }) => id === selection.id);
  const definition = preset?.bindings.find(({ id }) => id === selection.binding);
  if (!preset || !definition) {
    if (preset?.bindings.some(({ region }) => region !== undefined))
      throw { ...veraError("NOT_FOUND"), messageKey: "provider.serviceBindingInvalid" };
    throw veraError("NOT_FOUND");
  }
  const binding = bindProviderWorkspace(definition, selection.workspaceId);
  if (!binding) {
    if (definition.workspace) throw { ...veraError("INVALID"), messageKey: "provider.workspaceInvalid" };
    if (definition.keyScope) throw { ...veraError("DENIED"), messageKey: "provider.serviceBindingInvalid" };
    throw veraError("DENIED");
  }
  if (!curatedInferenceSchema.safeParse(binding.inference).success) throw veraError("INVALID");
  if (binding.catalog.kind !== "manual") {
    const { url } = binding.catalog;
    if (!curatedInferenceSchema.safeParse(url).success) throw veraError("INVALID");
  }
  return { preset, binding };
}

/** Resolve the fixed routes and the private slot together before a saved key can be read. */
export function resolveCuratedConnection(
  config: Settings["providers"]["custom"][number],
  presets: readonly CuratedProviderPreset[],
) {
  if (!config.preset) throw veraError("INVALID");
  const { preset, binding } = resolveProviderBinding(presets, config.preset);
  if (binding.inference !== config.baseUrl) {
    if (binding.keyScope) throw { ...veraError("DENIED"), messageKey: "provider.serviceBindingInvalid" };
    throw veraError("DENIED");
  }
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        preset.id,
        binding.id,
        preset.protocol,
        preset.authentication,
        binding.inference,
        binding.catalog.kind,
        binding.catalog.kind === "manual" ? null : binding.catalog.url,
      ]),
    )
    .digest("hex");
  return { preset, binding, slot: `preset:${config.slug}:${scope}` };
}

/** Merge verified limits and the saved draft; other profiles use independent defaults. */
export function curatedTokenLimits(
  configured: { contextWindow: number; maxOutputTokens: number },
  profile: CuratedModel | undefined,
  selected: boolean,
  live = false,
) {
  const fallback = selected ? configured : providerTokenDefaults;
  const contextWindow = profile?.contextWindow ?? fallback.contextWindow;
  const profileOutput =
    profile?.outputBudget === undefined
      ? profile?.maxOutputTokens
      : Math.min(profile.outputBudget, profile.maxOutputTokens ?? Infinity);
  const requestedOutput = live
    ? Math.min(fallback.maxOutputTokens, profileOutput ?? Infinity)
    : (profileOutput ?? fallback.maxOutputTokens);
  const ceiling = contextWindow - Math.max(1024, Math.ceil(contextWindow * 0.05)) - 1;
  const maxOutputTokens = selected && !live ? requestedOutput : Math.min(requestedOutput, ceiling);
  if (
    !Number.isSafeInteger(contextWindow) ||
    !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens <= 0 ||
    maxOutputTokens > ceiling
  )
    throw veraError("INVALID");
  return { contextWindow, maxOutputTokens };
}

/** Read a curated catalog from its registry URL; callers resolve the key before entering. */
export async function discoverPresetModels(
  binding: ProviderBinding,
  key: string | undefined,
  host: { fetch?: typeof fetch; scrub(text: string): string },
  signal?: AbortSignal,
): Promise<CuratedDiscovery> {
  if (signal?.aborted) return { status: "failed", error: veraError("DENIED") };
  const { catalog, keyScope, qwenCloud } = binding;
  if (catalog.kind === "manual" && (!key || !keyScope || providerKeyMatches(binding, key)))
    return { status: "manual", reason: "configured" };
  const nativeStudio = catalog.kind === "alibaba-models";
  const opencode = catalog.kind === "openai-models" ? catalog.opencode : undefined;
  const metadata = catalog.kind === "openai-models" ? catalog.metadata : undefined;
  const endpoint = catalog.kind === "manual" ? binding.inference : catalog.url;
  const redact = (text: string) => host.scrub(key ? scrub(text, [key]) : text);
  if (!key || !providerKeyMatches(binding, key)) {
    return {
      status: "failed",
      error: mapProviderError("", redact, endpoint, {
        status: 401,
        ...(keyScope ? { scoped: { operation: "catalog" } } : {}),
        ...(qwenCloud ? { qwenCloud: { plan: qwenCloud, operation: "catalog" } } : {}),
      }),
    };
  }
  const timeout = AbortSignal.timeout(10000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    const url = nativeStudio ? `${endpoint}?page_size=100&capabilities=TG` : endpoint;
    response = await (host.fetch ?? globalThis.fetch)(url, {
      signal: requestSignal,
      redirect: "error",
      headers: { Authorization: `Bearer ${key}` },
    });
  } catch {
    return {
      status: "failed",
      error: signal?.aborted
        ? veraError("DENIED")
        : mapProviderError("", redact, endpoint, { offline: true }),
    };
  }
  try {
    signal?.throwIfAborted();
    if (!response.ok) {
      const body =
        opencode || qwenCloud || keyScope
          ? await readProviderJson(response, requestSignal, 16384).catch(() => undefined)
          : undefined;
      if (!opencode && !qwenCloud && !keyScope) await response.body?.cancel();
      signal?.throwIfAborted();
      const error = mapProviderError("", redact, endpoint, {
        status: response.status,
        ...(keyScope ? { scoped: { operation: "catalog", body } } : {}),
        ...(opencode ? { openCode: { operation: "catalog", body } } : {}),
        ...(qwenCloud ? { qwenCloud: { plan: qwenCloud, operation: "catalog", body } } : {}),
        retryAfter: response.headers.get("retry-after") ?? undefined,
      });
      // QwenCloud documents both 401 and 404 when a model listing is unavailable.
      if (
        !opencode &&
        error.messageKey !== "provider.workspaceUnavailable" &&
        ([404, 405, 501].includes(response.status) || (qwenCloud && response.status === 401))
      )
        return { status: "manual", reason: "unavailable" };
      return { status: "failed", error };
    }
    const body = await readProviderJson(response, requestSignal);
    const profiles = opencode
      ? parseOpenCodeCatalog(body, opencode)
      : metadata
        ? parseDirectCatalog(body, metadata)
        : undefined;
    const ids = nativeStudio
      ? studioModelIds(body)
      : (profiles ?? catalogSchema.parse(body).data).map(({ id }) => id);
    const models =
      keyScope === "mimo-api" ? ids.filter((id) => binding.models?.some((model) => model.id === id)) : ids;
    signal?.throwIfAborted();
    if (
      models.some((id) => redact(id) !== id) ||
      profiles?.some(
        (profile) =>
          redact(profile.name) !== profile.name ||
          profile.reasoningOptions?.some((option) => redact(option) !== option),
      )
    )
      return { status: "failed", error: veraError("INVALID") };
    if (!models.length) return { status: "manual", reason: "empty" };
    if (profiles && new Set(models).size !== models.length) throw veraError("PROVIDER");
    return { status: "discovered", models: [...new Set(models)], ...(profiles ? { profiles } : {}) };
  } catch {
    return { status: "failed", error: veraError(signal?.aborted ? "DENIED" : "PROVIDER") };
  }
}

export async function readProviderJson(
  response: Response,
  signal: AbortSignal,
  maxBytes = MAX_CATALOG_BYTES,
): Promise<unknown> {
  signal.throwIfAborted();
  if (!response.body) throw veraError("PROVIDER");
  const reader = response.body.getReader();
  const cancel = () => void reader.cancel().catch(() => {});
  signal.addEventListener("abort", cancel, { once: true });
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let text = "";
  let size = 0;
  try {
    for (;;) {
      const chunk = await reader.read();
      signal.throwIfAborted();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maxBytes) throw veraError("PROVIDER");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    signal.removeEventListener("abort", cancel);
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
