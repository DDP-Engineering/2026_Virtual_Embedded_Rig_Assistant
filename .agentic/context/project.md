# Project profile

## Purpose and users

VERA is the Virtual Embedded Rig Assistant desktop product for embedded engineering work. Product scope and users are defined by [planning](../../00_Planning/plan/README.md).

## Product responsibilities

The software root contains four ESM workspaces and strict TypeScript tooling with import-boundary regression tests. Desktop main owns the hardened Electron shell, confined local asset protocol, window geometry and validated IPC dispatch. Shared supplies zod channel/error/event schemas; sandboxed preload exposes window.vera invoke/subscribe. React provides Welcome/App Settings/session chat and responsive panels through the API and TanStack Query, with persisted theme/text scale, en/ro/de i18next presentation and browser mock mode. Core owns schema4 settings through host ports and the workbench folder lifecycle, YAML/config/pinned saves, locks, recents, ignored-path completion and per-workbench checksummed SQLite migrations/backups with session/message/event storage; main provides portable paths, atomic filesystem, safeStorage credentials and redacting logs. Providers configuration has strict list/save/remove IPC, masked localized forms, per-save weak-storage consent and metadata-only renderer queries. Main also orchestrates ChatGPT OAuth with VERA/installation identity, manual redirects, ten-minute cancellation and confirmed system-browser opening; the core subscription collection maps OpenAI to the chatgpt slot, and the composer exposes connected subscription models. Core also supplies the exact-pinned pi-ai gateway, current model budgets/catalogs, structured scrubbed failures and four-step provider tests. Instrumented builds compose deterministic replay; production omits that seam. Core ReferenceRuntime supplies M1 turn streaming, ordered/concurrent tools, approval-host waits, abort, verbatim transcript snapshots and mandatory transient context budgets; ADR0014 records the measured runtime choice. Core also supplies canonical system prompt composition with UTF8-bounded pinned context, skill metadata, injected Clock/environment and final character size. Core also supplies bounded whole-session task lists with atomic todos/event persistence and a live accessible Plan tab. Core also owns bounded UTF8 session artifacts, their metadata/events/references and verified confinement; main supplies list/open/reveal/export and React the live Artifacts viewer. The session Changes panel projects applied SQLite rows through validated read IPC, showing ordered counts/recorded diffs, replay/live refresh and confined native reveal. Core also supplies prepared confined write/edit with immutable hashes/diffs, atomic changes/events, hash recovery and workbench-owned admission shared with application saves; the core ApprovalGate owns deterministic exact-request digests, current permission modes, single-use user/mode decisions and recovery; desktop inline cards and CLI flags/TTY prompts share its policy. Core also supplies confined read/list/glob/grep, shared line refs, per-session read fingerprints and a zod ToolRegistry bound to the runtime. Desktop/CLI compose bounded worker hosts with absolute deadlines and termination for isolated grep. CLI composes durable headless sessions with Node ports, explicit replay/OpenAI/custom gateways, scrubbed JSONL/pretty output and the same worker/context policy. Core SessionService persists/replays session snapshots and complete turn/tool messages, validates tool-origin line and session-artifact citations, enforces current model budgets/settings limits and recovers interrupted pairs/statuses idempotently. Main binds sessions to workbench ownership/lifecycle and coalesces live subscription text; shared supplies strict session contracts and the common reducer.

## Supported operation

The target platforms are Windows x64 and Linux x64 (01-system section 9).

## Established constraints

The architecture laws in [01-system](../../00_Planning/architecture/01-system.md) govern process boundaries, local assets, credentials and test isolation. Versions are pinned exactly. Core remains independent of Electron; renderer access to main uses shared contracts.

## Implementation orientation

[05_Software/README.md](../../05_Software/README.md) routes setup and source layout. [AGENTS.md](../../AGENTS.md) governs master implementation, local commits and AEGIS scope.

[Desktop shell](../knowledge/desktop-shell.md) routes window/security/state changes. [Software tooling](../knowledge/software-tooling.md) routes workspaces, compilation and verification.

[IPC boundary](../knowledge/ipc-boundary.md) routes channels, errors, events, subscriptions and API/mock metadata.

[Providers](../knowledge/providers.md) routes credential encryption, consent, redaction, endpoint configuration and masked forms.

[LLM gateway](../knowledge/llm-gateway.md) routes model selection/capabilities/catalogs, connection tests, replay and manual smoke.

[Application data](../knowledge/app-data.md) routes settings, migrations, portable locations, atomic saves and redacting logs.

[Renderer foundation](../knowledge/renderer-foundation.md) routes UI layout, appearance, language and accessibility.

[Workbench](../knowledge/workbench.md) routes format1, creation/open/close, ownership, completion, recents and the Welcome/pinned UI.
[Workbench storage](../knowledge/workbench-storage.md) routes per-folder SQLite, compatibility checks, exclusive backups, checksummed migrations and session/message/event rows.

[Native packaging](../knowledge/native-packaging.md) routes x64 ZIP/AppImage, verified bundled
model delivery, compiled instrumented probes and external artifact-bound host evidence. WP-05
feasibility is observed on offline Linux and current connected Windows. Clean/offline Windows
and VC++ independence are required before final release WP-30/WP-33.

[Agent runtime](../knowledge/agent-runtime.md) routes turn behavior, context policy, tool-schema conversion and event mapping. [Sessions](../knowledge/sessions.md) routes durable lifecycle, event snapshots/subscriptions, recovery, citations and host integration.

## Authoritative references

- [System architecture](../../00_Planning/architecture/01-system.md)
- [Foundation packages](../../00_Planning/plan/M0-foundation.md)
- [Quality](../../00_Planning/architecture/08-quality.md)

[File tools](../knowledge/file-tools.md) routes confinement, discovery, fingerprints, line refs, registry and bounded grep hosts.

[Changes](../knowledge/changes.md) routes completed change history, strict list/get, shared diff presentation and workbench-confined native reveal.

[Plan](../knowledge/plan.md) routes task-list bounds, atomic persistence and live status presentation.

[Chat UI](../knowledge/chat-ui.md) routes session navigation, Markdown/tool/citation presentation, composer, usage, Context and snapshot-before-subscribe restoration.
