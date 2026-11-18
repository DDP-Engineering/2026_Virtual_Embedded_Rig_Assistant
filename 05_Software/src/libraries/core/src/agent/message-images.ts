import type { ImageContent, Message, UserMessage } from "@earendil-works/pi-ai";
import { messageImagesSchema } from "@vera/shared";

/** Internal user-message metadata. Provider requests carry only ordinary pi-ai content. */
export type UserImageMessage = UserMessage & { images?: string[] };

export function imagePaths(message: Message): readonly string[] {
  if (message.role !== "user" || !("images" in message)) return [];
  const parsed = messageImagesSchema.safeParse(message.images);
  return parsed.success ? parsed.data : [];
}

/** Match the provider request shape both when estimating and after reading the image parts. */
export function imageRequestMessage(
  message: UserMessage,
  paths: readonly string[],
  images?: readonly (ImageContent | undefined)[],
  scrub = (text: string) => text,
): UserMessage {
  const labels = paths.map(
    (path, index) => `Image attachment: ${path}${images && !images[index] ? " (image unavailable)" : ""}`,
  );
  const { timestamp } = message;
  if (!images && typeof message.content === "string") {
    // Scrub the full text once for matching rules that span lines.
    const text = [message.content, ...labels];
    return { role: "user", timestamp, content: scrub(text.filter(Boolean).join("\n")) };
  }
  const content =
    typeof message.content === "string"
      ? message.content.trim()
        ? [{ type: "text" as const, text: message.content }]
        : []
      : [...message.content];
  for (const [index, label] of labels.entries()) {
    content.push({ type: "text", text: scrub(label) });
    const image = images?.[index];
    if (image) content.push(image);
  }
  return { role: "user", timestamp, content };
}

export function compactedImageNote(path: string): string {
  return `[Image omitted during compaction: ${path}]`;
}
