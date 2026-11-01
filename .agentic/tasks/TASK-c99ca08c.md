# TASK-c99ca08c - Reorder workbenches and sessions in the sidebar

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-FUNC-df70c1c8, REQ-FUNC-2b3ff3a8, REQ-FUNC-7871b582, REQ-REL-514e47d3, REQ-UX-ab0d5e61
parent:
branch: master
base: 33e72b8c7611d3c36c287ca49dae0b6474338c8f
opened: 2026-10-31

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

Problem:
- STATED (user, 2026-10-31): the user wants to move a workbench, and a session of a workbench,
  higher or lower relative to the others in the left sidebar.
- OBSERVED: workbench order is the order of `settings.recentWorkbenches`; opening a workbench
  moves it to the front (core workbench/service.ts open), and the sidebar shows pinned entries
  first (renderer workbench-navigation.tsx). Pin/remove go through `workbench.recent`.
- OBSERVED: sessions come from each workbench's SQLite, newest created first
  (storage/repos/sessions.ts); the sidebar lists non-archived sessions, then an Archived group
  (renderer session/session-list.tsx). No stored session position exists.
Desired outcome: the user moves a workbench or a session one place up or down from its row
  menu (or with a keyboard shortcut on the row); the order persists across restarts and is not
  changed by opening a workbench.
Actors: the desktop user (mouse and keyboard).
Primary scenario: the user opens the menu of the third workbench, chooses Move up twice, then
  moves a session of the active workbench to the top; after a restart both orders are kept.
Examples: Move up on the first item of a group is unavailable; pinned workbenches move only
  among pinned ones and unpinned ones among unpinned ones.
Counterexamples: search results and archived sessions are not reordered.
In scope: workbench order in `recentWorkbenches` (no move on open, new workbenches first);
  session order per workbench in user settings; Move up/Move down menu items for workbench
  and session rows; a row keyboard shortcut; pruning stale session ids; tests.
Out of scope: drag and drop (RULING-001); storing session order in the workbench database
  (RULING-003); ordering archived sessions or search results.
Constraints: on master; no commits unless asked; read-only settings refuse reordering like
  pin/remove (DENIED); no workbench database migration.
Success signals: core tests move entries within their pinned group and keep the order after an
  open; renderer tests move workbenches and sessions from the menu and the shortcut and keep
  them after reload; native e2e reorders and restarts.
Evidence: core workbench/service.ts (open, recent), shared settings.ts and ipc.ts
  (workbench.recent), renderer workbench-navigation.tsx, session/session-list.tsx, App.tsx.
Assumptions: none.
Unknowns: the exact keyboard shortcut (proposed Alt+Shift+ArrowUp/ArrowDown on a focused row).
Decision-blocking questions: none open. Answered by the user (RULING-001..003).
Proposed behaviors (accepted by RULING-001..003 unless marked):
- Move up / Move down in each workbench and session row menu (RULING-001).
- Opening a workbench keeps its place; a newly added workbench goes first (RULING-002).
- Orders are stored in the user settings: workbenches as the `recentWorkbenches` order, sessions
  as a per-workbench list of session ids; sessions missing from the list (new ones) appear first
  newest-first, deleted ids are dropped (RULING-003).
- Not accepted, design detail: Alt+Shift+ArrowUp/ArrowDown on a focused row moves it.
Path and reason: full.
  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | new menu actions, order no longer follows opens |
  | no new interface or data format | no | settings field, IPC parameter |
  | no new dependency | yes | none |
  | an existing requirement already covers the behavior | no | recents requirements cover pin/remove only |
  | no security or data-handling change | yes | local preference ordering |

## Requirement coverage

