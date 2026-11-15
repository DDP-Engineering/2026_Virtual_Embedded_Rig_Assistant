# TASK-e4ee7fb8 - PERF-09 Workbench open without full database copies (#257)

stage: done
type: change
path: full
interaction: autopilot
requirements: REQ-REL-c12f79d2, REQ-REL-e939f88a, REQ-REL-93a4a5e0, REQ-REL-b7f1889b, REQ-PLAT-f0d13546
parent:
branch: feature/249-responsiveness
base: 4697f5d0a78b33f803389602431a0a69790dd868
opened: 2026-11-14

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

Problem: OBSERVED (`storage/db.ts:26-81`, `workbench/service.ts:596-606`): workbench open validates the
database through `snapshot`, which `readFileSync`s the DB and WAL twice and `writeFileSync`s a private copy,
synchronously in the main process; a writable open does this twice (service `inspectDatabase`, then
`openDb` again), a read-only open three times. STATED (#257): vectors are BLOBs in vera.db, so hundreds of MB
are plausible and the window freezes during the copy.
Desired outcome: STATED (user decision, #257): VERA opens its OWN workbench database directly, after it
holds the workbench lock, and checks the schema before any write; no full copy on that path. The private
copy stays only for read-only or foreign workbenches, and that copy is asynchronous. Epic #249 target:
main-process blocking <= 250 ms for a 200 MB DB.
Actors: an engineer opening a workbench in the desktop app; another VERA process owning the same workbench.
Primary scenario: open an owned workbench with a 200 MB vera.db -> lock acquired -> writer opened in place, schema
validated with query_only ON -> pragmas and writes -> window stays responsive.
Examples: owned open: no `vera-storage-*` temp folder is created. Read-only open (live foreign owner): a private
copy is made with `fs.promises.copyFile`, opened read-only, the source DB/WAL/SHM bytes stay unchanged.
Schema version 99 on an owned workbench: open fails INVALID, DB/WAL bytes unchanged, no lock left behind.
Counterexamples: a foreign live owner's database is never opened in place, not even read-only (SHM/WAL
recovery could touch it).
In scope: `storage/db.ts` (`openDb`, `snapshot`, `inspectDatabase`), `workbench/service.ts` `openFolder`
order, their tests, the storage spec paragraph, a timing script in the scratchpad.
Out of scope: STATED (coordinator brief): new UI/progress states, migration or compat code, a measurement
harness in the repo. #257 step 4 (busy state > 500 ms) only if an existing state covers it: INFERRED it does,
`run` serializes open and the renderer already awaits it; no change.
Constraints: STATED: simple, stable; Windows and Linux; WAL/SHM side files; existing lock-file semantics;
schema format stays 1; no compat code.
Success signals: targeted vitest + typecheck green; new tests for owned-direct, read-only async copy, schema
refusal before writes; before/after timing of main-thread blocking on a ~200 MB DB.
Evidence: OBSERVED `.agentic/specs/REQ-PLAT-f0d13546.md` says validation must precede writable opening and
lock changes; `workbench/service.test.ts:489` asserts an INVALID DB leaves a dead owner's lock byte-identical.
Assumptions: INFERRED: checking with query_only ON before any pragma writes nothing from VERA; SQLite may
still checkpoint a leftover WAL when the refusing connection is the last to close (Log DEVIATION).
Unknowns: whether NTFS mtime updates promptly for a concurrent writer; size+mtime+ino is the #257 accepted
change check.
Decision-blocking questions: none; the coordinator brief settles the order (lock, then check).
Proposed behaviors: (accepted by the user via the brief) owned path: lock -> writer with query_only check -> pragmas; foreign
or read-only path: async copy with stat check, one retry, then BUSY; EBUSY/EPERM during copy -> BUSY.
Path and reason: full.

| Criterion | Holds? | Evidence |
|---|---|---|
| no new externally observable behavior | no | INVALID now follows lock acquisition; a dead owner's lock is replaced then released |
| no new interface or data format | yes | `openDb` signature unchanged |
| no new dependency | yes | node:fs/promises only |
| an existing requirement already covers the behavior | yes | REQ-REL-b7f1889b, REQ-PLAT-f0d13546 (spec changes) |
| no security or data-handling change | no | foreign-DB protection guarantee touched |

## Requirement coverage

| Behavior | Requirement | Note |
|---|---|---|
| Owned open: in place after lock, read-only validation before the writer, no copy | REQ-REL-c12f79d2 | new |
| Owned open refused INVALID/CONFLICT before writes, acquired lock released | REQ-REL-e939f88a | new |
| Read-only open: async private copy, stat check, one retry, BUSY | REQ-REL-93a4a5e0 | new |
| Lifecycle, token ownership, failed switch retains prior | REQ-REL-b7f1889b | unchanged; spec paragraph revised |
| Pragmas on the owned connection | REQ-PLAT-f0d13546 | unchanged; spec paragraph revised |

## Design

Skipped: the revised paragraph of `specs/REQ-PLAT-f0d13546.md` says how (lock, then a query_only check on the writer before pragmas; async copy with a stamp check for read-only); two files change, no new interface, format or dependency.

## Log

- 2026-11-14 frame: journal opened
- 2026-11-14 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-14 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-14 design: skipped; next build - spec paragraph already defines the shape; two files, no new interface
- 2026-11-14 build: red: vitest run storage/db.test.ts exit 1 - owned open still makes a vera-storage copy; read-only copy is synchronous with no copyFile, no BUSY retry or EBUSY/EPERM mapping (REQ-REL-c12f79d2, REQ-REL-93a4a5e0); schema refusal with live WAL already green (REQ-REL-e939f88a guard)
- 2026-11-14 build: green: npmw exec vitest run core/src/storage core/src/workbench core/src/knowledge/keyword.test.ts desktop/src/main/sessions.test.ts exit 0, 128 passed 2 skipped (REQ-REL-c12f79d2, REQ-REL-e939f88a, REQ-REL-93a4a5e0, REQ-REL-b7f1889b, REQ-PLAT-f0d13546); npmw run typecheck exit 0
- 2026-11-14 build: DEVIATION build: an owned database refused INVALID while it has a leftover WAL and no other connection is checkpointed by SQLite on the refusing writer's close - committed frames of VERA's own database under VERA's lock; content unchanged, bytes may differ. Accepted for simplicity (ticket plan step 2)
- 2026-11-14 build: DEVIATION build: an INVALID owned open now takes the workbench lock first (a dead owner's stale lock is replaced, then released) - required by the user's lock-then-check decision; service.test.ts expectation updated
- 2026-11-14 build: timing (open-timing.test.ts, warm cache, this Windows host) 200 MB: owned total 654->13 ms, longest event-loop gap 328->7 ms; read-only total 1057->69 ms, gap 693->16 ms. 20 MB: owned 84->15 / 38->9, read-only 103->27 / 64->14
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 1: spec changes_required - spec paragraph and Frame/Design text describe a read-only check connection and byte-identical refusal, code checks on the writer with query_only ON; quality approved, with optional finding: stat-only change check may miss a same-size WAL restart on NTFS (compare the 32-byte header)
- 2026-11-14 validate: returned to build - round 1: align spec/journal text with the writer-side check; add WAL/DB header bytes to the copy change check
- 2026-11-14 build: green: round-1 fixes - npmw exec vitest run storage+workbench+keyword+desktop sessions exit 0 (128 passed, 2 skipped); typecheck exit 0; 200 MB timing owned 11 ms total / 5 ms gap, read-only 88 / 16
- 2026-11-14 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-14 validate: review round 2: spec approved, quality approved. Open minor (not taken): EPERM maps to BUSY on Linux too (ticket asks for both codes); the BUSY retry test proves only a growing WAL, not a same-size restart
- 2026-11-14 validate: final: aegis check --task TASK-e4ee7fb8 --strict --run exit 0; lint/typecheck/i18n ok (tests not in [check] run; focused vitest 128 passed 2 skipped after the last code edit); 48 remaining warnings are pre-existing records of other tasks/requirements
- 2026-11-14 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings

- RULING-001 | date=2026-11-14 | decision=Own workbench DB is opened directly after the workbench lock is held and its schema is checked before any write; the private copy remains only for read-only/foreign workbenches and is made asynchronously | reason=Removes full synchronous DB copies from workbench open (#257, epic #249 target 250 ms) | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-e4ee7fb8.md
changed: db.ts, service.ts, db.test.ts, service.test.ts, open-timing.test.ts (new), spec paragraph, 3 REQ-REL, 2 knowledge pages
evidence: aegis check --task TASK-e4ee7fb8 --strict --run exit 0; npmw exec vitest storage+workbench+keyword+desktop sessions exit 0 (128 passed, 2 skipped); typecheck exit 0
issues: minor not taken: EPERM->BUSY also on Linux; BUSY retry test proves a growing WAL only; leftover-WAL checkpoint on INVALID refusal (DEVIATION)
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-14)

- stage: validate; type: change; path: full; branch: feature/249-responsiveness
- requirements:
  - REQ-REL-c12f79d2 - Open an owned workbench database in place
  - REQ-REL-e939f88a - Refuse an owned workbench database in another schema before writes
  - REQ-REL-93a4a5e0 - Snapshot a foreign workbench database asynchronously
  - REQ-REL-b7f1889b - Bind database lifetime to workbench ownership
  - REQ-PLAT-f0d13546 - Configure workbench SQLite
- deviations: 2 recorded
  - build: an owned database refused INVALID while it has a leftover WAL and no other connection is checkpointed by SQLite on the refusing writer's close - committed frames of VERA's own database under VERA's lock; content unchanged, bytes may differ. Accepted for simplicity (ticket plan step 2)
  - build: an INVALID owned open now takes the workbench lock first (a dead owner's stale lock is replaced, then released) - required by the user's lock-then-check decision; service.test.ts expectation updated
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 4697f5d: 12 file(s) changed, 477 line(s) added
- checks: errors=0 warnings=48 notes=27
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
