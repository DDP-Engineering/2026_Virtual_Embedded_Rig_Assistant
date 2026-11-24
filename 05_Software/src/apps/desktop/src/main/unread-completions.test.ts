import { unreadCompletionLimit } from "@vera/shared";
import { expect, test } from "vitest";
import { UnreadCompletions } from "./unread-completions.js";

const target = {
  folder: "/rig",
  workbenchId: "wb_01ARZ3NDEKTSV4RRFFQ69G5FA1",
  sessionId: "ses_01ARZ3NDEKTSV4RRFFQ69G5FA2",
};
const labels = { workbenchName: "Rig", title: "Probe the board" };

test("keeps the latest bounded set in this main process only", () => {
  const store = new UnreadCompletions();
  for (let i = 0; i <= unreadCompletionLimit; i++) store.add({ ...target, ...labels, title: String(i) });
  const entries = store.list();
  expect(entries).toHaveLength(unreadCompletionLimit);
  expect(entries[0]?.title).toBe(String(unreadCompletionLimit));
  expect(entries.at(-1)?.title).toBe("1");
  expect(new UnreadCompletions().list()).toEqual([]);
});

test("acknowledges only the selected marker of the exact owner", () => {
  const store = new UnreadCompletions();
  store.add({ ...target, ...labels });
  const [opened] = store.list();
  if (!opened) throw Error("The first completion is missing");
  store.read(opened.completionId, { ...target, folder: "/rig-copy" });
  expect(store.list()).toEqual([opened]);
  store.add({ ...target, ...labels, title: "A newer reply" });
  store.read(opened.completionId, target);
  expect(store.list().map(({ title }) => title)).toEqual(["A newer reply"]);
  store.clear();
  expect(store.list()).toEqual([]);
});

test("discarding a deleted target or removed workbench leaves other workbenches alone", () => {
  const store = new UnreadCompletions();
  store.add({ ...target, ...labels });
  store.add({ ...target, ...labels, sessionId: "ses_01ARZ3NDEKTSV4RRFFQ69G5FA3" });
  store.add({ ...target, ...labels, folder: "/rig-copy" });
  store.discard(target);
  expect(store.list()).toHaveLength(2);
  store.discardWorkbench(target.folder);
  expect(store.list().map(({ folder }) => folder)).toEqual(["/rig-copy"]);
});
