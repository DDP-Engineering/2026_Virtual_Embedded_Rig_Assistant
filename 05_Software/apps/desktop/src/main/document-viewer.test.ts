// REQ-FUNC-28ad0001

import { scrub as redact } from "@vera/core";
import { channels, documentSchema, documentSearchHitSchema, viewerContentSchema } from "@vera/shared";
import { expect, it } from "vitest";
import { publicDocument, publicDocumentHit, publicViewer } from "./document-viewer.js";

it("scrubs textual document content while retaining exact PDF bytes and locator identity", () => {
  const result = publicViewer(
    {
      kind: "pdf",
      data: "secretBASE64",
      path: "docs/a.pdf",
      ref: "docs/a.pdf#p=1",
      snippet: "secret",
      pages: ["secret text"],
      page: 1,
      pageEnd: 1,
    },
    (v) => v.replaceAll("secret", "[redacted]"),
  );
  expect(result).toMatchObject({
    data: "secretBASE64",
    snippet: "[redacted]",
    pages: ["[redacted] text"],
    ref: "docs/a.pdf#p=1",
  });
});
it("redacts Docs paths/ref/snippets and retains protocol metadata and snippet bounds", () => {
  const scrub = (value: string) => value.replaceAll("secret", "[redacted]");
  const doc = documentSchema.parse({
    id: 42,
    path: "docs/secret.md",
    kind: "markdown",
    sha256: "a".repeat(64),
    bytes: 300,
    mtime: "2026-10-13T00:00:00.000Z",
    pages: null,
    status: "indexed",
    error: null,
    indexedAt: null,
  });
  expect(publicDocument(doc, scrub)).toBeUndefined();
  expect(publicDocument({ ...doc, path: "docs/a.md" }, scrub)).toEqual({ ...doc, path: "docs/a.md" });
  const hit = publicDocumentHit(
    { ref: "docs/secret.md#h=power", path: "docs/secret.md", snippet: "secret ".repeat(42), score: 1 },
    scrub,
  );
  expect(hit).toBeUndefined();
  expect(
    publicDocumentHit({ ref: "docs/a.md#h=power", path: "docs/a.md", snippet: "secret", score: 1 }, scrub)
      ?.ref,
  ).toBe("docs/a.md#h=power");
  const content = publicViewer(
    {
      kind: "markdown",
      path: "docs/a.md",
      ref: null,
      snippet: "",
      anchor: "secret",
      sections: [{ slug: "secret", text: "# secret", path: ["secret"], start: 1, end: 1 }],
    },
    scrub,
  );
  expect(JSON.stringify(content)).not.toContain("secret");
});
it("retains a valid complete search response beside sensitive headings and bounds actual redactor expansion", () => {
  const scrub = (text: string) => redact(text, ["secret", "key"]);
  const hits = [
    { ref: "docs/a.md#h=secret", path: "docs/a.md", snippet: "secret", score: 2 },
    { ref: "docs/a.md#h=power", path: "docs/a.md", snippet: "key ".repeat(75), score: 1 },
  ]
    .map((hit) => publicDocumentHit(hit, scrub))
    .filter((hit) => hit !== undefined);
  const response = channels["docs.search"].response.parse({
    workbenchId: "wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C",
    results: hits,
  });
  expect(response.results).toHaveLength(1);
  expect(response.results[0]?.ref).toBe("docs/a.md#h=power");
  expect(documentSearchHitSchema.safeParse(response.results[0]).success).toBe(true);
  expect(response.results[0]?.snippet.length).toBeLessThanOrEqual(300);
  const content = publicViewer(
    {
      kind: "text",
      path: "a.txt",
      ref: "a.txt#L1-L1",
      snippet: "key".repeat(4000),
      lines: ["key"],
      start: 1,
      end: 1,
    },
    scrub,
  );
  expect(content.snippet.length).toBe(12000);
  expect(content.snippet).not.toContain("key");
  expect(viewerContentSchema.safeParse(content).success).toBe(true);
});
