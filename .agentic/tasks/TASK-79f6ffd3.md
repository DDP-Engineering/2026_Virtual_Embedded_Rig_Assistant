# TASK-79f6ffd3 - Open documents as tabs in the chat area

stage: done
type: feature
path: full
interaction: autopilot
requirements: REQ-UX-388cf31a, REQ-UX-712804c9, REQ-UX-775eb693, REQ-FUNC-89161a95, REQ-UX-37821e01, REQ-UX-89428322, REQ-UX-1f53a583, REQ-UX-5fc1d7d3, REQ-UX-be7140e4, REQ-UX-d64f086f, REQ-REL-6fc27952, REQ-UX-aa068a49, REQ-UX-b3231a55
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

Problem: One document at a time opens in the right panel's Source tab; opening another replaces it (OBSERVED: viewer-context.tsx DocumentViewerProvider keeps one `target`; shell.tsx reveals the Source tab). The parent TASK-0b2df7fa wants a tabbed chat area (STATED there; RULING-001 of the parent: documents open only as tabs in the chat area, no split view or peek).
Desired outcome: The chat area shows a tab strip: Chat first, then one tab per open document. Every way of opening a document (Files tree row or search hit, citation chip, download, artifact) opens or selects its document tab there. Switching tabs keeps each document's place and the conversation. The right panel has no Source tab, no Recent sources and no separate Source width.
Actors: the embedded engineer working in a session.
Primary scenario: Files tree -> `datasheets/stm32g474.pdf` opens a tab and selects it; Files tree -> `logs/uart.log` adds a second tab; a citation chip to `datasheets/stm32g474.pdf#p=47` selects the first tab at page 47; selecting Chat shows the conversation with its draft intact; selecting the log tab shows it at the lines it showed before; the log tab's close button removes it.
Examples: opening a document from the workbench page (chat area hidden) shows the chat area with the document tab selected. Session A's tabs are not shown in session B; going back to A shows them again (in memory; persistence is child 3).
Counterexamples: the Chat tab has no close button; a second citation to the same document never adds a second tab.
In scope: tab model and strip, open/select/close, one tab per document, document position kept while the tab is inactive, chat area shown when a document opens, per-session tab sets in memory, removal of the Source tab, Recent sources and layout.source, tests moved from the Source tab to the tabs, en/ro/de strings.
Out of scope: reordering, the tab context menu and keyboard shortcuts beyond tablist arrows and Delete on a focused tab (child 2, TASK-0b2df7fa); saving and restoring tabs across restarts (child 3); split view or peek (parent RULING-001).
Constraints: as the parent: master, shared checkout, renderer over existing IPC (docs.open, docs.read, downloads.open), viewers stay read-only, en/ro/de parity, no compatibility code (a stored layout with the removed `source` width is invalid and falls back to defaults; AGENTS.md).
Success signals: two documents open as two tabs; a citation selects the existing tab at the cited place; closing a tab selects a neighbour; the conversation draft survives switching; no Source tab in the right panel.
Evidence: viewer-context.tsx, shell.tsx, App.tsx, pdf-viewer.tsx, refs.ts (parseRef gives the document path of page, heading and line refs, and the artifact name) read 2026-11-01; knowledge document-viewer.md; REQ-UX-712804c9, REQ-UX-775eb693, REQ-UX-aa068a49, REQ-UX-b3231a55.
Assumptions: none beyond the labelled claims.
Unknowns: none blocking; the tab selected after a close and the Escape key in a document tab are settled in specify as proposed below.
Decision-blocking questions: none.
Proposed behaviors: (accepted in specify under autopilot) closing a tab selects the tab to its right, else to its left, else Chat; Escape in a document tab selects Chat and returns focus to the control that opened the document when it is still visible; a tab is labelled with the file name (artifact name for artifacts) and titled with the full path; inactive document tabs are unmounted and reopen at their kept position (PDF page, first shown text line, scroll offset for other kinds).
Path and reason: full.

  | Criterion | Holds? | Evidence |
  |---|---|---|
  | no new externally observable behavior | no | tab strip, Source tab removed |
  | no new interface or data format | no | layout record loses `source` |
  | no new dependency | yes | none needed |
  | an existing requirement already covers the behavior | no | REQ-UX-712804c9 describes the Source tab |
  | no security or data-handling change | yes | same guarded IPC and viewers |

## Requirement coverage

