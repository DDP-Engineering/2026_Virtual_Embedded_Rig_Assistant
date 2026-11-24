# TASK-760b7ec0 - Desktop notifications: add an in-app Activity view (#392)

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-e7ba512c, REQ-FUNC-4f07bacd, REQ-FUNC-531aeead, REQ-REL-aa1b0ba0, REQ-UX-489b8652, REQ-FUNC-c937c94e
parent:
branch: ddp/vera-notifications
base: ddce394e1dabcbe53074d18e40d3e1d2e7ff8483
opened: 2026-11-24

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
- [x] Windows and WSL2 Electron show a background completion with native alerts disabled.
- [x] Keyboard activation and Escape work, with focus restored after dismissal.
- [x] Read actions clear only completion markers while running and waiting sessions stay available.
- [x] Dirty editor, deleted and wrong-owner targets, and delayed initial reads have focused regression proof.
- [x] Delegated approvals open the owning child and pending questions open the exact live card.
- [x] Question cancellation and timeout remove pending identity, and a settled ID is ignored by card focus.
- [x] English, Romanian, German and French UI, Help and release text match their expected UTF-8 bytes.

## Frame

Problem: STATED — a missed or disabled native alert needs an in-app destination. OBSERVED — session.activity reports current operational states and carries the pending question ID, without completion history.
Desired outcome: STATED — keyboard-accessible Activity across workbenches for running turns, pending approvals and questions, and unread completions.
Actors: STATED — desktop engineers using foreground or background workbenches.
Primary scenario: STATED — read a completed reply via Activity while native alerts are disabled, then return to remaining attention items.
Examples: STATED — keyboard activation opens the owning workbench and focuses its still-pending question.
Counterexamples: STATED — a declined navigation preserves the dirty draft and the unread marker; a settled question does not reopen.
In scope: STATED — reuse the live state query, workbench list, successful ordinary-turn signal and guarded session navigation; route delegated requests to the child.
Out of scope: STATED — persistent cross-restart read state, native delivery changes, native Ubuntu package acceptance and the milestone suite.
Constraints: STATED — base ddce394e, ddp/vera-notifications only, coordinator-owned local commit, four locales and byte-level UTF-8 verification.
Success signals: STATED — stable keyboard and read behavior, exact owner routing, immediate pending-state updates, stale-target safeguards and localized Help.
Evidence: OBSERVED — SessionService.observeLiveActivity emits successful ordinary turns; WorkbenchRuntimes.open accepts a pre-promotion owner guard; SessionWorkspace checks exact pending question identity.
Assumptions: INFERRED — record the latest 100 completions for the current process, including foreground completions, because the issue requests bounded run-local history and explicit read actions. Renderer reload preserves it.
Unknowns: None affecting the authorized scope.
Decision-blocking questions: None.
Proposed behaviors: Apply the run-local limit and read behavior above under the ticket's delegated design choice.

## Requirement coverage

| Behavior | Requirement | Design |
|---|---|---|
| Pending structured questions | REQ-UX-e7ba512c | Existing live identity and card-focus check |
| Unread lifecycle | REQ-FUNC-4f07bacd | Main-process bounded store |
| Read actions | REQ-FUNC-531aeead | Exact marker or all markers |
| Guarded navigation | REQ-REL-aa1b0ba0 | Folder, workbench ID and membership check |
| Accessible, localized view | REQ-UX-489b8652 | Shell modal and shared activity query |
| Delegated approval ownership | REQ-FUNC-c937c94e | Only the owning child supplies the pending status |

## Design

**Approach.** OBSERVED — the existing live signal already applies #390's success predicate.
INFERRED (REQ-FUNC-4f07bacd) — feed UnreadCompletions directly from that signal before optional
native delivery. Keep the latest 100 markers in the main process and the captured labels scrubbed.

**Interfaces and data.** INFERRED — use existing session.activity plus session.activity.unread.
Each marker has a UUID and an exact folder, workbench ID and session ID. session.activity.open
checks canonical ownership and exact session membership before promoting; App shares its dirty
editor guard and linked transcript focus with the sidebar. A successful open acknowledges only
the selected marker; session.activity.readAll clears only markers (REQ-FUNC-531aeead). Remove
markers for known deleted sessions or removed workbenches and on failed owner validation
(REQ-REL-aa1b0ba0). Open a settled question's session normally via the existing focus check
(REQ-UX-e7ba512c).

**Files and test seams.** INFERRED — Desktop Shell hosts a native modal ActivityView with localized
group headings and pager for unread rows. App supplies the same activity query to sidebar and
modal, and uses the recent workbench names where available (REQ-UX-489b8652). SessionsHost
includes child waits (REQ-FUNC-c937c94e); core approval state only marks the owner. Unit tests
cover the store and activity projection. Focused Electron replay proves real navigation and
keyboard controls, and static checks and a byte-level audit cover all four locales.

**Risks and open decisions.** OBSERVED — the workbench runtime retires after a background turn
settles. A completion marker can reopen the exact saved workbench via the guarded path shared
with the native click. Main persists no marker. UI awaits navigation before closing Activity or
showing the transcript, and accepts no competing shell navigation while its operation is pending.

**Requirement map.** Each behavior and owner is listed in Requirement coverage.

Diagrams: [diagram_TASK-760b7ec0.md](diagram_TASK-760b7ec0.md)


