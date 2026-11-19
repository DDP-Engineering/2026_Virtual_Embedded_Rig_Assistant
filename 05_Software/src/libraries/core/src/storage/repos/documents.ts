import { type DocumentRecord, documentSchema } from "@vera/shared";
import type Database from "better-sqlite3";
import { type Chunk, chunkSchema } from "../../knowledge/chunk.js";
import { type Extraction, extractionSchema } from "../../knowledge/extraction.js";

export interface DocumentDerived {
  extraction: Extraction;
  modelId?: string;
  vectors?: Float32Array[];
}
/** Chunks and derived data that passed validateChunks. */
export interface ValidatedChunks {
  chunks: Chunk[];
  extraction: Extraction | undefined;
  modelId: string | undefined;
  vectors: Float32Array[] | undefined;
}

/** The revision of searchable source content, independent of model-only rechunking. */
export function keywordEpoch(db: Database.Database): unknown {
  return db.prepare("SELECT value FROM meta WHERE key='keyword_epoch'").pluck().get();
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
  /** Validates persisted chunk shape and derived data before the write transaction. */
  validateChunks(chunks: Chunk[], derived?: DocumentDerived): ValidatedChunks {
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
    return { chunks: parsed, extraction, modelId: derived?.modelId, vectors: derived?.vectors };
  }
  /** Chunk replacement and its trigger-maintained indexes commit together. */
  replaceChunks(id: number, chunks: Chunk[], derived?: DocumentDerived): void {
    this.writeChunks(id, this.validateChunks(chunks, derived));
  }
  /** Stores the result of validateChunks; only database work, so it may run inside a transaction. */
  writeChunks(id: number, valid: ValidatedChunks): void {
    this.db.transaction(() => {
      this.clearDerived(id);
      this.writePassages(id, valid);
      if (valid.chunks.length) this.advanceKeywordEpoch();
      if (valid.extraction)
        this.db
          .prepare("INSERT INTO document_extractions(doc_id,extraction_json) VALUES(?,?)")
          .run(id, JSON.stringify(valid.extraction));
    })();
  }

  extraction(id: number): Extraction | undefined {
    const stored = this.db
      .prepare("SELECT extraction_json FROM document_extractions WHERE doc_id=?")
      .pluck()
      .get(id) as string | undefined;
    return stored === undefined ? undefined : extractionSchema.parse(JSON.parse(stored));
  }

  /** Publish rebuilt vectors with any changed chunk boundaries in a single transaction. */
  replaceEmbeddings(id: number, valid: ValidatedChunks): void {
    this.db.transaction(() => {
      const current = this.db
        .prepare("SELECT id,text,locator_json FROM chunks WHERE doc_id=? ORDER BY ordinal")
        .all(id) as { id: number; text: string; locator_json: string }[];
      const identical =
        current.length === valid.chunks.length &&
        valid.chunks.every(
          (chunk, index) =>
            current[index]?.text === chunk.text &&
            current[index]?.locator_json === JSON.stringify(chunk.locator),
        );
      if (identical) {
        for (const [index, chunk] of current.entries()) this.writeVector(chunk.id, valid, index);
        return;
      }
      this.deletePassages(id);
      this.writePassages(id, valid);
    })();
  }

  private writePassages(id: number, valid: ValidatedChunks): void {
    if (!valid.chunks.length) return;
    const insert = this.db.prepare(
      "INSERT INTO chunks(doc_id,ordinal,locator_json,text,chars) VALUES(?,?,?,?,?)",
    );
    valid.chunks.forEach((chunk, ordinal) => {
      const { lastInsertRowid } = insert.run(
        id,
        ordinal,
        JSON.stringify(chunk.locator),
        chunk.text,
        chunk.text.length,
      );
      this.writeVector(lastInsertRowid, valid, ordinal);
    });
  }

  private writeVector(chunkId: number | bigint, valid: ValidatedChunks, ordinal: number): void {
    const vector = valid.vectors?.[ordinal];
    if (vector)
      this.db
        .prepare(`INSERT INTO embeddings(chunk_id,model_id,dim,vector) VALUES(?,?,384,?)
        ON CONFLICT(chunk_id) DO UPDATE SET model_id=excluded.model_id, vector=excluded.vector`)
        .run(chunkId, valid.modelId, Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength));
  }

  private advanceKeywordEpoch(): void {
    this.db
      .prepare(`INSERT INTO meta(key,value) VALUES('keyword_epoch','1')
      ON CONFLICT(key) DO UPDATE SET value=CAST(value AS INTEGER)+1`)
      .run();
  }

  private deletePassages(id: number): number {
    return this.db.prepare("DELETE FROM chunks WHERE doc_id=?").run(id).changes;
  }

  /** Delete chunks once: keyword triggers remove their external-content entries. */
  clearDerived(id: number): void {
    this.db.transaction(() => {
      this.db
        .prepare("DELETE FROM embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE doc_id=?)")
        .run(id);
      if (this.deletePassages(id)) this.advanceKeywordEpoch();
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