| Frame outcome | Atomic behavior | Requirement | Verification | Design decision or no impact |
|---|---|---|---|---|
| Tabbed chat area | Chat tab first, one tab per document, labels | REQ-UX-388cf31a | renderer tests; native e2e where named | see Requirement map |
| Tabbed chat area | opening a document without a tab adds and selects it | REQ-UX-712804c9 | renderer tests; native e2e where named | see Requirement map |
| Tabbed chat area | Files tree activation opens indexed or text tabs | REQ-UX-775eb693 | renderer tests; native e2e where named | see Requirement map |
| One tab per document | reopening selects the tab at the new place | REQ-FUNC-89161a95 | renderer tests; native e2e where named | see Requirement map |
| Chat area shown | opening from a hidden chat area shows it | REQ-UX-37821e01 | renderer tests; native e2e where named | see Requirement map |
| Close | close button or middle click; neighbour selected | REQ-UX-89428322 | renderer tests; native e2e where named | see Requirement map |
| Places kept | document place and chat draft survive switching | REQ-UX-1f53a583 | renderer tests; native e2e where named | see Requirement map |
| Per-session tabs | each session keeps its own tabs in memory | REQ-UX-5fc1d7d3 | renderer tests; native e2e where named | see Requirement map |
| Keyboard | arrow keys, Home and End over the tabs | REQ-UX-be7140e4 | renderer tests; native e2e where named | see Requirement map |
| Focus | focus into the document, Escape back to Chat, Ctrl+F in PDFs | REQ-UX-d64f086f | renderer tests; native e2e where named | see Requirement map |
| Failure | load error and Retry in one tab | REQ-REL-6fc27952 | renderer tests; native e2e where named | see Requirement map |
| Source tab removed | Recent sources replaced by tabs (retired) | REQ-UX-aa068a49 | renderer tests; native e2e where named | see Requirement map |
| Source tab removed | Source width removed (retired) | REQ-UX-b3231a55 | renderer tests; native e2e where named | see Requirement map |

## Design

**Approach.** `DocumentViewerProvider` keeps one tab set per session instead of one source: a
`Map<sessionKey, {tabs, active}>` where sessionKey is `<workbenchId>/<sessionId or "">` and
`active` is `"chat"` or a tab key (REQ-UX-5fc1d7d3). `open(target)` derives the document key
(`file:<path>` from `path`, `textPath` or the path of a parsed page/heading/line ref; `artifact:<name>`;
`download:<id>`; `ref:<raw>` when a ref does not parse), replaces the target of an existing tab and
reloads it at the new place, or appends a tab (REQ-FUNC-89161a95, REQ-UX-712804c9), selects it and
calls the `reveal` prop so App shows the chat area (REQ-UX-37821e01). A new `DocumentTabs({chat})`
renders the tablist (Chat first, without close; document tabs with a close button and middle-click
close, REQ-UX-388cf31a, REQ-UX-89428322; arrows/Home/End, REQ-UX-be7140e4) and the panels. The Chat
panel stays mounted while hidden, so the conversation keeps its draft and scroll; only the active
document panel is mounted and opens at the tab's kept place (REQ-UX-1f53a583). Rejected: keeping
every document mounted (one pdf.js document per tab) and one tab per citation (REQ-FUNC-89161a95).

**Interfaces and data.** Tab: `{key, target, label, title, content?, error?, attempt, place?}`;
content stays cached while the tab is open, so switching does not refetch. `place` is
`{page}` (PDF), `{line}` (first shown text line) or `{scroll}` (other kinds), reported by the
viewers through `onPlace` and given back on mount; a new open of the tab clears it, so the cited
place wins. Load: the same `docs.open` / `docs.read` / `downloads.open` calls and identity checks
as today; a failure stores `error` on that tab only, Retry bumps its attempt (REQ-REL-6fc27952).
`useDocumentTabs()` replaces `useDocumentSource()`; `useDocumentViewer()` (the open function used by
Files, search, downloads and citations) keeps its signature. Close selects the right neighbour, else
the left one, else Chat. Escape in a document panel selects Chat and focuses the opener when it is
connected and visible, else the Chat tab; Ctrl+F still focuses the PDF search (REQ-UX-d64f086f).
Labels: file name of the path (download: file name once loaded), artifact name; title: full path or ref.

**Files and test seams.** viewer-context.tsx (provider rewrite; DocumentBody, TextViewer and the
scroll body take `place`/`onPlace`; SourcePanel removed), new documents/document-tabs.tsx,
documents/pdf-viewer.tsx (`page`/`onPage`), App.tsx (sessionKey scope without settings, `reveal`,
center wraps SessionWorkspace in DocumentTabs), shell.tsx (Source tab, `source` prop, return/focus
effects and Source width removed), lib/layout.ts (`source` removed), styles.css, locales en/ro/de.
Tests: new documents/document-tabs.test.ts for the tab behaviours; documents.test.ts,
docs-tree.test.ts, workspace.test.ts and preferences.test.ts move from the Source tab; e2e citations,
documents, office-documents, docs-tree, pdf-download and artifacts select the document tab.

