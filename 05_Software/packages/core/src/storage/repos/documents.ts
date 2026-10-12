import { type DocumentRecord, documentSchema } from "@vera/shared";
import type Database from "better-sqlite3";
import { type Chunk, chunkSchema } from "../../knowledge/chunk.js";

/** Uses the existing documents/chunks schema; downstream tables are optional. */
export class DocumentsRepository {
  constructor(private readonly db: Database.Database) {}
  list(): DocumentRecord[] {
    return this.db
      .prepare(
        "SELECT id,path,kind,sha256,bytes,mtime,pages,status,error,indexed_at AS indexedAt FROM documents ORDER BY path",
      )
      .all()
      .map((row) => documentSchema.parse(row));
  }
  get(path: string): DocumentRecord | undefined {
    const row = this.db
      .prepare(
        "SELECT id,path,kind,sha256,bytes,mtime,pages,status,error,indexed_at AS indexedAt FROM documents WHERE path=?",
      )
      .get(path);
    return row ? documentSchema.parse(row) : undefined;
  }
  save(record: Omit<DocumentRecord, "id">): DocumentRecord {
    this.db
      .prepare(`INSERT INTO documents(path,kind,sha256,bytes,mtime,pages,status,error,indexed_at)
      VALUES(@path,@kind,@sha256,@bytes,@mtime,@pages,@status,@error,@indexedAt)
      ON CONFLICT(path) DO UPDATE SET kind=excluded.kind,sha256=excluded.sha256,bytes=excluded.bytes,
      mtime=excluded.mtime,pages=excluded.pages,status=excluded.status,error=excluded.error,indexed_at=excluded.indexed_at`)
      .run(record);
    return this.get(record.path) as DocumentRecord;
  }
  /** External-content FTS deletion needs original text, before the chunks disappear. */
  replaceChunks(id: number, chunks: Chunk[]): void {
    const parsed = chunks.map((chunk) => chunkSchema.parse(chunk));
    this.db.transaction(() => {
      this.clearDerived(id);
      const insert = this.db.prepare(
        "INSERT INTO chunks(doc_id,ordinal,locator_json,text,chars) VALUES(?,?,?,?,?)",
      );
      parsed.forEach((chunk, ordinal) => {
        insert.run(id, ordinal, JSON.stringify(chunk.locator), chunk.text, chunk.text.length);
      });
    })();
  }

  /** External-content FTS deletion needs original text, before the chunks disappear. */
  clearDerived(id: number): void {
    const exists = (name: string) =>
      !!this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
    for (const table of ["chunks_fts", "chunks_tri"] as const) {
      if (exists(table))
        this.db
          .prepare(
            `INSERT INTO ${table}(${table},rowid,text) SELECT 'delete',id,text FROM chunks WHERE doc_id=?`,
          )
          .run(id);
    }
    if (exists("embeddings"))
      this.db
        .prepare("DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE doc_id=?)")
        .run(id);
    this.db.prepare("DELETE FROM chunks WHERE doc_id=?").run(id);
  }
  remove(path: string): void {
    const row = this.get(path);
    if (!row) return;
    this.clearDerived(row.id);
    this.db.prepare("DELETE FROM documents WHERE id=?").run(row.id);
  }
}
