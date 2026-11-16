# TASK-d2b9147b - CAD-03 electrical-documentation: material, connection, cable, terminal, label and I/O lists, table of contents, change report, CSV/XLSX/PDF exports (#135)

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-aa83ed5c, REQ-DATA-9ca17c7a, REQ-FUNC-68911c98, REQ-FUNC-9a06c922, REQ-FUNC-e7ad9a1c, REQ-FUNC-df08e0a4, REQ-FUNC-59134b83, REQ-FUNC-cc872eff, REQ-FUNC-3d4e6392, REQ-REL-500b461c, REQ-FUNC-c0be3443, REQ-FUNC-359d4b0a, REQ-TEST-e9acd927, REQ-SEC-4dfa2a5b, REQ-UX-d32cc9db
parent:
branch: feature/123-electrical-schematics
base: 4ad6b8f9933dd44d5b2ed9d151abf5a5162654fb
opened: 2026-11-16

Edit Frame, Requirement coverage and Design directly. Write State, Log and
Rulings with `python .agentic/aegis.py` (advance, pause, log, ruling, verdict);
end each session with `advance` or `pause`.

## Done checklist (current stage)

- [x] diff reviewed against scope, requirements, design, error paths,
      portability, security and unrequested work
- [x] knowledge pages of changed components current with the reviewed code
- [x] project and environment context reconciled with the candidate
- [x] requirements re-read: status, prose, verification, paths and links true
- [x] manual or inspection verification recorded where applicable
- [x] explicit review approved, when enabled
- [x] final `check --strict --run` result logged truthfully after the last edit
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: VERA has the electrical model, motor_drives assemblies, QElectroTech schematics and a panel result (BOM,
strips), but no project documentation derived from them: no material, connection (wire), cable, terminal, label or
I/O list, no table of contents, no change report and no check that these documents agree with each other; the only
exports are the panel BOM CSV and layout SVG (OBSERVED: core src/electrical has no documentation code;
electrical-schematics.md lists CAD-03 planned and "wiring and cable lists and document exports belong to CAD-03").
Desired outcome: plugin `electrical-documentation` (ecosystem electrical, PolyForm NC, help en/ro/de/fr, pack
"Electrical schematics and panels") with product code in core and tools gated on its own plugin ID (STATED: brief).
One write tool derives the lists from the model, a panel_engineering_check result and the identified .qet schematics,
each row traceable to its source (file sha256), checks duplicates, missing references and connections, wire-end
numbering and the device -> physical terminal -> I/O address -> tag chain (PLC tags only from the model or an
explicitly named import file), and stores one new result carrying the project's logical revision (from the model, never
invented) and the model hash; differences are criteria, sources are never changed. A change report names the affected
objects and stale upstream results. Exports CSV, XLSX and PDF of a stored run as new files through the write flow;
nothing is printed, ordered or sent (STATED: ticket CAD-03, brief).
Actors: the agent with the plugin loaded; the engineer who keeps the model, panel and schematics and approves results
and exports (STATED: ticket).
Primary scenario: plant M (fixture) with network, protection and motor_drives runs, numbered M1 DOL and M2 star-delta
schematics, a panel result and model documentation objects (document with revision, PLC A1 I/O, tags, terminals, cable
ends); the agent runs the documentation check, reads the lists, exports CSV/XLSX/PDF; after a planted change the next
run's change report lists the affected rows and objects and the stale results (INFERRED: from CAD-03-A..D).
Examples: wire 101 between X0:1 and Q1:1 in m1.qet appears in the connection list with source
`qet:schematics/m1.qet@sha256:<hex>#c<n>` and as two wire-end labels; io I0.0 of A1 with tag M1_Running and terminal
A1:I0.0 fed by KM1-M1 forms a complete chain; a tag file entry M1_Running at %I0.1 is a mismatch (INFERRED: fixture
design). No real project data was supplied by the user.
Counterexamples: renumbering a wire in the .qet to make lists agree; a revision "A" or author made up by VERA when the
model states none; an export printed or e-mailed; a PLC tag read from a TIA/CODESYS project through an SDK (STATED:
ticket).
In scope: shared result section `documentation` (lists, revision, change report) in the result schema at format 1;
core pure engine (list derivation, checks, change report), file reading of the tag import (CSV), tools (check, views,
export), CSV/XLSX/PDF writers without a new dependency if possible; fixtures derived from the CAD-01/CAD-02 fixtures
with planted defects; plugin package, skill, help, pack, catalog; i18n tool texts; spec, requirements, knowledge, plan
page, CHANGELOG, release notes.
Out of scope: printing labels, supplier orders, sending documents (STATED: ticket); PLC SDK access (STATED: ticket);
EPLAN (CAD-04); editing sources to fix differences (STATED: ticket); 3D or panel drawings beyond CAD-02's SVG.
Constraints: formats stay version 1, no migrations (STATED: CLAUDE.md); reuse model, result-change/commitChange/write
queue, PathGuard, QET reader and checks, panel result (STATED: brief); one small pinned permissive dependency per format
only when nothing fits (STATED: brief); targeted tests; no commit (STATED: brief).
Success signals: CAD-03-A..D focused tests green on the reference fixture and its planted defects; sources byte-identical
after every run; XLSX and PDF opened and inspected as rendered images; lint, typecheck, check:i18n, check:help,
check:release-notes green.
Evidence: ticket F:/ProjectsDDP/VERA_Electrical_Automation_Plugins_Tickets/CAD-03.md; plan file (results folder may
hold CSV/PDF next to result.json, exports state model hash and catalog version); electrical-schematics.md; knowledge
electrical-model.md; core package.json has fflate 0.8.3 (MIT) and no XLSX/PDF writer; root devDependency pdfkit 0.20.2
is for test PDFs only (OBSERVED: package.json files).
Assumptions: the logical revision is the `revision` attribute of a model `document` object named in the request
(INFERRED: the model has document objects; the ticket forbids inventing revisions); a terminal ref `<strip>:<point>`
names a panel strip and point (INFERRED: CAD-02 strips have tags and counts).
Unknowns: real numbered QElectroTech projects and a real vendor tag export are not available; the fixture uses
self-numbered candidates and a declared generic CSV tag file.
Decision-blocking questions: none (scope, fixtures, no commit and test scope decided by the user 2026-11-15; dependency
rule in the brief).
Proposed behaviors: as in Desired outcome.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | new tools and plugin |
| no new interface or data format | no | result `documentation` section, tag import CSV, exports |
| no new dependency | unknown | decided in design (fflate already present) |
| an existing requirement already covers the behavior | no | no documentation requirement |
| no security or data-handling change | no | reads workbench files, writes result and export files |

