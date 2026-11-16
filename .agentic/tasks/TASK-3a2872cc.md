# TASK-3a2872cc - TERM-04 Commands in the Runs tab (#315)

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-f3346881, REQ-DATA-7373a118, REQ-UX-57f1b52c, REQ-FUNC-f6d521b6, REQ-SEC-96d0e13d, REQ-FUNC-8c38d223
parent:
branch: master
base: bcae0e6e64deeba94cee5dfa71965839a2a70613
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

Problem: STATED #315: users must see and stop commands the agent runs.
Desired outcome: STATED #315: Runs displays the actual command, working folder, live output, exit code and duration, with Stop and full logs in the existing viewer.
Actors: STATED: desktop user and agent session.
Primary scenario: STATED TERM-04-A: agent starts a background server; user sees live output and stops it from Runs; next program_output reports stopped.
Examples: STATED delegation: real sibling-folder server under Bypass or added-folder authority, readiness and whole-tree termination.
Counterexamples: OBSERVED command-tools.ts labels commands vera/shell; these labels must not classify an actual declared plugin as a command.
In scope: STATED only TERM-04 #315 and immediate metadata, viewer, localized help and proof consumers.
Out of scope: STATED terminal/PTY, TERM-05, full suites, publication, staging and commits in this implementation chat; unrelated PERF task, workflow payload and user bundled plugins.
Constraints: STATED shared master/default master, complete uncommitted candidate against base bcae0e6e64deeba94cee5dfa71965839a2a70613. Coordinator owns final verification and authorized local commit. User authorizes local commits; implementer hands back without staging/commit. Formats remain 1. Existing mode, session, plugin and masking contracts remain authoritative.
Success signals: STATED focused backend/component/IPC checks, native replay server proof, WSL2 backend proof, four locales, both independent reviewers, statics and strict AEGIS.
Evidence: OBSERVED tea issues 315/311 --comments --login ddp --repo dpasare/2026_Virtual_Embedded_Rig_Assistant; runner.ts record/list/log/stop and runs-tab.tsx inspected.
Assumptions: INFERRED explicit command metadata avoids ambiguous plugin labels without changing execution policy.
Unknowns: Native Ubuntu acceptance unavailable on Windows host; WSL2 is separately labelled.
Decision-blocking questions: None.
Proposed behaviors: None beyond authoritative issue and preserved existing contracts.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
|---|---|---|---|
| Canonical command/cwd identity | REQ-DATA-7373a118 | Explicit command metadata in format 1 | command-tools tests |
| Live command rows and duration | REQ-UX-57f1b52c | Existing polling + bounded inline log | localized Runs tests/native |
| Full log in existing viewer | REQ-FUNC-f6d521b6 | Run-ID viewer target, full runs.log read | viewer/runner/IPC/native |
| Mask command/folder/output | REQ-SEC-96d0e13d | Existing credential scrub at main boundary | native stored credential proof |
| Agent observes UI stop | REQ-FUNC-f3346881 | Existing handle returns stopped marker | command-tools/native |
| Stop owned process tree | REQ-FUNC-8c38d223 | Reuse existing runs.stop/session handle | native server/tree + next program_output |

## Design

Diagrams: [diagram_TASK-3a2872cc.md](diagram_TASK-3a2872cc.md)

### Approach
Add explicit command text and canonical cwd to command run records, preserving declared plugin labels and format 1. Runs uses that metadata for command rows, one-second bounded live-log polling with a scrolling last-12000-character tail and elapsed/final duration. Reuse existing Stop.
### Interfaces and data
Extend runs.log with optional full=true; default remains bounded tail. Full reads retain workbench/run-ID confinement, link rejection and credential masking. Add runId viewer target and key; viewer loads full runs.log, checks returned ID and constructs ordinary text content for the existing viewer. No arbitrary renderer path enters log IPC. Persist the target at renderer version 1; standard file actions are unavailable for run targets.
### Files and test seams
shared plugins/ipc schemas; core command-tools and runner; main runs handlers; Runs row/live output; document viewer target/store; four locales/help/release notes. Focused command/runner/shared/component/viewer tests and native replay acceptance.
### Risks and open decisions
Full log loading uses the existing text viewer's whole-text model; default inline polling stays bounded. Raw local logs remain raw; all renderer disclosure is scrubbed. Session filters and workbench ownership remain unchanged. No new execution authority or lifecycle state.
### Requirement map
REQ-DATA-7373a118: explicit metadata; REQ-UX-57f1b52c: polling and duration; REQ-FUNC-f6d521b6: ID-scoped full viewer; REQ-SEC-96d0e13d: boundary scrub; REQ-FUNC-8c38d223: unchanged Stop path; REQ-FUNC-f3346881: explicit stopped=true on stopped handle output.

## Log

