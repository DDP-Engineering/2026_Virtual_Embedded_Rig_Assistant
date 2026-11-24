# TASK-ec507a39 - Reopen, pin, and search session tabs (#398)

stage: done
type: feature
interaction: autopilot
requirements: REQ-UX-de16f7fe, REQ-UX-b51d6193, REQ-UX-83da20cf, REQ-UX-ba7db808, REQ-DATA-3b6664f9, REQ-UX-e0410483, REQ-UX-6ecb6c83, REQ-UX-67abf562, REQ-FUNC-d9d16533
parent:
branch: master
base: b8f1038a6ef63fe942522501537e549477bf7086
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

## Frame

Problem: STATED: #398 asks for a way to recover, keep and locate tabs beside Chat. OBSERVED: The current document strip can close and reorder tabs, but exposes no history, pinning or search.
Desired outcome: STATED: A user can reopen recently closed document and diff tabs, protect pinned tabs during bulk operations, and search titles or paths in the current session.
Actors: Desktop users reviewing documents, Git diffs and session change diffs beside Chat.
Primary scenario: Pin a document, close others, restore a closed diff, and find another document by its path.
Examples: The most recently closed tab is selected again; two README tabs are distinguishable by folder; Chat precedes every pinned tab.
Counterexamples: Reopen stays disabled with no eligible history. Bulk-close preserves pins. Terminal retains Ctrl+Shift+T.
In scope: The desktop tab strip, tab actions and keyboard-accessible search for the current session.
Out of scope: STATED: #397 covers adjacent panes separately. OBSERVED: Existing persistence excludes workbench-lease Git tabs and session change diffs across application restarts.
Constraints: STATED: Default branch master per repository instructions. Local commit authorized. Reuse existing tab ownership, persistence, content loaders and Display masking.
Success signals: Independent focused tests prove restore order and scope, pin ordering and bulk-close behavior, and path search with mouse and keyboard. Shortcut behavior remains covered by the current Terminal contract.
Evidence: OBSERVED: Gitea #398 confirmed using tea. DocumentTabs and DocumentViewerProvider own this flow, with a format-1 local tab record for persistable targets.
Assumptions: INFERRED: Pin state follows the existing open-tab persistence rules; closed history is temporary for the application run.
Unknowns: None relevant to the requested behavior.
Decision-blocking questions: None.
Proposed behaviors: None outside scope.

## Requirement coverage

| Behavior | Requirement | Design | Proof |
| --- | --- | --- | --- |
| Restore the latest closed tab in the current session | REQ-UX-de16f7fe | Per-session closed descriptors | Renderer integration |
| Keep pinned tabs first in the document strip | REQ-UX-b51d6193 | Pinned prefix and format-1 flag | Renderer integration |
| Preserve pinned tabs during bulk closure | REQ-UX-83da20cf | Filter target set by pin | Renderer integration |
| Find and select open tabs in the current session | REQ-UX-ba7db808 | Localized search dialog | Renderer integration |
| Persist the pin with the open tab | REQ-DATA-3b6664f9 | Optional pinned flag and folder-scoped record | Storage and renderer restore |
| Remove only the owning folder record | REQ-FUNC-d9d16533 | Share the physical owner in read, save and deletion | Storage deletion and copied folder test |
| Keep the pin group under drag and keyboard movement | REQ-UX-e0410483, REQ-UX-6ecb6c83, REQ-UX-67abf562 | Movements apply within the same group | Renderer drag, keyboard and menu tests |

## Design

**Approach.** Keep ownership in DocumentViewerProvider. Add compact Reopen and Search controls next to the tab strip, and a Pin/Unpin action to the existing document-tab menu. Keep the existing Terminal binding.

**Interfaces and data.** Each session tab set holds a bounded, current-run list of closed tab descriptors. Closing a tab drops its loaded data and opener. Reopening uses the normal loader in a fresh attempt; invalidated Git lease targets are discarded. A manually reopened tab is removed from closed history. A bulk close records its closures in strip order. Open tabs have a pinned prefix followed by the unpinned suffix. Pin or unpin moves the tab to the boundary without changing its selection. Moving operates within each group. Where a tab already persists, save its optional true pin in format 1. Exact opened folder scopes both saved and deleted records, so copied workbenches with matching IDs cannot see or modify each other's tabs. At the record cap, retain pins before unpinned entries. Preserve chronological and authority boundaries already enforced by the provider.

**Files and test seams.** Change viewer-context.tsx for actions and state, document-tabs.tsx for integration and menu, document-tabs-store.ts for pin persistence. Add TabSearch for dialog interaction and use the existing masked labels and titles. Renderer integration covers session isolation, three target classes, visibility, action state, keyboard and click. Existing tab and Terminal test suites cover the preserved actions.

**Risks and open decisions.** The search displays visible titles and paths, with no secondary access to target or content. Restore cached sources through existing permission and Display-sensitive loading; recent closures retain descriptors only. Live Git and recorded edits retain the existing restart policy. Pinned membership survives reopening within the run. No new OS shortcut or IPC.