## Requirement coverage

| Behavior | Requirement | Status |
|---|---|---|
| strict request and result documentation section | REQ-DATA-aa83ed5c | new |
| strict tag import file | REQ-DATA-9ca17c7a | new |
| traceable lists from model, panel and schematics (CAD-03-A) | REQ-FUNC-68911c98 | new |
| numbering, wire ends, duplicate connections (CAD-03-B) | REQ-FUNC-9a06c922 | new |
| missing references, assembly connections, cable ends (CAD-03-B) | REQ-FUNC-e7ad9a1c | new |
| device - terminal - I/O address - tag chain, tag file (CAD-03-B) | REQ-FUNC-df08e0a4 | new |
| logical revision from the model, revision conflicts (CAD-03-C) | REQ-FUNC-59134b83 | new |
| change report against a previous run (CAD-03-D) | REQ-FUNC-cc872eff | new |
| result through the prepared change; nothing printed, ordered or sent (CAD-03-D) | REQ-FUNC-3d4e6392 | new |
| refusals before any change | REQ-REL-500b461c | new |
| CSV/XLSX/PDF exports with controlled header (CAD-03-C) | REQ-FUNC-c0be3443 | new |
| live changes view | REQ-FUNC-359d4b0a | new |
| reference fixture with planted defects | REQ-TEST-e9acd927 | new |
| tool gating on plugin electrical-documentation | REQ-SEC-4dfa2a5b | revised |
| tool descriptions in the tools editor | REQ-UX-d32cc9db | revised |

