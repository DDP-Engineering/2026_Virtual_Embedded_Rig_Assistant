# 02 — Workbench, skills and runtime data

PURPOSE: define the workbench folder format, the skills format, the `.vera/` runtime folder and the
SQLite data model that every core module shares.
DONE-WHEN (for the work packages that implement it): a workbench created by VERA validates against
`packages/shared/src/workbench.ts`, opens on another machine after being copied, and rebuilds
`.vera/` when that folder is deleted.

## 1. Folder layout

```
my-bench/
  workbench.yaml        # configuration (§2)
  WORKBENCH.md          # pinned context, always in the system prompt (§3)
  docs/                 # any files; indexed per §4
  skills/<name>/SKILL.md  # workbench skills (§5)
  tools/                # reserved for post-1.0 wrapper descriptors; ignored by 1.0
  notes/, firmware/, …  # anything else the user keeps; readable by tools, not indexed unless included
  .veraignore           # optional, gitignore syntax (§6)
  .vera/                # runtime state, never edited by hand or by tools (§8)
```

A workbench is a plain folder (ADR-0004). It can live in a Git repository; `.vera/` contains its own
`.gitignore` with `*`.

## 2. `workbench.yaml`

```yaml
format: 1                       # format version; VERA refuses a newer one (L10)
id: wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C   # ULID with prefix, written on create, stable across moves
name: MC-200 motor controller
description: Bring-up and validation of the MC-200 board
docs:
  include: ["docs/**"]          # globs, relative to the workbench root
  exclude: []
skills:
  disabled: []                  # skill names hidden from this workbench (§5)
tools:
  disabled: []                  # internal tool names not offered to the model
agent:
  permission_mode: ask          # read-only | ask | auto-edit; the default for new sessions
  model: null                   # optional "<providerId>/<modelId>"; else the app default
```

| Field | Rule |
|---|---|
| `format` | integer; `1` in VERA 1.0 |
| `id` | `wb_` + ULID; never changes |
| `name` | 1–80 characters |
| `docs.include`, `docs.exclude` | glob arrays; `exclude` wins; `.vera/**` and ignore rules always excluded |
| `skills.disabled`, `tools.disabled` | names; unknown names produce a warning, not an error |
| `agent.permission_mode` | enum above |
| `agent.model` | `null` or a reference the provider catalog resolves |

Unknown keys are preserved on save and reported as warnings, so a newer minor format does not lose data.

## 3. `WORKBENCH.md`

- Included verbatim in the system prompt inside `<workbench>` tags (`03` §3).
- Soft limit 16 KB: above it the UI warns and the prompt carries the first 16 KB with a truncation note.
- New workbenches get this template (English; the user edits it):

```markdown
# <name>

## Device under test
Board, MCU, revision, key parts.

## Bench setup
Power, probes, programmers, interfaces and where they connect.

## Conventions
How results, logs and notes are named and where they go.

## Known issues
Lab or hardware quirks the agent should check first.
```

## 4. Documents

`docs.include` minus `docs.exclude` decides which files the knowledge index sees. Supported types,
extraction and chunking are in `05-knowledge-rag.md`. Every file in the workbench stays readable
through `read`, indexed or not.

## 5. Skills

Agent Skills format, the same as Claude Code, Codex and pi:

```markdown
---
name: datasheet-reader
description: Extract electrical limits, pinouts and register maps from component datasheets. Use when the user asks about a part's ratings, pins or registers.
---
# Datasheet reader
1. Find the part's datasheet with `search_docs` …
```

| Rule | Value |
|---|---|
| Location | workbench `skills/<name>/SKILL.md`; user `<userData>/skills/<name>/SKILL.md` |
| `name` | lowercase letters, digits and hyphens, 1–64 characters, equal to the folder name |
| `description` | 1–1024 characters; says what the skill does and when to use it |
| Body | Markdown; loaded only through `load_skill` |
| Extra files | allowed beside `SKILL.md`; read through `load_skill { name, file }` |
| Resolution | workbench and user skills are both available; on a name clash the workbench skill wins |
| Disabled | names in `skills.disabled` are neither listed in the prompt nor loadable |
| Invalid | a skill failing validation is listed in the UI with its error and never reaches the prompt |

## 6. Ignore rules

Always ignored by tools and the index: `.vera/`, `.git/`, `node_modules/`. Then `.veraignore`
(gitignore syntax, workbench root only). Binary detection (`03` §5) applies on top.

## 7. Path rules

All tool paths are workbench-relative with `/` separators. Resolution and confinement are specified
in `03-agent-and-tools.md` §5; this folder format only promises that nothing outside the root is
part of a workbench.

## 8. `.vera/` runtime folder

```
.vera/
  .gitignore            # "*"
  lock                  # {"pid": 1234, "app": "1.0.0", "since": "…", "token": "…"}; live pid opens read-only
  vera.db               # SQLite (§9)
  artifacts/<session-id>/<name>
  cache/extract/<sha256>.json   # extracted document text, keyed by content hash
  backups/vera.db.v<schema>.bak # copy taken before each migration
```

Deleting `.vera/` loses sessions and artifacts; VERA recreates the folder and reindexes documents.
The UI warns before any action that does this.

