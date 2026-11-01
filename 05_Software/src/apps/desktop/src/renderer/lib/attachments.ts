// REQ-FUNC-47287974 REQ-UX-b5edf930

/** Workbench entries attached to one message at most (TASK-2fef1397). */
export const ATTACHMENT_LIMIT = 20;

/** The list with the path added once, in attach order; unchanged when present or full. */
export function addAttachment(list: readonly string[], path: string): readonly string[] {
  if (list.includes(path) || list.length >= ATTACHMENT_LIMIT) return list;
  return [...list, path];
}

/** An `@path` mention; a path with whitespace is quoted so the mention keeps it whole. */
export function mention(path: string): string {
  return /\s/.test(path) ? `@"${path}"` : `@${path}`;
}

/** The message as sent: the text, then the mentions on their own line; only the mentions for empty text. */
export function withMentions(text: string, paths: readonly string[]): string {
  if (!paths.length) return text;
  const mentions = paths.map(mention).join(" ");
  return text.trim() ? `${text.trimEnd()}\n${mentions}` : mentions;
}
