import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, it } from "vitest";

const root = fileURLToPath(new URL("../../", import.meta.url));
const script = `${root}scripts/retrieval/evaluation.mjs`;
async function evaluation() {
  expect(existsSync(script), "local comparison evaluator is implemented").toBe(true);
  return import(pathToFileURL(script).href);
}
const chunk = (id: number, path: string, page: number) => ({
  id,
  path,
  text: "I2C1_CR1 defines peripheral enable PE",
  locator: { type: "page", page },
});
it("REQ-TEST-91b404ff counts exact locators in top5 and separates RO/EN denominators", async () => {
  const { summarize } = await evaluation();
  const chunks = [chunk(1, "docs/manual.pdf", 1), chunk(2, "docs/manual.pdf", 2), chunk(3, "other.pdf", 1)];
  const questions = [
    { id: "en", language: "en", query: "enable", expected: { path: "docs/manual.pdf", page: 1 } },
    { id: "ro", language: "ro", query: "activare", expected: { path: "docs/manual.pdf", page: 2 } },
  ];
  const output = summarize(questions, chunks, [
    [2, 3],
    [1, 3, 3, 3, 3, 2],
  ]);
  expect(output.overall).toEqual({ hits: 0, total: 2, recallAt5: 0 });
  expect(output.ro).toEqual({ hits: 0, total: 1, recallAt5: 0 });
  expect(summarize(questions, chunks, [[1], [2]]).overall).toEqual({ hits: 2, total: 2, recallAt5: 1 });
  const notes = { id: 4, path: "notes.md", text: "measured", locator: { type: "heading", slug: "power" } };
  const q = [
    { id: "heading", language: "en", query: "measured", expected: { path: "notes.md", heading: "power" } },
  ];
  expect(summarize(q, [notes], [[4]]).overall.hits).toBe(1);
  expect(
    summarize([{ ...q[0], expected: { path: "notes.md", heading: "other" } }], [notes], [[4]]).overall.hits,
  ).toBe(0);
});
it("REQ-TEST-91b404ff validates fixed questions and actual page/heading coverage", async () => {
  const { validateFixture } = await evaluation();
  const yaml = await readFile(`${root}tests/fixtures/retrieval/demo-board.yaml`, "utf8");
  const fixture = validateFixture(yaml);
  expect(fixture.questions.length).toBeGreaterThanOrEqual(20);
  expect(fixture.questions.length).toBeLessThanOrEqual(30);
  expect(fixture.questions.filter((q: { language: string }) => q.language === "ro").length).toBeGreaterThan(
    0,
  );
  expect(() => validateFixture(yaml.replace("language: ro", "language: xx"))).toThrow();
  expect(() => validateFixture(yaml, [])).toThrow(/locator/i);
  expect(() => validateFixture(yaml.replace("supply-en", "debug-en"))).toThrow(/duplicate/i);
  expect(() => validateFixture(yaml.replace("docs/vera-demo-01-datasheet.pdf", "../escape.pdf"))).toThrow(
    /relative/i,
  );
});
it("REQ-TEST-91b404ff ranks real FTS identifiers and fuses one-based lists stably", async () => {
  const { keywordIndex, fuse, semanticRank } = await evaluation();
  const chunks = [
    chunk(1, "a.pdf", 1),
    { ...chunk(2, "b.pdf", 1), text: "unrelated clock and supply" },
    { ...chunk(3, "c.pdf", 1), text: "Read I2C1_CR1 before changes" },
  ];
  const index = keywordIndex(chunks);
  try {
    expect(index.search("I2C1_CR1")).toEqual([3, 1]);
    expect(index.search("C1_CR")).toContain(1);
    expect(index.search('"; () OR *')).toEqual([]);
    expect(index.search("completelyabsent")).toEqual([]);
    expect(
      fuse([
        [2, 1],
        [1, 3],
      ])[0],
    ).toBe(1);
    expect(fuse([[2], [1]])).toEqual([1, 2]);
    expect(
      semanticRank(
        [1, 0],
        [
          [0, 1],
          [1, 0],
          [-1, 0],
        ],
        [1, 2, 3],
      ),
    ).toEqual([2, 1, 3]);
  } finally {
    index.close();
  }
});
