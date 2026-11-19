# Project profile

## Purpose and users

VERA is the Virtual Embedded Rig Assistant desktop product for embedded engineering work. Product scope and users are defined by [planning](../../00_Planning/plan/README.md).

## Product responsibilities

The software root contains four ESM workspaces and strict TypeScript tooling with import-boundary regression tests. Desktop main owns the hardened Electron shell, confined local asset protocol, window geometry and validated IPC dispatch. Shared supplies zod channel/error/event schemas; sandboxed preload exposes window.vera invoke/subscribe. React provides a compact unified title/menu row, persistent collapsible navigation rail, Welcome/App Settings/session chat and responsive panels through the API and TanStack Query, with persisted theme/text scale, en/ro/de/fr i18next presentation and browser mock mode. Core owns optional strict privacy.mask settings/workbench contracts and a live injected per-area masking resolver (all four consumer areas are wired; Settings and workbench privacy drafts expose live inheritance and confirmed agent disabling), schemaVersion 1 settings through host ports and the workbench folder lifecycle, project configuration/pinned context/ignore policy/skills under project/.vera, YAML/config/pinned saves, locks, recents, ignored-path completion and per-workbench SQLite (schema_version 1) with session/message/event storage; main provides portable paths, atomic filesystem, safeStorage credentials and redacting logs. Providers configuration has strict list/save/remove IPC, masked localized forms, per-save weak-storage consent and metadata-only renderer queries. Main also orchestrates ChatGPT OAuth with VERA/installation identity, manual redirects, ten-minute cancellation and confirmed system-browser opening; the core subscription collection maps OpenAI to the chatgpt slot, and the composer exposes connected subscription models. Core also supplies the exact-pinned pi-ai gateway, current model budgets/catalogs, structured scrubbed failures and four-step provider tests. Instrumented builds compose deterministic replay; production omits that seam. Core ReferenceRuntime supplies M1 turn streaming, durable queued steering with pending/delivered transcript projection, ordered/concurrent tools, approval-host waits, abort, verbatim transcript snapshots and mandatory transient context budgets plus bounded historical compaction with session-local derived summaries; ADR0014 records the measured runtime choice. Core also supplies canonical system prompt composition with UTF8-bounded pinned context, skill metadata, injected Clock/environment and final character size. Core also supplies bounded whole-session task lists with atomic todos/event persistence and a live accessible Plan tab. Core also owns bounded UTF8 session artifacts, their metadata/events/references and verified confinement; main supplies list/open/reveal/export and React the live Artifacts viewer. The session Changes panel projects applied SQLite rows through validated read IPC, showing ordered counts/recorded diffs, replay/live refresh and confined native reveal. Core also supplies prepared confined write/edit with immutable hashes/diffs, atomic changes/events, hash recovery and workbench-owned admission shared with application saves; the core ApprovalGate owns deterministic exact-request digests, current permission modes, single-use user/mode decisions and recovery; desktop inline cards and CLI flags/TTY prompts share its policy. Core also supplies confined read/list/glob/grep/decode_register (bounded exact captured register decoding with definition/manual citations)/parse_log (captured-log profiles, bounded events, full scan counts and source SHA), shared line refs, per-session read fingerprints and a zod ToolRegistry bound to the runtime. Desktop/CLI compose bounded worker hosts with absolute deadlines and termination for isolated grep and parse_log. CLI composes durable headless sessions with Node ports, explicit replay/OpenAI/custom gateways, agent-policy JSONL/pretty output with unconditional diagnostic scrubbing and the same worker/context policy. Core SessionService searches titles/full durable message text and supplies versioned event archives; desktop exports independently masked Markdown transcripts/citations/tool summaries/applied diffs or JSON through the native save port, with localized session search/export UI. Core SessionService persists/replays session snapshots and complete turn/tool messages, validates tool-origin line and session-artifact citations, enforces current model budgets/settings limits and recovers interrupted pairs/statuses idempotently. Main binds sessions to workbench ownership/lifecycle and coalesces live subscription text; shared supplies strict session contracts and the common reducer.

