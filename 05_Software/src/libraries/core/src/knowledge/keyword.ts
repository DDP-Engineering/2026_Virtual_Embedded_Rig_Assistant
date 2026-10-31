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

  search(query: string, acceptsPath?: (path: string) => boolean): KeywordCandidate[] {
    const terms = [...new Set(query.match(/[\p{L}\p{N}_][\p{L}\p{N}\p{M}_]*/gu) ?? [])];
    if (!terms.length) return [];
    const select = (table: "chunks_fts" | "chunks_tri", tokens: string[]): Row[] =>
      tokens.length
        ? (
            this.db
              .prepare(`SELECT c.id,c.doc_id AS docId,c.ordinal,d.path,c.locator_json AS locatorJson,
              c.text,bm25(${table}) AS bm25 FROM ${table}
              JOIN chunks c ON c.id=${table}.rowid JOIN documents d ON d.id=c.doc_id
              WHERE ${table} MATCH ? ORDER BY bm25(${table}),c.id ${acceptsPath ? "" : "LIMIT 50"}`)
              .all(tokens.map(quote).join(" OR ")) as Row[]
          )
            .filter((r) => !acceptsPath || acceptsPath(r.path))
            .slice(0, 50)
        : [];
    const words = select("chunks_fts", terms);
    const fragments = select(
      "chunks_tri",
      terms.filter((t) => Array.from(t).length >= 3 && /[\d_]/.test(t)),
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