- 2026-11-16 frame: journal opened
- 2026-11-16 frame: completed; next specify - Autopilot scope recorded from issue315 and epic311 (7 Done checklist item(s) left unticked)
- 2026-11-16 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-16 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-16 build: red: focused command-tools/plugins-ipc/Runs tests: 6 expected failures, 24 passing; missing explicit metadata, full flag and live rows (evaluation-outputs/term04/red.log). Anchor completed before product edits.
- 2026-11-16 build: red: document-tabs focused run target test fails because no run target/ID-owned load exists (evaluation-outputs/term04/viewer-red.log).
- 2026-11-16 build: Observed existing program_output reports running=false and exitCode but no explicit stopped marker after UI Stop. TERM-04-A requires stopped; add optional true stopped marker to stopped reads, preserving ordinary exit responses.
- 2026-11-16 build: green: focused command-tools/shared IPC/Runs/document-tabs: 55 passed, exit0 (evaluation-outputs/term04/focused.log). Added explicit stopped metadata for TERM-04-A; no change to mode admission or session ownership.
- 2026-11-16 build: DEVIATION design: diagram artifact recorded during build after the design text was accepted; no product decision changed and explicit diagram matches the scoped existing lifecycle.
- 2026-11-16 build: WSL2 source-bundled pinned Node24.21.0 initially exposed short reads on /mnt/d: a single read/readFile stopped near64KiB. Positioned read loop now covers the entire stat-sized window; actual Linux server, bounded tail, full1260028-byte log, canonical cwd, cross-workbench refusal, UI-equivalent Stop and next stopped output pass (wsl2-proof.log). Native Ubuntu remains unavailable.
- 2026-11-16 build: DEVIATION validate: complete app/official-plugin/E2E suites remain explicitly deferred by coordinator; focused runner/session/plugin-tool consumers cover this change. Reuse unchanged TERM01 shell/process and TERM02 approval proof. WSL2 is Linux proof, not native Ubuntu acceptance.
- 2026-11-16 build: green: focused nine files192tests exit0 (focused-final.log); native instrumented Windows command-runs.spec.ts1passed, actual parent/child HTTP readiness and complete tree Stop, next program_output stopped=true, full masked1221275+byte retained log in text viewer, finite exit7/duration and current/all-session filters (native-current.log, native/receipt.json, live.png, viewer.png).
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: returned to build - Review1: qualify finished-run full viewer behavior in four-locale help; correct stale native byte wording
- 2026-11-16 build: Review1 correction: four-locale Chat help now limits full viewer opening to finished runs; running logs retain live dialog. Native receipt byte counts vary with heartbeat timing: acceptance proves over1MiB, superseding stale1221275+ wording. Final native1and unchanged declared-plugin native1pass (native-final.log/plugin-runs-native.log); affected65tests pass. Whole-text full-log resource limit is process memory, recorded in Design and reviewer accepted.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: final attempt1: strict--run exit1; typecheck/i18n0, lint1known2baseline errors, help1because manually appended shortcut help differs from generated content. Correct generator and regenerate owned four-locale pages; refresh both reviews. No product test rerun required for documentation generator correction.
- 2026-11-16 validate: returned to build - Final check caught generated shortcut documentation mismatch; update generator source and regenerate pages
- 2026-11-16 build: Help routing read; in-scope generator now owns four localized finished-run viewer shortcut paragraphs. Regenerated pages and check:help exit0 (help-regenerate.log/help-corrected.log). No runtime candidate change; prior tests/Windows/WSL2 proof retained.
- 2026-11-16 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-16 validate: Independent reviews: spec_review and quality_review approved round3 after generator correction; no source/test changes after approval. Candidate49then51owned files exclude all user payload/bundles/PERF. Final diff whitespace0, source baseline shared workbench-create-ipc.test.ts blob953b4ea3eb9f249b88acc4202f42a2930273f04b unchanged.
- 2026-11-16 validate: final: python .agentic/aegis.py check --task TASK-3a2872cc --strict --run exit1 (strict-current.log): lint1with only known2baseline errors; typecheck0,i18n0,help0. Candidate Biome0 (22files plus generator1file), release-notes0; 75advisory warnings/38notes cover pre-existing oversized context, external bundled archives, layout and traceability heuristics; linked focused/native/platform proof and reviews cover candidate. Focused192tests plus affected65 and help7passed; native command1+declared-plugin1passed; WSL2source real server/full log passed. Whole-text logs remain memory-limited; native Ubuntu unavailable; full suites explicitly deferred. Original logs retained, five owned probe script folders cleaned, native profiles/processes closed.
- 2026-11-16 validate: DEVIATION validate: strict exit1 retained solely for coordinator-declared global lint baselines in untracked bundled-plugins/index.json and unchanged shared workbench-create-ipc.test.ts; no candidate lint errors. User policy excludes both; accepted without unrelated fixes. Full suites/native Ubuntu remain deferred as recorded.
- 2026-11-16 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-16 | decision=User authorized sequential local ticket commits; coordinator alone commits this candidate | reason=Supplied AGENTS automated implementation cycle and delegation; implementer must not stage or commit | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-3a2872cc.md
changed: TERM04 completed candidate;51owned files; no staging/commit; coordinator owns local ticket commit
evidence: Focused192+affected65+help7; native command1+plugin1; WSL2realserver; reviews round3approved; candidateBiome0,typecheck/i18n/help/release0; strict1only known baseline lint
issues: Known2unrelated global lint errors; native Ubuntu unavailable; full suites deferred; whole-text full-log memory limit
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-16)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-f3346881 - Report Runs Stop through agent output
  - REQ-DATA-7373a118 - Shell run metadata
  - REQ-UX-57f1b52c - Commands in Runs
  - REQ-FUNC-f6d521b6 - Full run logs in document viewer
  - REQ-SEC-96d0e13d - Masked shell run presentation
  - REQ-FUNC-8c38d223 - Stop a program run from the desktop app
- deviations: 3 recorded
  - design: diagram artifact recorded during build after the design text was accepted; no product decision changed and explicit diagram matches the scoped existing lifecycle.
  - validate: complete app/official-plugin/E2E suites remain explicitly deferred by coordinator; focused runner/session/plugin-tool consumers cover this change. Reuse unchanged TERM01 shell/process and TERM02 approval proof. WSL2 is Linux proof, not native Ubuntu acceptance.
  - validate: strict exit1 retained solely for coordinator-declared global lint baselines in untracked bundled-plugins/index.json and unchanged shared workbench-create-ipc.test.ts; no candidate lint errors. User policy excludes both; accepted without unrelated fixes. Full suites/native Ubuntu remain deferred as recorded.
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base bcae0e6: 82 file(s) changed, 2119 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=75 notes=38
- checklist: 9/9 done
