// REQ-UX-0165dafe REQ-UX-84087df1
import type { ChatDetail, SessionState } from "@vera/shared";

type Item = SessionState["items"][number];
export type ToolItem = Extract<Item, { kind: "tool" }>;

/** Lower-cased message text per item object; an unchanged item keeps its identity (PERF-02). */
const lowered = new WeakMap<Item, string>();
/** Whether a user or assistant message contains `needle`, which the caller has lower-cased. */
export function searchMatch(item: Item, needle: string): boolean {
  if (!needle || (item.kind !== "user" && item.kind !== "assistant")) return false;
  let text = lowered.get(item);
  if (text === undefined) {
    text = item.text.toLocaleLowerCase();
    lowered.set(item, text);
  }
  return text.includes(needle);
}
type Row = { kind: "item"; item: Item } | { kind: "group"; id: string; tools: ToolItem[] };

/** A presentation projection only. Essential interactions split groups and never disappear. */
export function transcriptRows(state: SessionState, detail: ChatDetail): Row[] {
  const rows: Row[] = [];
  const approvals = new Set(state.approvals.map((a) => a.callId));
  let group: Extract<Row, { kind: "group" }> | undefined;
  for (const item of state.items) {
    // Tool-only model steps can persist an empty final assistant message. It has no text to present.
    if (
      detail !== "verbose" &&
      item.kind === "assistant" &&
      !item.streaming &&
      !item.text &&
      !item.citations.length
    )
      continue;
    const routine =
      item.kind === "tool" &&
      item.status !== "error" &&
      !approvals.has(item.id) &&
      !(item.name === "web_download" && item.status === "ok");
    if (!routine || detail === "verbose") {
      rows.push({ kind: "item", item });
      group = undefined;
    } else if (detail === "normal" && item.kind === "tool") {
      // A null turn has no reliable grouping identity. Do not merge unrelated historical calls.
      if (group && item.turnId !== null && group.tools[0]?.turnId === item.turnId) group.tools.push(item);
      else {
        group = { kind: "group", id: item.id, tools: [item] };
        rows.push(group);
      }
    }
  }
  return rows;
}

/**
 * Streaming text split at blank lines outside code fences (PERF-04). A completed block keeps its
 * string, so its memoized Markdown is not parsed again while the last block grows.
 */
export function streamingBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fenced = false;
  for (const line of text.split("\n")) {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (fenced || line.trim()) current.push(line);
    else if (current.length) {
      blocks.push(current.join("\n"));
      current = [];
    }
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}
