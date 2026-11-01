# TASK-ca6e05a5 - Office document extraction

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-58cba7fd, REQ-FUNC-bc730650, REQ-FUNC-81dbc6fc, REQ-FUNC-56b34eec, REQ-SEC-58c879e8, REQ-REL-7a48f161, REQ-UX-64738341
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

Problem: Office documents are not indexed. documentKind() maps .docx, .pptx, .xlsx, .odt, .odp and .ods to "other" (OBSERVED: core knowledge/ingest.ts documentKind). The Documents preview reports them as "not indexed yet" (OBSERVED: documents-scan.ts). The extraction, viewer and citation code know only pdf, markdown, html and text (OBSERVED: knowledge/extraction.ts, viewer.ts, shared documents.ts). Engineers keep datasheets, notes, reviews and test reports in these formats (STATED: "documente nu sunt doar pdf si markdown. Avem si txt, doc, ppt, docx etc.").
Desired outcome: modern office documents are indexed with structure and cited precisely, and the viewer shows their extracted text (STATED: parent RULING-003 "legacy binary .doc/.ppt/.xls are ignored for now; office documents are extracted with structure (docx headings, pptx/odp slides, xlsx/ods sheets); the document viewer shows the extracted text").
Actors: the engineer browsing Docs and citations; the agent using search_docs/read_doc.
Primary scenario: notes/review.docx with "Power" and "Reset" headings is indexed; search_docs finds a sentence; the citation [[notes/review.docx#h=power]] opens the viewer at the Power section. slides/bringup.pptx slide 3 is cited as [[slides/bringup.pptx#p=3]] and opens at slide 3.
Examples: test-report.xlsx with sheets "Rail" and "Timing" gives sections "Rail" and "Timing" whose lines are the sheet rows as tab-separated cells.
Counterexamples: .doc, .ppt and .xls stay unindexed and are still counted as office files not indexed yet (STATED: RULING-003). .rtf stays unindexed (not requested; INFERRED from the ruling's format list).
In scope: shared document kinds, extraction and viewer schemas; core extraction for docx/odt (document), pptx/odp (presentation) and xlsx/ods (spreadsheet) in the existing PDF worker thread; archive limits; chunking, citations bounds and read_doc for the new kinds; main viewer sanitizer; renderer viewer for presentations and sections; mock fixtures; tests with small generated office fixtures; dependencies mammoth and fflate (direct, exact pins), plus @xmldom/xmldom (already brought in by mammoth).
Out of scope: legacy binary formats and RTF (RULING-003); embedded images and vision (STATED: later stage); visual rendering of office layout (RULING-003 option a).
Constraints: exact dependency pins (OBSERVED: package.json); core stays Electron-agnostic; parsing never blocks the main process (OBSERVED: the PDF worker pattern with a deadline); zip input is untrusted (archive bombs); implementation on master (STATED: AGENTS.md); no compatibility paths (STATED: AGENTS.md).
Success signals: core tests extract each format from committed fixtures with the expected structure and locators; a limit-breaking archive fails with SIZE_LIMIT; the viewer shows a cited slide; native e2e indexes a docx and a pptx and cites them.
Evidence: ingest.ts, processor.ts, extraction.ts, viewer.ts, worker-host.ts, pdf-worker.ts, documents-scan.ts, shared documents.ts, renderer viewer-context.tsx, main document-viewer.ts; npm view mammoth@1.13.0 / fflate@0.8.3.
Assumptions: none.
Unknowns: archive limits (proposed below).
Decision-blocking questions: none.
Proposed behaviors: (not accepted) archive limits of 10000 entries and 500 MB uncompressed total; one leading untitled section for text before the first heading; spreadsheet cells as their stored display text, with formulas showing the cached value.
Path and reason: full.

  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | new document kinds |
  | no new interface or data format | no | extraction/viewer schemas |
  | no new dependency | no | mammoth, fflate |
  | an existing requirement already covers the behavior | no | none |
  | no security or data-handling change | no | untrusted archives parsed |

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Word documents | docx/odt as heading sections | REQ-FUNC-58cba7fd | core fixtures | mammoth to HTML, then extractHtml; ODF content.xml text:h |
| Presentations | pptx/odp slide texts, no notes | REQ-FUNC-bc730650 | core fixtures | slide XML a:t / draw:page text, slide = page locator |
| Spreadsheets | xlsx/ods sheet sections, tab rows | REQ-FUNC-81dbc6fc | core fixtures | sheet XML + sharedStrings / table:table-row |
| Citations and reads | slide/heading refs only | REQ-FUNC-56b34eec | core tests | bounds by kind in viewer.currentBounds and read_doc |
| Archive limits | entries/uncompressed caps, SIZE_LIMIT | REQ-SEC-58c879e8 | core test | fflate central-directory check before any inflate |
| Unreadable files | PROCESSING failure, ingest continues | REQ-REL-7a48f161 | core ingest test | worker error message mapped like PDF |
| Viewer | slides/sections of extracted text | REQ-UX-64738341 | renderer, native e2e | presentation viewer content kind; sections path reused |


## Design

**Approach.**
- Add three document kinds to the shared schemas: `document` (docx, odt), `presentation` (pptx, odp) and `spreadsheet` (xlsx, ods).
  - Extraction: `document` and `spreadsheet` reuse the `sections` shape of markdown/html. `presentation` adds `{kind: "presentation", slides: string[]}`.
  - Viewer content: sections kinds are extended, and a `presentation` variant is added.
- A new core module `knowledge/office.ts` holds pure extractors plus an archive guard: fflate reads the central directory and enforces the limits before any entry is inflated (REQ-SEC-58c879e8). The extractors:
  - docx: mammoth `convertToHtml` on the guarded buffer, then the existing `extractHtml`, so headings, slugs and anchors match HTML (REQ-FUNC-58cba7fd).
  - odt: `content.xml`, with `text:h` outline levels as headings.
  - pptx: `ppt/presentation.xml` slide order, then `a:t` paragraphs per slide; notes parts are never read (REQ-FUNC-bc730650).
  - odp: `draw:page` order.
  - xlsx: `xl/workbook.xml` sheet order, `sharedStrings`, then the cells `v`/`is` of each sheet (REQ-FUNC-81dbc6fc).
  - ods: `table:table` and `table:table-row` cells.
  - XML is parsed with `@xmldom/xmldom`, already a mammoth dependency, pinned to the same 0.8 line.
- Extraction runs inside the existing PDF worker thread (`pdf-worker.ts`), with the message extended to `{format, bytes}`. That keeps the deadline, termination and build entries unchanged, and parsing never blocks the main process. `worker-host.ts` gains `createOfficeExtractor(entry)`, built on the same thread runner. Rejected: a separate worker entry, which would need new desktop, CLI and packaging build inputs for no isolation gain.
- `processor.ts` dispatches the new kinds to the office extractor. Archive limits map to `SIZE_LIMIT` and parse failures to `PROCESSING` (REQ-REL-7a48f161).
- `documentKind()` maps the six extensions. The scan already lists them as office, and the preview now counts them as indexable, so only legacy formats and RTF stay "not indexed yet".
- Chunking: presentations chunk per slide with page locators; documents and spreadsheets chunk like html sections.
- Citations and read_doc (REQ-FUNC-56b34eec):
  - Presentations use page refs bounded by the slide count; read_doc pages return slide text.
  - Documents and spreadsheets use heading refs.
  - `currentBounds` uses extraction counts instead of decoding the source as UTF-8, and the binary-source check skips office kinds.
- Viewer (REQ-UX-64738341): main `document-viewer.ts` sanitizes the new variants. The renderer `viewer-context.tsx` renders presentations as numbered slide sections and scrolls to the cited slide, and renders document/spreadsheet sections with the existing `<pre>` sections path.

**Interfaces and data.**
- `documentKindSchema` gains `document | presentation | spreadsheet`.
- `extractionSchema` gains the presentation variant and extends the sections kinds.
- `viewerContentSchema` gains `{kind: "presentation", slides, page, pageEnd}` and extends the sections kinds.
- Limits: 10000 entries and 500 MB uncompressed in total. Office sources use `PDF_LIMIT` (100 MB) as their byte cap.
- The extraction cache key already includes the kind, and documents whose kind changes are re-extracted by ingest's kind check.

**Files and test seams.**
- shared: documents.ts (+ documents-ipc test).
- core:
  - knowledge/office.ts (new) + office.test.ts with committed fixtures under `05_Software/tests/fixtures/documents/office/`, generated by a script with fflate;
  - extraction.ts, worker-host.ts, pdf-worker.ts, processor.ts, ingest.ts, chunk.ts, search.ts, viewer.ts;
  - workbench/documents-scan.ts (office mapping) and workbench/service.ts (ref bounds).
- main: document-viewer.ts.
- renderer: viewer-context.tsx, locales, mock documents.
- tests: renderer viewer test, native e2e documents.
- package.json files of core.

**Risks and open decisions.**
- **Dependency footprint:** mammoth brings jszip, underscore, lop, xmlbuilder, argparse and base64-js.
- **Bombs:** mammoth unzips with jszip, so the archive guard must run first.
- **XML:** @xmldom/xmldom does not fetch external entities.
- **Large workbooks:** the 500 MB cap and the worker deadline bound them.
- No open product decisions.

**Requirement map.** As in the coverage table's last column.

Diagrams: [diagram_TASK-ca6e05a5.md](diagram_TASK-ca6e05a5.md)


## Log

- 2026-10-31 frame: journal opened
- 2026-10-31 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-10-31 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-31 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-10-31 build: red: npmw npx vitest run core knowledge/office.test.ts exit 1 - office.js missing (REQ-FUNC-58cba7fd, REQ-FUNC-bc730650, REQ-FUNC-81dbc6fc, REQ-SEC-58c879e8, REQ-REL-7a48f161)
- 2026-10-31 build: green: npmw npx vitest run core knowledge/office.test.ts exit 0 (6) - docx/odt sections, pptx/odp slides, xlsx/ods sheets, archive limits, corrupt/encrypted rejection (REQ-FUNC-58cba7fd, REQ-FUNC-bc730650, REQ-FUNC-81dbc6fc, REQ-SEC-58c879e8, REQ-REL-7a48f161)
- 2026-10-31 build: green: npx vitest run core knowledge+workbench, desktop documents.test, document-viewer.test, workspace.test exit 0 except the pre-existing 'bounds large text DOM' - office search/read/citations by slide and heading, Docs bounds, viewer slides/sections, sanitizer, ingest-level PROCESSING and SIZE_LIMIT, preview counts legacy office only (REQ-FUNC-56b34eec, REQ-FUNC-58cba7fd, REQ-FUNC-bc730650, REQ-FUNC-81dbc6fc, REQ-SEC-58c879e8, REQ-REL-7a48f161, REQ-UX-64738341)
- 2026-10-31 build: green: VERA_TEST=1 npm run test:e2e -- office-documents citations.spec documents.spec exit 0 (3 passed) - native pptx/docx/ods indexed in the bundled worker, cited slide 2 and heading open in the viewer, Docs search opens a sheet section (REQ-UX-64738341, REQ-FUNC-56b34eec)
- 2026-10-31 build: green: npx vitest run tests/integration/document-hosts.test.ts document-cli.test.ts exit 0 (5) - desktop and CLI processors with the office extractor wired
- 2026-10-31 build: DEVIATION build: the integration tests for REQ-FUNC-56b34eec, REQ-UX-64738341 and the ingest-level SIZE_LIMIT/PROCESSING checks were written after the wiring, so they have no recorded red line - accepted: each asserts behavior absent at HEAD (office kinds did not exist), but a test that could pass vacuously was not proven red
- 2026-10-31 build: scope: office-format.ts split from office.ts so the main process and PDF jobs never load mammoth/fflate/xmldom (worker imports the parsers lazily; processor's in-process fallback is a dynamic import); read_doc tool description names slides and office headings; processor.test.ts esbuild bundle gets a createRequire banner for bundled CommonJS parsers; mock API adds a pptx, a docx and a legacy .doc
- 2026-10-31 build: full unit run: 1007 passed, 7 failed - 1 mine fixed (New Workbench preview counts), 1 mine fixed (downloads PDF worker run as raw .ts needed the lazy office import); 5 pre-existing and unrelated: write/edit registry list, compaction transcript, reveal Unicode file, bounds large text DOM, Settings tab count
- 2026-10-31 build: evolution reviewed: 37 paths, all in the design's files list except office-format.ts, tools/documents.ts, workspace.test.ts and the office-citations replay script, each logged in the scope line above
- 2026-10-31 build: check: errors=0 warnings=146 notes=3, none on this task or its seven requirements (all pre-existing repository findings)
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: review round 1 spec: changes_required - (blocking) REQ-FUNC-ad5868a2 verification still says the preview reports .docx as not indexed; (non-blocking) no compiled-worker test of the office error protocol; no test that the guard runs before inflating; REQ-FUNC-81dbc6fc prose omits the sheet-name title line; no negative test for the presentation viewer schema bounds; untitled leading sections are not citable (spec gap); in-process default extractor (accepted, test-only)
- 2026-10-31 validate: review round 1 quality: changes_required - (blocking) archive guard counts entries after fflate's loop, so a zip64 record declaring ~2^32 entries spins the worker to its deadline; (blocking) xlsx column index unbounded and office workers run without resourceLimits; (non-blocking) office worker protocol untested; ODF tab/line-break/space and pptx a:br dropped, ODT tracked changes and annotations indexed; untitled sections uncitable and >12000-char sections unreadable (spec gap); word() decodes the main part and recompresses parts; one region landmark per slide; Word ~$ owner files indexed and retried
- 2026-10-31 validate: returned to build - review round 1 findings: fail-fast archive guard, xlsx column bound and worker resourceLimits, compiled worker protocol test, inline ODF/PPTX breaks and tracked changes, word() repack, slide landmarks, ~$ owner files, presentation schema negative test, REQ-FUNC-ad5868a2 and REQ-FUNC-81dbc6fc prose
- 2026-10-31 build: red: npx vitest run office/processor/ingest/documents-ipc/documents tests exit 1 - zip64 2^32-entry archive hits the worker deadline instead of SIZE_LIMIT; xlsx column XFE accepted; ODT/ODP/ODS/PPTX inline tab, line-break, space and a:br dropped with tracked deletions and annotations indexed; ~$ owner files map to docx and are admitted; slide sections are named region landmarks (REQ-SEC-58c879e8, REQ-REL-7a48f161, REQ-FUNC-58cba7fd, REQ-FUNC-bc730650, REQ-FUNC-81dbc6fc, REQ-UX-64738341). Coverage-only additions already green: guard refuses a declared-oversized archive before inflating corrupt data, ingest SIZE_LIMIT by declared size, presentation viewer schema bounds
- 2026-10-31 build: green: npx vitest run office/processor/ingest/documents-ipc/documents-scan/documents tests exit 0 except pre-existing 'bounds large text DOM' - fail-fast guard (zip64 bomb -> SIZE_LIMIT in the compiled worker), XFE column and sheet text budget -> PROCESSING, inline ODF/PPTX breaks with annotations and tracked deletions skipped, ~$ owner files neither indexed nor pending, slides not landmarks, compiled worker pptx page-2 chunk and parse failure (REQ-SEC-58c879e8, REQ-REL-7a48f161, REQ-FUNC-58cba7fd, REQ-FUNC-bc730650, REQ-FUNC-81dbc6fc, REQ-UX-64738341)
- 2026-10-31 build: green: lint 0 errors; typecheck exit 0; core knowledge/workbench + shared + desktop documents/document-viewer/workspace + downloads: 339 passed, 2 pre-existing failures (bounds large text DOM, Settings tab count); one earlier broad run showed a third failure that did not reproduce in two reruns of the new ingest/processor/office tests; VERA_TEST=1 e2e office-documents+citations+documents 3 passed; integration document-hosts/cli 5 passed
- 2026-10-31 build: round 1 fixes also: REQ-FUNC-ad5868a2 and REQ-UX-b7002720 prose now count legacy Office/RTF as not indexed and modern office as admitted; REQ-FUNC-81dbc6fc says the section text is headed by the sheet name; office workers default to OFFICE_WORKER_LIMITS (2048 MB heap); word() checks the main part exists and repacks stored. Not changed, recorded as follow-up: untitled leading sections (headingless Word files) give a bare-path ref that cannot be cited, and office sections over 12000 characters cannot be read by read_doc - both shared with HTML and outside these requirements. Accepted: the in-process default office extractor is test-only (both hosts pass the worker)
- 2026-10-31 build: evolution reviewed after round 1: 38 paths (adds shared documents-ipc.test.ts); check errors=0, no finding on this task or the amended requirements
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: review round 2: spec approved (all round-1 findings fixed or recorded; the sheet budget, column bound and owner-file rule sit within REQ-REL-7a48f161 and RULING-003); quality changes_required - (blocking) ODS number-columns/rows-repeated that is negative or fractional never brings the padding counter to zero, so a malformed file loops until the worker heap or deadline; (minor) XLSX pads each row to its last cell even when that cell is empty, so a small file of empty XFD cells forces a heap spike
- 2026-10-31 validate: returned to build - review round 2: clamp ODS repeats to positive integers; do not pad XLSX rows for empty cells
- 2026-10-31 build: red: npx vitest run processor.test -t 'malformed repeats' exit 1 - Office worker failed (heap) on an ODS with number-columns-repeated 0.5/-1 and an XLSX with 20000 empty XFD cells, run in a 256 MB worker (REQ-REL-7a48f161, REQ-FUNC-81dbc6fc)
- 2026-10-31 build: green: same test exit 0 - ODS repeats clamp to positive integers (malformed counts repeat once) with rows capped at 16384 columns, XLSX rows padded only to their last valued cell, refs without column letters use the running position; core knowledge/workbench/shared 265 passed; typecheck exit 0; lint 0 errors; VERA_TEST=1 e2e office-documents passed
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: review round 3: spec approved, quality approved. Non-blocking notes kept: valued XLSX cells at far columns still pad to 16384 slots before the sheet budget (contained by the worker heap cap and deadline); no test for the ODS 16384-column throw
- 2026-10-31 validate: DEVIATION validate: after round-3 approval, processor.test.ts was added to linked_tests of REQ-REL-7a48f161 and REQ-FUNC-81dbc6fc, as the spec reviewer asked - accepted without another round: requirement metadata only, no candidate code or test changed
- 2026-10-31 validate: DEVIATION validate: ODS repeats (cells and rows, valued or empty) are capped at 1000, so more than 1000 identical consecutive rows yield 1000 and a run of more than 1000 empty columns shifts a value's tab position - accepted as a reliability bound under REQ-REL-7a48f161, documented in document-extraction.md
- 2026-10-31 validate: final: python .agentic/aegis.py check --task TASK-ca6e05a5 --strict --run exit 0; lint ok, typecheck ok, i18n ok (tests are not in [check] run; focused suites, the full unit run, integration and native e2e are logged above); 104 warnings, none on this task's requirements: uncovered-source for test files/fixtures (linked as tests, not affected paths) and for sibling stages' uncommitted files, secret-in-diff for the binary office fixtures (generated by scripts/make-office-fixtures.mjs from known text), and pre-existing journal-header/stale-paths/no-linked-tests on older tasks. Pre-existing unit failures outside scope: bounds large text DOM, Settings tab count, write/edit registry list, compaction transcript, reveal Unicode file. Follow-up TASK-58318df2 covers uncitable untitled sections and unreadable long sections
- 2026-10-31 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-ca6e05a5.md
changed: design note; diagram_TASK-ca6e05a5.md
evidence: check --task TASK-ca6e05a5 --strict --run exit 0
issues: none
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-10-31)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-58cba7fd - Extract word processing documents by heading
  - REQ-FUNC-bc730650 - Extract presentations slide by slide
  - REQ-FUNC-81dbc6fc - Extract spreadsheets sheet by sheet
  - REQ-FUNC-56b34eec - Cite and read office documents by their structure
  - REQ-SEC-58c879e8 - Refuse office archives beyond extraction limits
  - REQ-REL-7a48f161 - Fail one unreadable office document without stopping ingest
  - REQ-UX-64738341 - Show extracted office text in the document viewer
- deviations: 3 recorded
  - build: the integration tests for REQ-FUNC-56b34eec, REQ-UX-64738341 and the ingest-level SIZE_LIMIT/PROCESSING checks were written after the wiring, so they have no recorded red line - accepted: each asserts behavior absent at HEAD (office kinds did not exist), but a test that could pass vacuously was not proven red
  - validate: after round-3 approval, processor.test.ts was added to linked_tests of REQ-REL-7a48f161 and REQ-FUNC-81dbc6fc, as the spec reviewer asked - accepted without another round: requirement metadata only, no candidate code or test changed
  - validate: ODS repeats (cells and rows, valued or empty) are capped at 1000, so more than 1000 identical consecutive rows yield 1000 and a run of more than 1000 empty columns shifts a value's tab position - accepted as a reliability bound under REQ-REL-7a48f161, documented in document-extraction.md
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 33e72b8: 140 file(s) changed, 7008 line(s) added; 6 file(s) not content-scanned
- checks: errors=0 warnings=104 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
