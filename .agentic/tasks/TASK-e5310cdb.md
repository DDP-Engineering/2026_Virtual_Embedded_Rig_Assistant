# TASK-e5310cdb - Index only document files and warn about large selections

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-c1a1c758, REQ-NFR-89d6114f, REQ-DATA-d727f6e1, REQ-FUNC-a187563c, REQ-UX-05c5b146, REQ-UX-d64e808a, REQ-FUNC-a93d863d, REQ-FUNC-ad5868a2
parent:
branch: master
base: 33e72b8c7611d3c36c287ca49dae0b6474338c8f
opened: 2026-11-01

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

Problem:
- STATED (user, 2026-10-31): a workbench with many files froze VERA; the Docs listing is hard to
  follow for large documentation sets; the user asked for indexing restricted to document file
  types and a warning for large volumes (and, separately, an indexer process and a tree explorer).
- OBSERVED: the F:\2026_AgenticDeliveryOrchestratorRuntimeEngine workbench (~117k files under
  07_Delivery) held the main process at 100% CPU until those folders were excluded.
- OBSERVED: ingest selection (core knowledge/ingest.ts selected()) globs every include match with
  tinyglobby, which applies only the configured exclude while crawling; .veraignore and the
  permanent .git/node_modules/.vera rules are checked per path afterwards, so excluded trees are
  still walked. No file-count or byte cap exists in ingest.
- OBSERVED: documentKind (ingest.ts) maps source code, logs, JSON/YAML/XML/INI/CFG/CONF/SH, CSV/TSV
  to `text`, so matching code is extracted, chunked and embedded; every other extension is `other`
  and is still read and hashed in full, stored as TYPE_UNSUPPORTED and announced by an event.
- OBSERVED: the New Workbench preview (workbench/documents-scan.ts previewDocuments) counts every
  non-`other` kind, code included; DocumentPreview carries files/bytes/officePending/truncated.
Desired outcome: only document files are discovered, read and indexed; files of other types and
  excluded folders cost no reads; when the selected documents of a workbench exceed 2,000 files or
  2 GB, the Docs panel and the New Workbench page warn with the count and size while indexing
  continues.
Actors: the desktop user configuring and using a workbench; the agent using search_docs/read_doc.
Primary scenario: the user opens a workbench whose include globs match thousands of source and
  build files plus some datasheets; VERA indexes only the datasheets (PDF, office, Markdown, HTML,
  TXT), Docs lists only those, and if they exceed the threshold a volume warning is shown.
Examples: a `firmware/main.c` matching `**/*` is not indexed and has no Docs row; `board.pdf` and
  `notes.md` are indexed; 2,500 selected PDFs show the warning; 300 small PDFs do not.
Counterexamples: the agent still reads code with read/grep (tool access is unchanged); an existing
  indexed `.c` row is removed from the index on the next reconciliation rather than kept.
In scope: a fixed document type set (PDF; Word .docx/.odt; PowerPoint .pptx/.odp; Excel
  .xlsx/.ods; Markdown .md/.markdown; HTML .html/.htm; plain text .txt); discovery that skips
  other types and does not descend into excluded folders; removal of previously indexed
  non-document rows on reconciliation; the volume warning in Docs and on the New Workbench page
  (counts and bytes of selected documents); locales; tests.
Out of scope: moving indexing to a separate process (next task, user order 2026-10-31); the Docs
  tree explorer (later task); a user-editable type list or a code-indexing option (RULING-002);
  blocking or pausing indexing above the threshold (RULING-003); changes to read/grep/glob tools.
Constraints: on master (default branch); no commits unless asked; workbench.yaml format 1 stays
  compatible (no new required keys); existing document rows of supported types keep their
  extraction cache.
Success signals: core ingest tests show code/log/unknown files neither read nor stored and an
  excluded folder not walked; previously indexed code rows disappear on reconcile; the preview
  counts only documents; renderer tests show the warning at the threshold and not below; e2e with
  a mixed folder lists only documents.
