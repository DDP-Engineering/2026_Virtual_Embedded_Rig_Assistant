# TASK-2ec633ad - Documentation folder detection and selection

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-4ee03ca8, REQ-FUNC-ad5868a2, REQ-FUNC-03b73d56, REQ-UX-5b390823, REQ-UX-64605f7e, REQ-UX-b96730c7, REQ-UX-b7002720, REQ-UX-ff645484
parent: TASK-581e6591
branch: master
base: 33e72b8c7611d3c36c287ca49dae0b6474338c8f
opened: 2026-10-31

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [ ] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [ ] knowledge pages of changed components current with the reviewed code
- [ ] project and environment context reconciled with the candidate
- [ ] requirements re-read: status, prose, verification, paths and links true
- [ ] manual or inspection verification recorded where applicable
- [ ] explicit review approved, when enabled
- [ ] final `check --strict --run` result logged truthfully after the last edit
- [ ] remaining warnings and pre-existing failures explained
- [ ] `report` appended

## Frame

Problem: Documentation folders are chosen only by typing include/exclude globs; the default `docs/**` silently matches nothing when the folder has no docs/ (OBSERVED: workbench-config-form.tsx documents section; shared workbench.ts default). There is no detection, no folder picker and no way to see what will be indexed (OBSERVED: no scan or preview channel in shared/src/ipc.ts).
Desired outcome: the Documents section lists the workbench's subfolders that hold documents, with counts and size, as checkboxes. Detected folders are preselected when creating. An Add folder button picks a folder inside the workbench. The globs stay editable under Advanced. A preview states how many files and bytes the current selection indexes. This works for New Workbench and for the editor (STATED: "buton selectie sau autodetectie foldere documentatie, indectare"; parent In scope item 2). Documents include txt, doc, ppt, docx and similar (STATED: parent RULING-002).
Actors: the embedded engineer configuring a workbench.
Primary scenario: New Workbench → choose a folder holding datasheets/ (PDF) and notes/ (md, docx) → Documents shows both checked with counts → Create → workbench.yaml docs.include = ["datasheets/**", "notes/**"].
Examples: datasheets/ with 42 PDF (180 MB) shows "42 PDF · 180 MB". A folder holding only .c/.h sources is not offered. Add folder → choosing <root>/manuals/st adds `manuals/st/**`. Choosing a folder outside the workbench is refused with a message.
Counterexamples: folders outside the workbench root are not selectable (STATED: parent RULING-001). Ignored paths (.vera, .git, node_modules, .veraignore rules) are not offered or counted.
In scope: core scan and preview over the workbench folder; a relative-folder check for Add folder; shared schemas and IPC channels; Documents section UI (checklist, Add folder, Advanced globs, preview) in the shared form for both create and edit; mock API; en/ro/de.
Out of scope: extracting or indexing office formats (child 4; office files are counted and labelled as not indexed yet); retrieval settings (child 3); an indexing progress view beyond the existing Docs tab, which already shows index.progress (OBSERVED: components/documents/docs-tab.tsx 45-71).
Constraints: core stays Electron-agnostic and is reached through shared validated IPC; walks never follow symlinks and honour createIgnoreRules (OBSERVED: core workbench/ignore.ts, ingest.ts); scans are bounded in entries and depth; implementation happens on master (STATED: AGENTS.md); no compatibility paths (STATED: AGENTS.md).
Success signals: core tests for scan, preview and the relative-folder check; renderer tests for preselection, toggling, Add folder and preview; native e2e creating a workbench whose YAML lists the detected folders.
Evidence: ingest.ts selection()/watchTargets(); ignore.ts; parent frame and rulings.
Assumptions: none.
Unknowns: the exact entry and depth bounds of a scan (proposed below, not accepted).
Decision-blocking questions: none. Bounds and name hints are implementation limits with a visible truncation flag.
Proposed behaviors: (not accepted) the scan visits at most 20 000 entries and 8 levels and flags truncation; a folder is offered when it holds at least one PDF, office, Markdown, HTML or plain-text document; detected folders are preselected only on the creation page; the preview reuses ingest's own include/exclude matching.
Path and reason: full.

  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | new UI and channels |
  | no new interface or data format | no | scan/preview IPC |
  | no new dependency | yes | picomatch, tinyglobby already in core |
  | an existing requirement already covers the behavior | no | none covers detection |
  | no security or data-handling change | no | directory listing of a chosen folder |

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Detection | bounded, non-writing scan of first-level doc subfolders | REQ-FUNC-4ee03ca8 | core test | scanDocuments in core workbench/documents-scan.ts |
| Preview | count/bytes admitted by ingest matching; office not yet indexed | REQ-FUNC-ad5868a2 | core test | previewDocuments shares ingest selection() |
| Add folder | relative path inside root, DENIED otherwise | REQ-FUNC-03b73d56 | core test | relativeFolder in core |
| Checklist | detected folders as checkboxes bound to '<folder>/**' | REQ-UX-5b390823 | renderer | WorkbenchDocuments component |
| Preselect | creation draft include = detected folders | REQ-UX-64605f7e | renderer, native e2e | WorkbenchCreate after inspect |
| Add folder UI | picker adds pattern or shows error | REQ-UX-b96730c7 | renderer | WorkbenchDocuments + app.chooseFolder + workbench.relativeFolder |
| Preview line | files/size/office pending, live | REQ-UX-b7002720 | renderer, native e2e | WorkbenchDocuments + workbench.previewDocs |
| Advanced | globs under collapsed disclosure | REQ-UX-ff645484 | renderer | details/summary in WorkbenchDocuments |

