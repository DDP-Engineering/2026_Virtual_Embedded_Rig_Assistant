# TASK-0ec8c0d0 - Document context menu

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-c514899c, REQ-FUNC-6d1fb02f, REQ-UX-160f9f68
parent:
branch: master
base: 1653c6fb920f5eaca37212da359ee1533cae71b5
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

Problem: The commands for a shown document (find, go to line, zoom) exist only as keyboard shortcuts, and right-clicking a document does nothing (OBSERVED: no contextmenu handler on the document panel; Electron shows no native menu). Copying selected text has only Ctrl+C.
Desired outcome: Right-clicking a document opens a menu with Copy and that document's view commands, each showing its shortcut (STATED: "comenzile pentru find, goto, zoom - pot fi puse pe click dreapta pe docu?", "include si copy cum recomanzi - implementeaza").
Actors: the engineer reading a document in a tab.
Primary scenario: The engineer selects a line in a log, right-clicks it and chooses Copy; in a PDF they right-click and choose Zoom in.
Examples: text document -> Copy, Find (Ctrl+F), Go to line (Ctrl+G); PDF -> Copy, Find (Ctrl+F), Zoom in (Ctrl+=), Zoom out (Ctrl+-), Reset zoom (Ctrl+0); Markdown, HTML or Office -> Copy (STATED via the accepted table in the proposal).
Counterexamples: right-click on a document tab keeps the tab menu (TASK-6c4aeed8); right-click inside the find or line field is not the document menu.
In scope: the document context menu, opened by right-click, Shift+F10 or the menu key in the document panel; Copy of the selection; the view commands; shortcut hints on menu items.
Out of scope: new view commands (none requested); the tab context menu's content (unchanged).
Constraints: renderer only; reuse TreeMenu (INFERRED from the tab and Files menus); all web permissions are denied (OBSERVED: main/security.ts), so Copy uses the editing copy command on the selection like Ctrl+C. Work is on master (developer's choice).
Success signals: each menu command does what its shortcut does; Copy puts the selected text on the clipboard and is disabled without a selection.
Evidence: document-tabs.tsx DocumentPanel handles Ctrl+F/Ctrl+G by request counters; pdf-viewer.tsx zooms from the panel's keys; tree-menu.tsx has no shortcut slot.
Assumptions: shortcut hints read "Ctrl" on every platform, as the shortcuts also accept Cmd (INFERRED; the app shows Ctrl elsewhere).
Unknowns: none blocking.
Decision-blocking questions: none (scope and Copy accepted by the user).
Proposed behaviors: none beyond the accepted list.
Path and reason: full - new externally observable behavior with no requirement covering it.

   | Criterion | Holds? | Evidence |
   |---|---|---|
   | no new externally observable behavior | no | a new context menu |
   | no new interface or data format | yes | renderer only |
   | no new dependency | yes | TreeMenu reused |
   | an existing requirement already covers the behavior | no | none mentions a document menu |
   | no security or data-handling change | yes | clipboard written only by the engineer's command |

## Requirement coverage

| Behavior | Requirement |
|---|---|
| The document menu opens by right-click, Shift+F10 or the menu key, lists the document's commands with shortcuts | REQ-UX-c514899c |
| Copy copies the selection, disabled without one | REQ-FUNC-6d1fb02f |
| Find, Go to line and zoom from the menu act like their shortcuts | REQ-UX-160f9f68 |

## Design


## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: completed; next specify - scope accepted by the user: include Copy as recommended, implement (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: skipped; next build - small renderer change reusing TreeMenu and the existing find/goto/zoom paths; no new structure, sequence or state to design
- 2026-11-01 build: build red: document-menu.test.ts 3/3 fail before the menu exists (REQ-UX-c514899c, REQ-FUNC-6d1fb02f, REQ-UX-160f9f68)
- 2026-11-01 build: build green: document-menu.test.ts 3/3; documents tests 61/61; lint, typecheck, i18n clean
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: Review round 1 notes accepted: hints read Ctrl on every platform (the app shows Ctrl elsewhere; Cmd works too); Markdown/Office menus hold only Copy, disabled without a selection (the accepted table); a refused copy command is silent like Ctrl+C. REQ-UX-160f9f68 verification wording aligned with the e2e (125% to 150%).
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)
- 2026-11-01 done: validate: the first strict check found the three new requirement files invalid (template remnants after the requirement line); repaired, strict check rerun: errors=0, exit 0. The task had advanced to done before this rerun.
- 2026-11-01 done: User tested the document menu in the running app and asked to close and commit

## Rulings

- RULING-001 | date=2026-11-01 | decision=The document menu includes Copy of the selected text next to Find, Go to line and the zoom commands | reason=User: include si copy cum recomanzi - implementeaza | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-0ec8c0d0.md
changed: document context menu with Copy, Find, Go to line and PDF zoom, shortcut hints
evidence: document-menu.test 3/3 (red before, green after); unit 1162 passed; e2e 5/5 incl. native clipboard Copy and menu zoom; strict check exit 0; spec and quality approved round 1
issues: accepted low notes logged
spec_compliance: approved
implementation_quality: approved
review_round: 1

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-c514899c - (unknown requirement)
  - REQ-FUNC-6d1fb02f - (unknown requirement)
  - REQ-UX-160f9f68 - (unknown requirement)
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 1653c6f: 16 file(s) changed, 645 line(s) added
- checks: errors=6 warnings=56 notes=4
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended

## Delivery report (2026-11-01)

- stage: done; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-c514899c - Open a document's context menu
  - REQ-FUNC-6d1fb02f - Copy the selected document text from the menu
  - REQ-UX-160f9f68 - Run view commands from the document menu
- deviations: none recorded
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=1
- diff vs task base 1653c6f: 16 file(s) changed, 654 line(s) added
- checks: errors=0 warnings=47 notes=4
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
