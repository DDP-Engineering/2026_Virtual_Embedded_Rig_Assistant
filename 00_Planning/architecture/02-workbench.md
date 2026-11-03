# 02 — Workbench, skills and runtime data

Describes the implementation as of 2026-11-01 (`05_Software`, branch master). Anything not in the
code is marked "Not implemented as of 2026-11-01" or "future".

PURPOSE: define the workbench folder format, the skills format, the `.vera/` project metadata and runtime folder and the
SQLite data model that every core module shares.
DONE-WHEN (for the work packages that implement it): a workbench created by VERA validates against
`src/libraries/shared/src/workbench.ts`, opens on another machine after being copied, and rebuilds
the index from project documents while preserving its configuration.

## 1. Folder layout

```
my-bench/
  .vera/
    workbench.yaml        # project configuration (§2)
    WORKBENCH.md          # pinned context (§3)
    .veraignore           # optional, project-relative gitignore patterns (§6)
    skills/<name>/SKILL.md # project skills (§5)
    .gitignore            # tracks configuration/skills, ignores runtime state
    lock, vera.db, artifacts/, downloads/, cache/   # runtime state (§8)
  docs/                   # default docs.include target (§4); not created by VERA
  notes/, firmware/, …    # project content
```

The selected project folder remains the root for document patterns and tool paths.
Opening requires `.vera/workbench.yaml`; root files are never detected or migrated. `.vera/`,
`.vera/skills/` and the files above must be ordinary entries; a symlink or junction there refuses
create and open (DENIED).
Create refuses a folder that already has `.vera/workbench.yaml` (CONFLICT), then writes
`.vera/.gitignore` (only if missing), `workbench.yaml`, `skills/` and `WORKBENCH.md` (an existing one
is kept). A UNC/network path opens with the warning `NETWORK_SHARE_UNSUPPORTED`.
Global application settings (`settings.json`), credentials (`credentials.json`) and user skills
(`skills/`) remain in userData.

## 2. `.vera/workbench.yaml`

```yaml
format: 1                       # format version; always 1 during development, any other value is invalid
id: wb_01JB8Z6Q4M7N2K5R9T3V8X1Y0C   # ULID with prefix, written on create, stable across moves
name: MC-200 motor controller
description: Bring-up and validation of the MC-200 board   # optional
embeddings:
  model: Xenova/bge-small-en-v1.5   # the only accepted value
  chunkSize: 1400               # characters, 200–1400
  overlap: 200                  # characters, 0–600, smaller than chunkSize
docs:
  include: ["docs/**"]          # globs, relative to the workbench root
  exclude: []
retrieval:
  results: 8                    # 1–20; search_docs default k
  mode: hybrid                  # hybrid | keyword | semantic; search_docs default mode
skills:
  disabled: []                  # skill names hidden from this workbench (§5)
tools:
  disabled: []                  # built-in tool names not offered to the model
agent:
  permission_mode: ask          # read-only | ask | auto-edit | bypass; the default for new sessions
  model: null                   # optional "<providerId>/<modelId>"; else the app default
```

Every block except `format`, `id` and `name` is optional and takes the defaults shown.

| Field | Rule |
|---|---|
| `format` | integer literal `1`; any other value gives `CONFIG_INVALID` with path `format` (no "too new" error code, no migration; L10 is deferred) |
| `id` | `wb_` + ULID (26 Crockford characters, first `0`–`7`); generated on create, never changes |
| `name` | 1–80 characters after trimming |
| `description` | optional string |
| `embeddings` | strict object: unknown keys are an error, not a warning; chunking is in `05-knowledge-rag.md` |
| `docs.include`, `docs.exclude` | glob arrays; selection rules in §4 |
| `retrieval` | used when `search_docs` passes no `k` or `mode` |
| `skills.disabled`, `tools.disabled` | non-empty names; unknown names produce an `UNKNOWN_NAME` warning, not an error; tools are the 17 built-ins of `shared/src/tools.ts` |
| `agent.permission_mode` | enum above; default `ask` |
| `agent.model` | `null` or `"<providerId>/<modelId>"` (syntax only); a session's own model wins, then this, then the app default |

