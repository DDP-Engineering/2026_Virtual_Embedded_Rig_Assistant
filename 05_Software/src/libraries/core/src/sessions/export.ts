// REQ-FUNC-70479d66
import { type ChangeDetail, foldSessionEvents, type SessionExport } from "@vera/shared";

/** Literal fences retain transcript bytes while containing links/HTML/fence injection. */
function block(text: string, language = "text"): string {
  let longest = 2;
  for (const match of text.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}
const heading = (text: string) => text.replace(/[\r\n]/g, " ").replace(/([\\`*_{}[\]()<>#+.!|&])/g, "\\$1");
const refText = (text: string) => {
  const flat = text.replace(/[\r\n]/g, " ");
  let longest = 0;
  for (const match of flat.matchAll(/`+/g)) longest = Math.max(longest, match[0].length);
  const fence = "`".repeat(longest + 1);
  return `${fence} ${flat} ${fence}`;
};

export function buildSessionMarkdown(data: SessionExport, changes: ChangeDetail[]): string {
  const state = foldSessionEvents(data.events.map((r) => r.event));
  const out = [
    `# ${heading(data.session.title || "Untitled session")}`,
    "",
    `Session: ${data.session.id}`,
    `Created: ${data.session.createdAt}`,
    `Updated: ${data.session.updatedAt}`,
    `Status: ${data.session.status}`,
    "",
    "## Transcript",
  ];
  const bookmarks = new Set(state.bookmarkedMessageIds);
  for (const item of state.items) {
    if (item.kind === "user" || item.kind === "assistant") {
      out.push(
        "",
        `### ${item.kind === "user" ? `${item.parentSessionId ? "Parent agent instruction" : "User"}${item.pending ? " (pending)" : ""}${bookmarks.has(item.id) ? " (bookmarked)" : ""}` : "Assistant"}`,
        "",
        block(item.text),
      );
      if (item.kind === "user" && item.images?.length)
        out.push("", "Image attachments:", "", block(item.images.join("\n")));
      if (item.kind === "assistant" && item.citations.length) {
        out.push("", "Citations:");
        for (const citation of item.citations)
          out.push(`- ${refText(citation.ref)} (${citation.valid ? "verified" : "unverified"})`);
      }
    } else if (item.kind === "tool")
      out.push("", `### Tool: ${heading(item.name)} (${item.status})`, "", block(item.summary ?? ""));
    else out.push("", "### Error", "", block(`${item.code}: ${item.messageKey}`));
  }
  const programs = state.approvals.filter((approval) => approval.program);
  if (programs.length) {
    out.push("", "## Program approvals");
    for (const approval of programs)
      out.push(
        "",
        block(JSON.stringify({ decision: approval.decision, ...approval.program }, null, 2), "json"),
      );
  }
  const automatic = data.events.filter(
    ({ event }) =>
      event.type === "tool.done" &&
      event.program &&
      !state.approvals.some((approval) => approval.callId === event.callId),
  );
  if (automatic.length) {
    out.push("", "## Program paths");
    for (const { event } of automatic)
      if (event.type === "tool.done" && event.program)
        out.push("", block(JSON.stringify(event.program, null, 2), "json"));
  }
  out.push("", "## Changes");
  for (const change of changes)
    out.push(
      "",
      `### Change ${change.changeId}`,
      "",
      block(change.path),
      "",
      `Added: ${change.added}; removed: ${change.removed}`,
      "",
      block(change.diff, "diff"),
    );
  return `${out.join("\n")}\n`;
}
