import { type ToolContext, toolLimit } from "./context.js";

function splitPair(text: string, at: number): boolean {
  return /[\uD800-\uDBFF]/.test(text.charAt(at - 1)) && /[\uDC00-\uDFFF]/.test(text.charAt(at));
}

/** Page by one-based UTF-16 position, keeping Unicode pairs and accounting for JSON escapes. */
export function textPage(ctx: ToolContext, metadata: Record<string, unknown>, content: string, offset = 1) {
  const text = ctx.maskText?.(content) ?? content;
  const start = offset - 1;
  if (start > text.length || splitPair(text, start))
    throw Error("Use the returned nextOffset to continue reading.");
  const remaining = text.slice(start);
  const limit = toolLimit(ctx, "toolResultChars");
  const full = { ...metadata, text: remaining };
  if (remaining.length <= limit && JSON.stringify(full).length <= limit) return full;
  const budget = limit - JSON.stringify({ ...metadata, text: "", nextOffset: text.length + 1 }).length;
  let low = 0;
  let high = Math.min(remaining.length, budget);
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (JSON.stringify(remaining.slice(0, middle)).length - 2 <= budget) low = middle;
    else high = middle - 1;
  }
  const end = splitPair(remaining, low) ? low - 1 : low;
  if (!end) throw Error("The text result does not fit the tool output limit.");
  return { ...metadata, text: remaining.slice(0, end), nextOffset: offset + end };
}
