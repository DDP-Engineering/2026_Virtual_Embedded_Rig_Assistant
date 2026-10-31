import { type DocumentRecord, documentSchema } from "@vera/shared";
import type Database from "better-sqlite3";
import { type Chunk, chunkSchema } from "../../knowledge/chunk.js";
import { type Extraction, extractionSchema } from "../../knowledge/extraction.js";

export interface DocumentDerived {
  extraction: Extraction;
  modelId?: string;
  vectors?: Float32Array[];
}

/** Chunk triggers maintain keyword indexes; embeddings are optional. */
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
  /** Chunk replacement and its trigger-maintained indexes commit together. */
  replaceChunks(id: number, chunks: Chunk[], derived?: DocumentDerived): void {
    const parsed = chunks.map((chunk) => chunkSchema.parse(chunk));
    const extraction = derived ? extractionSchema.parse(derived.extraction) : undefined;
    if (derived?.vectors) {
      if (
        !derived.modelId ||
        derived.vectors.length !== parsed.length ||
        derived.vectors.some(
          (v) =>
            v.length !== 384 ||
            !Array.from(v).every(Number.isFinite) ||
            Math.abs(Math.hypot(...v) - 1) > 0.0001,
        )
      )
        throw Error("Invalid normalized embeddings.");
    }
    this.db.transaction(() => {
      this.clearDerived(id);
      const insert = this.db.prepare(
        "INSERT INTO chunks(doc_id,ordinal,locator_json,text,chars) VALUES(?,?,?,?,?)",
      );
      parsed.forEach((chunk, ordinal) => {
        const result = insert.run(id, ordinal, JSON.stringify(chunk.locator), chunk.text, chunk.text.length);
        const vector = derived?.vectors?.[ordinal];
        if (vector)
          this.db
            .prepare("INSERT INTO embeddings(chunk_id,model_id,dim,vector) VALUES(?,?,384,?)")
            .run(
              result.lastInsertRowid,
              derived?.modelId,
              Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength),
            );
      });
      if (extraction)
        this.db
          .prepare("INSERT INTO document_extractions(doc_id,extraction_json) VALUES(?,?)")
          .run(id, JSON.stringify(extraction));
    })();
  }

  /** Delete chunks once: Keyword triggers remove their external-content entries. */
  clearDerived(id: number): void {
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE doc_id=?)")
        .run(id);
      this.db.prepare("DELETE FROM chunks WHERE doc_id=?").run(id);
      this.db.prepare("DELETE FROM document_extractions WHERE doc_id=?").run(id);
    })();
  }
  remove(path: string): void {
    const row = this.get(path);
    if (!row) return;
    this.db.transaction(() => {
      this.clearDerived(row.id);
      this.db.prepare("DELETE FROM documents WHERE id=?").run(row.id);
    })();
  }
}
