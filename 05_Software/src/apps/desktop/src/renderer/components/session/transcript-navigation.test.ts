// REQ-UX-b2f6ffa8 REQ-UX-a3be2b11 REQ-UX-7b49305a REQ-FUNC-1219a1e4 REQ-UX-2bbfd052
import { expect, it } from "vitest";
import {
  currentIndex,
  groupMarkers,
  MARKER_SIZE,
  markerCenter,
  previewText,
  scrollTarget,
} from "./transcript-navigation.js";

it("normalizes white space and cuts previews at 140 code points", () => {
  expect(previewText("  Two\n\nlines\tand   spaces ")).toBe("Two lines and spaces");
  expect(previewText("")).toBe("");
  expect(previewText(" \n ")).toBe("");
  const long = "😀".repeat(150);
  expect(Array.from(previewText(long))).toHaveLength(141);
  expect(previewText(long).endsWith("…")).toBe(true);
  expect(previewText("a".repeat(140))).toBe("a".repeat(140));
  expect(previewText("<b>raw</b>")).toBe("<b>raw</b>");
  expect(previewText("word ".repeat(5000))).toBe(`${"word ".repeat(28)}…`);
});

it("maps a message start to the lane over the whole content", () => {
  expect(markerCenter(0, 1000, 500)).toBe(12);
  expect(markerCenter(1000, 1000, 500)).toBe(488);
  expect(markerCenter(500, 1000, 500)).toBe(250);
  expect(markerCenter(2000, 1000, 500)).toBe(488);
  expect(markerCenter(-5, 1000, 500)).toBe(12);
  expect(markerCenter(10, 0, 500)).toBe(488);
  expect(markerCenter(10, 1000, 0)).toBe(12);
  expect(Number.isFinite(markerCenter(Number.NaN, 1000, 500))).toBe(true);
});

it("keeps the scroll target inside the native range", () => {
  expect(scrollTarget(500, 2000, 400)).toBe(484);
  expect(scrollTarget(10, 2000, 400)).toBe(0);
  expect(scrollTarget(1990, 2000, 400)).toBe(1600);
  expect(scrollTarget(100, 300, 400)).toBe(0);
});

it("marks the last message at or above the reading line, else the first", () => {
  const starts = [0, 400, 900, 1500];
  expect(currentIndex(starts, 0, 400)).toBe(0);
  expect(currentIndex(starts, 330, 400)).toBe(1);
  expect(currentIndex(starts, 300, 400)).toBe(0);
  expect(currentIndex([200, 600], 0, 400)).toBe(0);
  expect(currentIndex(starts, 5000, 400)).toBe(3);
  expect(currentIndex(starts, 100, 100)).toBe(0);
  expect(currentIndex(starts, 900 - 81, 1000)).toBe(1);
  expect(currentIndex(starts, 900 - 80, 1000)).toBe(2);
  expect(currentIndex([], 100, 400)).toBe(-1);
});

const overlaps = (groups: { center: number }[]) =>
  groups.some((group, index) => index > 0 && group.center - (groups[index - 1]?.center ?? 0) < MARKER_SIZE);

it("keeps distant markers apart and merges close ones in order", () => {
  expect(groupMarkers([12, 100, 300], 500)).toEqual([
    { center: 12, members: [0] },
    { center: 100, members: [1] },
    { center: 300, members: [2] },
  ]);
  const merged = groupMarkers([100, 110, 300], 500);
  expect(merged).toEqual([
    { center: 105, members: [0, 1] },
    { center: 300, members: [2] },
  ]);
  expect(groupMarkers([100, 120, 140, 160], 500)).toEqual([
    { center: 110, members: [0, 1] },
    { center: 150, members: [2, 3] },
  ]);
  expect(groupMarkers([100, 110, 120, 130], 500)).toEqual([{ center: 115, members: [0, 1, 2, 3] }]);
});

it("groups deterministically without overlaps, at the edges and in short lanes", () => {
  const centers = Array.from({ length: 500 }, (_, index) => 12 + (index * 476) / 499);
  const groups = groupMarkers(centers, 500);
  expect(overlaps(groups)).toBe(false);
  expect(groups.flatMap((group) => group.members)).toEqual(centers.map((_, index) => index));
  expect(groupMarkers(centers, 500)).toEqual(groups);
  for (const group of groups) {
    expect(group.center).toBeGreaterThanOrEqual(12);
    expect(group.center).toBeLessThanOrEqual(488);
  }
  const edge = groupMarkers([12, 20, 480, 488], 500);
  expect(overlaps(edge)).toBe(false);
  expect(edge.map((group) => group.members)).toEqual([
    [0, 1],
    [2, 3],
  ]);
  expect(groupMarkers([5, 10, 15], 20)).toEqual([{ center: 10, members: [0, 1, 2] }]);
  expect(groupMarkers([], 500)).toEqual([]);
});
