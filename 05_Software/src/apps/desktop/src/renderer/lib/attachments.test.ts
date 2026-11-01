// REQ-FUNC-47287974 REQ-UX-b5edf930
import { expect, it } from "vitest";
import * as rules from "./attachments.js";

it("adds each entry once and stops at 20", () => {
  expect(rules.ATTACHMENT_LIMIT).toBe(20);
  expect(rules.addAttachment([], "docs/a.pdf")).toEqual(["docs/a.pdf"]);
  expect(rules.addAttachment(["docs/a.pdf"], "board.txt")).toEqual(["docs/a.pdf", "board.txt"]);
  const once = ["docs/a.pdf"];
  expect(rules.addAttachment(once, "docs/a.pdf")).toBe(once);
  const full = Array.from({ length: 20 }, (_, n) => `f${n}.txt`);
  expect(rules.addAttachment(full, "x.txt")).toBe(full);
});

it("writes @path mentions on a new line after the text, quoting paths with whitespace", () => {
  expect(rules.mention("docs/a.pdf")).toBe("@docs/a.pdf");
  expect(rules.mention("docs/my file.md")).toBe('@"docs/my file.md"');
  expect(rules.withMentions("Summarize ", ["docs/a.pdf", "docs/my file.md"])).toBe(
    'Summarize\n@docs/a.pdf @"docs/my file.md"',
  );
  // Only attachments: the mentions alone.
  expect(rules.withMentions("  ", ["docs/a.pdf"])).toBe("@docs/a.pdf");
  // Nothing attached: the text as typed.
  expect(rules.withMentions("Hello ", [])).toBe("Hello ");
});
