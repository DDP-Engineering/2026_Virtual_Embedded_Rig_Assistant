import { expect, it } from "vitest";
import { appEventSchema } from "./events.js";
import { channels } from "./ipc.js";

const background = {
  workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0A",
  name: "A",
  folder: "/work/a",
  foreground: false,
  sessions: [{ id: "ses_01ARZ3NDEKTSV4RRFFQ69G5FAV", title: "Edit the board", status: "awaiting_approval" }],
};

// REQ-FUNC-93ec5cc7
it("describes every open workbench with its running and awaiting-approval sessions", () => {
  const channel = channels["session.activity"];
  expect(channel.request.parse({})).toEqual({});
  expect(channel.request.safeParse({ workbenchId: background.workbenchId }).success).toBe(false);
  const shown = {
    ...background,
    workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0B",
    foreground: true,
    sessions: [],
  };
  expect(channel.response.parse([shown, background])).toEqual([shown, background]);
  const session = background.sessions[0];
  for (const invalid of [
    [{ ...background, sessions: [{ ...session, status: "idle" }] }],
    [{ ...background, sessions: [{ ...session, status: "error" }] }],
    [{ ...background, sessions: [{ ...session, title: "x".repeat(61) }] }],
    [{ ...background, sessions: [{ ...session, id: "bad" }] }],
    [{ ...background, foreground: "no" }],
    [{ ...background, extra: 1 }],
  ])
    expect(channel.response.safeParse(invalid).success).toBe(false);
});

// REQ-FUNC-a6aa5e7c
it("announces activity changes as an application event without a payload", () => {
  expect(appEventSchema.parse({ type: "session.activity" })).toEqual({ type: "session.activity" });
  expect(appEventSchema.safeParse({ type: "session.activity", sessions: [] }).success).toBe(false);
});
