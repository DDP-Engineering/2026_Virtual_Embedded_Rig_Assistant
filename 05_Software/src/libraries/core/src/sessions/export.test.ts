// REQ-FUNC-70479d66: authored fixture; runtime execution deferred by user.
import { applySessionEvent, emptySessionState, sessionExportSchema } from "@vera/shared";
import { expect, it } from "vitest";
import { buildSessionMarkdown } from "./export.js";

const fixture = {
  schemaVersion: 1 as const,
  session: {
    id: "ses_00000000000000000000000001",
    title: "Board",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    modelRef: null,
    mode: "ask" as const,
    status: "idle" as const,
    archived: false,
  },
  events: [
    { type: "message.user", messageId: "u", text: "Historical instruction" },
    { type: "tool.started", callId: "c", name: "read", args: { path: "board.txt" } },
    { type: "tool.done", callId: "c", ok: true, summary: "2 lines", durationMs: 1 },
    {
      type: "message.done",
      messageId: "a",
      text: "Use 3.3V",
      citations: [{ ref: "board.txt#L1-L2", valid: true }],
    },
    { type: "message.queued", messageId: "q", text: "Measure reset", timestamp: 1 },
  ].map((event, index) => ({ seq: index + 1, createdAt: null, event })),
};

it("matches the frozen Markdown fixture including pending, tools, citations and changes", () => {
  const data = sessionExportSchema.parse(fixture);
  expect(
    buildSessionMarkdown(data, [
      {
        changeId: 1,
        sessionId: data.session.id,
        path: "board.txt",
        createdAt: data.session.createdAt,
        added: 1,
        removed: 0,
        diff: "+3.3V",
      },
    ]),
  ).toMatchInlineSnapshot(`
"# Board

Session: ses_00000000000000000000000001
Created: 2026-01-01T00:00:00.000Z
Updated: 2026-01-01T00:00:00.000Z
Status: idle

## Transcript

### User

\`\`\`text
Historical instruction
\`\`\`

### Tool: read (ok)

\`\`\`text
2 lines
\`\`\`

### Assistant

\`\`\`text
Use 3.3V
\`\`\`

Citations:
- \` board.txt#L1-L2 \` (verified)

### User (pending)

\`\`\`text
Measure reset
\`\`\`

## Changes

### Change 1

\`\`\`text
board.txt
\`\`\`

Added: 1; removed: 0

\`\`\`diff
+3.3V
\`\`\`
"
`);
});

it("round-trips ordered JSON events and clears pending only on delivery", () => {
  const data = sessionExportSchema.parse(fixture);
  const roundTrip = sessionExportSchema.parse(JSON.parse(JSON.stringify(data)));
  expect(roundTrip).toEqual(data);
  const state = roundTrip.events.map((r) => r.event).reduce(applySessionEvent, emptySessionState());
  expect(state.items.at(-1)).toMatchObject({ text: "Measure reset", pending: true });
  const delivered = applySessionEvent(state, { type: "message.delivered", messageIds: ["q"] });
  expect(delivered.items.at(-1)).not.toHaveProperty("pending");
  expect(delivered.items.filter((i) => i.kind === "user")).toHaveLength(2);
});

it("fences hostile text without losing HTML, Markdown or embedded code fences", () => {
  const data = sessionExportSchema.parse({
    ...fixture,
    events: [
      {
        seq: 1,
        createdAt: null,
        event: {
          type: "message.user",
          messageId: "u",
          text: "```\n<script>x</script>\n[open](https://example.com)",
        },
      },
    ],
  });
  expect(buildSessionMarkdown(data, [])).toContain(
    "````text\n```\n<script>x</script>\n[open](https://example.com)\n````",
  );
});