Session-local user-message bookmarks persist as format-1 events, project into snapshot bookmarkedMessageIds and remain in JSON/Markdown exports. Core and IPC enforce user/session ownership and writable unarchived mutations; read-only/archived reads remain available. Bookmark metadata never enters agent transcript/model requests. Message and single-marker preview controls share optimistic bookmark state with rollback and localized errors, locking read-only/archived mutations. Preview cards show the first prompt line and reply start, with derived reply ownership preserved through queued delivery and replay. Bookmarked rail markers are filled in the primary color and longer; groups indicate any bookmarked member. Configurable next/previous bookmark commands (Mod+Alt+N/P by default) reuse rail scroll, highlight, announcement and lane focus, stopping at directional boundaries.

User messages retain workbench image paths across restarts. Desktop uses workbench-confined, Display-masked thumbnails for the visible transcript. Selecting a thumbnail opens the file viewer, and an unavailable file shows its saved path under Display masking.

Core delegated turns use the same workbench session service, gateway and event history. The format-1 database retains parent ownership and request identity across interruption. Each workbench admits up to three active delegated turns with a fixed inspection-only tool scope. Parent agents can launch, observe, wait for and stop the initial turn through the core tool registry. Monitoring publishes bounded masked replies and status derived from the durable event sequence. Desktop uses the same workbench ownership and initial outcome for two-way Chat navigation, with refresh, reopen and normal Stop and approval controls.

## Supported operation

Saved-session performance verification uses an isolated native Electron build, real persisted
fixtures/sidebar selection, phase/responsiveness probes and explicit machine-specific reference
comparison. `npm run perf:sessions` and `06_SoftwareDocu/session-performance.md` define quick/full,
calibration and feature/milestone usage. Diagnostic measurements alone do not establish a passing budget.
The reference results per platform are the newest `session-full-*.json` files in
`05_Software/evaluation-outputs/performance/`.

The target platforms are Windows x64 and Linux x64 (01-system section 9).

The desktop shell occupies a fixed viewport without document scrolling; long pages/panels scroll internally, and conversations use an independent segmented left scroll rail while the composer remains visible.

## Established constraints

The architecture laws in [01-system](../../00_Planning/architecture/01-system.md) govern process boundaries, local assets, credentials and test isolation. Versions are pinned exactly. Core remains independent of Electron; renderer access to main uses shared contracts.

Plugin management uses compact package rows and explicit dependency checks; selection remains per workbench and defaults to none. Verified local dependency archives support offline provisioning without publishing a release. Desktop listing performs integrity work off main; session-list polling avoids program initialization while retaining recovery and current-workbench ownership.

## Implementation orientation

All product code is under `05_Software`; [05_Software/README.md](../../05_Software/README.md) describes the layout and commands.

| Path | Holds |
|---|---|
| `src/libraries/shared` (`@vera/shared`) | zod contracts: IPC channels, errors, events, settings, workbench and session schemas, the session reducer. |
| `src/libraries/core` (`@vera/core`) | Product logic, independent of Electron: `agent`, `sessions`, `tools`, `workbench`, `storage`, `knowledge`, `llm`, `plugins`, `skills`, `settings`, `web`, `parts`, `electrical`, `artifacts`, `help`, `workers`; host ports in `ports.ts`. |
| `src/apps/desktop` (`@vera/desktop`) | Electron `main` (shell, IPC dispatch, credentials, hosts), sandboxed `preload` (`window.vera`), React `renderer`. |
| `src/apps/cli` (`@vera/cli`) | Headless `vera` CLI composed from core through Node ports. |
| `plugins/` | Official plugin packages, one folder each, with `catalog.yaml` and `packs.yaml`. |
| `help/<en\|ro\|de\|fr>/` | App help pages. |
| `tests/`, `evaluators/` | Cross-component tests, fixtures and e2e; measurement harnesses. Unit tests sit beside the source. |
| `../02_Tools/` | Setup, build, release and delivery tooling. |

Each component has a knowledge page that names its source files, tests, invariants and requirements. Read the page for the component you change; `python .agentic/aegis.py components` lists them.

