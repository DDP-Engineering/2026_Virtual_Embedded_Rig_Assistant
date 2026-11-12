import Database from "better-sqlite3";
import { parse } from "yaml";
import { z } from "zod";

const expected = z.union([
  z.object({ path: z.string(), page: z.number().int().positive() }).strict(),
  z.object({ path: z.string(), heading: z.string().min(1) }).strict(),
]);
const fixtureSchema = z
  .object({
    schema: z.literal(1),
    questions: z
      .array(
        z
          .object({
            id: z.string().min(1),
            language: z.enum(["en", "ro"]),
            query: z.string().min(1),
            expected,
          })
          .strict(),
      )
      .min(20)
      .max(30),
  })
  .strict();

export function matches(chunk, target) {
  return (
    chunk.path === target.path &&
    (target.page !== undefined
      ? chunk.locator.type === "page" && chunk.locator.page === target.page
      : chunk.locator.type === "heading" && chunk.locator.slug === target.heading)
  );
}
export function validateFixture(yaml, chunks) {
  const fixture = fixtureSchema.parse(parse(yaml));
  const ids = new Set();
  for (const question of fixture.questions) {
    if (ids.has(question.id)) throw Error("Duplicate question id");
    ids.add(question.id);
    const path = question.expected.path;
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      path.split("/").some((p) => !p || p === "." || p === "..") ||
      path.includes(":")
    )
      throw Error("Invalid expected relative path");
    if (chunks && !chunks.some((c) => matches(c, question.expected)))
      throw Error(`Expected locator absent: ${question.id}`);
  }
  if (
    !fixture.questions.some((q) => q.language === "ro") ||
    !fixture.questions.some((q) => q.language === "en")
  )
    throw Error("Both en and ro questions required");
  return fixture;
}

/** Reciprocal rank fusion uses one-based ranks and stable numeric chunk ids. */
export function fuse(lists, limit = 50) {
  const scores = new Map();
  for (const list of lists) {
    const seen = new Set();
    list.forEach((id, index) => {
      if (seen.has(id)) return;
      seen.add(id);
      scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + index + 1));
    });
  }
  return [...scores]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, limit)
    .map(([id]) => id);
}
/** Isolated spike baseline only; creates no workbench migration or persisted index. */
export function keywordIndex(chunks) {
  const db = new Database(":memory:");
  db.exec(`CREATE VIRTUAL TABLE words USING fts5(text, tokenize = "unicode61 remove_diacritics 2 tokenchars '_'");
    CREATE VIRTUAL TABLE fragments USING fts5(text, tokenize = 'trigram');`);
  const insertWords = db.prepare("INSERT INTO words(rowid,text) VALUES (?,?)");
  const insertFragments = db.prepare("INSERT INTO fragments(rowid,text) VALUES (?,?)");
  db.transaction(() => {
    for (const c of chunks) {
      insertWords.run(c.id, c.text);
      insertFragments.run(c.id, c.text);
    }
  })();
  const words = db.prepare(
    "SELECT rowid FROM words WHERE words MATCH ? ORDER BY bm25(words), rowid LIMIT 50",
  );
  const fragments = db.prepare(
    "SELECT rowid FROM fragments WHERE fragments MATCH ? ORDER BY bm25(fragments), rowid LIMIT 50",
  );
  return {
    search(query) {
      const terms = [...new Set(query.match(/[\p{L}\p{N}_]+/gu) ?? [])];
      const quote = (term) => `"${term}"`;
      const wordRows = terms.length ? words.all(terms.map(quote).join(" OR ")).map((r) => r.rowid) : [];
      const identifierTerms = terms.filter((t) => t.length >= 3 && /[\d_]/.test(t));
      const fragmentRows = identifierTerms.length
        ? fragments.all(identifierTerms.map(quote).join(" OR ")).map((r) => r.rowid)
        : [];
      return fragmentRows.length ? fuse([wordRows, fragmentRows]) : wordRows;
    },
    close() {
      db.close();
    },
  };
}
export function semanticRank(query, vectors, ids) {
  if (vectors.length !== ids.length || vectors.some((v) => v.length !== query.length))
    throw Error("Incompatible vectors");
  return vectors
    .map((v, i) => ({ id: ids[i], score: v.reduce((n, x, j) => n + x * query[j], 0) }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, 50)
    .map((v) => v.id);
}
export function summarize(questions, chunks, rankings) {
  if (rankings.length !== questions.length) throw Error("Missing rankings");
  const byId = new Map(chunks.map((c) => [c.id, c]));
  const rows = questions.map((q, i) => ({
    id: q.id,
    language: q.language,
    expected: q.expected,
    hit: rankings[i].slice(0, 5).some((id) => byId.has(id) && matches(byId.get(id), q.expected)),
    top5: rankings[i].slice(0, 5).map((id) => {
      const c = byId.get(id);
      if (!c) throw Error("Unknown ranked chunk");
      return { id, path: c.path, locator: c.locator };
    }),
  }));
  const count = (subset) => ({
    hits: subset.filter((r) => r.hit).length,
    total: subset.length,
    recallAt5: subset.length ? subset.filter((r) => r.hit).length / subset.length : null,
  });
  return {
    overall: count(rows),
    en: count(rows.filter((r) => r.language === "en")),
    ro: count(rows.filter((r) => r.language === "ro")),
    questions: rows,
  };
}
