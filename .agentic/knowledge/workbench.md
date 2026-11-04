# Workbench lifecycle

## Routing

Select for .vera/workbench.yaml, .vera/WORKBENCH.md, wb_ identity, create/open/close, runtime lock,
recent folders, config/pinned saves, ignore rules and path completion. Start with
05_Software/src/libraries/core/src/workbench/service.ts and src/libraries/shared/src/workbench.ts.
Focused tests: core workbench/service.test.ts and shared workbench.test.ts. Native/UI tests:
tests/e2e/workbench.spec.ts and mock.spec.ts. [Application data](app-data.md) owns settings persistence;
[IPC boundary](ipc-boundary.md) owns authorization/transport; [renderer foundation](renderer-foundation.md)
owns the shell, appearance, language and layout.
Tool path confinement, read/list/glob/grep and worker deadlines route to [File tools](file-tools.md).
The current database schema, initialization and row repositories route to [Workbench storage](workbench-storage.md).

[Verification fixtures](demo-onboarding.md) routes the fictional board corpus and PDF sources under tests/fixtures, used by isolated tests and evaluation/smoke harnesses.

## Purpose and boundaries

Core owns project metadata under .vera: workbench.yaml, WORKBENCH.md, optional .veraignore, skills and runtime state. The selected folder stays the root for user documents and sources. Opening requires .vera/workbench.yaml; root files are ordinary content and are never migrated.

Core owns the folder lifecycle, identity, YAML validation, runtime lock, pinned context and common
ignore/completion policy. Main supplies process liveness, version, clock, token, settings and atomic
file/event ports. Renderer displays Welcome, pinned editor and session workbench switching through validated IPC; config.get adds optional folder/readOnly metadata for reload. Mock
mode offers empty, missing, read-only and warning fixtures.

## Public interface

- Agent defaults reuse the shared permission enum including Bypass. The editor's PermissionPicker shows the same full-access warning and permanent selection marking as the composer; project Save persists the default and Cancel discards that draft. Warning suppression is an independently saved application preference.

- The editor's Tools section lists the shared built-in catalog with en/ro/de descriptions and enabled checkboxes. Draft selection writes the existing tools.disabled array on Save; Cancel discards it and read-only/loading/pending controls remain disabled. WorkbenchService recognizes shared built-ins by default when reporting unknown disabled names; injected host catalogs retain their existing authority.

- plugins.enabled (default []) is the opt-in list of [plugins](plugins.md) for this workbench; togglePlugin writes it
  on the write queue like toggleSkill, enabledPlugins reads the current config, and ids that are not installed under
  <userData>/plugins are UNKNOWN_NAME warnings. The config event sanitizer scrubs it like skills.disabled.

- skillCatalog/listSkills/openSkill/saveSkill/toggleSkill admit [skills](skills.md)
  operations against current workbench ID, folder, database lifetime and token. Source
  selects project/.vera or the host userData root. Reads serialize with lifecycle; writes
  use shared admission, exclusive creation and original SHA256 before publication.

- listFolder/findFiles/readText/statEntry(workbenchId, ...) run the Docs tree reads of core
  workbench/tree.ts on the active workbench folder (CONFLICT otherwise). They need no storage,
  so read-only snapshots browse too; [Document viewer](document-viewer.md) owns their contract.

- WorkbenchService owns one writable background Ingester and reindexDocuments;
  close/replacement stops and drains ingest before lock/storage release. Read-only
  snapshots run no ingest. [Knowledge ingest](knowledge-ingest.md) owns selection,
  hashing, metadata/status events and derived invalidation.

- WorkbenchService.inspect(folder) returns the canonical folder, its final segment as suggested name,
  whether .vera/workbench.yaml exists, existing .vera/WORKBENCH.md text or null and the workbench/user
  skills for that folder, without writing. IPC `workbench.inspect`.
- WorkbenchService.scanDocuments(folder), previewDocuments(folder, docs) and relativeFolder(root, picked)
  (core workbench/documents-scan.ts; IPC workbench.scanDocs/previewDocs/relativeFolder). The scan walks at most
  20000 entries and 8 levels without links or ignored paths and returns first-level folders holding PDF, office,
  Markdown, HTML or .txt documents with per-kind counts and bytes (names and counts only). The preview reuses
  ingest's exported documentSelection() and documentKind(); modern office files count as documents and only matched
  legacy .doc/.ppt/.xls and RTF files count as not indexed (officePending); `~$` Office owner files are neither.
  relativeFolder returns a forward-slash path inside the root (an alias above the root is accepted) and DENIED for the root, outside, ignored or linked folders, including links looping back to the root. Generated include patterns use documentFolderPattern() (bracket-escaped, leading '!' as @(!)); documentPatternFolder() reads literal ones back.
