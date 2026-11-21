# Workbench lifecycle

## Routing

Select for .vera/workbench.yaml, .vera/WORKBENCH.md, wb_ identity, create/open/close, runtime lock,
recent folders, config/pinned saves, ignore rules and path completion. Start with
05_Software/src/libraries/core/src/workbench/service.ts and src/libraries/shared/src/workbench.ts.
Focused tests: core workbench/service.test.ts and shared workbench.test.ts. Native/UI tests:
tests/e2e/workbench.spec.ts and mock.spec.ts. [Application data](app-data.md) owns settings persistence;
[IPC boundary](ipc-boundary.md) owns authorization/transport; [renderer foundation](renderer-foundation.md)
owns the shell, appearance, language and layout; [workbench editor](workbench-editor.md) owns the
creation page, the editor page and sidebar navigation.
Tool path confinement, read/list/glob/grep and worker deadlines route to [File tools](file-tools.md).
The current database schema, initialization and row repositories route to [Workbench storage](workbench-storage.md).

[Verification fixtures](demo-onboarding.md) routes the fictional board corpus and PDF sources under tests/fixtures, used by isolated tests and evaluation/smoke harnesses.

## Purpose and boundaries

Core owns project metadata under .vera: workbench.yaml, WORKBENCH.md, optional .veraignore, skills and runtime state. The selected folder stays the root for user documents and sources. Opening requires .vera/workbench.yaml; root files are ordinary content and are never migrated.

Core owns the folder lifecycle, identity, YAML validation, runtime lock, pinned context and common
ignore/completion policy. Main supplies process liveness, version, clock, token, settings and atomic
file/event ports. Renderer displays Welcome, pinned editor and session workbench switching through validated IPC; config.get adds optional folder/readOnly metadata for reload. Mock
mode offers empty, missing, read-only and warning fixtures. The creation page, the editor page and the
sidebar are described in [workbench editor](workbench-editor.md).

## Public interface

- The live workbench snapshot includes a process-local `indexLease` for its activation. Status
  requests validate that identifier with the workbench id before reading the current Ingester.

- statEntry retains confined physical metadata and supplies a compact rendered capability for recognized document formats from a direct indexed-record lookup: current size/mtime, extraction presence (or needs-OCR PDF pages), status and ignore rules. It reads no complete file and the viewer still verifies source content when opening. [File viewing modes](document-viewer-file-modes.md) owns the mode defaults.
- Optional strict `privacy.mask` accepts display/runs/agent/exports choices default/on/off. Omitted
  areas follow live app defaults through core settings/masking.ts. Unknown privacy keys, areas and
  values reject INVALID with errors.CONFIG_INVALID and YAML path/line on open. Partial area saves
  preserve other choices, extension fields, allowed command prefixes and additional folders at
  format1. All four consumers follow the resolved policy.

- `additional_folders` is a bounded unique list of ordinary absolute paths in format1, default empty. General stages native chooser selections and removals until Save; Cancel discards them and read-only controls cannot mutate them. WorkbenchService retains selected canonical paths by opaque SHA256 identity and applies additions/removals atomically against the current host config, rejecting stale IDs and lists above64 with typed errors. Complete list identities carry scrubbed labels; masked paths are omitted from descriptive renderer config, while unrelated saves never echo or replace grants. The overview lists complete saved identities. Host live config grants only ordinary read/list/glob/grep/write/edit and run_command cwd; indexing, storage, artifacts and generated outputs keep the main root. Tests: service/schema tests, core additional-folder tool tests, native `tests/e2e/additional-folders.spec.ts`.

