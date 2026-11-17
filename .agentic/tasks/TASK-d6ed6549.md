# TASK-d6ed6549 - VIEW-03 large text files read in windows (#288)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-ed0b45c5, REQ-UX-fe9ec5c2, REQ-UX-58cf59b2, REQ-REL-6fc27952, REQ-REL-3bb0b405, REQ-FUNC-61deffee, REQ-NFR-106002fa, REQ-UX-051512dc, REQ-UX-4edbbb03, REQ-REL-2c5c00b6
parent:
branch: master
base: c6ede1959372fd1c39b7411f35a4a40a6bb3d91b
opened: 2026-11-17

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

Problem: STATED (#288): text above 5 MiB is refused; large logs need windowed navigation.
Desired outcome: STATED: on-demand large text, byte scrollbar, progressive line indexing, approximate Go to line with exact settlement and cancellable windowed Find.
Actors: STATED: desktop workbench user.
Primary scenario: STATED: open a genuine 200 MB log, visit its end, find a late match and jump to a source line while the UI remains responsive.
Examples: STATED: VIEW-03-A/B; UTF8/UTF16 split boundaries and very long lines (coordinator).
Counterexamples: STATED: verified citations and rendered formats retain their established content; Hex/images/mode preference belong to later tickets.
In scope: STATED: #288, bounded decoded/window/index/search storage, four-locale interface/help/release notes and focused browser/native proof.
Out of scope: STATED: later VIEW packages, branches/worktrees, publication, whole suites and delivery artifacts.
Constraints: STATED: shared master, full base c6ede1959372fd1c39b7411f35a4a40a6bb3d91b; coordinator owns staging/local commit/issue closure. Preserve excluded workflow payload, user bundled-plugins and PERF TASK-9a4d3e8a. Owned ignored scratch evaluation-outputs/view03. Current contracts/format1; no compatibility or dependency tree.
Success signals: STATED: real Done A/B, bounded memory during indexing/search, current Display invalidation, focused failure proof, required statics and independent reviews.
Evidence: OBSERVED: HEAD equals base; VIEW02 committed c6ede195 and VIEW01 committed2a886177; dependency anchor complete before edits. tea issues288/285; file-viewer.md; reader/provider/TextViewer/useTextRows and VIEW02 proof.
Assumptions: OBSERVED after coordinator correction: byte confinement and native bindings are unchanged; verified citation transport adds source revision/newline metadata. Reuse VIEW01 confinement and packaging proof, and add focused host/protocol and platform metadata proof.
Unknowns: Native Ubuntu unavailable. Session performance calibration is deferred; existing architecture budget will be used if specified, otherwise report measured first-screen latency explicitly.
Decision-blocking questions: None; ticket and coordinator settle scope.
Proposed behaviors: None beyond accepted ticket.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| Compact verified citation source | REQ-FUNC-ed0b45c5 | hash-checked snapshot, sealed revision and original newline metadata | core/host/shared/UI/native citation proof |
| Established Find | REQ-UX-fe9ec5c2 | scalar matching-line counts and wrapping | model/UI/native citation |
| Escape focus | REQ-UX-58cf59b2 | focus body after closing field | UI/native citation |
| Window error recovery | REQ-REL-6fc27952 | parent Retry repeats full loader | UI failure/retry regression |
| Small text assembly consistency | REQ-REL-3bb0b405 | retain <=5MiB assembly; larger source descriptor | reader transition/failure tests |
| Read large text through on-demand byte windows | REQ-FUNC-61deffee | bounded renderer model | focused model/component and browser/native |
| Bound large text window and scan storage | REQ-NFR-106002fa | bounded renderer model | focused model/component and browser/native |
| Settle large-file line navigation from byte estimates | REQ-UX-051512dc | bounded renderer model | focused model/component and browser/native |
| Search large text incrementally with cancellation | REQ-UX-4edbbb03 | bounded renderer model | focused model/component and browser/native |
| Reject inconsistent large-file byte replies | REQ-REL-2c5c00b6 | bounded renderer model | focused model/component and browser/native |


## Design

### Approach
REQ-FUNC-61deffee: keep small-file/citation/rendered routes; ordinary text above 5 MiB returns a transient source descriptor. LargeTextViewer renders a64 KiB decoded window with measured virtual rows and a dedicated byte scrollbar; wheel/keyboard at window edges advances adjacent byte windows.
REQ-NFR-106002fa: source LRU holds at most four64 KiB windows; scan reads256 KiB (host limit1MiB). Sparse index records at most1026 checkpoints with stride derived from physical size, plus a single progressive cursor. Never retain whole-file decoded text or per-line offsets.
### Interfaces and data
REQ-REL-2c5c00b6: descriptor contains host-owned opaque path, owner, physical size, opening modified time and detected encoding. Every reply validates owner/path/offset/size/exact bytes; metadata is checked before publishing an operation. Display attempt remount disposes source/cache and aborts in-flight work.
REQ-UX-051512dc: byte navigation displays an estimate immediately, then a cancellable scan settles exact line identity. Go to line estimates from observed density then scans from sparse checkpoints to exact target; requests beyond EOF clamp to the last line. Index loops yield between bounded chunks.
REQ-UX-4edbbb03: Find counts matching source lines in decoded chunks, retaining query overlap and scalar first/last/selected hits; next/previous wraps with current/total counts without match lists. Cancel/superseding navigation/unmount invalidates pending work. UTF8 and UTF16 safe boundaries preserve split characters and lines; long source lines remain bounded fragments with continuation marks; Find retains its physical match column through wrapping.
### Files and test seams
New large-text-source/index/search/window/viewer modules with colocated model/component tests. Indexed plain-text tree entries select textPath directly, avoiding complete extraction replies. Existing reader/provider/tabs carry transient descriptor and clear it with Display refresh. useTextRows supports source-number offsets for measured windows. Browser/native large-text.spec.ts generates genuine 200 MB input and records latency, responsiveness, memory and DoneA/B. Four locales/help/release notes/README inventories updated in scope.
### Risks and open decisions
No native binding/packaging change; reuse VIEW01 confinement proof. Verified citation transport adds a compact descriptor after existing SHA/issued-provenance checks; readWindow captures exact stat date and revision (dev/ino/size/mtimeMs/ctimeMs). Display seals the revision to owner/path; reads compare it before disclosure and return bounded original newline ends so masking and CR/CRLF preserve cited lines. Hash-invalid or replaced sources fail closed. Verified utf8Log preserves NUL/control text. Pass cited start/end, source anchor, Escape focus and parent Retry to the large UI. A focused pinned Windows/WSL2 source-revision probe covers the changed host metadata risk. Long lines need bounded visible fragments. Sparse checkpoint count stays bounded even on newline-dense input; exact settlement can take time but stays cancellable and yields. No persisted source caches or format changes. Native Ubuntu unavailable; no new WSL2 host risk.
### Requirement map
The five requirement IDs above map directly to the named model/UI seams and focused proof. Opaque identity/live Display behavior remains host-owned.
Diagrams: [diagram_TASK-d6ed6549.md](diagram_TASK-d6ed6549.md)


## Log

- 2026-11-17 frame: journal opened
- 2026-11-17 frame: Authorization: user permits local commits; coordinator exclusively owns staging, commit and issue closure. Implementer delivers unstaged candidate against full base c6ede1959372fd1c39b7411f35a4a40a6bb3d91b. VIEW02 predecessor anchor complete before edits; excluded workflow, bundled-plugins and PERF preserved.
- 2026-11-17 frame: completed; next specify - Autopilot frame recorded; predecessor committed and anchor satisfied
- 2026-11-17 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-17 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-17 build: red: focused read-text-file.test.ts Vitest exit1 (1pass/1fail); large ordinary file retains whole extraction instead of window descriptor. Original evaluation-outputs/view03/red-reader.log; large-window behaviors require new model/UI.
- 2026-11-17 build: green: reader.log exit0 (2tests), model-initial.log exit0 (15tests): bounded windows/sparse variable-line navigation, UTF8/UTF16 split matching, long/dense lines, replacement offsets, reply consistency and cancellation. Real Done/browser/native proof in progress. Session calibration explicitly deferred by architecture08/PERF policy; no calibrated budget claim.
- 2026-11-17 build: red: red-indexed-route.log exit1 (1fail/18skip); indexed ordinary text requests complete docs.open extraction before byte windows. This violates the large-file renderer rule; route indexed text directly to textPath while rendered kinds and verified refs retain docs.open.
- 2026-11-17 build: red: red-long-column.log exit1 (1fail/12skip); long-line window lacks target column for visible Find settlement. Native repeated scan acceptance passed retained heap14.5-16.1MB, transient223.7MB and maxpulse92.3ms with Display refresh. Native diagnostic peak guard256MiB reflects measured bridge/GC high water; initial96MiB guard failed; no lower peak or approved budget claimed.
- 2026-11-17 build: green: focused-column.log exit0 (35tests), viewer-consumers.log exit0 (65tests), route-affected.log exit0 (3selected/16skip). Native current-source acceptance-column.log native1passed including genuine200MiB+6MiB-line, unindexed exact jump, end, late/repeated Find, cancellation, retained/peak heap, pulse and live Display during Find. Browser browser-column-final.log exit0 (1test), firstscreen279ms; measured right-edge fractional0.89px uses1px geometry tolerance. Native189ms; original receipts/screenshots/logs view03. No approved session budget claim.
- 2026-11-17 build: Build audit: frame/specify/design checklist content fulfilled in recorded sections before implementation; earlier advances left boxes unticked. Current requirements active, old small-assembly refusal requirement revised in place for the authorized large-file transition. Owned candidate41paths excludes preexisting workflow, bundled-plugins and PERF. Source/test/doc scope reviewed; no host/native/packaging or plugin changes.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: returned to build - Independent review and coordinator: bound verified large citation payloads; retain Escape focus, wrapping Find counters and tab Retry
- 2026-11-17 build: DEVIATION build: citation/shared revision implementation began from coordinator trace and independent findings before adding dedicated red citation tests; caught gap is concrete full-payload code trace. Add focused regression evidence now; do not invent a red run. Existing red long-column/reader/indexed route logs remain genuine.
- 2026-11-17 build: Scope correction from coordinator and round1: current Find counts/wrapping, Escape focus and tab Retry retained. New REQ-FUNC-ed0b45c5 covers compact verified citation descriptor, sealed owner/path revision and original newline positions. Read file-tools/ipc-boundary ownership pages; host-only snapshot metadata does not change read-tool output. Source-size/mtime restoration probe passes Windows and WSL2 Ubuntu on pinned Node24.21.0; original logs view03/source-probe-*-fixedtime.log. Native citation-ready.log exit0 (1test): 6,260,930-byte source, generic reply584bytes, actual read_doc-issued citation range250-251, counts/wrap/focus/live Display. Numeric-mtime Date rounding false conflict fixed using captured stat date; fractional regression added.
- 2026-11-17 build: green round2: acceptance-round2.log exit0 (browser/native2cases) genuine200MiB+6MiB-line, first265ms/166ms; retained browser29.1-29.8MB/native14.5-16.3MB, peaks80.0/217.7MB, pulse123.3/296.6ms. Current/total wrapping Find now scans with bounded scalar line counters. Native citation-ready.log exit0 (1case) covers compact584-byte generic reply, issued range250-251, counts/wrap/focus/Display. citation-regressions.log84passed; final-correction-focused.log21passed; verified-metadata-negative.log4passed/16skip; unchanged viewer-consumers65 passed. Source-probe-final-build and Windows/WSL2 logs exit0 with exact restored mtime and fractional stat date checks. No approved budget comparison claimed.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: Independent ROUND2 approvals: spec_review approved complete frozen62-file candidate and original proof; quality_review approved correctness/security/memory/concurrency and resolved all prior findings. No reviewer file edits or broad retesting. All current component/context/requirements/spec records reconciled; source diff against full base reviewed, owned scratch/processes closed.
- 2026-11-17 validate: DEVIATION validate: final proof uses candidate-only Biome plus individual typecheck/i18n/help/release-notes and strict AEGIS without --run, per coordinator instruction. Global lint baselines remain excluded: untracked bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. No global lint pass claimed. Full suites/native Ubuntu/delivery gates and approved session-budget calibration remain deferred; official-plugin suite is inapplicable to this app/host-only change. Reused unchanged VIEW01 confinement/native packaging proof; focused WSL2 metadata probe is distinct from native Ubuntu.
- 2026-11-17 validate: final: candidate Biome final-biome.log exit0, 35files/82 inherited CSS and suppression advisories/1info; final-typecheck/i18n/help/release-notes logs exit0. python .agentic/aegis.py check --task TASK-d6ed6549 --strict --full exit0, errors0 warnings66 notes38, strict ok. No --run per recorded scoped-proof deviation; no whole/global lint pass claimed. Warnings: excluded bundled zip/index scans/layout, existing oversize context/legacy requirement records, known help/release/CHANGELOG layout heuristics, test-file uncovered-source heuristics despite actual linked/running tests, and explicitly synthetic password fixtures. No real secrets. Frozen candidate and round2 approvals unchanged.
- 2026-11-17 validate: Final validation checklist audited and ticked; the earlier report snapshot preceded checkbox entry only. CLI diff includes93 total paths, of which31 are the preserved/excluded preexisting workflow and bundled payload; the owned candidate-paths/owned-manifest defines62 selected files. Final warnings include8 uncovered-source heuristics (test files/legacy records, not missing executed proof), 13 legacy journal-header, 12 legacy ticket references,16 layout,9 oversize context and8 synthetic/excluded scans. No source changes after round2 reviews/final proof. Owned profiles/workbenches/servers and probe temp roots cleaned; original proof logs kept. Coordinator exclusively owns local commit and issue closure.
- 2026-11-17 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-d6ed6549.md
changed: Completed62-file unstaged VIEW03 candidate; coordinator owns acceptance/local commit/#288 closure; SHA256 owned manifest and original view03 proof
evidence: Both independent ROUND2 approvals; candidate Biome/typecheck/i18n/help/release notes exit0; strict AEGIS exit0(0errors66warnings); focused84+corrections21+metadata4, browser/native200MiB2, nativecitation1 and Windows/WSL2 probes pass
issues: No calibrated session-budget comparison; native Ubuntu/full suites/exact-source delivery gates deferred. Known global lint baselines excluded. Native measured peak217.7MB. No staging/commit/publication by implementer.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-ed0b45c5 - Keep verified large-text citations on bounded sources
  - REQ-UX-fe9ec5c2 - Find text in a text document with Ctrl+F
  - REQ-UX-58cf59b2 - Go to a line with Ctrl+G
  - REQ-REL-6fc27952 - Show a document tab's load error with Retry
  - REQ-REL-3bb0b405 - Reject incomplete or changed small text byte reads
  - REQ-FUNC-61deffee - Read large text through on-demand byte windows
  - REQ-NFR-106002fa - Bound large text window and scan storage
  - REQ-UX-051512dc - Settle large-file line navigation from byte estimates
  - REQ-UX-4edbbb03 - Search large text incrementally with cancellation
  - REQ-REL-2c5c00b6 - Reject inconsistent large-file byte replies
- deviations: 2 recorded
  - build: citation/shared revision implementation began from coordinator trace and independent findings before adding dedicated red citation tests; caught gap is concrete full-payload code trace. Add focused regression evidence now; do not invent a red run. Existing red long-column/reader/indexed route logs remain genuine.
  - validate: final proof uses candidate-only Biome plus individual typecheck/i18n/help/release-notes and strict AEGIS without --run, per coordinator instruction. Global lint baselines remain excluded: untracked bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. No global lint pass claimed. Full suites/native Ubuntu/delivery gates and approved session-budget calibration remain deferred; official-plugin suite is inapplicable to this app/host-only change. Reused unchanged VIEW01 confinement/native packaging proof; focused WSL2 metadata probe is distinct from native Ubuntu.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base c6ede19: 93 file(s) changed, 4085 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=66 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-ed0b45c5 - Keep verified large-text citations on bounded sources
  - REQ-UX-fe9ec5c2 - Find text in a text document with Ctrl+F
  - REQ-UX-58cf59b2 - Go to a line with Ctrl+G
  - REQ-REL-6fc27952 - Show a document tab's load error with Retry
  - REQ-REL-3bb0b405 - Reject incomplete or changed small text byte reads
  - REQ-FUNC-61deffee - Read large text through on-demand byte windows
  - REQ-NFR-106002fa - Bound large text window and scan storage
  - REQ-UX-051512dc - Settle large-file line navigation from byte estimates
  - REQ-UX-4edbbb03 - Search large text incrementally with cancellation
  - REQ-REL-2c5c00b6 - Reject inconsistent large-file byte replies
- deviations: 2 recorded
  - build: citation/shared revision implementation began from coordinator trace and independent findings before adding dedicated red citation tests; caught gap is concrete full-payload code trace. Add focused regression evidence now; do not invent a red run. Existing red long-column/reader/indexed route logs remain genuine.
  - validate: final proof uses candidate-only Biome plus individual typecheck/i18n/help/release-notes and strict AEGIS without --run, per coordinator instruction. Global lint baselines remain excluded: untracked bundled-plugins/index.json and unchanged shared/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. No global lint pass claimed. Full suites/native Ubuntu/delivery gates and approved session-budget calibration remain deferred; official-plugin suite is inapplicable to this app/host-only change. Reused unchanged VIEW01 confinement/native packaging proof; focused WSL2 metadata probe is distinct from native Ubuntu.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base c6ede19: 93 file(s) changed, 4108 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=66 notes=38
- checklist: 9/9 done
