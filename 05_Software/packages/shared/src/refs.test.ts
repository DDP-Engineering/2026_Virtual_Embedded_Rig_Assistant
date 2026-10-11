import { expect, it } from "vitest";
import * as api from "./index.js";

it("round trips relative Unicode line references", () => {
  expect(api.formatLineRef).toBeTypeOf("function");
  const value = { path: "docs/Banc ă#notes.md", start: 1, end: 12 };
  expect(api.formatLineRef(value)).toBe("docs/Banc ă#notes.md#L1-L12");
  expect(api.parseLineRef(api.formatLineRef(value))).toEqual(value);
  expect(api.parseLineRef("x#L2-L2")).toEqual({ path: "x", start: 2, end: 2 });
});
it("refuses invalid line ranges, escaping paths and other locator kinds", () => {
  expect(api.parseLineRef).toBeTypeOf("function");
  for (const ref of [
    "x#L0-L1",
    "x#L2-L1",
    "x#L1-L9007199254740992",
    "/x#L1-L1",
    "../x#L1-L1",
    "x#p=1",
    "x#L1.5-L2",
    "x#L01-L2",
  ])
    expect(api.parseLineRef(ref)).toBeUndefined();
  expect(() => api.formatLineRef({ path: "x", start: 0, end: 1 })).toThrow();
});
