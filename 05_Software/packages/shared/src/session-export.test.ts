// REQ-FUNC-70479d66 REQ-FUNC-1b882a4b REQ-SEC-17075aa1; execution deferred.
import { expect, it } from "vitest";
import { channels } from "./ipc.js";
import { sessionExportSchema } from "./session-export.js";

it("accepts only bounded nonblank searches and explicit formats, never renderer paths", () => {
  expect(channels["session.search"].request.parse({ query: "  Ă board  " })).toEqual({ query: "Ă board" });
  for (const query of [" ", "x".repeat(1001)])
    expect(channels["session.search"].request.safeParse({ query }).success).toBe(false);
  const sessionId = "ses_00000000000000000000000001";
  for (const format of ["md", "json"])
    expect(channels["session.export"].request.safeParse({ sessionId, format }).success).toBe(true);
  for (const request of [
    { sessionId, format: "html" },
    { sessionId, format: "md", path: "x" },
    { sessionId: "bad", format: "json" },
  ])
    expect(channels["session.export"].request.safeParse(request).success).toBe(false);
});

it("rejects unordered and live event archival records", () => {
  const session = {
    id: "ses_00000000000000000000000001",
    title: "",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    modelRef: null,
    mode: "ask",
    status: "idle",
    archived: false,
  };
  const row = { seq: 1, createdAt: null, event: { type: "message.user", messageId: "u", text: "board" } };
  expect(sessionExportSchema.safeParse({ schemaVersion: 1, session, events: [row] }).success).toBe(true);
  expect(sessionExportSchema.safeParse({ schemaVersion: 1, session, events: [row, row] }).success).toBe(
    false,
  );
  expect(
    sessionExportSchema.safeParse({
      schemaVersion: 1,
      session,
      events: [{ ...row, event: { ...row.event, type: "message.delta" } }],
    }).success,
  ).toBe(false);
});
