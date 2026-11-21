# TASK-0dff4c83 - ADV-04 Advanced settings for documents

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-133f57ee, REQ-DATA-9fd427f1, REQ-DATA-3bae7e69, REQ-UX-d64e808a, REQ-FUNC-a93d863d, REQ-FUNC-486d6a86, REQ-FUNC-4b36dede, REQ-FUNC-aa35b135, REQ-FUNC-2fba7b9c, REQ-FUNC-bfbd70b6, REQ-FUNC-902313e0, REQ-DATA-96ef3dd6, REQ-DATA-33a90ef2, REQ-UX-9ea9184f, REQ-UX-504e0d6d
parent:
branch: master
base: 776549140f145be0ce85904f0298b829564447bb
opened: 2026-11-21

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

Problem: Document indexing limits are fixed: PDF and Office files above 100 MiB and text above 20 MiB are never
indexed (kinds.ts PDF_LIMIT/TEXT_LIMIT; docs.maxFileMB can only lower them, and lowers text too), the volume
warning trips at 2000 files / 2 GiB (shared documents.ts), the Docs panel lists at most 20 hits
(workbench/service.ts k: 20), extraction gets a 120 s base deadline (worker-host.ts, fixed when the indexer
process starts), the indexing pause is 1000 ms (ingest.ts request) and the embedding worker retires after 60 s
idle (embedding.ts). OBSERVED, seam map this session.
Desired outcome: The ADV-04 rows of 00_Planning/advanced-settings.md are user settings with the plan's ranges and
defaults, and docs.maxFileMB raises or lowers the PDF/Office limit. STATED (user: continue the whole
implementation; plan ADV-04 package and rows).
Actors: the engineer; the ingest service in main; the indexer utility process; the Docs panel; the workbench
editor; downloads.
Primary scenario: The engineer sets Maximum file size 300 MB on a workbench with a 250 MB reference manual; the
manual is indexed, opens in the viewer, and read_doc and citations work on it.
Examples:
- Maximum text file size 60 MiB: a 40 MiB CSV export is indexed instead of being skipped as too large.
- Docs panel results 60: a search with 45 hits lists 45.
- Document extraction time limit 900 s: a large scanned PDF is not cut at 2 minutes.
- Volume warning at 10000 files: a 5000-file documentation set shows no warning.
Counterexamples:
- OFFICE_LIMITS (zip entries, unpacked size), PDF page limits and worker heap stay fixed (plan "Not exposed").
- docs.maxFileMB no longer lowers the text limit; text has its own setting (plan rows are separate).
In scope: docs.maxFileMB as the one PDF/Office size value (positive, at most 500, default 100 when unset);
Advanced keys textFileMB (workbench, 1-100 MiB, 20, applies Reindex), docVolumeFiles (500-100000, 2000) and
docVolumeMB (512-51200 MiB, 2048) and docsResults (10-100, 20) at application and workbench, extractionTimeout
(application, 30-1800 s, 120, New), indexingPause (application, 250-10000 ms, 1000, Live), embeddingIdle
(application, 10-600 s, 60, New); the indexer process receives the application values with each message;
inspect, viewer, read_doc and citation checks accept documents up to the largest allowed sizes; labels, locales,
help, requirements, knowledge pages.
Out of scope: the Docs panel volume warning required by REQ-UX-05c5b146, which the panel does not render today
(pre-existing gap, OBSERVED docs-tab.tsx); CLI flags (no session keys); OFFICE_LIMITS and the 128 MiB extraction
cache; ADV-05 desktop rows.
Constraints: on master (default branch, user); pre-release, no migrations (user); targeted tests only (user);
decide open points with my recommendation, no questions (user, 2026-11-21).
Success signals: each setting changes the behavior its row names; a document indexed under a raised limit can
be opened, read and cited; raising a limit causes no reindex loop.
Evidence: plan rows (application: Embedding worker idle time, Document extraction time limit, Indexing pause;
workbench: Maximum PDF / Office size, Maximum text file size, Document volume warning, Docs panel results);
seam map: kinds.ts:6-32, selection.ts:176, ingest.ts:303-307/580, inspect.ts:41, processor.ts:171,
documents-scan.ts:152, shared/documents.ts:258, volume-warning.tsx:17, workbench/service.ts:473,
search.ts:33-39, ipc.ts:531, worker-host.ts:60-106, document-services.ts:11-18, embedding.ts:99-102,
indexer-host.ts:60-86, shared/workbench.ts:49-57.
Assumptions: INFERRED (technical rulings, user asked for recommendations) - text maximum 100 MiB, below the 128
MiB extraction cache, instead of the plan's 200; docs.maxFileMB keeps decimals (existing contract) with a 500
cap; volume size in MiB (512-51200 = 0.5-50 GiB); text size workbench-only because an application change starts
no reconcile; the preview applies the saved text size (the preview request carries only docs).
Unknowns: none blocking.
Decision-blocking questions: none (user: use my recommendations).
Proposed behaviors: (accepted on autopilot)
- Selection and ingest apply the configured sizes; inspect, viewer, read_doc and citations use the largest
  allowed sizes, so a selected document never fails those checks and nothing reindexes in a loop.