- WorkbenchService.create(existingAbsoluteFolder,name,{config?,instructions?}), open(folder), close().
  create merges the optional patch (name excluded) over defaults and validates it before any write
  (INVALID leaves no workbench.yaml); WORKBENCH.md gets the given instructions or the template, and an
  existing WORKBENCH.md is kept. The CLI calls the two-argument form. Snapshots contain
  canonical folder/config/readOnly/warnings; invalid YAML reports line/column, invalid configuration
  reports path/line, and any format other than 1 reports CONFIG_INVALID at path format before runtime writes.
- Core-only getSnapshot supplies a detached current snapshot and assertSessionWritable immediately checks ordinary lock paths plus the owned pid/token before session database changes. Main session lifecycle drains active turns before switches/close.
- Core-only getWriteQueue supplies the shared queue for application config/pinned saves and every session write. File saves validate ownership/current state inside their queue callback; close and replacement drain admitted writes before storage disposal.
- Core-only getDatabase supplies owned writable SQLite or a live-owner read-only snapshot. Open validates
  the database schema before lock/recents writes; failed replacement preparation closes its handle
  and releases the new token while retaining the previous workbench. Close/successful switches dispose handles.
  Owned release checkpoints under the token guard before unlink; failed unlink retains usable storage.
  Disposal after release or ownership loss preserves source bytes through writer-first/read-only-last close.
- Config get/update deep-merges known mutable fields with current disk data, retains unknown keys,
  and fixes id/format. Pinned get/update saves full UTF8 text; oversized counts bytes above16384.
- Registry retrieval/removal/pinning retains application settings entries until explicit removal; folder existence derives missing state.
  Reopen refreshes known metadata.
- files(query) returns up to50 slash-separated relative ordinary-file paths, case-insensitive substring
  matches. createIgnoreRules applies case-insensitive permanent .vera/.git/node_modules segments before project-relative rules from .vera/.veraignore.
- Shared workbenchSchema/configWarnings/mergeWorkbench/workbenchTemplate supply format1 defaults,
  passthrough extensions, unresolved disabled-name warnings and the specified English pinned template.
- Native app.chooseFolder uses Electron dialog; instrumented compilation accepts VERA_TEST_DIALOG_PATH.
  Release emission eliminates the override. All lifecycle/config/pinned/recent/files channels are strict.
- WorkbenchEvent opened/closed/config.changed envelopes filter by wb_ id and clean up independently.

- readDocuments/listDocuments/searchDocuments/openDocument serialize scoped reads against close/switch, check exact active identity and current writable ownership, and expose protected read-only snapshots. Docs keyword hits verify current source/extraction bounds once per path and reject changed index epochs. Optional reindexDocuments(workbenchId) rejects foreign identity before admitting ingest. [Document viewer](document-viewer.md) owns content resolution.

- readDocuments/listDocuments/searchDocuments/openDocument serialize scoped reads against close/switch, check exact active identity and current writable ownership, and expose protected read-only snapshots. Docs keyword hits verify current source/extraction bounds once per path and reject changed index epochs. Optional reindexDocuments(workbenchId) rejects foreign identity before ingest admission. [Document viewer](document-viewer.md) owns content resolution.

## Invariants

- Core remains Electron-agnostic; renderer uses shared IPC only. Management paths and traversed
  directories reject symlinks/junction redirection. Completion skips links and permanently ignored roots.
- Create publishes configuration exclusively, retains existing user content and adds metadata only inside .vera.
- YAML format1 supports JSON-compatible extension values. Non-finite numbers/circular aliases are
  refused without rewriting source. An invalid format or changed identity blocks user saves.
- One service serializes operations; a short exclusive process-owned local IPC guard coordinates stale takeover.
  A live pid yields read-only without changing its runtime files; a dead pid permits takeover.
  Windows named pipes/Linux abstract Unix sockets auto-release on crash; EADDRINUSE contention
  yields read-only with a warning. Every reopen reassesses ownership; matching owned tokens survive.
- Locks hold pid/app/since and unique ownership token. Writes recheck ownership; close releases only
  its matching lock. A failed replacement/recent save retains the preceding workbench and cleans
  newly acquired ownership. Confirmed config saves publish events; observer errors cannot undo saves.
- UNC paths warn that network shares are unsupported. .vera/WORKBENCH.md text is user data; the editor
  saves full content explicitly and restores focus after Cancel/Escape/save. Each dialog loads fresh
  content before enabling input; drafts stay isolated from focus/reconnect refresh.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Format/extensions/validation | shared workbench.ts, core parseConfig | shared/core workbench tests |
