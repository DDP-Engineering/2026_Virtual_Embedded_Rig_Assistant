// REQ-FUNC-065c8ad1 REQ-FUNC-37067755 REQ-FUNC-9a05625c REQ-DATA-b12d0ef7
import { expect, it } from "vitest";
import { documentGuard, fileLimit, topFolders } from "./guard.js";

const files = (folder: string, count: number) =>
  Array.from({ length: count }, (_, n) => `${folder}/${String(n).padStart(5, "0")}.md`);

it("limits to docs.maxFiles, raised to 120 % of an approved count", () => {
  expect(fileLimit(10000, null)).toBe(10000);
  expect(fileLimit(10000, 5000)).toBe(10000);
  expect(fileLimit(10000, 12000)).toBe(14400);
  expect(fileLimit(10, 11)).toBe(13);
});

it("stops only a selection above the limit", () => {
  expect(documentGuard(files("docs", 10), 10, null)).toBeNull();
  expect(documentGuard(files("docs", 9), 10, null)).toBeNull();
  expect(documentGuard(files("docs", 11), 10, null)).toEqual({
    files: 11,
    limit: 10,
    folders: [{ path: "docs", files: 11 }],
  });
  // After approving 12,000: 12,500 keeps indexing, 24,000 stops with the raised limit.
  expect(documentGuard(files("docs", 12500), 10000, 12000)).toBeNull();
  expect(documentGuard(files("docs", 24000), 10000, 12000)).toMatchObject({ files: 24000, limit: 14400 });
});

it("lists the ten folders with the most selected files, subfolders included", () => {
  const paths = Array.from({ length: 12 }, (_, n) => files(`f${String(n).padStart(2, "0")}`, 3)).flat();
  expect(topFolders(paths)).toEqual(
    Array.from({ length: 10 }, (_, n) => ({ path: `f${String(n).padStart(2, "0")}`, files: 3 })),
  );
  // A single chain is listed by its first folder; a smaller subfolder follows its parent.
  expect(
    topFolders([
      ...files(".venv/lib/site/numpy", 5),
      ...files(".venv/lib/site/scipy", 2),
      ...files("docs", 3),
      "readme.md",
    ]),
  ).toEqual([
    { path: ".venv", files: 7 },
    { path: ".venv/lib/site/numpy", files: 5 },
    { path: "docs", files: 3 },
    { path: ".venv/lib/site/scipy", files: 2 },
  ]);
  // Root files count toward no folder.
  expect(topFolders(["a.md", "b.md"])).toEqual([]);
});
