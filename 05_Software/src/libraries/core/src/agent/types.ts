import type {
  AssistantMessage,
  ImageContent,
  Message,
  ToolCall,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { VeraError } from "@vera/shared";
import type { z } from "zod";
import type { LlmGateway } from "../llm/gateway.js";
import type { ContextCompactor } from "./compaction.js";
import type { ContextPolicy, ContextView } from "./context.js";

export type StopReason = "end" | "aborted" | "error" | "limit";
export type ToolOutput = string | { text: string; image: ImageContent };
export interface ToolDef {
  /** Recheck tools whose permissions can change between model requests. */
  available?(): boolean;
  /** Synchronous final authorization and projection before tool result publication. */
  publish?(args: unknown, output: string): string;
  name: string;
  class: "read" | "write" | "session" | "program";
  description: string;
  requiresImages?: true;
  params: z.ZodType;
  /** The runtime supplies callId separately from model arguments. */
  execute(args: unknown, signal: AbortSignal, callId?: string): Promise<ToolOutput>;
}
export interface RuntimeInit {
  systemPrompt: string;
  model: string;
  tools: ToolDef[];
  messages: Message[];
  contextPolicy: ContextPolicy;
  contextCompactor?: ContextCompactor;
  maxToolCallsPerTurn?: number;
}
export interface RuntimeHost {
  gateway: LlmGateway;
  now(): number;
  nextId(): string;
  approve(call: Readonly<ToolCall>, signal: AbortSignal): Promise<"approved" | "denied" | "aborted">;
  /** Durable, undelivered user messages; detached FIFO snapshot, without consuming them. */
  steering?(): { messageId: string; text: string; images?: string[]; timestamp: number }[];
  /** An exception the turn loop reports only as a generic error; the host scrubs secrets before it writes the text. */
  log?(message: string): void;
}
export type RuntimeEvent =
  | { type: "turn.started"; turnId: string }
  | { type: "turn.done"; turnId: string; stopReason: StopReason }
  | { type: "message.user"; messageId: string; text: string; images?: string[]; timestamp?: number }
  | { type: "message.delivered"; messageIds: string[] }
  | {
      type: "context.compacted";
      covered: number;
      fingerprint: string;
      note: string;
      refs: string[];
      images: string[];
    }
  | { type: "message.delta"; messageId: string; text: string }
  | { type: "tool.delta"; messageId: string; index: number; text: string }
  | { type: "message.done"; messageId: string; text: string; message: AssistantMessage }
  | { type: "tool.started"; callId: string; name: string; args: unknown }
  | {
      type: "tool.done";
      callId: string;
      ok: boolean;
      summary: string;
      durationMs: number;
      message?: ToolResultMessage;
      aborted?: boolean;
    }
  | { type: "approval.requested"; call: ToolCall }
  | { type: "approval.decided"; callId: string; decision: "approved" | "denied" | "aborted" }
  | ({
      type: "usage.updated";
      inputTokens: number;
      outputTokens: number;
      promptIds?: string[];
      calibration?: { modelRef: string; ratio: number };
    } & Partial<Omit<ContextView, "messages" | "fits" | "rawTokens">>)
  | {
      type: "error";
      code: VeraError["code"];
      messageKey: string;
      params?: Record<string, string | number>;
      retryable: boolean;
      retryAfter?: string;
    };
export interface AgentRuntime {
  start(init: RuntimeInit): void;
  send(text: string, images?: string[]): Promise<{ stopReason: StopReason }>;
  abort(): void;
  onEvent(listener: (event: RuntimeEvent) => void): () => void;
  messages(): Message[];
  /**
   * Compact the finished conversation when it is above the trigger (REQ-FUNC-99acfc19). `messages`
   * is the stored transcript the next turn starts from, so the summary's fingerprint matches it.
   */
  compact?(messages?: Message[]): Promise<void>;
}
