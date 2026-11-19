import type { Message } from "@earendil-works/pi-ai";
import type { ModelCapabilities } from "@vera/shared";
import { type ContextInput, ContextPolicy } from "../agent/context.js";
import { mapProviderError } from "../llm/errors.js";
import type { LlmEvent } from "../llm/gateway.js";
import { scrubAssistantMessage } from "../llm/message-scrub.js";
import { createStreamScrubber } from "../llm/stream-scrub.js";

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

/** Retained transcript messages are projected again at each model dispatch. */
export function maskMessages(messages: Message[], scrub: (text: string) => string): Message[] {
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
          part.type === "text" ? { ...part, text: scrub(part.text) } : part,
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
  ) {
    super();
  }
  override prepare(input: ContextInput, capabilities: ModelCapabilities, reduce = true) {
    return this.policy.prepare(
      { ...input, messages: maskMessages(input.messages, this.scrub) },
      capabilities,
      reduce,
      this.scrub,
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
