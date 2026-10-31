# Workbench SQLite storage

## Routing

Select for vera.db, the current schema and row repositories. Start with
05_Software/src/libraries/core/src/storage/db.ts and schema.ts. Focused checks are
db.test.ts, keyword-schema.test.ts, embedding-schema.test.ts, repositories.test.ts
and session-recovery.test.ts. [Workbench](workbench.md) owns folder/lock/handle
lifetime; [native packaging](native-packaging.md) owns addon delivery.

## Current contract

- schemaSql defines the complete current schema, including keyword indexes,
  embedding/extraction tables and their synchronization triggers.
- CURRENT_SCHEMA_VERSION remains 3, identifying the existing current format.
  It is a format marker, not a catalogue of upgrade steps.
- initializeDatabase creates an empty database in one immediate transaction,
  including workbench_id, created_by, schema_version and embedding_epoch metadata.
- Existing current databases are validated and opened without data or metadata
  rewrites. Unknown metadata remains untouched. Missing objects or a different
  schema return INVALID; a different workbench identity returns CONFLICT.
- There is no database migration runner or checksum catalogue, and no automatic
  database backups. Existing metadata is preserved without interpreting extra keys. No old-schema detection, repair, reset or compatibility path exists.
- StorageOptions supplies workbenchId, appVersion and optional readOnly.
  openDb returns db and idempotent close(preserveSource?).
- inspectDatabase validates a private temporary DB/WAL copy before lock acquisition
  or writable opening. Read-only handles reject writes and remove their temporary
  copies on close. Unstable concurrent captures return BUSY.
- Database and sidecar paths reject symlinks and nonordinary file types. Storage
  neither creates nor consults a backups folder.
- Writable connections use WAL, foreign_keys ON, busy_timeout 5000 and synchronous
  NORMAL. An auxiliary read-only connection preserves DB/WAL/SHM bytes on ownership
  loss; ordinary close permits normal SQLite checkpointing.
- Session child rows cascade on session deletion; document-derived rows cascade
  with their documents/chunks. Keyword and embedding triggers commit with changes.
  Message/event sequences remain nonnegative safe integers.
- Row repositories preserve caller-supplied JSON. Session recovery repairs
  interrupted runtime operations in the current schema; it is independent of
  schema initialization and is not a database migration.

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
