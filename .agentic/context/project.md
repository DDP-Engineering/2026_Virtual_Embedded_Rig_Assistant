# Project profile

## Purpose and users

VERA is the Virtual Embedded Rig Assistant desktop product for embedded engineering work. Product scope and users are defined by [planning](../../00_Planning/plan/README.md).

## Product responsibilities

The software root contains four ESM workspaces and strict TypeScript tooling with import-boundary regression tests. Desktop main owns the hardened Electron shell, confined local asset protocol, window geometry and validated IPC dispatch. Shared supplies zod channel/error/event schemas; sandboxed preload exposes window.vera invoke/subscribe. React provides Welcome/App Settings/session chat and responsive panels through the API and TanStack Query, with persisted theme/text scale, en/ro/de i18next presentation and browser mock mode. Core owns schema4 settings through host ports and the workbench folder lifecycle, YAML/config/pinned saves, locks, recents, ignored-path completion and per-workbench checksummed SQLite migrations/backups with session/message/event storage; main provides portable paths, atomic filesystem, safeStorage credentials and redacting logs. Providers configuration has strict list/save/remove IPC, masked localized forms, per-save weak-storage consent and metadata-only renderer queries. Main also orchestrates ChatGPT OAuth with VERA/installation identity, manual redirects, ten-minute cancellation and confirmed system-browser opening; the core subscription collection maps OpenAI to the chatgpt slot, and the composer exposes connected subscription models. Core also supplies the exact-pinned pi-ai gateway, current model budgets/catalogs, structured scrubbed failures and four-step provider tests. Instrumented builds compose deterministic replay; production omits that seam. Core ReferenceRuntime supplies M1 turn streaming, durable queued steering with pending/delivered transcript projection, ordered/concurrent tools, approval-host waits, abort, verbatim transcript snapshots and mandatory transient context budgets plus bounded historical compaction with session-local derived summaries; ADR0014 records the measured runtime choice. Core also supplies canonical system prompt composition with UTF8-bounded pinned context, skill metadata, injected Clock/environment and final character size. Core also supplies bounded whole-session task lists with atomic todos/event persistence and a live accessible Plan tab. Core also owns bounded UTF8 session artifacts, their metadata/events/references and verified confinement; main supplies list/open/reveal/export and React the live Artifacts viewer. The session Changes panel projects applied SQLite rows through validated read IPC, showing ordered counts/recorded diffs, replay/live refresh and confined native reveal. Core also supplies prepared confined write/edit with immutable hashes/diffs, atomic changes/events, hash recovery and workbench-owned admission shared with application saves; the core ApprovalGate owns deterministic exact-request digests, current permission modes, single-use user/mode decisions and recovery; desktop inline cards and CLI flags/TTY prompts share its policy. Core also supplies confined read/list/glob/grep, shared line refs, per-session read fingerprints and a zod ToolRegistry bound to the runtime. Desktop/CLI compose bounded worker hosts with absolute deadlines and termination for isolated grep. CLI composes durable headless sessions with Node ports, explicit replay/OpenAI/custom gateways, scrubbed JSONL/pretty output and the same worker/context policy. Core SessionService searches titles/full durable message text and supplies versioned event archives; desktop exports scrubbed Markdown transcripts/citations/tool summaries/applied diffs or JSON through the native save port, with localized session search/export UI. Core SessionService persists/replays session snapshots and complete turn/tool messages, validates tool-origin line and session-artifact citations, enforces current model budgets/settings limits and recovers interrupted pairs/statuses idempotently. Main binds sessions to workbench ownership/lifecycle and coalesces live subscription text; shared supplies strict session contracts and the common reducer.

## Supported operation

The target platforms are Windows x64 and Linux x64 (01-system section 9).

## Established constraints

The architecture laws in [01-system](../../00_Planning/architecture/01-system.md) govern process boundaries, local assets, credentials and test isolation. Versions are pinned exactly. Core remains independent of Electron; renderer access to main uses shared contracts.

## Implementation orientation

[Release smoke](../knowledge/release-smoke.md) routes exact-artifact offline resources,
normal loopback tools/approval/citation/restart and external process-tree egress.

