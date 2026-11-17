import type { AssistantMessage } from "@earendil-works/pi-ai";

/** Project model content without changing protocol discriminants or usage. */
export function scrubAssistantMessage(
  message: AssistantMessage,
  scrub: (text: string) => string,
  timestamp: number,
  preserveToolCalls = false,
  protect = scrub,
): AssistantMessage {
  const safe = (v: unknown): unknown =>
    typeof v === "string"
      ? scrub(v)
      : Array.isArray(v)
        ? v.map(safe)
        : v && typeof v === "object"
          ? Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), safe(x)]))
          : v;
  return {
    ...(safe(message) as AssistantMessage),
    role: message.role,
    api: message.api,
    stopReason: message.stopReason,
    usage: message.usage,
    timestamp,
    model: scrub(message.model),
    provider: scrub(message.provider),
    content: message.content.map((c) =>
      c.type === "text"
        ? { ...(safe(c) as typeof c), type: c.type, text: scrub(c.text) }
        : c.type === "thinking"
          ? { ...(safe(c) as typeof c), type: c.type, thinking: scrub(c.thinking) }
          : c.type === "toolCall"
            ? preserveToolCalls
              ? c
              : {
                  ...(safe(c) as typeof c),
                  type: c.type,
                  id: c.id,
                  name: c.name,
                  arguments: safe(c.arguments) as typeof c.arguments,
                }
            : c,
    ),
    ...(message.errorMessage ? { errorMessage: protect(message.errorMessage) } : {}),
  };
}
