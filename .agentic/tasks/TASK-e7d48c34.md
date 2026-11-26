# TASK-e7d48c34 - Streamline verified plugin installation confirmation

stage: done
type: change
interaction: autopilot
requirements: REQ-FUNC-9a7cd113, REQ-FUNC-46079512, REQ-UX-e6056763, REQ-UX-acc04fbc, REQ-SEC-8e281f52
parent:
branch: master
base: bdd1fd55b9f125171470cc25bf08501ae7591974
opened: 2026-11-26

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
- [x] final strict result and focused proof logged per the repository verification policy
- [x] remaining warnings and pre-existing failures explained
- [x] `report` appended

## Frame

Problem: STATED. Install opens a second page repeating the plugin card.
Desired outcome: STATED. The user accepted direct install for verified official skills and documentation packages, compact confirmation for the remaining install paths, and concrete update changes.
Actors: STATED. A user installing or updating a Desktop plugin.
Primary scenario: STATED. Select Install for Analysis skills in the catalog.
Examples: OBSERVED. Analysis skills declares no programs or rules, with Markdown skills and templates.
Counterexamples: STATED. ZIP, folder, workbench trust and installs with dependencies retain confirmation.
In scope: OBSERVED. Work package in 00_Planning/plan/plugin-install-confirmation.md.
Out of scope: STATED. Workbench activation and the verified package and hash contract remain separate.
Constraints: OBSERVED. Work on master based on bdd1fd55 with the existing uncommitted user-directed UI edits preserved.
Success signals: INFERRED. One-click eligible install, inline confirmation where needed, concrete changed programs and rules, and refusal of changed packages.
Evidence: OBSERVED. Core catalog verifies remote signatures and package bytes, and supplies the existing update review decision.
Assumptions: INFERRED. Markdown skill templates and localized help form the documentation package.
Unknowns: None material to the accepted scope.
Decision-blocking questions: None.
Proposed behaviors: User accepted the preceding proposal.

## Requirement coverage

| Behavior | Requirement | Design |
| --- | --- | --- |
| Direct install for a verified official skills and documentation package | REQ-FUNC-9a7cd113 | Core classifies the verified catalog package |
| Catalog confirmation decision and explicit update differences | REQ-FUNC-46079512 | Core compares installed and proposed program and rule definitions |
| Compact confirmation with applicable risks and update differences | REQ-UX-e6056763 | Modal within the library with expandable details |
| Install and retry with exact package identity | REQ-UX-acc04fbc | Existing IPC requests and confirmation callbacks |
| Reject altered packages | REQ-SEC-8e281f52 | Existing catalog and store SHA-256 guards |

## Design

**Approach**. Classify archive paths from the validated package, using the verified catalog tier
and supported platform. Preserve mandatory review for unknown or broken installed packages.
Use the existing install action and digest in both paths.

**Interfaces and data**. Review returns an optional skills-and-documentation fact. Catalog review
returns update differences on changed programs and rules. These results are IPC only.

**Files and test seams**. The store owns archive classification. Catalog owns verification and
the review decision. The desktop renders a native modal above the mounted library.
Core catalog and desktop component tests exercise the behavior.

**Risks and open decisions**. Unknown package contents require confirmation. Catalog provenance,
byte validation and the kept zip lifecycle remain under existing catalog and store controls.

**Requirement map**. REQ-FUNC-9a7cd113 is owned by catalog policy. REQ-UX-e6056763 is
owned by the confirmation UI. REQ-UX-acc04fbc and REQ-SEC-8e281f52 reuse the existing
confirmed-hash install requests.

## Log

