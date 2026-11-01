# TASK-0b2df7fa - Document tabs in the chat area

stage: done
type: feature
path: full
interaction: autopilot
requirements:
parent:
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

Problem: A workbench shows one document at a time. Opening a file, citation, download or artifact replaces the single source in the right panel's Source tab, which keeps only an in-memory list of the ten most recent sources and clears it when the session, workbench or settings view changes (OBSERVED: renderer/components/documents/viewer-context.tsx DocumentViewerProvider, single `target`, `recent` capped at 10, scope `${benchId}/${activeSession}/${settings}` in App.tsx; REQ-UX-712804c9, REQ-UX-aa068a49). Nothing is restored after a restart (OBSERVED: no persistence in viewer-context.tsx). An embedded engineer works with several files at once: logs, datasheets and others (STATED: "in embedded un user ar lucra cu divese fisiere deschise in acelasi timp: log-uri, datasheet-uri, etc.").
Desired outcome: The chat area becomes a tabbed area: a Chat tab and one tab per open document (STATED: "s-ar putea ca zona chat-ului sa fie cu tab-uri - sa avem tab-ul de chat si tab-uri pentru documente?"). Tabs can be reordered and closed, and their positions are saved when the session closes; reopening the session reopens them, except the ones whose files no longer exist (STATED: "mutat (schimbat ordinea), inchidere, salvare pozitii la inchidere sesiune (la repornire sesiune se redeschid si tab-urile, daca fisierele nu mai exista, nu se mai deschid acelea)"). Documents open only as tabs in the chat area; the right panel no longer shows them (STATED: answer "1 - a" to "Doar tab-uri in centru ... comuti intre chat si document"). The saved state lives in the renderer's localStorage (STATED: "2 - localStorage") and covers both the tab order and the position inside each document (STATED: "3 - ambele").
Actors: the embedded engineer reading datasheets, logs and notes while working with the agent in a session.
Primary scenario: In a session the engineer opens `datasheets/stm32g474.pdf` from the Files tree, then `logs/uart.log`, then clicks a citation to page 47 of the same datasheet. The chat area shows tabs Chat | stm32g474.pdf | uart.log; the citation activates the datasheet tab at page 47 instead of adding a tab. The engineer drags uart.log before the datasheet, closes neither, and restarts VERA. The session opens with Chat | uart.log | stm32g474.pdf, the datasheet at page 47 and the log at the line where it was left.
Examples: `logs/uart.log` is deleted before the restart: the session reopens with Chat | stm32g474.pdf only (STATED behaviour, example built from the user's scenario). Two sessions of the same workbench keep separate tab sets.
Counterexamples: The Chat tab is not closable and is not a document (INFERRED from "tab-ul de chat si tab-uri pentru documente"). A document is not shown beside the conversation at the same time (STATED: decision 1-a; split view and peek were offered and not chosen).
In scope: child tasks, run sequentially in this checkout:
  1. Open documents as tabs in the chat area: tab model replacing the single source, tab strip with the Chat tab first, open/activate/close, one tab per document with a citation jumping inside an open tab, inactive tabs unmounted while keeping their position, removal of the right panel Source tab, Recent sources and the Source width, and the existing tests that assert them moved to the tabs.
  2. Reorder and navigate document tabs: drag and drop, keyboard moves, a tab context menu (close, close others, close to the right, move), and shortcuts to switch and close tabs.
  3. Restore document tabs per session: save order, active tab and per-document position in localStorage per workbench and session; restore them when the session opens again, including after an application restart, skipping documents whose files no longer exist.
  4. Scroll documents continuously (added 2026-11-01, RULING-004/005): text and logs scroll over the whole file with only visible lines rendered, Ctrl+G go to line and Ctrl+F find; PDFs scroll through pages with a page indicator, zoom and Ctrl+F find; the path line and buttons leave the document panel (their actions join child 2's tab menu).
  Order: 1, 2, 4, 3 (restore stores the place format of the final viewers).
Out of scope: showing a document beside the conversation (split view or peek in the right panel) (STATED: decision 1-a); persisting tabs in the workbench database (STATED: decision 2, localStorage); live reload or tail of growing logs (offered in the analysis as later work, not requested); editing documents (OBSERVED: all viewers are read-only).
Constraints: implementation on master in the shared checkout, one implementation chat at a time (STATED: AGENTS.md). Renderer uses shared IPC; viewers and their IPC channels (docs.open, docs.read, downloads.open, docs.stat) stay as they are (OBSERVED: viewer-context.tsx, ipc.ts). en/ro/de catalogs stay in parity (OBSERVED: scripts/check-i18n.mjs). No migrations or compatibility code during development: stored formats change in place at version 1 (STATED: AGENTS.md development compatibility policy). Focused tests per ticket (STATED: 02_Tools/verification-policy.md). The current branch is the default branch master; AGENTS.md directs implementation there.
Success signals: opening a second document adds a tab and keeps the first; a citation to an open document activates its tab at the cited location; tabs can be closed and reordered with mouse and keyboard; after a restart the session shows the same tabs in the same order with the active tab and positions restored; a deleted file's tab is not restored; the right panel has no Source tab.
Evidence: code read 2026-11-01: viewer-context.tsx (DocumentViewerProvider, SourcePanel, DocumentBody), shell.tsx (Source tab reveal/return logic, layout.source width), App.tsx (center area, session remembered in localStorage `vera.session.<benchId>`), pdf-viewer.tsx (page state); knowledge document-viewer.md and desktop-shell.md; requirements REQ-UX-712804c9, REQ-UX-775eb693, REQ-UX-aa068a49, REQ-UX-b3231a55.
Assumptions: none beyond the labelled claims.
Unknowns: where a document opens when no session is active (the chat area shows the workbench page then; OBSERVED: App.tsx `chat` state); the exact keyboard shortcuts and whether they are user-configurable like the existing ones; what "position" means for non-paginated documents (scroll offset, line or heading); whether restoring announces skipped tabs.
Decision-blocking questions: none; the three design decisions were answered (RULING-001..003).
Proposed behaviors: (not accepted) opening a document while no session is active shows the chat area like Attach as context does (STATED precedent: "No chat open: Attach opens the chat and adds the chip"); position is the PDF page, the first shown text line, the presentation slide and the scroll offset for other kinds; Ctrl+Tab/Ctrl+Shift+Tab switch tabs, Ctrl+W closes the active document tab, Ctrl+Shift+PageUp/PageDown move it, all registered as configurable shortcuts; skipped tabs are dropped silently.
Path and reason: full.

  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | tabbed chat area, reorder, restore |
  | no new interface or data format | no | localStorage tab record per session |
  | no new dependency | yes | HTML5 drag and drop, existing viewers |
  | an existing requirement already covers the behavior | no | REQ-UX-712804c9 opens one source in the right panel |
  | no security or data-handling change | unknown | restored paths go through the existing guarded IPC |

  The parent is coordination only; each child runs its own frame -> validate. The parent validates the integrated result. REQ-UX-712804c9, REQ-UX-775eb693, REQ-UX-aa068a49 and REQ-UX-b3231a55 describe the right panel Source tab and are superseded or retired by the children.

## Requirement coverage


## Design


## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: implementation on master in the shared checkout per AGENTS.md; three child tasks run sequentially; the user said 'porneste implementarea'
- 2026-11-01 frame: completed; next specify - scope recorded (autopilot); decisions in RULING-001..003 (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: scope grew with RULING-004 (tab menu file actions, bare document panel) and RULING-005 (continuous scrolling viewers): child 2 takes the file actions, a new child 4 the viewers; order 1, 2, 4, 3
- 2026-11-01 specify: skipped; next design - the work is specified, designed and built in its children TASK-79f6ffd3, TASK-6c4aeed8, TASK-4c04273a and TASK-061fe00e, all done
- 2026-11-01 design: skipped; next build - the work is specified, designed and built in its children TASK-79f6ffd3, TASK-6c4aeed8, TASK-4c04273a and TASK-061fe00e, all done
- 2026-11-01 build: skipped; next validate - the work is specified, designed and built in its children TASK-79f6ffd3, TASK-6c4aeed8, TASK-4c04273a and TASK-061fe00e, all done
- 2026-11-01 validate: Integrated validation: all four children together on master working tree - full unit suite 177 files / 1160 tests passed; e2e citations, pdf-download, documents, docs-tree, mock, office-documents, shell, compact-shell 15/15 passed (Chat and document tabs, reorder and menus, continuous viewers, restore after native restart, session delete cleanup)
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked; review verdicts not both approved)
- 2026-11-01 done: DEVIATION validate: no parent-level review verdicts - every child was reviewed by both reviewers and approved; the parent adds no code of its own

## Rulings

- RULING-001 | date=2026-11-01 | decision=Documents open only as tabs in the chat area (Chat tab plus one tab per document); the right panel no longer shows documents and no split view or peek is built | reason=User chose option 1-a: Doar tab-uri in centru | source=user | supersedes=none
- RULING-002 | date=2026-11-01 | decision=Open document tabs are saved in the renderer's localStorage per workbench and session, not in the workbench database | reason=User chose 2 - localStorage | source=user | supersedes=none
- RULING-003 | date=2026-11-01 | decision=The saved state covers the tab order, the active tab and the position inside each document | reason=User chose 3 - ambele | source=user | supersedes=none
- RULING-004 | date=2026-11-01 | decision=A document tab shows only the document: no path line or buttons in the panel; Open in default app, Show in Explorer, Copy path and Properties move to the document tab's right-click menu | reason=User: Putem scoate informatiile de path si butoanele open in default app ... sa avem un context right click pe tab unde sa avem open in default app, properties, etc. | source=user | supersedes=none
- RULING-005 | date=2026-11-01 | decision=Text and logs scroll continuously over the whole file (only visible lines rendered) with Ctrl+G go to line and Ctrl+F find on demand; PDFs scroll continuously through pages with a small page indicator, Ctrl+wheel and Ctrl+=/- zoom and Ctrl+F find on demand; the Previous/Next toolbars go | reason=User chose 'Scroll continuu + Ctrl+G' and 'Scroll continuu prin pagini' | source=user | supersedes=none
- RULING-006 | date=2026-11-01 | decision=Children 4 and 3 are implemented first and tested once at the end (typecheck, lint, unit, e2e, reviews) instead of test-first per requirement | reason=User: Poti sa faci toata implementarea si doar la sfarsit sa rulezi testele? | source=user | supersedes=none


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-0b2df7fa.md
changed: chat area with Chat and document tabs: open, close, reorder, context menu actions, continuous text/PDF viewers, per-session tabs restored after restart
evidence: unit 1160 passed; e2e 15/15; each child reviewed and approved
issues: accepted low notes in children; changes-tab.test.ts timing flake seen once under load (untouched file)
spec_compliance:
implementation_quality:
review_round:
