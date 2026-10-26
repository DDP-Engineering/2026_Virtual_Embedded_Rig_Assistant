# ADR-0009: Electron-agnostic core in the main process

Date: 2026-10-09
Status: Accepted

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