- `agent.allowed_commands` is a bounded unique list of conservative literal prefixes in format1. User approval IPC routes explicit prefix actions to async SessionService.allowCommandApproval (ordinary decideApproval stays synchronous), validates the pending exact command, persists a chosen matching eligible prefix through WorkbenchService.allowCommandPrefix, then rechecks the pending decision. Failed disk writes retain the pending approval. Edit workbench > Agent loads complete authoritative grant identities with masked labels and removes selected IDs with normal Save/Cancel. Config update applies removal IDs atomically against current exact grants, rejecting stale/mismatched IDs. Unrelated Save preserves all grants rather than echoing sanitized event strings. Shared command-prefix schemas reject unsupported/destructive grants; agent tools cannot add them. ApprovalGate uses the live workbench snapshot at consumption. Tests: tests/e2e/command-prefixes.spec.ts, workbench/service.test.ts.

- WorkbenchService recognizes shared built-ins and runtime delegation tools by default when reporting unknown disabled names. Injected host catalogs retain their existing authority.

- plugins.enabled (default []) is the opt-in list of [plugins](plugins-store.md) for this workbench; togglePlugin writes it
  on the write queue like toggleSkill, enabledPlugins reads the current config, and ids that are not installed under
  <userData>/plugins are UNKNOWN_NAME warnings. The config event sanitizer scrubs it like skills.disabled.

- skillCatalog/listSkills/openSkill/saveSkill/toggleSkill admit [skills](skills.md)
  operations against current workbench ID, folder, database lifetime and token. Source
  selects project/.vera or the host userData root. Reads serialize with lifecycle; writes
  use shared admission, exclusive creation and original SHA256 before publication.

- `readBytes(workbenchId,path,offset,length)` serializes a bounded physical byte read with lifecycle,
  using only the active owning folder even in Bypass with additional-folder grants. Its raw Buffer
  includes a fixed64KiB context per side and remains host-only; [File viewing modes](document-viewer-file-modes.md)
  owns the strict IPC, encoded masking and exact byte protocol. Missing owners fail CONFLICT,
  closed workbenches NOT_FOUND; ignored/binary files are valid. Tests: read-bytes.test.ts and the
  focused service test.

- listFolder/findFiles/readText/statEntry(workbenchId, ...) run the Docs tree reads of core
  workbench/tree.ts on the active workbench folder (CONFLICT otherwise). They need no storage,
  so read-only snapshots browse too; the [Docs panel](document-viewer-docs-panel.md) owns their contract.

- WorkbenchService owns one writable background Ingester and reindexDocuments;
  close/replacement stops and drains ingest before lock/storage release. Read-only
  snapshots run no ingest. `documentIndexPhase(id, db?)` refuses a different
  workbench ID or supplied database lease. [Knowledge ingest](knowledge-ingest.md)
  owns selection, hashing, metadata/status events and derived invalidation.

- WorkbenchService.inspect(folder) returns the canonical folder, its final segment as suggested name,
  whether .vera/workbench.yaml exists, existing .vera/WORKBENCH.md text or null and the workbench/user
  skills for that folder, without writing. IPC `workbench.inspect`.
