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
export type RetrievalLimitation =
  | "partial"
  | "unknown"
  | "embedding-rebuild"
  | "semantic-unavailable"
  | "revision-conflict"
  | "unavailable"
  | "index-not-ready";
type NoticeRow = {
  kind: "retrieval-notice";
  id: string;
  turnId: string | null;
  limitations: Set<RetrievalLimitation>;
};
type Row = { kind: "item"; item: Item } | { kind: "group"; id: string; tools: ToolItem[] } | NoticeRow;

/** A presentation projection only. Essential interactions split groups and never disappear. */
export function transcriptRows(state: SessionState, detail: ChatDetail): Row[] {
  const rows: Row[] = [];
  // A call stays essential while its approval is pending, refused, aborted or answered by the user.
  // One the session mode approved automatically (auto-edit, bypass) is routine only when it is low risk:
  // a device-write or irreversible program, a plugin install or an applied candidate stays visible.
  const routineByMode = (a: SessionState["approvals"][number]) =>
    a.by === "mode" &&
    a.decision === "approved" &&
    a.tool !== "plugin_install" &&
    a.tool !== "apply_candidate" &&
    a.program?.risk !== "device-write" &&
    a.program?.risk !== "irreversible";
  const approvals = new Set(state.approvals.filter((a) => !routineByMode(a)).map((a) => a.callId));
  let group: Extract<Row, { kind: "group" }> | undefined;
  let turnNotices: Map<string, NoticeRow> | undefined;
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
    if (item.kind !== "tool" || item.name !== "search_docs" || !item.documentSearch) continue;
    const { coverage, usage } = item.documentSearch;
    const fallback = usage.mode === "keyword" ? usage.fallbackReason : undefined;
    const unavailable = usage.mode === null && usage.reason !== "no-candidates" ? usage.reason : undefined;
    if (coverage === "complete" && !fallback && !unavailable) continue;
    const key = item.turnId === null ? `call/${item.id}` : `turn/${item.turnId}`;
    turnNotices ??= new Map();
    let notice = turnNotices.get(key);
    if (!notice) {
      notice = { kind: "retrieval-notice", id: item.id, turnId: item.turnId, limitations: new Set() };
      turnNotices.set(key, notice);
      rows.push(notice);
    }
    if (coverage !== "complete" && (coverage !== "unknown" || !unavailable)) notice.limitations.add(coverage);
    if (fallback) notice.limitations.add(fallback);
    if (unavailable)
      notice.limitations.add(unavailable === "revision-conflict" ? "unavailable" : unavailable);
  }
  return rows;
}

const LIST_ITEM = /^ {0,3}(?:[-*+]|\d{1,9}[.)])\s/;
const INDENTED = /^(?: {2,}|\t)\S/;
/**
 * Streaming text split at blank lines outside code fences (PERF-04). A completed block keeps its
 * string, so its memoized Markdown is not parsed again while the last block grows.
 */
export function streamingBlocks(text: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fenced = false;
  let list = false;
  let gap = false;
  for (const line of text.split("\n")) {
    if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
    if (!fenced && !line.trim()) {
      gap = current.length > 0;
      continue;
    }
    if (gap) {
      // A list goes on past a blank line; split there and it renders as several lists, then
      // reflows into one when the message completes.
      if (list && (LIST_ITEM.test(line) || INDENTED.test(line))) current.push("");
      else {
        blocks.push(current.join("\n"));
        current = [];
        list = false;
      }
      gap = false;
    }
    list ||= LIST_ITEM.test(line);
    current.push(line);
  }
  if (current.length) blocks.push(current.join("\n"));
  return blocks;
}
