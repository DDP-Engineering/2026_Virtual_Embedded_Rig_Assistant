# Project profile

## Purpose and users

VERA is the Virtual Embedded Rig Assistant desktop product for embedded engineering work. Product scope and users are defined by [planning](../../00_Planning/plan/README.md).

## Product responsibilities

The software root contains four ESM workspaces and strict TypeScript tooling with import-boundary regression tests. Desktop main owns the hardened Electron shell, confined local asset protocol, window geometry and validated IPC dispatch. Shared supplies zod channel/error/event schemas; sandboxed preload exposes window.vera invoke/subscribe. React provides a compact unified title/menu row, persistent collapsible navigation rail, Welcome/App Settings/session chat and responsive panels through the API and TanStack Query, with persisted theme/text scale, en/ro/de i18next presentation and browser mock mode. Core owns schemaVersion 1 settings through host ports and the workbench folder lifecycle, project configuration/pinned context/ignore policy/skills under project/.vera, YAML/config/pinned saves, locks, recents, ignored-path completion and per-workbench SQLite (schema_version 1) with session/message/event storage; main provides portable paths, atomic filesystem, safeStorage credentials and redacting logs. Providers configuration has strict list/save/remove IPC, masked localized forms, per-save weak-storage consent and metadata-only renderer queries. Main also orchestrates ChatGPT OAuth with VERA/installation identity, manual redirects, ten-minute cancellation and confirmed system-browser opening; the core subscription collection maps OpenAI to the chatgpt slot, and the composer exposes connected subscription models. Core also supplies the exact-pinned pi-ai gateway, current model budgets/catalogs, structured scrubbed failures and four-step provider tests. Instrumented builds compose deterministic replay; production omits that seam. Core ReferenceRuntime supplies M1 turn streaming, durable queued steering with pending/delivered transcript projection, ordered/concurrent tools, approval-host waits, abort, verbatim transcript snapshots and mandatory transient context budgets plus bounded historical compaction with session-local derived summaries; ADR0014 records the measured runtime choice. Core also supplies canonical system prompt composition with UTF8-bounded pinned context, skill metadata, injected Clock/environment and final character size. Core also supplies bounded whole-session task lists with atomic todos/event persistence and a live accessible Plan tab. Core also owns bounded UTF8 session artifacts, their metadata/events/references and verified confinement; main supplies list/open/reveal/export and React the live Artifacts viewer. The session Changes panel projects applied SQLite rows through validated read IPC, showing ordered counts/recorded diffs, replay/live refresh and confined native reveal. Core also supplies prepared confined write/edit with immutable hashes/diffs, atomic changes/events, hash recovery and workbench-owned admission shared with application saves; the core ApprovalGate owns deterministic exact-request digests, current permission modes, single-use user/mode decisions and recovery; desktop inline cards and CLI flags/TTY prompts share its policy. Core also supplies confined read/list/glob/grep, shared line refs, per-session read fingerprints and a zod ToolRegistry bound to the runtime. Desktop/CLI compose bounded worker hosts with absolute deadlines and termination for isolated grep. CLI composes durable headless sessions with Node ports, explicit replay/OpenAI/custom gateways, scrubbed JSONL/pretty output and the same worker/context policy. Core SessionService searches titles/full durable message text and supplies versioned event archives; desktop exports scrubbed Markdown transcripts/citations/tool summaries/applied diffs or JSON through the native save port, with localized session search/export UI. Core SessionService persists/replays session snapshots and complete turn/tool messages, validates tool-origin line and session-artifact citations, enforces current model budgets/settings limits and recovers interrupted pairs/statuses idempotently. Main binds sessions to workbench ownership/lifecycle and coalesces live subscription text; shared supplies strict session contracts and the common reducer.

## Supported operation

The target platforms are Windows x64 and Linux x64 (01-system section 9).

The desktop shell occupies a fixed viewport without document scrolling; long pages/panels scroll internally, and conversations use an independent segmented left scroll rail while the composer remains visible.

## Established constraints

The architecture laws in [01-system](../../00_Planning/architecture/01-system.md) govern process boundaries, local assets, credentials and test isolation. Versions are pinned exactly. Core remains independent of Electron; renderer access to main uses shared contracts.

## Implementation orientation

General web research uses enabled web_search/web_read over vendor-neutral WebProvider with default anonymous Exa MCP with selectable Tavily and Brave Search. [Web search](../knowledge/web-search.md) routes bounded calls, public source extraction and confirmed source links; no mandatory account/key or startup egress.