- 2026-11-26 frame: journal opened
- 2026-11-26 frame: completed; next specify - User accepted the installation proposal (7 Done checklist item(s) left unticked)
- 2026-11-26 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-26 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-26 build: red: focused catalog and renderer regressions exit 1 for missing direct install, update differences and compact confirmation
- 2026-11-26 build: green: pinned Vitest core, desktop and @vera/shared focused catalog/store/UI/IPC proof 125 passed; rerun of the two files after expanded coverage 48 passed. Browser help-plugins 1 passed. Typecheck, lint and i18n/help/release-note checks exit 0. Earlier default 5-second loopback timeout passed on the focused 20-second rerun. Strict development check found no errors; warnings report the mixed dirty checkout, repository layout and registry coverage debt.
- 2026-11-26 build: completed; next validate - Direct installs, compact confirmation and update differences are implemented. Proceed to independent reviews.
- 2026-11-26 validate: returned to build - Round 1 found invalid Markdown admitted, incorrect rule diffs on insertions, unavailable comparison copy, and missing source/scope in the modal.
- 2026-11-26 build: Round 1 fixes: direct admission validates UTF-8 and skill metadata/size; rule diff aligns unchanged definitions and reports positions; modal shows actual archive origin, local/workbench scope and unavailable comparison. Focused candidate tests for catalog, modal, pack and IPC passed within the 140 passing assertions; the existing unsafe-package test and mock suite timed out under concurrent load and are being rerun serially. Localization checks and lint passed.
- 2026-11-26 build: completed; next validate - Applied and exercised the four round 1 corrections; repeat both independent reviews. (6 Done checklist item(s) left unticked)
- 2026-11-26 validate: DEVIATION validate: strict without --run plus focused Vitest, Chromium and static checks - 02_Tools/verification-policy.md reserves the full app suite for milestones; the official plugin suite is separate.
- 2026-11-26 validate: Inspection: Wireshark manifest already declares capinfos as an external find dependency. The executable was absent from this process PATH and Program Files/Wireshark. Compact confirmation shows actual origin and scope and still exposes full program definitions in Details.
- 2026-11-26 validate: final static: pinned TypeScript build, lint, i18n, help and release-note checks exit 0; git diff --check exit 0; aegis check --task TASK-e7d48c34 --strict exit 0 (no errors; warnings cover existing registry/layout debt and the mixed checkout, including changed test files classified under source).
- 2026-11-26 validate: final focused proof: 165 tests across 8 files passed after serial retry of the store and mock suites; 4 Chromium browser tests passed after retry of renderer startup. The official-plugin suite passed 36 files and collected no tests in MQTT and Raspberry Pi due to missing paho-mqtt and asyncssh in default Python. Rerun of those files uses the existing pinned test Python.
- 2026-11-26 validate: Inspection follow-up: Windows registers Npcap 1.90, and the previous temporary Wireshark test kit contains signed capinfos 4.6.10. Its version output matches the external manifest dependency. The kit is outside the process PATH and standard Wireshark folder.
- 2026-11-26 validate: final official plugin proof: initial default-Python run exit 1 (36 passed files, 599 passed, 201 skipped); pinned test-Python retry of the two collection failures exit 0 (2 files, 77 passed). Combined 38 passing files, 676 passed and 201 skipped.
- 2026-11-26 validate: completed; next done
- 2026-11-26 done: User authorized committing the remaining desktop and plugin work locally on master before starting the file discovery corrections.

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e7d48c34.md
changed: Direct verified skills install, compact confirmation with provenance and scope, positioned update differences, localized help
evidence: 165 focused tests; 4 Chromium tests; 38 official-plugin files (676 passed, 201 skipped) across run and pinned-Python retry; typecheck, lint, texts and strict AEGIS exit 0.
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-26)

- stage: validate; type: change; branch: master
- requirements:
  - REQ-FUNC-9a7cd113 - Install verified official skills packages directly
  - REQ-FUNC-46079512 - Decide when a catalog install needs a review
  - REQ-UX-e6056763 - Review a plugin before installing it
  - REQ-UX-acc04fbc - Install the reviewed plugin
  - REQ-SEC-8e281f52 - Install only the reviewed package
- deviations: 1 recorded
  - validate: strict without --run plus focused Vitest, Chromium and static checks - 02_Tools/verification-policy.md reserves the full app suite for milestones; the official plugin suite is separate.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base bdd1fd5: 78 file(s) changed, 1935 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=91 notes=44
- checklist: 9/9 done
