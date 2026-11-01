// REQ-FUNC-7871b582 REQ-FUNC-df70c1c8
import { expect, it } from "vitest";
import { channels } from "./ipc.js";
import { moveRecentWorkbench, moveSession, orderSessions } from "./ordering.js";
import {
  defaultSettings,
  settingsPatchSchema,
  settingsSchema,
  settingsServicePatchSchema,
} from "./settings.js";

const id = (n: number) => `ses_${String(n).padStart(26, "0")}`;
const session = (n: number, archived = false) => ({ id: id(n), archived });
const numbers = (list: readonly (string | { id: string })[]) =>
  list.map((s) => Number((typeof s === "string" ? s : s.id).slice(4)));
const workbenchId = "wb_01ARZ3NDEKTSV4RRFFQ69G5FAV";
const installationId = "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19";

it("lists unlisted sessions first in their own order, then the stored order, ignoring unknown ids", () => {
  // The repository lists newest first: 5, 4, 3, 2, 1.
  const list = [5, 4, 3, 2, 1].map((n) => session(n));
  expect(numbers(orderSessions(list, undefined))).toEqual([5, 4, 3, 2, 1]);
  expect(numbers(orderSessions(list, [id(1), id(9), id(3), id(2)]))).toEqual([5, 4, 1, 3, 2]);
  // Archived sessions are not ordered: they follow, in repository order, even when stored.
  const mixed = [session(4, true), session(3), session(2, true), session(1)];
  expect(numbers(orderSessions(mixed, [id(1), id(2), id(4), id(3)]))).toEqual([1, 3, 4, 2]);
});

it("moves a non-archived session past archived ones, keeps the order at the edges and stores no archived or deleted ids", () => {
  const list = [session(4), session(3, true), session(2), session(1)];
  // The oldest moved up twice becomes first; the archived session is not stored.
  let order = moveSession(list, undefined, id(1), -1);
  expect(numbers(order)).toEqual([4, 1, 2]);
  order = moveSession(list, order, id(1), -1);
  expect(numbers(order)).toEqual([1, 4, 2]);
  expect(moveSession(list, order, id(1), -1)).toEqual(order);
  expect(moveSession(list, order, id(2), 1)).toEqual(order);
  expect(() => moveSession(list, order, id(3), 1)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  expect(() => moveSession(list, order, id(7), 1)).toThrow(expect.objectContaining({ code: "NOT_FOUND" }));
  // Session 2 was deleted: its id leaves the stored order with the next move.
  const remaining = [session(4), session(3, true), session(1)];
  expect(numbers(moveSession(remaining, order, id(1), 1))).toEqual([4, 1]);
});

it("swaps a recent workbench with its nearest neighbour of the same pinned state", () => {
  const entries = [
    { folder: "/c", pinned: false },
    { folder: "/b" },
    { folder: "/a", pinned: true },
    { folder: "/z", pinned: true },
  ];
  const folders = (list: readonly { folder: string }[]) => list.map((e) => e.folder);
  expect(folders(moveRecentWorkbench(entries, "/z", -1))).toEqual(["/c", "/b", "/z", "/a"]);
  expect(folders(moveRecentWorkbench(entries, "/c", 1))).toEqual(["/b", "/c", "/a", "/z"]);
  expect(folders(moveRecentWorkbench(entries, "/b", 1))).toEqual(["/c", "/b", "/a", "/z"]);
  expect(folders(moveRecentWorkbench(entries, "/a", -1))).toEqual(["/c", "/b", "/a", "/z"]);
  expect(() => moveRecentWorkbench(entries, "/missing", 1)).toThrow(
    expect.objectContaining({ code: "NOT_FOUND" }),
  );
});

it("accepts a session move request and a stored session order, but not from the public settings patch", () => {
  const move = { workbenchId, sessionId: id(1), offset: -1 };
  expect(channels["session.move"].request.parse(move)).toEqual(move);
  for (const value of [
    { ...move, offset: 2 },
    { ...move, offset: 0 },
    { ...move, sessionId: "bad" },
    { sessionId: move.sessionId, offset: 1 },
    { ...move, extra: 1 },
  ])
    expect(channels["session.move"].request.safeParse(value).success).toBe(false);
  const recent = { move: { folder: "/bench", offset: 1 } };
  expect(channels["workbench.recent"].request.parse(recent)).toEqual(recent);
  expect(
    channels["workbench.recent"].request.safeParse({ move: { folder: "/bench", offset: 3 } }).success,
  ).toBe(false);
  const sessionOrder = { [workbenchId]: [id(2), id(1)] };
  expect(settingsSchema.parse({ ...defaultSettings(installationId), sessionOrder }).sessionOrder).toEqual(
    sessionOrder,
  );
  expect(
    settingsSchema.safeParse({ ...defaultSettings(installationId), sessionOrder: { x: [] } }).success,
  ).toBe(false);
  expect(settingsServicePatchSchema.safeParse({ sessionOrder }).success).toBe(true);
  expect(settingsPatchSchema.safeParse({ sessionOrder }).success).toBe(false);
});
