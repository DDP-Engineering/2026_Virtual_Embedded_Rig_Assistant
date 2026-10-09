# Architecture decision records

A decision marked **Proposed** is confirmed or replaced by the spike named in its status; the spike
files a new ADR and updates this index.

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](ADR-0001-desktop-stack.md) | TypeScript on Electron; electron-vite, React, npm workspaces, Vitest | Accepted |
| [ADR-0002](ADR-0002-model-access-pi-ai.md) | Models through `@earendil-works/pi-ai`, two collections (API key, subscription) | Accepted |
| [ADR-0003](ADR-0003-agent-loop.md) | Agent loop: start from BenchPilot's loop behind `core/agent/runtime.ts` | Proposed; WP-10 confirms |
| [ADR-0004](ADR-0004-workbench-is-a-folder.md) | A workbench is a plain folder; runtime state in `.vera/` | Accepted |
| [ADR-0005](ADR-0005-sqlite-per-workbench.md) | One SQLite database per workbench through better-sqlite3, FTS5 and trigram | Proposed; WP-05 confirms |
| [ADR-0006](ADR-0006-local-bundled-embeddings.md) | Embeddings computed locally with a bundled model; no remote model loading | Accepted; model chosen by WP-24 |
| [ADR-0007](ADR-0007-no-shell-confined-tools.md) | No shell tool; file tools confined to the workbench; writes gated by permission mode | Accepted |
| [ADR-0008](ADR-0008-updates-generic-feed.md) | electron-builder and electron-updater with a generic HTTPS feed | Accepted |
| [ADR-0009](ADR-0009-core-in-main-process.md) | Electron-agnostic core in the main process; CPU work in worker threads | Accepted |
| [ADR-0010](ADR-0010-zod-single-schema-language.md) | zod is the only schema language; tool schemas converted to JSON Schema | Accepted |
| [ADR-0011](ADR-0011-single-user-desktop.md) | Single-user desktop app: no accounts, roles or app login | Accepted |
