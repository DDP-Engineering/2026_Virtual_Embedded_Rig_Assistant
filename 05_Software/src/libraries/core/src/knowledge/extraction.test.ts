import { readFile } from "node:fs/promises";
import { Tokenizer } from "@huggingface/tokenizers";
import { expect, it } from "vitest";
import definition from "./bge-tokenizer.json";
import configuration from "./bge-tokenizer_config.json";
import { CHUNK_CHARS, chunkDocument, needsOcr } from "./chunk.js";
import { extractHtml, extractMarkdown, extractText } from "./extraction.js";

it("keeps identifier-heavy chunks below512 tokens including special tokens", () => {
  const tokenizer = new Tokenizer(definition, configuration);
  const doc = extractText("I2C1_CR1 = 0x40005400; WDG_KR = 0xAAAA;\n".repeat(100));
  const chunks = chunkDocument(doc);
  expect(chunks.every((c) => tokenizer.encode(c.text, { add_special_tokens: true }).ids.length < 512)).toBe(
    true,
  );
});
it("includes CSV/heading prefixes in code and Unicode token budgets", () => {
  const tokenizer = new Tokenizer(definition, configuration);
  const csv = chunkDocument(extractText(`id,value\n${"I2C1_CR1,0x40005400\n".repeat(100)}`), true);
  const headings = chunkDocument(extractMarkdown(`# Registers\n${"I2C1_CR1 = 0x40005400;\n".repeat(150)}`));
  const pages = chunkDocument({
    kind: "pdf",
    pages: ["I2C1_CR1 = 0x40005400;\n".repeat(150), "第二页 寄存器 寄存器\n".repeat(100)],
  });
  expect(
    [...csv, ...headings, ...pages].every(
      (c) => tokenizer.encode(c.text, { add_special_tokens: true }).ids.length < 512,
    ),
  ).toBe(true);
  expect(() => chunkDocument(extractText("! ".repeat(600)), true)).toThrow(/budget/);
});
it("keeps the entire long heading path in every chunk text and rejects prefix overflow", () => {
  const title = "Heading ".repeat(70).trim();
  const chunks = chunkDocument(extractMarkdown(`# ${title}\n${"paragraph ".repeat(200)}`));
  expect(chunks.every((c) => c.text.startsWith(`${title}\n`))).toBe(true);
  expect(() => chunkDocument(extractMarkdown(`# ${"a".repeat(1400)}\nbody`))).toThrow(/heading|budget/i);
});

const fixture = (name: string) =>
  readFile(new URL(`../../../../../tests/fixtures/documents/${name}`, import.meta.url), "utf8");
