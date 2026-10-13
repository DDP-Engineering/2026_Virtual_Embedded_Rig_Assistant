import type { AssistantMessage, Message, ToolCall, ToolResultMessage } from "@earendil-works/pi-ai";
import type { VeraError } from "@vera/shared";
import type { z } from "zod";
import type { LlmGateway } from "../llm/gateway.js";
import type { ContextCompactor } from "./compaction.js";
import type { ContextPolicy, ContextView } from "./context.js";

export type StopReason = "end" | "aborted" | "error" | "limit";
export interface ToolDef {
  name: string;
  class: "read" | "write" | "session";
  description: string;
  params: z.ZodType;
  execute(args: unknown, signal: AbortSignal): Promise<string>;
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
  steering?(): { messageId: string; text: string; timestamp: number }[];
}
export type RuntimeEvent =
  | { type: "turn.started"; turnId: string }
  | { type: "turn.done"; turnId: string; stopReason: StopReason }
  | { type: "message.user"; messageId: string; text: string }
  | { type: "message.delivered"; messageIds: string[] }
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
  | ({ type: "usage.updated"; inputTokens: number; outputTokens: number } & Partial<
      Omit<ContextView, "messages" | "fits">
    >)
  | { type: "error"; code: VeraError["code"]; messageKey: string; retryable: boolean };
export interface AgentRuntime {
  start(init: RuntimeInit): void;
  send(text: string): Promise<{ stopReason: StopReason }>;
  abort(): void;
  onEvent(listener: (event: RuntimeEvent) => void): () => void;
  messages(): Message[];
}