| Component | Page | Owns |
|---|---|---|
| Workspaces and tooling | [software-tooling](../knowledge/software-tooling.md) | Workspaces, exact pins, import boundaries, compilation, verification launchers, network guard. |
| Desktop shell | [desktop-shell](../knowledge/desktop-shell.md) | Window, security, local asset protocol, window state, compact chrome. |
| IPC boundary | [ipc-boundary](../knowledge/ipc-boundary.md) | Channels, errors, events, subscriptions, API and mock metadata. |
| Renderer foundation | [renderer-foundation](../knowledge/renderer-foundation.md) | Layout, appearance, languages, accessibility, Settings pages, keyboard shortcut bindings. |
| Application data | [app-data](../knowledge/app-data.md) | Settings, validation, portable locations, atomic saves, redacting logs, privacy masking choices. |
| Dictation models | [dictation](../knowledge/dictation.md) | Pinned local Whisper downloads, model lifecycle and spoken language Settings. |
| Providers | [providers](../knowledge/providers.md) | Credential encryption, consent, redaction, endpoint configuration, masked forms, ChatGPT sign-in. |
| LLM gateway | [llm-gateway](../knowledge/llm-gateway.md) | Model selection, capabilities and catalogs, connection tests, replay, manual live smoke. |
| Agent runtime | [agent-runtime](../knowledge/agent-runtime.md) | Turn behavior, steering, context policy and compaction, tool-schema conversion, event mapping. |
| Sessions | [sessions](../knowledge/sessions.md) | Durable lifecycle, snapshots, subscriptions, recovery, citations, approvals, bookmarks. |
| Session export and search | [session-export](../knowledge/session-export.md) | Title and text search, masked Markdown and JSON export. |
| Chat UI | [chat-ui](../knowledge/chat-ui.md) | Sidebar navigation and action menus, transcript, Markdown, tool and citation presentation, user-message navigator, composer, usage, chat detail levels. |
| Plan | [plan](../knowledge/plan.md) | Task-list bounds, atomic persistence, live Plan tab. |
| Artifacts | [artifacts](../knowledge/artifacts.md) | Bounded session artifacts, references, list, open, reveal, export. |
| Changes | [changes](../knowledge/changes.md) | Completed change history, diff presentation, confined reveal. |
| File tools | [file-tools](../knowledge/file-tools.md) | Path confinement, read, list, glob, grep, `decode_register`, `parse_log`, prepared write and edit, fingerprints, line refs, tool registry, worker hosts, `apply_candidate`. |
| Workbench | [workbench](../knowledge/workbench.md) | Format 1, create, open, close, ownership, recents, Welcome and New Workbench pages, the workbench editor and its sections, additional folders, saved command prefixes. |
| Workbench storage | [workbench-storage](../knowledge/workbench-storage.md) | Per-folder SQLite, current-schema validation, session, message and event rows. |
| Knowledge ingest | [knowledge-ingest](../knowledge/knowledge-ingest.md) | Background document selection, hashing, limits, status events, reindex. |
| Indexer process | [indexer-process](../knowledge/indexer-process.md) | The VERA Indexer utility process; main keeps every SQLite write. |
| Document extraction | [document-extraction](../knowledge/document-extraction.md) | PDF, text, heading and office extraction, chunks, OCR, document workers. |
| Keyword search | [keyword-search](../knowledge/keyword-search.md) | Persisted word and identifier candidates with locators. |
| Document search | [document-search](../knowledge/document-search.md) | Local embedding registry and inference, confirmed per-workbench model switching with keyword search during rebuild, hybrid search, document tools and CLI retrieval. |
| Document viewer | [document-viewer](../knowledge/document-viewer.md) | Docs panel, `docs.readBytes` byte windows, Rendered, Text and Hex modes, large text, image preview, Display masking. |
| Web search | [web-search](../knowledge/web-search.md) | `web_search` and `web_read`, the Exa, Tavily and Brave providers, Settings > Web access. |
| PDF downloads | [pdf-downloads](../knowledge/pdf-downloads.md) | `web_download`, files and provenance under `.vera/downloads`. |
| Parts search | [parts-search](../knowledge/parts-search.md) | `parts_search`, supplier switches, credentials and region, set in the parts-search plugin's Configuration section. |
| Electrical model | [electrical-model](../knowledge/electrical-model.md) | The electrical project model, results, catalogs, tables, measurements and lighting formats; the tools `electrical_model`, `electrical_model_change`, `industrial_catalog`, `electrical_network`, `protection_coordination`, `motor_drives`, `power_quality`, `lighting_design`. |
| Plugins | [plugins](../knowledge/plugins.md) | `plugin.yaml` format 1, the plugin store, ProgramRunner, rules, risk levels and approvals, `run_program` and `run_command`, bench resource leases, uv provisioning, the catalog and offline kits, the Plugins page and library, the Runs tab, plugin authoring. |
| Official plugins | [official-plugins](../knowledge/official-plugins.md) | Every package in `05_Software/plugins/`: programs, rules, skills, fixtures and what acceptance is still pending. |
| Skills | [skills](../knowledge/skills.md) | Workbench, user and plugin skill discovery, prompt index, confined body reads, Skills settings. |
| Help | [help](../knowledge/help.md) | Help pages, `help.list` and `help.read`, plugin help, the agent's help tool. |
| User terminals | [terminals](../knowledge/terminals.md) | Interactive terminal tabs, shell lifetime, consented bounded output for the agent. |
| Headless CLI | [headless-cli](../knowledge/headless-cli.md) | `vera` commands, providers, data folder, output formats, resume, environment keys. |
| Updates | [updates](../knowledge/updates.md) | Fixed generic feed, modes and channels, safe restart installation. |
| Native packaging | [native-packaging](../knowledge/native-packaging.md) | NSIS, portable ZIP, AppImage and deb, model and Microsoft runtime delivery, package reports, host probes. |
| Release smoke | [release-smoke](../knowledge/release-smoke.md) | Exact-artifact offline resources, loopback tools, approval, citation, restart, process-tree egress. |
| Verification fixtures | [demo-onboarding](../knowledge/demo-onboarding.md) | The fictional board corpus under `tests/fixtures`. |