| Lifecycle/ownership/failure | core WorkbenchService | service.test.ts, native live lock acceptance |
| Recents/order | WorkbenchService, SettingsService, shared ordering.ts, workbench-navigation.tsx | service/settings/ordering tests, workspace.test.ts, deleted-recent and sidebar-order E2E |
| Ignore/completion | createIgnoreRules, WorkbenchService.files | confined completion tests |
| New page/editor/locales | components/workbench-create.tsx, workbench-config-form.tsx, workbench-editor.tsx, App.tsx, locales | renderer workspace.test.ts, native workbench.spec.ts, browser mock.spec.ts |
| Dialog instrumentation | main/index.ts | actual build-mode.test.ts, instrumented native picker |

## Key behaviors

- REQ-DATA-85139c56 — format 1 validation, JSON-compatible extensions and location errors.
- REQ-FUNC-adf92ecb — non-destructive creation and shared template.
- REQ-REL-bcb6fb23 — live/stale ownership and token-aware close.
- REQ-DATA-d7ced6a1 — confirmed atomic config/pinned saves and extension retention.
- REQ-FUNC-bfd14725 — confined bounded ignored-path completion.
- REQ-DATA-dfbfac7c — persisted recent lifecycle and derived missing state.
- REQ-UX-8622cdbe — create on New Workbench, open/reopen from the sidebar, translated warnings/errors.
- REQ-UX-1d6c940b — editor page instructions, size warning, read-only and focus.
- REQ-FUNC-81ce68df — non-writing folder inspection.
- REQ-FUNC-3815bacc / REQ-FUNC-38107da8 — create with initial configuration; invalid draft rejected before writes.
- REQ-UX-2c674629 / REQ-UX-56c8cefc / REQ-UX-68353a4e / REQ-UX-7f289a2c — creation-only page, name default, existing-folder Open, draft sections.
- REQ-UX-efb3e4fb — confirmation before leaving the editor page with unsaved edits.
- REQ-FUNC-4ee03ca8 / REQ-FUNC-ad5868a2 / REQ-FUNC-03b73d56 — bounded documentation scan, selection preview and in-workbench relative folders.
- REQ-UX-5b390823 / REQ-UX-64605f7e / REQ-UX-b96730c7 / REQ-UX-b7002720 / REQ-UX-ff645484 — Documents checklist, creation preselection, Add folder, preview line and Advanced globs.
- REQ-UX-9e7529d5 — missing recent display and removal in the sidebar.
- REQ-FUNC-df70c1c8 / REQ-FUNC-2b3ff3a8 / REQ-UX-ab0d5e61 — move within the pinned group, open keeps place, row menu and keyboard.
- REQ-TEST-6a6c266d — compiled instrumented picker and release exclusion.

## Files

All paths below are relative to05_Software.

- src/libraries/shared/src/workbench.ts and workbench.test.ts — format/warnings/template/merge.
- src/libraries/shared/src/{ipc,events,settings}.ts — channels/events/recent metadata.
- src/libraries/core/src/workbench/{service,ignore,guard}.ts and service.test.ts/guard.test.ts — lifecycle/ownership/saves/completion.
- src/libraries/core/src/workbench/tree.ts and tree.test.ts — confined Docs tree listing, find, text read and properties.
- src/libraries/core/src/{ports,index}.ts — WorkbenchHost and public exports.
- src/libraries/core/package.json and package-lock.json — exact yaml/ulid/ignore pins.
- src/apps/desktop/src/main/index.ts — service wiring, native picker, handlers and shutdown.
- src/apps/desktop/src/preload/bridge.ts and bridge.test.ts — scoped subscriptions.
- src/apps/desktop/src/renderer/api/{ipc,subscriptions}.ts — validated API subscriptions.
- src/apps/desktop/src/renderer/{App.tsx,components/workbench.tsx,components/workbench-create.tsx,components/workbench-config-form.tsx,components/workbench-editor.tsx,components/plugins.tsx,components/error-message.tsx,styles.css,locales/} — overview, creation page, shared form, editor page and translated states.
- src/apps/desktop/src/renderer/mocks/mockApi.ts and mockApi.test.ts — contract fixtures.
- tests/fixtures/workbenches/demo-board/ — fictional board, notes, pinout and boot capture.
- tests/e2e/workbench.spec.ts, tests/e2e/mock.spec.ts, tests/tooling/build-mode.test.ts — acceptance and release hook regression.

## Navigation and project editor