| Behavior | Requirement | Source in Frame |
|---|---|---|
| move a workbench within its pinned group | REQ-FUNC-df70c1c8 | RULING-001, desired outcome |
| opening keeps a workbench's place, new ones first | REQ-FUNC-2b3ff3a8 | RULING-002 |
| session order per workbench in user settings, new sessions first, deleted dropped | REQ-FUNC-7871b582 | RULING-003 |
| read-only settings refuse moves | REQ-REL-514e47d3 | constraint (like pin/remove) |
| menu items and Alt+Shift+Arrow keys, focus kept | REQ-UX-ab0d5e61 | RULING-001, proposed shortcut |

Revised: spec REQ-DATA-4a030001.md (recents order on open/move; optional sessionOrder written only through the internal settings patch). E2E navigation-actions.spec (a regression test, not linked to a requirement): earlier uncommitted work had replaced its Welcome open-recent click with the first sidebar entry; that pick broke under RULING-002 because opening no longer moves a workbench first, so it now chooses the workbench by name.

## Design

**Approach.**
- Workbenches (REQ-FUNC-df70c1c8, REQ-FUNC-2b3ff3a8): `WorkbenchService.recent()` gains
  `move {folder, offset: -1|1}`. It finds the nearest entry in that direction with the same
  `pinned` state and swaps the two in `recentWorkbenches`, which stays the single source of
  order (the renderer's pinned-first sort is stable, so groups keep this order). `open()`
  updates an existing entry in place and prepends only a new folder.
- Sessions (REQ-FUNC-7871b582): user settings gain optional `sessionOrder: {workbenchId: id[]}`
  (settings are a loose object, schema version unchanged). A small main module
  `session-order.ts` holds two pure functions: `orderSessions(list, order)` (unlisted sessions
  first in their current newest-first order, then the stored order; archived ones keep their
  relative order) and `moveSession(list, order, id, offset)` (moves among non-archived
  sessions, returns the new full id list without deleted ids). Main applies `orderSessions`
  in `session.list`, and a new `session.move {workbenchId, sessionId, offset}` channel saves
  the result through the settings service.
- Read-only settings (REQ-REL-514e47d3): both moves throw DENIED before writing, like pin/remove.
- Renderer (REQ-UX-ab0d5e61): workbench and session row menus gain Move up / Move down,
  disabled at their group edges (pinned/unpinned for workbenches; first/last non-archived
  session); search results and archived rows have none. Alt+Shift+ArrowUp/Down on a focused
  row moves it; after the list refreshes, focus is put back on the moved row by its key.
  Rejected: drag and drop (RULING-001); a column in the workbench database (RULING-003).

**Interfaces and data.**
- `workbench.recent` request: `move?: {folder, offset: -1 | 1}`.
- New channel `session.move`: `{workbenchId, sessionId, offset: -1 | 1} -> {}`; CONFLICT when
  the workbench is not the active one, NOT_FOUND for an unknown or archived session, DENIED for
  read-only settings.
- Settings: `sessionOrder?: Record<workbenchId, sessionId[]>` (patchable).
- Locales: `projects.moveUp`, `projects.moveDown`, `chat.moveUp`, `chat.moveDown`.

**Files and test seams.**
- core workbench/service.ts + service.test.ts (move, open in place, read-only).
- shared settings.ts, ipc.ts (+ shared tests); main session-order.ts (+ test), index.ts;
  ipc-router/bridge channel lists.
- renderer workbench-navigation.tsx, session/session-list.tsx, App.tsx, locales, mockApi;
  workspace.test.ts; native e2e (new reorder spec or an existing workbench spec).

**Risks and open decisions.**
- Moving a focused DOM node can drop focus; the row is refocused by key after refresh.
- No open product decisions.

**Requirement map.** As in the coverage table.

Diagrams: [diagram_TASK-c99ca08c.md](diagram_TASK-c99ca08c.md)

## Log

- 2026-10-31 frame: journal opened
- 2026-10-31 frame: completed; next specify - scope accepted with RULING-001..003; TASK-1c2ea187 closed (7 Done checklist item(s) left unticked)
- 2026-10-31 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-10-31 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-10-31 build: red: shared ordering.test (module and session.move channel missing), core service.test 'moves a workbench within its pinned group' and 'retains all unique' (open still moves to front, recent() has no move), main session-order.test (module missing), renderer workspace.test 'Move up and Move down' (no menu items) all fail as expected
- 2026-10-31 build: design refinement: pure orderSessions/moveSession/moveRecentWorkbench live in shared ordering.ts so core, main and the renderer mock share them; main session-order.ts keeps only the settings-applying createSessionOrder; sessionOrder is patchable only through the internal settings service patch, not the public app.settings.update patch
- 2026-10-31 build: green: shared ordering.test, core workbench service.test (move within pinned group, open keeps place, read-only DENIED), main session-order.test, renderer workspace.test 'Move up and Move down' pass; typecheck clean; lint clean on touched files. Full unit suite: 4 failures, all pre-existing and listed for the parent validation (write/edit registry, compaction transcript, bounds large text DOM, Settings tab count); plan-tab 'connects Plan' failed once under load and passed in isolation and on a full rerun (flake, untouched code)
- 2026-10-31 build: evolution reviewed: 23 paths (3 added) all named by the design or its logged refinement (shared ordering.ts); navigation-actions.spec updated because opening no longer moves a workbench first (RULING-002)
- 2026-10-31 build: check --task: errors=0; no finding names this task's journal or its five requirements; the 139 warnings (stale-paths, no-linked-tests) belong to older requirements and do not limit this candidate
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: self-review of the diff against Frame scope/exclusions, requirements, design, error paths (NOT_FOUND unknown/archived, CONFLICT inactive workbench, DENIED read-only), portability and security found nothing to return; knowledge updated: workbench.md, sessions.md, ipc-boundary.md, app-data.md; spec REQ-DATA-4a030001.md; project/environment context unaffected (no new command, dependency or setup); no Manual/Inspection verifications
- 2026-10-31 validate: review round 1 findings: (a) both: no test that search results get no Move items/shortcut (REQ-UX-ab0d5e61); (b) spec: Alt+Shift+Arrow unreachable on a missing workbench row because only the disabled toggle/name buttons carry it - add it to the menu summaries; (c) spec: REQ-FUNC-2b3ff3a8 links navigation-actions.spec, which checks no position, and its verification names 'the third' entry while the test opens another; journal should say navigation-actions first lost its Welcome open-recent target to earlier uncommitted work, then its first-entry pick broke under RULING-002; (d) spec Q1: stored order also ranks archived sessions, contrary to the Frame exclusion 'ordering archived sessions' - archived sessions keep repository order and are not stored; (e) quality (non-blocking, taken): clearing the refocus target when a move fails can drop focus. Accepted, not changed: sessionOrder entries for workbenches removed from recents are kept (re-adding restores the order; growth bounded by user action); main move queue kept although sessions.run also serializes; brief jump of a reused moved session after New session until the refetch
- 2026-10-31 validate: returned to build - review round 1: search-results test, menu-summary shortcut, archived sessions outside the stored order, refocus after failed move, REQ-FUNC-2b3ff3a8 links/wording
- 2026-10-31 build: e2e full suite (VERA_TEST=1 npm run test:e2e): 68 passed, 7 failed - exactly the pre-existing parent-validation set (shell x3, compact-shell x2, chatgpt, session-reasoning); sidebar-order and navigation-actions pass; shared dist intact
- 2026-10-31 build: red (round 1): vitest ordering.test 'lists unlisted…' and 'moves a non-archived…' fail - archived sessions still ranked and stored (REQ-FUNC-7871b582); workspace.test 'search results get no move items…' fails at the menu-trigger shortcut, after its search-results assertions hold (REQ-UX-ab0d5e61)
- 2026-10-31 build: green (round 1): vitest ordering/service/session-order/workspace exit 1 only on the pre-existing Settings tab-count test, new and updated tests pass; tsc -b exit 0; biome clean on touched files (the menu shortcut lives in the details onKeyDown beside Escape, since biome rejects a handler on summary); e2e sidebar-order, navigation-actions, workbench-navigation pass natively. Refocus after a failed move is not provable in jsdom (disabling does not blur there); native sidebar-order covers the success path (REQ-UX-ab0d5e61, REQ-FUNC-7871b582)
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: review round 2: spec approved, quality approved. Non-blocking notes accepted without edits (an edit would reopen review): orderSessions' comment says archived sessions come last, which holds once an order is stored (no stored order returns repository order; the renderer groups archived rows anyway); a keyboard move from inside an open menu leaves the menu open with focus on its trigger; a restored session returns to its stored place, or first once a later move dropped its id (consistent with REQ-FUNC-7871b582 'absent from the stored order first')
- 2026-10-31 validate: final attempt: check --task TASK-c99ca08c --strict --run exit 1 - lint error introduced by this task: tests/e2e/sidebar-order.spec.ts not biome-formatted; typecheck ok, i18n ok
- 2026-10-31 validate: returned to build - final proof: biome format error in new tests/e2e/sidebar-order.spec.ts; also narrow the orderSessions comment and sessions.md wording (archived last only once an order is stored) per both round-2 non-blocking notes
- 2026-10-31 build: green (round 2 fixes): biome format on tests/e2e/sidebar-order.spec.ts; biome check . has no errors; ordering.test 4 passed after the comment-only change; e2e sidebar-order passes natively
- 2026-10-31 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-10-31 validate: final: python .agentic/aegis.py check --task TASK-c99ca08c --strict --run exit 0; ran lint (biome, no errors), typecheck (tsc -b), i18n parity; tests are not in the [check] run list, so the full unit suite ran after the proof as extra evidence without edits: 1051 passed, 4 failed - all pre-existing and outside this task (core sessions compaction transcript, core write/edit registry, documents 'bounds large text DOM', workspace Settings tab count), kept for the parent validation. Full e2e before review round 1: 68 passed, 7 pre-existing failures (shell x3, compact-shell x2, chatgpt, session-reasoning); sidebar-order, navigation-actions, workbench-navigation rerun natively after each fix. Remaining check warnings (139 stale-paths/no-linked-tests) belong to older requirements. Review: round 3 spec approved, quality approved
- 2026-10-31 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: commit: the user authorized committing all uncommitted work as one local commit on master (2026-11-01)

## Rulings

- RULING-001 | date=2026-10-31 | decision=Reorder with Move up / Move down in the row menus (plus a keyboard alternative); no drag and drop now | reason=user chose 'Meniu Muta sus/jos' | source=user | supersedes=none
- RULING-002 | date=2026-10-31 | decision=Opening a workbench no longer moves it to the top; new workbenches appear first | reason=user chose 'Nu-l mai muta' | source=user | supersedes=none
- RULING-003 | date=2026-10-31 | decision=Store both orders in the user settings, not in the workbench database | reason=user chose 'In setarile tale' | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-c99ca08c.md
changed: design note; diagram_TASK-c99ca08c.md
evidence: python .agentic/aegis.py check --task TASK-c99ca08c --strict --run exit 0
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-10-31)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-FUNC-df70c1c8 - Move a workbench within its pinned group
  - REQ-FUNC-2b3ff3a8 - Keep a workbench's place when it is opened
  - REQ-FUNC-7871b582 - Order the sessions of a workbench as the user arranged them
  - REQ-REL-514e47d3 - Refuse reordering when settings are read-only
  - REQ-UX-ab0d5e61 - Move workbenches and sessions from their row menu or the keyboard
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 33e72b8: 192 file(s) changed, 10905 line(s) added; 7 file(s) not content-scanned
- checks: errors=0 warnings=139 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
