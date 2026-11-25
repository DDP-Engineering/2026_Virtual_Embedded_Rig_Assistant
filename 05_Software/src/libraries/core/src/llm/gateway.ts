import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import {
  type ModelCapabilities,
  modelReferenceSchema,
  type ProviderCatalog,
  type VeraError,
  veraError,
} from "@vera/shared";

export function resolveModelReference(
  session?: string | null,
  workbench?: string | null,
  app?: string | null,
): string {
  const reference = session ?? workbench ?? app;
  // No model chosen anywhere is a setup step the user can act on, not a malformed request.
  if (reference === null || reference === undefined || reference === "")
    throw { ...veraError("INVALID"), messageKey: "provider.noModel" };
  const result = modelReferenceSchema.safeParse(reference);
  if (!result.success) throw veraError("INVALID");
  return result.data;
}
export function splitModelReference(reference: string): { provider: string; model: string } {
  const parsed = resolveModelReference(reference);
  const separator = parsed.indexOf("/");
  return { provider: parsed.slice(0, separator), model: parsed.slice(separator + 1) };
}
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface LlmRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  /** Recheck live tool authority after any provider preparation and before dispatch. */
  toolAvailable?: (name: string) => boolean;
  signal: AbortSignal;
  maxOutputTokens?: number;
  sessionId?: string;
  reasoning?: string | null;
  /** Live session output policy; connection tests omit it and always mask. */
  maskOutput?: () => boolean;
  /** Called for every provider stream event, reasoning included, so callers can tell a working model from a silent one. */
  onActivity?: () => void;
}
export type LlmEvent =
  | { type: "text"; delta: string; sourceDeltas?: number }
  | { type: "tool"; index: number; delta: string }
  | { type: "done"; message: AssistantMessage }
  | { type: "error"; error: VeraError; aborted: boolean; partial?: AssistantMessage };
export interface LlmGateway {
  /** Resolve live model metadata before synchronous budgeting/validation. */
  prepareModel?(reference: string, signal?: AbortSignal): Promise<void>;
  selectedModel(provider: string): string;
  capabilities(reference: string, output?: number): ModelCapabilities;
  models(provider: string, signal?: AbortSignal, probe?: boolean): Promise<ProviderCatalog>;
  /** The model's own no-output limit in milliseconds; undefined uses the session default. */
  responseTimeoutMs?(reference: string): number | undefined;
  stream(request: LlmRequest): AsyncIterable<LlmEvent>;
}