[Upgrade safety](../knowledge/upgrade-safety.md) routes frozen previous-version migration,
interrupted recovery and newer-data preservation fixtures with actual installed acceptance.

[Skills](../knowledge/skills.md) routes workbench/user discovery, validated metadata
prompt index, confined on-demand body/extra reads and localized Skills settings.

[Knowledge ingest](../knowledge/knowledge-ingest.md) routes background document
selection/hash/limits/status events, reindex and derived-row invalidation through
the workbench-owned queue shared by desktop and CLI composition.
[Retrieval evaluation](../knowledge/retrieval-evaluation.md) supplies the isolated native CPU comparison over frozen demo questions; ADR0015 selects the bundled BGE descriptor and hybrid recall gate.
[Document extraction](../knowledge/document-extraction.md) supplies cached PDF/text/heading
extraction, precise chunks/OCR and dedicated PDF worker composition.
[Citations](../knowledge/sessions.md) use shared page/range/heading/line/artifact
syntax, successful tool provenance and current source/session bounds; the
[transcript](../knowledge/chat-ui.md) presents compact per-kind verified/warning chips.
[Keyword search](../knowledge/keyword-search.md) supplies persisted word/identifier
fragment candidates with locators; migration2 backfills and synchronizes indexes
through chunk triggers. [Document search](../knowledge/document-search.md) supplies
local worker embeddings, atomic extraction/vector publication, deterministic
hybrid search, guarded document tools and CLI index/search with a real eval gate.

[05_Software/README.md](../../05_Software/README.md) routes setup and source layout. [AGENTS.md](../../AGENTS.md) governs master implementation, local commits and AEGIS scope.

[Desktop shell](../knowledge/desktop-shell.md) routes window/security/state changes. [Software tooling](../knowledge/software-tooling.md) routes workspaces, compilation and verification.

[IPC boundary](../knowledge/ipc-boundary.md) routes channels, errors, events, subscriptions and API/mock metadata.

[Providers](../knowledge/providers.md) routes credential encryption, consent, redaction, endpoint configuration and masked forms.

[LLM gateway](../knowledge/llm-gateway.md) routes model selection/capabilities/catalogs, connection tests, replay and manual smoke.

[Application data](../knowledge/app-data.md) routes settings, migrations, portable locations, atomic saves and redacting logs.

[Renderer foundation](../knowledge/renderer-foundation.md) routes UI layout, appearance, language and accessibility.

[Workbench](../knowledge/workbench.md) routes format1, creation/open/close, ownership, completion, recents and the Welcome/pinned UI.
[Workbench storage](../knowledge/workbench-storage.md) routes per-folder SQLite, compatibility checks, exclusive backups, checksummed migrations and session/message/event rows.

[Native packaging](../knowledge/native-packaging.md) routes host x64 NSIS/portableZIP and AppImage/deb,
verified BGE/Microsoft runtime delivery, compiled build/signature identity and external artifact-bound
host evidence. Real clean/offlineWindows and VC++ self-containment on that environment remain
required before final release; current-host import/loaded-path evidence supplements that criterion.

[Agent runtime](../knowledge/agent-runtime.md) routes turn behavior, context policy, tool-schema conversion and event mapping. [Sessions](../knowledge/sessions.md) routes durable lifecycle, event snapshots/subscriptions, recovery, citations and host integration.

## Authoritative references

- [Updates](../knowledge/updates.md) routes fixed generic feed, modes/channels and safe restart installation.

- [System architecture](../../00_Planning/architecture/01-system.md)
- [Foundation packages](../../00_Planning/plan/M0-foundation.md)
- [Quality](../../00_Planning/architecture/08-quality.md)

[File tools](../knowledge/file-tools.md) routes confinement, discovery, fingerprints, line refs, registry and bounded grep hosts.

[Changes](../knowledge/changes.md) routes completed change history, strict list/get, shared diff presentation and workbench-confined native reveal.

[Plan](../knowledge/plan.md) routes task-list bounds, atomic persistence and live status presentation.

[Chat UI](../knowledge/chat-ui.md) routes session navigation, Markdown/tool/citation presentation, composer, usage, Context and snapshot-before-subscribe restoration.
