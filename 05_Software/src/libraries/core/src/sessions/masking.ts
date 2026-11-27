import type { Message } from "@earendil-works/pi-ai";
import { documentSearchMetadataSchema, type ModelCapabilities } from "@vera/shared";
import { z } from "zod";
import { type ContextInput, ContextPolicy } from "../agent/context.js";
import { mapProviderError } from "../llm/errors.js";
import type { LlmEvent } from "../llm/gateway.js";
import { scrubAssistantMessage } from "../llm/message-scrub.js";
import { createStreamScrubber } from "../llm/stream-scrub.js";
import { capToolResult, programToolNames } from "../tools/registry.js";
import { maskCaptureOutput } from "../wireshark/model-output.js";

/** Project arbitrary tool data while retaining enclosing protocol fields. */
export function maskValue(value: unknown, scrub: (text: string) => string): unknown {
  return typeof value === "string"
    ? scrub(value)
    : Array.isArray(value)
      ? value.map((item) => maskValue(item, scrub))
      : value && typeof value === "object"
        ? Object.fromEntries(Object.entries(value).map(([key, item]) => [scrub(key), maskValue(item, scrub)]))
        : value;
}

const searchToolResult = z.looseObject(documentSearchMetadataSchema.shape);

function parseSearchToolResult(text: string) {
  try {
    return searchToolResult.safeParse(JSON.parse(text)).data;
  } catch {
    return undefined;
  }
}

/** Extract validated search-time metadata before the renderer masks the summary text. */
export function documentSearchToolMetadata(text: string) {
  const result = parseSearchToolResult(text);
  return result && { coverage: result.coverage, usage: result.usage };
}

/** Redact tool data while keeping the search coverage and usage protocol readable to the model. */
export function maskToolOutput(
  name: string,
  text: string,
  scrub: (text: string) => string,
  limit = 32_000,
): string {
  if (name === "wireshark_capture" || name === "wireshark_import" || name === "wireshark_derive")
    return maskCaptureOutput(text, scrub, limit);
  const result = name === "search_docs" ? parseSearchToolResult(text) : undefined;
  if (!result) {
    const masked = scrub(text);
    if (masked.length > limit && (name === "read" || programToolNames.includes(name))) {
      try {
        return capToolResult(JSON.parse(masked), [], limit, name).text;
      } catch {
        // Older tool messages can contain unstructured text.
      }
    }
    return masked;
  }
  const { coverage, usage, ...rest } = result;
  const masked = maskValue(rest, scrub) as Record<string, unknown>;
  return capToolResult({ ...masked, coverage, usage }, [], limit).text;
}

/** Retained transcript messages are projected again at each model dispatch. */
export function maskMessages(
  messages: Message[],
  scrub: (text: string) => string,
  limit?: number,
): Message[] {
  return messages.map((message) => {
    if (message.role === "assistant") return scrubAssistantMessage(message, scrub, message.timestamp);
    if (message.role === "system")
      return {
        ...message,
        content:
          typeof message.content === "string"
            ? scrub(message.content)
            : message.content.map((part) => ({ ...part, text: scrub(part.text) })),
      };
    if (message.role === "toolResult")
      return {
        ...message,
        content: message.content.map((part) =>
          part.type === "text"
            ? { ...part, text: maskToolOutput(message.toolName, part.text, scrub, limit) }
            : part,
        ),
      };
    return {
      ...message,
      content:
        typeof message.content === "string"
          ? scrub(message.content)
          : message.content.map((part) =>
              part.type === "text" ? { ...part, text: scrub(part.text) } : part,
            ),
    };
  });
}

/** Count and compact the same live projection that can leave the session. */
export class MaskingContextPolicy extends ContextPolicy {
  constructor(
    private readonly policy: ContextPolicy,
    private readonly scrub: (text: string) => string,
    private readonly toolLimit?: () => number,
  ) {
    super();
  }
  override prepare(
    input: ContextInput,
    capabilities: ModelCapabilities,
    reduce = true,
    _scrubAttachmentText?: (text: string) => string,
    scale?: number,
  ) {
    return this.policy.prepare(
      { ...input, messages: maskMessages(input.messages, this.scrub, this.toolLimit?.()) },
      capabilities,
      reduce,
      this.scrub,
      scale,
    );
  }
}

/** Apply the session policy to every provider, including local replay and test gateways. */
export async function* maskModelStream(
  source: AsyncIterable<LlmEvent>,
  enabled: () => boolean,
  secrets: () => readonly string[],
  scrub: (text: string) => string,
): AsyncIterable<LlmEvent> {
  const text = createStreamScrubber(secrets, scrub, enabled);
  const tools = new Map<number, ReturnType<typeof createStreamScrubber>>();
  const output = (value: string) => (enabled() ? scrub(value) : value);
  try {
    for await (const event of source) {
      if (event.type === "text") {
        const delta = text.push(event.delta);
        if (delta) yield { ...event, delta };
      } else if (event.type === "tool") {
        let tool = tools.get(event.index);
        if (!tool) {
          tool = createStreamScrubber(secrets, scrub, enabled);
          tools.set(event.index, tool);
        }
        const delta = tool.push(event.delta);
        if (delta) yield { ...event, delta };
      } else {
        const delta = text.flush();
        if (delta) yield { type: "text", delta };
        for (const [index, tool] of tools) {
          const delta = tool.flush();
          if (delta) yield { type: "tool", index, delta };
        }
        if (event.type === "done")
          yield {
            ...event,
            message: scrubAssistantMessage(event.message, output, event.message.timestamp, true, scrub),
          };
        else
          yield {
            ...event,
            error: mapProviderError(event.error, scrub, ""),
            ...(event.partial
              ? {
                  partial: {
                    ...scrubAssistantMessage(event.partial, output, event.partial.timestamp, true, scrub),
                    ...(event.partial.errorMessage
                      ? { errorMessage: scrub(event.partial.errorMessage) }
                      : {}),
                  },
                }
              : {}),
          };
      }
    }
  } catch (error) {
    yield { type: "error", error: mapProviderError(error, scrub, ""), aborted: false };
  }
}