## Design

**Approach**: like CAD-02, a pure engine `analyzeDocumentation` in core electrical/documentation.ts builds one
ElectricalResult with an optional strict `documentation` section (shared electrical-model.ts, format 1 changed in place,
REQ-DATA-aa83ed5c); documentation-tool.ts reads the files (model, panel result, its panel file and motor_drives result,
.qet files through `readQetFile`, the tag file, the previous run, `listResults`) and stores the result through
`prepareResultChange` (REQ-FUNC-3d4e6392). Checks reuse CAD-01 `projectChecks`/`assemblyChecks` and the panel result's
BOM instead of re-deriving them (brief: build on what exists). Exports live in documentation-export.ts: CSV, XLSX
written with fflate (already a core dependency, MIT) and a small own PDF 1.4 writer with the standard Courier fonts, so
no dependency is added; pdfkit (root devDependency for test PDFs) was rejected because it would add fontkit and its
tree to the packaged app. Rejected: storing lists only as export files (the change report needs the stored rows).
**Interfaces and data**: tools `electrical_documentation_check` (write) {panelRun, schematics?, document?, tags?,
previousRun?}, `electrical_documentation` (read) {view list {runId, list, offset?} | changes {runId}},
`electrical_documentation_export` (write) {runId, format csv|xlsx|pdf, list?} -> one new file in the run folder through
`commitChange` (before = absent). Errors: refusals before preparing (REQ-REL-500b461c); stale upstream results are
criteria (REQ-FUNC-cc872eff). Tag file parsed by `parseTagFile` (REQ-DATA-9ca17c7a). Revision from the model document
object only (REQ-FUNC-59134b83). Panel.ts `csvField` is exported for reuse (one CSV quoting rule).
**Files and test seams**: shared electrical-model.ts (section schema, list names/columns); core
electrical/documentation.ts, documentation-export.ts (documentation.test.ts: tag file, section schema, CSV/XLSX/PDF
bytes), documentation-tool.ts (documentation-tool.test.ts: upstream chain on plant M, lists, planted defects, revision,
change report, list/changes views, refusals, exports); fixtures tests/fixtures/electrical-documentation (model, tag
file); the candidates are numbered in the tool test by its `numbered()` generator; registration in tools.ts, registry, changes.ts,
result-change.ts, shared tools/events/session-state, desktop workbench-tools + 4 locales, index.ts; plugin package,
packs, catalog, CONTRIBUTING; tests registry/write-edit/electrical-model/prepare-plugins lists.
**Risks and open decisions**: binary exports have no text diff: the preview shows size and sha256. PDF text is limited
to WinAnsi (other characters become `?`); headers are English like the CAD-02 exports. Result size stays under 4 MiB by
the 2000-row list cap. No open product decision.
**Requirement map**: REQ-DATA-aa83ed5c section schema + request schema; REQ-DATA-9ca17c7a parseTagFile + readTagFile;
REQ-FUNC-68911c98 list builders; REQ-FUNC-9a06c922 schematic checks; REQ-FUNC-e7ad9a1c device-refs, assembly, cable-ends;
REQ-FUNC-df08e0a4 io-chain, tag-file; REQ-FUNC-59134b83 revision; REQ-FUNC-cc872eff changes section; REQ-FUNC-3d4e6392
prepareResultChange; REQ-REL-500b461c tool refusals; REQ-FUNC-c0be3443 export tool + writers; REQ-FUNC-359d4b0a changes
view; REQ-TEST-e9acd927 fixtures and generator; REQ-SEC-4dfa2a5b gating; REQ-UX-d32cc9db locales.

## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: Frame recorded under autopilot; commits by the coordinator only (brief), user authorization for local commits recorded in AGENTS.md
- 2026-11-16 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: Dependency decision: no new npm dependency; XLSX with fflate 0.8.3 (MIT, already a core dependency), PDF by an own minimal PDF 1.4 writer with standard Courier fonts; pdfkit rejected (root devDependency, would pull fontkit tree into the packaged app)
- 2026-11-16 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-16 build: red: npx vitest run documentation.test.ts documentation-tool.test.ts exit 1 - 22 failed: documentation exports, tag file, section schema and tools missing (REQ-DATA-aa83ed5c, REQ-DATA-9ca17c7a, REQ-FUNC-68911c98, REQ-FUNC-9a06c922, REQ-FUNC-e7ad9a1c, REQ-FUNC-df08e0a4, REQ-FUNC-59134b83, REQ-FUNC-cc872eff, REQ-FUNC-3d4e6392, REQ-REL-500b461c, REQ-FUNC-c0be3443, REQ-FUNC-359d4b0a, REQ-SEC-4dfa2a5b)
- 2026-11-16 build: green: npx vitest run documentation.test.ts documentation-tool.test.ts exit 0, 22 tests (REQ-DATA-aa83ed5c, REQ-DATA-9ca17c7a, REQ-FUNC-68911c98, REQ-FUNC-9a06c922, REQ-FUNC-e7ad9a1c, REQ-FUNC-df08e0a4, REQ-FUNC-59134b83, REQ-FUNC-cc872eff, REQ-FUNC-3d4e6392, REQ-REL-500b461c, REQ-FUNC-c0be3443, REQ-FUNC-359d4b0a, REQ-SEC-4dfa2a5b)
- 2026-11-16 build: Manual visual check (REQ-FUNC-c0be3443): exports of the plant M reference kept with VERA_DOC_EXPORT_DIR; PDF pages rendered to PNG with the repository's pdfjs-dist 6.4.299 + @napi-rs/canvas (scratch script) and inspected: 11 pages, contents page with page numbers and sources, header project/revision B/run/generated/model sha256 and Page n / total on every page, column headers repeated; fixed: a 48-character column cap cut text with free room. XLSX opened by LibreOffice Calc (headless --convert-to pdf, no load error) and openpyxl 3.1.5 (7 sheets, freeze A10, auto filter, revision B), the Calc PDF rendered and inspected; fixed: long Sources/source values spread the print over 66 tiny pages - header values now merged across the table, source column wrapped, landscape fit to width (16 pages, legible). PDF Tools MCP could not read the scratchpad (allowed folders only).
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: review round 1: spec approved with should-fix records (REQ-FUNC-cc872eff/359d4b0a/REQ-DATA-9ca17c7a verification prose vs tests, design note file names, list view without spec line/test, PDF sources wording, limits:<list> naming); quality changes_required: cells/keys not clamped to schema limits, long paths lose the sha in sources, duplicate row keys collapse change rows and duplicate schematic paths, CSV text after closing quote accepted, XLSX zip time zone dependent, generic 4 MiB hint, unbounded fileHashes read, silent input truncation, invisible literals
- 2026-11-16 validate: returned to build - review round 1 findings (quality changes_required)
- 2026-11-16 build: red: npx vitest run documentation.test.ts documentation-tool.test.ts exit 1 - strict quotes in the tag CSV and duplicate schematic path refusal missing (REQ-DATA-9ca17c7a, REQ-REL-500b461c)
- 2026-11-16 build: green: npx vitest run documentation, documentation-tool, panel-tool, network-tool, results, qet-tool, registry, write-edit, sessions/electrical-model, workbench-tools, packaging/prepare-plugins exit 0 (73 passed, 1 skipped); typecheck, lint, check:i18n, check:help, check:release-notes exit 0 - round 1 fixes: strict CSV quotes, refused duplicate schematic path, list/changes views tested, cells/keys/sources clamped with limits:<list>, unique keys, 120-char paths, local-time zip mtime, bounded fileHashes, input truncation message, generic 4 MiB hint (REQ-DATA-9ca17c7a, REQ-REL-500b461c, REQ-FUNC-359d4b0a, REQ-DATA-aa83ed5c)
- 2026-11-16 build: DEVIATION build: the clamping of over-long cells/keys/sources in finishList has no dedicated test (the plant M reference never reaches the limits) - accepted as a defensive limit; covered by the schema checks of every stored result
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: final: python .agentic/aegis.py check --task TASK-d2b9147b --strict --run exit 0; ran lint, typecheck, check:i18n, check:help (all ok), strict ok; remaining warnings: pre-existing journal-header records of other tasks, uncovered-source for registration/test-list files, plugin help and CONTRIBUTING (no requirement lists them, same as CAD-02), outside-layout for CHANGELOG and release notes (repository convention). Focused tests ran before (11 files, 73 passed, 1 skipped); full suite not run by the coordinator's instruction (after CAD-04).
- 2026-11-16 validate: Inspection (REQ-TEST-e9acd927): tests/fixtures/electrical-documentation holds plant-m-doc.json and tags-plant-m.csv with a README entry; documentation-tool.test.ts numbers the qelectrotech_change candidates in place (numbered()) and plants each defect as a visible edit; all fixture data fictional and self-authored.
- 2026-11-16 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-d2b9147b.md
changed: plugin electrical-documentation: core documentation.ts, documentation-export.ts, documentation-tool.ts + tests, shared documentation section, registrations, plugin package, fixtures, docs; 37 files
evidence: check --task TASK-d2b9147b --strict --run exit 0; focused vitest 11 files exit 0 (73 passed, 1 skipped); review round 2 spec approved, quality approved
issues: CAD-03-A partly: no numbered project saved by QElectroTech nor real vendor tag export; not run on WSL2/native Ubuntu; exports English, PDF WinAnsi only; full suite deferred to after CAD-04
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-16)

