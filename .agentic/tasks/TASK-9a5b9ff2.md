# TASK-9a5b9ff2 - VIEW-02 Text mode with word wrap and encodings (#287)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-c5def0c3, REQ-UX-5a886e34, REQ-UX-77baabba, REQ-REL-3bb0b405
parent:
branch: master
base: 2a886177455e1c2adc669072b768e7af50f62367
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

Problem: STATED (#287): text has no wrapping and non-UTF8 files are refused.
Desired outcome: STATED: small ordinary text files support BOM detection, selected encodings, explicit replacement decoding and measured wrapped navigation.
Actors: STATED: desktop workbench user.
Primary scenario: STATED: open a Latin-1 or BOM UTF16 file, select an encoding, wrap and find/jump to a distant source line.
Examples: STATED: VIEW-02-A Latin-1 and UTF16 BOM; VIEW-02-B wrapped Find and Go to line.
Counterexamples: STATED: rendered PDF/Markdown/Office and verified citations retain their existing behavior.
In scope: STATED: #287 and four-locale interface/help/release notes; bounded byte assembly only for current small-file limit.
Out of scope: STATED (coordinator): VIEW03 large-file windowing, Hex/mode persistence/images, packaging, full suites and remote publication.
Constraints: STATED: shared checkout master, complete candidate reviewed against base 2a886177455e1c2adc669072b768e7af50f62367. Coordinator owns staging, authorized local commit and issue closure; implementer never commits. User authorized local commits via AGENTS.md. Preserve unrelated workflow payload, bundled-plugins and PERF TASK-9a4d3e8a. Owned scratch: 05_Software/evaluation-outputs/view02. Formats remain 1; no dependency tree or compatibility additions.
Success signals: STATED: both ticket Done criteria proven in browser and native UI; focused failures/recovery and retained citation/Display behavior, required statics, independent spec/quality reviews and strict AEGIS.
Evidence: OBSERVED: tea issues 287 and 285 --comments --login ddp --repo dpasare/2026_Virtual_Embedded_Rig_Assistant; file-viewer.md; viewer-context.tsx, text-viewer.tsx, tree.ts and display-documents.ts. HEAD equals assigned base and VIEW01 is complete (TASK-64079701); dependency anchor satisfied before edits.
Assumptions: INFERRED: retain existing UTF8/citation paths and add renderer-owned bytes for ordinary file text; host remains sole path and masking authority.
Unknowns: native Ubuntu unavailable; WSL2 is separate evidence. No new platform-native functionality is planned.
Decision-blocking questions: None; authoritative ticket and coordinator settle scope.
Proposed behaviors: None beyond accepted #287.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| BOM and selected decoding | REQ-FUNC-c5def0c3 | renderer bytes plus TextDecoder | encoding/reader/component + browser/native |
| Explicit invalid-byte text | REQ-UX-5a886e34 | strict decode then explicit replacement | encoding/component + browser/native |
| Wrapped navigation | REQ-UX-77baabba | measured virtual rows and target correction | component + browser/native geometry |
| Bounded consistent assembly | REQ-REL-3bb0b405 | stat + sequential <=1MiB windows | reader refusal cases |


## Design

### Approach
OBSERVED: docs.readBytes already enforces confinement and live byte masking; reuse it unchanged.
REQ-FUNC-c5def0c3: assemble only ordinary small-file text bytes in renderer; TextDecoder detects BOM or uses selected encoding. Keep source bytes renderer-local, outside shared/persisted contracts.
REQ-UX-5a886e34: strict default decoding; invalid/NUL content offers explicit replacement decoding. Changing encoding retries strict decoding.
REQ-UX-77baabba: virtual rows measure mounted DOM heights, retain estimates for unseen rows, and settle requested source-line positions after measurement; preserve visible source anchor on width/font/wrap changes. No all-lines DOM or approximate characters-per-row formula.
### Interfaces and data
REQ-REL-3bb0b405: docs.stat validates <=5MiB then sequential <=1MiB docs.readBytes replies must match owner/path/offset/size and exact byte count, followed by matching final stat mtime; errors use existing textTooLarge/CONFLICT/NOT_FOUND contracts. This is bounded small-file assembly, not VIEW03 streaming.
Ordinary textPath reads return existing text ViewerContent plus renderer-owned Uint8Array. Ordinary docs.open path results of kind text gain bytes within 5MiB; larger already-supported indexed extractions retain their original content without encoding controls; ref/citation, run, artifact, download and rendered payloads retain their authorized path and content. No extra citation re-read. Live Display refresh clears both text and bytes and remounts the attempt.
### Files and test seams
Encoding/reader helpers with colocated tests; text-viewer and use-text-rows for controls/measured scrolling; viewer-context/document-tabs pass transient bytes. Browser mock readBytes/stat use consistent fixture bytes; tests/e2e/text-encodings.spec.ts exercises browser and native. Locales, help, release notes, READMEs, plan and current knowledge track delivered behavior.
### Risks and open decisions
Unknown row heights require a pending navigation target to settle after DOM measurement; source-line numbers remain stable. Resize/font changes invalidate row measurements. Existing host Display byte masking stays authoritative; never decode original content outside that host. No new dependencies, native bindings, stored formats or packaging changes. Native Ubuntu unavailable; reuse unchanged VIEW01 host/native proof.
### Requirement map
All four requirements map to the decisions and focused tests above. Existing citations, tabs, Display and 5MiB constraints are retained.
Diagrams: [diagram_TASK-9a5b9ff2.md](diagram_TASK-9a5b9ff2.md)


## Log

- 2026-11-17 frame: journal opened
- 2026-11-17 frame: Authorization: user permits local ticket commits; coordinator exclusively owns staging/commit/issue closure. Implementer hands back uncommitted candidate on master, full base 2a886177455e1c2adc669072b768e7af50f62367. VIEW01 anchor complete before edits. Excluded workflow payload, bundled-plugins and PERF preserved.
- 2026-11-17 frame: completed; next specify - Autopilot scoped VIEW-02 frame recorded; predecessor anchor complete (7 Done checklist item(s) left unticked)
- 2026-11-17 specify: completed; next design
- 2026-11-17 design: completed; next build
- 2026-11-17 build: red: focused text-viewer.test.ts Vitest exit 1; UTF16 BOM rendered blank instead of cafe (REQ-FUNC-c5def0c3, REQ-UX-5a886e34). Original evaluation-outputs/view02/red-text.log
- 2026-11-17 build: green: text-viewer.test.ts exit 0 (1 test): BOM, selected Latin encodings, explicit replacement. red: same focused file exit 1 (1 pass/1 fail), missing wrap control (REQ-UX-77baabba); original logs in view02.
- 2026-11-17 build: green: text-viewer.test.ts exit 0 (2 tests), wrapped measured distant navigation. red: read-text-file.test.ts exit 1; non-UTF8 ordinary file still refused instead of byte assembly (REQ-REL-3bb0b405). Original view02 logs retained.
- 2026-11-17 build: green: reader component exit 0 for bounded assembly and owner/path/offset/size/short/large refusals. Consumer run: 65 passed, 2 fixture expectations corrected for added text-samples and actual mock byte size; docs timeout cascade cleared by serial 15s test allowance. Browser caught wrap-off clamp; source anchor corrected.
- 2026-11-17 build: Done A/B: browser-fixed.log exit0 (1 browser case) and native.log exit0 (1 native case), Latin1/UTF16 BOM, encoding switches, invalid replacement, measured distant Find/Go to line, wrap/resize and live stored-credential Display bytes/opaque path. Native build exit0 with existing chunk-size advisory. Focused 22/22 exit0; original logs/receipts/screenshots view02. Existing verified large indexed text is preserved without byte controls until VIEW03.
- 2026-11-17 build: completed; next validate
- 2026-11-17 validate: Frame checklist completion audited: the seven frame items were fulfilled in recorded Frame before implementation; first advance omitted ticking them. Candidate hunk review completed; all changed source stays within VIEW02. Reviewed evolution excludes preexisting workflow and unrelated sources. Current knowledge/context/plan reconciled; no plugin or packaging changes.
- 2026-11-17 validate: Independent round1 reviews approved: spec_review and quality_review, complete owned tracked/untracked candidate against base2a886177455e1c2adc669072b768e7af50f62367; no findings. Both inspected actual original proof and current source/tests; final static evidence follows.
- 2026-11-17 validate: Statics: final-biome.log exit0 (20 owned files, 82 CSS/suppression advisory warnings), final-typecheck.log exit0, final-i18n.log exit0, final-help.log exit0, final-release-notes.log exit0. final-focused.log exit0:22 tests in decoder/text/reader/boundaries; consumer logs retained. No whole suites or plugin/packaging changes.
- 2026-11-17 validate: DEVIATION validate: use candidate Biome plus individual typecheck/i18n/help/release-notes and strict AEGIS without --run. Coordinator explicitly excludes global lint errors in untracked bundled-plugins/index.json and unchanged shared/src/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. No claim of global lint pass. Full app/plugin/E2E and delivery gates user-deferred; plugin suite inapplicable to app-only change; native Ubuntu unavailable. Reuse VIEW01 unchanged Windows/WSL2 confinement/six-encoding boundary and native/packaging proof.
- 2026-11-17 validate: final: python .agentic/aegis.py check --task TASK-9a5b9ff2 --strict exit0, errors0 warnings57 notes38. No --run per recorded scoped-proof deviation. Warnings: excluded bundled/plugin binary scans and workflow/legacy records, existing oversize context pages, required help/release/changelog outside configured globs, synthetic password literal in native fixture (no real secret). Candidate Biome exit0 with82 advisory style/suppression warnings. final-tabs.log exit0 (6 selected pass/26skip); final-focused.log22pass; previous tree18/documents14/tabs32 passing proof retained for unchanged paths. Native profile/workbench and browser server cleaned by owned test finally blocks; original diagnostics/logs retained. Final SHA256 owned-manifest.json will record38 owned candidate files plus separate original proof hashes in evaluation-outputs/view02.
- 2026-11-17 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-9a5b9ff2.md
changed: VIEW-02 text decoding, explicit replacement and measured wrapping; four-locale docs; 38 owned candidate files, uncommitted
evidence: Strict AEGIS exit0; candidate Biome/typecheck/i18n/help/release notes exit0; final-focused22 and tabs6 passed; browser1/native1 Done A/B; independent spec/quality approved round1
issues: Global lint excluded known unrelated baseline; native Ubuntu unavailable; full suites/delivery gates deferred. Coordinator owns staging/local commit/#287 closure.
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-17)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-c5def0c3 - Decode small file text using BOM or selected encoding
  - REQ-UX-5a886e34 - Explicitly show invalid file bytes as replacement text
  - REQ-UX-77baabba - Navigate measured wrapped text rows
  - REQ-REL-3bb0b405 - Reject incomplete or changed small text byte reads
- deviations: 1 recorded
  - validate: use candidate Biome plus individual typecheck/i18n/help/release-notes and strict AEGIS without --run. Coordinator explicitly excludes global lint errors in untracked bundled-plugins/index.json and unchanged shared/src/workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b. No claim of global lint pass. Full app/plugin/E2E and delivery gates user-deferred; plugin suite inapplicable to app-only change; native Ubuntu unavailable. Reuse VIEW01 unchanged Windows/WSL2 confinement/six-encoding boundary and native/packaging proof.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 2a88617: 69 file(s) changed, 2444 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=57 notes=38
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