Evidence: core knowledge/ingest.ts (documentKind, selected, ingest of `other`),
  workbench/documents-scan.ts (scan/preview), shared documents.ts kinds, shared workbench.ts
  DocumentPreview/WorkbenchWarning, renderer documents/docs-tab.tsx, workbench-documents.tsx.
Assumptions: none.
Unknowns: whether the warning threshold counts bytes before or after extraction (proposed: source
  file bytes); how the Docs panel learns the selected totals (proposed: an index.progress-like
  event or docs.list metadata) - design.
Decision-blocking questions: none open. Answered by the user (RULING-001..003).
Proposed behaviors (accepted by RULING-001..003 unless marked):
- Index only the fixed document set above (RULING-002).
- Warn at more than 2,000 selected documents or 2 GB and keep indexing (RULING-003).
- Not accepted, design detail: the warning also appears on the New Workbench preview line.
Path and reason: full.
  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | fewer indexed files, new warning |
  | no new interface or data format | no | warning data in events/preview |
  | no new dependency | yes | none planned |
  | an existing requirement already covers the behavior | no | kinds and limits requirements cover today's set |
  | no security or data-handling change | no | existing non-document rows are removed |

## Requirement coverage

| Behavior | Requirement | Source in Frame |
|---|---|---|
| only document files are selected, read and recorded | REQ-FUNC-c1a1c758 | RULING-002, desired outcome |
| excluded folders are not walked during discovery | REQ-NFR-89d6114f | problem (excluded trees crawled), desired outcome |
| existing rows of non-document files are removed | REQ-DATA-d727f6e1 | RULING-002, counterexample |
| selected document count and bytes reach the renderer | REQ-FUNC-a187563c | RULING-003 (warning needs totals) |
| Docs warns above 2,000 files or 2 GiB, indexing continues | REQ-UX-05c5b146 | RULING-003 |
| Documents section preview warns above the threshold | REQ-UX-d64e808a | RULING-003, proposed (preview line) |
| ingest synchronization keeps size/binary unsupported reasons, no type reasons | REQ-FUNC-a93d863d (revised) | RULING-002 |
| preview counts only admitted document kinds | REQ-FUNC-ad5868a2 (reused unchanged) | observed preview, RULING-002 |

Revised: REQ-FUNC-a93d863d prose (document files only; unsupported reasons are size/binary) and its spec specs/REQ-FUNC-a93d863d.md (other extensions not selected; their stored rows removed). REQ-FUNC-ad5868a2 is reused: its 'document kinds' now means the narrower set. The 2 GB of RULING-003 is read as 2 GiB, matching the 1024-based limits of the spec.

## Design

**Approach.**
- One document-type decision (REQ-FUNC-c1a1c758): core `documentKind` keeps its office, PDF,
  Markdown and HTML mapping, and `text` shrinks to `.txt`, `.csv` and `.tsv` (RULING-005); everything else is `other`. Ingest
  selection keeps only non-`other` paths, so the New Workbench preview (which already uses
  `documentKind`) follows automatically and legacy .doc/.ppt/.xls/.rtf stay counted as "not
  indexed" there (REQ-FUNC-ad5868a2 unchanged).
- Pruned discovery (REQ-NFR-89d6114f): `Ingester.selected()` passes tinyglobby an `fs` adapter
  whose `readdir` (the call fdir makes, `{withFileTypes: true}`) drops entries that the shared
  ignore rules reject (.veraignore plus permanent .git/node_modules/.vera, tested as `dir/` for
  folders) and files whose kind is `other`. Ignored folders are therefore never listed; docs.exclude
  keeps pruning through tinyglobby's own `ignore`. Unsupported files are never selected, so they
  are never opened, hashed or stored.
- Row removal (REQ-DATA-d727f6e1): reconciliation already removes rows outside the selection with
  their derived data and emits `index.document` null; narrowing the selection makes stored code
  rows leave on the next reconciliation. Proved by test, no new code path.
