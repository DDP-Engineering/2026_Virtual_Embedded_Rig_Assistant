import { createHash } from "node:crypto";
import {
  type CuratedDiscovery,
  type CuratedModel,
  type CuratedProviderPreset,
  curatedInferenceSchema,
  curatedModelIdSchema,
  type PresetBinding,
  type ProviderBinding,
  providerTokenDefaults,
  type Settings,
  veraError,
} from "@vera/shared";
import { z } from "zod";
import { mapProviderError } from "./errors.js";
import { scrub } from "./scrub.js";

const MAX_CATALOG_BYTES = 2 * 1024 * 1024;
const catalogSchema = z.object({ data: z.array(z.object({ id: curatedModelIdSchema })).max(10000) });

export function resolveProviderBinding(presets: readonly CuratedProviderPreset[], selection: PresetBinding) {
  const preset = presets.find(({ id }) => id === selection.id);
  const binding = preset?.bindings.find(({ id }) => id === selection.binding);
  if (!preset || !binding) throw veraError("NOT_FOUND");
  if (!curatedInferenceSchema.safeParse(binding.inference).success) throw veraError("INVALID");
  if (binding.catalog.kind === "openai-models") {
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
  if (binding.inference !== config.baseUrl) throw veraError("DENIED");
  const scope = createHash("sha256")
    .update(
      JSON.stringify([
        preset.id,
        binding.id,
        preset.protocol,
        preset.authentication,
        binding.inference,
        binding.catalog.kind,
        binding.catalog.kind === "openai-models" ? binding.catalog.url : null,
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
) {
  const fallback = selected ? configured : providerTokenDefaults;
  const contextWindow = profile?.contextWindow ?? fallback.contextWindow;
  const requestedOutput = profile?.maxOutputTokens ?? fallback.maxOutputTokens;
  const ceiling = contextWindow - Math.max(1024, Math.ceil(contextWindow * 0.05)) - 1;
  const maxOutputTokens = selected ? requestedOutput : Math.min(requestedOutput, ceiling);
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
  if (binding.catalog.kind === "manual") return { status: "manual", reason: "configured" };
  const endpoint = binding.catalog.url;
  const redact = (text: string) => host.scrub(key ? scrub(text, [key]) : text);
  if (!key) return { status: "failed", error: mapProviderError("", redact, endpoint, { status: 401 }) };
  const timeout = AbortSignal.timeout(10000);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let response: Response;
  try {
    response = await (host.fetch ?? globalThis.fetch)(endpoint, {
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
      await response.body?.cancel();
      if ([404, 405, 501].includes(response.status)) return { status: "manual", reason: "unavailable" };
      return {
        status: "failed",
        error: mapProviderError("", redact, endpoint, {
          status: response.status,
          retryAfter: response.headers.get("retry-after") ?? undefined,
        }),
      };
    }
    const models = catalogSchema.parse(await readCatalog(response, requestSignal)).data.map(({ id }) => id);
    signal?.throwIfAborted();
    if (models.some((id) => redact(id) !== id)) return { status: "failed", error: veraError("INVALID") };
    if (!models.length) return { status: "manual", reason: "empty" };
    return { status: "discovered", models: [...new Set(models)] };
  } catch {
    return { status: "failed", error: veraError(signal?.aborted ? "DENIED" : "PROVIDER") };
  }
}

async function readCatalog(response: Response, signal: AbortSignal): Promise<unknown> {
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
      if (size > MAX_CATALOG_BYTES) throw veraError("PROVIDER");
      text += decoder.decode(chunk.value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    signal.removeEventListener("abort", cancel);
    try {
      await reader.cancel();
    } finally {
      reader.releaseLock();
    }
  }
}