**Risks and open decisions.** Cached content of many large logs or PDFs stays in memory while
their tabs are open (bounded by what the user opens). A stored layout that still has `source` is
invalid and falls back to defaults once (AGENTS.md: no compatibility code). Escape no longer closes
a source; it returns to Chat (REQ-UX-d64f086f revised). Reorder, context menu and shortcuts belong
to child 2; persistence to child 3.

**Requirement map.** REQ-UX-388cf31a tablist with Chat first; REQ-UX-712804c9 append and select;
REQ-UX-775eb693 Files tree opens through `open` (no design impact beyond the tab); REQ-FUNC-89161a95
document key; REQ-UX-37821e01 `reveal`; REQ-UX-89428322 close and neighbour; REQ-UX-1f53a583 mounted
Chat and kept `place`; REQ-UX-5fc1d7d3 per-session map; REQ-UX-be7140e4 tablist keys; REQ-UX-d64f086f
focus and Escape; REQ-REL-6fc27952 per-tab error and Retry; REQ-UX-aa068a49 and REQ-UX-b3231a55
retired with the Source tab.

Diagrams: [diagram_TASK-79f6ffd3.md](diagram_TASK-79f6ffd3.md)

## Log

- 2026-11-01 frame: journal opened
- 2026-11-01 frame: implementation on master in the shared checkout per AGENTS.md; decisions inherited from parent TASK-0b2df7fa RULING-001..003
- 2026-11-01 frame: completed; next specify - scope recorded (autopilot) (7 Done checklist item(s) left unticked)
- 2026-11-01 specify: DEVIATION specify: REQ-UX-aa068a49 (Recent sources) and REQ-UX-b3231a55 (Source width) retired - the open document tabs replace the right panel Source tab per parent RULING-001
- 2026-11-01 specify: completed; next design (7 Done checklist item(s) left unticked)
- 2026-11-01 design: completed; next build (6 Done checklist item(s) left unticked)
- 2026-11-01 build: red: npmw npx vitest run renderer documents/document-tabs.test.ts exit 1 - 8 failing: no tab strip, no per-document tabs, close, places, per-session sets, keys, focus or per-tab errors (REQ-UX-388cf31a REQ-UX-712804c9 REQ-FUNC-89161a95 REQ-UX-37821e01 REQ-UX-89428322 REQ-UX-1f53a583 REQ-UX-5fc1d7d3 REQ-UX-be7140e4 REQ-UX-d64f086f REQ-REL-6fc27952)
- 2026-11-01 build: green: npmw npx vitest run renderer (27 files, 175 tests) exit 0 incl. document-tabs.test.ts 8 pass; typecheck 0 errors; lint 0 errors; check:i18n ok; VERA_TEST=1 e2e citations, documents, office-documents, docs-tree, pdf-download, artifacts 7 passed (REQ-UX-388cf31a REQ-UX-712804c9 REQ-UX-775eb693 REQ-FUNC-89161a95 REQ-UX-37821e01 REQ-UX-89428322 REQ-UX-1f53a583 REQ-UX-5fc1d7d3 REQ-UX-be7140e4 REQ-UX-d64f086f REQ-REL-6fc27952)
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 1: quality - a closed then reopened tab accepts a late answer (attempt restarts at 0); hidden chat panel still runs window shortcuts (Escape stop dialog, find); attach as context while a document tab is selected stays hidden; Retry drops focus. spec - mock.spec still clicks #tab-source; text place keeps only the window start, not the scroll inside it; untested boundaries (artifact label, citation retry of a failed document, workbench switch, hidden opener, citation to another document); dead close-source clicks in documents.test (late answer after close untested); planning 06-ui.md and M3 plan still mention Source; no keyboard close
- 2026-11-01 validate: returned to build - review round 1 findings
- 2026-11-01 build: round 1 fixes green - monotonic attempts (late answer after close/reopen test), retry refocuses, text place keeps window + scroll offset, Delete closes a focused tab, hidden conversation ignores window keys and a composer focus request selects Chat (attachments.test), boundary tests added (artifact label, citation retry, workbench switch, hidden opener, citation to another document), dead close-source clicks now close tabs, mock.spec and planning/test wording fixed; renderer vitest 27 files 176 pass + attachments 4 pass; typecheck/lint 0 errors; VERA_TEST=1 e2e citations, documents, office-documents, docs-tree, pdf-download, artifacts, mock 8 passed
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 2: quality - a stale or unconsumed composer focus request keeps selecting Chat over opened documents; TextViewer reports scroll 0 before restoring and StrictMode re-run loses the kept scroll. spec - 06-ui.md layout diagram/Source width/Artifacts text, document-viewer.md and 06-ui §5 miss Delete and the window+scroll place, docs-tree.test comment, Delete not recorded as a scope deviation, conversation scroll position not asserted (display:none can reset it)
- 2026-11-01 validate: returned to build - review round 2 findings
- 2026-11-01 build: DEVIATION build: Delete on a focused document tab closes it, beyond the tablist-arrows keyboard scope of the Frame - review round 1 asked for a keyboard way to close a tab; Frame Out of scope updated; no clash with child 2's Ctrl+W and menu
- 2026-11-01 build: round 2 fixes green - composer focus requests are taken once (composerFocused clears them in App; Chat selected once; focus when the composer is enabled) with two new attachments tests (stale request, disabled composer); TextViewer reports and keeps the restored scroll across effect re-runs; the Chat panel is inert + visibility:hidden instead of hidden (Chromium's hidden display:none reset the transcript scroll), asserted in pdf-download.spec (scrollTop 600 kept); planning 06-ui.md, knowledge and test wording fixed; DEVIATION for Delete logged; renderer vitest 27 files 179 pass; typecheck/lint 0 errors; e2e 8 passed
- 2026-11-01 build: completed; next validate (6 Done checklist item(s) left unticked)
- 2026-11-01 validate: review round 3: spec approved; its minor note applied as requirement text only (REQ-UX-1f53a583 verification names the transcript scroll check already in pdf-download.spec), no code change
- 2026-11-01 validate: final: python .agentic/aegis.py check --task TASK-79f6ffd3 --strict --run exit 0; lint, typecheck, i18n ok (test not in [check] run; renderer vitest 27 files 179 pass and VERA_TEST=1 e2e citations, documents, office-documents, docs-tree, pdf-download, artifacts, mock 8 passed after the last code change); errors=0, strict ok, no finding on this task's requirements; remaining warnings are other tasks' records; limitation: an Attach while the composer is disabled focuses the composer later when Chat is next shown (reviewer note, accepted)
- 2026-11-01 validate: completed; next done (9 Done checklist item(s) left unticked)

## Rulings


## State

status: done
reported: validate - completed
next: implementation guidance complete; commit, push and integration belong to the developer
must_read: .agentic/tasks/TASK-79f6ffd3.md
changed: design: per-session tab map, DocumentTabs, place-aware viewers, Source tab removed
evidence: check --task TASK-79f6ffd3 --strict --run exit 0; renderer 179 pass; e2e 8 passed
issues:
spec_compliance: approved
implementation_quality: approved
review_round: 3

## Delivery report (2026-11-01)

- stage: validate; type: feature; path: full; branch: master
- requirements:
  - REQ-UX-388cf31a - Show the chat area as Chat and document tabs
  - REQ-UX-712804c9 - Open documents in tabs of the chat area
  - REQ-UX-775eb693 - Open a file from the Files tree in a tab
  - REQ-FUNC-89161a95 - Select the open tab of a document
  - REQ-UX-37821e01 - Show the chat area when a document opens
  - REQ-UX-89428322 - Close a document tab
  - REQ-UX-1f53a583 - Keep each tab's place while switching tabs
  - REQ-UX-5fc1d7d3 - Keep document tabs per session
  - REQ-UX-be7140e4 - Move between tabs with the arrow keys
  - REQ-UX-d64f086f - Move focus into and back from a document tab
  - REQ-REL-6fc27952 - Show a document tab's load error with Retry
  - REQ-UX-aa068a49 - List and reopen recent sources of the session
  - REQ-UX-b3231a55 - Widen the right panel for sources
- deviations: 2 recorded
  - specify: REQ-UX-aa068a49 (Recent sources) and REQ-UX-b3231a55 (Source width) retired - the open document tabs replace the right panel Source tab per parent RULING-001
  - build: Delete on a focused document tab closes it, beyond the tablist-arrows keyboard scope of the Frame - review round 1 asked for a keyboard way to close a tab; Frame Out of scope updated; no clash with child 2's Ctrl+W and menu
- explicit review: enabled; spec_compliance=approved; implementation_quality=approved; review_round=3
- diff vs task base 9602160: 61 file(s) changed, 2478 line(s) added
- checks: errors=0 warnings=58 notes=3
- checklist: 0/9 done; open: diff reviewed against scope, requirements, design, error paths, portability, security and unrequested work; knowledge pages of changed components current with the reviewed code; project and environment context reconciled with the candidate; requirements re-read: status, prose, verification, paths and links true; manual or inspection verification recorded where applicable; explicit review approved, when enabled; final `check --strict --run` result logged truthfully after the last edit; remaining warnings and pre-existing failures explained; `report` appended