- Volume (REQ-FUNC-a187563c): `selected()` keeps the size from the final lstat of each admitted
  path; reconcile stores `{files, bytes}` on the Ingester and emits a new workbench event
  `index.volume {files, bytes}`. `WorkbenchService.documentVolume()` returns it (null before the
  first selection); a new IPC channel `docs.volume {workbenchId?} -> {files, bytes} | null`
  exposes it.
- Warnings (REQ-UX-05c5b146, REQ-UX-d64e808a): shared `documentVolumeLimit = {files: 2000, bytes:
  2 GiB}` and `exceedsDocumentVolume(v)` (strictly greater). Docs tab queries docs.volume,
  refreshes on `index.volume`, and shows `[data-volume-warning]` (role status) above the list.
  `workbench-documents.tsx` shows the same warning beside its preview statement. Indexing is
  never paused (RULING-003).
- Rejected: pruning by translating .veraignore into globs (gitignore negation does not map); a
  custom walker replacing tinyglobby (re-implements include partial matching); counting volume in
  the renderer from docs.list rows (rows appear one by one during the first index).

**Interfaces and data.**
- Shared: `documentVolumeSchema {files, bytes}` (non-negative safe integers), workbench event
  `index.volume`, channel `docs.volume`, `documentVolumeLimit`, `exceedsDocumentVolume`.
- No database or workbench.yaml change; stored rows of non-document paths are deleted by the
  existing reconciliation.
- Locales: `docs.volumeWarning` (count and size), en/ro/de.

**Files and test seams.**
- core knowledge/ingest.ts (+ new ingest-selection.test.ts mocking node:fs readdir and
  node:fs/promises open to record listings and reads); workbench/service.ts; core
  workbench/documents-scan.test.ts for the preview.
- shared documents.ts, events.ts, ipc.ts (+ documents-ipc.test.ts); main index.ts, ipc-router and
  bridge channel lists; CLI event handling if it switches on event types.
- renderer documents/docs-tab.tsx, workbench-documents.tsx, locales, mockApi (docs.volume);
  documents.test.ts / workspace.test.ts; e2e ingest.spec with a mixed folder.

**Risks and open decisions.**
- fdir also calls realpath/stat only for symlinks, which ingest does not follow; the adapter
  overrides `readdir` alone and tinyglobby fills the rest from node:fs.
- Workbenches whose search relied on indexed code lose those hits (accepted, RULING-002).
- No open product decisions.

**Requirement map.** As in the coverage table.

