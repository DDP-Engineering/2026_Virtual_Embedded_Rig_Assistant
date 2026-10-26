// REQ-FUNC-18000007
import { expect, test } from "vitest";
import { channels } from "./ipc.js";

test("validates strict change read and reveal contracts", () => {
  const list = channels["changes.list"];
  const get = channels["changes.get"];
  expect(list).toBeDefined();
  expect(get).toBeDefined();
  expect(list?.request.safeParse({ sessionId: "ses_00000000000000000000000001" }).success).toBe(true);
  for (const raw of [{ sessionId: "bad" }, { sessionId: "ses_00000000000000000000000001", extra: 1 }, {}])
    expect(list?.request.safeParse(raw).success).toBe(false);
  for (const changeId of [0, -1, 1.1, Number.MAX_SAFE_INTEGER + 1, "1"])
    expect(get?.request.safeParse({ changeId }).success).toBe(false);
  expect(get?.request.safeParse({ changeId: 1 }).success).toBe(true);
  expect(get?.request.safeParse({ changeId: 1, sessionId: "other" }).success).toBe(false);
  const row = {
    changeId: 1,
    sessionId: "ses_00000000000000000000000001",
    path: "board.txt",
    createdAt: "2026-10-12T00:00:00.000Z",
    added: 1,
    removed: 1,
  };
  expect(list?.response.safeParse([row]).success).toBe(true);
  expect(get?.response.safeParse({ ...row, diff: "--- board\n+++ board\n" }).success).toBe(true);
  for (const bad of [
    { ...row, added: -1 },
    { ...row, removed: 1.5 },
    { ...row, createdAt: "yesterday" },
    { ...row, extra: 1 },
  ])
    expect(list?.response.safeParse([bad]).success).toBe(false);
  expect(get?.response.safeParse(row).success).toBe(false);
  const reveal = channels["app.revealPath"];
  expect(reveal).toBeDefined();
  expect(reveal?.request.safeParse({ path: "board.txt" }).success).toBe(true);
  expect(reveal?.request.safeParse({ path: "", extra: 1 }).success).toBe(false);
});