it("extracts UTF8 CommonMark headings, unique anchors, Setext and original lines outside fences", async () => {
  const doc = extractMarkdown(await fixture("sections.md"));
  expect(doc.kind).toBe("markdown");
  if (doc.kind !== "markdown") throw Error("fixture kind");
  expect(doc.sections.map((s) => [s.path, s.slug, s.start, s.end])).toEqual([
    [[], "", 1, 2],
    [["Board VERA"], "board-vera", 3, 5],
    [["Board VERA", "Power"], "power", 6, 12],
    [["Board VERA", "Power"], "power-1", 13, 15],
    [["Board VERA", "Timing"], "timing", 16, 18],
  ]);
  const chunks = chunkDocument(doc);
  expect(chunks[2]).toMatchObject({
    locator: { type: "heading", path: ["Board VERA", "Power"], start: 6, end: 11 },
    text: expect.stringContaining("This is code"),
  });
  expect(chunks[2]?.text.startsWith("Board VERA > Power\n")).toBe(true);
});
it("strips HTML tags, decodes entities, keeps heading hierarchy and block breaks", async () => {
  const doc = extractHtml(await fixture("sections.html"));
  const chunks = chunkDocument(doc);
  expect(chunks.map((c) => c.text).join("\n")).toContain("RESET < 1 V");
  expect(chunks.map((c) => c.text).join("\n")).not.toMatch(/hidden|<p>|Not body/);
  expect(chunks[2]?.locator).toEqual({ type: "heading", path: ["Board VERA", "Power"], slug: "power" });
  expect(chunks[3]).toMatchObject({
    text: expect.stringContaining("First\nSecond"),
    locator: { slug: "power-1" },
  });
});
it.each(["txt", "log", "csv", "tsv", "json", "yaml", "yml", "xml", "ini", "cfg", "c", "h", "py"])(
  "extracts %s UTF8 physical lines without a synthetic trailing line",
  () => {
    expect(extractText("șină\r\nGröße\nlast\r")).toEqual({
      kind: "text",
      lines: ["șină", "Größe", "last"],
    });
  },
);
it("chunks 60 physical lines with exactly10 overlap and repeats CSV header", () => {
  const lines = Array.from({ length: 120 }, (_, n) => `line ${n + 1}`);
  const chunks = chunkDocument(extractText(lines.join("\n")));
  expect(chunks.map((c) => c.locator)).toEqual([
    { type: "lines", start: 1, end: 60 },
    { type: "lines", start: 51, end: 110 },
    { type: "lines", start: 101, end: 120 },
  ]);
  expect(chunks[0]?.text.split("\n").slice(-10)).toEqual(chunks[1]?.text.split("\n").slice(0, 10));
  const csv = chunkDocument(extractText(`pin,voltage\n${lines.join("\n")}`), true);
  expect(csv.map((c) => c.locator)).toEqual([
    { type: "lines", start: 2, end: 61 },
    { type: "lines", start: 52, end: 111 },
    { type: "lines", start: 102, end: 121 },
  ]);
  expect(csv.every((c) => c.text.startsWith("pin,voltage\n"))).toBe(true);
  expect(csv[0]?.text.split("\n").slice(-10)).toEqual(csv[1]?.text.split("\n").slice(1, 11));
});
it("keeps PDF pages separate, splitting paragraphs and unbroken long text without loss", () => {
  const pages = [`${"alpha ".repeat(170)}\n\n${"beta ".repeat(300)}`, `page two ${"x".repeat(3000)}`];
  const chunks = chunkDocument({ kind: "pdf", pages });
  for (const page of [1, 2]) {
    const group = chunks.filter((c) => c.locator.type === "page" && c.locator.page === page);
    expect(group.map((c) => c.text).join("")).toBe(pages[page - 1]);
    expect(group.every((c) => c.text.length <= CHUNK_CHARS)).toBe(true);
  }
  expect(chunks[0]?.text.endsWith("\n\n")).toBe(true);
});
it("splits long Unicode sections/lines within budget and retains exact anchors and line ranges", () => {
  const body = "😺".repeat(2000);
  const md = chunkDocument(extractMarkdown(`# Root\n## Supply\n${body}\nnext`));
  const supply = md.filter((c) => c.locator.type === "heading" && c.locator.slug === "supply");
  expect(supply.map((c) => c.text.slice("Root > Supply\n".length)).join("")).toBe(`## Supply\n${body}\nnext`);
  expect(supply.every((c) => c.text.length <= CHUNK_CHARS && !/[\uD800-\uDBFF]$/.test(c.text))).toBe(true);
  const text = chunkDocument(extractText(`${body}\nlast`));
  expect(text.map((c) => c.text).join("")).toBe(`${body}\nlast`);
  expect(text.at(-1)?.locator).toEqual({ type: "lines", start: 1, end: 2 });
});
it("handles empty input, inclusive OCR boundary and blank pages", () => {
  expect(chunkDocument(extractText(""))).toEqual([]);
  expect(chunkDocument(extractMarkdown(""))).toEqual([]);
  expect(needsOcr({ kind: "pdf", pages: [" ", "x".repeat(39)] })).toBe(true);
  expect(needsOcr({ kind: "pdf", pages: ["", "x".repeat(40)] })).toBe(false);
  expect(chunkDocument({ kind: "pdf", pages: [""] })).toEqual([]);
});