## Design

**Approach.** Add a core module `workbench/documents-scan.ts` with three pure-filesystem functions behind `WorkbenchService` methods, three strict IPC channels, and a renderer `WorkbenchDocuments` component that replaces the Documents section body of the shared `WorkbenchConfigForm`, so creation and editing behave the same (REQ-UX-5b390823). The preview reuses ingest's own `selection()` (exported as `documentSelection`) and `documentKind()`, so "will be indexed" means exactly what ingest admits (REQ-FUNC-ad5868a2). Rejected: putting the scan inside `workbench.inspect`, because the editor needs the scan for an already-open workbench too.

**Interfaces and data.**
- `scanDocuments(root, ignored)` walks breadth-first with `opendir`, skipping symlinks and `createIgnoreRules(.veraignore)` paths, at most 20000 entries and depth 8. It attributes document files to their first-level folder by scan kind (pdf, office, markdown, html, text = .txt only) and returns `{ folders: [{ path, bytes, kinds }], truncated }`, sorted by path. Folders with no documents are omitted (REQ-FUNC-4ee03ca8).
- `previewDocuments(root, docs, ignored)` uses the same walk and returns `{ files, bytes, officePending, truncated }`. Indexable means the selection matches and `documentKind` is not `other`; office files that match are counted in `officePending`. An invalid glob gives INVALID (REQ-FUNC-ad5868a2).
- `relativeFolder(root, picked)` takes `realpath` of both and returns the posix relative path. The root itself, a path outside the root, or a link inside the root (including one looping back to the root or above) gives DENIED; an alias above the root is accepted (REQ-FUNC-03b73d56).
- Shared: `documentScanSchema` and `documentPreviewSchema` in shared/workbench.ts. Channels `workbench.scanDocs {folder}`, `workbench.previewDocs {folder, include, exclude}` and `workbench.relativeFolder {root, folder}`; main passes them through to the service, outside `sessions.lifecycle`.
- Renderer:
  - `WorkbenchDocuments({ folder, docs, setDocs, disabled })` loads the scan with React Query keyed by folder. The preview is keyed by folder and the trimmed patterns and refetches when they change (REQ-UX-b7002720).
  - The checkbox state is `include.includes(path + "/**")` (REQ-UX-5b390823).
  - Add folder runs `app.chooseFolder`, then `workbench.relativeFolder`, then appends the pattern; errors show through ErrorMessage (REQ-UX-b96730c7).
  - The include/exclude textareas move under `<details>` Advanced (REQ-UX-ff645484).
  - `WorkbenchCreate` calls `workbench.scanDocs` after inspect and, when folders are detected, sets the draft `docs.include` to their patterns (REQ-UX-64605f7e).
- Mock: deterministic scan and preview fixtures plus prefix-based relativeFolder.

**Files and test seams.**
- core: workbench/documents-scan.ts (+ documents-scan.test.ts), workbench/service.ts, knowledge/ingest.ts (export the selection function).
- shared: workbench.ts, ipc.ts (+ workbench-create-ipc.test.ts).
- main: index.ts, ipc-router.test.ts, preload bridge.test.ts.
- renderer: components/workbench-documents.tsx (new), workbench-config-form.tsx, workbench-create.tsx, mocks/mockApi.ts, locales, styles.css; renderer tests in components/session/workspace.test.ts.
- native e2e: tests/e2e/workbench.spec.ts.

