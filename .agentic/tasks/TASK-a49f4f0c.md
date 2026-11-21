# TASK-a49f4f0c - PWB-01 Retain workbench runtimes during Desktop navigation

stage: done
type: feature
interaction: autopilot
requirements: REQ-FUNC-db6bacf7, REQ-FUNC-4747d310, REQ-FUNC-0dfa01fd, REQ-FUNC-0278c7ba, REQ-REL-b10ee7aa, REQ-FUNC-4af886f8, REQ-REL-436f00da, REQ-REL-61e5471c, REQ-FUNC-39d5e6d9
parent:
branch: master
base: 500bd23e717c5d9447409961c4cffd2e15be5592
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

Problem: Desktop main holds one WorkbenchService and one SessionsHost. Opening, creating or
reopening a workbench drains (closes) the single SessionService first, which aborts every active
turn of the previous workbench, stops its program runs and releases its lock and database
(OBSERVED: main/sessions.ts lifecycle()/drain(), main/index.ts workbench.open/create/close
handlers, core SessionService.close aborts active turns).
Desired outcome: The workbench shown in the UI (foreground) is separate from the set of open
workbench runtimes. A previous workbench stays open in the background while it has active turns
or session-owned work that must settle, with its own SessionService, database handle, write queue,
resource context, path permissions, lock, indexing and plugin/program state; it is released when
that work settles. Close, idle cleanup, app shutdown and safe-update checks act on the correct
runtimes (STATED: ticket #357 deliverables).
Actors: Desktop user navigating workbenches; Desktop main process; the updater's safe-quit barrier.
Primary scenario: Start a replay-backed turn in workbench A, open workbench B while it runs; A's
turn continues and completes in A; B runs a turn at the same time (STATED: #357 done criteria).
Examples: A busy -> open B -> A retained in background; A's turn ends -> A released (lock file
removed, programs of A stopped). A idle -> open B -> A released at once as today. Open the
foreground workbench again -> reopened in place, its turns continue. Open B fails (invalid
config) -> A stays foreground with its turns. Open a retained A again -> its existing runtime
becomes foreground.
Counterexamples: Explicit Close of the foreground workbench still aborts its turns (user intent);
background retained runtimes are not touched by it (STATED: "Closing or retiring the runtime for
A leaves B operational").
In scope: A runtime registry in Desktop main (foreground + retained runtimes, one WorkbenchService
and SessionsHost each); idle release of background runtimes; reopen-in-place of the current
workbench; failed target open; explicit close of the foreground; safe-update barrier over all
runtimes; app shutdown closing every runtime; core SessionService settle notification; per-runtime
program stop on release; tests named in the ticket.
Out of scope: Routing session operations and events to the owning (background) workbench - #358;
the app-wide concurrent-turn limit - #359; sidebar status/controls for background sessions -
#360 (STATED: epic #356 subtickets and the coordinating brief). Renderer changes. CLI (one
workbench per process, OBSERVED: apps/cli).
Constraints: master branch, no new branch (STATED: brief). Pre-release formats stay at version 1,
no migrations (STATED). Core stays Electron-independent (OBSERVED: project.md). Targeted tests
only; full suite runs at the end of the epic (STATED).
Success signals: Main-level test with real WorkbenchService/SessionsHost and a ReplayGateway: A's
turn started before B opens completes in A after B opened, and B's turn completes meanwhile;
registry tests for repeated navigation, failed target open, switching to the current workbench,
idle release, explicit close leaving the other runtime operational, safe-update barrier and
shutdown releasing every runtime.
Evidence: OBSERVED main/sessions.ts, main/index.ts (open/create/close handlers, before-quit drain,
Updates beginShutdown), core workbench/service.ts (single state/lock/db/ingest per instance,
acquire()/release()), core sessions/service.ts (hasActiveWork, close aborts turns),
main/display-documents.ts (owner self-heal), renderer components/workbench.tsx (subscribes to the
active id only).
Assumptions: Separate WorkbenchService instances in one process do not interfere: each owns one
folder's lock/db/ingest/write queue (INFERRED from service.ts fields). The indexer process keys
work by root (INFERRED from IndexerHost release(root)).
Unknowns: Upper bound on retained background runtimes (bounded in practice by #359's turn limit).
Decision-blocking questions: none (autopilot; defaults recorded as rulings).
Proposed behaviors: (accepted for autopilot, recorded as rulings) retain a busy previous
foreground runtime; release an idle one at once; release a background runtime when its work
settles; reopen the current workbench in place without draining; keep user terminals bound to the
foreground and closing on navigation as today; stop a runtime's program runs when it is released,
not when it moves to the background.

## Requirement coverage

| Behavior | Requirement |
|---|---|
| Busy previous workbench stays open in the background with its own resources; its turn completes there | REQ-FUNC-db6bacf7 (new) |
| The current workbench runs its own turns while a background workbench runs | REQ-FUNC-4747d310 (new) |
| Idle previous workbench, or settled background workbench, is released (sessions, runs, lock, database) | REQ-FUNC-0dfa01fd (new) |
| Opening the current workbench reopens it in place without draining | REQ-FUNC-0278c7ba (new) |
| Failed target open/create leaves every open workbench unchanged | REQ-REL-b10ee7aa (new) |
| Explicit close releases only the current workbench | REQ-FUNC-4af886f8 (new) |
| App exit closes sessions of every runtime, then releases each lock and database | REQ-REL-436f00da (new) |
| Safe update waits for turns and approvals of every runtime | REQ-REL-61e5471c (revised) |
| Program runs stop when their workbench is released, not on navigation | REQ-FUNC-39d5e6d9 (revised) |


## Design

**Approach.** A new Desktop main registry `WorkbenchRuntimes` (main/workbench-runtimes.ts) owns one
foreground runtime and a map of retained background runtimes keyed by canonical folder. A runtime is
`{ workbench: WorkbenchService, sessions: SessionsHost }`, built by an injected factory; each
WorkbenchService instance already owns exactly one folder's lock, database, write queue, ingest and
grants, and each SessionsHost builds its SessionService from its own instance (RULING-001,
REQ-FUNC-db6bacf7, REQ-FUNC-4747d310). Lifecycle operations run on the registry's serial queue.
`open(input)` resolves the canonical folder (new `WorkbenchService.locate`), picks the foreground
(same folder -> reopen in place, REQ-FUNC-0278c7ba), the retained runtime of that folder, or a fresh
runtime; opens through `sessions.lifecycle(op, false)` (no drain); only on success swaps the
foreground and parks the previous one: clear its subscriptions (RULING-005), retain it when
`sessions.idle()` is false, otherwise release it (REQ-FUNC-0dfa01fd). A failed open discards the fresh
runtime and changes nothing (REQ-REL-b10ee7aa). `create` uses the empty foreground or a fresh runtime. Release =
`sessions.lifecycle(drain) { stopPrograms(folder); workbench.close() }` in one host slot
(REQ-FUNC-39d5e6d9). `close()` releases the foreground only and keeps it as the empty foreground
(REQ-FUNC-4af886f8). Rejected: one WorkbenchService holding several workbenches - a core rewrite of
every lock/db/ingest path for no gain over instances.
**Interfaces and data.** Core `SessionHost.onWorkSettled?()` fires after a turn ends (no background
compaction) and after a background compaction settles; `SessionService.isSettled()` = no active turn,
no undecided approval, no running compaction (true once closed). SessionsHost gains option
`settled?()` (passed through, and called when its queued operations drop to zero), `idle()`
(no queued operation and service settled), `busy()` (existing update barrier: queued operation or
active turn/approval) and `lifecycle(op, drain = true)`. A settled signal on a retained idle runtime
queues its release, rechecked inside the queue (still retained, still idle, no shutdown); a failed
release is logged and the runtime stays retained for exit. `beginShutdown()` refuses while a
lifecycle operation is pending or any runtime is busy, then locks all (REQ-REL-61e5471c).
`closeSessions()`/`closeWorkbenches()` close every runtime, continue past a failure and rethrow the
first; later lifecycle calls return BUSY (REQ-REL-436f00da). Errors: BUSY after shutdown;
locate/open errors (INVALID, NOT_FOUND, CONFLICT) propagate unchanged. No stored format changes.
**Files and test seams.** core sessions/service.ts (+ service.test.ts settle test); core
workbench/service.ts `locate`; main/sessions.ts; main/workbench-runtimes.ts + workbench-runtimes.test.ts
(scripted runtimes: repeated navigation, failed open, same workbench, idle/settled release, close,
barrier, exit) and workbench-runtimes.replay.test.ts (real WorkbenchService/SessionsHost runtimes with
a gated ReplayGateway: A continues after B opens, B runs concurrently, A released when settled);
main/display-documents.ts (foreground getter, `closed(id)` only for its owner) + test; main/index.ts
wiring: `workbench()`/`sessions()` return the foreground, indexer restart refreshes every runtime,
plugin changes invalidate every runtime's prompt entries, quit and update use the registry.
**Risks and open decisions.** Two WorkbenchService instances never open the same folder because the
registry routes by canonical folder; an alias resolving elsewhere would be read-only, as for another
process. Terminals stay foreground-bound and close only when another workbench takes the foreground
or it closes (RULING-006, index.ts replaceForeground). Background turns awaiting approval stay
retained until the user returns (approvals routing is #358). No bound on retained runtimes (#359).
**Requirement map.** REQ-FUNC-db6bacf7 park/retain + per-runtime factory; REQ-FUNC-4747d310 separate
SessionsHost per runtime; REQ-FUNC-0dfa01fd park/settled release; REQ-FUNC-0278c7ba same-folder
reopen without drain; REQ-REL-b10ee7aa swap only after success; REQ-FUNC-4af886f8 close releases
foreground only; REQ-REL-436f00da closeSessions/closeWorkbenches; REQ-REL-61e5471c registry
beginShutdown; REQ-FUNC-39d5e6d9 stopPrograms inside release.
Diagrams: [diagram_TASK-a49f4f0c.md](diagram_TASK-a49f4f0c.md)


## Log

- 2026-11-21 frame: journal opened
- 2026-11-21 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-21 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-21 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-21 build: red: npmw npx vitest run src/libraries/core/src/sessions/service.test.ts -t 'signals the host once the turn settles' exit 1 - SessionService.isSettled/onWorkSettled missing (REQ-FUNC-0dfa01fd)
- 2026-11-21 build: red: npmw npx vitest run src/apps/desktop/src/main/workbench-runtimes.test.ts exit 1 - 10 tests, registry stub not implemented (REQ-FUNC-db6bacf7, REQ-FUNC-0dfa01fd, REQ-FUNC-0278c7ba, REQ-REL-b10ee7aa, REQ-FUNC-4af886f8, REQ-REL-61e5471c, REQ-REL-436f00da)
- 2026-11-21 build: red: npmw npx vitest run src/apps/desktop/src/main/workbench-runtimes.replay.test.ts exit 1 - 3 tests, registry stub not implemented (REQ-FUNC-db6bacf7, REQ-FUNC-4747d310, REQ-FUNC-0dfa01fd, REQ-FUNC-0278c7ba, REQ-REL-b10ee7aa, REQ-REL-436f00da)
- 2026-11-21 build: green: npmw npm run typecheck exit 0; npmw npx vitest run workbench-runtimes.test.ts workbench-runtimes.replay.test.ts sessions.test.ts display-documents.test.ts data-locations.test.ts updates.test.ts shutdown.test.ts core sessions/service.test.ts core workbench/service.test.ts tests/tooling/boundaries.test.ts - 165 passed, 1 failed: the known HEAD failure 'refuses external format/identity changes during pinned saves and closing redirected runtime' (REQ-FUNC-db6bacf7, REQ-FUNC-4747d310, REQ-FUNC-0dfa01fd, REQ-FUNC-0278c7ba, REQ-REL-b10ee7aa, REQ-FUNC-4af886f8, REQ-REL-436f00da, REQ-REL-61e5471c, REQ-FUNC-39d5e6d9)
- 2026-11-21 build: green: workbench-runtimes.test.ts + workbench-runtimes.replay.test.ts repeated 5 times, 13/13 each run (no flakiness)
- 2026-11-21 build: green: npmw npm run test:e2e -- tests/e2e/workbench-runtimes.spec.ts tests/e2e/workbench.spec.ts tests/e2e/session-workspace.spec.ts exit 0 - 7 passed, incl. new native A/B replay spec (REQ-FUNC-db6bacf7, REQ-FUNC-4747d310, REQ-FUNC-0dfa01fd)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: validate self-review finding: SessionsHost.lifecycle(op, false) keeps a SessionService bound to a database handle the reopen closed (read-only snapshot re-copied, or ownership regained); idle()/busy() then query a closed handle. red: npmw npx vitest run sessions.test.ts -t 'rebinds it when the database was replaced' exit 1 - TypeError database connection is not open (REQ-FUNC-0278c7ba)
- 2026-11-21 validate: returned to build - self-review: reopen in place must rebind sessions when the reopen replaced the database handle
- 2026-11-21 build: green: npmw npm run typecheck exit 0; npmw npx vitest run sessions.test.ts workbench-runtimes.test.ts workbench-runtimes.replay.test.ts exit 0, 24 passed; biome check on touched files clean (REQ-FUNC-0278c7ba)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 1: spec approved, quality approved, minor findings: terminals closed on failed open/reopen in place (spec 3); untested in-queue recheck and foreground close with real runtimes (spec 1, 4); REQ-FUNC-39d5e6d9 verification names stopSession in the session.stop handler (spec 2); e2e relies on wall-clock margin (quality 1); settled observer error could reject a host operation (quality 2); design wording on create (spec 5). Addressing them in one fix cycle.
- 2026-11-21 validate: returned to build - round 1 minor findings: terminals on failed open/reopen, verification gaps, settled observer containment, e2e margin
- 2026-11-21 build: fix cycle 1: coverage tests green at once (in-queue recheck; foreground close with real runtimes); red->green: sessions.test.ts 'settled observer throws' exit 1 (observer failed) then exit 0 after containing the observer; index.ts closes user terminals only when another workbench takes the foreground (RULING-006); e2e uses ui-slow for A so B's whole turn completes while A runs
- 2026-11-21 build: green: npmw npm run typecheck exit 0; npmw npx vitest run sessions.test.ts workbench-runtimes.test.ts workbench-runtimes.replay.test.ts exit 0 (27 passed); npmw npm run test:e2e -- workbench-runtimes, workbench, session-workspace, terminal specs exit 0 (8 passed) (REQ-FUNC-0dfa01fd, REQ-FUNC-0278c7ba, REQ-REL-b10ee7aa, REQ-FUNC-4af886f8, REQ-FUNC-39d5e6d9)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: review round 2: spec approved, quality approved; minor findings: replaceForeground compares workbench id only, so two folders sharing an id (clones) keep the first folder's terminals (spec 1, fixing); e2e does not assert A's terminal closed after B takes over (spec 2, fixing); closeAll failing after the swap would reject a succeeded open (quality 2, accepted: no realistic trigger, authority stays suspended)
- 2026-11-21 validate: returned to build - round 2: compare foreground by id and folder before keeping terminals; assert A's terminal closed in e2e
- 2026-11-21 build: fix cycle 2: red: npmw npm run test:e2e -- tests/e2e/workbench-runtimes.spec.ts exit 1 - a clone sharing A's workbench id kept A's terminal (spec line 111); green after comparing the foreground by id and folder: npmw npm run test:e2e -- workbench-runtimes, terminal, workbench specs exit 0 (6 passed); typecheck exit 0 (REQ-REL-b10ee7aa, REQ-FUNC-0278c7ba)
- 2026-11-21 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-21 validate: inspection (REQ-FUNC-39d5e6d9): index.ts session.stop handler calls SessionService.stop (index.ts:1262), which calls runner.stopSession (core sessions/service.ts:1734); before-quit concurrent drain step 'programs' runs programs.stopAll() before the ordered session/workbench steps (index.ts:1554); CLI run.ts:215 registers programs.stopAll() - observed as stated
- 2026-11-21 validate: review round 3: spec approved, quality approved, no findings
- 2026-11-21 validate: final: python .agentic/aegis.py check --task TASK-a49f4f0c --strict --run exit 0; ran lint ok, typecheck ok, i18n ok, help ok; errors=0. Remaining task-related warnings: context-size sessions.md 30 KB > 24 (already 29.6 KB at HEAD; this task added one bullet), uncovered-source on test files and vitest.config.ts (test seams matched by the source globs, not product behavior). All other warnings belong to other records.
- 2026-11-21 validate: DEVIATION validate: full suite skipped - user runs it at the end of the epic; targeted proof: focused vitest (27 + 165 earlier, one known HEAD failure 'refuses external format/identity changes during pinned saves and closing redirected runtime') and native e2e workbench-runtimes, workbench, session-workspace, terminal specs
- 2026-11-21 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-21 | decision=Each open workbench runtime is one WorkbenchService instance plus one SessionsHost, held by a Desktop main registry (foreground + retained background runtimes keyed by canonical folder) | reason=WorkbenchService already owns exactly one folder's lock, database, write queue, ingest and grants; separate instances keep all of them bound to the originating workbench without a core rewrite | source=technical | supersedes=none
- RULING-002 | date=2026-11-21 | decision=Navigation retains the previous foreground runtime while it has owned work (queued host operations, active turns, undecided approvals, background compaction) and releases it at once otherwise; a retained runtime is released when that work settles | reason=Ticket: keep a previous workbench alive while it has active turns or session-owned work that must settle; release an idle background runtime | source=requirement | supersedes=none
- RULING-003 | date=2026-11-21 | decision=Opening the current workbench reopens it in place without draining its sessions; a failed target open leaves the foreground and every retained runtime untouched and discards the new runtime | reason=Ticket regression cases; today both paths drained the current SessionService first | source=requirement | supersedes=none
- RULING-004 | date=2026-11-21 | decision=User terminals stay bound to the foreground workbench and close on navigation as today; plugin program runs of a runtime stop when that runtime is released, not when it moves to the background | reason=Terminals are not in the ticket's retained resource list; program state must stay with the originating workbench while its turns run (autopilot default) | source=technical | supersedes=none
- RULING-005 | date=2026-11-21 | decision=In this ticket session IPC operations and subscriptions keep using the foreground runtime; subscriptions of a runtime moved to the background are cleared | reason=Routing session operations and events to the owning workbench is #358 (coordinating brief) | source=user | supersedes=none
- RULING-006 | date=2026-11-21 | decision=User terminals stay bound to the foreground workbench and close when another workbench takes the foreground or the foreground closes; a failed open or create and a reopen in place keep them. Plugin program runs of a runtime stop when that runtime is released, not when it moves to the background. | reason=Round-1 spec review: a failed open and a reopen in place are not navigation; closing terminals there contradicted REQ-REL-b10ee7aa and REQ-FUNC-0278c7ba | source=technical | supersedes=RULING-004


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-a49f4f0c.md
changed: replaceForeground compares workbench id and folder; e2e asserts A's terminal closes, also for a same-id clone
evidence: python .agentic/aegis.py check --task TASK-a49f4f0c --strict --run exit 0
issues: full suite not run (epic end); known HEAD failure in workbench/service.test.ts unchanged; background session IPC/event routing is #358
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-21)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-FUNC-db6bacf7 - Retain a busy workbench in the background during navigation
  - REQ-FUNC-4747d310 - Run turns in the current workbench while a background workbench runs
  - REQ-FUNC-0dfa01fd - Release an idle workbench runtime
  - REQ-FUNC-0278c7ba - Reopen the current workbench in place
  - REQ-REL-b10ee7aa - Keep open workbenches unchanged when a target open fails
  - REQ-FUNC-4af886f8 - Close only the current workbench runtime
  - REQ-REL-436f00da - Release every workbench runtime on app exit
  - REQ-REL-61e5471c - Install updates after work completes
  - REQ-FUNC-39d5e6d9 - Stop runs on session stop, workbench close and app exit
- deviations: 1 recorded
  - validate: full suite skipped - user runs it at the end of the epic; targeted proof: focused vitest (27 + 165 earlier, one known HEAD failure 'refuses external format/identity changes during pinned saves and closing redirected runtime') and native e2e workbench-runtimes, workbench, session-workspace, terminal specs
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 500bd23: 41 file(s) changed, 2018 line(s) added; 3 file(s) not content-scanned
- checks: errors=0 warnings=41 notes=40
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