## Log

- 2026-11-24 frame: journal opened
- 2026-11-24 frame: The user authorized one coordinator-owned local commit for this ticket after validated handoff. The implementer leaves the candidate unstaged and uncommitted.
- 2026-11-24 frame: completed; next specify (7 Done checklist item(s) left unticked)
- 2026-11-24 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-24 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-24 build: red: npmw.py npm run test:e2e -- --serial-only background-sessions.spec.ts -g Activity catches exit 1: keyboard could not reach the missing Activity trigger after successfully completing setup with native delivery off.
- 2026-11-24 build: green: Windows npmw.py npx vitest run on unread-completions, session-notifications, session-router.replay, workbench-runtimes, ipc-router, preload bridge, workbench-activity, question-card, mockApi, live-activity, questions, session-activity-ipc and tooling boundaries: exit 0, 136 passed across 13 files. Later IPC/store selector rerun: exit 0, 6 passed across 2 files.
- 2026-11-24 build: green: Windows npmw.py npm run test:e2e -- --serial-only background-sessions.spec.ts session-question.spec.ts -g Activity: exit 0, 3 passed. Previous mixed run separately passed native notification dirty-guard and sidebar background approval regressions; the two failing new cases were fixed and rerun in the three green cases.
- 2026-11-24 build: green: WSL2 Ubuntu 24.04.4 with pinned Node 24.21.0, npmw.py npx vitest run on unread-completions, session-notifications, session-router.replay, workbench-activity, live-activity, questions and session-activity-ipc: exit 0, 45 passed across 7 files.
- 2026-11-24 build: UTF-8 audit: Python read_bytes and strict UTF-8 decode then exact authored bytes and NFC comparison of 7 catalog strings, Activity Help heading and both paragraphs, and the merged release-note line in each of en, ro, de and fr; exit 0, all four matched.
- 2026-11-24 build: Advisory check reports existing requirement/context findings and outside-layout warnings for repository-required Help, release notes and CHANGELOG. The verification policy uses focused tests and reserves full gates for the milestone.
- 2026-11-24 build: completed; next validate (1 Done checklist item(s) left unticked)
- 2026-11-24 validate: green: Ubuntu 24.04.4 under WSL2 with Xvfb and Openbox, npmw.py npm run test:e2e -- --serial-only background-sessions.spec.ts session-question.spec.ts -g Activity exit 0, 3 passed. This is Linux development execution under WSL2.
- 2026-11-24 validate: Round 1 independent quality findings: preserve a native token queued during guarded navigation, cancel in-flight first reads before invalidating Activity, and prevent editing after the dirty gate during async navigation.
- 2026-11-24 validate: returned to build - Independent quality review requested fixes for native activation, initial Activity query and dirty-editor navigation races.
- 2026-11-24 build: red: Windows npmw.py npx vitest run workbench-activity.test.ts -t supersedes both initial reads|freezes editors, exit 1: both delayed-response tests failed on the pre-fix candidate at the expected read and inert-state assertions.
- 2026-11-24 build: green: Windows and Ubuntu 24.04.4 WSL2 npmw.py npx vitest run src/apps/desktop/src/renderer/components/workbench-activity.test.ts, exit 0 on each, 8 passed per platform including revised initial reads and preserved native activation/editor guard.
- 2026-11-24 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-24 validate: green: final Windows npmw.py npm run test:e2e -- --serial-only background-sessions.spec.ts session-question.spec.ts -g Activity|a completion notification exit 0, 4 passed. Ubuntu 24.04.4 under WSL2 with Xvfb/Openbox, the same command with -g Activity exit 0, 3 passed.
- 2026-11-24 validate: final: python .agentic/aegis.py check --task TASK-760b7ec0 --strict --run exit 0, lint/typecheck/i18n/help green, 0 errors, 38 advisory warnings, 44 notes. The warnings are historical requirement/context/journal findings and docs layout findings for required Help/release notes/CHANGELOG. Separate npmw.py npm run check:release-notes exit 0, three files with zero errors. Import-boundary test is in the Windows focused run. The coordinator-reported baseline delegated-tool-ordering failure in registry.test.ts and native Ubuntu package evidence in #391 are outside this ticket.
- 2026-11-24 validate: completed; next done

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-760b7ec0.md
changed: Added title-bar Activity and shared verified session navigation
evidence: Strict AEGIS exit 0, Windows Electron 4 passed, WSL2 Electron 3 passed, focused Vitest and UTF-8 audit passed
issues: Native Ubuntu package acceptance remains tracked in #391.
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-24)

- stage: validate; type: feature; branch: ddp/vera-notifications
- requirements:
  - REQ-UX-e7ba512c - Identify and focus waiting questions in workbench activity
  - REQ-FUNC-4f07bacd - Retain unread successful replies in this app run
  - REQ-FUNC-531aeead - Acknowledge completions independently of turn state
  - REQ-REL-aa1b0ba0 - Guard activity navigation against stale and wrong owners
  - REQ-UX-489b8652 - Present localized keyboard-accessible Activity across workbenches
  - REQ-FUNC-c937c94e - Show pending delegated approvals under the owning session
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base ddce394: 48 file(s) changed, 1299 line(s) added
- checks: errors=0 warnings=38 notes=44
- checklist: 15/16 done; open: `report` appended