Facts that span components:

- Stored formats follow the root [AGENTS.md](../../AGENTS.md) development policy: every format version is 1, any other version is invalid data, and there is no migration code.
- Permission modes are Read-only, Ask, Auto-edit and Bypass, per session with a workbench default. Bypass gives file tools, commands and declared program runs the full OS-account filesystem scope after one explicit confirmation per change. Host-configured application data is refused for reads and writes in every mode, including through aliases. Commands and programs run with OS-account permissions and are not sandboxed. See file-tools, plugins and sessions.
- Privacy masking has four areas: agent, exports, Display and Program runs. Settings hold the app defaults and each workbench may override them. See app-data.
- The interface, help and approval texts exist in en, ro, de and fr.
- Provider model capabilities include input modalities. Settings > Providers stores the image opt-in for each custom model within its connection.
- The composer takes pasted, dropped and picked raster images, retains imported originals in the workbench and attaches existing Files images by reference. Chat messages keep primary-workbench image paths in the transcript. Session dispatch loads bounded raster parts for image-capable models, and exports and compacted history retain the paths. The model-gated `view_image` tool uses a strictly confined workbench path and sends the image as a current-turn tool result. The workbench Tools editor resolves support for its draft default model.
- Plugin selection is per workbench and defaults to none. Global plugin installation is separate from workbench enablement.
- Plugin secrets (MQTT passwords, Wokwi tokens, parts search keys) stay in VERA's credential store and are edited in the plugin's Configuration section on the Plugins page; App settings has no page for them. MQTT and Wokwi secrets reach only an approved run of the enabled official plugin, on its stdin. See plugins and parts-search.
- The official plugins are verified against simulators and stand-ins. Real-hardware acceptance and native Ubuntu acceptance are pending; official-plugins lists what is pending per plugin.
- Clean, offline Windows execution and VC++ self-containment remain required before a final release. See native-packaging.

## Authoritative references

- [Planning and work packages](../../00_Planning/plan/README.md)
- [System architecture](../../00_Planning/architecture/01-system.md)
- [Quality](../../00_Planning/architecture/08-quality.md)
- [Software README](../../05_Software/README.md): setup, source layout, commands
- [Root AGENTS.md](../../AGENTS.md): master implementation, local commits, AEGIS scope
- [Environment guide](environment.md): toolchain, build and verification commands