- The extraction time limit and embedding idle time reach the indexer process with every message and apply
  to the next extraction or idle period; downloads parse PDFs with the session's extraction time limit.

## Requirement coverage

| Behavior | Requirement | Source |
|---|---|---|
| PDF/Office and text size limits in selection and ingest | REQ-FUNC-133f57ee (revised) | plan workbench rows; RULING-001/002 |
| docs.maxFileMB range up to 500 | REQ-DATA-9fd427f1, REQ-DATA-3bae7e69 (revised) | plan row; RULING-002 |
| Later checks accept the largest allowed sizes | REQ-FUNC-486d6a86 (new) | success signal; RULING-003 |
| Volume warning thresholds | REQ-UX-d64e808a (revised) | plan workbench row |
| Docs panel results | REQ-FUNC-4b36dede (new) | plan workbench row |
| Extraction time limit (indexing and downloads) | REQ-FUNC-aa35b135 (new) | plan app row; ADV-03 RULING-002 |
| Indexing pause | REQ-FUNC-2fba7b9c (new); REQ-FUNC-a93d863d (revised wording) | plan app row |
| Embedding worker idle time | REQ-FUNC-bfbd70b6 (new) | plan app row |
| Precedence, storage, invalid values, field, help | REQ-FUNC-902313e0, REQ-DATA-96ef3dd6, REQ-DATA-33a90ef2, REQ-UX-9ea9184f, REQ-UX-504e0d6d (reused) | ADV-01 framework |


## Design

**Approach.** Seven registry keys plus the existing docs.maxFileMB. Workbench values reach the main-process
ingest and preview through the workbench config (resolveAdvanced with the workbench and application maps); the
indexer utility process has no settings, so every IndexerHost message carries a small `limits` object
(extraction base ms, embedding idle ms) that the process keeps for its extractors and embedding hosts; the CLI
passes the same getter in-process. Rejected: restarting the indexer on a settings change (drops work) and
moving the size limits into each inspect/process message (wider protocol change; RULING-003 makes it needless).

**Interfaces and data.**
- kinds.ts: `MAX_BINARY_BYTES` 500 MiB and `MAX_TEXT_BYTES` 64 MiB (RULING-005) replace PDF_LIMIT/TEXT_LIMIT as the
  ceilings `sourceLimit` returns (inspect, verifyDocumentSource; REQ-FUNC-486d6a86); `sizeLimit(kind, docs)`
  uses docs.maxFileMB (default 100) for binary kinds and `docs.maxTextMB` (default 20) for text; a helper
  `selectionDocs(config, app?)` adds `maxTextMB` from the resolved textFileMB (REQ-FUNC-133f57ee). The select
  message already passes `docs` unvalidated, so the field travels without a protocol change.
- shared workbench.ts: `fileMB` max 500 (REQ-DATA-9fd427f1, -3bae7e69).
- Volume warning: `exceedsDocumentVolume(volume, limit)` takes the resolved limit; WorkbenchDocuments gets the
  draft advanced map and the application map (REQ-UX-d64e808a).
- Docs panel: service resolves docsResults; search accepts an internal k up to 100 (the agent's search_docs
  schema stays 1-20); keyword per-table LIMIT follows k; IPC response max 100 (REQ-FUNC-4b36dede).
- Extraction: `createPdfExtractor/createOfficeExtractor(entry, base: number | () => number)`, read per job;
  PdfExtractor gains an optional per-call `{ baseMs }` used by downloads with the session value
  (REQ-FUNC-aa35b135).
- Ingester option `pauseMs?: () => number`, from WorkbenchService with the application value (REQ-FUNC-2fba7b9c).
- EmbeddingHost `idleTimeoutMs: number | () => number`, read when the idle timer starts (REQ-FUNC-bfbd70b6).