Sidebar session/workbench action menus are exclusive. New session reuses an unused idle unarchived session in the current workbench, with transactional rapid-click protection and composer focus.

Agent activity presents localized historical per-prompt token consumption and frozen initial context estimates, with shared-batch/unavailable labels, through existing persisted usage events.

[Verification fixtures](../knowledge/demo-onboarding.md) routes the fictional board corpus under tests/fixtures. New Workbench is a creation-only page that inspects the chosen single-root folder and creates it with a configured draft (instructions, agent, tools, skills, indexing); Open Workbench and the sidebar open, reopen and remove recents. The sidebar retains pinned workbenches and grouped sessions; the workbench editor page shares the creation form and manages supported configuration and local embedding chunk settings. The Plugins page installs plugins from a folder or zip through a review screen, lists them with program statuses and issues, enables them for the open workbench, installs their programs and uninstalls them; the right panel's Runs tab lists the workbench's plugin program runs, opens their logs and stops running ones. Sessions begin with user-composed input.

The workbench Tools editor presents the shared built-in catalog with localized descriptions and enabled checkboxes, persisting exclusions through the current tools.disabled configuration.

Session/workbench permission modes include explicit Bypass for enabled ordinary file tools with full OS-account filesystem scope, including outside/ignored paths. It retains durable exact grants, integrity limits and revocation on downgrade. The shared marked permission picker presents a localized dismissible warning and a persisted application-level suppression preference.

[Release smoke](../knowledge/release-smoke.md) routes exact-artifact offline resources,
normal loopback tools/approval/citation/restart and external process-tree egress.

Stored formats follow the root AGENTS.md development compatibility policy: every format version is 1,
any other version is invalid data, and upgrade/migration safety is deferred until the first public release.

[Plugins](../knowledge/plugins.md) routes plugin.yaml format 1 validation, the integrity-checked plugin store under
<userData>/plugins (folder/zip install, list with issues, load, uninstall), per-workbench plugins.enabled and the
ProgramRunner: programs start through the ProcessHost port (no shell, closed stdin, minimal environment, guarded cwd),
with process-tree kills on timeout/Stop, logs in .vera/runs, background runs and the serial-port guard; and the program
rule matcher, risk levels, mode matrix with the trial override, run_program approvals bound to file hashes, the typed
confirmation checked in core and the bypass warning's list of irreversible rules; and the agent's program tools
(run_program, program_output, program_stop) over a ProgramHost whose executable resolver is the provisioner, with the
`<programs>` prompt block and plugin skills joining the skill catalog; and provisioning: a pinned bundled uv installs pip
and PEP 723 script programs under <userData>/plugins/runtime with one managed CPython, SHA-256-pinned downloads extract
there, find programs are located on PATH and absolute globs, versions are probed against supported ranges, and installs
run only on a user action (plugins.provision IPC, vera plugin install); and the plugin catalog: `vera catalog check|build`
validate a catalog source and build its release (index.json format 1 and one zip per plugin), and the desktop client
reads the catalog URL setting (else the build default, else the bundled official plugins), verifies each zip's size
and SHA-256, shows the review screen before a first install and before updates that change programs or rules, installs
with the catalog tier and checks for updates at start and every 24 h without installing them.

[Official plugins](../knowledge/official-plugins.md) routes the plugin packages VERA ships in 05_Software/plugins/ (also a
catalog source that the package bundles as <resources>/plugins), installed from the folder or the catalog: serial-monitor lists serial ports with their board family, captures consoles with an optional DTR/RTS
reset and sends one line (program serial, a PEP 723 pyserial script; list safe, capture device-read, send device-write);
esp32-esptool (requires serial-monitor) installs esptool v5 from PyPI and identifies, flashes, verifies and erases ESP32
chips under rules that classify every esptool 5.6.0 command, with skill esp32-flash; esp32-idf detects EIM/ESP-IDF,
runs idf.py through verified string activation and supplies Xtensa/RISC-V addr2line plus build-fix/panic skills.
Its real vendor build/flash/panic acceptance remains pending toolchain and board availability. The binutils plugin supplies ten ARM/RISC-V analysis programs through ordered toolchain discovery and user-triggered pinned xPack fallback, with size/crash/ELF inspection skills and genuine debug ELF fixtures.

[Skills](../knowledge/skills.md) routes workbench/user/plugin discovery, validated metadata
prompt index, confined on-demand body/extra reads and localized Skills settings.

