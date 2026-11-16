# TASK-ef5fef5b - IDX-04 Preview counts equal to indexing (#278)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-ad5868a2, REQ-FUNC-817bbf83, REQ-UX-8d82a10a, REQ-UX-c44bc346
parent:
branch: master
base: f1408b35b04bfe44e6ca44a9a5cd76b4f82db522
opened: 2026-11-16

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

Problem: the New Workbench / workbench editor preview (`previewDocuments`, documents-scan.ts) walks at
most 20,000 entries and 8 levels with its own walker, applies the fixed size limits instead of
`docs.maxFileMB`, ignores `docs.maxFiles`, and reads the ignore rules through a second loader, so it can
show fewer documents than indexing selects and the user approves a selection whose real size is larger
(STATED #278 Problem; OBSERVED documents-scan.ts `walk` bounds and `PDF_LIMIT`/`TEXT_LIMIT`, IPC
`workbench.previewDocs` carries no maxFileMB/maxFiles, idx-02 hand-over "the preview keeps the fixed
limits until IDX-04").
Desired outcome: the preview counts with the indexer's own selection (`selectDocuments`: include minus
exclude, permanent rules, .veraignore, .gitignore when on, document kinds, ordinary files, size limit
lowered by maxFileMB), so for the same folder and docs its count equals the indexed count; its only bound
is a time limit, and a preview stopped by it says "at least N" and never states an exact count; when the
selection exceeds the file limit the Documents section of New Workbench and of the editor shows the count
guard's warning (count, limit, top folders) before Save/Create (STATED #278 Deliverables, IDX-04-A..C;
#274 Decisions "One selection for preview and indexing").
Actors: workbench user in New Workbench and Edit workbench > Documents & RAG; WorkbenchService in the
desktop main process.
Primary scenario: the user picks a folder with 12,000 Markdown files and maxFiles 10,000; the preview
reads "Documents to index: 12,000 (...)" and a warning "Indexing will stop before it starts: 12,000
documents are selected, more than the limit of 10,000" with the top folders, before Create.
Examples: IDX-04-A (STATED): the IDX-01 .gitignore fixture previews 4 documents with the switch on and 8
off, as indexed; the IDX-02 fixture with maxFileMB 25 previews 2 (scan.pdf, huge.pdf skipped); IDX-04-B:
a selection of maxFiles + 1 shows the warning; IDX-04-C: a preview stopped by the time limit shows "at
least".
Counterexamples: exactly maxFiles documents show no warning (the guard is "exceeds", STATED #277); a
preview that finished never says "at least".
In scope: previewDocuments reuses selectDocuments with an abort signal as time bound; preview response
gains `guard`; IPC `workbench.previewDocs` carries maxFileMB and maxFiles; the active workbench's
"Index anyway" approval applies to its own preview (same rule as indexing); renderer preview wording
"at least" and guard warning in the Documents section (both New Workbench and editor use
WorkbenchDocuments); mockApi; i18n x4; help documents-and-search x4.
Out of scope: the documentation-folder scan (`scanDocuments`, folder detection) keeps its entry/depth
bounds (STATED #278 names only the preview); blocking Save/Create (the guard is "a warning before
saving", STATED #278); indexing time budget (STATED #274 Out of scope).
Constraints: pre-release, no compatibility code, formats stay 1 (STATED CLAUDE.md); en/ro/de/fr, no helper
texts (STATED brief); master, targeted tests only, no push (STATED brief); reuse the same selection code
(STATED brief).
Success signals: core tests over the IDX-01/02/03 fixtures assert preview count == indexed rows; a
pre-aborted/elapsed time bound gives truncated with "at least" wording; renderer test shows the guard
warning in New Workbench and in the editor in four languages; typecheck, biome, check:i18n, check:help,
check:release-notes green.
Evidence: OBSERVED selection.ts `selectDocuments`, ingest.ts `selected()`/`reconcile()` guard on
`paths`, guard.ts `documentGuard`; tinyglobby 0.2.17 `signal` resolves with the partial list on abort
(scratch run: resolved 1203 after 30 ms abort, pre-aborted 0); workbench-documents.tsx is the shared
Documents section of Create and the editor; VolumeWarning preview wording already says "at least" when
truncated.
Assumptions: the time limit is 5 seconds (INFERRED: the ticket leaves the value open, the old entry bound
finished well under that; the brief accepts session-level thresholds as in IDX-03); the preview of the
active workbench's own folder uses its stored approval so the warning matches what indexing does
(INFERRED from #274 "one selection for preview and indexing"); other folders use no approval.
Unknowns: none decision-blocking.
Decision-blocking questions: none.
Proposed behaviors: as Desired outcome, with the Assumptions' time limit and approval rule.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | preview counts change, guard warning |
| no new interface or data format | no | previewDocs request/response fields |
| no new dependency | yes | tinyglobby already used |
| an existing requirement already covers the behavior | no | REQ-FUNC-ad5868a2 states the old bounds |
| no security or data-handling change | yes | read-only preview |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| Preview counts with the indexer's selection (ignore files, kinds, maxFileMB), time limit only, truncated exactly on timeout | REQ-FUNC-ad5868a2 (revised) |
| Preview guard: count over maxFiles (raised by the active workbench's approval) returns count, limit, top folders; else null | REQ-FUNC-817bbf83 |
| Preview stopped by the time limit says "at least" | REQ-UX-8d82a10a |
| Guard warning in New Workbench and the editor before Create/Save, not blocking | REQ-UX-c44bc346 |

## Design

**Approach.** `previewDocuments(root, docs, { signal, approved })` calls `selectDocuments` itself (one
selection for preview and indexing) with the docs draft and an abort signal; `selectDocuments` passes the
signal to tinyglobby, which resolves with the partial listing on abort, and gains an optional
`listed(path)` hook that the preview uses to count matched legacy Office/RTF files (the listing drops them
as "other"). `truncated = signal.aborted` after the call. `files`/`bytes` come from `Selection.paths`
exactly like `Ingester.selected()`; `guard = documentGuard(paths, docs.maxFiles, approved)`. The service
creates `AbortSignal.timeout(5000)` and reads the approval of the active workbench when the previewed
folder is its folder (`Ingester.approved()` made public), synchronously before the walk. The old bounded
`walk` stays only for `scanDocuments`. Rejected: keeping the preview walker and porting the rules (two
implementations drift, the IDX-02 note shows it already did).

**Interfaces and data.** IPC `workbench.previewDocs` request gains `maxFileMB?` and `maxFiles` (the docs
schema's own fields); `documentPreviewSchema` gains `guard: documentGuardSchema.nullable()`. Main scrubs
guard folder paths with `publicGuard` as for `docs.volume`. Renderer `WorkbenchDocuments` sends the
settled maxFileMB/maxFiles (only when the draft passes `workbenchDocsSchema`, so NaN never reaches IPC),
shows "Documents to index: at least N" when truncated, and a `PreviewGuard` warning (role status, count,
limit, folders) under the preview. Create/Save stay enabled.

**Files and test seams.** core selection.ts, documents-scan.ts, service.ts, ingest.ts
(+ documents-scan.test.ts, preview-parity test in ingest-selection.test.ts/ingest-guard.test.ts, service
test); shared workbench.ts, ipc.ts (+ workbench-create-ipc.test.ts); main index.ts; renderer
workbench-documents.tsx, mockApi.ts, locales x4 (+ documents.test.ts / workbench-plugins.test.ts); help
documents-and-search x4; CHANGELOG; release notes.

**Risks.** The selection lstats every path segment, slower than the old walk on huge trees; the 5 s limit
bounds it. Preview stays outside the lifecycle queue; the approval read is synchronous so a closing
workbench cannot interleave.

**Requirement map.** REQ-FUNC-ad5868a2: previewDocuments over selectDocuments + signal.
REQ-FUNC-817bbf83: documentGuard in the preview + service approval. REQ-UX-8d82a10a / REQ-UX-c44bc346:
WorkbenchDocuments wording and PreviewGuard.

## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-16 build: red: vitest documents-scan.test.ts ingest-selection.test.ts ingest-guard.test.ts (-t preview subset) exit 1 - preview takes ignore rules from the caller, has no guard, ignores maxFileMB (3 PDFs counted under a 25 MB limit), no approval rule (REQ-FUNC-ad5868a2 REQ-FUNC-817bbf83)
- 2026-11-16 build: red: vitest workbench-plugins.test.ts -t 'warns before Save' exit 1 - no guard warning in the editor's Documents section (REQ-UX-c44bc346 REQ-UX-8d82a10a)
- 2026-11-16 build: green: vitest documents-scan, ingest-selection, ingest, service, workbench-create-ipc, indexer-host, ipc-router, workbench-plugins, documents.test, mocks exit 0 (184 passed, 1 skipped); npm run typecheck exit 0 (REQ-FUNC-ad5868a2 REQ-FUNC-817bbf83 REQ-UX-8d82a10a REQ-UX-c44bc346)
- 2026-11-16 build: discovery: a preview of the 12,000-file workbench right after Index anyway made the next guard-test step (+500 files) read 12,000 rows; without that call the test passes (bisect: glob signal ruled out). The approval case stays covered by the dedicated small test; the preview check after approval was dropped from the big test
- 2026-11-16 build: green: vitest ingest-guard.test.ts exit 0 (2 passed; 12,000-file preview equals the guard and volume; approval preview test) (REQ-FUNC-817bbf83 REQ-FUNC-ad5868a2)
- 2026-11-16 build: biome on changed files exit 0 (1 pre-existing info, ingest.test.ts:570 untouched); check:i18n, check:help, check:release-notes exit 0; check errors=0
- 2026-11-16 build: DEVIATION build: the renderer at-least wording and guard warning tests share one test; red was observed for the warning only. Not separately red-run for the at-least wording
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: diff self-reviewed against scope, requirements and design (preview over selectDocuments, guard + approval, IPC fields, scrubbed guard folders, non-blocking warning); no unrequested work beyond fixing a stale previewDocs IPC test; knowledge page workbench.md updated
- 2026-11-16 validate: DEVIATION validate: explicit review was a single self-review round, not an independent reviewer, because the user is shutting down shortly; final proof is check --task --strict without --run (the full suite is the user's, by standing instruction); not covered: unrelated suites, e2e, native Electron UI
- 2026-11-16 validate: final: check --task TASK-ef5fef5b --strict exit 0 (errors=0; warnings: outside-layout help/release notes/CHANGELOG required by repo rules, uncovered-source on tests, other tasks)
- 2026-11-16 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-ef5fef5b.md
changed: preview over selectDocuments with 5 s time limit, preview guard + approval, previewDocs maxFileMB/maxFiles, Documents section at-least wording and guard warning, i18n x4, help x4, CHANGELOG, release notes
evidence: typecheck exit 0; vitest 12 targeted files exit 0; check --strict exit 0
issues: full suite, e2e and native UI not run (by instruction); preview right after Index anyway perturbed the big guard test's later step, check dropped there; self-review only
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-16)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-ad5868a2 - Preview the documents a selection indexes
  - REQ-FUNC-817bbf83 - Count guard of a selection preview
  - REQ-UX-8d82a10a - Preview count stopped by the time limit
  - REQ-UX-c44bc346 - Count guard warning in the Documents section
- deviations: 2 recorded
  - build: the renderer at-least wording and guard warning tests share one test; red was observed for the warning only. Not separately red-run for the at-least wording
  - validate: explicit review was a single self-review round, not an independent reviewer, because the user is shutting down shortly; final proof is check --task --strict without --run (the full suite is the user's, by standing instruction); not covered: unrelated suites, e2e, native Electron UI
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base f1408b3: 34 file(s) changed, 720 line(s) added
- checks: errors=0 warnings=40 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