**Files and test seams.** shared advanced-settings.ts(+test), workbench.ts(+test), documents.ts; core
knowledge kinds.ts, selection.ts, ingest.ts, inspect.ts, processor.ts, worker-host.ts, embedding.ts,
document-services.ts, search.ts, keyword.ts; workbench service.ts, documents-scan.ts; web downloads.ts; tools
web-download.ts; desktop main indexer-host.ts, indexer-handler.ts, indexer-process.ts, index.ts; renderer
volume-warning.tsx, workbench-documents.tsx, workbench-config-form.tsx, advanced-field.tsx, locales; CLI run.ts,
documents.ts; help x4. Tests beside each file (ingest-selection, ingest, processor, embedding, search,
workbench service, indexer-host, documents renderer, shared schema).

**Risks and open decisions.** A 500 MiB PDF may exceed the 2048 MB extraction heap and fail as a document
error (accepted, fixed heap is "Not exposed"). Raising the ceiling makes verifyDocumentSource read up to 500
MiB into memory for the viewer; only documents the user allowed reach it.

**Requirement map.** Each ID maps to the bullet naming it; REQ-FUNC-a93d863d only changes wording; the reused
ADV-01 requirements have no design impact beyond new rows.


## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: scope recorded on autopilot from the ADV plan and the seam map; open points decided by my recommendation as the user asked (recorded as technical rulings)
- 2026-11-21 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-21 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-21 design: note written (limits object on every indexer message, size ceilings for later checks, configured sizes for selection and ingest); diagram_TASK-0dff4c83.md structure and sequence
- 2026-11-21 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-21 build: red: vitest shared advanced-settings.test.ts -t Document-settings exit 1 - the 7 ADV-04 keys are not registered; workbench.test.ts -t rejects exit 1 - maxFileMB 500.5 accepted. green: shared advanced-settings 14 pass, workbench + create-ipc 15 pass after the registry entries and fileMB max 500 (REQ-FUNC-133f57ee REQ-UX-d64e808a REQ-FUNC-4b36dede REQ-FUNC-aa35b135 REQ-FUNC-2fba7b9c REQ-FUNC-bfbd70b6 REQ-DATA-9fd427f1 REQ-DATA-3bae7e69)
- 2026-11-21 build: red: vitest core knowledge/ingest-selection.test.ts -t maxFileMB exit 1 - maxFileMB 150 does not raise the 100 MiB limit. green: ingest-selection, ingest, processor, documents-scan 72 pass after kinds.ts sizeLimit (maxFileMB default 100 for PDF/Office, maxTextMB default 20 for text), selectionDocs(config) adding the resolved textFileMB for the ingest select and size check, sourceLimit = the largest allowed sizes (500/100 MiB) for inspect and verifyDocumentSource, preview with the open workbench's saved text size; the same test proves a raised limit indexes once and settles and the workbench textFileMB reaches the ingest (REQ-FUNC-133f57ee REQ-FUNC-486d6a86)
- 2026-11-21 build: red: vitest core workbench/service.test.ts -t Docs-panel-results exit 1 - 20 hits with docsResults 60. green: workbench service, search, keyword, documents-ipc 94 pass after search(raw, signal, roots, panelK) with panelK 1-100 (agent schema stays 1-20), keyword per-table limit max(50, k), service resolves docsResults (workbench over application), IPC response max 100 (REQ-FUNC-4b36dede). Pre-existing failure, out of scope: workbench/service.test.ts 'refuses external format/identity changes during pinned saves and closing redirected runtime' fails the same with HEAD's ingest.ts and service.ts (close() restarts the ingest on the test's closed database, a TypeError replaces DENIED; Windows junction fixture)
- 2026-11-21 build: red: vitest shared documents-ipc.test.ts exit 1 - documentVolumeLimitFor missing. green: documents-ipc, renderer documents, workbench-advanced pass after documentVolumeLimitFor (workbench over application), exceedsDocumentVolume(volume, limit), VolumeWarning limit prop, WorkbenchDocuments volumeLimit from the config form (draft advanced + application); the large-selection test raises its timeout to 15 s for the added sixth preview; renderer labels for the 7 keys (REQ-UX-d64e808a)
- 2026-11-21 build: red: vitest core knowledge/processor.test.ts -t large-PDF exit 1 - a base deadline getter is refused; ingest.test.ts -t Indexing-pause exit 1 - the pause stays 1000 ms with the application value 300. green: processor 22 pass after ExtractionDeadline (number or getter read per extraction, invalid -> 120 s) and PdfExtractor options.baseMs; ingest 30 pass after IngestOptions.pauseMs from WorkbenchService (application indexingPause) (REQ-FUNC-aa35b135 REQ-FUNC-2fba7b9c)
- 2026-11-21 build: red: vitest core knowledge/embedding.test.ts -t idle exit 1 - an idle getter is not supported (worker retired at once); desktop indexer-host.test.ts -t limits exit 1 - messages carry no limits; core web/downloads.test.ts -t extraction exit 1 - the PDF parser gets no base. green: embedding 8, indexer host + handler 17, downloads (web + sessions) 37 pass after EmbeddingHost idle getter, createModelDocumentServices(limits) feeding the extractors and embedding hosts, IndexerHostOptions.limits attached to every message, createIndexerHandler limits callback (invalid values dropped), indexer-process keeping the latest limits, desktop index.ts and CLI run.ts/documents.ts passing the application values, DownloadBudget.extractionMs from web_download (REQ-FUNC-aa35b135 REQ-FUNC-bfbd70b6)
- 2026-11-21 build: green: targeted vitest 19 files 228 pass (shared advanced-settings, workbench, create-ipc, documents-ipc; core ingest-selection, ingest, processor, embedding, search, keyword, documents-scan, web/sessions downloads; desktop indexer host/handler; renderer documents, workbench-advanced, advanced-settings); workbench/service.test.ts 57 pass + the pre-existing failure logged above; e2e advanced-settings.spec.ts and ingest.spec.ts 2 pass; typecheck, lint, check:i18n, check:help exit 0. Locales for 7 keys x4, maxFileMBInvalid copy names the 500 cap (renderer test adds 600 as invalid), help documents-and-search and advanced-settings x4 (REQ-UX-9ea9184f REQ-UX-504e0d6d REQ-DATA-3bae7e69)
- 2026-11-21 build: evolution reviewed: 53 modified paths, all seams the design names (formatter whitespace on 4 earlier-task files). check --task errors=0; warnings are the layout heuristics. Knowledge: knowledge-ingest.md, workbench.md, pdf-downloads.md, document-search.md updated
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 1: quality approved (finding: a 100 MiB text file can serialize past the 128 MiB extraction cache). spec changes_required: REQ-FUNC-486d6a86 verification has no test (verifyDocumentSource ceiling, 501 MiB refusal); stale linked test names in REQ-FUNC-133f57ee and REQ-DATA-9fd427f1; spec REQ-FUNC-a93d863d.md states the fixed debounce and limits; minor: unrecorded decisions (volume MiB, app scope of volume/results, preview text size), three verification texts, selection.ts comment, field label, older yaml above 500, pdf-downloads spec, web-download extraction link untested
- 2026-11-21 validate: returned to build - spec round 1 record fixes; text maximum lowered to 64 MiB for the extraction cache margin
- 2026-11-21 build: spec round 1 fixes: text maximum 64 MiB in registry, tests, help and knowledge; REQ-FUNC-486d6a86 reworded and linked to processor.test.ts with a ceiling test (500 MiB + 1 PDF and 64 MiB + 1 text refused, 100 MiB + 1 PDF passes the size check); stale linked test names and verifications for REQ-FUNC-133f57ee, REQ-DATA-9fd427f1, REQ-FUNC-2fba7b9c, REQ-UX-d64e808a, REQ-FUNC-4b36dede corrected; specs REQ-FUNC-a93d863d and pdf-downloads updated
- 2026-11-21 build: red then green: the new ceiling test first failed on a test helper that rewrote the sparse file as empty (Source changed); helper fixed, test green. Re-proof: 12 core/shared/desktop files 177 pass; documents.test.ts and settings 17 pass; service.test.ts 58 pass, 1 known HEAD failure unchanged; typecheck, lint (untracked files included), i18n, help exit 0
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: inspection REQ-FUNC-4b36dede: shared/src/ipc.ts:531 Docs search response results max(100); core/src/knowledge/search.ts:33-39 search_docs k int 1-20 unchanged; observed as required
- 2026-11-21 validate: review round 2: spec approved, quality approved; the spec reviewer's two minor decided items applied before recording (REQ-UX-d64e808a linked test name fixed to the real documents.test.ts test, predating ADV-04; RULING-007 restates the workbench-only text size scope), requirement and journal text only, no code
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-0dff4c83 --strict --run exit 0; lint, typecheck, i18n, help ok, test not in the run list (targeted-tests standing instruction; focused proof logged above); 131 warnings are uncovered-source over the shared master working tree (ADV-01..04 and other writers) and outside-layout/secret-in-diff for untracked captures/*.pcapng not part of this task; pre-existing failure service.test.ts refuses external format/identity changes during pinned saves and closing redirected runtime fails identically at HEAD, out of scope
- 2026-11-21 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-21 | decision=Maximum text file size is a workbench setting of 1-100 MiB (default 20) | reason=the 128 MiB extraction cache would fail larger text; an application change starts no reconcile, so the value is per workbench | source=technical | supersedes=none
- RULING-002 | date=2026-11-21 | decision=docs.maxFileMB is the one PDF/Office size: positive, at most 500 MiB, default 100 when unset, decimals kept; it no longer lowers text | reason=plan: it becomes one value that raises or lowers the limit; text has its own row; decimals are the existing contract | source=technical | supersedes=none
- RULING-003 | date=2026-11-21 | decision=Inspect, viewer, read_doc and citation checks use the largest allowed sizes (500/100 MiB); selection and ingest apply the configured sizes | reason=a selected document must never fail a later check (reindex loop, unopenable document) and those paths have no workbench config | source=technical | supersedes=none
- RULING-004 | date=2026-11-21 | decision=Volume warning size is in MiB (512-51200 for 0.5-50 GiB); volume warning and Docs panel results take an application value the workbench overrides; the Documents preview applies the open workbench's saved text size; the Maximum file size label stays; a workbench.yaml with maxFileMB above 500 is refused (no compatibility) | reason=spec review round 1 minor items, decided by recommendation as the user asked; consistent with the earlier user rulings that workbench rows keep an application level | source=technical | supersedes=none
- RULING-005 | date=2026-11-21 | decision=Maximum text file size is 1-64 MiB (default 20) | reason=quality review: a 100 MiB text file can serialize past the 128 MiB extraction cache; 64 keeps the margin | source=technical | supersedes=RULING-001
- RULING-006 | date=2026-11-21 | decision=Inspect, viewer, read_doc and citation checks use the largest allowed sizes (500 MiB PDF/Office, 64 MiB text); selection and ingest apply the configured sizes | reason=restates RULING-003 with the text ceiling lowered by RULING-005 | source=technical | supersedes=RULING-003
- RULING-007 | date=2026-11-21 | decision=Maximum text file size is a workbench-only setting, 1-64 MiB (default 20) | reason=an application-level change would not re-check the indexed documents of each workbench; 64 keeps the 128 MiB extraction cache margin | source=technical | supersedes=RULING-005


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-0dff4c83.md
changed: 5 created, 5 revised, 5 reused
evidence: check --task TASK-0dff4c83 --strict --run exit 0
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-133f57ee - Skip documents above the workbench file size limit
  - REQ-DATA-9fd427f1 - Per-workbench file size and file count settings
  - REQ-DATA-3bae7e69 - Refuse invalid file size and file count settings
  - REQ-UX-d64e808a - Warn about a large selection while choosing documentation folders
  - REQ-FUNC-a93d863d - Background document synchronization
  - REQ-FUNC-486d6a86 - Accept indexed documents up to the largest allowed sizes in later checks
  - REQ-FUNC-4b36dede - List up to the resolved Docs panel results
  - REQ-FUNC-aa35b135 - Extract documents within the resolved Document extraction time limit
  - REQ-FUNC-2fba7b9c - Wait the resolved Indexing pause before indexing changes
  - REQ-FUNC-bfbd70b6 - Retire embedding workers after the resolved Embedding worker idle time
  - REQ-FUNC-902313e0 - Resolve Advanced settings by scope precedence
  - REQ-DATA-96ef3dd6 - Store Advanced settings per application, workbench and session
  - REQ-DATA-33a90ef2 - Ignore invalid stored Advanced values
  - REQ-UX-9ea9184f - Edit an Advanced setting with inherit, reset and apply timing
  - REQ-UX-504e0d6d - Document Advanced settings in help
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 7765491: 261 file(s) changed, 9196 line(s) added; 3 file(s) not content-scanned
- checks: errors=0 warnings=131 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
