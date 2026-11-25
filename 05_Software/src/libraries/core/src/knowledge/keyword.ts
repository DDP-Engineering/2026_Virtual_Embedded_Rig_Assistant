import type Database from "better-sqlite3";
import { type Chunk, locatorSchema } from "./chunk.js";

/** Persisted lexical candidate for downstream search fusion. Rank starts at one. */
export interface KeywordCandidate {
  id: number;
  docId: number;
  ordinal: number;
  path: string;
  locator: Chunk["locator"];
  text: string;
  bm25: number;
  rank: number;
}
interface Row extends Omit<KeywordCandidate, "locator" | "rank"> {
  locatorJson: string;
}
const quote = (term: string) => `"${term.replaceAll('"', '""')}"`;

/** Read-only word/identifier search over the workbench's trigger-maintained indexes. */
export class KeywordSearch {
  constructor(private readonly db: Database.Database) {}

  /** `limit` candidates per index; at least the 50 a ranking needs, more for a larger Docs panel list. */
  search(query: string, acceptsPath?: (path: string) => boolean, limit = 50): KeywordCandidate[] {
    const rowsPerTable = Number.isSafeInteger(limit) && limit > 50 ? limit : 50;
    const terms = [...new Set(query.match(/[\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*/gu) ?? [])];
    if (!terms.length) return [];
    // A path filter is resolved to document ids first, so the match query keeps its LIMIT and
    // never loads the text of chunks that are filtered out.
    const docs =
      acceptsPath &&
      JSON.stringify(
        (this.db.prepare("SELECT id,path FROM documents").all() as { id: number; path: string }[])
          .filter((doc) => acceptsPath(doc.path))
          .map((doc) => doc.id),
      );
    const select = (table: "chunks_fts" | "chunks_tri", tokens: string[]): Row[] =>
      tokens.length
        ? (this.db
            .prepare(`SELECT c.id,c.doc_id AS docId,c.ordinal,d.path,c.locator_json AS locatorJson,
              c.text,bm25(${table}) AS bm25 FROM ${table}
              JOIN chunks c ON c.id=${table}.rowid JOIN documents d ON d.id=c.doc_id
              WHERE ${table} MATCH ? ${docs ? "AND c.doc_id IN (SELECT value FROM json_each(?))" : ""}
              ORDER BY bm25(${table}),c.id LIMIT ${rowsPerTable}`)
            .all(tokens.map(quote).join(" OR "), ...(docs ? [docs] : [])) as Row[])
        : [];
    const words = select("chunks_fts", terms);
    const fragments = select(
      "chunks_tri",
      // Identifiers, and all-capital words: MODER or BRR must find GPIOx_MODER and USART_BRR, which
      // the word index stores as one token.
      terms.filter((t) => Array.from(t).length >= 3 && (/[\d_]/.test(t) || /^\p{Lu}+$/u.test(t))),
    );
    let ranked = words;
    if (fragments.length) {
      const fused = new Map<number, { row: Row; score: number }>();
      for (const list of [words, fragments]) {
        list.forEach((row, index) => {
          const previous = fused.get(row.id);
          fused.set(row.id, {
            row: previous ? { ...previous.row, bm25: Math.min(previous.row.bm25, row.bm25) } : row,
            score: (previous?.score ?? 0) + 1 / (60 + index + 1),
          });
        });
      }
      ranked = [...fused.values()]
        .sort((a, b) => b.score - a.score || a.row.id - b.row.id)
        .slice(0, 50)
        .map((entry) => entry.row);
    }
    return ranked.map(({ locatorJson, ...row }, index) => ({
      ...row,
      locator: locatorSchema.parse(JSON.parse(locatorJson)),
      rank: index + 1,
    }));
  }
}