**Requirement map.** REQ-UX-de16f7fe owns restoration, REQ-UX-b51d6193 owns pin grouping, REQ-UX-83da20cf owns bulk close, and REQ-UX-ba7db808 owns search. The existing persistence, move and menu contracts add pinned state and pin group boundaries.

Diagrams: [diagram_TASK-ec507a39.md](diagram_TASK-ec507a39.md)

## Log

- 2026-11-24 frame: journal opened
- 2026-11-24 frame: completed; next specify
- 2026-11-24 specify: completed; next design
- 2026-11-24 design: completed; next build
- 2026-11-24 build: red: focused document-tabs.test.ts selectors exit 1 with three expected failures for absent reopen, pin and search actions; the pin test also specifies bulk close
- 2026-11-24 build: green: focused npmw.py run test selectors for document-tabs, document-tabs-store, shell and keyboard-shortcuts passed 58 tests. After the folder-scoped integration and drag boundary assertion, document-tabs, workbench-activity and plan-tab passed 59 tests. Total 72 distinct focused cases. Verified reopen and expiry, pin persistence and bulk protection, search title/path/keyboard/mouse, current Display policy and Terminal keyboard shortcut.
- 2026-11-24 build: Advisory check has zero errors. Remaining warnings cover existing historical metadata, context sizes, locale and test path coverage and excluded pre-existing bundled plugin artifacts.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Browser smoke: VERA_TEST=1 npmw.py exec -- playwright test tests/e2e/documents.spec.ts --grep en,light --workers=1 exit 0 (1 English light case; viewer fits every supported text scale). Used the test renderer on an isolated loopback port alongside the running development app.
- 2026-11-24 validate: Round 1: quality found persisted tabs and deletion cross copied workbench folders with the same stored IDs. Scope the tab record and deletion to the exact folder. Keep pins within the existing record cap.
- 2026-11-24 validate: returned to build - Scope persisted pin and tab state to the physical workbench folder and protect pin retention within the existing cap.
- 2026-11-24 build: red (round 1 fix): focused copied-workbench regression fails at restoring a saved pin under the proposed folder-scoped record key; the old key has no physical owner.
- 2026-11-24 build: green (round 1 fix): focused document-tabs, document-tabs-store, workbench-activity and plan-tab Vitest passed 66 tests; copied folders independently restore and save pins, deletion leaves another folder untouched, and the existing cap prioritizes pins. Including unchanged Shell and shortcut checks gives 74 distinct focused tests.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: Strict round 2 exit 1: i18n found nonexistent settings.cancel used in TabSearch. Lint, TypeScript and Help passed. Native delegation restore passed; native Display stopped before tab assertions because the isolated build was one directory shallower than the unpackaged embedding asset lookup. Retest with an isolated out/main at the expected depth.
- 2026-11-24 validate: returned to build - Use the existing localized Cancel label in tab search and rerun affected validation.
- 2026-11-24 build: green (round 2 fix): existing workbench.cancel translation is present in four catalogs; check:i18n exit 0. Focused duplicate-filename search test exit 0 and also proves Cancel restores focus. The two embedding model caches verified offline; Display native retest is running on an isolated output at correct depth.
- 2026-11-24 build: completed; next validate
- 2026-11-24 validate: final: python .agentic/aegis.py check --task TASK-ec507a39 --strict --run exit 0: lint, TypeScript, i18n and help passed; release notes audit exit 0. 56 advisory warnings concern historical metadata, size/layout heuristics and excluded untracked bundled plugin files. Windows native session-delegation restore and Display persisted tab recheck passed individually, after correcting the isolated test output depth. Earlier Chromium layout smoke and 74 focused Vitest tests passed. Local tab records from earlier pre-release builds use the retired key and are not read.
- 2026-11-24 validate: completed; next done

## Rulings

- RULING-001 | date=2026-11-24 | decision=Implement and validate one local commit on master | reason=User requested #398 implementation and AGENTS.md authorizes the local commit | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-ec507a39.md
changed: Implemented session tab reopening, pinning, bulk-close protection and keyboard-accessible title/path search
evidence: Strict AEGIS exit 0. 74 focused Vitest, 1 Chromium and 2 Windows Electron tests passed. Both reviews approved.
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-24)

- stage: validate; type: feature; branch: master
- requirements:
  - REQ-UX-de16f7fe - Restore the latest closed tab in the current session
  - REQ-UX-b51d6193 - Keep pinned tabs first in the document strip
  - REQ-UX-83da20cf - Preserve pinned tabs during bulk closure
  - REQ-UX-ba7db808 - Find and select open tabs in the current session
  - REQ-DATA-3b6664f9 - Save a session's document tabs in localStorage
  - REQ-UX-e0410483 - Reorder document tabs by dragging
  - REQ-UX-6ecb6c83 - Move the selected document tab from the keyboard
  - REQ-UX-67abf562 - Close and move tabs from their context menu
  - REQ-FUNC-d9d16533 - Remove stored tabs with their session
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base b8f1038: 43 file(s) changed, 1234 line(s) added; 9 file(s) not content-scanned
- checks: errors=0 warnings=56 notes=44
- checklist: 8/9 done; open: `report` appended
