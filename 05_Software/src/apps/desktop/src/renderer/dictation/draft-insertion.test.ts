import { expect, test } from "vitest";
import { insertDictation } from "./draft-insertion.js";

test("dictation inserts after selected text and leaves the caret before the preserved suffix", () => {
  expect(insertDictation("left right", 4, "spoken words")).toEqual({
    text: "left spoken words right",
    caret: 17,
  });
  expect(insertDictation("left,right", 4, " spoken words ")).toEqual({
    text: "left spoken words,right",
    caret: 17,
  });
  expect(insertDictation("rest", 0, "begin")).toEqual({ text: "begin rest", caret: 5 });
});

test("a changed draft receives its transcript at the end, preserving existing whitespace", () => {
  expect(insertDictation("new draft\n", null, "spoken words")).toEqual({
    text: "new draft\nspoken words",
    caret: 22,
  });
  expect(insertDictation("text", 2, " ")).toEqual({ text: "text", caret: 2 });
});
