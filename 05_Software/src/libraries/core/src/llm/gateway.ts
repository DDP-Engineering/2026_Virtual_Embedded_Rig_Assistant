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
  const result = modelReferenceSchema.safeParse(session ?? workbench ?? app);
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
  signal: AbortSignal;
  maxOutputTokens?: number;
  sessionId?: string;
  reasoning?: string | null;
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
  stream(request: LlmRequest): AsyncIterable<LlmEvent>;
}