**Risks and open decisions.** Large trees: the bounds and truncation flag keep a scan cheap, and the UI says when it was truncated. Privacy: only first-level folder names and counts cross IPC, never file names. The scan reads only directory entries and `lstat` sizes, never file contents.

**Requirement map.** As in the coverage table's last column.

Diagrams: [diagram_TASK-2ec633ad.md](diagram_TASK-2ec633ad.md)

## Log

- 2026-10-31 frame: journal opened
- 2026-10-31 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-10-31 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-31 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-10-31 build: red: npmw npx vitest run core workbench/documents-scan.test.ts exit 1 - module documents-scan.js missing (REQ-FUNC-4ee03ca8, REQ-FUNC-ad5868a2, REQ-FUNC-03b73d56)
- 2026-10-31 build: green: npmw npx vitest run core workbench + knowledge/ingest.test.ts exit 0 (95 passed, 2 skipped pre-existing); typecheck exit 0 (REQ-FUNC-4ee03ca8, REQ-FUNC-ad5868a2, REQ-FUNC-03b73d56)
- 2026-10-31 build: green: renderer workspace.test.ts (3 new documents tests) pass; VERA_TEST=1 test:e2e workbench.spec (4) + workbench-tools pass with real scan/preview (REQ-UX-5b390823, REQ-UX-64605f7e, REQ-UX-b96730c7, REQ-UX-b7002720, REQ-UX-ff645484); focused vitest fails only pre-existing documents/Settings tests and embedding.test (BGE model files absent); lint 0 errors; typecheck 0; i18n ok
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: review round 1 findings: unescaped folder names in generated patterns (parentheses, brackets, leading !); one unreadable/vanished entry aborts the scan and blocks Create; scan/preview cached forever (staleTime Infinity); preview walks per keystroke inside the service queue with eager lstat; relativeFolder denies folders when the root is reached through an alias above it, and '..x' names; Add folder accepts ignored folders; preview counts over-limit files; added-by-hand list shows non-literal patterns and hides none-detected; missing service-level tests (NOT_FOUND, INVALID, .veraignore), Advanced edit, re-check, size, schema tests; e2e tag lacks REQ ids
- 2026-10-31 validate: returned to build - review round 1 findings
- 2026-10-31 build: DEVIATION build: round-1 core fixes (tolerant walk, lazy lstat, size limits, alias-safe relativeFolder, ignored-folder refusal, queue-free scans) were written before their tests; the added tests (alias, partial scan, size limit, service errors/.veraignore, ingest parity, shared escaping/schema) pass but no red run was recorded for them
- 2026-10-31 build: green: npmw npx vitest run core workbench + knowledge/ingest.test.ts exit 0 (100 passed, 2 skipped) incl. ingest parity with 'Manuals (RM0440)'; shared workbench-create-ipc.test.ts 3 pass (REQ-FUNC-4ee03ca8, REQ-FUNC-ad5868a2, REQ-FUNC-03b73d56)
- 2026-10-31 build: red: npmw npx vitest run workspace.test.ts -t 'documentation|Documents keeps' exit 1 - unescaped folder pattern, no none-detected marker, failing scan blocks the creation page (REQ-UX-5b390823, REQ-UX-64605f7e, REQ-UX-ff645484)
- 2026-10-31 build: green: renderer workspace.test.ts documents tests pass (escaped 'Manuals (RM0440)', re-check, Advanced edit, size, failing scan keeps defaults, none-detected marker); vitest renderer+libraries only 2 pre-existing failures; embedding tests pass now that the user-approved BGE model is prepared; VERA_TEST=1 native workbench/workbench-navigation(browser)/workbench-tools pass; lint 0 errors; typecheck 0; i18n ok (REQ-UX-5b390823, REQ-UX-64605f7e, REQ-UX-ff645484, REQ-UX-b7002720, REQ-UX-b96730c7)
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: review round 2 findings: relativeFolder accepts a link inside the root whose name matches the target (lstat checked realpath segments); Documents keeps per-folder state across folder changes (needs key); unchecked YAML-listed/default rows disappear and lose focus; rows mislabelled and remounted while the scan is pending; '|' not escaped; requirement prose for escaped patterns/undetected rows; linked_tests gaps; unreadable-entry test POSIX-only; exclude edit untested; truncated message wording
- 2026-10-31 validate: returned to build - review round 2 findings
- 2026-10-31 build: red: npmw npx vitest run documents-scan/workbench-create-ipc/workspace -t 'link inside|escapes literal|Documents keeps|preselects detected' exit 1 - inner link accepted, '|' unescaped, unchecked listed row disappears (REQ-FUNC-03b73d56, REQ-UX-5b390823); exclude-edit coverage test passes already (REQ-UX-ff645484)
- 2026-10-31 build: verification limitation: the unreadable-entry case of REQ-FUNC-4ee03ca8/REQ-FUNC-ad5868a2 is exercised only on POSIX (documents-scan.test.ts skips on win32, where denying a directory needs ACL changes); Windows relies on the same skippable-code path, covered by review only
- 2026-10-31 build: green: vitest core workbench + ingest + shared + renderer only 2 pre-existing failures (new inner-link, '|' escape, listed-row persistence, exclude-edit tests pass); VERA_TEST=1 e2e workbench.spec (4) + workbench-navigation pass; lint 0 errors; typecheck 0; i18n ok (REQ-FUNC-03b73d56, REQ-UX-5b390823, REQ-UX-ff645484)
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: design diagrams drawn (structure, sequence; state not drawn - no lifecycle) in diagram_TASK-2ec633ad.md after the user asked for diagrams; they were omitted at design without a logged deviation
- 2026-10-31 validate: review round 3: spec - a link inside the workbench pointing back at the root or above (root/a/loop -> root) is still accepted; nit linked_tests/affected_paths; quality approved (optional: sort added-by-hand rows)
- 2026-10-31 validate: returned to build - review round 3 spec finding
- 2026-10-31 build: red: npmw npx vitest run documents-scan.test.ts -t 'points back' exit 1 - loop link to the root accepted (REQ-FUNC-03b73d56)
- 2026-10-31 build: green: vitest core/shared/renderer only 2 pre-existing failures (loop-link and alias tests pass); VERA_TEST=1 e2e workbench.spec pass; lint 0 errors; typecheck 0 (REQ-FUNC-03b73d56, REQ-UX-5b390823)
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: requirement prose/verification for REQ-FUNC-03b73d56, the Design line and the workbench knowledge page aligned with the approved code (documentation-only after round-4 approval)
- 2026-10-31 validate: final: python .agentic/aegis.py check --task TASK-2ec633ad --strict --run exit 0; lint, typecheck, i18n ok; focused vitest and VERA_TEST=1 e2e logged above; remaining warnings are pre-existing repository records; limitation: unreadable-entry case verified on POSIX only
- 2026-10-31 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-2ec633ad.md
changed: documentation folder detection: core scan/preview/relativeFolder, IPC, WorkbenchDocuments UI, creation preselect, escaped patterns
evidence: aegis check --strict --run exit 0; vitest focused only pre-existing failures; VERA_TEST=1 e2e workbench/workbench-navigation/workbench-tools pass
issues: unreadable-entry case verified on POSIX only; 2 pre-existing unit failures unrelated
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-10-31)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-4ee03ca8 - Scan a folder for documentation subfolders
  - REQ-FUNC-ad5868a2 - Preview the documents a selection indexes
  - REQ-FUNC-03b73d56 - Relate a chosen documentation folder to the workbench
  - REQ-UX-5b390823 - List detected documentation folders as checkboxes
  - REQ-UX-64605f7e - Preselect detected documentation folders on creation
  - REQ-UX-b96730c7 - Add a documentation folder with the folder picker
  - REQ-UX-b7002720 - Show what the documentation selection will index
  - REQ-UX-ff645484 - Keep documentation globs editable under Advanced
- deviations: 1 recorded
  - build: round-1 core fixes (tolerant walk, lazy lstat, size limits, alias-safe relativeFolder, ignored-folder refusal, queue-free scans) were written before their tests; the added tests (alias, partial scan, size limit, service errors/.veraignore, ingest parity, shared escaping/schema) pass but no red run was recorded for them
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 33e72b8: 70 file(s) changed, 3664 line(s) added
- checks: errors=0 warnings=69 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
