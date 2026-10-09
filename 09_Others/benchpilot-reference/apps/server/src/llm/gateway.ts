// LLM gateway (04 §7): one streaming interface over pi-ai providers and the replay provider.
// The agent loop only sees LlmEvent; provider specifics (auth, model catalogs, OAuth) stay in llm/.
import type { AssistantMessage, Message } from "@earendil-works/pi-ai";
import type { ProviderId } from "@benchpilot/shared";

export interface ModelRef {
  provider: ProviderId;
  model: string;
}

/** A tool as sent to the model: JSON Schema parameters (from zod, see tools/registry.ts). */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

export interface LlmStreamRequest {
  system: string;
  messages: Message[];
  tools: ToolSpec[];
  model: ModelRef;
  signal: AbortSignal;
  /** Session id: prompt-cache affinity for providers that support it. */
  sessionId?: string;
}

export type LlmEvent =
  | { type: "text"; delta: string }
  /** Final assistant message in pi-ai shape, persisted verbatim. */
  | { type: "done"; message: AssistantMessage }
  /** Provider failure or abort. `message` is safe to show (secrets redacted). */
  | { type: "error"; message: string; aborted: boolean; partial?: AssistantMessage };

export interface ProviderConfig {
  provider: ProviderId;
  apiKey?: string;
  model?: string;
  baseUrl?: string;
}

export interface ConnectionResult {
  ok: boolean;
  detail: string;
  latencyMs?: number;
}

export interface LlmGateway {
  stream(req: LlmStreamRequest): AsyncIterable<LlmEvent>;
  testConnection(cfg: ProviderConfig): Promise<ConnectionResult>;
}

/** Routes `replay` to the scripted provider and everything else to pi-ai. */
export function compositeGateway(piAi: LlmGateway, replay: LlmGateway): LlmGateway {
  const pick = (p: ProviderId) => (p === "replay" ? replay : piAi);
  return {
    stream: (req) => pick(req.model.provider).stream(req),
    testConnection: (cfg) => pick(cfg.provider).testConnection(cfg),
  };
}
