export const version = 3;
export const sql = `
CREATE TABLE embeddings(
  chunk_id INTEGER PRIMARY KEY REFERENCES chunks(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  dim INTEGER NOT NULL CHECK(dim=384),
  vector BLOB NOT NULL CHECK(length(vector)=dim*4)
);
CREATE TABLE document_extractions(
  doc_id INTEGER PRIMARY KEY REFERENCES documents(id) ON DELETE CASCADE,
  extraction_json TEXT NOT NULL
);
INSERT INTO meta(key,value) VALUES('embedding_epoch','0');
CREATE TRIGGER embedding_insert AFTER INSERT ON embeddings BEGIN
  UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='embedding_epoch';
END;
CREATE TRIGGER embedding_update AFTER UPDATE ON embeddings BEGIN
  UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='embedding_epoch';
END;
CREATE TRIGGER embedding_delete AFTER DELETE ON embeddings BEGIN
  UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='embedding_epoch';
END;
CREATE TRIGGER embedding_chunk_update AFTER UPDATE ON chunks BEGIN
  DELETE FROM embeddings WHERE chunk_id=old.id;
  UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='embedding_epoch';
END;
CREATE TRIGGER embedding_chunk_insert AFTER INSERT ON chunks BEGIN
  UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='embedding_epoch';
END;
CREATE TRIGGER embedding_chunk_delete AFTER DELETE ON chunks BEGIN
  UPDATE meta SET value=CAST(value AS INTEGER)+1 WHERE key='embedding_epoch';
END;
`;
