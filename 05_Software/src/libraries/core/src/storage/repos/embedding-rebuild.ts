import type Database from "better-sqlite3";

/** Search stays lexical until the current workbench's vector coverage is restored. */
export function rebuildingEmbeddings(db: Database.Database): boolean {
  return db.prepare("SELECT 1 FROM meta WHERE key='embedding_rebuild'").get() !== undefined;
}

export function beginEmbeddingRebuild(db: Database.Database): void {
  db.prepare("DELETE FROM embeddings").run();
  db.prepare("INSERT OR REPLACE INTO meta(key,value) VALUES('embedding_rebuild','1')").run();
}

export function finishEmbeddingRebuild(db: Database.Database): void {
  db.prepare(`DELETE FROM meta WHERE key='embedding_rebuild'
    AND NOT EXISTS (SELECT 1 FROM chunks c
      WHERE NOT EXISTS (SELECT 1 FROM embeddings e WHERE e.chunk_id=c.id))`).run();
}
