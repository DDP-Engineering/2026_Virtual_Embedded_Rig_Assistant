import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import { acceptsImages, type ModelCapabilities } from "@vera/shared";
import type { ToolSpec } from "../llm/gateway.js";
import { imagePaths, imageRequestMessage } from "./message-images.js";

export interface ContextInput {
  system: string;
  tools: ToolSpec[];
  messages: Message[];
}
export type TokenCounter = (input: ContextInput) => { tokens: number; estimated: boolean };
export interface ContextView {
  messages: Message[];
  fits: boolean;
  /** The counted size; an estimate is scaled by the session calibration (REQ-NFR-4721c12f). */
  contextTokens: number;
  /** The counter's own value before calibration, from which the next calibration ratio is taken. */
  rawTokens: number;
  contextWindow: number;
  inputBudgetTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  estimated: boolean;
  compactionStatus?: "none" | "running" | "completed" | "unavailable" | "failed";
  requestViewTokens?: number;
}
const estimatedImageTokens = 2048;
// Use the longest supported MIME spelling to include the request framing in preflight.
const imageEstimate = { type: "image" as const, mimeType: "image/jpeg", data: "" };

/** Estimate text and framing from UTF-8 bytes and image cost separately from its encoding. */
export const conservativeCounter: TokenCounter = (input) => {
  let images = 0;
  const messages = input.messages.map((message) => {
    if ((message.role !== "user" && message.role !== "toolResult") || typeof message.content === "string")
      return message;
    const content = message.content.map((part) => {
      if (part.type !== "image") return part;
      images++;
      return { ...part, data: "" };
    });
    return { ...message, content };
  });
  return {
    tokens:
      Buffer.byteLength(JSON.stringify({ ...input, messages }), "utf8") +
      32 +
      16 +
      input.tools.length * 32 +
      input.messages.reduce((n, m) => n + 16 + (Array.isArray(m.content) ? m.content.length * 8 : 8), 0) +
      images * estimatedImageTokens,
    estimated: true,
  };
};
export function sourceRefs(value: unknown, refs = new Set<string>()): Set<string> {
  if (typeof value === "string") {
    for (const match of value.matchAll(/\[\[([^\]]+)\]\]/g)) if (match[1]) refs.add(match[1]);
  } else if (Array.isArray(value)) for (const item of value) sourceRefs(item, refs);
  else if (value && typeof value === "object")
    for (const [key, item] of Object.entries(value)) {
      if ((key === "ref" || key === "refs" || key === "sourceRefs") && typeof item === "string")
        refs.add(item);
      if ((key === "refs" || key === "sourceRefs") && Array.isArray(item))
        for (const ref of item) if (typeof ref === "string") refs.add(ref);
      sourceRefs(item, refs);
    }
  return refs;
}
export function minimumResult(result: ToolResultMessage): ToolResultMessage {
  const refs = sourceRefs(result);
  for (const block of result.content)
    if (block.type === "text") {
      try {
        sourceRefs(JSON.parse(block.text), refs);
      } catch {
        /* Plain text citations already extracted. */
      }
    }
  return {
    ...result,
    content: [
      {
        type: "text",
        text: JSON.stringify({
          toolCallId: result.toolCallId,
          toolName: result.toolName,
          outcome: result.isError ? "error" : "success",
          sourceRefs: [...refs].sort(),
          truncated: true,
          marker: "[context truncated]",
        }),
      },
    ],
  };
}
export class ContextPolicy {
  constructor(private readonly count: TokenCounter = conservativeCounter) {}
  prepare(
    input: ContextInput,
    capabilities: ModelCapabilities,
    reduce = true,
    scrubAttachmentText?: (text: string) => string,
    scale?: number,
  ): ContextView {
    const vision = acceptsImages(capabilities);
    const messages = structuredClone(input.messages).map((message) =>
      !vision && message.role === "toolResult"
        ? { ...message, content: message.content.filter((part) => part.type !== "image") }
        : message,
    );
    const safetyMarginTokens = Math.max(1024, Math.ceil(capabilities.contextWindow * 0.05));
    const inputBudgetTokens = Math.min(
      capabilities.contextWindow - capabilities.maxOutputTokens - safetyMarginTokens,
      capabilities.maxInputTokens ?? Infinity,
    );
    const measure = () => {
      const projected = messages.map((message) => {
        const paths = imagePaths(message);
        return message.role === "user" && paths.length
          ? imageRequestMessage(
              message,
              paths,
              vision ? paths.map(() => imageEstimate) : undefined,
              scrubAttachmentText,
            )
          : message;
      });
      const value = this.count({ ...input, messages: projected });
      if (!Number.isSafeInteger(value.tokens) || value.tokens < 0)
        throw new Error("Invalid token counter result");
      // A calibrated estimate never exceeds the conservative one; exact counts are not scaled.
      const tokens =
        value.estimated && scale !== undefined && scale > 0
          ? Math.min(value.tokens, Math.ceil(value.tokens * scale))
          : value.tokens;
      return { tokens, raw: value.tokens, estimated: value.estimated };
    };
    let measured = measure();
    const calls = new Set<string>();
    for (const m of messages)
      if (m.role === "assistant") for (const c of m.content) if (c.type === "toolCall") calls.add(c.id);
    for (let i = 0; reduce && measured.tokens > inputBudgetTokens && i < messages.length; i++) {
      const result = messages[i];
      if (result?.role !== "toolResult" || !calls.has(result.toolCallId)) continue;
      const reduced = minimumResult(result);
      messages[i] = reduced;
      const next = measure();
      if (next.tokens < measured.tokens) measured = next;
      else messages[i] = result;
    }
    return {
      messages,
      fits: inputBudgetTokens >= 0 && measured.tokens <= inputBudgetTokens,
      contextTokens: measured.tokens,
      rawTokens: measured.raw,
      contextWindow: capabilities.contextWindow,
      inputBudgetTokens,
      reservedOutputTokens: capabilities.maxOutputTokens,
      safetyMarginTokens,
      estimated: measured.estimated,
    };
  }
}