Parsing (`parseConfig`, `core/src/workbench/service.ts`): YAML with unique keys; values must be
JSON-compatible. A YAML error reports `YAML_INVALID` with line and column, a schema error
`CONFIG_INVALID` with path and line. Unknown keys at the top level and inside `docs`, `retrieval`,
`skills`, `tools` and `agent` are preserved on save and reported as `UNKNOWN_KEY` warnings, so they
are not lost. Saves merge a strict patch, write the file atomically through the
workbench write queue and do not keep YAML comments or formatting. Web tools are also withheld from
the model when the global web-access settings do not allow them, independently of `tools.disabled`.

## 3. `.vera/WORKBENCH.md`

- Included verbatim in the system prompt inside `<workbench>` tags (`03` §3).
- Soft limit 16 KiB (16384 UTF-8 bytes): above it the editor warns and the prompt carries the first
  16 KiB followed by `[.vera/WORKBENCH.md truncated at 16 KiB (UTF-8).]`; the full text stays saved.
- New workbenches get this template (English; the user edits it), unless the New Workbench page
  supplies the text; an existing `.vera/WORKBENCH.md` is kept unchanged:

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

`docs.include` minus `docs.exclude` decides which files the knowledge index sees
(`core/src/knowledge/selection.ts`, `kinds.ts`):

- A pattern that does not end in `*` selects everything below it (`/**` is appended); an include
  entry starting with `!` acts as an exclude; `exclude` wins.
- The permanent ignored folders and `.vera/.veraignore` (§6) always apply; symlinked files and folders
  are never followed; only supported document kinds are selected (PDF, Markdown, HTML,
  docx/pptx/xlsx and their OpenDocument forms, `.txt`, `.csv`, `.tsv`); code, logs and other data files are not indexed.
- The indexer watches the selected folders, `.vera/workbench.yaml` and `.vera/.veraignore` and
  re-selects on change.
- The New Workbench page scans a chosen folder for documentation folders (first-level names, bytes
  and counts per kind, never file names; at most 20 000 entries, depth 8) and previews a selection;
  picked folders become `<folder>/**` patterns.

Supported types, extraction and chunking are in `05-knowledge-rag.md`. Every non-ignored text file
stays readable through `read`, indexed or not; `read` refuses PDFs, which go through `read_doc`.

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
| Location | workbench `.vera/skills/<name>/SKILL.md`; user `<userData>/skills/<name>/SKILL.md` |
| `name` | lowercase letters, digits and hyphens, 1–64 characters, equal to the folder name |
| `description` | non-blank, at most 1024 characters (trimmed); says what the skill does and when to use it |
| Frontmatter | YAML between `---` lines at the file start; duplicate keys and aliases are invalid |
| Files | UTF-8 text, not binary, at most 256 KiB each; no symlinks, junctions or hard links in the skills tree |
| Body | Markdown; loaded only through `load_skill` |
| Extra files | allowed beside `SKILL.md`; read through `load_skill { name, file }` (relative path, at most 1024 characters) |
| Resolution | workbench and user skills are both available; on a name clash the workbench skill wins, even when its folder is invalid |
| Disabled | names in `skills.disabled` are neither listed in the prompt nor loadable; the UI lists them as disabled |
| Invalid | a skill failing validation is listed in the UI with its error (`frontmatter`, `name`, `description` or `unavailable`) and never reaches the prompt |
| Limits | per root at most 1024 skill folders and 4096 scanned entries |
| Ignore | workbench skill paths also obey `.vera/.veraignore`, matched as `skills/<name>/<file>` (§6) |

