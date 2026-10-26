export const version = 2;
/** Immutable once applied; triggers own all external-content index writes. */
export const sql = `
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'");
CREATE VIRTUAL TABLE chunks_tri USING fts5(text, content='chunks', content_rowid='id',
  tokenize = 'trigram');
INSERT INTO chunks_fts(chunks_fts) VALUES('rebuild');
INSERT INTO chunks_tri(chunks_tri) VALUES('rebuild');
CREATE TRIGGER chunks_keyword_insert AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid,text) VALUES(new.id,new.text);
  INSERT INTO chunks_tri(rowid,text) VALUES(new.id,new.text);
END;
CREATE TRIGGER chunks_keyword_delete AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts,rowid,text) VALUES('delete',old.id,old.text);
  INSERT INTO chunks_tri(chunks_tri,rowid,text) VALUES('delete',old.id,old.text);
END;
CREATE TRIGGER chunks_keyword_update AFTER UPDATE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts,rowid,text) VALUES('delete',old.id,old.text);
  INSERT INTO chunks_tri(chunks_tri,rowid,text) VALUES('delete',old.id,old.text);
  INSERT INTO chunks_fts(rowid,text) VALUES(new.id,new.text);
  INSERT INTO chunks_tri(rowid,text) VALUES(new.id,new.text);
END;
`;