Diagrams: [diagram_TASK-e5310cdb.md](diagram_TASK-e5310cdb.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: completed; next specify - scope set by user answers RULING-001..003 (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: design refinement before red: the chokidar watcher also walks folders excluded by .veraignore and docs.exclude (its ignored callback applies only permanent rules), so its ignored callback will prune folders by the live ignore rules and exclude matcher and skip non-document files; a .veraignore change recreates the watcher so newly allowed folders are watched; REQ-NFR-89d6114f verification now names the watcher
- 2026-11-01 build: red: vitest knowledge/ingest-selection.test.ts exit 1 - 4 failures as expected: all ten files get rows (REQ-FUNC-c1a1c758); discovery does not go through a filtering reader so excluded folders are walked (REQ-NFR-89d6114f); a stored main.c row is reindexed instead of removed (REQ-DATA-d727f6e1); WorkbenchService.documentVolume missing (REQ-FUNC-a187563c)
- 2026-11-01 build: red: vitest documents.test.ts 'warns about a large selection…' exit 1 - no [data-volume-warning] in Docs or the Documents section (REQ-UX-05c5b146, REQ-UX-d64e808a); core green after implementation: ingest-selection 4/4, ingest + documents-scan 36 passed with two expectations updated to RULING-002 (src/** preview counts 0 code files; blob.bin gets no row)
- 2026-11-01 build: green: vitest ingest-selection 4/4, documents.test 'warns about a large selection' pass; desktop/shared/core suites: only pre-existing failures (Settings tab count, bounds large text DOM); tsc -b exit 0; biome clean on touched files; e2e ingest (mixed folder: .c/.log get no events, docs.volume files 3), documents, office-documents, workbench, citations pass natively. citations.spec and its llm script switched the plain-text document from a.log to a.txt because .log is no longer indexed (RULING-002)
- 2026-11-01 build: evolution reviewed: 25 paths (volume-warning.tsx and lib/bytes.ts added) match the design; extra test edits are the RULING-002 consequences already logged (documents-scan src/** count, blob.bin row, citations a.log -> a.txt); knowledge updated: knowledge-ingest.md (selection, pruning, watcher, volume), ipc-boundary.md (index.volume, docs.volume)
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 1 findings: quality - (1) folders tested in file form prune allowlist .veraignore (e.g. '*', '!*/', '!*.pdf'): use only 'dir/' for folders and require both forms when chokidar gives no stats, add an allowlist test; (2) Docs keeps a stale cached volume after remount under production staleTime Infinity: refetch on mount, test with production defaults and a remount; (3) starvation tests write .log noise that the type filter now drops, so they no longer test folder exclusion: use .md; (4) the watcher assertion can read the old watcher: wait for the replacement, assert root target, and test that a .veraignore edit re-registers an allowed folder; (5) minor, taken: reuse ordinary()'s final lstat size and drop the duplicate documentKind check. spec - (1) assert document reads and events too; (2) seed embeddings and extraction rows for main.c and show board.pdf is not reprocessed; (3) shared contract tests for documentVolumeSchema/docs.volume/index.volume; (4) REQ-NFR-89d6114f prose must except the watched .vera policy files; (5) deliver index.progress while the warning shows; locale parity is checked by npm run check:i18n in the final proof; (6) REQ-FUNC-a93d863d verification and spec limit wording. Questions: truncated preview -> RULING-004 (warn, 'at least'); preview wording must not claim indexing is running (separate New Workbench text); read-only workbenches have no ingester and no volume, so no warning (accepted: they do not index)
- 2026-11-01 validate: returned to build - review round 1 findings and RULING-004
- 2026-11-01 build: red (round 1): vitest ingest-selection 'keeps folders that an allowlist .veraignore re-includes' fails - rows [] instead of docs/a.pdf, other/deep/b.pdf (REQ-NFR-89d6114f); documents.test 'warns about a large selection…' fails - remounted Docs shows the stale cached volume under staleTime Infinity (REQ-UX-05c5b146); strengthened watcher/data/contract assertions pass already
- 2026-11-01 build: green (round 1): vitest desktop/shared/core suites 585 passed, only the two pre-existing failures; tsc -b exit 0; biome no errors on touched files; npm run check:i18n exit 0 (keys passed literally so the checker sees them); e2e ingest, citations, documents, workbench pass natively. Also aligned core search.test 'SessionService persists every issued citation kind' with the shared llm script (docs/a.log -> docs/a.txt); requirement wording revised (REQ-NFR-89d6114f .vera policy files exception, REQ-UX-d64e808a per RULING-004, REQ-FUNC-a93d863d verification and spec limits)
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 2: spec approved, quality approved; two non-blocking test-hardening notes taken in a test-only round 3: (a) the drop-rows test can check board.pdf before the reconciliation finishes - wait for index.progress pending 0; (b) the watcher wait can be met by the old docs/** watcher - add extra/d.pdf and wait for 'extra', which only the root watcher registers. 'at least 0 files' on an empty truncated preview is cosmetic and accepted
- 2026-11-01 validate: returned to build - round 2 test-hardening notes
- 2026-11-01 build: green (round 2 notes): ingest-selection.test 5/5 passed three runs in a row after waiting for 'extra' (root watcher only) and for index.progress pending 0; test-only change, biome clean
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: final attempt: check --task --strict --run exit 0 (lint, typecheck, i18n); full unit suite afterwards found a failure this task introduced: tests/integration/document-cli.test.ts expects >= 5 indexed demo-board documents, and docs/pinout.csv was no longer indexed (4). The approved list did not name CSV/TSV; RULING-005 adds them
- 2026-11-01 validate: returned to build - RULING-005: CSV/TSV are documents
- 2026-11-01 build: red/green (RULING-005): ingest-selection 'selects, reads and records only document files' with docs/pinout.csv and docs/registers.tsv failed (5 of 7 rows) and integration document-cli expected >= 5 demo documents (4); after adding .csv/.tsv to the text kind, core knowledge/workbench and integration document-cli pass (191); requirement REQ-FUNC-c1a1c758, spec, design and knowledge-ingest wording updated
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 4: spec approved, quality approved. Frame 'In scope' reads 'plain text .txt'; RULING-005 extends it to .csv/.tsv (recorded here rather than editing the approved Frame). Noted for later, not this task: New Workbench folder detection (scanKind) does not treat a CSV/TSV-only folder as documentation; TSV chunks get no header repetition; a non-UTF-8 or over-long-header CSV fails as PROCESSING (pre-existing text path)
- 2026-11-01 validate: final: python .agentic/aegis.py check --task TASK-e5310cdb --strict --run exit 0; ran lint, typecheck, i18n. Full unit suite afterwards (no edits): 1059 passed, 5 failed - 4 pre-existing (sessions compaction transcript, write/edit registry, documents 'bounds large text DOM', workspace Settings tab count) plus core tools/discovery.test 'globs newest first' which failed once under full-suite load and passed 3/3 alone, in a file this task does not touch (mtime ordering flake). integration document-cli now passes. e2e ingest/citations/documents/workbench/office-documents passed natively during build. Remaining check warnings (120) belong to older requirements
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings

- RULING-001 | date=2026-11-01 | decision=Indexing moves to a separate process that does scanning, extraction, chunking and embeddings; VERA main keeps the only SQLite writer | reason=user chose 'Munca grea; DB in VERA' (applies to the next task) | source=user | supersedes=none
- RULING-002 | date=2026-11-01 | decision=Index only a fixed document set: PDF, Word/ODT, PowerPoint/ODP, Excel/ODS, Markdown, HTML, TXT; code, logs, JSON/YAML/XML are no longer indexed and existing rows disappear on reindex | reason=user chose 'Doar documente, fix' | source=user | supersedes=none
- RULING-003 | date=2026-11-01 | decision=Above 2,000 selected documents or 2 GB, Docs and New Workbench show a volume warning with count and size; indexing continues | reason=user chose 'Avertizeaza si continua' | source=user | supersedes=none
- RULING-004 | date=2026-11-01 | decision=A truncated New Workbench preview also shows the volume warning, stating at least the counted files | reason=user chose 'Da, avertizeaza si la trunchiere' | source=user | supersedes=none
- RULING-005 | date=2026-11-01 | decision=CSV and TSV files are documents and are indexed as text, with the fixed set | reason=user chose 'Da, CSV si TSV sunt documente' after the demo-board pinout.csv stopped being indexed | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e5310cdb.md
changed: design note; diagram_TASK-e5310cdb.md
evidence: check --task TASK-e5310cdb --strict --run exit 0
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 4

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-c1a1c758 - Index only document files
  - REQ-NFR-89d6114f - Do not walk excluded folders while discovering documents
  - REQ-DATA-d727f6e1 - Drop indexed rows of files that are no longer document types
  - REQ-FUNC-a187563c - Report the volume of the selected documents
  - REQ-UX-05c5b146 - Warn about a large document selection in Docs
  - REQ-UX-d64e808a - Warn about a large selection while choosing documentation folders
  - REQ-FUNC-a93d863d - Background document synchronization
  - REQ-FUNC-ad5868a2 - Preview the documents a selection indexes
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=4
- diff vs task base 33e72b8: 210 file(s) changed, 12055 line(s) added; 7 file(s) not content-scanned
- checks: errors=0 warnings=120 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
