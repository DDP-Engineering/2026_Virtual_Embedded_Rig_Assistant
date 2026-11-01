// REQ-FUNC-7871b582 REQ-REL-514e47d3
import { existsSync } from "node:fs";
import { SettingsService } from "@vera/core";
import { beforeAll, expect, it, vi } from "vitest";

let createSessionOrder: typeof import("./session-order.js").createSessionOrder;
beforeAll(async () => {
  expect(existsSync(new URL("./session-order.ts", import.meta.url)), "session order module exists").toBe(
    true,
  );
  ({ createSessionOrder } = await import("./session-order.js"));
});
const id = (n: number) => `ses_${String(n).padStart(26, "0")}`;
const session = (n: number, archived = false) => ({ id: id(n), archived });
const numbers = (list: readonly { id: string }[]) => list.map((s) => Number(s.id.slice(4)));
const benchA = "wb_01ARZ3NDEKTSV4RRFFQ69G5FAA";
const benchB = "wb_01ARZ3NDEKTSV4RRFFQ69G5FAB";

async function harness(text?: string) {
  const disk = new Map<string, string>();
  if (text !== undefined) disk.set("/data/settings.json", text);
  const files = {
    read: vi.fn(async (p: string) => disk.get(p)),
    writeAtomic: vi.fn(async (p: string, value: string) => {
      disk.set(p, value);
    }),
  };
  const settings = new SettingsService({
    files,
    paths: { userData: "/data", settings: "/data/settings.json", logs: "/data/logs" },
    uuid: () => "1b9dc50c-d87d-484b-88e6-04cb5f7c5a19",
    changed: vi.fn(),
  });
  await settings.load();
  return { disk, settings, order: createSessionOrder(settings) };
}

it("persists the order per workbench in user settings and lists new sessions first", async () => {
  const h = await harness();
  const list = [3, 2, 1].map((n) => session(n));
  await h.order.move(benchA, list, id(1), -1);
  await h.order.move(benchA, list, id(1), -1);
  expect(numbers(h.order.list(benchA, list))).toEqual([1, 3, 2]);
  expect(numbers(h.order.list(benchB, list))).toEqual([3, 2, 1]);
  await h.order.move(benchB, list, id(3), 1);
  expect(h.settings.get().settings.sessionOrder).toEqual({
    [benchA]: [id(1), id(3), id(2)],
    [benchB]: [id(2), id(3), id(1)],
  });
  // A session created afterwards is listed first.
  expect(numbers(h.order.list(benchA, [session(4), ...list]))).toEqual([4, 1, 3, 2]);
  // Concurrent moves are applied one after the other.
  await Promise.all([h.order.move(benchA, list, id(2), -1), h.order.move(benchA, list, id(2), -1)]);
  expect(numbers(h.order.list(benchA, list))).toEqual([2, 1, 3]);
  // The order survives reloading the settings file.
  const reloaded = await harness(h.disk.get("/data/settings.json"));
  expect(numbers(reloaded.order.list(benchA, list))).toEqual([2, 1, 3]);
});
