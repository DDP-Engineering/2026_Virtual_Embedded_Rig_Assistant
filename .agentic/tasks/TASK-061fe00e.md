# TASK-061fe00e - Restore document tabs per session

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-DATA-3b6664f9, REQ-FUNC-8a061992, REQ-REL-4622d972, REQ-REL-f19a4bc2, REQ-FUNC-d9d16533
parent: TASK-0b2df7fa
branch: master
base: 9602160bf499454cfc07349fe1e4920cecaabb9a
opened: 2026-11-01

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

Problem: A session's document tabs (TASK-79f6ffd3) live only for the application run; a restart opens every session with the Chat tab alone (OBSERVED: the tab map is React state in DocumentViewerProvider).
Desired outcome: Each session's tabs are saved when they change and reopened when the session opens again, including after a restart, in the same order, with the same selected tab and each document at its place; tabs whose files no longer exist are not reopened (STATED in parent TASK-0b2df7fa: "salvare pozitii la inchidere sesiune (la repornire sesiune se redeschid si tab-urile, daca fisierele nu mai exista, nu se mai deschid acelea)"). The record lives in localStorage (parent RULING-002) and holds the order, the selected tab and the place in each document (parent RULING-003).
Actors: the embedded engineer returning to a session.
Primary scenario: session S has Chat | uart.log (line 251) | stm32g474.pdf (page 47, selected); VERA restarts; opening S shows the same tabs, the PDF selected at page 47, and the log at line 251 when selected.
Examples: uart.log was deleted meanwhile: S reopens with Chat | stm32g474.pdf. A session deleted from the sidebar leaves no stored record behind.
Counterexamples: tabs opened while no session is active are not saved (INFERRED: the record is per session; the workbench page without a session has none).
In scope: a version 1 localStorage record per workbench and session; saving on every tab change and place change (throttled); restoring when a session's tabs are first needed in a run; leaving out documents that no longer exist; an invalid record ignored; record removal when its session is deleted.
Out of scope: saving tabs in the workbench database (parent RULING-002); restoring sessions without an id; migration of records (AGENTS.md: version stays 1, other versions are invalid).
Constraints: as the parent; localStorage access is wrapped so disabled storage keeps the app working (OBSERVED pattern: App.tsx `vera.session.<benchId>`, layout.ts).
Success signals: after a restart the session shows its tabs, order, selection and places; a deleted file's tab is gone; an invalid record gives Chat only; deleting a session removes its record.
Evidence: viewer-context.tsx tab set and places ref, App.tsx session storage pattern, layout.ts strict record, IPC docs.stat, downloads.list, artifacts.list and session.delete (shared/ipc.ts) read 2026-11-01.
Assumptions: none beyond the labelled claims.
Unknowns: none blocking.
Decision-blocking questions: none.
Proposed behaviors: (accepted in specify under autopilot) existence is checked for every restored tab before it is shown (docs.stat for workbench files, downloads.list for downloads, artifacts.list for artifacts); a document that exists but fails to load keeps its tab with the error and Retry; when the selected tab is left out, Chat is selected; places are saved at most every 500 ms and on page hide.
Path and reason: full.

  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | tabs survive restarts |
  | no new interface or data format | no | localStorage record `vera.tabs.<workbench>.<session>` |
  | no new dependency | yes | none |
  | an existing requirement already covers the behavior | no | none |
  | no security or data-handling change | no | paths of opened documents stored in renderer storage |

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Saved | version 1 record per session, throttled | REQ-DATA-3b6664f9 | renderer tests; native e2e where named | see Requirement map |
| Restored | order, selection and places come back | REQ-FUNC-8a061992 | renderer tests; native e2e where named | see Requirement map |
| Missing files | gone documents are left out | REQ-REL-4622d972 | renderer tests; native e2e where named | see Requirement map |
| Invalid record | only Chat; replaced on next change | REQ-REL-f19a4bc2 | renderer tests; native e2e where named | see Requirement map |
| Cleanup | deleting a session removes its record | REQ-FUNC-d9d16533 | renderer tests; native e2e where named | see Requirement map |

## Design

