import type { Message, ToolResultMessage } from "@earendil-works/pi-ai";
import type { ModelCapabilities } from "@vera/shared";
import type { ToolSpec } from "../llm/gateway.js";

export interface ContextInput {
  system: string;
  tools: ToolSpec[];
  messages: Message[];
}
export type TokenCounter = (input: ContextInput) => { tokens: number; estimated: boolean };
export interface ContextView {
  messages: Message[];
  fits: boolean;
  contextTokens: number;
  contextWindow: number;
  inputBudgetTokens: number;
  reservedOutputTokens: number;
  safetyMarginTokens: number;
  estimated: boolean;
}
/** Conservative UTF-8 byte estimate plus explicit framing; replace with a whole-request tokenizer when available. */
export const conservativeCounter: TokenCounter = (input) => ({
  tokens:
    Buffer.byteLength(JSON.stringify(input), "utf8") +
    32 +
    16 +
    input.tools.length * 32 +
    input.messages.reduce((n, m) => n + 16 + (Array.isArray(m.content) ? m.content.length * 8 : 8), 0),
  estimated: true,
});
function sourceRefs(value: unknown, refs = new Set<string>()): Set<string> {
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
function minimumResult(result: ToolResultMessage): ToolResultMessage {
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
  prepare(input: ContextInput, capabilities: ModelCapabilities): ContextView {
    const messages = structuredClone(input.messages);
    const safetyMarginTokens = Math.max(1024, Math.ceil(capabilities.contextWindow * 0.05));
    const inputBudgetTokens = capabilities.contextWindow - capabilities.maxOutputTokens - safetyMarginTokens;
    const measure = () => {
      const value = this.count({ ...input, messages });
      if (!Number.isSafeInteger(value.tokens) || value.tokens < 0)
        throw new Error("Invalid token counter result");
      return value;
    };
    let measured = measure();
    const calls = new Set<string>();
    for (const m of messages)
      if (m.role === "assistant") for (const c of m.content) if (c.type === "toolCall") calls.add(c.id);
    for (let i = 0; measured.tokens > inputBudgetTokens && i < messages.length; i++) {
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
      contextWindow: capabilities.contextWindow,
      inputBudgetTokens,
      reservedOutputTokens: capabilities.maxOutputTokens,
      safetyMarginTokens,
      estimated: measured.estimated,
    };
  }
}
