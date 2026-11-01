# Architecture decision records

Status as of 2026-11-01. ADR-0001…0015 were checked against the code on that date; each ends with an
`Implementation status (2026-11-01)` section that records deviations without rewriting the original
decision. ADR-0016…0019 are accepted decisions for the plugin system, not implemented yet.

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](ADR-0001-desktop-stack.md) | TypeScript on Electron; electron-vite, React, npm workspaces, Vitest | Implemented; shadcn/ui only scaffolded, UI uses hand-written CSS |
| [ADR-0002](ADR-0002-model-access-pi-ai.md) | Models through `@earendil-works/pi-ai`, two collections (API key, subscription) | Implemented with deviations: custom endpoints built per request, VERA's own replay gateway |
| [ADR-0003](ADR-0003-agent-loop.md) | Agent loop: start from the reference loop behind `core/agent/runtime.ts` | Confirmed by ADR-0014; implemented, with steering and compaction |
| [ADR-0004](ADR-0004-workbench-is-a-folder.md) | A workbench is a plain folder; runtime state in `.vera/` | Implemented with deviations: configuration and skills live in `.vera/`; a second process opens read-only |
| [ADR-0005](ADR-0005-sqlite-per-workbench.md) | One SQLite database per workbench through better-sqlite3, FTS5 and trigram | Confirmed by ADR-0013; implemented; clean/offline Windows proof open |
| [ADR-0006](ADR-0006-local-bundled-embeddings.md) | Embeddings computed locally with a bundled model; no remote model loading | Implemented; model chosen by ADR-0015; runs in the VERA Indexer process |
| [ADR-0007](ADR-0007-no-shell-confined-tools.md) | No shell tool; file tools confined to the workbench; writes gated by permission mode | Implemented with deviations (`bypass` mode); process execution superseded by ADR-0016 |
| [ADR-0008](ADR-0008-updates-generic-feed.md) | electron-builder and electron-updater with a generic HTTPS feed | Implemented; adds `latest`/`beta` channels; signing not configured |
| [ADR-0009](ADR-0009-core-in-main-process.md) | Electron-agnostic core in the main process; CPU work in worker threads | Implemented with deviations: indexing runs in the VERA Indexer utility process |
| [ADR-0010](ADR-0010-zod-single-schema-language.md) | zod is the only schema language; tool schemas converted to JSON Schema | Implemented; JSON Schema round-trip not tested |
| [ADR-0011](ADR-0011-single-user-desktop.md) | Single-user desktop app: no accounts, roles or app login | Implemented |
| [ADR-0012](ADR-0012-bounded-execution-and-release-proof.md) | M1 context budgets and terminable grep; exact one-use approvals, workbench-wide writes and restart reconciliation; proof on actual release artifacts | Implemented in code; release-artifact proof partly open |
| [ADR-0013](ADR-0013-native-packaging-and-model-delivery.md) | N-API SQLite/ORT packages, verified immutable model delivery and compiled probe exclusion | Implemented; size check removed by ADR-0017; app-local VC++ runtime packaged; clean/offline Windows proof open |
| [ADR-0014](ADR-0014-agent-runtime-spike.md) | Reference runtime with mandatory M1 context preflight; measured pi-agent-core comparison | Implemented |
| [ADR-0015](ADR-0015-embedding-model-selection.md) | Bundled BGE q8 and demo hybrid recall gate | Implemented; the recall gate does not use the product's chunking |
| [ADR-0016](ADR-0016-plugins-skills-and-guarded-programs.md) | Plugins are skills plus declared programs under risk rules; generic guarded execution, no shell; agent-authored plugins start as trial, approved in every mode | Accepted by the user; not implemented |
| [ADR-0017](ADR-0017-plugin-provisioning-and-no-size-budget.md) | Bundled uv, on-demand plugin installs, no package size budget; supersedes L5 and 07 §1 budget | Accepted by the user; size budget removed, plugin provisioning not implemented |
| [ADR-0018](ADR-0018-hardware-risk-levels.md) | Hardware risk levels; irreversible operations need a typed confirmation in `ask` and `auto-edit` and run in `bypass` | Accepted by the user; not implemented |
| [ADR-0019](ADR-0019-plugin-catalog-tiers.md) | One plugin catalog with official and community tiers | Accepted by the user; mechanism proposed; not implemented |