The prompt lists enabled valid skills as `name: description` inside `<skills>` (`03` §3). The
workbench editor toggles `skills.disabled`, creates a skill from a template and edits `SKILL.md`;
core saves into either root atomically and returns CONFLICT when the file changed since it was read
(SHA-256 check).

## 6. Ignore rules

Always ignored by tools and the index: any path segment named `.vera`, `.git` or `node_modules`,
compared case-insensitively, at any depth; `!` negations cannot re-include them. Then
`.vera/.veraignore` (gitignore syntax, patterns relative to the project root; logical skills/ paths
for the dedicated skill loader). A `.veraignore` or `.vera/` that is a symlink, junction or unreadable
hides everything from the index and folder scans and fails tool path resolution. Binary detection
(`03` §5) applies on top. In `bypass` mode ordinary file tools use a filesystem scope that applies no
ignore rules (`03` §5).

## 7. Path rules

All tool paths are workbench-relative with `/` separators (`\` is accepted and converted). Absolute
paths, `:`, NUL, Windows device names and segments ending in a dot or space are refused, and the
canonical (realpath) target must stay inside the root (`core/src/workbench/path-guard.ts`). Resolution
and confinement are specified in `03-agent-and-tools.md` §5; this folder format only promises that
nothing outside the root is part of a workbench. Exception: in `bypass` mode ordinary file tools
accept absolute paths anywhere.

## 8. `.vera/` project metadata and runtime folder

```
.vera/
  .gitignore            # "*" then allows .gitignore, workbench.yaml, WORKBENCH.md, .veraignore, skills/
  lock                  # {"pid": 1234, "app": "1.0.0", "since": "…", "token": "…"}; live pid opens read-only
  vera.db, vera.db-wal, vera.db-shm   # SQLite (§9)
  artifacts/<session-id>/<name>       # session artifacts (§10)
  downloads/<uuid>/<name>             # web_download file (≤100 MiB) plus .vera-download.json manifest
  cache/extract/<sha256>.json         # extracted document text, keyed by content hash (≤128 MiB)
```

There is no `.vera/backups/` folder: the database has no migrations and no upgrade backups (§9).

The `.vera` folder contains project configuration as well as sessions and artifacts. Keep it with
the project. The dedicated skill catalog can read `.vera/skills`; general tools and indexing
exclude metadata. The default `.gitignore` allows the configuration files and skills while ignoring
runtime databases, locks, caches, downloads and artifacts.

`WorkbenchService` (`core/src/workbench/service.ts`) serializes lifecycle operations and rechecks
lock pid and token before every save, session mutation and close. Each open reassesses live/dead
ownership, including same-folder reopen:

- A lock whose pid is alive and is not this process's own lock opens the workbench read-only:
  SQLite is read from a private temporary copy, nothing is written and no indexing runs.
- A dead-pid lock is taken over under a short process-owned local IPC guard (Windows named pipe /
  Linux abstract Unix socket, named from the folder hash); the OS releases it on crash. Only
  EADDRINUSE contention opens read-only with `LOCK_GUARD_BUSY`.
- A malformed lock refuses the open (CONFLICT). Live owners retain their bytes.
- Close and switch drain the write queue, stop indexing, checkpoint the WAL and delete the lock only
  while it still carries this process's pid and token.

File completion (`workbench.files`) skips symlink/junction entries, applies the permanent ignored
directories and `.vera/.veraignore`, matches the query case-insensitively and returns at most 50
relative paths. Config extension values must be JSON-compatible for IPC; invalid/non-finite/circular
values are refused without changing the source.

Recent workbenches live in the userData `settings.json` (settings `schemaVersion` 1; strict schema,
07 §6). An entry has `folder`, `id`, `name`,
`lastOpened` and optional `pinned`; the list is unbounded, a new entry goes first, a known one keeps
its user-arranged place, unknown entry fields survive reopening and missing folders are flagged. The
workbench format remains 1.

## 9. Data model (`vera.db`)

Source: `core/src/storage/schema.ts` (the full schema, created in one transaction).

```sql
meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
     -- schema_version ('1'), workbench_id, created_by (app version), embedding_epoch (counter)
sessions(id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT, updated_at TEXT,
         model_ref TEXT, permission_mode TEXT NOT NULL,  -- read-only | ask | auto-edit | bypass
         status TEXT NOT NULL,                          -- idle | running | awaiting_approval | error
         archived INTEGER NOT NULL DEFAULT 0);
messages(session_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT, content_json TEXT NOT NULL,
         created_at TEXT, PRIMARY KEY (session_id, seq));  -- pi-ai message, verbatim
events(session_id TEXT NOT NULL, seq INTEGER NOT NULL, type TEXT, payload_json TEXT NOT NULL,
       created_at TEXT, PRIMARY KEY (session_id, seq));    -- persisted SessionEvents (03 §8)
tool_calls(id TEXT PRIMARY KEY, session_id TEXT, name TEXT, args_json TEXT, result_json TEXT,
           status TEXT,                                 -- pending | ok | error | denied | aborted
           started_at TEXT, ended_at TEXT);
approvals(id TEXT PRIMARY KEY, session_id TEXT, turn_id TEXT, tool_call_id TEXT,
          request_sha256 TEXT NOT NULL, request_json TEXT NOT NULL,
          decision TEXT, decided_by TEXT, decided_at TEXT, consumed_at TEXT);
          -- decision null while pending, else approved | denied | aborted; decided_by user | mode
changes(id INTEGER PRIMARY KEY, session_id TEXT, tool_call_id TEXT, path TEXT,
        before_sha256 TEXT, after_sha256 TEXT, diff TEXT,
        status TEXT NOT NULL,                           -- pending | applied | conflict (03 §6)
        created_at TEXT, UNIQUE (tool_call_id));        -- path is absolute for bypass writes
artifacts(id TEXT PRIMARY KEY, session_id TEXT, name TEXT, mime TEXT, bytes INTEGER,
          sha256 TEXT, description TEXT, created_at TEXT, UNIQUE (session_id, name));
todos(session_id TEXT PRIMARY KEY, items_json TEXT NOT NULL, updated_at TEXT);
documents(id INTEGER PRIMARY KEY, path TEXT UNIQUE, kind TEXT, sha256 TEXT, bytes INTEGER,
          mtime TEXT, pages INTEGER,
          status TEXT,                                  -- pending | indexed | failed | unsupported | needs_ocr
          error TEXT, indexed_at TEXT);
chunks(id INTEGER PRIMARY KEY, doc_id INTEGER, ordinal INTEGER, locator_json TEXT, text TEXT, chars INTEGER);
chunks_fts USING fts5(text, content='chunks', content_rowid='id',
                      tokenize="unicode61 remove_diacritics 2 tokenchars '_'");
chunks_tri USING fts5(text, content='chunks', content_rowid='id', tokenize='trigram');
embeddings(chunk_id INTEGER PRIMARY KEY, model_id TEXT NOT NULL,
           dim INTEGER NOT NULL CHECK (dim = 384), vector BLOB NOT NULL CHECK (length(vector) = dim*4));
document_extractions(doc_id INTEGER PRIMARY KEY, extraction_json TEXT NOT NULL);
-- search use of the FTS5 tables and embeddings: 05-knowledge-rag.md §5
```

- Foreign keys, all `ON DELETE CASCADE`: every `session_id` → `sessions(id)`; `chunks.doc_id` and
  `document_extractions.doc_id` → `documents(id)`; `embeddings.chunk_id` → `chunks(id)`.
  `messages.seq` and `events.seq` are CHECKed to integers 0 … 2^53−1.
- Triggers keep `chunks_fts` and `chunks_tri` in step with `chunks` and bump `meta.embedding_epoch`
  on every chunk or embedding change; an updated chunk drops its embedding.
- Indexes: `messages(session_id, seq)`, `events(session_id, seq)`, `session_id` on `tool_calls`,
  `approvals`, `changes`, `artifacts` and `todos`; `chunks(doc_id)`, `documents(status)`.
- IDs: sessions `ses_` + ULID, artifacts `art_` + ULID, approvals `apv_` + ULID; tool-call IDs come
  from the provider.
- Timestamps are ISO 8601 UTC strings.
- Schema version: `meta.schema_version` is `'1'` and names the only accepted format. An empty
  database gets the complete schema and `meta` rows in one immediate transaction; an existing database
  is never rewritten. Any other `schema_version`, an incomplete schema or a bad `embedding_epoch` is
  refused with INVALID before the lock or recents change and the file stays untouched; a different
  `workbench_id` gives CONFLICT. There are no migrations, no migration runner and no backups
  (`.vera/backups/` is gone); migrations are deferred until the first public release (07 §6).
- Core uses better-sqlite3 13.0.3 with WAL, foreign_keys ON, busy_timeout 5000 and synchronous NORMAL.
  Compatibility is inspected on a private db/WAL snapshot before lock or writable database activity;
  foreign-owner read-only handles retain private snapshots (`query_only`). An unstable concurrent
  capture returns BUSY. Sessions/messages/events repositories expose row CRUD with verbatim JSON and
  ascending message/event seq; sequences are nonnegative safe integers. Writable handles retain an
  auxiliary read-only connection; owned release checkpoints (`wal_checkpoint(TRUNCATE)`) under the
  token guard before unlink, and the writer closes before the read-only connection so ownership loss
  never checkpoints foreign data. Failed unlink leaves storage usable.

## 10. Sessions and artifacts

- A session belongs to one workbench. Its title is the first user message cut to 60 characters, with
  no model call; the user can rename it (1–60 characters, not blank).
- A new session defaults to `agent.permission_mode`; a null `model_ref` falls back to `agent.model`,
  then the app default. "New session" reuses the newest unused idle session instead of adding a row. Sessions can be
  archived, searched (title and message text) and exported as JSON (`schemaVersion: 1`, all persisted
  events). The user-arranged session order lives in settings `sessionOrder`.
- The core session service (`core/src/sessions/service.ts`) stores full transcripts independently of
  the per-request context budget, projects snapshots from persisted events, and revalidates a
  citation against issued tool refs and current confined files before opening it. The desktop host
  drains turns before workbench close/switch; every session mutation rechecks the owned lock pid/token.
- Statuses: `idle`, `running`, `awaiting_approval`, `error`. Several sessions may run at once; each
  has at most one running turn, and messages sent during it are queued into it. File writes go
  through one queue per workbench (03 §6), the app's own saves included. Restart recovery marks
  undecided approvals `aborted` (by `mode`), adds "Interrupted" results for unanswered tool calls,
  returns `running` and `awaiting_approval` sessions to `idle`, and resolves `pending` changes by
  hash (applied, dropped or conflict) before another turn starts (03 §8).
- Deleting an idle session removes its rows and its `artifacts/<session-id>/` folder after a
  confirmation; files in `.vera/downloads/` are kept.
- Artifacts are text files the agent saves with `artifact_save`: UTF-8 up to 5 MiB each; names of
  1–100 characters from `A–Z a–z 0–9 . _ -`, no Windows device names; `overwrite: true` replaces one;
  MIME `text/markdown` for `.md`/`.markdown`, else `text/plain`; cited as `artifact:<name>`. Content
  holding stored credentials is refused. The UI opens, reveals and exports artifacts (never into
  `.vera/`). Binary artifacts arrive with device tools after 1.0 (future).

NOTES:
- Deferred until the first public release: `workbench/migrate.ts`. A later `format` bump needs it and a
  fixture of the old format. During development `format` stays 1 and `tests/fixtures/app-data/workbench.yaml`
  is the current-format fixture.
- Work packages cite this file as `02 §n`.
