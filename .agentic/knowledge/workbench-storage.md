# Workbench SQLite storage

## Routing

Select for vera.db, the current schema and row repositories. Start with
05_Software/src/libraries/core/src/storage/db.ts and schema.ts. Focused checks are
db.test.ts, keyword-schema.test.ts, embedding-schema.test.ts, repositories.test.ts
and session-recovery.test.ts. [Workbench](workbench.md) owns folder/lock/handle
lifetime; [native packaging](native-packaging.md) owns addon delivery.

## Purpose and boundaries

Core owns the format-1 SQLite schema, storage handles and row repositories. The Workbench service
owns folder authority and the writer lock.

## Public interface

- `openDb` takes workbench identity, app version and read-only mode, and returns a database with
  idempotent `close(preserveSource?)`. A guarded session route requires existing initialized
  storage so stale notification clicks leave an absent or empty database unchanged.

## Invariants

- schemaSql defines the complete current schema, including keyword indexes,
  embedding/extraction tables and their synchronization triggers.
- CURRENT_SCHEMA_VERSION is 1, stored as meta schema_version "1". It identifies the
  current format and is never incremented during development (root AGENTS.md
  development compatibility policy). Any other value returns INVALID and the file
  stays untouched.
- initializeDatabase creates an empty database in one immediate transaction,
  including workbench_id, created_by, schema_version and embedding_epoch metadata.
- Existing current databases are validated and opened without data or metadata
  rewrites. Unknown metadata remains untouched. Missing objects or a different
  schema return INVALID; a different workbench identity returns CONFLICT.
- There is no database migration runner or checksum catalogue, and no automatic
  database backups. Existing metadata is preserved without interpreting extra keys. No old-schema detection, repair, reset or compatibility path exists.
- A writable openDb is for a database whose workbench lock the caller holds: it
  opens the file in place with no copy and checks the schema with query_only ON
  before any pragma or write. A refused database keeps its DB/WAL bytes while
  another connection holds it open; with a leftover WAL and no other connection,
  the refusing writer's close lets SQLite checkpoint those committed frames.
- A read-only openDb queries a private temporary DB/WAL copy made with async
  fs.promises.copyFile (COPYFILE_FICLONE), so the source DB/WAL/SHM stay untouched
  and the main process is not blocked. dev/ino/size/mtimeNs and the 32-byte header of
  DB and WAL are compared around the copy; a change is retried once, then returns BUSY, as do
  EBUSY/EPERM from the copy. Read-only handles reject writes and remove their
  temporary copies on close.
- Database and sidecar paths reject symlinks and nonordinary file types. Storage
  creates no backups.
- Writable connections use WAL, foreign_keys ON, busy_timeout 5000 and synchronous
  NORMAL. An auxiliary read-only connection preserves DB/WAL/SHM bytes on ownership
  loss; ordinary close permits normal SQLite checkpointing.
- Session-owned transcript and tool rows cascade on session deletion. Format-1
  `session_delegations` holds the root ID, its unique request key and request digest, the child ID,
  and the first turn/message IDs. The child foreign key clears on deletion while the request
  remains reserved. The parent foreign key restricts deletion until SessionService confirms
  all children were deleted and removes their request rows in the same transaction.
  `session_delegation_requests` stores hashes and acknowledgements for follow-ups and configuration.
  Commit them with the corresponding history or settings. `session_delegation_bypass` stores each
  parent's user-authorized launch grant. Both rows cascade on parent deletion. The Desktop list
  reads the latest turn outcome through sparse event indexes without replaying child transcripts.
- Document-derived rows cascade with their documents/chunks. Keyword and embedding triggers
  commit with changes. Message/event sequences remain nonnegative safe integers.
- Row repositories preserve caller-supplied JSON. Session recovery repairs
  interrupted runtime operations in the current schema; it is independent of
  schema initialization and is not a database migration.

## Key behaviors

- Guarded stale-target opens return NOT_FOUND for absent or uninitialized storage
  (REQ-REL-279c294c). Initialization on an ordinary authorized workbench open uses the existing schema policy.

## Files

- `storage/db.ts` opens and closes handles. `storage/schema.ts` initializes and checks the schema.
- `storage/repos/` contains stored-row access. `storage/db.test.ts` covers guarded and regular opens.

## Change map

| Change | Start | Focused verification |
|---|---|---|
| Initialization/schema | storage/schema.ts | storage/db.test.ts |
| Connections and protected reads | storage/db.ts | storage/db.test.ts |
| Keyword indexes and triggers | storage/schema.ts; repos/documents.ts | keyword-schema.test.ts; knowledge/keyword.test.ts |
| Vectors and extraction | storage/schema.ts; repos/documents.ts | embedding-schema.test.ts |
| Session recovery | sessions/service.ts | storage/session-recovery.test.ts |
| Row storage and cascades | storage/repos | storage/repositories.test.ts |
| Ownership and handle lifetime | workbench/service.ts | workbench/service.test.ts |