- WorkbenchService.scanDocuments(folder), previewDocuments(folder, docs) and relativeFolder(root, picked)
  (core workbench/documents-scan.ts; IPC workbench.scanDocs/previewDocs/relativeFolder). The scan walks at most
  20000 entries and 8 levels without links or ignored paths and returns first-level folders holding PDF, office,
  Markdown, HTML or .txt documents with per-kind counts and bytes (names and counts only). The preview runs
  the indexer's selectDocuments() itself (ignore policy, kinds, ordinary files, maxFileMB), so its files/bytes equal
  the indexed volume; its only bound is PREVIEW_TIME_LIMIT_MS (5 s, `truncated` exactly when it stopped the count).
  It returns the count guard (documentGuard over docs.maxFiles; the active workbench's own folder applies its Index
  anyway approval). Modern office files count as documents and only matched legacy .doc/.ppt/.xls and RTF files count
  as not indexed (officePending, via selectDocuments' `unindexed` hook); `~$` Office owner files are neither.
  relativeFolder returns a forward-slash path inside the root (an alias above the root is accepted) and DENIED for the root, outside, ignored or linked folders, including links looping back to the root. Generated include patterns use documentFolderPattern() (bracket-escaped, leading '!' as @(!)); documentPatternFolder() reads literal ones back.
- WorkbenchService.create(existingAbsoluteFolder,name,{config?,instructions?}), open(folder), close().
  create merges the optional patch (name excluded) over defaults and validates it before any write
  (INVALID leaves no workbench.yaml); WORKBENCH.md gets the given instructions or the template, and an
  existing WORKBENCH.md is kept. The CLI calls the two-argument form. Snapshots contain
  canonical folder/config/readOnly/warnings; invalid YAML reports line/column, invalid configuration
  reports path/line, and any format other than 1 reports CONFIG_INVALID at path format before runtime writes.
- Core-only getSnapshot supplies a detached current snapshot and assertSessionWritable immediately checks ordinary lock paths plus the owned pid/token before session database changes. Main session lifecycle drains active turns before switches/close.
- Core-only getWriteQueue supplies the shared queue for application config/pinned saves and every session write. File saves validate ownership/current state inside their queue callback; close and replacement drain admitted writes before storage disposal.
- Core-only getDatabase supplies owned writable SQLite or a live-owner read-only snapshot. Open acquires
  the lock (or falls back to read-only), then openDb checks the schema before any database or recents
  write; an INVALID/CONFLICT database releases the newly taken lock. Failed replacement preparation closes its handle
  and releases the new token while retaining the previous workbench. Close/successful switches dispose handles.
  Closing an owned workbench rejects redirected runtime directories before draining the ingester.
  Owned release checkpoints under the token guard before unlink; failed unlink retains usable storage.
  Disposal after release or ownership loss preserves source bytes through writer-first/read-only-last close.
- Config get/update deep-merges known mutable fields with current disk data, retains unknown keys,
  and fixes id/format. Pinned get/update saves full UTF8 text; oversized counts bytes above16384.
- Registry retrieval/removal/pinning retains application settings entries until explicit removal; folder existence derives missing state.
  Reopen refreshes known metadata.
- files(query) returns up to50 slash-separated relative ordinary-file paths, case-insensitive substring
  matches. createIgnoreRules applies case-insensitive permanent .vera/.git/node_modules segments before project-relative rules from .vera/.veraignore;
  given createGitignoreRules (root and nested .gitignore, deepest decisive level first, read lazily), it decides each folder above an entry, then the entry:
  permanent, then .veraignore (ignored wins; a negation that re-includes a folder .gitignore drops re-includes its contents), then .gitignore
  (REQ-FUNC-2336bfd2). Shared docs.gitignore (default true, format 1) switches the .gitignore part for indexing, the documentation
  scan/preview (workbench.scanDocs/previewDocs carry `gitignore`) and the Files tab; the agent PathGuard, files(query) and
  relativeFolder keep .veraignore only (REQ-FUNC-eade110e, REQ-UX-adae0c2f).
- Shared docs.maxFileMB (optional positive MB, 1 MB = 1 MiB) and docs.maxFiles (positive integer,
  default 10000) stay at format 1; a patch maxFileMB null removes it, and invalid values fail
  workbenchSchema/workbenchPatchSchema (REQ-DATA-9fd427f1, REQ-DATA-3bae7e69). maxFiles is stored
  and validated only; nothing enforces it yet. Documents & RAG shows "Maximum file size (MB)" and
  "Maximum indexed files" as text fields parsed in components/workbench-documents.tsx (empty size =
  unset; invalid text puts NaN in the draft, marks the field with an alert, and workbenchDocsSchema
  keeps editor Save and New Workbench Create disabled) (REQ-UX-b189ed46, REQ-UX-4c2257b2). The
  documentation preview still applies only the fixed size limits.
- Shared workbenchSchema/configWarnings/mergeWorkbench/workbenchTemplate supply format1 defaults,
  passthrough extensions, unresolved disabled-name warnings and the specified English pinned template.
- Native app.chooseFolder uses Electron dialog; instrumented compilation accepts VERA_TEST_DIALOG_PATH.
  Release emission eliminates the override. All lifecycle/config/pinned/recent/files channels are strict.
- WorkbenchEvent opened/closed/config.changed envelopes filter by wb_ id and clean up independently.

- readDocuments/listDocuments/searchDocuments/openDocument serialize scoped reads against close/switch, check exact active identity and current writable ownership, and expose protected read-only snapshots. Docs keyword hits verify current source/extraction bounds once per path and reject changed index epochs. Optional reindexDocuments(workbenchId) rejects foreign identity before admitting ingest. [Document viewer](document-viewer.md) owns content resolution.
- Embeddings config validates its local model against the shared registry (BGE Small EN v1.5 by default, E5 Small also accepted) and stores character chunk size and overlap. An unknown model ID makes the configuration invalid. The retrieval section stores the agent's search_docs defaults: results (1-20, default 8) and mode (hybrid/keyword/semantic, default hybrid), edited under Indexing on the creation and editor pages (REQ-DATA-4992f40c, REQ-UX-d048dbdd). The ingest fingerprint rebuilds derived rows after configuration changes, including reopen; pending old-configuration results are discarded. See [document extraction](document-extraction.md).
- `chat.detail` (`verbose`, `normal`, `minimal`, default `normal`) stays at format 1: shared schema/patch/merge/warnings recognize chat, and main configuration events preserve the protocol enum while scrubbing extensions. It controls renderer presentation only ([Chat UI](chat-ui.md)); full session history remains available. Tests: shared workbench tests, core service reopen tests, main event redaction tests.

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
- UNC paths warn that network shares are unsupported. .vera/WORKBENCH.md text is user data.

## Change map

| Change requested | Start with | Focused verification |
|---|---|---|
| Format/extensions/validation | shared workbench.ts, core parseConfig | shared/core workbench tests |
| Lifecycle/ownership/failure | core WorkbenchService | service.test.ts, native live lock acceptance |
| Recents/order | WorkbenchService, SettingsService, shared ordering.ts, workbench-navigation.tsx | service/settings/ordering tests, workspace.test.ts, deleted-recent and sidebar-order E2E |
| Ignore/completion | createIgnoreRules, WorkbenchService.files | confined completion tests |
| Dialog instrumentation | main/index.ts | actual build-mode.test.ts, instrumented native picker |

## Key behaviors

- REQ-DATA-85139c56 — format 1 validation, JSON-compatible extensions and location errors.
- REQ-FUNC-adf92ecb — non-destructive creation and shared template.
- REQ-REL-bcb6fb23 — live/stale ownership and token-aware close.
- REQ-DATA-d7ced6a1 — confirmed atomic config/pinned saves and extension retention.
- REQ-FUNC-bfd14725 — confined bounded ignored-path completion.
- REQ-DATA-dfbfac7c — persisted recent lifecycle and derived missing state.
- REQ-FUNC-81ce68df — non-writing folder inspection.
- REQ-FUNC-3815bacc / REQ-FUNC-38107da8 — create with initial configuration; invalid draft rejected before writes.
- REQ-FUNC-4ee03ca8 / REQ-FUNC-ad5868a2 / REQ-FUNC-817bbf83 / REQ-FUNC-03b73d56 — bounded documentation scan, selection preview with its count guard and in-workbench relative folders.
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
- src/apps/desktop/src/renderer/mocks/mockApi.ts and mockApi.test.ts — contract fixtures.
- tests/fixtures/workbenches/demo-board/ — fictional board, notes, pinout and boot capture.
- tests/e2e/workbench.spec.ts, tests/e2e/mock.spec.ts, tests/tooling/build-mode.test.ts — acceptance and release hook regression.
