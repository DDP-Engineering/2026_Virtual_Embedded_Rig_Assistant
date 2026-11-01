// REQ-DATA-3b6664f9 REQ-REL-f19a4bc2 REQ-FUNC-d9d16533
import { expect, it } from "vitest";
import { readTabs, removeTabs, type StoredTabs, writeTabs } from "./document-tabs-store.js";

function memory() {
  const items = new Map<string, string>();
  return {
    items,
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  };
}
const record: StoredTabs = {
  version: 1,
  active: "file:docs/a.md",
  tabs: [
    { target: { path: "docs/a.md" }, place: { scroll: 120 } },
    { target: { ref: "docs/a.pdf#p=3" }, place: { page: 3 } },
    { target: { textPath: "logs/big.log", ignored: true }, place: { line: 251 } },
    { target: { downloadId: "dl_1" } },
  ],
};

it("keeps one record per workbench session under its own key", () => {
  const storage = memory();
  writeTabs(storage, "wb_1", "s_1", record);
  writeTabs(storage, "wb_1", "s_2", { ...record, tabs: [] });
  expect([...storage.items.keys()]).toEqual(["vera.tabs.wb_1.s_1", "vera.tabs.wb_1.s_2"]);
  expect(readTabs(storage, "wb_1", "s_1")).toEqual(record);
  expect(readTabs(storage, "wb_2", "s_1")).toBeUndefined();
  removeTabs(storage, "wb_1", "s_1");
  expect([...storage.items.keys()]).toEqual(["vera.tabs.wb_1.s_2"]);
});

it("reads a missing, unparsable, foreign-version or tampered record as nothing", () => {
  const storage = memory();
  const key = "vera.tabs.wb_1.s_1";
  expect(readTabs(storage, "wb_1", "s_1")).toBeUndefined();
  for (const bad of [
    "{not json",
    JSON.stringify({ ...record, version: 2 }),
    JSON.stringify({ ...record, extra: true }),
    JSON.stringify({ ...record, tabs: [{ target: { path: "" } }] }),
    JSON.stringify({ ...record, tabs: [{ target: { path: "a" }, place: { page: -1 } }] }),
    JSON.stringify({ ...record, tabs: [{ target: { url: "https://example.com" } }] }),
  ]) {
    storage.items.set(key, bad);
    expect(readTabs(storage, "wb_1", "s_1")).toBeUndefined();
  }
});

it("never throws when storage is unavailable or full", () => {
  const broken = {
    getItem: () => {
      throw new Error("denied");
    },
    setItem: () => {
      throw new Error("quota");
    },
    removeItem: () => {
      throw new Error("denied");
    },
  };
  expect(readTabs(broken, "wb_1", "s_1")).toBeUndefined();
  expect(() => writeTabs(broken, "wb_1", "s_1", record)).not.toThrow();
  expect(() => removeTabs(broken, "wb_1", "s_1")).not.toThrow();
});

it("leaves out tabs it cannot store, keeps the newest 200 and never rewrites a deleted record", () => {
  const storage = memory();
  const many = Array.from({ length: 205 }, (_, i) => ({ target: { path: `docs/${i}.md` } }));
  writeTabs(storage, "wb_1", "s_3", {
    version: 1,
    active: "",
    tabs: [{ target: { path: "x".repeat(5000) } }, ...many],
  });
  const saved = readTabs(storage, "wb_1", "s_3");
  expect(saved?.active).toBe("chat");
  expect(saved?.tabs).toHaveLength(200);
  expect(saved?.tabs[0]?.target).toEqual({ path: "docs/5.md" });
  // A save still pending when the session is deleted must not bring its record back.
  removeTabs(storage, "wb_1", "s_3");
  writeTabs(storage, "wb_1", "s_3", record);
  expect(readTabs(storage, "wb_1", "s_3")).toBeUndefined();
  writeTabs(storage, "wb_1", "s_4", record);
  expect(readTabs(storage, "wb_1", "s_4")).toEqual(record);
});
