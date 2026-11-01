# TASK-6c4aeed8 - Reorder and navigate document tabs

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-e0410483, REQ-UX-6ecb6c83, REQ-UX-67abf562, REQ-UX-fd131983, REQ-UX-a45c4384, REQ-UX-968b89b0, REQ-UX-f261c988, REQ-UX-f5d6e9e4
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

Problem: Document tabs (TASK-79f6ffd3) open in the order they were opened and close one at a time from their own button; they cannot be moved and there is no keyboard way to switch or close them from the document (OBSERVED: document-tabs.tsx supports select, close button, middle click and tablist arrows only). The user asked to move tabs and close them (STATED in parent TASK-0b2df7fa: "mutat (schimbat ordinea), inchidere").
Desired outcome: Document tabs can be reordered by dragging and from the keyboard, a tab's context menu offers Close, Close others, Close to the right, Move left and Move right, and the keyboard switches and closes tabs: Ctrl+Tab / Ctrl+Shift+Tab and Ctrl+PageDown / Ctrl+PageUp select the next / previous tab, Ctrl+Shift+PageDown / Ctrl+Shift+PageUp move the selected document tab, Ctrl+W closes the selected document tab (STATED: the analysis accepted with "porneste implementarea" listed drag and drop, Ctrl+Shift+PgUp/PgDn, the context menu, Ctrl+Tab and Ctrl+W).
Desired outcome (added 2026-11-01, parent RULING-004): the document tab's panel shows only the document; its path stays in the tab's tooltip, and the tab's context menu also offers the Files tree's file actions for the file (Attach as context, Open in with Default app, Show in Explorer, Copy, Properties), Show in Explorer for a download (see the DEVIATION in the Log about Open in default app) (STATED: "Putem scoate informatiile de path si butoanele open in default app ... sa avem un context right click pe tab unde sa avem open in default app, properties, etc.").
Actors: the embedded engineer with several documents open in a session.
Primary scenario: tabs Chat | a.pdf | uart.log | notes.md; dragging notes.md before a.pdf gives Chat | notes.md | a.pdf | uart.log; Ctrl+Shift+PageDown on notes.md gives Chat | a.pdf | notes.md | uart.log; right click on a.pdf -> Close others leaves Chat | a.pdf; Ctrl+Tab from Chat selects a.pdf; Ctrl+W closes it and selects Chat.
Examples: Close to the right on the first document tab closes every document after it; Move left is disabled on the first document tab and Move right on the last.
Counterexamples: the Chat tab cannot be dragged, moved or closed and nothing can be dropped before it (INFERRED from the parent's "tab-ul de chat" first and never closed); Ctrl+W with Chat selected does nothing.
In scope: drag and drop between document tabs, keyboard move, the document tab context menu with the tab and file actions, removal of the path line and Open in default app button from the document panel, Ctrl+Tab family and Ctrl+PageUp/PageDown selection, Ctrl+Shift+PageUp/PageDown move, Ctrl+W close, en/ro/de strings.
Out of scope: persistence of the order across restarts (child 3); making these keys configurable in Keyboard shortcuts (OBSERVED: shared/keyboard-shortcuts.ts accepts only Mod+[Alt+][Shift+] letter/digit/,/ bindings and reserves Mod+W, so Tab and PageUp/PageDown cannot be expressed there); split view (parent RULING-001).
Constraints: as the parent; the keys are fixed handlers active while the chat area is shown and no dialog is open, and leave the keyboard shortcuts registry unchanged.
Success signals: a drag reorders tabs; keyboard moves reorder tabs; the context menu closes and moves tabs; Ctrl+Tab and Ctrl+PageUp/PageDown switch tabs with wrap; Ctrl+W closes the selected document tab.
Evidence: document-tabs.tsx, viewer-context.tsx (tab set), tree-menu.tsx (menu with submenus and disabled items, reusable), shared/ordering.ts and keyboard-shortcuts.ts read 2026-11-01.
Assumptions: none beyond the labelled claims.
Unknowns: none blocking.
Decision-blocking questions: none.
Proposed behaviors: (accepted in specify under autopilot) a drop places the dragged tab before the tab it is dropped on, or after the last tab when dropped on the empty strip; moving and closing keep the selection on the moved or surviving selected tab; Ctrl+W, Ctrl+Tab and Ctrl+PageUp/PageDown are ignored while a dialog is open or an IME composition is active; the context menu opens with Shift+F10 or the context menu key on a focused tab too.
Path and reason: full.

  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | drag, menu, keys |
  | no new interface or data format | yes | tab set gains move/closeMany only |
  | no new dependency | yes | HTML5 drag and drop, existing menu |
  | an existing requirement already covers the behavior | no | none covers reordering |
  | no security or data-handling change | yes | renderer only |

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Reorder | drag and drop between document tabs | REQ-UX-e0410483 | renderer tests | see Requirement map |
| Reorder | Ctrl+Shift+PageUp/PageDown moves the selected tab | REQ-UX-6ecb6c83 | renderer tests | see Requirement map |
| Close and move | context menu: Close, Close others, Close to the right, Move left/right | REQ-UX-67abf562 | renderer tests | see Requirement map |
| Keyboard | Ctrl+Tab, Ctrl+PageUp/PageDown select tabs with wrap | REQ-UX-fd131983 | renderer tests | see Requirement map |
| Keyboard | Ctrl+W closes the selected document tab | REQ-UX-a45c4384 | renderer tests | see Requirement map |
| Bare panel | only the document; path in the tooltip | REQ-UX-968b89b0 | renderer tests | see Requirement map |
| File actions | Files tree actions in the tab menu | REQ-UX-f261c988 | renderer tests | see Requirement map |
| File actions | Open in default app moves from the panel to the tab menu | REQ-UX-f5d6e9e4 | renderer tests | see Requirement map |

## Design

**Approach.** The tab set of `DocumentViewerProvider` gains `move(key, before)` (a document key or
the end) and `closeMany(keys, keep)`; a move keeps `active`, and when Close others or Close to the
right closes the selected tab, the tab whose menu was used (`keep`) is selected. `DocumentTabs` adds: HTML5 drag and drop on document tabs only (Chat is not
draggable and refuses drops; a drop on a tab moves the dragged tab before it, a drop on the strip's
free end moves it last) (REQ-UX-e0410483); the existing `TreeMenu` as the document tab context menu,
opened at the pointer or, for Shift+F10 and the menu key, at the tab's bottom-left (REQ-UX-67abf562);
one window keydown listener while the chat area is shown for Ctrl+Tab / Ctrl+Shift+Tab /
Ctrl+PageDown / Ctrl+PageUp (select with wrap, REQ-UX-fd131983), Ctrl+Shift+PageDown / PageUp (move,
REQ-UX-6ecb6c83) and Ctrl+W (close the selected document tab, REQ-UX-a45c4384). Rejected: adding
these keys to the configurable registry, whose grammar cannot express Tab or PageUp and reserves Mod+W.

**File actions (parent RULING-004).** The Files tree's `menuItems` logic (docs-tree.tsx: Attach, Open
in with editors and system apps, Show in Explorer/Finder/folder, Copy submenu, Properties) is
extracted into the shared hook `useFileActions(workbenchId, menuFor)` used by the tree row menu and
by a workbench file tab (its entry comes from the tab's `file:` key and target); Properties opens the
existing `TreeProperties` with the docs.list record. A download tab offers Show in Explorer through
downloads.reveal; an artifact tab offers the tab actions only (REQ-UX-f261c988, REQ-UX-f5d6e9e4).
The panel header (path line, OpenExternally) is removed (REQ-UX-968b89b0); an action's error or
notice shows in a row between the tab strip and the panels, also with Chat selected, and clears
when another tab is selected.

**Interfaces and data.** `move(key: string, before: string | null)`, `closeMany(keys: string[], keep: string)` on
`useDocumentTabs()`. The listener ignores events while a `dialog[open]` or a `[data-tree-menu]` is open or an IME
composition is active, and calls `preventDefault` only for handled keys. Drag data type
`application/x-vera-tab` carries the tab key within the same window.

**Files and test seams.** viewer-context.tsx (move, closeMany), document-tabs.tsx (drag, menu, keys),
styles.css (drop indicator), locales en/ro/de (menu labels). Tests extend document-tabs.test.ts.

**Risks and open decisions.** Keys are fixed, not configurable (Frame Out of scope). Ctrl+W is
handled by the renderer only while a document tab is selected; VERA has no application menu, so no
native Ctrl+W action is shadowed (OBSERVED: compact-shell.spec expects `Menu.getApplicationMenu()` null).

**Requirement map.** REQ-UX-e0410483 drag/drop and `move`; REQ-UX-6ecb6c83 keyboard `move`;
REQ-UX-67abf562 TreeMenu with `closeMany`/`move`; REQ-UX-fd131983 and REQ-UX-a45c4384 window listener;
REQ-UX-968b89b0 panel without header; REQ-UX-f261c988 and REQ-UX-f5d6e9e4 shared file menu items.

Diagrams: [diagram_TASK-6c4aeed8.md](diagram_TASK-6c4aeed8.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: implementation on master in the shared checkout per AGENTS.md; starts after TASK-79f6ffd3 closes (same files)
- 2026-11-01 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: scope extended by parent RULING-004 - tab menu takes the Files tree file actions, the document panel loses its path line and Open in default app button (REQ-UX-968b89b0, REQ-UX-f261c988 created; REQ-UX-f5d6e9e4 revised)
- 2026-11-01 design: completed; next build - TASK-79f6ffd3 closed; design accepted (autopilot) (6 Done checklist item(s) left unticked)
- 2026-11-01 build: red: npmw npx vitest run renderer documents/document-tabs.test.ts exit 1 - 6 failing: no drag, keyboard move, tab menu, Ctrl+Tab/PageUp/PageDown, Ctrl+W, bare panel or tab file actions (REQ-UX-e0410483 REQ-UX-6ecb6c83 REQ-UX-67abf562 REQ-UX-fd131983 REQ-UX-a45c4384 REQ-UX-968b89b0 REQ-UX-f261c988 REQ-UX-f5d6e9e4)
- 2026-11-01 build: green: npmw npx vitest run renderer (27 files, 185 tests) exit 0 incl. document-tabs.test 15 pass; typecheck/lint 0 errors; check:i18n ok; VERA_TEST=1 e2e citations (real drag), documents, office-documents, docs-tree, pdf-download, artifacts, mock, keyboard-shortcuts 10 passed (REQ-UX-e0410483 REQ-UX-6ecb6c83 REQ-UX-67abf562 REQ-UX-fd131983 REQ-UX-a45c4384 REQ-UX-968b89b0 REQ-UX-f261c988 REQ-UX-f5d6e9e4)
- 2026-11-01 build: REQ-UX-f261c988 corrected to the code - a managed download is under .vera/, which the default-app allowlist excludes, so its tab offers Show in Explorer only (no Open in default app); file actions moved into the shared useFileActions hook used by the Files tree and the tab menu; OpenExternally removed (canOpenExternally kept)
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 1: quality - tab keys act while a context menu is open and a stale menu state can reappear; action errors/notices are shared across tabs, never cleared and invisible with Chat selected; focus drops after a menu move or close. spec - the download tab lost Open in default app without a recorded DEVIATION and the Design text drifted (neighbour rule after closeMany, docs.stat entry, fileMenuItems); action messages land in the selected panel only; untested: Attach from the tab menu, the context menu key, no buttons outside the document
- 2026-11-01 validate: returned to build - review round 1 findings
- 2026-11-01 build: DEVIATION build: a managed download's tab offers Show in Explorer but not Open in default app (RULING-004 named it) - downloads live under .vera/, which the default-app allowlist (canOpenExternally, PathGuard) keeps out, and no download-specific open IPC exists; cost: the user opens a downloaded PDF externally through Show in Explorer; a downloads.openExternal channel is possible later work
- 2026-11-01 build: round 1 fixes green - tab keys idle while a menu is open, a menu whose tab closed goes away, action messages in a [data-tab-notices] row (visible with Chat) cleared on tab change, focus kept on a moved or surviving tab, Frame/Design text aligned, DEVIATION for download Open in default app logged; tests added (menu blocks Ctrl+W, stale menu, message with Chat + clear, focus after menu move, context menu key, no buttons outside the body, Attach from the tab menu in attachments.test); renderer vitest 27 files 188 pass; typecheck/lint 0 errors; VERA_TEST=1 e2e 10 passed
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 2: spec approved; its two wording notes applied (Design closeMany signature and listener idle on menus; REQ-UX-f5d6e9e4 verification names the notice row), no code change
- 2026-11-01 validate: review round 2: spec approved; quality - the deferred focus restore after a tab menu breaks TreeMenu's contract (focus back before the item runs): Properties captures body as its origin and Attach may lose composer focus
- 2026-11-01 validate: returned to build - review round 2 quality finding
- 2026-11-01 build: round 2 fix green - TreeMenu close restores tab focus synchronously before the item runs; menu moves refocus after flushSync; tests: Properties close returns focus to the tab, Attach from the tab menu leaves the composer focused; renderer vitest 188 pass; typecheck/lint 0 errors; e2e citations, docs-tree, pdf-download, documents, keyboard-shortcuts pass
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: final: python .agentic/aegis.py check --task TASK-6c4aeed8 --strict --run exit 0 (run with the next child's two uncommitted work-in-progress files find-bar.tsx and text-viewer.tsx set aside, as they belong to TASK-4c04273a); lint, typecheck, i18n ok; renderer vitest 27 files 188 pass and VERA_TEST=1 e2e pass after the last code change; errors=0; remaining warnings are other tasks' records; limitation: Close on an unselected tab from its menu leaves focus on the page body (pointer-only path, reviewer note accepted)
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-6c4aeed8.md
changed: design written
evidence: check --strict --run exit 0; renderer 188 pass; e2e pass
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-e0410483 - Reorder document tabs by dragging
  - REQ-UX-6ecb6c83 - Move the selected document tab from the keyboard
  - REQ-UX-67abf562 - Close and move tabs from their context menu
  - REQ-UX-fd131983 - Switch tabs with Ctrl+Tab and Ctrl+PageUp or PageDown
  - REQ-UX-a45c4384 - Close the selected document tab with Ctrl+W
  - REQ-UX-968b89b0 - Show only the document in a document tab
  - REQ-UX-f261c988 - Offer file actions in a document tab's menu
  - REQ-UX-f5d6e9e4 - Offer Open in default app in document tab and Files menus
- deviations: 1 recorded
  - build: a managed download's tab offers Show in Explorer but not Open in default app (RULING-004 named it) - downloads live under .vera/, which the default-app allowlist (canOpenExternally, PathGuard) keeps out, and no download-specific open IPC exists; cost: the user opens a downloaded PDF externally through Show in Explorer; a downloads.openExternal channel is possible later work
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 9602160: 75 file(s) changed, 3843 line(s) added
- checks: errors=0 warnings=64 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
