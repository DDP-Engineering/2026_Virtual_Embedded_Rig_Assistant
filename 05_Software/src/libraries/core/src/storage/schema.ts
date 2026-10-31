import { veraError } from "@vera/shared";
import type Database from "better-sqlite3";

// This identifies the current format, not an upgrade sequence. Existing databases are never rewritten.
export const CURRENT_SCHEMA_VERSION = 3;
export interface StorageOptions {
  workbenchId: string;
  appVersion: string;
  readOnly?: boolean;
}

/** Complete schema for a new workbench database, created in one transaction. */
export const schemaSql = `
CREATE TABLE meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT, updated_at TEXT,
  model_ref TEXT, permission_mode TEXT NOT NULL, status TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0);
CREATE TABLE messages(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK(typeof(seq) = 'integer' AND seq BETWEEN 0 AND 9007199254740991), role TEXT, content_json TEXT NOT NULL, created_at TEXT,
  PRIMARY KEY(session_id, seq));
CREATE TABLE events(session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL CHECK(typeof(seq) = 'integer' AND seq BETWEEN 0 AND 9007199254740991), type TEXT, payload_json TEXT NOT NULL, created_at TEXT,
  PRIMARY KEY(session_id, seq));
CREATE TABLE tool_calls(id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT, args_json TEXT, result_json TEXT, status TEXT, started_at TEXT, ended_at TEXT);
CREATE TABLE approvals(id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  turn_id TEXT, tool_call_id TEXT, request_sha256 TEXT NOT NULL, request_json TEXT NOT NULL,
  decision TEXT, decided_by TEXT, decided_at TEXT, consumed_at TEXT);
CREATE TABLE changes(id INTEGER PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  tool_call_id TEXT, path TEXT, before_sha256 TEXT, after_sha256 TEXT, diff TEXT,
  status TEXT NOT NULL, created_at TEXT, UNIQUE(tool_call_id));
CREATE TABLE artifacts(id TEXT PRIMARY KEY, session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT, mime TEXT, bytes INTEGER, sha256 TEXT, description TEXT, created_at TEXT, UNIQUE(session_id, name));
CREATE TABLE todos(session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  items_json TEXT NOT NULL, updated_at TEXT);
CREATE TABLE documents(id INTEGER PRIMARY KEY, path TEXT UNIQUE, kind TEXT, sha256 TEXT, bytes INTEGER,
  mtime TEXT, pages INTEGER, status TEXT, error TEXT, indexed_at TEXT);
CREATE TABLE chunks(id INTEGER PRIMARY KEY, doc_id INTEGER REFERENCES documents(id) ON DELETE CASCADE,
  ordinal INTEGER, locator_json TEXT, text TEXT, chars INTEGER);
CREATE INDEX idx_messages_session_seq ON messages(session_id, seq);
CREATE INDEX idx_events_session_seq ON events(session_id, seq);
CREATE INDEX idx_tool_calls_session ON tool_calls(session_id);
CREATE INDEX idx_approvals_session ON approvals(session_id);
CREATE INDEX idx_changes_session ON changes(session_id);
CREATE INDEX idx_artifacts_session ON artifacts(session_id);
CREATE INDEX idx_todos_session ON todos(session_id);
CREATE INDEX idx_chunks_doc ON chunks(doc_id);
CREATE INDEX idx_documents_status ON documents(status);
CREATE VIRTUAL TABLE chunks_fts USING fts5(text, content='chunks', content_rowid='id',
  tokenize = "unicode61 remove_diacritics 2 tokenchars '_'");
CREATE VIRTUAL TABLE chunks_tri USING fts5(text, content='chunks', content_rowid='id',
  tokenize = 'trigram');
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

const requiredObjects = [...schemaSql.matchAll(/CREATE (?:VIRTUAL )?(TABLE|INDEX|TRIGGER) (\w+)/g)].flatMap(
  ([, type, name]) => (type && name ? [{ type: type.toLowerCase(), name }] : []),
);
function invalid(reason: string): never {
  throw { ...veraError("INVALID"), params: { reason } };
}
/** Inspect only the current schema and identity; return false for an empty database. */
export function checkDatabase(db: Database.Database, options: StorageOptions): boolean {
  const objects = new Map(
    (
      db.prepare("SELECT name,type FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all() as {
        name: string;
        type: string;
      }[]
    ).map(({ name, type }) => [name, type]),
  );
  if (!objects.size) return false;
  if (objects.get("meta") !== "table") invalid("missing current schema metadata");
  let value: Database.Statement;
  try {
    value = db.prepare("SELECT value FROM meta WHERE key=?").pluck();
  } catch {
    invalid("invalid schema metadata");
  }
  if (value.get("schema_version") !== String(CURRENT_SCHEMA_VERSION))
    invalid("database must use the current schema");
  const epoch = value.get("embedding_epoch");
  if (typeof epoch !== "string" || !/^(0|[1-9]\d*)$/.test(epoch)) invalid("invalid embedding epoch");
  if (value.get("workbench_id") !== options.workbenchId) throw veraError("CONFLICT");
  if (requiredObjects.some(({ name, type }) => objects.get(name) !== type))
    invalid("incomplete current schema");
  return true;
}
/** Initialize an empty database only. No upgrades, backups or existing-data changes. */
export function initializeDatabase(db: Database.Database, options: StorageOptions): void {
  db.transaction(() => {
    if (checkDatabase(db, options)) return;
    db.exec(schemaSql);
    const put = db.prepare("INSERT INTO meta(key,value) VALUES (?,?)");
    put.run("schema_version", String(CURRENT_SCHEMA_VERSION));
    put.run("workbench_id", options.workbenchId);
    put.run("created_by", options.appVersion);
  }).immediate();
}
