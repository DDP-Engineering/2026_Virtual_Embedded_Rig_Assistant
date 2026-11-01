# ADR-0005: One SQLite database per workbench

Date: 2026-10-09
Status: Accepted — confirmed by ADR-0013 (WP-05); implemented; clean/offline Windows release proof still open

## Context
Each workbench needs full-text search, vectors, sessions, events, approvals, changes and artifact
metadata, for one user, without a database server, inside a portable folder. better-sqlite3 13.x
ships prebuilt binaries inside its npm package (`prebuilds/win32-x64.node`,
`linux-x64.node` and others), so no compiler is needed; the reference code verified FTS5 with it on Node 24.

## Decision
One `vera.db` per workbench in `.vera/`, opened with better-sqlite3 in WAL mode. Keyword search uses
FTS5 with the `unicode61` tokenizer and a second FTS5 table with the `trigram` tokenizer; vectors are
BLOBs searched by brute force in a worker (05 §5). WP-05 must show in packaged Electron builds on
Windows and Linux that the module loads, that both tokenizers work, and that WAL works on local disks.

## Alternatives considered
- `node:sqlite` (built into Node): no native module at all; whether Electron's Node build enables FTS5
  and trigram must be checked. WP-05 tests it as plan B.
- sqlite-vec for vectors: still pre-1.0, and brute force is fast enough at workbench scale.
- LanceDB or another vector store: a second storage engine for no gain at this scale.

## Consequences
- Writes are serialised within the process; WAL keeps reads concurrent.
- Moving the folder moves the database (ADR-0004).
- Native module packaging is a known risk, retired early by a spike in M0.

## Implementation status (2026-11-01)
- Implemented as decided: `.vera/vera.db` (`src/libraries/core/src/workbench/service.ts:520`) through
  better-sqlite3 13.0.3 (`core/package.json:35`) in WAL mode (`core/src/storage/db.ts:86`).
- Keyword search: FTS5 `chunks_fts` with `unicode61 remove_diacritics 2 tokenchars '_'` and
  `chunks_tri` with `trigram` (`core/src/storage/schema.ts:48-51`). Vectors are 384-dimension float32
  BLOBs (`schema.ts:66-71`), ranked by brute force in the embedding worker
  (`core/src/knowledge/search.ts:236-255`, `knowledge/embedding.ts:216`).
- `node:sqlite` is used only by the packaging probe
  (`src/apps/desktop/src/main/packaging/sqlite-probe.ts`), not in production.
- Additions: read-only opens use a private temporary copy of the database (`storage/db.ts:26-58`).
  On desktop, all SQLite writes stay in main while indexing runs in a utility process (ADR-0009).
- Schema versioning: the complete schema is created in one transaction for a new database and
  `meta.schema_version` is `'1'`. Any other value gives INVALID and the file stays untouched. There
  are no migrations and no backups; they are deferred until the first public release (07 §6, WP-32).
- Open: proof on a clean/offline Windows machine (WP-30/WP-33, see ADR-0013).
