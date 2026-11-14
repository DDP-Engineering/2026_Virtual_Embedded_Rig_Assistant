import type { SessionEvent } from "./events.js";
import type { SessionState } from "./session-state.js";

/** A field `session.item.detail` returns in full: a tool's preview or args, or an approval's diff. */
export type SessionItemDetailField = "preview" | "args" | "diff";

/** Inline limit for a tool preview or an approval diff sent to the renderer, in UTF-8 bytes. */
export const PREVIEW_INLINE_BYTES = 8 * 1024;
/** Inline limit for a tool's compact JSON arguments sent to the renderer, in UTF-8 bytes. */
export const ARGS_INLINE_BYTES = 4 * 1024;

/**
 * The longest prefix of `text` that fits `limit` UTF-8 bytes without splitting a character, and the
 * full UTF-8 size; undefined when the whole text fits. A lone surrogate counts 3 bytes (U+FFFD).
 */
export function cutUtf8(text: string, limit: number): { text: string; totalBytes: number } | undefined {
  if (text.length * 3 <= limit) return undefined;
  let bytes = 0;
  let cut = -1;
  for (let i = 0; i < text.length; ) {
    const code = text.charCodeAt(i);
    const pair = code >= 0xd800 && code <= 0xdbff && (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00;
    const size = pair ? 4 : code < 0x80 ? 1 : code < 0x800 ? 2 : 3;
    if (cut < 0 && bytes + size > limit) cut = i;
    bytes += size;
    i += pair ? 2 : 1;
  }
  return cut < 0 ? undefined : { text: text.slice(0, cut), totalBytes: bytes };
}
function cutArgs(args: unknown): { text: string; totalBytes: number } | undefined {
  const json = JSON.stringify(args) as string | undefined;
  return json === undefined ? undefined : cutUtf8(json, ARGS_INLINE_BYTES);
}

type Item = SessionState["items"][number];
type Approval = SessionState["approvals"][number];
function boundItem(item: Item): Item {
  if (item.kind !== "tool") return item;
  const preview = item.preview === undefined ? undefined : cutUtf8(item.preview, PREVIEW_INLINE_BYTES);
  const args = cutArgs(item.args);
  if (!preview && !args) return item;
  return {
    ...item,
    ...(preview ? { preview: preview.text } : {}),
    ...(args ? { args: args.text } : {}),
    truncated: {
      ...item.truncated,
      ...(preview ? { preview: preview.totalBytes } : {}),
      ...(args ? { args: args.totalBytes } : {}),
    },
  };
}
function boundApproval(approval: Approval): Approval {
  const diff = cutUtf8(approval.diff, PREVIEW_INLINE_BYTES);
  return diff ? { ...approval, diff: diff.text, truncated: { diff: diff.totalBytes } } : approval;
}
function boundList<T>(list: T[], bound: (value: T) => T): T[] {
  let result = list;
  for (let i = 0; i < list.length; i++) {
    const value = list[i] as T;
    const next = bound(value);
    if (next === value) continue;
    if (result === list) result = [...list];
    result[i] = next;
  }
  return result;
}

/**
 * The renderer's view of a session (PERF-06): tool previews and approval diffs over 8 KiB and tool
 * arguments over 4 KiB of compact JSON hold their prefix, and `truncated` records each full size. A
 * cut argument value becomes the prefix string of its JSON. Only cut items are copied; the input is
 * not written to. The full text stays in the stored events (`session.item.detail`).
 */
export function boundSessionState(state: SessionState): SessionState {
  const items = boundList(state.items, boundItem);
  const approvals = boundList(state.approvals, boundApproval);
  return items === state.items && approvals === state.approvals ? state : { ...state, items, approvals };
}

/** The live counterpart of `boundSessionState`: folding bounded events gives the bounded snapshot. */
export function boundSessionEvent(event: SessionEvent): SessionEvent {
  if (event.type === "tool.started") {
    const args = cutArgs(event.args);
    return args ? { ...event, args: args.text, truncated: { args: args.totalBytes } } : event;
  }
  if (event.type === "tool.done" && event.preview !== undefined) {
    const preview = cutUtf8(event.preview, PREVIEW_INLINE_BYTES);
    return preview ? { ...event, preview: preview.text, truncated: { preview: preview.totalBytes } } : event;
  }
  if (event.type === "approval.requested") {
    const diff = cutUtf8(event.diff, PREVIEW_INLINE_BYTES);
    return diff ? { ...event, diff: diff.text, truncated: { diff: diff.totalBytes } } : event;
  }
  return event;
}