- stage: validate; type: feature; path: full; branch: feature/123-electrical-schematics
- requirements:
  - REQ-DATA-aa83ed5c - Accept only a strictly valid documentation request and result section
  - REQ-DATA-9ca17c7a - Read a declared tag import file strictly or refuse it
  - REQ-FUNC-68911c98 - Derive traceable documentation lists from the model, the panel and the schematics
  - REQ-FUNC-9a06c922 - Check conductor numbering, wire ends and duplicate connections per schematic
  - REQ-FUNC-e7ad9a1c - Report missing device references, assembly connections and cable ends
  - REQ-FUNC-df08e0a4 - Check the device, terminal, I/O address and tag chain of every I/O
  - REQ-FUNC-59134b83 - Carry the stated logical revision and flag revision conflicts
  - REQ-FUNC-cc872eff - Report changed rows, affected objects and stale results against a previous run
  - REQ-FUNC-3d4e6392 - Store the documentation result through an approved prepared change, sources untouched
  - REQ-REL-500b461c - Refuse a documentation run on missing, foreign or invalid inputs
  - REQ-FUNC-c0be3443 - Export a stored documentation run as CSV, XLSX or PDF new files
  - REQ-FUNC-359d4b0a - Show the live changes since a stored documentation run
  - REQ-TEST-e9acd927 - Reference documentation fixture with planted defects and visual export check
  - REQ-SEC-4dfa2a5b - Offer the electrical tools only to hosts that enable them, never the change tool read-only
  - REQ-UX-d32cc9db - Describe the electrical tools in the workbench tools editor
- deviations: 1 recorded
  - build: the clamping of over-long cells/keys/sources in finishList has no dedicated test (the plant M reference never reaches the limits) - accepted as a defensive limit; covered by the schema checks of every stored result
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 4ad6b8f: 60 file(s) changed, 4960 line(s) added
- checks: errors=0 warnings=45 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
