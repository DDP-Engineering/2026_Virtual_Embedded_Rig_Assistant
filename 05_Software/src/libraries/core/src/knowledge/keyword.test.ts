import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import * as core from "../index.js";
import type { WorkbenchDatabase } from "../storage/db.js";
import { DocumentsRepository } from "../storage/repos/documents.js";
import type { Chunk } from "./chunk.js";

let root: string;
let handle: WorkbenchDatabase;
let search: core.KeywordSearch;
let rows: DocumentsRepository;
const options = { workbenchId: "keyword-test", appVersion: "0.0.0" };
beforeEach(async () => {
  expect(typeof core.KeywordSearch, "public persisted keyword search capability").toBe("function");
  root = await mkdtemp(join(tmpdir(), "vera-keyword-"));
  handle = await core.openDb(join(root, "vera.db"), options);
  rows = new DocumentsRepository(handle.db);
  search = new core.KeywordSearch(handle.db);
});
afterEach(async () => {
  handle?.close();
  if (root) await rm(root, { recursive: true, force: true });
});
function add(path: string, chunks: Chunk[]) {
  const doc = rows.save({
    path,
    kind: "pdf",
    sha256: "a".repeat(64),
    bytes: 100,
    mtime: "2026-10-12T00:00:00Z",
    pages: 10,
    status: "indexed",
    error: null,
    indexedAt: null,
  });
  rows.replaceChunks(doc.id, chunks);
  return doc;
}
const page = (text: string, n = 1): Chunk => ({ text, locator: { type: "page", page: n } });
it("finds whole underscore words and qualifying fragments and ranks the defining page first", () => {
  add("docs/reference.pdf", [page("I2C1_CR1 control register. I2C1_CR1 defines enable bits.", 2)]);
  add("docs/application.pdf", [
    page("For bring-up, see the I2C1_CR1 register. " + "Additional context. ".repeat(25), 8),
  ]);
  for (const query of ["I2C1_CR1", "C1_CR"]) {
    const hits = search.search(query);
    expect(hits).toHaveLength(2);
    expect(hits[0]).toMatchObject({
      id: 1,
      docId: 1,
      ordinal: 0,
      path: "docs/reference.pdf",
      locator: { type: "page", page: 2 },
      rank: 1,
    });
    expect(hits[0]?.text).toContain("defines enable bits");
    expect(hits[0]?.bm25).toBeLessThan(0);
    expect(hits[1]?.rank).toBe(2);
  }
});
it("uses literal OR terms safely for punctuation, SQL/FTS syntax, case, diacritics and duplicates", () => {
  add("docs/words.pdf", [page("I2C1_CR1 alimentare tensiune și cafe\u0301 OR NOT NEAR")]);
  for (const query of ["", " \n ", '"*():-+;[]\u0000', "🙂"]) expect(search.search(query)).toEqual([]);
  for (const query of [
    '"i2c1_cr1"*',
    "I2C1_CR1) OR (absent",
    "I2C1_CR1'; DROP TABLE chunks;--",
    "alimentare şi",
    "café",
    "cafe\u0301",
    "OR NOT NEAR",
    "I2C1_CR1 I2C1_CR1",
  ]) {
    expect(search.search(query).map((c) => c.id)).toEqual([1]);
  }
  expect(handle.db.prepare("SELECT count(*) FROM chunks").pluck().get()).toBe(1);
});
it("uses only 3+ codepoint digit/underscore terms for fragment matches", () => {
  add("docs/part.pdf", [page("STM32G431 abcdef PA5 _AB")]);
  expect(search.search("32G").map((c) => c.id)).toEqual([1]);
  expect(search.search("_AB").map((c) => c.id)).toEqual([1]);
  expect(search.search("32")).toEqual([]);
  expect(search.search("PA")).toEqual([]);
  expect(search.search("bcd")).toEqual([]);
  expect(search.search("PA5")).toHaveLength(1);
});
it("caps each list and the deduplicated union at 50 with deterministic numeric-id ties", () => {
  add(
    "docs/many.pdf",
    Array.from({ length: 60 }, (_, i) => page("I2C1_CR1", i + 1)),
  );
  for (const query of ["I2C1_CR1", "C1_CR", "I2C1_CR1 C1_CR I2C1_CR1"]) {
    const hits = search.search(query);
    expect(hits.map((c) => c.id)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(hits.map((c) => c.rank)).toEqual(Array.from({ length: 50 }, (_, i) => i + 1));
    expect(search.search(query)).toEqual(hits);
  }
});
it("preserves bm25 order for ordinary words and returns every stored locator kind", () => {
  add("docs/locators.pdf", [
    page("supply " + "unrelated ".repeat(30), 3),
    {
      text: "supply supply",
      locator: { type: "heading", path: ["Board", "Power"], slug: "power", start: 2, end: 4 },
    },
    { text: "supply", locator: { type: "lines", start: 40, end: 43 } },
  ]);
  const hits = search.search("supply");
  expect(hits.map((c) => c.id)).toEqual([2, 3, 1]);
  expect(hits[0]?.locator).toEqual({
    type: "heading",
    path: ["Board", "Power"],
    slug: "power",
    start: 2,
    end: 4,
  });
  expect(hits[1]?.locator).toEqual({ type: "lines", start: 40, end: 43 });
  expect(hits[2]?.locator).toEqual({ type: "page", page: 3 });
});
it("reads persisted indexes through a readonly snapshot and survives source replacement/removal", async () => {
  const doc = add("docs/read.pdf", [page("I2C1_CR1")]);
  const read = await core.openDb(join(root, "vera.db"), { ...options, readOnly: true });
  try {
    expect(new core.KeywordSearch(read.db).search("C1_CR")).toEqual(search.search("C1_CR"));
    rows.replaceChunks(doc.id, [page("NEW2_REGISTER")]);
    expect(search.search("I2C1_CR1")).toEqual([]);
    expect(search.search("W2_REG")).toHaveLength(1);
    rows.remove(doc.path);
    expect(search.search("W2_REG")).toEqual([]);
  } finally {
    read.close();
  }
});