The WP-06 service serializes operations and rechecks token ownership before saves/close. Each open
reassesses live/dead ownership, including same-folder reopen. Dead pid locks are taken over under a
short process-owned local IPC guard (Windows named pipe/Linux abstract Unix socket); the OS releases
it on crash. Only EADDRINUSE contention opens read-only with LOCK_GUARD_BUSY. Live owners retain
their bytes. Completion skips symlink/junction entries,
applies the case-insensitive permanent ignored directories and `.veraignore`, and returns at most50 relative paths.
Config extension values must be JSON-compatible for IPC; invalid/non-finite/circular values are
refused without changing the source. Settings schema2 stores ten typed recents, migrating0/1 with
original backups and stable UUID/extensions; recent-entry extensions survive reopening. The workbench format remains1.

## 9. Data model (`vera.db`)

```sql
meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);       -- schema_version, workbench_id, created_by
sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT, updated_at TEXT,
         model_ref TEXT, permission_mode TEXT NOT NULL,
         status TEXT NOT NULL,                          -- idle | running | awaiting_approval | error
         archived INTEGER NOT NULL DEFAULT 0);
messages(session_id TEXT, seq INTEGER, role TEXT, content_json TEXT NOT NULL, created_at TEXT,
         PRIMARY KEY (session_id, seq));                -- pi-ai message, verbatim
events(session_id TEXT, seq INTEGER, type TEXT, payload_json TEXT NOT NULL, created_at TEXT,
       PRIMARY KEY (session_id, seq));                  -- persisted SessionEvents (03 §8)
tool_calls(id TEXT PRIMARY KEY, session_id TEXT, name TEXT, args_json TEXT, result_json TEXT,
           status TEXT,                                 -- pending | ok | error | denied | aborted
           started_at TEXT, ended_at TEXT);
approvals(id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, tool_call_id TEXT,
          request_sha256 TEXT NOT NULL, request_json TEXT NOT NULL,
          decision TEXT, decided_by TEXT, decided_at TEXT, consumed_at TEXT);
          -- decision null while pending, else approved | denied | aborted; user | mode
changes(id INTEGER PRIMARY KEY, session_id TEXT, tool_call_id TEXT, path TEXT,
        before_sha256 TEXT, after_sha256 TEXT, diff TEXT,
        status TEXT NOT NULL,                           -- pending | applied | conflict (03 §6)
        created_at TEXT, UNIQUE (tool_call_id));
artifacts(id TEXT PRIMARY KEY, session_id TEXT, name TEXT, mime TEXT, bytes INTEGER,
          sha256 TEXT, description TEXT, created_at TEXT, UNIQUE (session_id, name));
todos(session_id TEXT PRIMARY KEY, items_json TEXT NOT NULL, updated_at TEXT);
documents(id INTEGER PRIMARY KEY, path TEXT UNIQUE, kind TEXT, sha256 TEXT, bytes INTEGER,
          mtime TEXT, pages INTEGER,
          status TEXT,                                  -- pending | indexed | failed | unsupported | needs_ocr
          error TEXT, indexed_at TEXT);
chunks(id INTEGER PRIMARY KEY, doc_id INTEGER, ordinal INTEGER, locator_json TEXT, text TEXT, chars INTEGER);
-- FTS5 virtual tables and the embeddings table: 05-knowledge-rag.md §5
```

- Indexes on every `session_id`, `(session_id, seq)`, `chunks(doc_id)`, `documents(status)`.
- IDs: sessions `ses_` + ULID, artifacts `art_` + ULID, approvals `apv_` + ULID; tool-call IDs come
  from the provider.
- Timestamps are ISO 8601 UTC strings.
- Migrations: ordered TypeScript modules exporting SQL embedded in core, each with a SHA-256 recorded in `meta`; a changed
  applied migration is an error; a backup precedes every migration; a database with a higher
  `schema_version` than the app knows opens nothing and shows "created by a newer VERA" (L10).
- Core uses better-sqlite3 13.0.3 with WAL, foreign_keys ON, busy_timeout5000 and synchronous NORMAL.
  Compatibility is inspected on a private db/WAL snapshot before lock or writable database activity;
  foreign-owner read-only handles retain private snapshots. An unstable concurrent capture returns BUSY.
  Each pending step backs up the committed SQLite view exclusively to the prior-version filename,
  then commits SQL, checksum and version atomically. An existing backup returns CONFLICT and is preserved.
  Initial metadata includes workbench_id and created_by. Sessions/messages/events repositories expose
  row CRUD with verbatim JSON and ascending message/event seq; session child foreign keys cascade.
  Sequences are nonnegative safe integers. Writable handles retain an auxiliary read-only connection;
  owned release checkpoints under the token guard before unlink, while disposal after ownership loss
  uses writer-first/read-only-last close to preserve runtime bytes. Failed unlink leaves storage usable.

## 10. Sessions and artifacts

- A session belongs to one workbench. Its title is the first user message cut to 60 characters, with
  no model call; the user can rename it.
- The core session service stores full runtime transcripts independently of transient M1 request budgets, projects snapshots through shared events, and validates line citations against issued tool refs and current confined files. Main drains turns before workbench close/switch and rechecks owned lock pid/token before session mutations.
- Statuses: `idle`, `running`, `awaiting_approval`, `error`. Several sessions may run at once; each
  has at most one running turn. File writes go through one queue per workbench (03 §6), the app's
  own saves included. Restart recovery closes both active statuses and resolves `pending` changes
  before another turn starts (03 §8).
- Deleting a session removes its rows and its `artifacts/<session-id>/` folder after a confirmation.
- Artifacts are text files the agent saves with `artifact_save`. 1.0 stores UTF-8 text up to 5 MB each;
  binary artifacts arrive with device tools after 1.0.

NOTES:
- Format version bumps need a migration in `workbench/migrate.ts` and a fixture of the old format.
- Work packages cite this file as `02 §n`.
