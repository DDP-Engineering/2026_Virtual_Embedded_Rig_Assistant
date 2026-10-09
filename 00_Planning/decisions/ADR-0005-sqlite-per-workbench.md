# ADR-0005: One SQLite database per workbench

Date: 2026-10-09
Status: Proposed — WP-05 confirms the driver and the tokenizers in a packaged app

## Context
Each workbench needs full-text search, vectors, sessions, events, approvals, changes and artifact
metadata, for one user, without a database server, inside a portable folder. better-sqlite3 13.x
ships prebuilt binaries inside its npm package (`prebuilds/win32-x64.node`,
`linux-x64.node` and others), so no compiler is needed; BenchPilot verified FTS5 with it on Node 24.

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