New/Open Workbench and Plugins are primary sidebar actions. The unselected canvas displays the Activity/VERA mark. New Workbench is a creation-only page (components/workbench-create.tsx): Choose folder runs workbench.inspect, fills an empty name with the folder name and shows the shared WorkbenchConfigForm (General, Documents, Instructions, Agent, Tools, Skills, Indexing, Plugins) as a draft; detected documentation folders become the draft include patterns (defaults kept when none or when the scan fails); Documents (components/workbench-documents.tsx) lists detected and literal hand-added folders, previews with a 300 ms debounce and keeps scans uncached; skills are draft checkboxes written to skills.disabled; WorkbenchPlugins lists installed packages with initially empty draft plugins.enabled (existing editor values are retained); Create sends the draft in one workbench.create. A folder that is already a workbench disables Create and offers Open. The page stays mounted while hidden so a draft survives navigation and remounts after a successful create. Opening, recents, missing state and removal live only in the sidebar (entries carry data-missing). Sidebar groups have no search controls. The selected workbench overview presents folder, configuration, dated session count/list and Edit. Loading failures are shown with retry rather than an empty-session claim. Registered workbenches
are pinned first and expose collapsible active session groups. Their order is the stored recents
order: opening keeps a listed workbench's place and new workbenches go first; Move up/Move down in
the row menu, or Alt+Shift+ArrowUp/ArrowDown on a focused row, moves a workbench within its pinned
group through workbench.recent move (shared moveRecentWorkbench).
Non-archived sessions of the active workbench move the same way through session.move; their order
lives in the user settings ([sessions](sessions.md)). Focus returns to the moved row by id. One core workbench
is active; switching uses the session lifecycle. Session list/search/create requests
carry expected workbench identity. The editor page (components/workbench-editor.tsx, in the
main content area, not a dialog) uses the same WorkbenchConfigForm, saves current supported
project fields, plugins.enabled selections and instructions, honors read-only state, and reports partial saves
if settings were written but instructions failed. Escape (outside nested dialogs) and Cancel
return to the overview and restore focus to the control that opened it (or the overview Edit). Leaving through other navigation (sidebar open/edit/close/remove of the active workbench, New session, Settings, New, Plugins, Open) with unsaved edits asks for confirmation exactly once; edits remain unsaved until a save completes, and a save already sent when the engineer confirms leaving may still complete on disk while its result is ignored by the closed editor (REQ-UX-efb3e4fb). The editor is keyed by workbench id, so editing another workbench remounts it with that workbench's values. Explorer accepts registered,
existing ordinary directories without changing the active workbench.

Embeddings config stores supported local model, character chunk size and overlap. The retrieval section stores the agent's search_docs defaults: results (1-20, default 8) and mode (hybrid/keyword/semantic, default hybrid), edited under Indexing on the creation and editor pages (REQ-DATA-4992f40c, REQ-UX-d048dbdd).
The ingest fingerprint rebuilds derived rows after configuration changes, including
reopen; pending old-configuration results are discarded. See document extraction.

### Navigation verification

`05_Software/tests/e2e/workbench-navigation.spec.ts` covers grouped sessions,
pinning and editor behavior; core workbench tests cover durable registry and ownership.

## Unified settings entry

The overview toolbar contains only Edit. Its editor page hosts WORKBENCH.md drafts
under Instructions and the Skills manager under Skills. Skill changes save
independently and project Save preserves their current enabled/disabled choices.
Close is available from the active workbench menu. Settings replaces primary
New/Open/Plugins navigation with settings categories and Back to workbenches.
Nested Skills dialogs are centered; their Escape returns to the editor page.

REQ-UX-0f1a32c4 covers the described tool catalog; REQ-FUNC-37261edc covers saved checkbox availability. Runtime permissions remain independent. `shared/src/tools.ts` defines the ordered catalog consumed by `core/src/tools/registry.ts` and `renderer/components/workbench-tools.tsx`; the editor owns draft/save state. `tests/e2e/workbench-tools.spec.ts` covers native persistence/restart/cancel, YAML and translated descriptions; renderer workbench-tools.test.ts covers read-only controls, and registry/workbench service tests cover catalog parity and known-name validation.

## Chat display preference

New/Edit Workbench → Chat edits `chat.detail` (`verbose`, `normal`, `minimal`, default
`normal`) as part of the same unsaved configuration draft and create/update payload.
Cancel leaves the saved value unchanged; read-only workbenches disable editing. Shared
schema/patch/merge/warnings recognize chat, and main configuration events preserve the
protocol enum while scrubbing extensions. Format remains 1 with no migration logic.
Chat detail controls renderer presentation only; full session history and Activity remain
available. `workbench-chat.test.ts`, shared workbench tests, core service reopen tests,
main event redaction tests and native chat-detail.spec.ts verify these seams.
