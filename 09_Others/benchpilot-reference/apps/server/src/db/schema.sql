-- BenchPilot runtime DB (01 "Data model"). Migrations-free: `npm run seed` drops and recreates everything.
-- Additions to 01 are marked "P2:" (docs/progress/P2.md).

-- P2: sequential ids (RPT-0001, RUN-0001, PLAN-0001, …). Reset by seed so ids are deterministic (04 replay).
CREATE TABLE IF NOT EXISTS counters (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
-- P2: live-pool cursor per firmware/test (02 "Live pools": last entry repeats when exhausted).
CREATE TABLE IF NOT EXISTS pool_cursors (fw TEXT NOT NULL, test_id TEXT NOT NULL, pos INTEGER NOT NULL,
  PRIMARY KEY (fw, test_id));

CREATE TABLE IF NOT EXISTS testbenches (id TEXT PRIMARY KEY, name TEXT NOT NULL, config_json TEXT NOT NULL,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS docs (id INTEGER PRIMARY KEY, testbench_id TEXT NOT NULL, path TEXT NOT NULL,
  title TEXT NOT NULL, content TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0,
  UNIQUE (testbench_id, path));
CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(title, content, content='docs', content_rowid='id');

CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, testbench_id TEXT NOT NULL, title TEXT NOT NULL,
  provider TEXT, model TEXT, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, seq INTEGER NOT NULL,
  role TEXT NOT NULL, content_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tool_calls (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, message_id INTEGER,
  name TEXT NOT NULL, args_json TEXT NOT NULL, result_json TEXT, status TEXT NOT NULL, started_at TEXT NOT NULL,
  ended_at TEXT);

-- status: pending | approved | rejected | running | done.
-- P2: session_id nullable (CLI plans), + title, device, fw, comment, created_at (domain Plan, 01 SSE amendments).
CREATE TABLE IF NOT EXISTS plans (id TEXT PRIMARY KEY, session_id TEXT, testbench_id TEXT NOT NULL,
  title TEXT NOT NULL, device TEXT NOT NULL, fw TEXT NOT NULL, items_json TEXT NOT NULL, rationale TEXT NOT NULL,
  status TEXT NOT NULL, comment TEXT, created_at TEXT NOT NULL, decided_at TEXT);

-- kind: live | history. created_at: wall clock for live, the night's data-clock start for history.
CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, plan_id TEXT, testbench_id TEXT NOT NULL,
  device TEXT NOT NULL, fw TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, summary_json TEXT NOT NULL,
  analysis_md TEXT, findings_json TEXT);

-- verdict: pass | fail | error; NULL while the run is in progress. started_at/ended_at = data clock (epoch s).
-- P2: + test_name. measured_json = {check_id: number | null}.
CREATE TABLE IF NOT EXISTS test_runs (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, dataset_id TEXT NOT NULL,
  test_id TEXT NOT NULL, test_name TEXT NOT NULL, test_version INTEGER NOT NULL, device TEXT NOT NULL,
  fw TEXT NOT NULL, testbench_id TEXT NOT NULL, verdict TEXT, checks_json TEXT NOT NULL DEFAULT '[]',
  measured_json TEXT NOT NULL DEFAULT '{}', started_at REAL NOT NULL, ended_at REAL NOT NULL,
  artifacts_json TEXT NOT NULL DEFAULT '[]');

-- P2: + raw (the line exactly as in the file; catalog regexes match it).
CREATE TABLE IF NOT EXISTS log_lines (id INTEGER PRIMARY KEY, test_run_id TEXT NOT NULL, source TEXT NOT NULL,
  line_no INTEGER NOT NULL, ts REAL NOT NULL, host TEXT, process TEXT, pid INTEGER, severity TEXT,
  message TEXT NOT NULL, raw TEXT NOT NULL);
-- P2: indexes raw (not message), so process names and severities are searchable ("dnsmasq", "warn").
CREATE VIRTUAL TABLE IF NOT EXISTS log_fts USING fts5(raw, content='log_lines', content_rowid='id');

CREATE TABLE IF NOT EXISTS packets (test_run_id TEXT NOT NULL, capture TEXT NOT NULL, frame_no INTEGER NOT NULL,
  ts REAL NOT NULL, src TEXT, dst TEXT, proto TEXT, length INTEGER, info TEXT,
  PRIMARY KEY (test_run_id, capture, frame_no)) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS metrics (test_run_id TEXT NOT NULL, name TEXT NOT NULL, ts REAL NOT NULL,
  value REAL NOT NULL, unit TEXT NOT NULL);

-- P2: + capture, first_frame (pcap evidence ref for compare_traffic_profiles rows).
CREATE TABLE IF NOT EXISTS endpoints (test_run_id TEXT NOT NULL, fw TEXT NOT NULL, host TEXT, ip TEXT NOT NULL,
  port INTEGER, transport TEXT NOT NULL, app_proto TEXT NOT NULL, encrypted INTEGER NOT NULL,
  packets INTEGER NOT NULL, bytes INTEGER NOT NULL, capture TEXT NOT NULL, first_frame INTEGER NOT NULL);

-- P3: every SSE event of a session, in order, plus internal `user.message` records. GET /sessions/:id folds them
-- with the shared reducer, so the snapshot and the stream cannot diverge. seq is the SSE id (Last-Event-ID resume).
CREATE TABLE IF NOT EXISTS session_events (session_id TEXT NOT NULL, seq INTEGER NOT NULL, event_json TEXT NOT NULL,
  created_at TEXT NOT NULL, PRIMARY KEY (session_id, seq)) WITHOUT ROWID;

-- P3: draft_ticket results (04 §3: stored, never sent anywhere). Report-scoped, so any session can read them.
CREATE TABLE IF NOT EXISTS ticket_drafts (id TEXT PRIMARY KEY, report_id TEXT NOT NULL, session_id TEXT,
  cluster_title TEXT NOT NULL, title TEXT NOT NULL, body_md TEXT NOT NULL, component TEXT NOT NULL,
  severity TEXT NOT NULL, created_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS idx_docs_tb ON docs (testbench_id);
CREATE INDEX IF NOT EXISTS idx_tickets_report ON ticket_drafts (report_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages (session_id, seq);
CREATE INDEX IF NOT EXISTS idx_tool_calls_session ON tool_calls (session_id);
CREATE INDEX IF NOT EXISTS idx_plans_session ON plans (session_id);
CREATE INDEX IF NOT EXISTS idx_reports_fw ON reports (fw);
CREATE INDEX IF NOT EXISTS idx_test_runs_report ON test_runs (report_id);
CREATE INDEX IF NOT EXISTS idx_test_runs_test_fw ON test_runs (test_id, fw);
CREATE INDEX IF NOT EXISTS idx_log_lines_run ON log_lines (test_run_id, source, line_no);
CREATE INDEX IF NOT EXISTS idx_log_lines_run_ts ON log_lines (test_run_id, ts);
CREATE INDEX IF NOT EXISTS idx_packets_run_ts ON packets (test_run_id, ts);
CREATE INDEX IF NOT EXISTS idx_metrics_run ON metrics (test_run_id, name, ts);
CREATE INDEX IF NOT EXISTS idx_metrics_run_ts ON metrics (test_run_id, ts);
CREATE INDEX IF NOT EXISTS idx_endpoints_run ON endpoints (test_run_id);
CREATE INDEX IF NOT EXISTS idx_endpoints_fw ON endpoints (fw);