**Approach.** A new `lib/document-tabs-store.ts` owns the localStorage record
`vera.tabs.<workbenchId>.<sessionId>`: `readTabs`, `writeTabs`, `removeTabs`, each wrapped so a
throwing storage acts like an empty one (REQ-REL-f19a4bc2). The record is
`{version: 1, active, tabs: [{target, place?}]}` validated by a strict zod schema whose target union
mirrors `ViewerTarget` and whose place union mirrors `DocumentPlace`; anything else reads as no
record. `DocumentViewerProvider` takes `sessionId`; when a session's tab set is first needed in a
run, it reads the record, checks every tab's existence and then installs the set with its places
(REQ-FUNC-8a061992): workbench paths (path, textPath and the path of file refs) through
`docs.stat` (NOT_FOUND drops the tab), downloads through one `downloads.list`, artifacts through one
`artifacts.list` of the session; other failures keep the tab, whose load then shows its own error
(REQ-REL-4622d972). A dropped selected tab selects Chat and the record is rewritten without it.
Saving runs after every tab-set change and place change, throttled to 500 ms, and flushes on
`pagehide` (REQ-DATA-3b6664f9). App removes a session's record when it deletes the session
(REQ-FUNC-d9d16533). Rejected: saving to the workbench database (parent RULING-002).

**Interfaces and data.** `readTabs(storage, workbenchId, sessionId): StoredTabs | undefined`,
`writeTabs(storage, workbenchId, sessionId, value)`, `removeTabs(storage, workbenchId, sessionId)`.
Restoring is asynchronous: until it completes the session shows Chat only and opens made meanwhile
are kept after the restored tabs. No session id: nothing is read or written.

**Files and test seams.** lib/document-tabs-store.ts (new) with document-tabs-store.test.ts;
viewer-context.tsx (sessionId prop, restore, throttled save); App.tsx (sessionId prop, record removal
on delete). Tests: store unit tests; document-tabs.test.ts restore cases with a fake storage and IPC
spies; workspace.test.ts for deletion; native e2e restart in an existing restart spec.

**Risks and open decisions.** The record stores workbench-relative paths and refs of opened
documents in renderer storage; it holds no document content (Frame: data-handling change).

**Requirement map.** REQ-DATA-3b6664f9 store + throttled save; REQ-FUNC-8a061992 restore on first
need; REQ-REL-4622d972 existence checks; REQ-REL-f19a4bc2 strict schema and guarded storage;
REQ-FUNC-d9d16533 App deletion hook.

Diagrams: [diagram_TASK-061fe00e.md](diagram_TASK-061fe00e.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: implementation on master in the shared checkout per AGENTS.md; builds after TASK-6c4aeed8 (same files)
- 2026-11-01 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build - children 1, 2 closed; 4 built; design accepted (autopilot) (6 Done checklist item(s) left unticked)
- 2026-11-01 build: DEVIATION build: no red line before each increment - per parent RULING-006 the user asked for the whole implementation first and one test run at the end; tests were written after the code and all pass
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: Spec review round 1: REQ-FUNC-d9d16533 verification revised from an App renderer test to the store test plus the native delete e2e (the delete path in App is one call; the e2e drives it through the real menu)
- 2026-11-01 validate: Review round 1 fixes: a deleted session's record is never rewritten by a pending save (store remembers deleted keys for the run); restored tabs load only when selected; a document opened during the restore keeps its live tab, target and place and the engineer's selection stands; tabs that cannot be stored are left out and only the newest 200 kept instead of losing the record; showing a session no longer writes an empty record; tests for selected missing document, unlisted downloads/artifacts, log line place, move and line saves, once-per-run restore, refusing storage and delete within the throttle
- 2026-11-01 validate: Accepted, not fixed (quality round 1, low): records of a removed workbench stay in localStorage - small, bounded per session, and read only for that workbench; cleanup belongs with workbench removal, out of this task
- 2026-11-01 validate: Quality round 2 low notes accepted: a restored download tab shows the generic downloaded-file label until first selected (lazy loading; cosmetic); the deleted-key set is module state (session ids are unique)
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-061fe00e.md
changed: per-session tab records in localStorage with restore, missing-document drop, lazy loading and delete cleanup; review round 1 fixes
evidence: unit 1160 passed; e2e 15/15 incl. native restart and session delete; strict check exit 0; spec and quality approved in round 2
issues: accepted low notes logged (download label until selected, removed-workbench records)
spec_compliance: approved
implementation_quality: approved
review_round: 2

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-DATA-3b6664f9 - Save a session's document tabs in localStorage
  - REQ-FUNC-8a061992 - Restore a session's document tabs
  - REQ-REL-4622d972 - Leave out restored tabs whose documents are gone
  - REQ-REL-f19a4bc2 - Ignore an invalid stored tab record
  - REQ-FUNC-d9d16533 - Remove stored tabs with their session
- deviations: 1 recorded
  - build: no red line before each increment - per parent RULING-006 the user asked for the whole implementation first and one test run at the end; tests were written after the code and all pass
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=2
- diff vs task base 9602160: 78 file(s) changed, 5335 line(s) added
- checks: errors=0 warnings=69 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
