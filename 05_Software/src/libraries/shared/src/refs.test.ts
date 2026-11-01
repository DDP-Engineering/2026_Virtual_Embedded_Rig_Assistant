import { expect, it } from "vitest";
import * as api from "./index.js";

// REQ-FUNC-7cd31fe3
it("round trips every reference kind and labels its exact locator", () => {
  expect(api.parseRef).toBeTypeOf("function");
  const cases = [
    [
      "docs/Banc ă#notes.PDF#p=2",
      { kind: "page", path: "docs/Banc ă#notes.PDF", page: 2 },
      "Banc ă#notes.PDF p2",
    ],
    ["docs/a.pdf#p=2-3", { kind: "page-range", path: "docs/a.pdf", start: 2, end: 3 }, "a.pdf p2–3"],
    ["docs/a.pdf#p=1-1", { kind: "page-range", path: "docs/a.pdf", start: 1, end: 1 }, "a.pdf p1–1"],
    [
      "docs/a.md#h=alimentare-ă_2",
      { kind: "heading", path: "docs/a.md", slug: "alimentare-ă_2" },
      "a.md #alimentare-ă_2",
    ],
    ["docs/a.html#h=reset-1", { kind: "heading", path: "docs/a.html", slug: "reset-1" }, "a.html #reset-1"],
    ["logs/boot.log#L1-L2", { kind: "lines", path: "logs/boot.log", start: 1, end: 2 }, "boot.log L1–2"],
    ["artifact:summary.md", { kind: "artifact", name: "summary.md" }, "summary.md"],
  ] as const;
  for (const [ref, value, label] of cases) {
    expect(api.parseRef(ref)).toEqual(value);
    expect(api.formatRef(value)).toBe(ref);
    expect(api.referenceLabel(ref)).toBe(label);
  }
});
it("rejects malformed page/heading/artifact refs and escaping paths", () => {
  expect(api.parseRef).toBeTypeOf("function");
  for (const ref of [
    "a#p=0",
    "a#p=01",
    "a#p=2-1",
    "a#p=1-0",
    "a#p=1-9007199254740992",
    "a#p=1.5",
    "a#p=1-2-3",
    "a#h=power sequence",
    "a#h=power#extra",
    "a#h=../power",
    "a#L2-L1",
    "/a#p=1",
    "../a#p=1",
    "a//b#h=ok",
    "a\\b#p=1",
    "C:a#p=1",
    "a\n#p=1",
    "artifact:../a",
    "artifact:CON.txt",
    "artifact:a.",
    "plain-path",
  ])
    expect(api.parseRef(ref), ref).toBeUndefined();
  expect(() => api.formatRef({ kind: "page", path: "a", page: 0 })).toThrow();
  expect(() => api.formatRef({ kind: "page-range", path: "a", start: 2, end: 1 })).toThrow();
  expect(() => api.formatRef({ kind: "heading", path: "a", slug: "power#h=reset" })).toThrow();
  expect(() => api.formatRef({ kind: "artifact", name: "CON" })).toThrow();
  expect(api.referenceLabel("malformed")).toBe("malformed");
});

it("rejects final line terminators without discarding bytes for every kind and legacy API", () => {
  for (const end of ["\n", "\r", "\r\n", "\u2028", "\u2029"]) {
    for (const ref of ["a.pdf#p=1", "a.pdf#p=1-2", "a.md#h=power", "a#L1-L2", "artifact:a.md"])
      expect(api.parseRef(ref + end), JSON.stringify(ref + end)).toBeUndefined();
    expect(api.parseLineRef(`a#L1-L2${end}`)).toBeUndefined();
    expect(api.parseArtifactRef(`artifact:a.md${end}`)).toBeUndefined();
    expect(api.validArtifactName(`a.md${end}`)).toBe(false);
    expect(() => api.formatRef({ kind: "heading", path: "a.md", slug: `power${end}` })).toThrow();
    expect(() => api.formatLineRef({ path: `a${end}`, start: 1, end: 2 })).toThrow();
    expect(() => api.formatArtifactRef(`a.md${end}`)).toThrow();
  }
});
it("preserves bracket paths accepted by the existing line API", () => {
  for (const path of ["docs/board[revA.md", "docs/board[revA].md"]) {
    const value = { path, start: 1, end: 2 };
    const ref = `${path}#L1-L2`;
    expect(api.formatLineRef(value)).toBe(ref);
    expect(api.parseLineRef(ref)).toEqual(value);
    expect(api.parseRef(ref)).toEqual({ kind: "lines", ...value });
    expect(api.formatRef({ kind: "heading", path, slug: "power" })).toBe(`${path}#h=power`);
  }
});

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

// REQ-FUNC-626d3017
it("round trips an empty heading slug as the untitled leading section", () => {
  const value = { kind: "heading", path: "docs/notes.docx", slug: "" } as const;
  expect(api.parseRef("docs/notes.docx#h=")).toEqual(value);
  expect(api.formatRef(value)).toBe("docs/notes.docx#h=");
  expect(api.referenceLabel("docs/notes.docx#h=")).toBe("notes.docx #start");
  for (const ref of ["docs/notes.docx", "../a#h=", "a//b#h=", "/a#h=", "a#h=-#"])
    expect(api.parseRef(ref), ref).toBeUndefined();
  expect(() => api.formatRef({ kind: "heading", path: "../a", slug: "" })).toThrow();
});