[Knowledge ingest](../knowledge/knowledge-ingest.md) routes background document
selection/hash/limits/status events, reindex and derived-row invalidation through
the workbench-owned queue shared by desktop and CLI composition. In the desktop app the
[indexer process](../knowledge/indexer-process.md) runs selection, hashing, extraction, chunking
and embeddings in the VERA Indexer utility process; main keeps every SQLite write.
[Retrieval evaluation](../knowledge/retrieval-evaluation.md) supplies the isolated native CPU comparison over frozen demo questions; ADR0015 selects the bundled BGE descriptor and hybrid recall gate.
[Document extraction](../knowledge/document-extraction.md) supplies cached PDF/text/heading
extraction, structured office extraction (docx/odt headings, pptx/odp slides, xlsx/ods sheets;
legacy doc/ppt/xls and RTF not indexed), precise chunks/OCR and the dedicated document worker
composition that parses PDFs and office files.
[Citations](../knowledge/sessions.md) use shared page/range/heading/line/artifact
syntax, successful tool provenance and current source/session bounds; the
[transcript](../knowledge/chat-ui.md) presents compact per-kind verified/warning chips.
[Keyword search](../knowledge/keyword-search.md) supplies persisted word/identifier
fragment candidates with locators; schema triggers synchronize the indexes
with chunks. [Document search](../knowledge/document-search.md) supplies
local worker embeddings, atomic extraction/vector publication, deterministic
hybrid search, guarded document tools and CLI index/search with a real eval gate.

[05_Software/README.md](../../05_Software/README.md) routes setup and source layout. [AGENTS.md](../../AGENTS.md) governs master implementation, local commits and AEGIS scope.

[Desktop shell](../knowledge/desktop-shell.md) routes window/security/state changes. [Software tooling](../knowledge/software-tooling.md) routes workspaces, compilation and verification.

[IPC boundary](../knowledge/ipc-boundary.md) routes channels, errors, events, subscriptions and API/mock metadata.

[Providers](../knowledge/providers.md) routes credential encryption, consent, redaction, endpoint configuration and masked forms.

[LLM gateway](../knowledge/llm-gateway.md) routes model selection/capabilities/catalogs, connection tests, replay and manual smoke. ChatGPT model/reasoning metadata comes from its live account catalog; session reasoning preferences persist in .vera events and apply to subsequent prepared model requests.

[Application data](../knowledge/app-data.md) routes settings, validation, portable locations, atomic saves and redacting logs.

[Renderer foundation](../knowledge/renderer-foundation.md) routes UI layout, appearance, language and accessibility.

[Workbench](../knowledge/workbench.md) routes format1, creation/open/close, ownership, completion, recents and the Welcome/pinned UI.
[Workbench storage](../knowledge/workbench-storage.md) routes per-folder SQLite, current-schema validation (schema_version 1) and session/message/event rows.

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

App-wide keyboard bindings are confirmed settings shared through the renderer
ShortcutContext. Settings supports searching, recording, adding/removing aliases
and restoring defaults for current navigation, panels and conversation actions.

Settings > Web access owns the global web gate and explicit provider-specific anonymous/API-key modes, separately from AI Providers. Dedicated credential-safe IPC and ConfiguredWebProvider apply it across workbenches/CLI; see [web access](../knowledge/web-search.md).

Web access supports Exa/Tavily/Brave with isolated credentials and CLI EXA_API_KEY/TAVILY_API_KEY/BRAVE_SEARCH_API_KEY. Tavily supports anonymous search/read; Brave requires a key and is search-only. Focused adapter/gate/main/UI/shared and native provider-isolation tests verify routing; live anonymous Tavily search/extraction is separate from scripted private-key acceptance.

Managed PDF downloads: web_download is a provider-neutral approved write tool saving exact binary PDFs and provenance under .vera/downloads; local Open PDF actions reuse the viewer and remain offline-readable. Downloads share live Web access/permissions, never search-provider credentials, and are not automatically indexed for RAG. See [PDF downloads](../knowledge/pdf-downloads.md).

Plugin authoring: the built-in official create-plugin skill researches CLI manuals and writes workbench drafts; plugin_validate reports schema/lint issues, and plugin_install always waits for user review then installs trial without enablement/provisioning. The Plugins page promotes a hash-bound trial to local and exports portable zips; agent file writes cannot mutate managed plugin/application data or workbench.yaml, including in bypass. See [Plugins](../knowledge/plugins.md).
