
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
INSERT INTO meta VALUES ('migration_0001_sha256','e17c68f193ee452f1efb2e8a75e333c53f8ac8df47ebc52860f78bfa9c8f3900');
INSERT INTO meta VALUES ('schema_version','1'),('workbench_id','wb_fixture'),('created_by','0.30.0');
