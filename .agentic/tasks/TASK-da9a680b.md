# TASK-da9a680b - PWB-04 Show background session status and controls in the sidebar

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-18f96271, REQ-UX-9a0489f1, REQ-FUNC-1388cbcf, REQ-FUNC-e117c80b, REQ-UX-58fdc5c6, REQ-UX-ec37f55b, REQ-UX-c2a9fe24, REQ-UX-f20cb322, REQ-UX-4bb04608
parent:
branch: master
base: 85fe2a9866498c74980154f5388c69d8129806d5
opened: 2026-11-21

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

Problem: Desktop main keeps busy workbenches running in the background, routes session requests to the
owning workbench and bounds turns by the app-wide Concurrent turns limit (PWB-01..03; OBSERVED:
main/workbench-runtimes.ts, main/session-router.ts, core sessions/admission.ts). The sidebar does not show
it: only the shown workbench lists its sessions (OBSERVED: workbench-navigation.tsx renders `children`
for the active entry only), a session row keeps its runtime status in screen-reader text alone (OBSERVED:
session-list.tsx `sr-only` status; REQ-UX-9a0489f1 "instead of a visible runtime status label"), no control
opens or stops a session of a background workbench, and nothing in the renderer reads `session.activity`
(OBSERVED: grep renderer for session.activity finds only the browser mock). The composer limit alert
says only that the limit is reached (OBSERVED: locales/en.json errors.TURN_LIMIT).
Desired outcome: The sidebar shows running and awaiting-approval sessions of the shown and the background
workbenches, also while a workbench row is collapsed, and keeps that current as turns start, finish and
are cancelled; the user can open such a session (a background one included, where a pending approval is
reviewed) and stop one session without affecting others; the limit message says what the user can do and
keeps the unsent draft; the limit message and the setting work by keyboard; all new texts and help exist
in en, ro, de and fr; CHANGELOG and release notes describe the epic's change (STATED: ticket #360
deliverables and done criteria; epic #356 acceptance).
Actors: Desktop user working in several workbenches; Desktop main (session.activity IPC and app event,
session.stop, workbench.open); the renderer sidebar (WorkbenchNavigation, SessionList) and composer.
Primary scenario: The user starts a long turn in workbench A, opens workbench B and starts a turn there. The
sidebar shows A as active (running) and B's session as running; B's turn finishes and its indicator goes
away; A's finishes later and A's indicator goes away. Opening A shows A's completed reply, opening B shows
B's (STATED: epic acceptance 1, done criterion 1).
Examples: (1) A's turn waits for an edit approval while B is shown; A's row (collapsed, since it is not the
shown workbench) shows that a session awaits approval; choosing it opens A with that session selected and
its approval card visible; approving it completes the edit in A (STATED: done criterion 2). (2) Two slow
turns run in A and B; the user stops A's from the sidebar while B is shown; A's turn ends as stopped, B's
keeps streaming and B stays shown (STATED: "stop a specific background session"; epic "Stop targets only
the selected session"). (3) With the limit reached, a send is refused, the composer keeps the text, the
message tells the user to wait for a turn or stop one; stopping one from the sidebar shows that a turn can
start, and sending again works (STATED: "useful message ... preserve the unsent draft").
Counterexamples: Delegated child sessions are not listed as background activity; their parent shows as
running (OBSERVED: router.activity lists top-level sessions only, PWB-02 hand-over). Idle, error and
archived sessions show no activity indicator (INFERRED: the ticket names running and awaiting approval only).
In scope: renderer sidebar activity (per workbench heading, visible when collapsed, foreground and
background), per-row status indicators for the shown workbench, open-session and targeted Stop actions,
a capacity indicator and a refined limit message, live refresh from the app events, browser mock parity
(activity app event), en/ro/de/fr texts and help, CHANGELOG and release notes for the epic, a renderer unit
test, a desktop replay e2e, focused native acceptance on Windows and on Ubuntu (WSL2, xvfb).
Out of scope: changes to main routing, admission or the IPC contracts (STATED: PWB-02/03 hand-overs supply
session.activity, session.capacity, session.stop and workbench.open for background sessions); keeping
composer drafts across session or workbench switches (OBSERVED: composer text is component state; the
ticket asks to keep the draft at the limit, which holds while the session stays shown); the CLI.
Constraints: master, no new branch, one local commit, no push, no ticket close (STATED: brief). Formats stay
version 1, no migration or compatibility code (STATED). Every user-visible string in en/ro/de/fr;
check:i18n, check:help and check:release-notes pass; release notes hold at most 10 entries per category
(OBSERVED: 02_Tools/build/check-release-notes.mjs, each category already has 10). VERA UI style rules: no
helper texts, no transient labels that shift layout, existing menu patterns (STATED: memory
vera-ui-style-rules). Targeted tests only; full suite skipped (STATED).
Success signals: A renderer test where a background workbench with an awaiting-approval session shows the
indicator while collapsed, its menu opens the session through the callback and Stop calls session.stop for
that session only; session rows show running and awaiting icons with accessible names; the refined limit
message keeps the draft. A native replay e2e covering A-to-B, live sidebar status, returning to completed
replies, targeted Stop, a background approval opened from a collapsed row, and the limit message and
setting by keyboard; it passes on Windows and under xvfb on Ubuntu 24.04. i18n, help and release-notes
checks green.
Evidence: OBSERVED renderer App.tsx (benchChanged clears the session, openSession, operation guard, session.list
refetch every 2 s), components/workbench-navigation.tsx (details menus, one sidebar scope, expanded state
in localStorage), components/session/session-list.tsx, workspace.tsx (TURN_LIMIT alert, chat.turnSlotFree),
hooks/use-turn-capacity.ts, mocks/mockApi.ts session.activity (shown workbench only, no app event),
shared ipc.ts sessionActivitySchema, events.ts session.activity/session.capacity, main index.ts
announceActivity and session.activity handler, PWB-01/02/03 hand-over notes, tests/e2e/session-routing.spec.ts,
AGENTS.md "Changes, versions and release notes", 01_Documentation/Releases.md.
Assumptions: session.stop and workbench.open work for a background session without other changes (STATED:
PWB-02 hand-over "session.stop and session.approval.decide also work on a background session directly").
Unknowns: none blocking.
Decision-blocking questions: none (autopilot; defaults recorded as rulings).
Proposed behaviors: (accepted for autopilot, recorded as rulings) a compact activity control in each
workbench heading whose menu lists that workbench's active sessions with Open and Stop; status icons in
the shown workbench's session rows; a capacity count beside the Workbenches title while turns run; the
limit message names the two ways forward (wait, or stop a turn from the sidebar).

## Requirement coverage

| Behavior | Requirement |
|---|---|
| A workbench heading shows an activity control (count, awaiting marked) for its running/awaiting sessions, shown or background, collapsed or expanded | REQ-UX-18f96271 (new) |
| A session row shows a status icon while running or awaiting approval, beside its date | REQ-UX-9a0489f1 (revised) |
| Choosing a session in the activity menu shows it in its own workbench, bringing a background one forward | REQ-FUNC-1388cbcf (new) |
| Stop in the activity menu stops only that session; the view and other turns are unchanged | REQ-FUNC-e117c80b (new) |
| A failed Open or Stop shows the localized error and keeps the view | REQ-UX-58fdc5c6 (new) |
| The session.activity app event refreshes activity and the shown list (start, finish, stop, approval) | REQ-UX-ec37f55b (new) |
| Active turns and the limit show beside the Workbenches title, marked when reached | REQ-UX-c2a9fe24 (new) |
| A TURN_LIMIT send keeps the draft; the message names waiting or a sidebar Stop; then a turn can start | REQ-UX-f20cb322 (revised) |
| The activity menu works by keyboard (Enter/Space, Tab, Escape restores focus) | REQ-UX-4bb04608 (new) |
| Concurrent turns setting by keyboard in Settings > Advanced (unchanged, covered by e2e) | REQ-DATA-84718b36 (existing) |
| session.activity lists running/awaiting top-level sessions of every open workbench (unchanged) | REQ-FUNC-93ec5cc7, REQ-FUNC-a6aa5e7c (existing; activity list and its app event) |

## Design

**Approach.** Renderer-only; main, core and the IPC contracts stay as PWB-02/03 left them. A new hook
`useSessionActivity()` reads `session.activity` (query `["session.activity"]`) and, on the app event of the
same name, invalidates it and `["session.list"]`, so indicators follow turn start, end, Stop and approvals
without waiting for the 2 s list poll (REQ-UX-ec37f55b). WorkbenchNavigation calls it and matches each
recent entry to its open activity row (folder first, then workbench ID); a new `WorkbenchActivity`
(components/workbench-activity.tsx) renders between the name and the row menu whenever that row lists
sessions, so it shows for the shown and background workbenches, collapsed or expanded (REQ-UX-18f96271,
RULING-001). It is a `<details>` in the sidebar's one menu scope: summary = icon (spinning LoaderCircle;
ShieldAlert once any session awaits approval) + count, accessible name with the running and awaiting counts;
its menu lists each session as an Open button (icon, title, localized status) and a Stop button (Square,
"Stop: <title>") (REQ-UX-4bb04608: native summary keys, Tab order, Escape restores focus through the
existing handler). New props `openSession(folder, sessionId)` and `stopSession(sessionId)`: App opens the
shown workbench's session with `select`, else runs `workbench.open` in `operation`, `benchChanged`, then
selects the session with a transcript focus request (REQ-FUNC-1388cbcf, RULING-003); Stop calls
`session.stop` outside `operation`, so the sidebar stays enabled and the view unchanged (REQ-FUNC-e117c80b);
both failures land in the existing `sessionError` ErrorMessage under the navigation (REQ-UX-58fdc5c6).
After Stop, focus returns to the activity control, or to the workbench name once the control is gone.
The capacity count `active/limit` (Activity icon) sits absolutely positioned at the right of the
Workbenches title row while `active > 0`, `data-limit-reached` at or above the limit (REQ-UX-c2a9fe24).
SessionList adds an aria-hidden status icon with a tooltip before the date for running and awaiting rows;
the existing sr-only status text keeps the status in the row's name (REQ-UX-9a0489f1, RULING-002). The
TURN_LIMIT text names waiting or a sidebar Stop in four languages (REQ-UX-f20cb322, RULING-004). App's
default-selection effect keeps a requested session while its workbench's list is refetching, so a
just-opened background session is not replaced by a stale cached list. Rejected: permanent background
session rows under each heading (row heights change as turns start and end); a Settings button in the
limit alert (it unmounts the composer and its draft).
**Interfaces and data.** No new IPC, event or stored data. Inputs: `session.activity` rows
`{workbenchId, name, folder, foreground, sessions[{id, title, status}]}`, `session.capacity {active, limit}`.
Outputs: `workbench.open {folder}`, `session.stop {sessionId}`. Browser mock: `session.activity` app event on
every capacity change and on approval requested/decided (mock parity for REQ-UX-ec37f55b). New locale keys
`activity.*` (summary label, status words, Open/Stop names, capacity label) in en/ro/de/fr; help
chat-and-sessions in four languages; CHANGELOG line and one release-notes entry merged into the full "new"
category (limit 10).
**Files and test seams.** renderer hooks/use-session-activity.ts, components/workbench-activity.tsx,
workbench-navigation.tsx, session/session-list.tsx, App.tsx, styles.css, locales x4, mocks/mockApi.ts and
mocks/sessions.ts; help/<lang>/chat-and-sessions.md; CHANGELOG.md; release-notes/unreleased.yaml. Tests:
new renderer components/workbench-activity.test.ts over the mock with a stubbed `session.activity`
(REQ-UX-18f96271, REQ-FUNC-1388cbcf, REQ-FUNC-e117c80b, REQ-UX-58fdc5c6, REQ-UX-ec37f55b, REQ-UX-c2a9fe24,
REQ-UX-4bb04608, REQ-UX-9a0489f1); turn-limit.test.ts text (REQ-UX-f20cb322); new native replay e2e
tests/e2e/background-sessions.spec.ts (A-to-B, live status, completed replies, targeted Stop, collapsed
background approval, keyboard limit and setting); existing workspace.test.ts, mockApi.test.ts,
session-workspace.spec.ts, navigation-actions.spec.ts, workbench-navigation.spec.ts as regressions.
**Risks and open decisions.** The activity query refetches on every activity event (not debounced in
main); events fire on state changes only, not per streamed chunk. Clones share workbench IDs: matching by
folder first keeps a clone's activity on its own row. A session opened while its workbench is closing
answers NOT_FOUND and shows the error (REQ-UX-58fdc5c6).
**Requirement map.** REQ-UX-18f96271: WorkbenchActivity in every heading. REQ-UX-9a0489f1: row icon, sr-only
text kept. REQ-FUNC-1388cbcf: openSession in App. REQ-FUNC-e117c80b: stopSession outside operation.
REQ-UX-58fdc5c6: sessionError. REQ-UX-ec37f55b: useSessionActivity invalidation, mock events. REQ-UX-c2a9fe24:
title capacity count. REQ-UX-f20cb322: reworded alert. REQ-UX-4bb04608: details/summary in the menu scope.
Diagrams: [diagram_TASK-da9a680b.md](diagram_TASK-da9a680b.md)

## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-21 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-21 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-21 build: red: npx vitest run renderer components/workbench-activity.test.ts exit 1, 4 failed - no activity control in workbench headings, no row icons, no capacity count, no Open/Stop (REQ-UX-18f96271, REQ-UX-9a0489f1, REQ-FUNC-1388cbcf, REQ-FUNC-e117c80b, REQ-UX-58fdc5c6, REQ-UX-ec37f55b, REQ-UX-c2a9fe24, REQ-UX-4bb04608)
- 2026-11-21 build: red: npx vitest run renderer mocks/mockApi.test.ts components/session/turn-limit.test.ts exit 1, 2 failed - the mock emits no session.activity event; the TURN_LIMIT alert names no way forward (REQ-UX-ec37f55b, REQ-UX-f20cb322)
- 2026-11-21 build: green: npx vitest run renderer components/workbench-activity.test.ts mocks/mockApi.test.ts components/session/turn-limit.test.ts exit 0, 28 tests; regressions workspace.test.ts, mocks, workbench-overview, shell exit 0, 91 tests; npm run typecheck exit 0 (REQ-UX-18f96271, REQ-UX-9a0489f1, REQ-FUNC-1388cbcf, REQ-FUNC-e117c80b, REQ-UX-58fdc5c6, REQ-UX-ec37f55b, REQ-UX-c2a9fe24, REQ-UX-4bb04608, REQ-UX-f20cb322)
- 2026-11-21 build: green: npm run test:e2e -- tests/e2e/background-sessions.spec.ts exit 0, 3 native tests on Windows: A-to-B live sidebar status and completed replies, targeted background Stop plus keyboard-opened background approval from a collapsed row, keyboard Concurrent turns limit with draft kept and sidebar Stop (REQ-UX-18f96271, REQ-FUNC-1388cbcf, REQ-FUNC-e117c80b, REQ-UX-ec37f55b, REQ-UX-c2a9fe24, REQ-UX-4bb04608, REQ-UX-f20cb322, REQ-UX-9a0489f1)
- 2026-11-21 build: DEVIATION build: composer focus restore after a send that disabled the message box was written before its test; its red was shown by mutation (focus restore disabled: background-sessions.spec.ts 'at the limit' failed at toBeFocused, exit 1), then restored - the native e2e guards it (jsdom keeps focus on disabled fields, so no renderer test can)
- 2026-11-21 build: green: npm run check:i18n, check:help, check:release-notes exit 0; npm run typecheck exit 0; biome check on changed files clean (remaining notes are on untouched lines)
- 2026-11-21 build: green: Windows npm run test:e2e -- background-sessions, session-routing, workbench-runtimes, navigation-actions, workbench-navigation, sidebar-order, session-workspace, approvals, advanced-settings, mock specs: --browser-only exit 0 (4 tests); --serial-only exit 1, 13 passed, 1 failed: mock.spec.ts 'browser mock displays the same metadata screen through dev:renderer' times out waiting for .typography-code-preview code in Settings > Appearance (sidebar not mounted there; baseline on clean HEAD pending)
- 2026-11-21 build: baseline: WSL ~/vera-rel clean HEAD 85fe2a98: npm run test:e2e -- tests/e2e/mock.spec.ts --serial-only exit 1, same timeout waiting for .typography-code-preview code - the mock.spec.ts failure predates this task (Settings > Appearance), out of scope
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 1: spec changes_required, quality approved. Spec findings: (blocking) no test for Open of a shown-workbench session; awaiting-approval and error row icons unasserted; (minor) REQ-UX-4bb04608 and REQ-UX-f20cb322 verification text names the wrong layer, Space untested; REQ-UX-58fdc5c6 test does not check the localized text or kept selection; REQ-UX-18f96271 'not open shows none' and REQ-UX-c2a9fe24 label case unasserted; ro/de/fr release-note text drops the turn limit; row icon title duplicates the status in the row name. Quality findings taken: test 2 B replay lengthened to 60 s (flake margin). Not taken: stale-list wait (benchChanged clears the session first), folder string match (one source in main), Stop error in the sidebar error line (meets REQ-UX-58fdc5c6)
- 2026-11-21 validate: returned to build - apply review round 1 findings: shown-workbench Open test, awaiting/error row icon tests, error text and kept selection, not-open and capacity label asserts, Space key, verification wording, release-note translations, row icon aria-hidden
- 2026-11-21 build: green (fix cycle 1): npx vitest run renderer workbench-activity (6 tests: not-open workbench, capacity label, localized Stop/open errors with kept selection, shown-workbench Open without workbench.open, idle/running/awaiting/error row icons), turn-limit, mocks, workspace exit 0, 87 tests; npm run typecheck exit 0; biome clean; Windows npm run test:e2e -- tests/e2e/background-sessions.spec.ts exit 0, 3 tests (awaiting row icon, Space opens the menu, B replay 60 s) (REQ-UX-18f96271, REQ-UX-9a0489f1, REQ-FUNC-1388cbcf, REQ-UX-58fdc5c6, REQ-UX-c2a9fe24, REQ-UX-4bb04608)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 2: spec approved, quality approved. Remaining minor, accepted: REQ-FUNC-1388cbcf verification puts the shown-workbench clause after 'Native e2e' although the renderer test covers it; fr release-note 'sur le côté' vaguer than 'barre latérale'; ro/fr notes at exactly 100 characters (check:release-notes 0 errors)
- 2026-11-21 validate: native acceptance Ubuntu 24.04 (WSL2, xvfb, ~/vera-rel at 85fe2a98 + patch): npm run typecheck exit 0; npx vitest run workbench-activity, turn-limit, mocks, workspace exit 0, 87 tests; npm run test:e2e -- <10 specs> --browser-only exit 0 (4 tests); --serial-only exit 1, 13 of 14 passed incl. background-sessions x3, session-routing, workbench-runtimes, navigation-actions, sidebar-order, approvals x5, session-workspace; the one failure is the pre-existing mock.spec.ts typography timeout (fails on clean HEAD too). Patch reversed afterwards; git status clean
- 2026-11-21 validate: DEVIATION validate: full suite skipped - user runs it at the end of the epic
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-da9a680b --strict --run exit 0 (strict: ok); ran lint, typecheck, check:i18n, check:help, all ok; tests are not in the [check] run list (focused renderer, Windows and Ubuntu native runs logged above); 44 warnings accepted: uncovered-source lists the three changed test files (linked_tests, no behavior of their own); outside-layout for help pages, release notes and CHANGELOG (outside the layout globs by configuration); outside-layout and secret-in-diff for the untracked captures/ folder, not part of this change; context-size file-tools 26 KB and sessions 33 KB predate this task; journal-header, ticket-ref and no-linked-tests in older journals and requirements
- 2026-11-21 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-21 | decision=Background activity is a compact control in each workbench heading (icon and count, distinct for awaiting approval), visible whether the row is collapsed or expanded and whether the workbench is shown or in the background; its menu lists that workbench's running and awaiting-approval sessions with Open and Stop. The shown workbench's session rows also show a status icon. | reason=Ticket #360 asks for state across workbenches that stays discoverable when a row is collapsed; a heading control keeps row heights fixed (UI rule: no transient labels that shift layout) and reuses the sidebar details-menu pattern with its Escape and focus rules. | source=technical | supersedes=none
- RULING-002 | date=2026-11-21 | decision=REQ-UX-9a0489f1 is revised: a session row shows its date and time and, for running and awaiting approval only, a status icon with an accessible name; no visible status text label. | reason=Ticket #360 requires running and awaiting-approval state in the sidebar; the revision keeps the date line and the existing action guards. | source=requirement | supersedes=none
- RULING-003 | date=2026-11-21 | decision=Stop in the activity menu calls session.stop for that session at once (no confirmation), without switching workbenches; Open brings a background workbench to the foreground with workbench.open, selects the session and focuses its transcript heading. | reason=The composer Stop button also stops at once; the menu already takes two deliberate actions; PWB-02 routes session.stop by session ID to the owning workbench. | source=technical | supersedes=none
- RULING-004 | date=2026-11-21 | decision=The limit message keeps the draft in place and tells the user to wait for a running turn or stop one from the sidebar; it offers no navigation button, and the sidebar shows the active/limit count while turns run. | reason=Composer text is component state: navigating to Settings would discard the draft the ticket asks to preserve; the sidebar Stop frees a slot without leaving the composer. | source=technical | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-da9a680b.md
changed: renderer sidebar activity, Open/Stop, capacity count, row icons, composer focus, mock events, locales x4, help x4, CHANGELOG, release notes; 7 requirements created, 2 revised
evidence: python .agentic/aegis.py check --task TASK-da9a680b --strict --run exit 0
issues: mock.spec.ts dev:renderer typography timeout fails on clean HEAD too (pre-existing); full suite not run (epic end)
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-UX-18f96271 - Show session activity in each workbench heading
  - REQ-UX-9a0489f1 - Show localized last activity date and time in session rows
  - REQ-FUNC-1388cbcf - Open an active session from the sidebar in its own workbench
  - REQ-FUNC-e117c80b - Stop one session from the sidebar activity menu
  - REQ-UX-58fdc5c6 - Show an error and keep the view when a sidebar activity action fails
  - REQ-UX-ec37f55b - Keep sidebar activity current from activity events
  - REQ-UX-c2a9fe24 - Show concurrent turn use beside the Workbenches title
  - REQ-UX-f20cb322 - Keep the composer draft and show capacity at the turn limit
  - REQ-UX-4bb04608 - Operate the sidebar activity menu by keyboard
- deviations: 2 recorded
  - build: composer focus restore after a send that disabled the message box was written before its test; its red was shown by mutation (focus restore disabled: background-sessions.spec.ts 'at the limit' failed at toBeFocused, exit 1), then restored - the native e2e guards it (jsdom keeps focus on disabled fields, so no renderer test can)
  - validate: full suite skipped - user runs it at the end of the epic
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 85fe2a9: 47 file(s) changed, 1875 line(s) added; 3 file(s) not content-scanned
- checks: errors=0 warnings=44 notes=40
- checklist: 8/9 done; open: `report` appended
