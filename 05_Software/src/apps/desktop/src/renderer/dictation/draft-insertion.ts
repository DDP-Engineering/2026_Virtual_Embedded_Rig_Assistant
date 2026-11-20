/** Insert at the saved selection end, or append if the draft changed, preserving all existing text. */
export function insertDictation(
  draft: string,
  selectionEnd: number | null,
  transcript: string,
): { text: string; caret: number } {
  const position = selectionEnd ?? draft.length;
  const before = draft.slice(0, position);
  const after = draft.slice(position);
  const spoken = transcript.trim();
  if (!spoken) return { text: draft, caret: position };
  const prefix = before && !/\s$/.test(before) ? " " : "";
  const suffix = after && !/^[\s,.;:!?…\])}]/.test(after) ? " " : "";
  const inserted = before + prefix + spoken;
  return { text: inserted + suffix + after, caret: inserted.length };
}
