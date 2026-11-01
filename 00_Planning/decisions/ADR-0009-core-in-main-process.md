# ADR-0009: Electron-agnostic core in the main process

Date: 2026-10-09
Status: Accepted; implemented with deviations (indexing in a utility process; see Implementation status)

## Context
The agent loop, tools, storage and indexing need Node. They must be testable without Electron, usable
from a headless CLI, and must not freeze the UI. Electron offers the main process, `utilityProcess`
and worker threads.

## Decision
`src/libraries/core` is plain TypeScript for Node and never imports `electron` (L1). The desktop app runs
it in the main process and supplies host services through ports (`CredentialStore`, `WorkerPool`,
`PathProvider`, `Clock`, `Logger`, `OpenExternal`). CPU-heavy work — `grep` discovery, reads and regex
matching, PDF extraction, embeddings and vector search — runs in a worker-thread pool. Deadlines
and abort are enforced by the host, which can terminate and replace a worker; a main-thread timer
cannot interrupt a synchronous regex. `src/apps/cli` runs the same core with Node-only ports and the
same deadline contract. ADR-0012 records the bounded-execution requirements.

## Alternatives considered
- Core in a `utilityProcess`: isolates crashes from the window, but adds a second IPC hop and moves
  `safeStorage` (main-process only) behind another boundary. The ports keep this move possible later.
- Core in the renderer with Node integration: violates the Electron security baseline.

## Consequences
- Core is tested with Vitest alone; agents can verify behaviour through the CLI without a GUI.
- A blocking bug in core can stall the main process; long synchronous work is forbidden there.

## Implementation status (2026-11-01)
- `src/libraries/core` imports no `electron`. Ports live in `core/src/ports.ts` (`WorkerPool`:18,
  `CredentialStore`:42, `PathProvider`:65, `Clock`:70, `Logger`:75, plus `FileAccess` and
  `WorkbenchHost`). Deviation: `OpenExternal` is not a core port; it exists only in desktop main
  (`src/apps/desktop/src/main/open-external.ts`).
- Agent loop, sessions, tools and storage run in main. `grep` runs in `NodeWorkerPool` worker
  threads (2 by default) with a host deadline (10 s default), terminate and replace
  (`core/src/workers/node-host.ts:22-132`); the CLI uses the same core and its own pool
  (`src/apps/cli/src/worker-pool.ts`).
- Deviation: on desktop, document selection, hashing, extraction, chunking, embeddings and semantic
  ranking run in a separate Electron `utilityProcess`, "VERA Indexer"
  (`src/apps/desktop/src/main/index.ts:90-98`, `indexer-process.ts:5-24`,
  `indexer-host.ts:84-90,158-172`). It hosts the PDF/Office and embedding worker threads, restarts
  after a crash, and main keeps every SQLite write. This applies the rejected utility-process
  alternative to indexing only; `architecture/05-knowledge-rag.md:33` records it.
