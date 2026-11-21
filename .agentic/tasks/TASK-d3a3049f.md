# TASK-d3a3049f - PWB-03 Add a configurable app-wide concurrent-turn limit

stage: done
type: feature
interaction: autopilot
requirements: REQ-DATA-84718b36, REQ-FUNC-52e97b95, REQ-FUNC-76e132bb, REQ-REL-11f00fcd, REQ-REL-1b33797f, REQ-FUNC-56f63014, REQ-FUNC-74c5be27, REQ-FUNC-33cd5f9f, REQ-UX-f20cb322
parent:
branch: master
base: e492bbe0c2fcae1209e9d6e2c4de1ed67413d417
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

Problem: Desktop main now runs one SessionService per open workbench, and busy background workbenches keep
running their turns (PWB-01, PWB-02; OBSERVED: main/workbench-runtimes.ts, main/session-router.ts). Nothing
bounds how many turns run at once across workbenches: each SessionService admits a new top-level turn
whenever its session is idle (OBSERVED: core sessions/service.ts admitMessage -> startTurn), and the only
cap is the per-workbench `delegations` Advanced setting for delegated turns (OBSERVED: startTurn,
shared advanced-settings.ts `delegations: int(1, 8, 3, ["app"])`). The renderer has no way to know that
turns are at a limit (OBSERVED: shared ipc.ts, events.ts).
Desired outcome: A persisted application setting for the maximum number of concurrent active turns,
default 3, validated, with a user-facing control; one admission check across every workbench for new
top-level and delegated turns; a typed admission result at capacity before any turn is created or provider
request sent, with the composer draft and attachments kept; the renderer learns when capacity is free
again; slots released exactly once on completion, cancellation, failure and workbench shutdown; a lower
limit applies only to future admissions (STATED: ticket #359 deliverables and done criteria).
Actors: Desktop user sending messages in sessions of several workbenches; a parent agent launching
delegated sessions through the delegation tool; Desktop main (runtimes, router, settings); core
SessionService of each runtime; the renderer composer.
Primary scenario: With the default limit 3, the user starts turns in workbench A (two sessions) and B (one
session). A fourth send, in either workbench, is refused with a typed capacity result; no turn, user message
or provider request is created and the composer keeps the text and attachments. When one of the three turns
ends, the renderer is told capacity is free; the user sends again and the turn starts (STATED: done
criterion 1).
Examples: (1) Limit 3, three turns running, the user steers one of them: the steering message is queued
into that turn, no slot is taken (STATED: "Steering an already active turn uses its existing slot"). (2)
Limit 3, two top-level turns running, a parent agent launches two delegated sessions: the first starts, the
second is refused promptly with the capacity reason as its tool result (STATED: "A delegated launch at
capacity also returns promptly"). (3) Limit 3, three running; the user lowers the limit to 1: all three keep
running; new sends are refused until only zero turns remain (STATED: "A lower configured limit applies to
future admission"). (4) A turn waiting for an approval keeps its slot until it ends (STATED). (5) Stop, a
provider failure and closing a background workbench each free that turn's slot once (STATED).
Counterexamples: A message queued into a running turn (steering) is never refused for capacity. Background
compaction after a turn and Compact now are not turns and take no slot (INFERRED: the ticket bounds
"active turns"; compaction runs after the turn's slot is released, OBSERVED: startTurn finally).
In scope: the setting (registry, validation, persistence in settings format 1, a Settings control, en/ro/de/fr
labels and help); a core admission port shared by every SessionService host; the admission check in core
startTurn for top-level and delegated turns plus a prompt pre-check in launchDelegated; slot release on turn
end, discard and service close; the typed capacity error through session.send and the delegation tool; an
IPC capacity query and app event; a minimal composer status at capacity and when capacity is free; tests.
Out of scope: the sidebar status, the polished limit message in the sidebar and Native acceptance on Windows
and Ubuntu (STATED: brief, ticket #360). The CLI (one process, its own sessions; INFERRED: the epic is about
Desktop sessions across workbenches, STATED: epic #356 goal). Capping retained runtimes (STATED: PWB-02
hand-over, bounded indirectly by the turn limit).
Constraints: master, no new branch, one local commit, no push (STATED: brief). Settings and every stored
format stay at version 1, no migration or compatibility code (STATED). Core stays Electron-independent
(OBSERVED: project.md). Every new user-visible string in en, ro, de, fr; `check:i18n` and `check:help` pass
(STATED). Targeted tests only (STATED). Existing session.send callers keep working (OBSERVED: 53 call sites
in tests and renderer).
Success signals: A core unit test where three turns across two SessionServices sharing one admission run and
a fourth send is refused with the typed result before any event, message row or provider request; steering
a running turn is admitted; a delegated launch at capacity returns the capacity failure promptly; parallel
starts never exceed the limit; completion, Stop, provider failure and service close each release once; a
lowered limit leaves running turns alone. A shared settings test for the new key's range and default. A
renderer test of the capacity status. A main replay test across two real runtimes. i18n and help checks
green.
Evidence: OBSERVED core sessions/service.ts (admitMessage, startTurn delegated cap, discard, finally, close,
launchDelegated, hasActiveWork, recover aborts undecided approvals at open); shared advanced-settings.ts
(registry, app scope, CLI flags limited to session scope); shared errors.ts (closed code enum); core
tools/delegated-sessions.ts failureText keyed by every code; desktop main index.ts session.send through
router.inSession, sessionOptions shared by every runtime's SessionsHost, settings `changed` hook;
main/sessions.ts SessionsHost -> SessionService host; renderer workspace.tsx send() returns false on error
and composer.tsx keeps text and attachments unless send returns true; error-message.tsx; help/en
advanced-settings.md; PWB-02 hand-over "For #359".
Assumptions: A turn is active from startTurn until its `active` entry is removed (its durable completion),
including while it waits for an approval (INFERRED: ActiveTurn.approvalWait, approvals.request awaited inside
the runtime). Undecided approvals without an active turn do not survive a restart (OBSERVED: recover() marks
them aborted).
Unknowns: The wording and placement of the sidebar capacity message (UNKNOWN, decided by #360).
Decision-blocking questions: none (autopilot; defaults recorded as rulings).
Proposed behaviors: (accepted for autopilot, recorded as rulings) the limit is an app-scope Advanced setting
`concurrentTurns` (1-16, default 3, applies right away); the capacity result is a new typed error code
`TURN_LIMIT` with the limit as a parameter; the renderer reads `session.capacity` and the app event of the
same name; at capacity the composer stays unsent with an alert and then a status once a slot is free.

## Requirement coverage

| Behavior | Requirement |
|---|---|
| The limit is the app-scope Advanced setting concurrentTurns, 1-16, default 3, settings format 1 | REQ-DATA-84718b36 (new) |
| A new top-level or delegated turn at the limit is refused TURN_LIMIT before any record or provider request | REQ-FUNC-52e97b95 (new) |
| Steering an active turn takes no slot, also at the limit | REQ-FUNC-76e132bb (new) |
| A turn holds one slot until it ends (approval wait included) and releases it once | REQ-REL-11f00fcd (new) |
| Simultaneous starts never exceed the limit | REQ-REL-1b33797f (new) |
| A changed limit applies to later admissions; admitted turns run on | REQ-FUNC-56f63014 (new) |
| A delegated launch at the limit fails TURN_LIMIT promptly; the delegations cap still applies | REQ-FUNC-74c5be27 (new) |
| session.capacity IPC and app event report active count and limit | REQ-FUNC-33cd5f9f (new) |
| The composer keeps its draft and shows the limit, then that a turn can start | REQ-UX-f20cb322 (new) |
| Existing per-workbench delegations cap (unchanged) | REQ-FUNC-261cdc27 (existing, composes) |


## Design

**Approach.** A core admission port, `TurnAdmission` (`acquire(): TurnSlot | undefined`, `state()`), with
one implementation, core `TurnLimit` (sessions/admission.ts): a counter checked against `limit()` read at
each acquire, so a saved change applies to the next admission only (REQ-FUNC-56f63014) and check-and-take is
one synchronous step on the single JS thread (REQ-REL-1b33797f). `TurnSlot.release()` is idempotent
(REQ-REL-11f00fcd). Desktop main creates one `TurnLimit` with `limit = appAdvanced("concurrentTurns")` and
hands it to every runtime's SessionsHost -> SessionService host (`admission`), so one count spans every open
workbench (RULING-001, RULING-004). Core `startTurn` becomes a wrapper: the per-workbench delegations check
(BUSY, REQ-FUNC-261cdc27, unchanged and first), then `acquire()`; none -> throw TURN_LIMIT with
`params.limit` (REQ-FUNC-52e97b95), before the runtime, any record or provider request exists; then the
existing body runs with the slot on its ActiveTurn, and a throw out of it releases the slot. The slot is
released when the turn leaves `active` (its `finally`, before background compaction, which takes no slot),
in `discard()`, and for any turn still held after `close()` settles (REQ-REL-11f00fcd). Steering through
admitMessage never reaches startTurn (REQ-FUNC-76e132bb). launchDelegated checks `state()` before awaiting
readiness or `prepareDelegatedModel`, so a launch at capacity returns promptly; the acquire in startTurn
stays the authority (REQ-FUNC-74c5be27). Rejected: a `session.send` response union (RULING-002); reserving
the slot during delegated model preparation (holds capacity across a slow download for no gain).
**Interfaces and data.** Setting: `concurrentTurns: int(1, 16, 3, ["app"])` in the Advanced registry,
stored in `settings.advanced` (format 1, no migration), shown in Settings > Advanced (REQ-DATA-84718b36,
RULING-001). Error: new VeraError code `TURN_LIMIT` (`errors.TURN_LIMIT`, params `{ limit }`); the
delegation tool maps it to its own prompt failure text (RULING-002). IPC `session.capacity {}` ->
`{ active, limit }`; app event `{ type: "session.capacity", active, limit }` emitted by the TurnLimit
listener on every acquire and release and by `refresh()` from the settings `changed` hook when the limit
changes (REQ-FUNC-33cd5f9f, RULING-003). The CLI passes no admission and keeps no limit (RULING-004).
Renderer: `useTurnCapacity()` reads `session.capacity` and follows the app event; workspace keeps the
TURN_LIMIT failure (composer already keeps text and attachments on a false send) and, once
`active < limit`, replaces the alert by the status `chat.turnSlotFree`; no auto-send (REQ-UX-f20cb322,
RULING-003). Browser mock: `session.capacity` and the TURN_LIMIT refusal mirror main.
**Files and test seams.** shared advanced-settings.ts/.test.ts (REQ-DATA-84718b36), errors.ts, ipc.ts,
events.ts, shared IPC test (REQ-FUNC-33cd5f9f); core sessions/admission.ts + admission.test.ts
(REQ-REL-1b33797f, REQ-FUNC-56f63014, REQ-FUNC-33cd5f9f), sessions/service.ts, tools/delegated-sessions.ts,
index.ts export, sessions/turn-limit.test.ts with two services sharing one TurnLimit over a gated
ReplayGateway (REQ-FUNC-52e97b95, REQ-FUNC-76e132bb, REQ-REL-11f00fcd, REQ-REL-1b33797f,
REQ-FUNC-56f63014, REQ-FUNC-74c5be27); desktop main index.ts, sessions.ts and a replay test across two
real runtimes (REQ-FUNC-52e97b95, REQ-FUNC-33cd5f9f); renderer workspace.tsx, hooks/use-turn-capacity.ts,
error-message.tsx, advanced-field.tsx, mocks, locales x4 and a workspace test (REQ-UX-f20cb322); help
advanced-settings.md and chat-and-sessions.md x4.
**Risks and open decisions.** Concurrency: correctness rests on acquire being synchronous and on every
path out of startTurn releasing (wrapper catch, discard, finally, close); release is idempotent so a
double path cannot drive the count negative. A hung turn that never settles keeps its slot until its
workbench's sessions close (Stop aborts it). The sidebar message is #360's.
**Requirement map.** REQ-DATA-84718b36: registry entry, app scope. REQ-FUNC-52e97b95: acquire in startTurn,
TURN_LIMIT. REQ-FUNC-76e132bb: steering path untouched. REQ-REL-11f00fcd: slot on ActiveTurn, idempotent
release on every exit. REQ-REL-1b33797f: synchronous check-and-take. REQ-FUNC-56f63014: limit read per
acquire. REQ-FUNC-74c5be27: pre-check in launchDelegated, tool failure text. REQ-FUNC-33cd5f9f: capacity
channel and app event. REQ-UX-f20cb322: capacity hook and composer status.
Diagrams: [diagram_TASK-d3a3049f.md](diagram_TASK-d3a3049f.md)


## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-21 specify: completed; next design - requirements recorded (autopilot)
- 2026-11-21 design: completed; next build - design recorded (autopilot) (6 Done checklist item(s) left unticked)
- 2026-11-21 build: red: npx vitest run shared advanced-settings.test.ts turn-capacity-ipc.test.ts exit 1 - concurrentTurns not registered, no session.capacity channel or event, TURN_LIMIT not an error code (REQ-DATA-84718b36, REQ-FUNC-33cd5f9f, REQ-FUNC-52e97b95)
- 2026-11-21 build: red: npx vitest run core sessions/admission.test.ts turn-limit.test.ts exit 1 - no admission module and no SessionHost admission port (REQ-FUNC-52e97b95, REQ-FUNC-76e132bb, REQ-REL-11f00fcd, REQ-REL-1b33797f, REQ-FUNC-56f63014, REQ-FUNC-74c5be27, REQ-FUNC-33cd5f9f)
- 2026-11-21 build: green: npx vitest run shared turn-capacity-ipc.test.ts advanced-settings.test.ts session-activity-ipc.test.ts exit 0, 22 tests (REQ-DATA-84718b36, REQ-FUNC-33cd5f9f, REQ-FUNC-52e97b95)
- 2026-11-21 build: green: npx vitest run core sessions/admission.test.ts turn-limit.test.ts exit 0, 14 tests; existing delegation, delegation-tools, service, approvals, advanced tests exit 0, 85 tests (REQ-FUNC-52e97b95, REQ-FUNC-76e132bb, REQ-REL-11f00fcd, REQ-REL-1b33797f, REQ-FUNC-56f63014, REQ-FUNC-74c5be27, REQ-FUNC-33cd5f9f)
- 2026-11-21 build: DEVIATION build: renderer test turn-limit.test.ts written after the renderer change; its red was shown by mutation (status condition disabled: AssertionError, 1 failed), then restored - the test still guards the behavior
- 2026-11-21 build: green: npx vitest run renderer components/session/turn-limit.test.ts exit 0; existing advanced-settings, settings-save, session-advanced, workbench-advanced, workspace, main ipc-router exit 0, 90 tests; mocks mockApi, sessions and renderer api exit 0, 31 tests (REQ-UX-f20cb322)
- 2026-11-21 build: green: npm run typecheck exit 0 (bridge.test.ts channel list updated); npx vitest run main turn-limit.replay.test.ts, preload bridge.test.ts, main session-router.replay.test.ts exit 0, 15 tests (REQ-FUNC-52e97b95, REQ-FUNC-33cd5f9f, REQ-REL-11f00fcd, REQ-DATA-84718b36)
- 2026-11-21 build: check: errors=0; the remaining warnings predate this task (knowledge page sizes file-tools 26 KB and sessions 32 KB, ticket-ref patterns in older requirements)
- 2026-11-21 build: completed; next validate
- 2026-11-21 validate: review round 1: spec approved, quality approved; minor findings taken into one fix cycle: TurnLimit.notify reads limit() outside its try (a throwing getter would break release callers); delegation tool TURN_LIMIT result and the limit-fills-during-model-preparation path untested; browser mock bumps updatedAt on a refused send; REQ-REL-11f00fcd prose 'a refused admission' vague. Not taken: post-close release loop kept as defensive code; default delegations 3 under concurrentTurns 3 is the intended composition (app limit bounds every turn)
- 2026-11-21 validate: returned to build - apply round-1 minor review findings (notify guard, tool-level and in-transaction refusal tests, mock refusal side effect, requirement wording)
- 2026-11-21 build: green (fix cycle 1): npm run typecheck exit 0; biome check changed files exit 0; npx vitest run core admission/turn-limit/delegation/delegation-tools, renderer turn-limit + mocks sessions/mockApi, main turn-limit.replay exit 0, 71 tests (REQ-REL-11f00fcd, REQ-FUNC-74c5be27, REQ-REL-1b33797f, REQ-UX-f20cb322)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-d3a3049f --strict --run exit 0 (strict: ok); ran lint, typecheck, check:i18n, check:help, all ok; test not in the [check] run list; 56 warnings accepted: uncovered-source lists the new and changed test files (they are linked_tests), the four locale files and core index.ts re-export (no behavior of their own); context-size file-tools 26 KB and sessions 33 KB (sessions.md was 32 KB before this task); journal-header, ticket-ref and no-linked-tests in older journals and requirements; outside-layout and secret-in-diff for the untracked captures/ folder, which is not part of this change
- 2026-11-21 validate: DEVIATION validate: full suite skipped - user runs it at the end of the epic
- 2026-11-21 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-21 | decision=The concurrent-turn limit is the application-scope Advanced setting concurrentTurns (integer 1-16, default 3, applies right away), not a new regular application setting; it is edited in Settings > Advanced. | reason=The Advanced framework already gives settings-format-1 storage, range checks at save and resolve, the Settings control with Save/Cancel, en/ro/de/fr labels and the help table, and holds the delegations cap it must compose with. App scope only: a workbench or session value could not bound other workbenches. | source=technical | supersedes=none
- RULING-002 | date=2026-11-21 | decision=The at-capacity admission result is a new VeraError code TURN_LIMIT with params.limit, returned as the typed failure of session.send and as the delegation tool's error code, instead of a union response of session.send. | reason=A failed send already leaves the composer text and attachments in place, the delegation tool already maps every error code to a prompt tool result, and the 53 session.send call sites keep their response shape. | source=technical | supersedes=none
- RULING-003 | date=2026-11-21 | decision=The renderer learns capacity from IPC session.capacity and the app event session.capacity {active, limit}, emitted on every acquire, release and limit change; at capacity the composer stays unsent with an alert that becomes a 'turn can start' status when a slot frees; nothing is sent automatically. | reason=Epic #356: a new turn stays unsent in the composer and the user sees when capacity becomes available; the sidebar presentation is #360. | source=requirement | supersedes=none
- RULING-004 | date=2026-11-21 | decision=Admission is a core port (TurnAdmission, implemented by core TurnLimit) that Desktop main injects into every runtime's SessionService; the CLI injects none and keeps no turn limit. | reason=Core stays Electron-independent and testable; the epic scopes the limit to Desktop sessions across workbenches; the CLI runs its own process. | source=technical | supersedes=none
- RULING-005 | date=2026-11-21 | decision=A turn takes its slot in core startTurn after the per-workbench delegations check and releases it when it leaves the active map, before background compaction; compaction and Compact now take no slot. | reason=The ticket bounds active turns; a slot held through compaction would keep capacity busy after the reply is complete. | source=requirement | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-d3a3049f.md
changed: admission.ts notify/refresh guarded; turn-limit.test.ts tool-level and in-transaction refusal tests; admission.test.ts unreadable-limit test; mocks/sessions.ts refusal before updatedAt; renderer turn-limit.test.ts updatedAt check; REQ-REL-11f00fcd and REQ-FUNC-74c5be27 wording
evidence: python .agentic/aegis.py check --task TASK-d3a3049f --strict --run exit 0 (lint, typecheck, i18n, help ok); focused vitest green; review round 2 approved/approved
issues: full suite not run (epic end); sidebar capacity message and native acceptance are #360; browser mock does not re-announce capacity on a settings save
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-DATA-84718b36 - Store the concurrent-turn limit as an application Advanced setting
  - REQ-FUNC-52e97b95 - Refuse a new turn at the app-wide concurrent-turn limit
  - REQ-FUNC-76e132bb - Admit steering into an active turn without a new slot
  - REQ-REL-11f00fcd - Hold a turn slot until the turn ends and release it once
  - REQ-REL-1b33797f - Never admit more concurrent turns than the limit
  - REQ-FUNC-56f63014 - Apply a changed turn limit only to later admissions
  - REQ-FUNC-74c5be27 - Refuse a delegated launch at the turn limit promptly
  - REQ-FUNC-33cd5f9f - Report turn capacity through IPC and an app event
  - REQ-UX-f20cb322 - Keep the composer draft and show capacity at the turn limit
- deviations: 2 recorded
  - build: renderer test turn-limit.test.ts written after the renderer change; its red was shown by mutation (status condition disabled: AssertionError, 1 failed), then restored - the test still guards the behavior
  - validate: full suite skipped - user runs it at the end of the epic
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base e492bbe: 61 file(s) changed, 1864 line(s) added; 3 file(s) not content-scanned
- checks: errors=0 warnings=56 notes=40
- checklist: 9/9 done
